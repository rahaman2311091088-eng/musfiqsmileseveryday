const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const { execFileSync } = require('node:child_process');

// Deliberately selected parser fixtures, NOT live/experimentally verified predictions.
const smiles = 'C[C@H](O)C(=O)O';
const swiss = `Molecule,Canonical SMILES,MW,XLOGP3,WLOGP,Consensus Log P,GI absorption,BBB permeant,Lipinski #violations\nFixture,${smiles},90.080,0.40,0.50,0.00,High,No,0`;
const protox = `input\ttype\tTarget\tPrediction\tProbability\n${smiles}\tacute toxicity\tLD50\t7000\t88.40\n${smiles}\tacute toxicity\ttox_class\t6\t88.40\n${smiles}\ttoxicity model\tdili\t0\t0.00\n${smiles}\ttoxicity model\tbbb\t1\t0.73`;
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function open(page, { file = 'index.html', legacy = false, api = false, onApi, history = [] } = {}) {
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
    if (route.request().url().includes('/rest/pug/')) {
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
async function add(page, structure = smiles, label = 'Test compound') {
  await page.locator('#admetIdentityInput').fill(structure);
  await page.locator('#admetIdentityLabel').fill(label);
  await page.locator('#admetAddIdentity').click();
  await expect(page.locator('#admetSourceMessage')).toContainText('Added');
}
async function paste(page, provider, text, { replace = false } = {}) {
  await page.locator('#admetImportProvider').selectOption(provider);
  await page.locator('#admetSourceText').fill(text);
  await page.locator('#admetIdentityConfirm').check();
  if (replace) await page.locator('#admetReplaceSource').check();
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
  await page.locator('#admetSwissInputs').click();
  await expect(page.locator('#admetSwissDownloads button')).toHaveText(['Download batch 1 (200)', 'Download batch 2 (200)', 'Download batch 3 (100)']);
  expect((await profiles(page)).every(p => Object.keys(p.values).length === 0)).toBe(true);
  // A shuffled batch must fill existing exact matches, not append 500 duplicate profiles.
  const batch = 'SMILES,GI absorption,Consensus Log P\n' + Array.from({ length: 500 }, (_, i) => `[${500 - i}CH4],High,0.00`).join('\n');
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
  await add(page); await page.locator('#admetApiConsent').check(); await page.locator('#admetRunProtox').click();
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
