'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = () => fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const client = () => fs.readFileSync(path.join(root, 'public', 'index.js'), 'utf8');

test('Reading runtime is deferred until a Reading-backed view is opened', () => {
  const markup = html();
  const js = client();
  for (const asset of [
    'reading-predictions-sep-2026.js',
    'reading-mock-tools.js',
    'reading-exam-player.js',
    'reading-session-timing.js',
    'reading-review.js',
    'reading-practice.js'
  ]) {
    assert.doesNotMatch(markup, new RegExp('<script[^>]+src=["\\\'][^"\\\']*' + asset.replaceAll('.', '\\\\.') + '[^"\\\']*["\\\']'));
    assert.match(js, new RegExp(asset.replaceAll('.', '\\\\.')));
  }
  assert.match(markup, /reading-fib-quality\.js/);
  assert.match(markup, /reading-fib-pattern-bank\.js/);
  assert.match(markup, /practice-catalogue\.js/);
  assert.match(js, /function ensureReadingRuntimeLoaded\(\)/);
  assert.match(js, /Preparing Reading practice/);
});

test('deferred Reading modules keep dependency order and failed loads are retryable', () => {
  const js = client();
  const ordered = [
    'reading-predictions-sep-2026.js',
    'reading-mock-tools.js',
    'reading-exam-player.js',
    'reading-session-timing.js',
    'reading-review.js',
    'reading-practice.js'
  ];
  let cursor = -1;
  for (const asset of ordered) {
    const next = js.indexOf(asset);
    assert(next > cursor, asset + ' should load after its dependencies');
    cursor = next;
  }
  assert.match(js, /script\._loadPromise = null;\s*script\.remove\(\);/);
  assert.match(js, /Reading practice could not load/);
  assert.match(js, /Progress history could not load/);
});
