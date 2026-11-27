const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

// Design/navigation fixtures only. These tests never sign in to a real account
// or request a real chemical prediction.
async function open(page, { file = 'index.html', signedIn = false, storage = {} } = {}) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ signedIn, storage }) => {
    for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
    let session = signedIn ? { access_token: 'design-fixture', user: { id: 'design-fixture', email: 'researcher@example.test' } } : null;
    let notify = () => {};
    window.supabase = { createClient: () => ({
      auth: {
        onAuthStateChange: callback => { notify = callback; },
        getSession: async () => {
          if (document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
          return { data: { session } };
        },
        signInWithPassword: async () => {
          session = { access_token: 'design-fixture', user: { id: 'design-fixture', email: 'researcher@example.test' } };
          notify('SIGNED_IN', session);
          return { error: null };
        },
        signOut: async () => { session = null; notify('SIGNED_OUT', null); return { error: null }; },
        signUp: async () => ({ error: null }),
        resetPasswordForEmail: async () => ({ error: null })
      },
      from: () => {
        const chain = { select: () => chain, eq: () => chain, order: () => chain, limit: () => chain, then: resolve => resolve({ data: [], error: null }) };
        return chain;
      }
    }) };
  }, { signedIn, storage });
  await page.route('https://**/*', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route('**/api/protox/**', route => route.fulfill({ status: 404, body: 'No live provider in a design fixture.' }));
  await page.goto('/' + file);
  await page.evaluate(() => document.fonts.ready);
  if (signedIn) await expect(page.locator(file === 'index.html' ? '#appScreen' : '#admetApp')).toBeVisible();
  return errors;
}

async function signIn(page) {
  await page.locator('#authEmail').fill('researcher@example.test');
  await page.locator('#authPassword').fill('design-fixture-only');
  await page.locator('#authPassword').press('Enter');
}
const noOverflow = async (page, context) => {
  const width = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  expect(width.content, context).toBeLessThanOrEqual(width.viewport);
};

test('editorial cover uses local type and a custom mark; FAQ works with native controls', async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator('#coverTitle')).toHaveText('Follow themolecule.');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(245, 242, 233)');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', 'assets/favicon.svg');
  await expect(page.locator('.cover-nav .brand img')).toHaveAttribute('src', 'assets/ddu-mark.svg');
  expect(await page.evaluate(() => document.fonts.check('400 16px Newsreader') && document.fonts.check('400 16px "DM Sans"'))).toBe(true);
  for (const id of ['instruments', 'method', 'principles']) await expect(page.locator(`#${id}`)).toHaveCount(1);
  const question = page.locator('.cover-faq summary').filter({ hasText: 'How many compounds' });
  await question.focus(); await question.press('Enter');
  await expect(question.locator('..')).toHaveAttribute('open', '');
  await expect(question.locator('..')).toContainText('250 API queries');
  await expect(page.locator('.cover-faq')).not.toContainText('no usage limits');
  expect(await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[id]')].map(el => el.id);
    return ids.filter((id, i) => ids.indexOf(id) !== i);
  })).toEqual([]);
  expect(errors).toEqual([]);
});

