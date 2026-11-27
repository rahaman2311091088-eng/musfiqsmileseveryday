const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

for (const file of ['index.html', 'admet.html']) {
  test(`${file}: all inline scripts parse and local script assets exist`, () => {
    const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    let count = 0;
    for (const [, attributes, source] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const src = attributes.match(/\bsrc\s*=\s*"([^"]+)"/)?.[1];
      if (src) {
        if (!/^https?:\/\//.test(src)) assert(fs.existsSync(path.join(__dirname, '..', src)));
      } else if (source.trim()) {
        assert.doesNotThrow(() => new vm.Script(source, { filename: `${file}:inline-${++count}` }));
      }
    }
    assert(count > 0);
  });
}
