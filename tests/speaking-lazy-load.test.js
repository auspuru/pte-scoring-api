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
  assert.match(js, /speaking-practice\.js\?v=20260930-catalogue-filters-v9/);
  assert.match(js, /Preparing Speaking practice/);
  assert.match(js, /data-speaking-load-retry/);
});

test('Speaking deferred-load failure can retry without losing the requested question', () => {
  const js = fs.readFileSync(path.join(root, 'public', 'index.js'), 'utf8');
  assert.match(js, /speaking\.open\(activeRoute\.speakingType, options\.speakingRequest\?\.questionId\)/);
  assert.match(js, /switchSection\(active, \{ \.\.\.options, history: 'replace' \}\)/);
});

test('Speaking styles and portal bundle are cache-busted with the delivery UI release', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  assert.match(html, /speaking-practice\.css\?v=7/);
  assert.match(html, /index\.min\.js\?v=20260930-speaking-catalogue-filters-v9/);
});


test('Speaking question counts remain visible in the Practice hub while the runtime stays lazy', () => {
  const js = fs.readFileSync(path.join(root, 'public', 'index.js'), 'utf8');
  assert.match(js, /\/api\/speaking\/catalog/);
  assert.match(js, /ra:'speaking-ra'.*rs:'speaking-rs'.*di:'speaking-di'.*rl:'speaking-rl'.*sgd:'speaking-sgd'.*rts:'speaking-rts'/s);
  assert.match(js, /result\.practice\[route\]\.count=count/);
  assert.match(js, /\/api\/speaking\/attempts/);
  assert.match(js, /setLatestPracticeMeta\(result\.practice,route,practiceLastTime\(attempt\)\)/);
});
