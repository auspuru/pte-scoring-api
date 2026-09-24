'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('master vocabulary bank is lazy-loaded instead of blocking startup', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'public', 'index.js'), 'utf8');

  assert.equal(/<script[^>]+src=["']vocab_1000\.js/.test(html), false);
  assert.match(js, /function ensureMasterVocabLoaded\(\)/);
  assert.match(js, /script\.src = 'vocab_1000\.js\?v=1'/);
  assert.match(js, /The vocabulary bank could not load/);
});
