const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const S = require('../assets/admet-sources.js');

// Parser fixtures only. These deliberately chosen values are NOT scientific predictions.
const swiss = 'Molecule,Canonical SMILES,MW,#Heavy atoms,#Aromatic heavy atoms,Fraction Csp3,XLOGP3,WLOGP,Consensus Log P,ESOL Log S,Ali Log S,GI absorption,BBB permeant,Lipinski #violations,Synthetic Accessibility,ESOL Class\r\n"Fixture, not real output",C[C@H](O)C(=O)O,90.080,6,0,0.67,0.40,0.50,0.00,-0.00,-0.30,High,No,0,1.00,Very soluble\r\n';
const protox = 'input\ttype\tTarget\tPrediction\tProbability\nC[C@H](O)C(=O)O\tacute toxicity\tLD50\t7000\t88.40\nC[C@H](O)C(=O)O\tacute toxicity\ttox_class\t6\t88.40\nC[C@H](O)C(=O)O\ttoxicity model\tdili\t0\t0.00\nC[C@H](O)C(=O)O\ttoxicity model\tbbb\t1\t0.73\nC[C@H](O)C(=O)O\ttoxicity model\tCYP1A2\t0\t0.97\nC[C@H](O)C(=O)O\ttoxicity target\tTarget fixture\t3\t0.60';
const opts = { importedAt: '2026-11-27T00:00:00.000Z', method: 'file', inputType: 'smiles', filename: 'test-only.csv' };
const sw = () => S.parse('swissadme', swiss, opts)[0];
const pt = () => S.parse('protox', protox, opts)[0];

test('identity alone never creates ADMET predictions, zeros, compliance or toxicity', () => {
  const p = S.createProfile({ cid: '2244', smiles: 'CC(=O)Oc1ccccc1C(=O)O' });
  assert.deepEqual(p.values, {});
  assert.deepEqual(p.imports, []);
  assert(S.isProfile(p));
  assert.match(S.status(p, 'protox'), /Not available/);
  assert(S.exportRows([p]).every(row => row.Value === 'Not available' && !row['Source URL']));
});

test('SwissADME CSV preserves precision, zeroes, model separation, raw evidence and identity', () => {
  const p = sw();
  assert.equal(p.identity.smiles, 'C[C@H](O)C(=O)O');
  assert.equal(p.identity.label, 'Fixture, not real output');
  for (const [key, value] of Object.entries({ mw: '90.080', logp: '0.00', xlogp3: '0.40', wlogp: '0.50', logs: '-0.00', aliLogs: '-0.30', viol: '0', sa: '1.00' })) assert.equal(p.values[key].value, value);
  assert.equal(p.values.lipinski, undefined, 'do not derive compliance from a violation count');
  assert.equal(p.values.ld50, undefined);
  assert.equal(p.values['swiss_extra:esolclass'].value, 'Very soluble');
  assert.equal(p.imports[0].importedAt, opts.importedAt);
  assert.match(p.imports[0].raw, /90\.080/);
  assert.equal(p.values.mw.evidence, 'MW: 90.080');
  assert(S.isProfile(p));
});

test('XLOGP3 never fills Consensus LogP and a missing Lipinski count never becomes zero', () => {
  const p = S.parse('swissadme', 'SMILES CCO\nLog Po/w (XLOGP3) 0.50\nGI absorption High')[0];
  assert.equal(p.values.xlogp3.value, '0.50');
  assert.equal(p.values.logp, undefined);
  assert.equal(p.values.viol, undefined);
  assert.equal(p.values.hepato, undefined);
});

test('Swiss copied text supports tabs, split lines, units and explicitly reported violations', () => {
  const p = S.parse('swissadme', 'SMILES\tCCO\nMolecular weight\t46.070 g/mol\nTPSA\n20.23 Å²\nLipinski\tYes; 0 violations\nConsensus Log Po/w\t0.00')[0];
  assert.equal(p.values.mw.value, '46.070');
  assert.equal(p.values.tpsa.value, '20.23');
  assert.equal(p.values.viol.value, '0');
  assert.equal(p.values.lipinski.value, 'Yes; 0 violations');
  assert.equal(p.values.logp.value, '0.00');
  assert(S.isProfile(p));
});

