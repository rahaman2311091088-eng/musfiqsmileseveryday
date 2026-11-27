const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const { execFileSync } = require('node:child_process');

// Deliberately selected parser fixtures, NOT live/experimentally verified predictions.
const smiles = 'C[C@H](O)C(=O)O';
const swiss = `Molecule,Canonical SMILES,MW,XLOGP3,WLOGP,Consensus Log P,GI absorption,BBB permeant,Lipinski #violations\nFixture,${smiles},90.080,0.40,0.50,0.00,High,No,0`;
const protox = `input\ttype\tTarget\tPrediction\tProbability\n${smiles}\tacute toxicity\tLD50\t7000\t88.40\n${smiles}\tacute toxicity\ttox_class\t6\t88.40\n${smiles}\ttoxicity model\tdili\t0\t0.00\n${smiles}\ttoxicity model\tbbb\t1\t0.73`;
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function open(page, { file = 'index.html', legacy = false, api = false, onApi, onLookup, history = [] } = {}) {
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ legacy, history }) => {
    if (legacy) localStorage.setItem('ddu_admet_compounds', JSON.stringify([{ cid: '2244', mw: 180.16, hepato: 'Inactive', name: 'Old invented preset' }]));
    window.__historyRows = history;
    window.__historySaved = [];
    window.supabase = { createClient: () => ({
      auth: {
        onAuthStateChange() {},
        getSession: async () => {
          if (document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
          return { data: { session: { access_token: 'fixture-jwt', user: { id: 'fixture-user', email: 'admet-test@example.test' } } } };
        },
        signOut: async () => ({})
      },
      from: () => {
        const state = {};
        const chain = {
          select: fields => { state.fields = fields; return chain; },
          eq: (key, value) => { state[key] = value; return chain; },
          order: () => chain, limit: () => chain, delete: () => chain,
          single: async () => ({ data: window.__historyRows.find(row => row.id === state.id), error: null }),
          insert: async row => { window.__historySaved.push(row); return { error: null }; },
          then: resolve => resolve({ data: window.__historyRows, error: null })
        };
        return chain;
      }
    }) };
  }, { legacy, history });
  await page.route('https://**/*', async route => {
    external.push(route.request().url());
    if (/\/rest\/pug\/|\/entrez\/eutils\//.test(route.request().url())) {
      if (onLookup) return onLookup(route);
      return json(route, { PropertyTable: { Properties: [{ CID: 2244, Title: 'PubChem identity fixture', SMILES: smiles, MolecularWeight: '999.99', MolecularFormula: 'Fixture' }] } });
    }
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
  await page.route('**/api/protox/**', route => {
    if (route.request().url().endsWith('/status')) return api ? json(route, { available: true, provider: 'ProTox 3.0' }) : route.fulfill({ status: 404, body: 'Not available' });
    return onApi ? onApi(route) : json(route, { error: 'No prediction fixture configured' }, 503);
  });
  await page.goto('/' + file);
  if (file === 'index.html') await page.evaluate(() => { showApp({ id: 'fixture-user', email: 'admet-test@example.test' }); setActivePanel('admetTab'); });
  await expect(page.locator('#admetAddIdentity')).toBeVisible();
  return { errors, external };
}
async function expand(page, id) {
  const panel = page.locator('#' + id);
  if (!await panel.evaluate(el => el.open)) await panel.locator(':scope > summary').click();
}
async function add(page, structure = smiles, label = 'Test compound') {
  await page.locator('#admetIdentityInput').fill(structure);
  await expand(page, 'admetInputOptions');
  await page.locator('#admetIdentityLabel').fill(label);
  await page.locator('#admetAddIdentity').click();
  await expect(page.locator('#admetSourceMessage')).toContainText('Added');
}
async function paste(page, provider, text, { replace = false } = {}) {
  await expand(page, 'admetImportSection');
  await page.locator('#admetImportProvider').selectOption(provider);
  await page.locator('#admetSourceText').fill(text);
  await page.locator('#admetIdentityConfirm').check();
  if (replace) {
    await expand(page, 'admetImportOptions');
    await page.locator('#admetReplaceSource').check();
  }
  await page.locator('#admetImportResults').click();
}
const profiles = page => page.evaluate(() => DduAdmetApp.getProfiles());

for (const file of ['index.html', 'admet.html']) {
  test(`${file}: no seeded predictions, both sources merge by identity, zero/confidence survive reload`, async ({ page }) => {
    const { errors, external } = await open(page, { file });
    expect(await profiles(page)).toEqual([]);
    await expect(page.locator('#admetApiStatus')).toContainText('unavailable on this host');
    await add(page);
    expect((await profiles(page))[0].values).toEqual({});
    await expect(page.locator('#admetSourceDetails')).toContainText('Not available');
    await paste(page, 'swissadme', swiss);
    await expect(page.locator('#admetSourceMessage')).toContainText('Imported 1 SwissADME');
    await paste(page, 'protox', protox);
    await expect(page.locator('#admetSourceMessage')).toContainText('Imported 1 ProTox 3.0');
    let [p] = await profiles(page);
    expect(p.values).toMatchObject({ logp: { value: '0.00', source: 'swissadme' }, viol: { value: '0' }, ghs: { value: '6' }, hepato: { value: 'Inactive', probability: { value: '0.00', meaning: 'Model confidence (0–1)' } } });
    expect(p.values.bbb.value).toBe('No');
    expect(p.values['protox_model:bbb'].value).toBe('Active');
    expect(p.values.lipinski).toBeUndefined();
    expect(p.values.accuracy).toBeUndefined();
    await page.reload();
    if (file === 'index.html') await page.evaluate(() => { showApp({ id: 'fixture-user', email: 'admet-test@example.test' }); setActivePanel('admetTab'); });
    await expect(page.locator('#admetSourceRows')).toContainText('Test compound');
    [p] = await profiles(page);
    expect(p.values.logp.value).toBe('0.00');
    expect(p.imports).toHaveLength(2);
    expect(external.filter(url => /swissadme\.ch|tox\.charite\.de/.test(url))).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('legacy local and cloud records are quarantined; dashboards never interpret missing endpoints as safety/potency', async ({ page }) => {
  const { errors } = await open(page, { legacy: true, history: [{ id: 'old-session', name: '<img src=x onerror=alert(1)>', compound_count: 1, saved_at: '2026-11-27', compounds: JSON.stringify([{ cid: '1', hepato: 'Inactive' }]) }] });
  await expect(page.locator('#admetLegacyWarning')).toBeVisible();
  expect(await profiles(page)).toEqual([]);
  await expect(page.locator('#historyList img')).toHaveCount(0);
  await expand(page, 'admetHistorySection');
  await page.locator('[data-load-session="old-session"]').click();
  await expect(page.locator('#historyMsg')).toContainText('was not loaded');
  expect(await profiles(page)).toEqual([]);
  await add(page);
  await page.evaluate(() => setActivePanel('dashboardPanel'));
  await expect(page.locator('#dashAdmetContent')).toContainText('Missing endpoints are unknown, not safe');
  await expect(page.locator('#dashAdmetContent')).toContainText('Not available');
  await expect(page.locator('#dashAdmetContent')).not.toContainText('Potent for Docking');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ddu_admet_compounds'))[0].name)).toBe('Old invented preset');
  expect(errors).toEqual([]);
});

test('PubChem adds identity only, never copies its numeric properties into source-only ADMET', async ({ page }) => {
  const { errors } = await open(page);
  await page.locator('#admetIdentityType').selectOption('cid');
  await page.locator('#admetIdentityInput').fill('2244');
  await page.locator('#admetAddIdentity').click();
  await expect(page.locator('#admetSourceMessage')).toContainText('Added 1 structures');
  const [p] = await profiles(page);
  expect(p.identity).toMatchObject({ cid: '2244', smiles });
  expect(p.values).toEqual({});
  await expect(page.locator('#admetSourceDetails')).not.toContainText('999.99');
  expect(errors).toEqual([]);
});

test('wrong stereoisomer, absent confirmation and file-plus-paste ambiguity leave dataset unchanged', async ({ page }) => {
  const { errors } = await open(page);
  await add(page);
  await expand(page, 'admetImportSection');
  await page.locator('#admetSourceText').fill(swiss);
  await page.locator('#admetImportResults').click();
  await expect(page.locator('#admetSourceMessage')).toContainText('Confirm the provider');
  await paste(page, 'swissadme', swiss.replace(smiles, 'C[C@@H](O)C(=O)O'));
  await expect(page.locator('#admetSourceMessage')).toContainText('mismatch');
  expect((await profiles(page))[0].values).toEqual({});
  await page.locator('#admetSourceFile').setInputFiles({ name: 'source.csv', mimeType: 'text/csv', buffer: Buffer.from(swiss) });
  await page.locator('#admetImportResults').click();
  await expect(page.locator('#admetSourceMessage')).toContainText('not both');
  expect((await profiles(page))[0].values).toEqual({});
  await page.locator('#admetSourceText').fill('');
  await page.locator('#admetImportResults').click();
  await expect(page.locator('#admetSourceMessage')).toContainText('Imported 1 SwissADME');
  expect((await profiles(page))[0].values.mw.value).toBe('90.080');
  expect(errors).toEqual([]);
});

test('partial provider updates cannot keep stale toxicity fields or infer other models', async ({ page }) => {
  const { errors } = await open(page);
  await add(page);
  await paste(page, 'protox', protox);
  await paste(page, 'protox', 'Predicted LD50: 6000 mg/kg');
  await expect(page.locator('#admetSourceMessage')).toContainText('already has results');
  expect((await profiles(page))[0].values.ghs.value).toBe('6');
  await paste(page, 'protox', 'Predicted LD50: 6000 mg/kg', { replace: true });
  const [p] = await profiles(page);
  expect(Object.keys(p.values)).toEqual(['ld50']);
  expect(p.values.ld50.value).toBe('6000');
  expect(p.imports).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('CSV, Word and JSON exports retain source values, missing status, evidence and formula-safe labels', async ({ page }) => {
  const { errors } = await open(page);
  await add(page, smiles, '=HYPERLINK("https://example.test")');
  await paste(page, 'swissadme', swiss);
  await paste(page, 'protox', protox);
  let downloadEvent = page.waitForEvent('download');
  await page.locator('#admetExportCsvBtn').click();
  let download = await downloadEvent;
  const csv = await fs.readFile(await download.path(), 'utf8');
  expect(csv).toContain("'=HYPERLINK");
  expect(csv).toContain('"Consensus LogP","0.00"');
  expect(csv).toContain('"Lipinski violations","0"');
  expect(csv).toContain('"Lipinski","Not available"');
  expect(csv).toContain('Average similarity (%)');
  expect(csv).toContain('User-supplied source output (not independently authenticated)');
  downloadEvent = page.waitForEvent('download');
  await page.locator('#admetGenerateDocxBtn').click();
  download = await downloadEvent;
  const xml = execFileSync('python3', ['-c', 'import zipfile,sys; print(zipfile.ZipFile(sys.argv[1]).read("word/document.xml").decode())', await download.path()], { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
  expect(xml).toContain('SwissADME + ProTox 3.0');
  expect(xml).toContain('Not available');
  expect(xml).toContain('90.080');
  expect(xml).toContain('88.40');
  expect(xml).toContain('Source evidence');
  expect(xml).not.toMatch(/pkcsm|automated in silico computation/i);
  downloadEvent = page.waitForEvent('download');
  await page.locator('#admetExportEvidence').click();
  download = await downloadEvent;
  const archive = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  expect(archive.profiles[0].imports).toHaveLength(2);
  expect(archive.profiles[0].values.viol.value).toBe('0');
  expect(archive.profiles[0].imports[1].raw).toContain('7000');
  expect(errors).toEqual([]);
});

test('500 structures prepare 200/200/100 manual Swiss batches without invoking SwissADME', async ({ page }) => {
  const { errors, external } = await open(page);
  await page.locator('#admetIdentityInput').fill(Array.from({ length: 500 }, (_, i) => `[${i + 1}CH4]`).join('\n'));
  await page.locator('#admetAddIdentity').click();
  await expect(page.locator('#admetSourceMessage')).toContainText('Added 500 structures');
  await expand(page, 'admetImportSection');
  await page.locator('#admetSwissInputs').click();
  await expect(page.locator('#admetSwissDownloads button')).toHaveText(['Download batch 1 (200)', 'Download batch 2 (200)', 'Download batch 3 (100)']);
  expect((await profiles(page)).every(p => Object.keys(p.values).length === 0)).toBe(true);
  // A shuffled batch must fill existing exact matches, not append 500 duplicate profiles.
  const batch = 'SMILES,GI absorption,Consensus Log P\n' + Array.from({ length: 500 }, (_, i) => `[${500 - i}CH4],High,0.00`).join('\n');
  await expand(page, 'admetImportOptions');
  await page.locator('#admetImportTarget').selectOption('');
  await paste(page, 'swissadme', batch);
  await expect(page.locator('#admetSourceMessage')).toContainText('Imported 500 SwissADME');
  expect(await profiles(page)).toHaveLength(500);
  expect((await profiles(page)).every(p => p.values.logp.value === '0.00' && !p.values.ld50)).toBe(true);
  expect(external.filter(url => url.includes('swissadme'))).toEqual([]);
  expect(errors).toEqual([]);
});

test('ProTox API persists jobs, uses exact input, and attaches source results to the submitted record despite selection changes', async ({ page }) => {
  const requests = [];
  const { errors } = await open(page, { api: true, onApi: route => {
    const input = route.request().postDataJSON(); requests.push({ url: route.request().url(), input });
    if (route.request().url().endsWith('/enqueue')) return json(route, { jobId: 'fixture-job-1', retryAfter: 5 });
    return json(route, { state: 'ready', jobId: 'fixture-job-1', missing: [], files: [
      { type: 'acute toxicity', url: 'https://tox.charite.de/protox3/csv/fixture-job-1_tox_class.csv', text: 'Target\tPrediction\tProbability\nLD50\t7000\t88.40\ntox_class\t6\t88.40' },
      { type: 'toxicity model', url: 'https://tox.charite.de/protox3/csv/fixture-job-1_result.csv', text: 'Target\tPrediction\tProbability\ndili\t0\t0.00' },
      { type: 'toxicity target', url: 'https://tox.charite.de/protox3/csv/fixture-job-1_tox_targets.csv', text: 'Target\tPrediction\tProbability\nFixture target\t3\t0.60' }
    ] });
  } });
  await page.clock.install();
  await add(page, smiles + '\nCCN', '');
  await expect(page.locator('#admetApiStatus')).toContainText('adapter available');
  await expect(page.locator('#admetRunProtox')).toBeDisabled();
  await page.locator('#admetApiConsent').check();
  await expand(page, 'admetQueueOptions');
  await page.locator('#admetRunProtox').click();
  await expect(page.locator('#admetSourceMessage')).toContainText('waiting 30s');
  expect((await profiles(page))[0].protoxJob).toMatchObject({ id: 'fixture-job-1', inputSmiles: smiles, status: 'pending' });
  await page.locator('[data-review]').nth(1).click();
  await page.clock.fastForward(30000);
  await expect(page.locator('#admetSourceMessage')).toContainText('1 source profile(s) received');
  const [first, second] = await profiles(page);
  expect(first.values.ld50.value).toBe('7000');
  expect(first.values.hepato.probability.value).toBe('0.00');
  expect(first.imports[0].method).toBe('api');
  expect(first.protoxJob.status).toBe('complete');
  expect(second.values).toEqual({});
  expect(requests[0].input.smiles).toBe(smiles);
  expect(requests[1].input.jobId).toBe('fixture-job-1');
  expect(requests).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('ProTox quota errors and cancelled pending jobs never create results or resubmit automatically', async ({ page }) => {
  let mode = 'quota'; const requests = [];
  const { errors } = await open(page, { api: true, onApi: route => {
    requests.push(route.request().url());
    if (mode === 'quota') return json(route, { error: 'ProTox daily quota reached' }, 403);
    return route.request().url().endsWith('/enqueue') ? json(route, { jobId: 'pending-job', retryAfter: 5 }) : json(route, { jobId: 'pending-job', state: 'pending', retryAfter: 30 });
  } });
  await page.clock.install();
  await add(page); await page.locator('#admetApiConsent').check();
  await expand(page, 'admetQueueOptions'); await page.locator('#admetRunProtox').click();
  await expect(page.locator('#admetSourceMessage')).toContainText('quota reached');
  expect((await profiles(page))[0].values).toEqual({}); expect(requests).toHaveLength(1);
  mode = 'pending'; await page.locator('#admetRunProtox').click();
  await expect(page.locator('#admetSourceMessage')).toContainText('waiting 30s');
  await page.locator('#admetStopProtox').click();
  await expect(page.locator('#admetSourceMessage')).toContainText('Queue stopped');
  expect((await profiles(page))[0].protoxJob.id).toBe('pending-job');
  expect((await profiles(page))[0].values).toEqual({});
  await page.locator('#admetRunProtox').click();
  await expect(page.locator('#admetSourceMessage')).toContainText('waiting 30s');
  await page.clock.fastForward(30000);
  await expect(page.locator('#admetSourceMessage')).toContainText('check 2/20');
  await page.locator('#admetStopProtox').click();
  expect(requests.filter(url => url.endsWith('/enqueue'))).toHaveLength(2); // first failed + second explicitly requested
  expect(requests.filter(url => url.endsWith('/retrieve'))).toHaveLength(1);
  expect(errors).toEqual([]);
});

// Automatic-flow fixtures below exercise orchestration, not live provider accuracy.
function ready(jobId, { partial = false } = {}) {
  const files = [
    { type: 'acute toxicity', url: `https://tox.charite.de/protox3/csv/${jobId}_tox_class.csv`, text: 'Target\tPrediction\tProbability\nLD50\t7000\t88.40\ntox_class\t6\t88.40' },
    { type: 'toxicity model', url: `https://tox.charite.de/protox3/csv/${jobId}_result.csv`, text: 'Target\tPrediction\tProbability\ndili\t0\t0.00' },
    { type: 'toxicity target', url: `https://tox.charite.de/protox3/csv/${jobId}_tox_targets.csv`, text: 'Target\tPrediction\tProbability\nFixture target\t3\t0.60' }
  ];
  return { state: 'ready', jobId, files: partial ? files.slice(0, 1) : files, missing: partial ? ['toxicity model', 'toxicity target'] : [] };
}

for (const file of ['index.html', 'admet.html']) {
  test(`${file}: one Start action adds inputs, retrieves ProTox and keeps optional material collapsed`, async ({ page }) => {
    const requests = [];
    const { errors, external } = await open(page, { file, api: true, onApi: route => {
      requests.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
      return route.request().url().endsWith('/enqueue') ? json(route, { jobId: 'auto-fixture', retryAfter: 5 }) : json(route, ready('auto-fixture'));
    } });
    await page.clock.install();
    for (const id of ['admetInputOptions', 'admetQueueOptions', 'admetImportSection', 'admetSelectedRecord', 'admetHistorySection', 'admetHelp']) {
      expect(await page.locator('#' + id).evaluate(el => el.open)).toBe(false);
    }
    await page.locator('#admetIdentityInput').fill(smiles);
    await expect(page.locator('#admetAutoRun')).toBeDisabled();
    expect(await profiles(page)).toEqual([]);
    expect(requests).toHaveLength(0);
    await page.locator('#admetApiConsent').check();
    await page.locator('#admetAutoRun').click();
    await expect(page.locator('#admetSourceMessage')).toContainText('waiting 30s');
    await expect(page.locator('#admetIdentityInput')).toBeDisabled();
    await expect(page.locator('#admetAutoRun')).toBeDisabled();
    await expect(page.locator('#admetStopProtox')).toBeVisible();
    await expect(page.locator('#admetQueueLabel')).toContainText('0/1');
    expect((await profiles(page))[0]).toMatchObject({ identity: { smiles }, values: {}, protoxJob: { id: 'auto-fixture', status: 'pending' } });
    expect(requests).toHaveLength(1);
    await page.clock.fastForward(30000);
    await expect(page.locator('#admetSourceMessage')).toContainText('1 source profile(s) received');
    await expect(page.locator('#admetQueueMeter')).toHaveAttribute('value', '1');
    await expect(page.locator('#admetStopProtox')).toBeHidden();
    await expect(page.locator('#admetIdentityInput')).toHaveValue(smiles);
    const [p] = await profiles(page);
    expect(p.protoxJob.status).toBe('complete');
    expect(p.values.ld50.value).toBe('7000');
    expect(p.values.hepato.probability.value).toBe('0.00');
    expect(p.values.mw).toBeUndefined();
    expect(p.imports).toHaveLength(3);
    expect(requests[0].body.smiles).toBe(smiles);
    expect(requests[1].body.jobId).toBe('auto-fixture');
    await expect(page.locator('#admetSourceText')).toBeHidden();
    await page.locator('[data-review]').click();
    await expect(page.locator('#admetSelectedRecord')).toHaveAttribute('open', '');
    await expect(page.locator('#admetSelectedRecord > summary')).toBeFocused();
    await expect(page.locator('#admetSourceDetails > .source-table-wrap tbody tr')).toHaveCount(4);
    await expect(page.locator('#admetMissingFields .source-table-wrap')).toBeHidden();
    await page.locator('#admetMissingFields > summary').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#admetMissingFields .source-table-wrap')).toBeVisible();
    await page.locator('#admetAutoRun').click();
    await expect(page.locator('#admetSourceMessage')).toContainText('No missing ProTox profiles');
    expect(requests).toHaveLength(2); // A completed input is not submitted again.
    await expand(page, 'admetHistorySection');
    await page.locator('#historySessionName').fill('Automatic fixture session');
    await page.locator('#historySaveBtn').click();
    await expect(page.locator('#historyMsg')).toContainText('evidence saved');
    expect(await page.evaluate(() => JSON.parse(window.__historySaved[0].compounds)[0].imports.length)).toBe(3);
    expect(external.filter(url => /swissadme\.ch|tox\.charite\.de/.test(url))).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('automatic batches queue only pasted exact identities, deduplicate input and keep unrelated records untouched', async ({ page }) => {
  const requests = [];
  let nextJob = 0;
  const { errors } = await open(page, { api: true, onApi: route => {
    const body = route.request().postDataJSON(); requests.push({ path: new URL(route.request().url()).pathname, body });
    return route.request().url().endsWith('/enqueue') ? json(route, { jobId: `scoped-${++nextJob}`, retryAfter: 5 }) : json(route, ready(body.jobId));
  } });
  await page.clock.install();
  await add(page, 'CCN', 'Unrelated pending compound');
  await add(page, smiles, 'Existing exact compound');
  const existingId = (await profiles(page))[1].id;
  const input = `${smiles}\nCCO\n${smiles}`;
  await page.locator('#admetIdentityInput').fill(input);
  await page.locator('#admetApiConsent').check();
  await page.locator('#admetAutoRun').click();
  await expect(page.locator('#admetSourceMessage')).toContainText('scoped-1: waiting 30s');
  expect(requests).toHaveLength(1);
  await page.clock.fastForward(30000);
  await expect(page.locator('#admetQueueLabel')).toContainText('1/2');
  expect(requests).toHaveLength(2); // No parallel second submission.
  await page.clock.fastForward(5000);
  await expect(page.locator('#admetSourceMessage')).toContainText('scoped-2: waiting 30s');
  await page.clock.fastForward(30000);
  await expect(page.locator('#admetSourceMessage')).toContainText('2 source profile(s) received');
  const result = await profiles(page);
  expect(result).toHaveLength(3);
  expect(result[0].values).toEqual({});
  expect(result[0].protoxJob).toBeUndefined();
  expect(result[1].id).toBe(existingId);
  expect(result[1].identity.label).toBe('Existing exact compound');
  expect(result.slice(1).every(p => p.protoxJob.status === 'complete')).toBe(true);
  expect(requests.filter(r => r.path.endsWith('/enqueue')).map(r => r.body.smiles)).toEqual([smiles, 'CCO']);
  await expect(page.locator('#admetIdentityInput')).toHaveValue(input);
  expect(errors).toEqual([]);
});

test('names and CIDs resolve automatically and enrich an exact existing identity without copying PubChem properties', async ({ page }) => {
  const lookup = [], submitted = [];
  const { errors } = await open(page, { api: true, onLookup: route => {
    lookup.push(route.request().url());
    if (route.request().url().includes('/compound/name/cids/')) {
      expect(new URLSearchParams(route.request().postData()).get('name')).toBe('Fixture acid');
      return json(route, { IdentifierList: { CID: [2244] } });
    }
    return json(route, { PropertyTable: { Properties: [{ CID: 2244, Title: 'Fixture acid', SMILES: smiles, MolecularWeight: '999.99' }] } });
  }, onApi: route => {
    if (route.request().url().endsWith('/enqueue')) { submitted.push(route.request().postDataJSON().smiles); return json(route, { jobId: 'resolved-fixture', retryAfter: 5 }); }
    return json(route, ready('resolved-fixture'));
  } });
  await page.clock.install();
  await add(page);
  const id = (await profiles(page))[0].id;
  await page.locator('#admetIdentityType').selectOption('cid');
  await page.locator('#admetIdentityInput').fill('Fixture acid\n2244');
  await page.locator('#admetApiConsent').check();
  await page.locator('#admetAutoRun').click();
  await expect.poll(() => lookup.length).toBe(1);
  await page.clock.runFor(500);
  await expect(page.locator('#admetSourceMessage')).toContainText('waiting 30s');
  expect(lookup).toHaveLength(2);
  await page.clock.fastForward(30000);
  await expect(page.locator('#admetSourceMessage')).toContainText('1 source profile(s) received');
  const result = await profiles(page);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ id, identity: { cid: '2244', smiles } });
  expect(result[0].values.mw).toBeUndefined();
  expect(result[0].values.formula).toBeUndefined();
  expect(submitted).toEqual([smiles]);
  expect(errors).toEqual([]);
});

test('invalid, oversized or unresolved inputs never submit unrelated pending compounds', async ({ page }) => {
  const lookup = [], requests = [];
  const { errors } = await open(page, { api: true, onLookup: route => {
    lookup.push(route.request().url());
    if (route.request().url().includes('/compound/name/cids/')) {
      const name = new URLSearchParams(route.request().postData()).get('name');
      return json(route, { IdentifierList: { CID: name === 'Good fixture' ? [2244] : [1, 2] } });
    }
    return json(route, { PropertyTable: { Properties: [{ CID: 2244, Title: 'Good fixture', SMILES: 'CCO' }] } });
  }, onApi: route => { requests.push(route.request().url()); return json(route, { error: 'Unexpected submission in a validation test' }, 503); } });
  await add(page, 'CCN', 'Unrelated');
  await page.locator('#admetIdentityInput').fill('C C');
  await page.locator('#admetApiConsent').check();
  await page.locator('#admetAutoRun').click();
  await expect(page.locator('#admetSourceMessage')).toContainText('one exact SMILES');
  expect(await profiles(page)).toHaveLength(1);
  const tooMany = Array.from({ length: 501 }, (_, i) => `[${i + 1}CH4]`).join('\n');
  await page.locator('#admetIdentityInput').fill(tooMany);
  await expect(page.locator('#admetInputCount')).toHaveText('501 / 500');
  await page.locator('#admetAutoRun').click();
  await expect(page.locator('#admetSourceMessage')).toContainText('1–500 identifiers');
  expect(lookup).toHaveLength(0);
  expect(requests).toHaveLength(0);
  // An individually valid 500-input batch must also respect the total dataset cap.
  await page.locator('#admetIdentityInput').fill(tooMany.split('\n').slice(0, 500).join('\n'));
  await page.locator('#admetAutoRun').click();
  await expect(page.locator('#admetSourceMessage')).toContainText('exceeds 500 compounds');
  expect(await profiles(page)).toHaveLength(1);
  expect(requests).toHaveLength(0);
  await page.locator('#admetIdentityType').selectOption('cid');
  await page.locator('#admetIdentityInput').fill('Good fixture\nAmbiguous fixture');
  await page.locator('#admetAutoRun').click();
  await expect(page.locator('#admetSourceMessage')).toContainText('Nothing was submitted to ProTox');
  await expect(page.locator('#admetSourceMessage')).toContainText('multiple PubChem records');
  await expect(page.locator('#admetIdentityInput')).toHaveValue('Good fixture\nAmbiguous fixture');
  const result = await profiles(page);
  expect(result).toHaveLength(2); // Resolved identities may be retained, but never silently run.
  expect(result.every(p => !p.protoxJob && !Object.keys(p.values).length)).toBe(true);
  expect(requests).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('Stop during identity resolution aborts the automatic flow before any provider submission', async ({ page }) => {
  let releaseLookup;
  const requests = [];
  const { errors } = await open(page, { api: true, onLookup: async route => {
    await new Promise(resolve => { releaseLookup = resolve; });
    await json(route, { PropertyTable: { Properties: [{ CID: 2244, Title: 'Stopped fixture', SMILES: smiles }] } });
  }, onApi: route => { requests.push(route.request().url()); return json(route, { error: 'Unexpected submission' }, 503); } });
  await add(page, 'CCN');
  await page.locator('#admetIdentityType').selectOption('cid');
  await page.locator('#admetIdentityInput').fill('2244');
  await page.locator('#admetApiConsent').check();
  await page.locator('#admetAutoRun').click();
  await expect.poll(() => typeof releaseLookup).toBe('function');
  await page.locator('#admetStopProtox').click();
  await expect(page.locator('#admetSourceMessage')).toContainText('Queue stopped');
  releaseLookup();
  await expect(page.locator('#admetIdentityInput')).toBeEnabled();
  await expect(page.locator('#admetIdentityInput')).toHaveValue('2244');
  expect(await profiles(page)).toHaveLength(1);
  expect((await profiles(page))[0].protoxJob).toBeUndefined();
  expect(requests).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('revoking consent stops the queue; a reloaded pending job resumes without a new submission, even at the daily limit', async ({ page }) => {
  const requests = [];
  const { errors } = await open(page, { api: true, onApi: route => {
    requests.push(route.request().url());
    return route.request().url().endsWith('/enqueue') ? json(route, { jobId: 'resume-fixture', retryAfter: 5 }) : json(route, ready('resume-fixture'));
  } });
  await page.clock.install();
  await page.locator('#admetIdentityInput').fill(smiles);
  await page.locator('#admetApiConsent').check();
  await page.locator('#admetAutoRun').click();
  await expect(page.locator('#admetSourceMessage')).toContainText('waiting 30s');
  await page.locator('#admetApiConsent').uncheck();
  await expect(page.locator('#admetSourceMessage')).toContainText('Queue stopped');
  expect((await profiles(page))[0].protoxJob.status).toBe('pending');
  await page.evaluate(() => localStorage.setItem('ddu_protox_usage', JSON.stringify({ day: new Date().toISOString().slice(0, 10), count: 250 })));
  await page.reload();
  await page.evaluate(() => { showApp({ id: 'fixture-user', email: 'admet-test@example.test' }); setActivePanel('admetTab'); });
  await expect(page.locator('#admetAutoRun')).toHaveText('Profile pending (1) ↗');
  await expect(page.locator('#admetAutoRun')).toBeDisabled();
  await page.locator('#admetApiConsent').check();
  await page.locator('#admetAutoRun').click();
  await expect(page.locator('#admetSourceMessage')).toContainText('resume-fixture: waiting 30s');
  await page.clock.fastForward(30000);
  await expect(page.locator('#admetSourceMessage')).toContainText('1 source profile(s) received');
  expect(requests.filter(url => url.endsWith('/enqueue'))).toHaveLength(1);
  expect(requests.filter(url => url.endsWith('/retrieve'))).toHaveLength(1);
  expect((await profiles(page))[0].protoxJob.status).toBe('complete');
  expect(errors).toEqual([]);
});

test('partial automatic responses keep missing values missing and resume the saved job', async ({ page }) => {
  const requests = [];
  let retrieves = 0;
  const { errors } = await open(page, { api: true, onApi: route => {
    requests.push(route.request().url());
    if (route.request().url().endsWith('/enqueue')) return json(route, { jobId: 'partial-fixture', retryAfter: 5 });
    return json(route, ready('partial-fixture', { partial: ++retrieves === 1 }));
  } });
  await page.clock.install();
  await page.locator('#admetIdentityInput').fill(smiles);
  await page.locator('#admetApiConsent').check();
  await page.locator('#admetAutoRun').click();
  await expect(page.locator('#admetSourceMessage')).toContainText('waiting 30s');
  await page.clock.fastForward(30000);
  await expect(page.locator('#admetSourceMessage')).toContainText('Partial ProTox output');
  let [p] = await profiles(page);
  expect(p.protoxJob.status).toBe('partial');
  expect(p.values.hepato).toBeUndefined();
  expect(p.values.ld50.value).toBe('7000');
  await page.locator('#admetAutoRun').click();
  await expect(page.locator('#admetSourceMessage')).toContainText('waiting 30s');
  await page.clock.fastForward(30000);
  await expect(page.locator('#admetSourceMessage')).toContainText('1 source profile(s) received');
  [p] = await profiles(page);
  expect(p.protoxJob.status).toBe('complete');
  expect(p.values.hepato.value).toBe('Inactive');
  expect(p.imports).toHaveLength(4); // The first partial evidence remains archived.
  expect(requests.filter(url => url.endsWith('/enqueue'))).toHaveLength(1);
  expect(requests.filter(url => url.endsWith('/retrieve'))).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('500-input automatic runs require the 250-job cap confirmation and stop on provider quota errors', async ({ page }) => {
  const requests = [];
  const { errors } = await open(page, { api: true, onApi: route => {
    requests.push(route.request().url()); return json(route, { error: 'ProTox daily quota reached' }, 403);
  } });
  const input = Array.from({ length: 500 }, (_, i) => `[${i + 1}CH4]`).join('\n');
  await page.locator('#admetIdentityInput').fill(input);
  await page.locator('#admetApiConsent').check();
  page.once('dialog', dialog => { expect(dialog.message()).toContain('first 250 of 500'); return dialog.dismiss(); });
  await page.locator('#admetAutoRun').click();
  await expect(page.locator('#admetAutoRun')).toBeEnabled();
  expect(await profiles(page)).toHaveLength(500);
  expect(requests).toHaveLength(0);
  await expect(page.locator('#admetQueueProgress')).toBeHidden();
  await expect(page.locator('#admetSourceMessage')).toContainText('Profiling cancelled');
  await expect(page.locator('#admetIdentityInput')).toHaveValue(input);
  page.once('dialog', dialog => { expect(dialog.message()).toContain('first 250 of 500'); return dialog.accept(); });
  await page.locator('#admetAutoRun').click();
  await expect(page.locator('#admetSourceMessage')).toContainText('quota reached');
  await expect(page.locator('#admetQueueLabel')).toContainText('0/250');
  expect(requests).toHaveLength(1);
  expect((await profiles(page)).every(p => Object.keys(p.values).length === 0)).toBe(true);
  expect(errors).toEqual([]);
});

test('compact ADMET stays accessible and responsive with imports, received values and evidence expanded', async ({ page }) => {
  const AxeBuilder = require('@axe-core/playwright').default;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { errors } = await open(page, { api: true });
  await add(page);
  await paste(page, 'swissadme', swiss);
  await paste(page, 'protox', protox);
  await expand(page, 'admetImportOptions');
  await expand(page, 'admetQueueOptions');
  await expand(page, 'admetHistorySection');
  await page.locator('[data-review]').click();
  await expect(page.locator('#admetSourceDetails > .source-table-wrap')).toBeVisible();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}px expanded ADMET`).toBeLessThanOrEqual(width);
  }
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(result.violations.map(v => ({ rule: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
  expect(errors).toEqual([]);
});

// Run the real adapter behind the browser route, with synthetic outbound
// authentication/provider responses. This never calls the live provider.
async function adapterBridge(provider) {
  const { createHandler } = await import('../../server/protox-handler.mjs');
  const calls = [];
  const handle = createHandler({ fetch: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'fixture-user' }));
    return provider(url, options);
  } });
  const onApi = async route => {
    const incoming = route.request();
    const action = new URL(incoming.url()).pathname.split('/').pop();
    const res = await handle(new Request(incoming.url(), { method: incoming.method(), headers: incoming.headers(), body: incoming.postData() }), action);
    return route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
  };
  return { calls, onApi };
}

test('submission HTML shows stage/status while resolved identities stay prediction-free, without automatic retry', async ({ page }) => {
  const { calls, onApi } = await adapterBridge(() => new Response('<html>private upstream fixture</html>', { headers: { 'Content-Type': 'text/html' } }));
  const { errors } = await open(page, { api: true, onApi });
  await page.clock.install();
  await page.locator('#admetIdentityType').selectOption('cid');
  await page.locator('#admetIdentityInput').fill('2244');
  await page.locator('#admetApiConsent').check();
  await page.locator('#admetAutoRun').click();
  await expect(page.locator('#admetSourceMessage')).toContainText('ProTox submission (HTTP 200)');
  await expect(page.locator('#admetSourceMessage')).toContainText('instead of a job ID');
  await expect(page.locator('#admetSourceMessage')).not.toContainText('private upstream fixture');
  await expect(page.locator('#admetQueueLabel')).toContainText('Paused · 0/1');
  const [p] = await profiles(page);
  expect(p.identity.cid).toBe('2244');
  expect(p.values).toEqual({});
  expect(p.protoxJob).toBeUndefined();
  await page.clock.fastForward(60000);
  expect(calls.filter(call => call.url.endsWith('api_enqueue.php'))).toHaveLength(1);
  expect(errors).toEqual([]);
});

for (const file of ['index.html', 'admet.html']) {
  test(`${file}: adapter HTML polling stays pending, file errors retain jobs, reload resumes without re-enqueue`, async ({ page }) => {
    let polls = 0, fileError = true;
    const jobId = 'html-control-fixture';
    const { calls, onApi } = await adapterBridge(url => {
      if (url.endsWith('api_enqueue.php')) return new Response(jobId, { headers: { 'Retry-After': '5', 'Content-Type': 'text/html' } });
      if (url.endsWith('api_retrieve.php')) return ++polls === 1
        ? new Response('<!DOCTYPE html><html>Not ready</html>', { status: 404, headers: { 'Retry-After': '45' } })
        : new Response('<html>CONTROL ONLY; never prediction evidence</html>');
      if (fileError) return new Response('<html>private upstream fixture</html>');
      const source = ready(jobId).files.find(source => source.url === url);
      expect(source).toBeDefined();
      return new Response(source.text, { headers: { 'Content-Type': 'text/html' } });
    });
    const { errors } = await open(page, { file, api: true, onApi });
    await page.clock.install();
    await page.locator('#admetIdentityInput').fill(smiles);
    await page.locator('#admetApiConsent').check();
    await page.locator('#admetAutoRun').click();
    await expect(page.locator('#admetSourceMessage')).toContainText('waiting 30s');
    await page.clock.fastForward(30000);
    await expect(page.locator('#admetSourceMessage')).toContainText('waiting 45s (check 2/20)');
    expect((await profiles(page))[0].values).toEqual({});
    expect(calls.filter(call => call.url.includes('/csv/'))).toHaveLength(0);
    await page.clock.fastForward(45000);
    await expect(page.locator('#admetSourceMessage')).toContainText('ProTox result file (HTTP 200)');
    await expect(page.locator('#admetSourceMessage')).toContainText('instead of CSV');
    await expect(page.locator('#admetQueueLabel')).toContainText('Paused · 0/1');
    expect((await profiles(page))[0]).toMatchObject({ values: {}, protoxJob: { id: jobId, inputSmiles: smiles, status: 'pending' } });
    fileError = false;
    await page.reload();
    if (file === 'index.html') await page.evaluate(() => { showApp({ id: 'fixture-user', email: 'admet-test@example.test' }); setActivePanel('admetTab'); });
    await expect(page.locator('#admetAutoRun')).toHaveText('Profile pending (1) ↗');
    await page.locator('#admetApiConsent').check();
    await page.locator('#admetAutoRun').click();
    await expect(page.locator('#admetSourceMessage')).toContainText('waiting 30s');
    await page.clock.fastForward(30000);
    await expect(page.locator('#admetSourceMessage')).toContainText('1 source profile(s) received');
    const [p] = await profiles(page);
    expect(p.protoxJob.status).toBe('complete');
    expect(p.values.ld50.value).toBe('7000');
    expect(p.values.hepato.probability.value).toBe('0.00');
    expect(p.imports).toHaveLength(3);
    expect(JSON.stringify(p.imports)).not.toMatch(/CONTROL ONLY|private upstream fixture|<html>/);
    expect(calls.filter(call => call.url.endsWith('api_enqueue.php'))).toHaveLength(1);
    expect(calls.filter(call => call.url.endsWith('api_retrieve.php'))).toHaveLength(3);
    expect(errors).toEqual([]);
  });
}
