/* PubChem lookup for the static site. No guessed CIDs, structures or properties. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PubChemLookup = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PUG = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';
  const ENTREZ = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi';
  const PROPERTIES = 'Title,IUPACName,SMILES,ConnectivitySMILES,MolecularFormula,MolecularWeight';
  const GREEK = {
    'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon',
    'ζ': 'zeta', 'η': 'eta', 'θ': 'theta', 'ι': 'iota', 'κ': 'kappa',
    'λ': 'lambda', 'μ': 'mu', 'ν': 'nu', 'ξ': 'xi', 'ο': 'omicron',
    'π': 'pi', 'ρ': 'rho', 'σ': 'sigma', 'τ': 'tau', 'υ': 'upsilon',
    'φ': 'phi', 'χ': 'chi', 'ψ': 'psi', 'ω': 'omega', 'ϐ': 'beta'
  };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const isCid = value => /^[1-9]\d*$/.test(String(value));

  class LookupError extends Error {
    constructor(kind, message, details = {}) {
      super(message);
      this.name = 'LookupError';
      this.kind = kind;
      this.retryable = ['network', 'timeout', 'rate_limited', 'unavailable', 'invalid_response'].includes(kind);
      Object.assign(this, details);
    }
  }

  function parseEntries(raw) {
    // Chemical names contain commas: never split a name on commas or semicolons.
    return String(raw).split(/\r\n|[\n\r]/).map(line => line.trim()).filter(Boolean);
  }

  function normalizeName(value) {
    return String(value).normalize('NFKC')
      .replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, '')
      .replace(/[\u2010-\u2015\u2212\ufe58\ufe63\uff0d]/g, '-')
      .replace(/[\u2018\u2019\u201b\u2032\u02b9\u02bc]/g, "'")
      .replace(/\u2033/g, "''")
      .replace(/\u2034/g, "'''")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/^\s*"([\s\S]*)"\s*$/, '$1')
      .replace(/\s+/g, ' ')
      .replace(/\s*-\s*/g, '-')
      .replace(/\s*,\s*/g, ', ')
      .replace(/(\d'*),\s+(?=\d)/g, '$1,')
      .trim();
  }

  function spellGreek(name) {
    return name.replace(/[Α-Ωα-ωϐ]/g, (letter, offset, text) => {
      const word = GREEK[letter.toLowerCase()];
      if (!word) return letter;
      const before = /[a-z0-9]/i.test(text[offset - 1] || '') ? '-' : '';
      const after = /[a-z0-9]/i.test(text[offset + 1] || '') ? '-' : '';
      return before + word + after;
    });
  }

  function getGcmsVariants(name) {
    const variants = [];
    // Reorder ester names, retaining every stereo descriptor and locant.
    const ester = name.match(/^(.+?\bacid)(\s+\([^)]*\)-?)?,\s*([a-z0-9()'-]+)\s+ester(?:,\s*(\([^)]*\))-?)?$/i);
    if (ester) {
      const stem = ester[1].replace(/oic acid$/i, 'oate').replace(/ic acid$/i, 'ate');
      if (stem !== ester[1]) {
        const stereo = [ester[2], ester[4]].filter(Boolean).map(s => s.trim().replace(/-$/, '')).join(' ');
        variants.push(`${ester[3]} ${stereo ? stereo + '-' : ''}${stem.toLowerCase()}`);
        if (stereo) variants.push(`${stereo}-${ester[3]} ${stem.toLowerCase()}`);
      }
    }
    // E.g. Pentane, 2,3,3-trimethyl- -> 2,3,3-trimethylpentane.
    const inverted = name.match(/^([a-z][a-z -]*),\s*(\d[\s\S]*?)-$/i);
    if (inverted && !/\bester\b/i.test(name)) {
      variants.push(inverted[2] + inverted[1].toLowerCase());
    }
    // Never drop stereo suffixes, sugars, ester groups, or everything after a comma.
    return variants;
  }

  function getNameVariants(value) {
    const original = String(value).trim();
    const normalized = normalizeName(original);
    const ascii = spellGreek(normalized);
    const candidates = [original, normalized, ascii, ...getGcmsVariants(normalized), ...getGcmsVariants(ascii)];
    const seen = new Set();
    return candidates.filter(name => {
      const key = name.toLowerCase();
      if (!name || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 8);
  }

  function identifier(value) {
    const query = String(value).trim();
    // Do not normalize SMILES: case, slashes, charges and stereochemistry matter.
    if (/^smiles\s*:/i.test(query)) return { namespace: 'smiles', value: query.replace(/^smiles\s*:\s*/i, '') };
    if (/^InChI=/.test(query)) return { namespace: 'inchi', value: query };
    const key = query.replace(/^InChIKey\s*[:=]\s*/i, '');
    if (/^[A-Z]{14}-[A-Z]{10}-[A-Z]$/.test(key)) return { namespace: 'inchikey', value: key };
    const normalized = normalizeName(query);
    const cid = normalized.match(/^(?:(?:PubChem\s+)?CID\s*[:#]?\s*)?(\d+)$/i);
    if (cid) return { namespace: 'cid', value: cid[1].replace(/^0+(?=\d)/, '') };
    return { namespace: 'name', value: query };
  }

  // One queue for all API requests, including retries and property batches.
  // Starts are spaced out as well as concurrency-limited (not Promise.all bursts).
  function createScheduler(concurrency, intervalMs) {
    const queue = [];
    let active = 0;
    let nextStart = 0;
    let timer = null;
    function pump() {
      if (timer !== null || active >= concurrency || !queue.length) return;
      const delay = Math.max(0, nextStart - Date.now());
      if (delay > 0) {
        timer = setTimeout(() => { timer = null; pump(); }, delay);
        return;
      }
      const job = queue.shift();
      active++;
      nextStart = Date.now() + intervalMs;
      Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => { active--; pump(); });
      pump();
    }
    const schedule = task => new Promise((resolve, reject) => { queue.push({ task, resolve, reject }); pump(); });
    schedule.pause = ms => { nextStart = Math.max(nextStart, Date.now() + ms); };
    return schedule;
  }

  async function mapLimit(items, concurrency, task) {
    const results = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await task(items[index], index);
      }
    }));
    return results;
  }

  function retryAfterMs(value) {
    if (!value) return 0;
    if (/^\d+(\.\d+)?$/.test(value)) return Number(value) * 1000;
    const date = Date.parse(value);
    return Number.isNaN(date) ? 0 : Math.max(0, date - Date.now());
  }

  function invalidResponse() {
    return new LookupError('invalid_response', 'The lookup service returned incomplete or unreadable data. Please retry.');
  }

  function readCids(data) {
    const ids = data?.IdentifierList?.CID;
    if (!Array.isArray(ids) || !ids.every(isCid)) throw invalidResponse();
    return [...new Set(ids.map(String))];
  }

  function uniqueMatch(cids, details = {}, count = cids.length) {
    if (count > 1) {
      throw new LookupError('ambiguous', 'This identifier matches multiple PubChem records. Review the candidates and enter the verified CID.', {
        ...details, candidateCids: cids.slice(0, 10), candidateCount: count
      });
    }
    if (cids.length === 1 && count === 1) return { ...details, cid: cids[0] };
    return null;
  }

  function createClient(options = {}) {
    const fetchImpl = options.fetch || globalThis.fetch.bind(globalThis);
    const concurrency = Math.max(1, options.concurrency ?? 2);
    const schedule = createScheduler(concurrency, Math.max(0, options.minIntervalMs ?? 400));
    const timeoutMs = options.timeoutMs ?? 15000;
    const maxRetries = options.maxRetries ?? 2;
    const retryBaseMs = options.retryBaseMs ?? 800;
    const maxRetryDelayMs = options.maxRetryDelayMs ?? 60000;
    const resolutionCache = new Map();
    const inFlight = new Map();
    const propertyCache = new Map();
    const unavailableHosts = new Map();

    async function requestJson(url, init = {}, validate = data => data) {
      const host = new URL(url).origin;
      for (let attempt = 0; ; attempt++) {
        try {
          return await schedule(async () => {
            // Stop hammering a down service for every name in a 50-entry batch.
            const unavailable = unavailableHosts.get(host);
            if (unavailable && unavailable.until > Date.now()) throw unavailable.error;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
              const response = await fetchImpl(url, { ...init, signal: controller.signal });
              if (!response.ok) {
                const status = response.status;
                const wait = retryAfterMs(response.headers?.get('Retry-After'));
                if (status === 404) throw new LookupError('not_found', 'No matching PubChem record was returned.', { status });
                if (status === 400 || status === 422) throw new LookupError('invalid_input', 'PubChem could not interpret this identifier. Check the spelling or supply a verified CID or SMILES.', { status });
                if (status === 429) throw new LookupError('rate_limited', 'The lookup service is rate-limiting requests. Wait a little, then retry.', { status, retryAfterMs: wait });
                if (status === 408 || status === 504) throw new LookupError('timeout', 'The lookup service timed out. This does not mean the compound is missing. Please retry.', { status, retryAfterMs: wait });
                if (status >= 500) throw new LookupError('unavailable', 'The lookup service is temporarily unavailable. Please retry later.', { status, retryAfterMs: wait });
                throw new LookupError('access_denied', `The lookup service refused the request (HTTP ${status}). Check network/browser access and retry.`, { status });
              }
              const data = await response.json();
              if (data?.Fault) {
                if (/NotFound/i.test(data.Fault.Code || '')) throw new LookupError('not_found', 'No matching PubChem record was returned.');
                throw invalidResponse();
              }
              return validate(data);
            } catch (error) {
              if (error instanceof LookupError) throw error;
              if (controller.signal.aborted || error?.name === 'AbortError') {
                throw new LookupError('timeout', 'The lookup service timed out. This does not mean the compound is missing. Please retry.');
              }
              if (error instanceof SyntaxError) throw invalidResponse();
              throw new LookupError('network', 'Could not reach the lookup service (connection or browser access error). Please retry; the compound has not been confirmed missing.');
            } finally {
              // Keep the timeout active through response.json(), not just the headers.
              clearTimeout(timer);
            }
          });
        } catch (error) {
          const blocked = unavailableHosts.get(host);
          if (blocked && blocked.until > Date.now()) throw error;
          if (!error.retryable) throw error;
          if (attempt >= maxRetries || (error.retryAfterMs || 0) > maxRetryDelayMs) {
            unavailableHosts.set(host, {
              error, until: Date.now() + Math.max(20000, error.retryAfterMs || 0),
              retryAfterUntil: Date.now() + (error.retryAfterMs || 0)
            });
            throw error;
          }
          const delay = Math.max(retryBaseMs * (2 ** attempt), error.retryAfterMs || 0);
          if (error.kind === 'rate_limited' || error.kind === 'unavailable') schedule.pause(delay);
          await sleep(delay);
        }
      }
    }

    function queryIdentifier(namespace, value) {
      // Form POST avoids encoded slashes/primes/long chemical names breaking URL paths.
      const suffix = namespace === 'name' ? '?name_type=complete' : '';
      return requestJson(`${PUG}/compound/${namespace}/cids/JSON${suffix}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({ [namespace]: value }).toString()
      }, readCids);
    }

    async function exactSynonymFallback(variants) {
      // Never select the first hit from a broad, unqualified Entrez search.
      // Embedded quotes cannot be safely expressed as an exact Entrez phrase.
      const safe = variants.filter(name => !name.includes('"'));
      if (!safe.length) return null;
      const term = safe.map(name => `"${name}"[CompleteSynonym]`).join(' OR ');
      const params = new URLSearchParams({ db: 'pccompound', term, retmode: 'json', retmax: '10' });
      const data = await requestJson(`${ENTREZ}?${params}`, {}, json => {
        const result = json?.esearchresult;
        if (json?.error || !result || result.ERROR || result.errorlist?.fieldnotfound ||
            !Array.isArray(result.idlist) || !result.idlist.every(isCid) || !/^\d+$/.test(String(result.count))) {
          throw invalidResponse();
        }
        const count = Number(result.count);
        if ((count > 0 && !result.idlist.length) || count < result.idlist.length) throw invalidResponse();
        return { ids: [...new Set(result.idlist.map(String))], count };
      });
      return uniqueMatch(data.ids, { source: 'PubChem exact synonym (NCBI)', matchedName: '', attemptedNames: variants }, data.count);
    }

    async function resolveUncached(query) {
      const id = identifier(query);
      if (!id.value) throw new LookupError('invalid_input', 'Enter a compound name, positive PubChem CID, or SMILES: followed by a structure.');
      if (id.namespace === 'cid') {
        if (!isCid(id.value)) throw new LookupError('invalid_input', 'A PubChem CID must be a positive integer.');
        return { cid: id.value, source: 'PubChem CID', matchedName: id.value, attemptedNames: [] };
      }
      if (id.namespace !== 'name') {
        const cids = await queryIdentifier(id.namespace, id.value);
        const match = uniqueMatch(cids, { source: `PubChem ${id.namespace}`, matchedName: query, attemptedNames: [] });
        if (match) return match;
        throw new LookupError('not_found', 'No PubChem record matched this structure identifier. Check it against the source.');
      }

      const variants = getNameVariants(query);
      const attempted = [];
      let serviceError = null;
      for (const name of variants) {
        try {
          attempted.push(name);
          const cids = await queryIdentifier('name', name);
          const match = uniqueMatch(cids, { source: 'PubChem exact name', matchedName: name, attemptedNames: [...attempted] });
          if (match) return match;
        } catch (error) {
          if (error.kind === 'ambiguous') throw error;
          if (error.kind !== 'not_found' && error.kind !== 'invalid_input') {
            serviceError = error;
            break; // Don't repeat every spelling variant against an unreachable API.
          }
        }
      }
      try {
        const match = await exactSynonymFallback(variants);
        if (match) return match;
      } catch (error) {
        if (error.kind === 'ambiguous') throw error;
        serviceError = serviceError || error;
      }
      if (serviceError) {
        // A failed request is not evidence that a compound does not exist.
        throw new LookupError(serviceError.kind, serviceError.message, { attemptedNames: variants });
      }
      throw new LookupError('not_found', 'No exact PubChem name/synonym match. Check the source spelling, or enter a verified CID, InChIKey or SMILES: structure. Some literature names are not indexed.', { attemptedNames: variants });
    }

    async function resolve(query) {
      if (resolutionCache.has(query)) return resolutionCache.get(query);
      if (inFlight.has(query)) return inFlight.get(query);
      const pending = resolveUncached(query).then(result => {
        resolutionCache.set(query, result);
        return result;
      }).finally(() => inFlight.delete(query));
      inFlight.set(query, pending);
      return pending;
    }

    async function fetchProperties(cids, onProgress) {
      const records = new Map();
      let completed = 0;
      function finish(cid, result) {
        records.set(cid, result);
        onProgress?.({ phase: 'properties', completed: ++completed, total: cids.length });
      }
      async function fetchGroup(group) {
        try {
          const list = await requestJson(`${PUG}/compound/cid/${group.join(',')}/property/${PROPERTIES}/JSON`, {}, data => {
            const properties = data?.PropertyTable?.Properties;
            const fields = ['Title', 'IUPACName', 'MolecularFormula', 'MolecularWeight', 'SMILES', 'IsomericSMILES', 'CanonicalSMILES', 'ConnectivitySMILES'];
            if (!Array.isArray(properties) || !properties.every(p => p && isCid(p.CID) &&
                fields.some(field => p[field] !== undefined && p[field] !== null && p[field] !== ''))) throw invalidResponse();
            return properties;
          });
          const missing = [];
          for (const cid of group) {
            const props = list.find(p => String(p.CID) === cid);
            if (props) {
              propertyCache.set(cid, props);
              finish(cid, { props });
            } else if (group.length > 1) missing.push(cid);
            else finish(cid, { error: invalidResponse() });
          }
          // A partial batch must not hide good records or fabricate missing ones.
          await mapLimit(missing, concurrency, cid => fetchGroup([cid]));
        } catch (error) {
          if (group.length > 1 && ['not_found', 'invalid_input'].includes(error.kind)) {
            const mid = Math.ceil(group.length / 2);
            await fetchGroup(group.slice(0, mid));
            await fetchGroup(group.slice(mid));
          } else {
            // No per-CID storm on an outage. Leave these rows retryable instead.
            group.forEach(cid => finish(cid, { error }));
          }
        }
      }
      const missing = [];
      for (const cid of cids) {
        if (propertyCache.has(cid)) finish(cid, { props: propertyCache.get(cid) });
        else missing.push(cid);
      }
      const chunks = [];
      for (let i = 0; i < missing.length; i += 20) chunks.push(missing.slice(i, i + 20));
      await mapLimit(chunks, concurrency, fetchGroup);
      return records;
    }

    function failedRow(item, error, resolution = {}) {
      return {
        ...resolution, inputLabel: item.inputLabel, query: item.query,
        cid: resolution.cid || '—', name: '', formula: '', weight: '', smiles: '',
        error: error.message || 'Lookup could not be completed. Please retry.',
        errorType: error.kind || 'unavailable', retryable: error.retryable !== false,
        attemptedNames: error.attemptedNames || resolution.attemptedNames || [],
        candidateCids: error.candidateCids || [], candidateCount: error.candidateCount || 0
      };
    }

    async function lookupEntries(entries, { onProgress } = {}) {
      // A new batch can retry an outage, but must still respect a server's Retry-After.
      for (const [host, blocked] of unavailableHosts) {
        if (blocked.retryAfterUntil > Date.now()) blocked.until = blocked.retryAfterUntil;
        else unavailableHosts.delete(host);
      }
      const items = entries.map(entry => typeof entry === 'string'
        ? { inputLabel: entry, query: entry.trim() }
        : { inputLabel: entry.inputLabel, query: String(entry.query || entry.inputLabel).trim() });
      let completed = 0;
      onProgress?.({ phase: 'resolving', completed, total: items.length });
      const resolved = await mapLimit(items, concurrency, async item => {
        try {
          return { ...await resolve(item.query), inputLabel: item.inputLabel, query: item.query };
        } catch (error) {
          return failedRow(item, error);
        } finally {
          onProgress?.({ phase: 'resolving', completed: ++completed, total: items.length });
        }
      });
      const cids = [...new Set(resolved.filter(row => !row.error).map(row => row.cid))];
      onProgress?.({ phase: 'properties', completed: 0, total: cids.length });
      const properties = await fetchProperties(cids, onProgress);
      return resolved.map(row => {
        if (row.error) return row;
        const record = properties.get(row.cid);
        if (!record?.props) return failedRow(row, record?.error || invalidResponse(), row);
        const p = record.props;
        return {
          ...row, name: p.Title || p.IUPACName || `CID ${row.cid}`,
          formula: p.MolecularFormula || '', weight: p.MolecularWeight ?? '',
          smiles: p.SMILES || p.IsomericSMILES || p.CanonicalSMILES || p.ConnectivitySMILES || '',
          error: null, errorType: null, retryable: false
        };
      });
    }

    return { lookupEntries };
  }

  return { createClient, parseEntries, normalizeName, getNameVariants, getGcmsVariants, identifier, LookupError };
});