test('ProTox API export preserves toxicity class VI and the three probability meanings', () => {
  const p = pt();
  assert.equal(p.values.ghs.value, '6');
  assert.equal(p.values.ld50.unit, 'mg/kg');
  assert.deepEqual(p.values.ld50.probability, { value: '88.40', meaning: 'Average similarity (%)' });
  assert.equal(p.values.accuracy, undefined, 'similarity is not prediction accuracy');
  assert.equal(p.values.hepato.value, 'Inactive');
  assert.deepEqual(p.values.hepato.probability, { value: '0.00', meaning: 'Model confidence (0–1)' });
  assert.equal(p.values['protox_target:targetfixture'].value, '3');
  assert.deepEqual(p.values['protox_target:targetfixture'].probability, { value: '0.60', meaning: 'Average pharmacophore fit (0–1)' });
  assert(S.isProfile(p));
});

test('ProTox BBB and CYP activity are not SwissADME BBB permeability/CYP inhibition', () => {
  const p = S.merge(sw(), pt());
  assert.equal(p.values.bbb.value, 'No');
  assert.equal(p.values.bbb.source, 'swissadme');
  assert.equal(p.values['protox_model:bbb'].value, 'Active');
  assert.equal(p.values.cyp1a2, undefined);
  assert.equal(p.values['protox_model:cyp1a2'].value, 'Inactive');
  assert.equal(p.imports.length, 2);
});

test('ProTox page text retains separate reported accuracy and endpoint confidence', () => {
  const p = S.parse('protox', 'Predicted LD50: 7000 mg/kg\nPredicted Toxicity Class: 6\nPrediction accuracy: 77.50%\nAverage similarity: 88.40%\nHepatotoxicity\nInactive\n0.91\nCarcinogenicity Active 0.70')[0];
  assert.equal(p.values.accuracy.value, '77.50');
  assert.equal(p.values.similarity.value, '88.40');
  assert.equal(p.values.hepato.probability.value, '0.91');
  assert.equal(p.values.carcino.probability.value, '0.70');
  assert.equal(p.identity.smiles, '');
  assert.equal(p.values.mw, undefined);
});

test('raw API parts bind to request SMILES and retain provider URL, job id and raw bytes', () => {
  const raw = '\tTarget\tPrediction\tProbability\n0\tCYP2E1\t1\t0.80\n';
  const p = S.parse('protox', raw, { method: 'api', resultType: 'toxicity model', inputSmiles: 'CCO', sourceUrl: 'https://tox.charite.de/protox3/csv/abc_result.csv', jobId: 'abc' })[0];
  assert.equal(p.identity.smiles, 'CCO');
  assert.equal(p.imports[0].jobId, 'abc');
  assert.equal(p.imports[0].sourceUrl, 'https://tox.charite.de/protox3/csv/abc_result.csv');
  assert.equal(p.values['protox_model:cyp2e1'].probability.value, '0.80');
  assert.throws(() => S.parse('protox', protox, { inputSmiles: 'CCO' }), /does not match/);
});

test('ProTox multi-compound rows are grouped by exact input, not response order', () => {
  const raw = 'input,type,Target,Prediction,Probability\nCCO,toxicity model,dili,0,0.8\nCCN,toxicity model,dili,1,0.9\nCCO,acute toxicity,LD50,1000,80';
  const records = S.parse('protox', raw, opts);
  assert.equal(records.length, 2);
  assert.equal(records[0].identity.smiles, 'CCO');
  assert.equal(records[0].values.ld50.value, '1000');
  assert.equal(records[1].identity.smiles, 'CCN');
  assert.equal(records[1].values.ld50, undefined);
});

test('compound matching rejects stereoisomers, salts, different CIDs and canonical spelling differences', () => {
  const source = sw();
  for (const smiles of ['C[C@@H](O)C(=O)O', 'C[C@H](O)C(=O)[O-].[Na+]', 'OC(=O)[C@@H](O)C']) {
    assert.throws(() => S.merge(S.createProfile({ smiles }), source, { confirmed: true }), /mismatch/);
  }
  const a = S.createProfile({ cid: '1' }); const b = S.createProfile({ cid: '2' });
  assert.throws(() => S.merge(a, b, { confirmed: true }), /mismatch/);
});

test('names never silently merge; explicit user confirmation is required without structural evidence', () => {
  const a = S.createProfile({ smiles: 'CCO', label: 'Fixture' });
  const b = S.parse('protox', 'Name: Fixture\nPredicted LD50: 1000 mg/kg')[0];
  assert.equal(b.identity.smiles, '');
  assert.throws(() => S.merge(a, b), /Confirm/);
  const merged = S.merge(a, b, { confirmed: true });
  assert.equal(merged.identity.smiles, 'CCO');
  assert.equal(merged.values.ld50.value, '1000');
});

