const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, parseEntries, normalizeName, getNameVariants, getGcmsVariants, identifier } = require('../assets/pubchem-lookup.js');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', ...headers }
});
const miss = () => json({ Fault: { Code: 'PUGREST.NotFound' } }, 404);
const ids = (...CID) => json({ IdentifierList: { CID } });
// Synthetic API fixtures only; these are not asserted mappings for literature names.
const property = cid => ({ CID: Number(cid), Title: `API fixture ${cid}`, IUPACName: 'fixture name', MolecularFormula: 'C2H6O', MolecularWeight: '46.07', SMILES: 'CCO' });
const properties = cids => json({ PropertyTable: { Properties: cids.map(property) } });
const propertyCids = url => new URL(url).pathname.match(/\/cid\/([^/]+)\/property\//)?.[1].split(',');
const nameIn = init => new URLSearchParams(init.body).get('name');
const fastClient = (fetch, options = {}) => createClient({ fetch, minIntervalMs: 0, timeoutMs: 1000, maxRetries: 0, retryBaseMs: 0, ...options });

test('one entry per line; preserve chemical commas, semicolons and CRLF input', () => {
  assert.deepEqual(parseEntries(' 2244\r\nPentane, 2,3,3-trimethyl-\rMethyl ferulate\n\nA; B\n'), [
    '2244', 'Pentane, 2,3,3-trimethyl-', 'Methyl ferulate', 'A; B'
  ]);
});

test('normalize pasted quotes, primes, dashes and invisible spaces without changing stereo', () => {
  assert.equal(normalizeName(' “1′‑acetoxychavicol\u00a0acetate”\u200b '), "1'-acetoxychavicol acetate");
  assert.equal(normalizeName('25–O–acetylcimigenol–3–O–β–D–xylopyranoside'), '25-O-acetylcimigenol-3-O-β-D-xylopyranoside');
  assert.equal(normalizeName('Methyl 4″−ferulate'), "Methyl 4''-ferulate");
});

test('Greek variants retain sugars, locants, D/L and primes from screenshot-style names', () => {
  const variants = getNameVariants('25‑O‑acetylcimigenol‑3‑O‑β‑D‑xylopyranoside');
  assert(variants.includes('25-O-acetylcimigenol-3-O-beta-D-xylopyranoside'));
  assert(getNameVariants('βsitosterol').includes('beta-sitosterol'));
  assert(getNameVariants('Β-sitosterol').includes('beta-sitosterol'));
  const methyl = getNameVariants('Methyl 4′‑β‑d‑glucopyranosyl–ferulate');
  assert(methyl.includes("Methyl 4'-beta-d-glucopyranosyl-ferulate"));
  assert(variants.every(name => name.includes('xylopyranoside')));
  assert(variants.every(name => /β|beta/.test(name)));
  assert.deepEqual(getNameVariants('Methyl ferulate'), ['Methyl ferulate']);
});

test('GC-MS conversion preserves E/Z and never falls back to the acid alone', () => {
  assert(getGcmsVariants('Pentane, 2,3,3-trimethyl-').includes('2,3,3-trimethylpentane'));
  assert(getNameVariants('Pentane, 2,3,3-trimethyl-').includes('2,3,3-trimethylpentane'));
  assert(getNameVariants('Hexadecanoic acid, methyl ester').includes('methyl hexadecanoate'));
  const names = getNameVariants('9-Octadecenoic acid, methyl ester, (E)-');
  assert(names.includes('methyl (E)-9-octadecenoate'));
  assert(names.every(name => name.includes('(E)')));
  assert(names.every(name => /methyl/i.test(name)));
  assert(!names.includes('9-Octadecenoic acid'));
  const stereo = getNameVariants('Example, (1.alpha.,2.beta.)-');
  assert(stereo.every(name => name.includes('alpha') && name.includes('beta')));
});

test('identifier parsing does not normalize structure syntax or guess unprefixed SMILES', () => {
  assert.deepEqual(identifier('CID: 002244'), { namespace: 'cid', value: '2244' });
  assert.deepEqual(identifier('PubChem CID 2244'), { namespace: 'cid', value: '2244' });
  assert.deepEqual(identifier('SMILES: C/C=C\\C.[NH4+]'), { namespace: 'smiles', value: 'C/C=C\\C.[NH4+]' });
  assert.deepEqual(identifier('CCO'), { namespace: 'name', value: 'CCO' });
  assert.equal(identifier('InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3').namespace, 'inchi');
  assert.equal(identifier('InChIKey: LFQSCWFLJHTTHZ-UHFFFAOYSA-N').namespace, 'inchikey');
});

test('original name first; POST encoding and normalized match retain the original input', async () => {
  const original = 'Methyl 4′‑β‑d‑glucopyranosyl–ferulate';
  const expected = "Methyl 4'-beta-d-glucopyranosyl-ferulate";
  const queried = [];
  const client = fastClient(async (url, init) => {
    const cids = propertyCids(url);
    if (cids) return properties(cids);
    assert.equal(init.method, 'POST');
    assert.equal(new URL(url).searchParams.get('name_type'), 'complete');
    queried.push(nameIn(init));
    return nameIn(init) === expected ? ids(101) : miss();
  });
  const [row] = await client.lookupEntries([original]);
  assert.equal(queried[0], original);
  assert.equal(row.inputLabel, original);
  assert.equal(row.query, original);
  assert.equal(row.matchedName, expected);
  assert.equal(row.cid, '101');
  assert.equal(row.error, null);
  assert.equal(row.name, 'API fixture 101');
});

test('SMILES containing slashes, plus signs and # survives form encoding', async () => {
  const smiles = 'C/C=C\\C.[NH4+].C#N';
  const client = fastClient(async (url, init) => {
    if (propertyCids(url)) return properties(['101']);
    assert(url.includes('/compound/smiles/cids/JSON'));
    assert.equal(new URLSearchParams(init.body).get('smiles'), smiles);
    assert(!url.includes(smiles));
    return ids(101);
  });
  const [row] = await client.lookupEntries([`SMILES: ${smiles}`]);
  assert.equal(row.cid, '101');
  assert.equal(row.source, 'PubChem smiles');
});

test('CID passthrough still requires actual PubChem properties and rejects zero', async () => {
  const urls = [];
  const client = fastClient(async url => { urls.push(url); return properties(propertyCids(url)); });
  const rows = await client.lookupEntries(['CID: 002244', '0']);
  assert.equal(urls.length, 1);
  assert.equal(rows[0].cid, '2244');
  assert.equal(rows[1].errorType, 'invalid_input');
  assert.equal(rows[1].smiles, '');
});

test('common names are verified by the API, not a hard-coded CID dictionary', async () => {
  let nameRequests = 0;
  const client = fastClient(async (url, init) => {
    if (propertyCids(url)) return properties(['2519']);
    assert.equal(nameIn(init), 'caffeine');
    nameRequests++;
    return ids(2519);
  });
  const [row] = await client.lookupEntries(['caffeine']);
  assert.equal(row.cid, '2519');
  assert.equal(nameRequests, 1);
});

test('no exact match uses a quoted CompleteSynonym fallback, not the first broad search hit', async () => {
  let term;
  const client = fastClient(async url => {
    if (propertyCids(url)) return properties(['101']);
    if (url.includes('esearch.fcgi')) {
      term = new URL(url).searchParams.get('term');
      return json({ esearchresult: { count: '1', idlist: ['101'] } });
    }
    return miss();
  });
  const [row] = await client.lookupEntries(['Stemofuran X']);
  assert.equal(term, '"Stemofuran X"[CompleteSynonym]');
  assert.equal(row.source, 'PubChem exact synonym (NCBI)');
});

test('both APIs confirming no match produces actionable not_found, without retrying 404s', async () => {
  let calls = 0;
  const client = fastClient(async url => {
    calls++;
    return url.includes('esearch.fcgi') ? json({ esearchresult: { count: '0', idlist: [] } }) : miss();
  }, { maxRetries: 2 });
  const [row] = await client.lookupEntries(['Unindexed literature name']);
  assert.equal(row.errorType, 'not_found');
  assert.match(row.error, /verified CID/);
  assert.equal(row.retryable, false);
  assert.equal(calls, 2);
  assert.equal(row.formula, '');
  assert.equal(row.weight, '');
});

test('multiple exact CIDs require review; do not silently select the first isomer', async () => {
  let calls = 0;
  const client = fastClient(async () => { calls++; return ids(101, 102); });
  const [row] = await client.lookupEntries(['ambiguous compound']);
  assert.equal(row.errorType, 'ambiguous');
  assert.deepEqual(row.candidateCids, ['101', '102']);
  assert.equal(row.cid, '—');
  assert.equal(calls, 1);
});

test('Entrez count, not just the first returned ID, determines ambiguity', async () => {
  const client = fastClient(async url => url.includes('esearch.fcgi')
    ? json({ esearchresult: { count: '12', idlist: ['101', '102'] } }) : miss());
  const [row] = await client.lookupEntries(['Ambiguous synonym']);
  assert.equal(row.errorType, 'ambiguous');
  assert.equal(row.candidateCount, 12);
  assert.equal(row.cid, '—');
});

test('a failed secondary search is not reported as a confirmed missing compound', async () => {
  const client = fastClient(async url => {
    if (url.includes('esearch.fcgi')) throw new TypeError('Failed to fetch');
    return miss();
  });
  const [row] = await client.lookupEntries(['Kudolignan A']);
  assert.equal(row.errorType, 'network');
  assert.equal(row.retryable, true);
});

test('HTTP 429 honors Retry-After before a successful retry', async () => {
  const starts = [];
  const client = fastClient(async url => {
    if (propertyCids(url)) return properties(['101']);
    starts.push(Date.now());
    return starts.length === 1 ? json({}, 429, { 'Retry-After': '0.02' }) : ids(101);
  }, { maxRetries: 2 });
  const [row] = await client.lookupEntries(['Methyl ferulate']);
  assert.equal(row.error, null);
  assert.equal(starts.length, 2);
  assert(starts[1] - starts[0] >= 18, starts.join(','));
});

test('HTTP 503 and network errors are retried, then can recover', async () => {
  let calls = 0;
  const client = fastClient(async url => {
    if (propertyCids(url)) return properties(['101']);
    calls++;
    if (calls === 1) return json({}, 503);
    if (calls === 2) throw new TypeError('connection reset');
    return ids(101);
  }, { maxRetries: 2 });
  const [row] = await client.lookupEntries(['Methyl ferulate']);
  assert.equal(row.error, null);
  assert.equal(calls, 3);
});

test('long Retry-After does not trigger an early retry or an unbounded wait', async () => {
  let calls = 0;
  const client = fastClient(async () => { calls++; return json({}, 429, { 'Retry-After': '3600' }); }, { maxRetries: 2 });
  const [row] = await client.lookupEntries(['2244']);
  assert.equal(row.errorType, 'rate_limited');
  assert.equal(calls, 1);
  const [retried] = await client.lookupEntries(['2244']);
  assert.equal(retried.errorType, 'rate_limited');
  assert.equal(calls, 1, 'An explicit retry must not bypass the server cooldown');
});

test('exhausted property retries keep the CID but never invent formula, mass or SMILES', async () => {
  let calls = 0;
  const client = fastClient(async () => { calls++; return json({}, 503); }, { maxRetries: 2 });
  const [row] = await client.lookupEntries(['2244']);
  assert.equal(calls, 3);
  assert.equal(row.cid, '2244');
  assert.equal(row.errorType, 'unavailable');
  assert.equal(row.weight, '');
  assert.equal(row.formula, '');
  assert.equal(row.smiles, '');
});

test('a 50-name outage has bounded traffic and cannot turn into 50 false not-found results', async () => {
  let calls = 0;
  const client = fastClient(async () => { calls++; throw new TypeError('offline'); }, { maxRetries: 2 });
  const rows = await client.lookupEntries(Array.from({ length: 50 }, (_, i) => `Compound ${i}`));
  assert(rows.every(row => row.errorType === 'network'));
  assert(calls <= 12, `${calls} requests should be bounded by the two services and workers`);
});

test('timeouts cover body parsing and are classified separately from missing records', async () => {
  const client = fastClient(async (_url, { signal }) => ({
    ok: true,
    json: () => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    })
  }), { timeoutMs: 10 });
  const [row] = await client.lookupEntries(['2244']);
  assert.equal(row.errorType, 'timeout');
  assert.equal(row.retryable, true);
});