test('sign-in, guest, back, signup and sign-out retain usable focus and reset the cover', async ({ page }) => {
  const errors = await open(page);
  await page.locator('#landingGuest').click();
  await expect(page.locator('#guestCode')).toBeFocused();
  await expect(page.locator('[data-mode="guest"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#guestCode').fill('wrong-fixture-code');
  await page.locator('#guestCode').press('Enter');
  await expect(page.locator('#authMsg')).toContainText('not valid');
  await page.locator('[data-mode="signup"]').click();
  await expect(page.locator('#authPassword')).toHaveAttribute('autocomplete', 'new-password');
  await page.locator('#authBack').click();
  await expect(page.locator('#landingSignIn')).toBeFocused();
  await expect(page.locator('#landingPage')).toHaveCSS('opacity', '1');
  await page.locator('#landingSignIn').click();
  await expect(page.locator('#authEmail')).toBeFocused();
  await expect(page.locator('[data-mode="signin"]')).toHaveAttribute('aria-pressed', 'true');
  await signIn(page);
  await expect(page.locator('#dashboardPanel')).toBeVisible();
  await page.locator('#signOutBtn').click();
  await expect(page.locator('#landingPage')).toBeVisible();
  await expect(page.locator('#landingPage')).toHaveCSS('opacity', '1');
  await page.locator('#landingSignIn').click();
  await expect(page.locator('#authEmail')).toBeFocused();
  expect(errors).toEqual([]);
});

test('instrument entry remembers the desired tool and filtered commands open the right panel', async ({ page }) => {
  const errors = await open(page);
  await page.locator('[data-open-panel="admetTab"]').click();
  await signIn(page);
  await expect(page.locator('#admetTab')).toBeVisible();
  await expect(page.locator('.sidebar-item[data-panel="admetTab"]')).toHaveAttribute('aria-current', 'page');
  await page.locator('#cmdTrigger').click();
  await page.locator('#cmdInput').fill('Docking Score');
  await expect(page.locator('.cmd-result-item')).toHaveCount(1);
  await page.locator('.cmd-result-item').click();
  await expect(page.locator('#dockingPanel')).toBeVisible();
  await expect(page.locator('#workspacePageName')).toHaveText('DOCKING RESULTS');
  await expect(page.locator('#cmdPalette')).toBeHidden();
  expect(errors).toEqual([]);
});

test('command palette and shortcut dialog trap focus, close on Escape, and restore their opener', async ({ page }) => {
  const errors = await open(page, { signedIn: true });
  await page.locator('#cmdTrigger').click();
  await expect(page.locator('#cmdPalette')).toHaveAttribute('role', 'dialog');
  await expect(page.locator('#cmdInput')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('[data-close-dialog="cmdPalette"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#cmdInput')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#cmdTrigger')).toBeFocused();
  await page.locator('[data-open-shortcuts]').click();
  await expect(page.locator('#kbdPanel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-open-shortcuts]')).toBeFocused();
  expect(errors).toEqual([]);
});

test('cover and all tools fit small phones, tablets and desktop; mobile navigation stays synchronized', async ({ page }) => {
  test.setTimeout(60000);
  const errors = await open(page);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page, `cover at ${width}px`);
  }
  await page.evaluate(() => showApp({ email: 'design@example.test' }));
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const panel of ['dashboardPanel', 'pubchemTab', 'admetTab', 'dockingPanel']) {
      await page.evaluate(panel => setActivePanel(panel), panel);
      await noOverflow(page, `${panel} at ${width}px`);
      const barTop = await page.locator('.workspace-bar').evaluate(el => el.getBoundingClientRect().top);
      expect(barTop).toBeGreaterThanOrEqual(0);
      expect(barTop).toBeLessThanOrEqual(1);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mobile-nav-item[data-panel="admetTab"]').click();
  await expect(page.locator('#admetTab')).toBeVisible();
  await expect(page.locator('.mobile-nav-item[data-panel="admetTab"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#admetIdentityInput')).toHaveCSS('font-size', '16px');
  await page.locator('#admetSourceDataset').scrollIntoViewIfNeeded();
  const nav = await page.locator('#mobileNav').boundingBox();
  expect(Math.round(nav.y + nav.height)).toBe(844);
  await page.locator('.mobile-nav-item[data-panel="pubchemTab"]').click();
  await expect(page.locator('#cidInput')).toBeVisible();
  await expect(page.locator('#cidInput')).toHaveCSS('font-size', '16px');
  expect(await page.evaluate(() => scrollY)).toBe(0);
  expect(errors).toEqual([]);
});

test('system reduced motion leaves all content visible without drawing or reveal animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = await open(page);
  await expect(page.locator('html')).toHaveClass(/motion-paused/);
  await expect(page.locator('.drawn-bonds')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.cover-copy')).toHaveCSS('opacity', '1');
  await expect(page.locator('.principle-main')).toHaveCSS('opacity', '1');
  await expect(page.locator('.cover-footer [data-motion-toggle]')).toBeDisabled();
  await page.locator('#landingSignIn').click();
  await expect(page.locator('#authEmail')).toBeFocused();
  expect(errors).toEqual([]);
});