test('same-provider replacement is explicit and removes stale missing fields, while retaining evidence', () => {
  const original = S.merge(sw(), pt());
  const updated = S.parse('protox', 'SMILES C[C@H](O)C(=O)O\nPredicted LD50: 6000 mg/kg')[0];
  assert.throws(() => S.merge(original, updated), /already has/);
  const next = S.merge(original, updated, { replace: true });
  assert.equal(next.values.ld50.value, '6000');
  assert.equal(next.values.ghs, undefined);
  assert.equal(next.values.hepato, undefined);
  assert.equal(next.values.logp.value, '0.00');
  assert.equal(next.imports.length, 3);
});

test('invalid units, ranges, enums and source URLs fail closed instead of extracting partial numbers', () => {
  for (const text of ['Predicted LD50: 1 g/kg', 'Predicted LD50: approximately 100', 'Predicted LD50: 0 mg/kg', 'Predicted Toxicity Class: 7', 'Hepatotoxicity: safe', 'Hepatotoxicity: Active 1.3']) {
    assert.throws(() => S.parse('protox', text));
  }
  assert.throws(() => S.parse('swissadme', 'Molecular weight: 46.07 kDa'));
  for (const url of ['https://evil.example/', 'http://www.swissadme.ch/', 'https://user:password@www.swissadme.ch/', 'javascript:alert(1)']) assert.throws(() => S.parse('swissadme', swiss, { sourceUrl: url }));
  assert.throws(() => S.parse('protox', protox.replace('0.73', '73')), /between 0 and 1/);
});

test('empty, conflicting, malformed, failed and other-provider outputs cannot produce a profile', () => {
  for (const text of ['', 'No results yet', 'pkCSM\nLD50: 100', 'Calculation failed\nLD50: 100', '<html>LD50: 100</html>', 'LD50: 100\nLD50: 200']) assert.throws(() => S.parse('protox', text));
  assert.throws(() => S.parse('swissadme', 'SMILES,GI absorption\nCCO,High,unexpected'), /columns are inconsistent/);
  assert.throws(() => S.parse('swissadme', 'SMILES,GI absorption,GI absorption\nCCO,High,Low'), /Duplicate/);
  assert.throws(() => S.parse('swissadme', 'SMILES,GI absorption\n"CCO,High'), /quotation/);
  assert.throws(() => S.parse('other', swiss), /Only SwissADME/);
});

test('quoted CSV cells, semicolon delimiter, BOM and multiple records retain distinct identities', () => {
  const raw = '\ufeffMolecule;SMILES;GI absorption;Consensus Log P\n"Fixture; \'quoted\'";CCO;High;0.00\n"Second \"\"fixture\"\"";CCN;Low;-0.30';
  const records = S.parse('swissadme', raw);
  assert.equal(records.length, 2);
  assert.equal(records[0].identity.label, "Fixture; 'quoted'");
  assert.equal(records[1].identity.label, 'Second "fixture"');
  assert.equal(records[1].values.logp.value, '-0.30');
});

test('legacy, cross-provider, wrongly typed and invalid-evidence saved records are excluded', () => {
  const p = sw();
  const corrupt = structuredClone(p); corrupt.values.mw.source = 'protox';
  const noEvidence = structuredClone(p); noEvidence.imports = [];
  const wrongUnits = structuredClone(p); wrongUnits.values.mw.unit = 'kg';
  const wrongIdentity = structuredClone(p); wrongIdentity.identity.smiles = 42;
  const wrongConfidence = pt(); wrongConfidence.values.hepato.probability.value = '90';
  const result = S.loadStored(JSON.stringify([p, { cid: '2244', mw: 180.16, hepato: 'Inactive' }, corrupt, noEvidence, wrongUnits, wrongIdentity, wrongConfidence]));
  assert.equal(result.profiles.length, 1);
  assert.equal(result.excluded, 6);
  assert.equal(S.loadStored('{broken').excluded, 1);
});

