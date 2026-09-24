'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assertProductionHtml, css } = require('../scripts/build-frontend');

const root = path.join(__dirname, '..');

test('production HTML uses local utilities instead of Tailwind Play CDN', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  assert.doesNotThrow(() => assertProductionHtml(html));
  assert.equal(/cdn\.tailwindcss\.com/i.test(html), false);
  assert.equal(/tailwind\.config\s*=/.test(html), false);
});

test('generated utility stylesheet is committed and reproducible', () => {
  const committed = fs.readFileSync(path.join(root, 'public', 'utility.css'), 'utf8');
  assert.equal(committed, css);
  for (const rule of ['.flex{display:flex}', '.p-container-padding{padding:24px}', '.w-full{width:100%}']) {
    assert.ok(committed.includes(rule), 'missing rule: ' + rule);
  }
});


test('production build minifies the portal client and loads the tiny auth boot first', () => {
  const build = fs.readFileSync(path.join(root, 'scripts', 'build-frontend.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  assert.match(build, /terser@5\.44\.0/);
  assert.match(build, /--mangle', 'false'/);
  assert.match(html, /index\.min\.js\?v=/);
  assert.doesNotMatch(html, /src="index\.js\?v=/);
  assert(html.indexOf('auth-boot.js') < html.indexOf('index.min.js'));
});