test('the manual motion control persists across reloads and is shared with the workspace', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const errors = await open(page);
  await page.locator('.cover-footer [data-motion-toggle]').click();
  await expect(page.locator('html')).toHaveClass(/motion-paused/);
  expect(await page.evaluate(() => localStorage.getItem('ddu_motion'))).toBe('off');
  await page.reload();
  await expect(page.locator('.drawn-bonds')).toHaveCSS('animation-name', 'none');
  await page.evaluate(() => showApp({ email: 'design@example.test' }));
  await expect(page.locator('.workspace-actions [data-motion-toggle]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.workspace-actions [data-motion-toggle]').click();
  await expect(page.locator('html')).not.toHaveClass(/motion-paused/);
  expect(errors).toEqual([]);
});

test('standalone ADMET keeps the shared brand and allows sign-in without a redirect', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await open(page, { file: 'admet.html' });
  await expect(page.locator('#admetAuthScreen')).toBeVisible();
  await expect(page.locator('#authEmail')).toHaveCSS('font-size', '16px');
  expect(page.url()).toContain('admet.html');
  await noOverflow(page, 'standalone authentication');
  await signIn(page);
  await expect(page.locator('#admetApp')).toBeVisible();
  await expect(page.locator('.source-title')).toHaveText('ADMET evidence.');
  await expect(page.locator('.admet-top-bar .brand img')).toHaveAttribute('src', 'assets/ddu-mark.svg');
  await noOverflow(page, 'standalone ADMET');
  expect(await page.evaluate(() => DduAdmetApp.getProfiles())).toEqual([]);
  await page.locator('#signOutBtn').click();
  await expect(page.locator('#admetAuthScreen')).toBeVisible();
  expect(errors).toEqual([]);
});

test('overview and native FAQ remain readable without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.route('https://**/*', route => route.fulfill({ status: 200, body: '' }));
  await page.goto('http://127.0.0.1:4173/index.html');
  await expect(page.locator('.noscript-note')).toBeVisible();
  await expect(page.locator('.cover-copy')).toHaveCSS('opacity', '1');
  await expect(page.locator('.principle-main')).toHaveCSS('opacity', '1');
  const summary = page.locator('.cover-faq summary').first();
  await summary.click();
  await expect(summary.locator('..')).toHaveAttribute('open', '');
  await context.close();
});

test('docking sample still ranks and exports; the workbench shows completed actions rather than seeded usage', async ({ page }) => {
  const errors = await open(page, { signedIn: true, storage: { ddu_stats: '{invalid old browser storage' } });
  await expect(page.locator('#statCompounds')).toHaveText('0');
  await page.locator('#dashDocking').click();
  await page.locator('#dockingSampleBtn').click();
  await page.locator('#dockingProcessBtn').click();
  await expect(page.locator('#dockingStatProteins')).toHaveText('3');
  await expect(page.locator('#dockingResultsBody tr')).toHaveCount(9);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#dockingExportCsvBtn').click()]);
  expect(download.suggestedFilename()).toMatch(/docking_score_filter.*\.csv$/);
  await page.locator('.sidebar-item[data-panel="dashboardPanel"]').click();
  await expect(page.locator('#statWorkflows')).toHaveText('1');
  await expect(page.locator('#recentActivity')).toContainText('9 ligands ranked from 3 protein files');
  expect(errors).toEqual([]);
});

test('WCAG accessibility scan: cover, account, workbench and research tools', async ({ page }) => {
  test.setTimeout(90000);
  // Scan settled colours, not temporary intermediate opacities during reveals.
  // The normal-motion and system-preference behaviours are checked separately.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = await open(page);
  async function check(label) {
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(result.violations.map(v => ({ rule: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })), label).toEqual([]);
  }
  await check('cover');
  await page.locator('#landingSignIn').click();
  await expect(page.locator('#authEmail')).toBeVisible();
  await check('account');
  await signIn(page);
  await expect(page.locator('#appScreen')).toBeVisible();
  for (const panel of ['dashboardPanel', 'pubchemTab', 'admetTab', 'dockingPanel']) {
    await page.evaluate(panel => setActivePanel(panel), panel);
    await check(panel);
  }
  expect(errors).toEqual([]);
});