test('invalid JSON and malformed successful responses are retried rather than cached as misses', async () => {
  let calls = 0;
  const client = fastClient(async url => {
    if (propertyCids(url)) return properties(['101']);
    calls++;
    if (calls === 1) return new Response('<html>busy</html>', { status: 200 });
    if (calls === 2) return json({ somethingElse: true });
    return ids(101);
  }, { maxRetries: 2 });
  const [row] = await client.lookupEntries(['Methyl ferulate']);
  assert.equal(row.error, null);
  assert.equal(calls, 3);
});

test('one invalid CID in a property batch cannot make the other compounds fail', async () => {
  const requested = [];
  const client = fastClient(async url => {
    const cids = propertyCids(url);
    requested.push(cids);
    return cids.includes('999') ? miss() : properties(cids);
  });
  const rows = await client.lookupEntries(['2244', '999', '2519']);
  assert.deepEqual(rows.map(row => row.inputLabel), ['2244', '999', '2519']);
  assert.equal(rows[0].error, null);
  assert.equal(rows[1].errorType, 'not_found');
  assert.equal(rows[2].error, null);
  assert(requested.some(cids => cids.length === 1 && cids[0] === '999'));
});

test('partial property responses retry only missing CIDs', async () => {
  const requested = [];
  const client = fastClient(async url => {
    const cids = propertyCids(url);
    requested.push(cids);
    return cids.length > 1 ? properties(['2244']) : properties(cids);
  });
  const rows = await client.lookupEntries(['2244', '2519']);
  assert(rows.every(row => !row.error));
  assert.deepEqual(requested, [['2244', '2519'], ['2519']]);
});

