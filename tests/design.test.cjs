const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');

for (const file of ['index.html', 'admet.html']) {
  test(`${file}: shared local identity, motion and typography replace the old visual theme`, () => {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(html, /href="assets\/site\.css"/);
    assert.match(html, /src="assets\/site\.js"/);
    assert.match(html, /href="assets\/favicon\.svg"/);
    assert.match(html, /src="assets\/ddu-mark\.svg"/);
    assert.match(html, /name="theme-color" content="#F5F2E9"/);
    assert.doesNotMatch(html, /fonts\.googleapis\.com|cursorGlow|landing-particles|GLOBAL_BASE_USERS|GLOBAL_BASE_RUNS|initGlobalUsageCounters/);
    assert.match(html, /<noscript>/);
    assert.match(html, /aria-live="polite"/);
  });
}

test('font assets are actual self-hosted WOFF2 files with the original licenses', () => {
  const css = fs.readFileSync(path.join(root, 'assets/site.css'), 'utf8');
  const fonts = [...css.matchAll(/url\('([^']+\.woff2)'\)/g)].map(match => match[1]);
  assert.equal(fonts.length, 4);
  for (const font of fonts) {
    const bytes = fs.readFileSync(path.join(root, 'assets', font));
    assert.equal(bytes.toString('ascii', 0, 4), 'wOF2', font);
    assert(bytes.length > 1000);
  }
  for (const license of ['DM-Sans-LICENSE.txt', 'Newsreader-LICENSE.txt', 'IBM-Plex-Mono-LICENSE.txt']) {
    assert.match(fs.readFileSync(path.join(root, 'assets/fonts', license), 'utf8'), /SIL OPEN FONT LICENSE/);
  }
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /\.motion-paused/);
  assert.match(css, /font-display:swap/);
});

test('UI enhancements parse independently and keep activity text separate from HTML', () => {
  const script = fs.readFileSync(path.join(root, 'assets/site.js'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(script, /title\.textContent = row\.label/);
  assert.match(script, /IntersectionObserver/);
  assert.match(script, /aria-modal/);
  assert.doesNotMatch(script, /requestAnimationFrame\(tick\)|setInterval\(/);
});
