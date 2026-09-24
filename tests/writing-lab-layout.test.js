'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('SWT passage stays fully visible inside the scrollable exam page', () => {
  const css = fs.readFileSync(path.join(root, 'public', 'writing-lab.css'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'public', 'writing-lab.html'), 'utf8');
  const rule = css.match(/\.passage\{[^}]*\}/)?.[0] || '';
  assert.match(rule, /max-height:none/);
  assert.match(rule, /overflow:visible/);
  assert.doesNotMatch(rule, /overflow-y:auto|max-height:37vh/);
  assert.match(html, /writing-lab\.css\?v=5/);
});

test('Prediction audio URLs are cache-busted for bundled neural recordings', () => {
  const source = fs.readFileSync(path.join(root, 'writing-lab.js'), 'utf8');
  assert.match(source, /predictions\.version \+ '-neural1'/);
});