test('exports distinguish missing values, preserved zero, source method, metrics and evidence', () => {
  const rows = S.exportRows([S.merge(sw(), pt())]);
  const byProperty = label => rows.find(row => row.Property === label);
  assert.equal(byProperty('Consensus LogP').Value, '0.00');
  assert.equal(byProperty('Lipinski violations').Value, '0');
  assert.equal(byProperty('Lipinski').Value, 'Not available');
  assert.equal(byProperty('Hepatotoxicity')['Confidence / metric'], '0.00');
  assert.match(byProperty('Hepatotoxicity')['Provenance method'], /not independently authenticated/);
  assert.match(byProperty('Predicted LD50')['Metric meaning'], /similarity/);
  assert.equal(byProperty('Predicted LD50')['Imported at'], opts.importedAt);
  assert.match(byProperty('Predicted LD50')['Source evidence'], /7000/);
});

test('500 identity records prepare 200/200/100 sequential SwissADME batches, never requests', () => {
  const profiles = Array.from({ length: 500 }, (_, i) => S.createProfile({ label: `Compound ${i}`, smiles: 'C[C@H](O)C(=O)O' }));
  const batches = S.swissBatches(profiles);
  assert.deepEqual(batches.map(batch => batch.split('\n').length), [200, 200, 100]);
  assert(batches[0].startsWith('C[C@H](O)C(=O)O Compound_0'));
  assert.deepEqual(S.swissBatches([S.createProfile({ cid: '1' })]), []);
});

test('batch merges use exact identities, not row order, and reject ambiguous/oversized updates atomically', () => {
  const inputs = [S.createProfile({ smiles: 'CCO' }), S.createProfile({ smiles: 'CCN' })];
  const incoming = S.parse('swissadme', 'SMILES,GI absorption,Consensus Log P\nCCN,Low,0.00\nCCO,High,0.10');
  const result = S.mergeBatch(inputs, incoming);
  assert.equal(result.length, 2);
  assert.equal(result[0].identity.smiles, 'CCO');
  assert.equal(result[0].values.logp.value, '0.10');
  assert.equal(result[1].values.logp.value, '0.00');
  assert.deepEqual(inputs[0].values, {}, 'original array is not partially modified');
  assert.throws(() => S.mergeBatch([...inputs, S.createProfile({ smiles: 'CCN' })], incoming), /Multiple dataset records/);
  assert.throws(() => S.mergeBatch(Array.from({ length: 500 }, (_, i) => S.createProfile({ smiles: `[${i + 1}CH4]` })), incoming), /exceeds 500/);
});

test('split-line identities, model type conflicts and confidence conflicts cannot be silently misread', () => {
  const p = S.parse('swissadme', 'SMILES\nC[C@H](O)C(=O)O\nGI absorption\nHigh')[0];
  assert.equal(p.identity.smiles, 'C[C@H](O)C(=O)O');
  assert.throws(() => S.parse('protox', 'type,Target,Prediction,Probability\ntoxicity model,LD50,1000,0.9'), /type disagree/);
  assert.throws(() => S.parse('protox', 'type,Target,Prediction,Probability\ntoxicity model,dili,0,0.9\ntoxicity model,dili,0,0.8'), /Conflicting/);
  assert.throws(() => S.parse('swissadme', swiss, { method: 'api' }), /automated access is not supported/);
});

test('every requested ProTox model has its own unavailable field before its response arrives', async () => {
  const client = require('../assets/protox-client.js');
  const server = await import('../server/protox-handler.mjs');
  assert.equal(client.MODELS, S.PROTOX_MODELS);
  assert.equal(server.MODELS, S.PROTOX_MODELS);
  const rows = S.exportRows([S.createProfile({ smiles: 'CCO' })]);
  for (const code of ['bbb', 'CYP1A2', 'nr_ar_lbd', 'mie_gabar']) assert(rows.some(row => row.Property === `ProTox model: ${code}` && row.Value === 'Not available'));
});

test('neither entry point retains the old ADMET engines, presets, unsupported provider or derived potency', () => {
  for (const file of ['index.html', 'admet.html']) {
    const text = fs.readFileSync(file, 'utf8');
    for (const forbidden of ['computeAdmetClientSide', 'computeAdmetAuto', 'ADMET_PRESETS', 'DEFAULT_BENCHMARK_COMPOUNDS', 'pkCSM', 'Potent for Docking', 'loadSampleAdmetData', 'isSafe']) assert(!text.includes(forbidden), `${file} contains ${forbidden}`);
    assert(text.includes('assets/admet-source-ui.js'));
    assert.equal((text.match(/id="admetSourceApp"/g) || []).length, 1);
  }
  for (const file of ['assets/admet-sources.js', 'assets/admet-source-ui.js', 'assets/protox-client.js']) assert.doesNotThrow(() => new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }));
});
