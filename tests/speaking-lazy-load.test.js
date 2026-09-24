'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('Speaking practice is deferred until a speaking route is opened', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'public', 'index.js'), 'utf8');

  assert.equal(html.includes('speaking-practice.js'), false);
  assert.match(js, /function ensureSpeakingRuntimeLoaded\(\)/);
  assert.match(js, /speaking-practice\.js\?v=20260923-nextsteps/);
  assert.match(js, /Preparing Speaking practice/);
  assert.match(js, /data-speaking-load-retry/);
});

test('Speaking deferred-load failure can retry without losing the requested question', () => {
  const js = fs.readFileSync(path.join(root, 'public', 'index.js'), 'utf8');
  assert.match(js, /speaking\.open\(activeRoute\.speakingType, options\.speakingRequest\?\.questionId\)/);
  assert.match(js, /switchSection\(active, \{ \.\.\.options, history: 'replace' \}\)/);
});
