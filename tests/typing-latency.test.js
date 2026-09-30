'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/index.js', 'utf8');

test('typing counter mutations do not rescan the portal for admin entries', () => {
  let callback, scans = 0;
  const script = source.slice(source.indexOf('(function installAdminEntryRemoval()'), source.indexOf('//  STATE — Unified Client State'));
  vm.runInNewContext(script, {
    sessionStorage: { removeItem() {} },
    document: { readyState: 'loading', addEventListener() {}, documentElement: {} },
    removeAdminPortalEntry() { scans++; },
    MutationObserver: class { constructor(fn) { callback = fn; } observe() {} }
  });
  for (let i = 0; i < 300; i++) callback([{ addedNodes: [{ nodeType: 3 }] }]);
  assert.equal(scans, 0);
  callback([{ addedNodes: [{ nodeType: 1 }] }]);
  assert.equal(scans, 1);
});

test('accessibility ignores typing updates but still detects modal insertion and opening', () => {
  let callback, scans = 0;
  vm.runInNewContext(fs.readFileSync('public/portal-accessibility.js', 'utf8'), {
    window: {},
    document: { readyState: 'loading', addEventListener() {}, querySelectorAll() { scans++; return []; } },
    MutationObserver: class { constructor(fn) { callback = fn; } observe() {} }
  });
  for (let i = 0; i < 300; i++) {
    callback([{ type: 'childList', addedNodes: [{ nodeType: 3 }], removedNodes: [] }]);
    callback([{ type: 'attributes', target: { matches: () => false } }]);
  }
  assert.equal(scans, 0);
  callback([{ type: 'childList', addedNodes: [{ nodeType: 1, matches: () => true }], removedNodes: [] }]);
  callback([{ type: 'attributes', target: { matches: () => true } }]);
  assert.equal(scans, 2);
});

test('essay overlap waits for a typing pause and uses the latest response', () => {
  let pending, checks = [];
  const context = {
    practiceState: { view: 'write', essayText: '' },
    clearTimeout() { pending = null; },
    setTimeout(fn) { pending = fn; return 1; },
    updatePracticeTemplateOverlap() { checks.push(context.practiceState.essayText); }
  };
  vm.runInNewContext(source.slice(source.indexOf('let practiceOverlapTimer'), source.indexOf('function updateLiveWordCount()')), context);
  for (let i = 0; i < 300; i++) {
    context.practiceState.essayText += 'a';
    context.queuePracticeTemplateOverlap();
  }
  assert.equal(checks.length, 0);
  pending();
  assert.deepEqual(checks, ['a'.repeat(300)]);
});