test('property outage is not fanned out into one request for each CID', async () => {
  let calls = 0;
  const client = fastClient(async () => { calls++; return json({}, 503); });
  const rows = await client.lookupEntries(Array.from({ length: 50 }, (_, i) => String(i + 1)));
  assert(rows.every(row => row.errorType === 'unavailable'));
  assert(calls <= 2, `${calls} requests`);
});

test('modern and legacy SMILES response keys are accepted; missing values stay empty', async () => {
  const client = fastClient(async () => json({ PropertyTable: { Properties: [
    { CID: 101, IUPACName: 'legacy', CanonicalSMILES: 'CCO' },
    { CID: 102, IUPACName: 'stereo', IsomericSMILES: 'C[C@H](O)C(=O)O', ConnectivitySMILES: 'CC(O)C(=O)O' },
    { CID: 103, Title: 'partial record' }
  ] } }));
  const rows = await client.lookupEntries(['101', '102', '103']);
  assert.equal(rows[0].smiles, 'CCO');
  assert.equal(rows[1].smiles, 'C[C@H](O)C(=O)O');
  assert.equal(rows[2].smiles, '');
  assert.equal(rows[2].formula, '');
  assert.equal(rows[2].weight, '');
});

test('cache successful resolutions/properties, coalesce duplicate queries, keep each input label', async () => {
  let calls = 0;
  const client = fastClient(async url => { calls++; return propertyCids(url) ? properties(['101']) : ids(101); });
  const items = [
    { inputLabel: 'original name', query: 'correct name' },
    { inputLabel: 'second original', query: 'correct name' }
  ];
  const rows = await client.lookupEntries(items);
  assert.equal(calls, 2);
  assert.deepEqual(rows.map(row => row.inputLabel), ['original name', 'second original']);
  await client.lookupEntries(items);
  assert.equal(calls, 2);
});

