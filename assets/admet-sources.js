/* Source-only ADMET records. This module never predicts or fills missing properties. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AdmetSources = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const STORAGE_KEY = 'ddu_admet_source_records_v1';
  const SOURCES = {
    swissadme: { name: 'SwissADME', url: 'https://www.swissadme.ch/', version: 'Website output; model version not supplied' },
    protox: { name: 'ProTox 3.0', url: 'https://tox.charite.de/protox3/', version: '3.0' }
  };
  const FIELDS = [];
  const add = (key, label, source, type, unit, aliases = []) => FIELDS.push({ key, label, source, type, unit, aliases: [label, ...aliases] });
  add('mw', 'Molecular weight', 'swissadme', 'number', 'g/mol', ['MW']);
  add('formula', 'Molecular formula', 'swissadme', 'text', '', ['Formula']);
  add('heavyAtoms', 'Heavy atoms', 'swissadme', 'integer', '', ['Num. heavy atoms']);
  add('aromAtoms', 'Aromatic heavy atoms', 'swissadme', 'integer', '', ['Num. arom. heavy atoms', 'Arom. heavy atoms']);
  add('fractionCsp3', 'Fraction Csp3', 'swissadme', 'fraction', '', ['Fraction Csp³']);
  add('rotBonds', 'Rotatable bonds', 'swissadme', 'integer', '', ['Num. rotatable bonds']);
  add('hAcceptors', 'H-bond acceptors', 'swissadme', 'integer', '', ['Num. H-bond acceptors']);
  add('hDonors', 'H-bond donors', 'swissadme', 'integer', '', ['Num. H-bond donors']);
  add('molarRef', 'Molar refractivity', 'swissadme', 'number', '', ['MR']);
  add('tpsa', 'TPSA', 'swissadme', 'number', 'Å²', ['Topological polar surface area']);
  add('logp', 'Consensus LogP', 'swissadme', 'number', '', ['Consensus Log P', 'Consensus Log Po/w', 'Consensus Log P o/w']);
  for (const model of ['iLOGP', 'XLOGP3', 'WLOGP', 'MLOGP']) add(model.toLowerCase(), `${model} LogP`, 'swissadme', 'number', '', [model, `Log Po/w (${model})`]);
  add('silicosLogp', 'Silicos-IT LogP', 'swissadme', 'number', '', ['Silicos-IT Log P', 'Log Po/w (SILICOS-IT)']);
  add('logs', 'ESOL Log S', 'swissadme', 'number', '', ['Log S (ESOL)']);
  add('aliLogs', 'Ali Log S', 'swissadme', 'number', '', ['Log S (Ali)']);
  add('silicosLogs', 'Silicos-IT Log S', 'swissadme', 'number', '', ['Log S (SILICOS-IT)']);
  add('gi', 'GI absorption', 'swissadme', 'gi', '');
  add('bbb', 'BBB permeant', 'swissadme', 'yesno', '');
  add('pgp', 'P-gp substrate', 'swissadme', 'yesno', '', ['Pgp substrate']);
  for (const enzyme of ['CYP1A2', 'CYP2C19', 'CYP2C9', 'CYP2D6', 'CYP3A4']) add(enzyme.toLowerCase(), `${enzyme} inhibitor`, 'swissadme', 'yesno', '');
  add('skin', 'Log Kp (skin permeation)', 'swissadme', 'number', 'cm/s', ['log Kp (cm/s)', 'Skin permeation (log Kp)']);
  for (const rule of ['Lipinski', 'Ghose', 'Veber', 'Egan', 'Muegge']) {
    add(rule.toLowerCase(), rule, 'swissadme', 'rule', '');
    add(rule === 'Lipinski' ? 'viol' : rule.toLowerCase() + 'Violations', `${rule} violations`, 'swissadme', 'integer', '', [`${rule} #violations`]);
  }
  add('bioavail', 'Bioavailability score', 'swissadme', 'fraction', '');
  add('pains', 'PAINS alerts', 'swissadme', 'text', '', ['PAINS', 'PAINS #alerts']);
  add('brenk', 'Brenk alerts', 'swissadme', 'text', '', ['Brenk', 'Brenk #alerts']);
  add('lead', 'Leadlikeness', 'swissadme', 'rule', '');
  add('sa', 'Synthetic accessibility', 'swissadme', 'accessibility', '');
  add('ld50', 'Predicted LD50', 'protox', 'number', 'mg/kg', ['LD50']);
  add('ghs', 'Predicted toxicity class', 'protox', 'class', '', ['tox_class', 'Toxicity class', 'Predicted GHS category', 'Acute oral toxicity (GHS)']);
  add('accuracy', 'Reported prediction accuracy', 'protox', 'percent', '%', ['Prediction accuracy']);
  add('similarity', 'Average similarity', 'protox', 'percent', '%');
  const MODEL_KEYS = {
    dili: ['hepato', 'Hepatotoxicity'], carcino: ['carcino', 'Carcinogenicity'],
    immuno: ['immuno', 'Immunotoxicity'], mutagen: ['mutagen', 'Mutagenicity'], cyto: ['cyto', 'Cytotoxicity'],
    neuro: ['neuro', 'Neurotoxicity'], nephro: ['nephro', 'Nephrotoxicity'],
    respi: ['respi', 'Respiratory toxicity'], cardio: ['cardio', 'Cardiotoxicity']
  };
  for (const [code, [key, label]] of Object.entries(MODEL_KEYS)) add(key, label, 'protox', 'activity', '', [code, ...(code === 'dili' ? ['Hepatotoxicity (DILI)', 'Liver toxicity'] : [])]);
  const PROTOX_MODELS = 'acute_tox dili neuro nephro respi cardio carcino immuno mutagen cyto bbb eco clinical nutri nr_ahr nr_ar nr_ar_lbd nr_aromatase nr_er nr_er_lbd nr_ppar_gamma sr_are sr_hse sr_mmp sr_p53 sr_atad5 mie_thr_alpha mie_thr_beta mie_ttr mie_ryr mie_gabar mie_nmdar mie_ampar mie_kar mie_ache mie_car mie_pxr mie_nadhox mie_vgsc mie_nis CYP1A2 CYP2C19 CYP2C9 CYP2D6 CYP3A4 CYP2E1 tox_targets';
  // Keep every requested model visible as missing until its own value is returned.
  for (const code of PROTOX_MODELS.split(' ')) {
    if (['acute_tox', 'tox_targets'].includes(code) || MODEL_KEYS[code]) continue;
    add('protox_model:' + code.toLowerCase().replace(/[^a-z0-9]/g, ''), `ProTox model: ${code}`, 'protox', 'activity', '', [code]);
  }
  const fieldByKey = Object.fromEntries(FIELDS.map(field => [field.key, field]));
  const cleanLabel = text => String(text).normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
  const missing = text => /^(?:|n\/?a|null|undefined|not available|not reported|—|-)$/i.test(String(text).trim());
  const uid = () => globalThis.crypto?.randomUUID?.() || `record-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const num = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
  const aliasMap = Object.fromEntries(Object.keys(SOURCES).map(source => [source, new Map()]));
  FIELDS.forEach(field => field.aliases.forEach(alias => aliasMap[field.source].set(cleanLabel(alias), field)));

  function sourceInfo(source) {
    if (!Object.hasOwn(SOURCES, source)) throw new Error('Only SwissADME and ProTox 3.0 results are accepted.');
    return SOURCES[source];
  }
  function validateUrl(source, value) {
    const url = new URL(value || sourceInfo(source).url);
    const hosts = source === 'swissadme' ? ['swissadme.ch', 'www.swissadme.ch'] : ['tox.charite.de', 'tox-new.charite.de', 'comptox.charite.de'];
    if (url.protocol !== 'https:' || !hosts.includes(url.hostname) || url.username || url.password) throw new Error('Use an HTTPS source URL on the selected provider’s official website.');
    return url.href;
  }
  function createProfile(identity = {}) {
    return { schemaVersion: 1, id: uid(), identity: {
      label: String(identity.label || '').trim(), cid: String(identity.cid || '').trim(), smiles: String(identity.smiles || '').trim()
    }, values: {}, imports: [] };
  }
  function fieldDefinition(key, entry) {
    if (fieldByKey[key]) return fieldByKey[key];
    if (key.startsWith('swiss_extra:')) return { key, label: entry?.label || key.slice(12), source: 'swissadme', type: 'text', unit: '' };
    if (key.startsWith('protox_model:')) return { key, label: entry?.label || key.slice(13), source: 'protox', type: 'activity', unit: '' };
    if (key.startsWith('protox_target:')) return { key, label: entry?.label || key.slice(14), source: 'protox', type: 'binding', unit: '' };
    return null;
  }
  function validateValue(field, original) {
    let value = String(original).trim().replace(/\u2212/g, '-');
    if (missing(value)) return null;
    if (field.type === 'text') return value;
    if (field.type === 'activity') {
      if (/^(?:active|1)$/i.test(value)) return 'Active';
      if (/^(?:inactive|0)$/i.test(value)) return 'Inactive';
      throw new Error(`${field.label}: expected Active/Inactive or the provider’s 1/0, not “${value}”.`);
    }
    if (field.type === 'yesno' || field.type === 'rule') {
      if (!(field.type === 'rule' ? /^(?:Yes|No)(?:\s*;.*)?$/i : /^(?:Yes|No)$/i).test(value)) throw new Error(`${field.label}: unrecognized source value “${value}”.`);
      return value.replace(/^(yes|no)/i, word => word[0].toUpperCase() + word.slice(1).toLowerCase());
    }
    if (field.type === 'gi') {
      if (!/^(?:High|Low)$/i.test(value)) throw new Error('GI absorption must be High or Low as reported by SwissADME.');
      return value[0].toUpperCase() + value.slice(1).toLowerCase();
    }
    const units = { 'g/mol': /\s*g\s*\/\s*mol$/i, 'mg/kg': /\s*mg\s*\/\s*kg$/i, 'Å²': /\s*(?:Å|A|Å)(?:²|2|\^2)$/i, 'cm/s': /\s*cm\s*\/\s*s$/i, '%': /\s*%$/ };
    if (units[field.unit]) value = value.replace(units[field.unit], '').trim();
    if (!num.test(value) || !Number.isFinite(Number(value))) throw new Error(`${field.label}: invalid number or incompatible unit “${original}”.`);
    const n = Number(value);
    if (['integer', 'class', 'binding'].includes(field.type) && (!Number.isInteger(n) || n < 0)) throw new Error(`${field.label}: expected a non-negative integer.`);
    if (field.type === 'class' && (n < 1 || n > 6)) throw new Error('ProTox toxicity class must be 1–6.');
    if (field.type === 'binding' && n > 3) throw new Error('ProTox binding class must be 0–3.');
    if (field.type === 'fraction' && (n < 0 || n > 1)) throw new Error(`${field.label}: expected a value between 0 and 1.`);
    if (field.type === 'percent' && (n < 0 || n > 100)) throw new Error(`${field.label}: expected a percentage between 0 and 100.`);
    if (field.type === 'accessibility' && (n < 1 || n > 10)) throw new Error('Synthetic accessibility must be between 1 and 10.');
    if (['mw', 'ld50'].includes(field.key) && n <= 0) throw new Error(`${field.label} must be positive.`);
    return value; // Preserve reported precision; zero is a real value, not a missing value.
  }
  function snapshot(source, raw, options) {
    if (options.method && !['paste', 'file', 'api'].includes(options.method)) throw new Error('Invalid source import method.');
    if (source === 'swissadme' && options.method === 'api') throw new Error('SwissADME automated access is not supported. Import its actual exported results.');
    return { id: uid(), source, version: SOURCES[source].version, method: options.method || 'paste',
      importedAt: options.importedAt || new Date().toISOString(), sourceUrl: validateUrl(source, options.sourceUrl),
      filename: options.filename || '', jobId: options.jobId || '', inputSmiles: options.inputSmiles || '', raw,
      identityConfirmed: options.identityConfirmed === true };
  }
  function put(profile, field, rawValue, evidence, provenance, probability) {
    if (field.source !== provenance.source) throw new Error('A provider cannot supply another provider’s fields.');
    const value = validateValue(field, rawValue);
    if (value === null) return;
    if (profile.values[field.key] && (profile.values[field.key].value !== value || JSON.stringify(profile.values[field.key].probability) !== JSON.stringify(probability))) throw new Error(`Conflicting ${field.label} values/confidence in one source result. Import one result per compound.`);
    profile.values[field.key] = { value, label: field.label, unit: field.unit, source: provenance.source,
      importId: provenance.id, evidence: String(evidence), ...(probability ? { probability } : {}) };
  }

  // RFC-4180 style quoted cells, including tabs/semicolons and quoted newlines.
  function readDelimited(raw) {
    const text = String(raw).replace(/^\uFEFF/, '');
    const firstLine = text.split(/\r?\n/, 1)[0];
    let quoted = false;
    const counts = { ',': 0, '\t': 0, ';': 0 };
    for (let i = 0; i < firstLine.length; i++) {
      if (firstLine[i] === '"') { if (quoted && firstLine[i + 1] === '"') i++; else quoted = !quoted; }
      else if (!quoted && Object.hasOwn(counts, firstLine[i])) counts[firstLine[i]]++;
    }
    const delimiter = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    if (!counts[delimiter]) return null;
    const rows = [], rawRows = [];
    let row = [], cell = '', inQuote = false, start = 0;
    for (let i = 0; i <= text.length; i++) {
      const ch = text[i];
      if (ch === '"') {
        if (inQuote && text[i + 1] === '"') { cell += '"'; i++; }
        else if (!inQuote && cell !== '') throw new Error('Malformed quoted CSV cell. Use the original provider export.');
        else inQuote = !inQuote;
      } else if (!inQuote && (ch === delimiter || ch === '\n' || ch === '\r' || ch === undefined)) {
        row.push(cell); cell = '';
        if (ch !== delimiter) {
          if (row.some(value => value.trim() !== '')) { rows.push(row); rawRows.push(text.slice(start, i)); }
          row = [];
          if (ch === '\r' && text[i + 1] === '\n') i++;
          start = i + 1;
        }
      } else if (ch !== undefined) cell += ch;
    }
    if (inQuote) throw new Error('Unclosed CSV quotation. Import the complete source file.');
    return { rows, rawRows, delimiter };
  }

  function identityHeader(label) {
    return { smiles: 'smiles', canonicalsmiles: 'smiles', cid: 'cid', pubchemcid: 'cid', name: 'label', moleculename: 'label', molecule: 'label' }[cleanLabel(label)];
  }
  function readSwissTable(table, options) {
    const headers = table.rows[0];
    const fields = headers.map(label => aliasMap.swissadme.get(cleanLabel(label)));
    if (!headers.some(label => identityHeader(label) === 'smiles') || !fields.some(f => f && ['logp', 'logs', 'gi', 'lipinski', 'viol', 'sa', 'bioavail'].includes(f.key))) {
      throw new Error('This is not a recognizable SwissADME export. Include its SMILES and SwissADME-specific columns.');
    }
    const records = table.rows.slice(1).map((cells, index) => {
      const profile = createProfile();
      const source = snapshot('swissadme', table.rawRows[0] + '\n' + table.rawRows[index + 1], options);
      source.rowNumber = index + 2;
      profile.imports.push(source);
      headers.forEach((label, i) => {
        const identity = identityHeader(label);
        if (identity) profile.identity[identity] = cells[i].trim();
        else if (!missing(cells[i])) {
          const field = fields[i] || { key: 'swiss_extra:' + cleanLabel(label), label, source: 'swissadme', type: 'text', unit: '' };
          put(profile, field, cells[i], `${label}: ${cells[i]}`, source);
        }
      });
      return profile;
    });
    return records;
  }
  function readProtoxTable(table, options) {
    const header = table.rows[0].map(cleanLabel);
    const at = name => header.indexOf(name);
    if (at('target') < 0 || at('prediction') < 0) throw new Error('Use the ProTox API CSV/TSV with Target and Prediction columns, or paste the result panel.');
    const records = new Map();
    for (let i = 1; i < table.rows.length; i++) {
      const cells = table.rows[i];
      const input = at('input') >= 0 ? cells[at('input')].trim() : (options.inputSmiles || '');
      const group = input || 'single-result';
      if (!records.has(group)) {
        const profile = createProfile({ smiles: options.inputSmiles || (at('input') >= 0 && options.inputType === 'smiles' ? input : ''), label: options.inputType === 'name' ? input : '' });
        if (options.inputSmiles && input && input !== options.inputSmiles) throw new Error('ProTox response input does not match the submitted SMILES.');
        const source = snapshot('protox', table.rawRows[0], options);
        profile.imports.push(source);
        records.set(group, profile);
      }
      const profile = records.get(group), provenance = profile.imports[0];
      provenance.raw += '\n' + table.rawRows[i];
      const target = cells[at('target')].trim();
      const type = at('type') >= 0 ? cleanLabel(cells[at('type')]) : cleanLabel(options.resultType || '');
      const targetKey = cleanLabel(target);
      let field = aliasMap.protox.get(targetKey);
      const isTarget = type === 'toxicitytarget';
      if (type && !['acutetoxicity', 'toxicitymodel', 'toxicitytarget'].includes(type)) throw new Error(`Unknown ProTox result type: ${type}.`);
      if (field && type && !isTarget && ((['ld50', 'ghs', 'accuracy', 'similarity'].includes(field.key) && type !== 'acutetoxicity') || (field.type === 'activity' && type !== 'toxicitymodel'))) throw new Error('ProTox target and result type disagree. No value was reassigned to a different model.');
      if (isTarget) field = { key: 'protox_target:' + targetKey, label: `Toxicity target: ${target}`, source: 'protox', type: 'binding', unit: '' };
      if (!field) {
        if (!target || (type && type !== 'toxicitymodel')) throw new Error(`Unrecognized ProTox result type/target: ${type} / ${target}.`);
        field = { key: 'protox_model:' + targetKey, label: `ProTox model: ${target}`, source: 'protox', type: 'activity', unit: '' };
      }
      let probability;
      if (at('probability') >= 0 && !missing(cells[at('probability')])) {
        const acute = ['ld50', 'ghs'].includes(field.key);
        const value = validateValue({ key: 'probability', label: 'ProTox probability', type: acute ? 'percent' : 'fraction', unit: '' }, cells[at('probability')]);
        probability = { value, meaning: acute ? 'Average similarity (%)' : isTarget ? 'Average pharmacophore fit (0–1)' : 'Model confidence (0–1)' };
      }
      put(profile, field, cells[at('prediction')], table.rawRows[i], provenance, probability);
    }
    return [...records.values()];
  }

  function readText(source, text, options) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean);
    const smilesLines = lines.map((line, i) => /^(?:Canonical )?SMILES(?:\s|:|$)/i.test(line) ? i : -1).filter(i => i >= 0);
    if (smilesLines.length > 1) {
      const records = [];
      for (let i = 0; i < smilesLines.length; i++) {
        records.push(...readText(source, lines.slice(smilesLines[i], smilesLines[i + 1] || lines.length).join('\n'), options));
      }
      return records;
    }
    const profile = createProfile({ smiles: options.inputSmiles || '' });
    const provenance = snapshot(source, text, options);
    profile.imports.push(provenance);
    const aliases = FIELDS.filter(field => field.source === source).flatMap(field => field.aliases.map(alias => ({ field, alias }))).sort((a, b) => b.alias.length - a.alias.length);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const identity = line.match(/^(SMILES|Canonical SMILES|PubChem CID|CID|Name|Molecule name)(?:(?:\s*:\s*|\s+)(.*)|$)/i);
      if (identity) {
        const key = identityHeader(identity[1]);
        const value = identity[2]?.trim() || lines[++i] || '';
        if (key === 'smiles' && profile.identity.smiles && value !== profile.identity.smiles) throw new Error('Source structure does not match the submitted SMILES.');
        profile.identity[key] = value;
        continue;
      }
      for (const { field, alias } of aliases) {
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
        const match = line.match(new RegExp('^' + escaped + '(?:\\s*[:=]\\s*|\\s+|$)(.*)$', 'i'));
        if (!match) continue;
        let value = match[1].trim();
        let evidence = line;
        if (!value && lines[i + 1]) { value = lines[++i]; evidence += '\n' + value; }
        let probability;
        if (field.type === 'activity') {
          const model = value.match(/^(?:[A-Za-z0-9_-]+\s+)?(Inactive|Active)(?:\s+([\d.]+))?$/i);
          if (model) {
            value = model[1];
            let confidence = model[2];
            if (confidence === undefined && lines[i + 1] && num.test(lines[i + 1])) {
              confidence = lines[++i];
              evidence += '\n' + confidence;
            }
            if (confidence !== undefined) probability = { value: validateValue({ type: 'fraction', label: 'ProTox confidence', unit: '' }, confidence), meaning: 'Model confidence (0–1)' };
          }
        }
        put(profile, field, value, evidence, provenance, probability);
        if (field.key === 'lipinski') {
          const count = value.match(/;\s*(\d+)\s*violations?\b/i);
          if (count) put(profile, fieldByKey.viol, count[1], evidence, provenance);
        }
        break;
      }
    }
    return [profile];
  }

  function parse(source, raw, options = {}) {
    sourceInfo(source);
    if (!raw || !String(raw).trim()) throw new Error('Paste or upload the provider’s actual result first.');
    if (String(raw).length > 2 * 1024 * 1024) throw new Error('Source file exceeds 2 MB. Split it into smaller exports.');
    if (/\bpkcsm\b/i.test(raw)) throw new Error('This output references a different provider. Only SwissADME and ProTox 3.0 data are permitted.');
    if (/\b(?:invalid (?:input )?smiles|calculation (?:failed|error)|unable to calculate|prediction failed)\b/i.test(raw)) throw new Error('The source reports a failed/invalid calculation. Its values were not imported.');
    if (/^\s*<(?:!doctype|html)/i.test(raw)) throw new Error('Import the exported CSV/TSV or copied result text, not an HTML page.');
    const text = String(raw).replace(/^\uFEFF/, '');
    const table = options.format === 'text' ? null : readDelimited(text);
    const isTable = table && (source === 'swissadme'
      ? table.rows[0].some(header => identityHeader(header) === 'smiles') && table.rows[0].some(header => aliasMap.swissadme.has(cleanLabel(header)))
      : table.rows[0].some(header => cleanLabel(header) === 'prediction'));
    if (isTable && table.rows.some(row => row.length !== table.rows[0].length)) throw new Error('CSV columns are inconsistent. Use the unmodified provider export.');
    if (isTable && new Set(table.rows[0].map(cleanLabel)).size !== table.rows[0].length) throw new Error('Duplicate source columns are ambiguous. Use the unmodified provider export.');
    const records = isTable ? (source === 'swissadme' ? readSwissTable(table, options) : readProtoxTable(table, options)) : readText(source, text, options);
    if (!records.length || records.some(record => !Object.keys(record.values).length)) throw new Error('No supported provider results were found. Nothing was added or estimated.');
    if (records.length > 500) throw new Error('Import at most 500 profiles at once.');
    if (!records.every(isProfile)) throw new Error('Invalid source metadata or compound identifier. Use the original provider export, retaining its exact SMILES/CID.');
    return records;
  }

  function assertIdentity(existing, incoming) {
    for (const key of ['smiles', 'cid']) {
      if (existing.identity[key] && incoming.identity[key] && existing.identity[key] !== incoming.identity[key]) throw new Error(`Compound ${key.toUpperCase()} mismatch. Results were not merged. Use the same exact structure, including stereochemistry and charge.`);
    }
  }
  function merge(existing, incoming, { confirmed = false, replace = false } = {}) {
    if (!isProfile(existing) || !isProfile(incoming)) throw new Error('An invalid or unsourced profile cannot be merged.');
    assertIdentity(existing, incoming);
    const exact = (existing.identity.smiles && existing.identity.smiles === incoming.identity.smiles) || (existing.identity.cid && existing.identity.cid === incoming.identity.cid);
    if (!exact && !confirmed) throw new Error('Confirm that this result belongs to the selected compound; names alone are not an identity match.');
    const sources = new Set(Object.values(incoming.values).map(entry => entry.source));
    if (!replace && Object.values(existing.values).some(entry => sources.has(entry.source))) throw new Error('This compound already has results from that provider. Review and explicitly allow replacement first.');
    const values = { ...existing.values };
    if (replace) for (const [key, entry] of Object.entries(values)) if (sources.has(entry.source)) delete values[key];
    return { ...existing, identity: {
      label: existing.identity.label || incoming.identity.label,
      cid: existing.identity.cid || incoming.identity.cid,
      smiles: existing.identity.smiles || incoming.identity.smiles
    }, values: { ...values, ...incoming.values }, imports: [...existing.imports, ...incoming.imports] };
  }
  function mergeBatch(existing, incoming, { replace = false } = {}) {
    const next = [...existing];
    for (const record of incoming) {
      if (!record.identity.smiles && !record.identity.cid) throw new Error('A batch source record lacks SMILES/CID. Names and row order are not identity matches.');
      const matches = next.filter(candidate =>
        (record.identity.smiles && record.identity.smiles === candidate.identity.smiles) ||
        (record.identity.cid && record.identity.cid === candidate.identity.cid));
      if (matches.length > 1) throw new Error('Multiple dataset records match this source identity. Select the exact target for a single-compound import or remove duplicates first.');
      if (matches.length === 1) next[next.indexOf(matches[0])] = merge(matches[0], record, { replace });
      else next.push(record);
    }
    if (next.length > 500) throw new Error('The merged dataset exceeds 500 compounds. No partial batch was imported.');
    return next;
  }
  function isProfile(profile) {
    try {
      if (!profile || profile.schemaVersion !== 1 || typeof profile.id !== 'string' || !profile.id || !profile.identity || !profile.values || Array.isArray(profile.values) || !Array.isArray(profile.imports)) return false;
      if (!['label', 'cid', 'smiles'].every(key => typeof profile.identity[key] === 'string')) return false;
      if (profile.identity.cid && !/^[1-9]\d*$/.test(profile.identity.cid)) return false;
      if (profile.identity.smiles && (/\s|[<>]/.test(profile.identity.smiles) || profile.identity.smiles.length > 4000)) return false;
      if (new Set(profile.imports.map(entry => entry.id)).size !== profile.imports.length) return false;
      for (const entry of profile.imports) {
        sourceInfo(entry.source);
        validateUrl(entry.source, entry.sourceUrl);
        if (!entry.id || typeof entry.raw !== 'string' || !entry.raw || typeof entry.importedAt !== 'string' || !Number.isFinite(Date.parse(entry.importedAt)) || !['paste', 'file', 'api'].includes(entry.method)) return false;
        if (entry.method === 'api' && (entry.source !== 'protox' || !entry.inputSmiles || !/^[A-Za-z0-9_-]{1,100}$/.test(entry.jobId || ''))) return false;
      }
      for (const [key, entry] of Object.entries(profile.values)) {
        const field = fieldDefinition(key, entry);
        const origin = profile.imports.find(item => item.id === entry.importId);
        if (!field || field.source !== entry.source || !origin || origin.source !== entry.source || typeof entry.evidence !== 'string' || !entry.evidence || typeof entry.value !== 'string') return false;
        if (entry.label !== field.label || entry.unit !== field.unit || validateValue(field, entry.value) !== entry.value) return false;
        if (entry.probability) {
          const acute = ['ld50', 'ghs'].includes(field.key);
          const meaning = acute ? 'Average similarity (%)' : field.type === 'binding' ? 'Average pharmacophore fit (0–1)' : 'Model confidence (0–1)';
          if (entry.source !== 'protox' || entry.probability.meaning !== meaning || validateValue({ type: acute ? 'percent' : 'fraction', label: 'ProTox probability', unit: '' }, entry.probability.value) !== entry.probability.value) return false;
        }
      }
      return true;
    } catch { return false; }
  }
  function loadStored(raw) {
    try {
      const data = JSON.parse(raw || '[]');
      if (!Array.isArray(data)) return { profiles: [], excluded: 1 };
      const profiles = data.filter(isProfile);
      return { profiles, excluded: data.length - profiles.length };
    } catch { return { profiles: [], excluded: 1 }; }
  }
  function status(profile, source) {
    const count = Object.values(profile.values).filter(value => value.source === source).length;
    return count ? `${count} reported values` : 'Not available — awaiting provider results';
  }
  function entries(profile, includeMissing = false) {
    if (!isProfile(profile)) throw new Error('Cannot display or export an invalid/unsourced profile.');
    const result = [];
    for (const field of FIELDS) {
      if (profile.values[field.key]) result.push({ ...field, ...profile.values[field.key] });
      else if (includeMissing) result.push({ ...field, value: 'Not available', missing: true });
    }
    for (const [key, entry] of Object.entries(profile.values)) if (!fieldByKey[key]) result.push({ ...fieldDefinition(key, entry), ...entry });
    return result;
  }
  function exportRows(profiles) {
    return profiles.flatMap(profile => entries(profile, true).map(entry => {
      const origin = profile.imports.find(item => item.id === entry.importId);
      return {
        Compound: profile.identity.label || profile.identity.cid || profile.identity.smiles,
        CID: profile.identity.cid, SMILES: profile.identity.smiles,
        Property: entry.label, Value: entry.value, Unit: entry.unit,
        Provider: SOURCES[entry.source].name, Status: entry.missing ? 'Not available' : 'Reported prediction/descriptor',
        'Provenance method': origin?.method === 'api' ? 'API response' : origin ? 'User-supplied source output (not independently authenticated)' : '',
        'Confidence / metric': entry.probability?.value ?? '', 'Metric meaning': entry.probability?.meaning || '',
        'Source URL': origin?.sourceUrl || '', 'Imported at': origin?.importedAt || '',
        'Source import ID': origin?.id || '', 'Source evidence': entry.evidence || ''
      };
    }));
  }
  function swissBatches(profiles) {
    const lines = profiles.filter(profile => profile.identity.smiles).map(profile => `${profile.identity.smiles} ${String(profile.identity.label || profile.identity.cid || profile.id).replace(/\s+/g, '_')}`);
    const batches = [];
    for (let i = 0; i < lines.length; i += 200) batches.push(lines.slice(i, i + 200).join('\n'));
    return batches;
  }
  return { STORAGE_KEY, SOURCES, FIELDS, PROTOX_MODELS, createProfile, parse, merge, mergeBatch, isProfile, loadStored, status, entries, exportRows, swissBatches, readDelimited, validateValue, validateUrl };
});
