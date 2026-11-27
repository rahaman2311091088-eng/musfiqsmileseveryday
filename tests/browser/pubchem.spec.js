const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');

// All remote responses here are fixtures. No chemical database access or login is required.
async function openLookup(page, apiHandler) {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.supabase = {
      createClient: () => ({ auth: {
        onAuthStateChange() {},
        getSession: async () => ({ data: { session: null } }),
        signOut: async () => ({})
      } })
    };
    window.__exports = [];
    window.XLSX = {
      utils: {
        json_to_sheet: rows => ({ rows }),
        book_new: () => ({}),
        book_append_sheet: (book, sheet) => { book.sheet = sheet; }
      },
      writeFile: (book, filename) => window.__exports.push({ book, filename })
    };
  });
  await page.route('https://**/*', async route => {
    const url = route.request().url();
    if (url.includes('/rest/pug/') || url.includes('eutils.ncbi.nlm.nih.gov')) {
      return apiHandler(route);
    }
    // Isolate unrelated CDNs, authentication, fonts and structure images.
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
  await page.goto('/index.html');
  await page.evaluate(() => {
    showApp({ email: 'browser-test@example.test' });
    setActivePanel('pubchemTab');
  });
  await expect(page.locator('#cidInput')).toBeVisible();
  return pageErrors;
}

const reply = (route, body, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers });
const noMatch = route => reply(route, { Fault: { Code: 'PUGREST.NotFound' } }, 404);
const propertyIds = route => new URL(route.request().url()).pathname.match(/\/cid\/([^/]+)\/property\//)?.[1].split(',');
const propertyReply = (route, titles = {}) => reply(route, { PropertyTable: { Properties: propertyIds(route).map(cid => ({
  CID: Number(cid), Title: titles[cid] || `API fixture ${cid}`, MolecularFormula: 'C2H6O', MolecularWeight: '46.07', SMILES: 'CCO'
})) } });
const queryName = route => new URLSearchParams(route.request().postData()).get('name');
const emptySearch = route => reply(route, { esearchresult: { count: '0', idlist: [] } });

async function run(page, inputs) {
  await page.locator('#cidInput').fill(inputs.join('\n'));
  await page.locator('#fetchBtn').click();
  await expect(page.locator('#fetchBtn')).toBeEnabled({ timeout: 20000 });
}

test('Greek-name recovery, transient retry, and retry-failed preserve successful rows', async ({ page }) => {
  const original = '25‑O‑acetylcimigenol‑3‑O‑β‑D‑xylopyranoside';
  const normalized = '25-O-acetylcimigenol-3-O-beta-D-xylopyranoside';
  let methylCalls = 0;
  let resolvedKudonol = false;
  const requests = [];
  const errors = await openLookup(page, route => {
    if (propertyIds(route)) { requests.push(propertyIds(route)); return propertyReply(route); }
    if (route.request().url().includes('esearch.fcgi')) return emptySearch(route);
    const name = queryName(route);
    requests.push(name);
    if (name === 'Methyl ferulate') {
      if (++methylCalls === 1) return reply(route, {}, 429, { 'Retry-After': '0' });
      return reply(route, { IdentifierList: { CID: [101] } });
    }
    if (name === normalized) return reply(route, { IdentifierList: { CID: [102] } });
    if (name === 'Kudonol B' && resolvedKudonol) return reply(route, { IdentifierList: { CID: [103] } });
    return noMatch(route);
  });
  await run(page, ['Methyl ferulate', original, 'Kudonol B']);
  await expect(page.locator('#resultsTitle')).toContainText('2 resolved');
  await expect(page.locator('#resultsTitle')).toContainText('1 unresolved');
  await expect(page.locator('#resultsBody .row-error')).toHaveCount(1);
  await expect(page.locator('#resultsBody')).toContainText(original);
  await expect(page.locator('#resultsBody')).toContainText(`Matched: ${normalized}`);
  await expect(page.locator('#resultsBody .lookup-status')).toHaveText('No exact match');
  expect(methylCalls).toBe(2);

  const beforeRetry = requests.length;
  resolvedKudonol = true;
  await page.locator('#retryFailedBtn').click();
  await expect(page.locator('#resultsTitle')).toHaveText('3 of 3 resolved');
  await expect(page.locator('#resultsBody .row-error')).toHaveCount(0);
  await expect(page.locator('#retryFailedBtn')).toBeHidden();
  expect(requests.slice(beforeRetry)).toEqual(['Kudonol B', ['103']]);
  await expect(page.locator('#cidInput')).toHaveValue(['Methyl ferulate', original, 'Kudonol B'].join('\n'));
  expect(errors).toEqual([]);
});

test('manual verified CID correction preserves the original input and escapes HTML/quotes', async ({ page }) => {
  const original = 'Kudonol B"><img src=x onerror="window.injected=true">';
  const errors = await openLookup(page, route => {
    if (propertyIds(route)) return propertyReply(route, { 2244: 'Aspirin fixture' });
    if (route.request().url().includes('esearch.fcgi')) return emptySearch(route);
    return noMatch(route);
  });
  await run(page, [original]);
  await expect(page.locator('#downloadBtn')).toBeDisabled();
  await expect(page.locator('#resultsBody .row-error strong')).toHaveText(original);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await expect(page.locator('#resultsBody img')).toHaveCount(0);
  await page.locator('#resultsBody summary').click();
  await expect(page.locator('#lookupCorrection0')).toHaveValue(original);
  await page.locator('#lookupCorrection0').fill('CID: 2244');
  await page.getByRole('button', { name: 'Resolve this entry', exact: true }).click();
  await expect(page.locator('#resultsTitle')).toHaveText('1 of 1 resolved');
  await expect(page.locator('.lookup-input').first()).toHaveText(`Input: ${original}`);
  await expect(page.locator('.lookup-input').nth(1)).toHaveText('Lookup: CID: 2244');
  await expect(page.locator('#cidInput')).toHaveValue(original);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  expect(errors).toEqual([]);
});

test('property outages are labeled correctly, contain no invented data, and can be retried', async ({ page }) => {
  let online = false;
  let calls = 0;
  const errors = await openLookup(page, route => {
    calls++;
    return online ? propertyReply(route) : reply(route, {}, 503);
  });
  await run(page, ['2244']);
  await expect(page.locator('#resultsBody .lookup-status')).toHaveText('Service unavailable');
  await expect(page.locator('#lookupHelp')).toContainText('not a confirmed missing compound');
  await expect(page.locator('#downloadBtn')).toBeDisabled();
  await expect(page.locator('#downloadSdfBtn')).toBeDisabled();
  expect(calls).toBe(3);
  expect(await page.evaluate(() => lastResults[0])).toMatchObject({
    cid: '2244', smiles: '', formula: '', weight: '', errorType: 'unavailable'
  });
  online = true;
  await page.locator('#resultsBody [data-retry-index]').click();
  await expect(page.locator('#resultsTitle')).toHaveText('1 of 1 resolved');
  await expect(page.locator('#downloadBtn')).toBeEnabled();
  expect(calls).toBe(4);
  expect(errors).toEqual([]);
});

test('unresolved rows paginate once, remain searchable, and survive column toggles', async ({ page }) => {
  const errors = await openLookup(page, noMatch);
  await page.evaluate(() => renderResults(Array.from({ length: 50 }, (_, i) => ({
    inputLabel: `Unindexed compound ${String(i + 1).padStart(2, '0')}`, query: `Unindexed compound ${i + 1}`,
    cid: '—', error: 'No exact match. Check your source or enter a verified CID.', errorType: 'not_found', retryable: false
  }))));
  await expect(page.locator('#resultsBody .row-error')).toHaveCount(20);
  await expect(page.locator('#paginationInfo')).toHaveText('Showing 1–20 of 50');
  await page.locator('#paginationControls [data-page="next"]').click();
  await expect(page.locator('#resultsBody .row-error')).toHaveCount(20);
  await expect(page.locator('#resultsBody strong').first()).toHaveText('Unindexed compound 21');
  await page.locator('#paginationControls [data-page="next"]').click();
  await expect(page.locator('#resultsBody .row-error')).toHaveCount(10);
  await page.locator('#tableSearchInput').fill('Unindexed compound 49');
  await expect(page.locator('#resultsBody .row-error')).toHaveCount(1);
  await expect(page.locator('#resultsBody strong')).toHaveText('Unindexed compound 49');
  await page.locator('#colToggleBtn').click();
  await page.locator('#colToggleDropdown input[data-col="name"]').uncheck();
  await expect(page.locator('#resultsBody .lookup-error-cell')).toHaveAttribute('colspan', '8');
  await expect(page.locator('#resultsBody strong')).toBeVisible();
  await page.locator('#tableSearchInput').fill('no-such-filter');
  await expect(page.locator('#resultsBody tr')).toHaveCount(0);
  await expect(page.locator('#emptyState')).toContainText('No matching results');
  expect(errors).toEqual([]);
});

test('busy guard prevents overlapping clicks/keyboard batches and clears only after completion', async ({ page }) => {
  let release;
  let calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const errors = await openLookup(page, async route => {
    if (propertyIds(route)) return propertyReply(route);
    calls++;
    await gate;
    return reply(route, { IdentifierList: { CID: [101] } });
  });
  await page.locator('#cidInput').fill('Methyl ferulate');
  await page.locator('#fetchBtn').click();
  await expect(page.locator('#fetchBtn')).toBeDisabled();
  await expect(page.locator('#clearBtn')).toBeDisabled();
  await expect(page.locator('#cidInput')).toBeDisabled();
  await page.evaluate(() => { runBatch(); runBatch(); });
  release();
  await expect(page.locator('#resultsTitle')).toHaveText('1 of 1 resolved');
  expect(calls).toBe(1);
  await page.locator('#clearBtn').click();
  await expect(page.locator('#cidInput')).toHaveValue('');
  await expect(page.locator('#resultsWrap')).toBeHidden();
  await expect(page.locator('#resultsBody tr')).toHaveCount(0);
  expect(await page.evaluate(() => lastResults.length)).toBe(0);
  expect(errors).toEqual([]);
});

test('one spreadsheet export contains provenance; unresolved CSV is separate and formula-safe', async ({ page }) => {
  const errors = await openLookup(page, route => {
    if (propertyIds(route)) return propertyReply(route);
    if (route.request().url().includes('esearch.fcgi')) return emptySearch(route);
    return queryName(route) === 'Methyl ferulate' ? reply(route, { IdentifierList: { CID: [101] } }) : noMatch(route);
  });
  await run(page, ['Methyl ferulate', '=HYPERLINK("example")']);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#downloadUnresolvedBtn').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^pubchem-unresolved-.*\.csv$/);
  const csv = await fs.readFile(await download.path(), 'utf8');
  expect(csv).toContain('"Original input","Lookup query"');
  expect(csv).toContain('"\'=HYPERLINK(""example"")"');
  expect(csv).toContain('not_found');
  expect(csv).not.toContain('Methyl ferulate');

  await page.locator('#downloadBtn').click();
  await expect.poll(() => page.evaluate(() => window.__exports.length)).toBe(1);
  const exported = await page.evaluate(() => window.__exports[0].book.sheet.rows);
  expect(exported).toHaveLength(1);
  expect(exported[0]).toMatchObject({ 'Original input': 'Methyl ferulate', 'PubChem CID': '101', 'Match method': 'PubChem exact name' });
  expect(errors).toEqual([]);
});

test('500 molecules can be fetched in one batch, paginated, searched and exported', async ({ page }) => {
  const groups = [];
  const errors = await openLookup(page, route => {
    groups.push(propertyIds(route));
    return propertyReply(route);
  });
  await expect(page.locator('#countBadge')).toHaveText('0 / 500');
  await expect(page.locator('label[for="cidInput"]')).toContainText('max 500');
  const inputs = Array.from({ length: 500 }, (_, i) => String(i + 1));
  await run(page, inputs);
  await expect(page.locator('#countBadge')).toHaveText('500 / 500');
  await expect(page.locator('#countBadge')).not.toHaveClass(/over/);
  await expect(page.locator('#resultsTitle')).toHaveText('500 of 500 resolved');
  expect(groups).toHaveLength(25);
  expect(groups.every(group => group.length === 20)).toBe(true);
  expect(groups.flat()).toEqual(inputs);
  await expect(page.locator('#resultsBody tr')).toHaveCount(20);
  await expect(page.locator('#paginationInfo')).toHaveText('Showing 1–20 of 500');
  await page.locator('#paginationControls [data-page="next"]').click();
  await expect(page.locator('#paginationInfo')).toHaveText('Showing 21–40 of 500');
  await page.locator('#tableSearchInput').fill('API fixture 500');
  await expect(page.locator('#resultsBody tr')).toHaveCount(1);
  await expect(page.locator('#resultsBody .cid-cell')).toHaveText('500');
  await page.locator('#downloadBtn').click();
  await expect.poll(() => page.evaluate(() => window.__exports.length)).toBe(1);
  const exported = await page.evaluate(() => window.__exports[0].book.sheet.rows);
  expect(exported).toHaveLength(500);
  expect(exported[499]['PubChem CID']).toBe('500');
  expect(errors).toEqual([]);
});

test('501 distinct molecules are rejected before any API request', async ({ page }) => {
  let requests = 0;
  const errors = await openLookup(page, route => { requests++; return noMatch(route); });
  const inputs = Array.from({ length: 501 }, (_, i) => String(i + 1));
  await run(page, inputs);
  await expect(page.locator('#countBadge')).toHaveText('501 / 500');
  await expect(page.locator('#countBadge')).toHaveClass(/over/);
  await expect(page.locator('#stateBox')).toBeVisible();
  await expect(page.locator('#stateText')).toHaveText('Trim the list to 500 or fewer entries.');
  await expect(page.locator('#cidInput')).toHaveValue(inputs.join('\n'));
  expect(requests).toBe(0);
  await expect(page.locator('#resultsBody tr')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('file imports accept 500 entries and clearly report truncation above the limit', async ({ page }) => {
  let requests = 0;
  const errors = await openLookup(page, route => { requests++; return noMatch(route); });
  // Stub only the third-party sheet parser. Exercise the real FileReader/import UI.
  await page.evaluate(() => {
    XLSX.read = bytes => ({
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: new TextDecoder().decode(bytes).trim().split(/\r?\n/).map(value => [value]) }
    });
    XLSX.utils.sheet_to_json = sheet => sheet;
  });
  const inputs = Array.from({ length: 500 }, (_, i) => String(i + 1));
  for (const size of [500, 501]) {
    const rows = Array.from({ length: size }, (_, i) => String(i + 1));
    await page.locator('#fileInput').setInputFiles({
      name: `molecules-${size}.csv`, mimeType: 'text/csv',
      buffer: Buffer.from(['CID', ...rows].join('\n'))
    });
    await expect(page.locator('#cidInput')).toHaveValue(inputs.join('\n'));
    await expect(page.locator('#countBadge')).toHaveText('500 / 500');
    if (size === 501) {
      await expect(page.locator('.toast').filter({ hasText: 'Loaded the first 500 of 501 entries' })).toBeVisible();
      await expect(page.locator('.toast').filter({ hasText: 'Import the remaining 1 in another batch' })).toBeVisible();
    }
  }
  expect(requests).toBe(0);
  expect(errors).toEqual([]);
});