test('an explicit retry can recover: errors and negative lookups are not persisted in cache', async () => {
  let online = false;
  const client = fastClient(async url => {
    if (!online) throw new TypeError('offline');
    return propertyCids(url) ? properties(['101']) : ids(101);
  });
  const [first] = await client.lookupEntries(['Methyl ferulate']);
  assert.equal(first.errorType, 'network');
  online = true;
  const [second] = await client.lookupEntries(['Methyl ferulate']);
  assert.equal(second.error, null);
});

test('request starts are paced and in-flight concurrency is bounded across a whole batch', async () => {
  let active = 0;
  let peak = 0;
  let nextCid = 100;
  const starts = [];
  const progress = [];
  const client = fastClient(async url => {
    starts.push(Date.now());
    peak = Math.max(peak, ++active);
    await delay(20);
    active--;
    return propertyCids(url) ? properties(propertyCids(url)) : ids(++nextCid);
  }, { concurrency: 2, minIntervalMs: 8 });
  const inputs = Array.from({ length: 6 }, (_, i) => `Compound ${i}`);
  const rows = await client.lookupEntries(inputs, { onProgress: state => progress.push(state) });
  assert.equal(peak, 2);
  assert(starts.slice(1).every((time, i) => time - starts[i] >= 7));
  assert.deepEqual(rows.map(row => row.inputLabel), inputs);
  assert(progress.some(state => state.phase === 'resolving' && state.completed === 6));
  assert(progress.some(state => state.phase === 'properties' && state.completed === 6));
});


test('an empty property record is an invalid response, not a fabricated success', async () => {
  const client = fastClient(async () => json({ PropertyTable: { Properties: [{ CID: 2244 }] } }));
  const [row] = await client.lookupEntries(['2244']);
  assert.equal(row.errorType, 'invalid_response');
  assert.equal(row.smiles, '');
  assert.equal(row.formula, '');
});

test('50 valid CIDs use three bounded property batches and keep input order', async () => {
  const groups = [];
  const inputs = Array.from({ length: 50 }, (_, i) => String(i + 1));
  const client = fastClient(async url => {
    const cids = propertyCids(url);
    groups.push(cids);
    return properties(cids);
  });
  const rows = await client.lookupEntries(inputs);
  assert.deepEqual(groups.map(group => group.length), [20, 20, 10]);
  assert(rows.every(row => !row.error));
  assert.deepEqual(rows.map(row => row.inputLabel), inputs);
});
