'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sync = require('../essay-attempt-sync');
const source = fs.readFileSync(path.join(__dirname, '../public/index.js'), 'utf8');
function fn(name) {
  let start = source.indexOf('async function ' + name + '(');
  if (start < 0) start = source.indexOf('function ' + name + '(');
  assert(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
const a = (id, date = 1) => ({ id, date, essayText: 'Essay ' + id, scores: { total: 20 } });
function harness() {
  const requests = [], statuses = [], caches = [], timers = [];
  const ctx = {
    currentUserId: 'student', sessionToken: 'session-a', syncQueued: true, syncInFlight: null, syncInFlightSession: null,
    syncTimer: null, syncRetryCount: 0, SYNC_MAX_RETRIES: 3, lastSyncOk: true, offlineMode: false,
    practiceRefreshInFlight: null, lastPracticeRefreshAt: 0,
    userProfile: { practiceHistory: [a('local')], templates: {} }, practiceHistoryDeleted: [],
    essays: [{ id: 'draft', intro: 'An unsaved paragraph' }], currentId: 'draft', attempted: new Set(),
    BAND6_TEMPLATE: '', BAND9_TEMPLATE: '', API_URL: '',
    console: { error() {} }, document: { visibilityState: 'visible', getElementById: () => null },
    canonicalClientUserId: sync.canonicalUserId, mergePracticeHistoryClient: sync.mergeHistory,
    mergePracticeDeletedClient: sync.mergeDeleted, todayStamp: () => '2026-09-09',
    LocalStore: { get: () => ({}), set() {} }, safeLSRemove() {},
    setSync: (...args) => statuses.push(args), cachePracticeHistory: (...args) => caches.push(args),
    renderPracticeHistory() {}, updatePracticeStats() {}, updateDashboard() {}, handleAuthExpired() {},
    setTimeout: callback => { timers.push(callback); return timers.length; }, clearTimeout() {},
    fetch: (url, options) => new Promise(resolve => requests.push({ url, options,
      payload: options.body ? JSON.parse(options.body) : undefined,
      reply: body => resolve({ ok: true, status: 200, json: async () => body }),
      fail: () => resolve({ ok: false, status: 503, json: async () => ({}) }) }))
  };
  ctx.getPracticeHistory = () => ctx.userProfile.practiceHistory;
  vm.createContext(ctx);
  vm.runInContext(['flushSync', 'flushSyncDirect', 'refreshPracticeHistory'].map(fn).join('\n'), ctx);
  return { ctx, requests, statuses, caches, timers };
}
async function until(predicate) {
  for (let i = 0; i < 30 && !predicate(); i++) await new Promise(resolve => setImmediate(resolve));
  assert(predicate(), 'Expected async state change');
}

test('An immediate attempt save waits for a second write if an older sync is in flight', async () => {
  const { ctx, requests, statuses } = harness();
  const first = ctx.flushSync();
  assert.equal(requests.length, 1);
  ctx.userProfile.practiceHistory.push(a('new', 2));
  ctx.syncQueued = true;
  let newSaved = false;
  const second = ctx.flushSync().then(result => { newSaved = true; return result; });
  assert.equal(requests.length, 1);
  requests[0].reply({ success: true, practiceHistory: [a('local')], practiceHistoryDeleted: [] });
  await until(() => requests.length === 2);
  assert.equal(newSaved, false, 'Old request must not acknowledge an attempt it never sent');
  assert(requests[1].payload.practiceHistory.some(item => item.id === 'new'));
  assert(!statuses.some(([state]) => state === 'synced'));
  requests[1].reply({ success: true, practiceHistory: requests[1].payload.practiceHistory, practiceHistoryDeleted: [] });
  assert.equal(await first, true); assert.equal(await second, true);
  assert.equal(statuses.at(-1)[0], 'synced');
  assert.equal(ctx.syncQueued, false);
});

test('A sync response from a previous account cannot contaminate or block the next account', async () => {
  const { ctx, requests, caches } = harness();
  const old = ctx.flushSync();
  ctx.currentUserId = 'other'; ctx.sessionToken = 'session-b';
  ctx.userProfile = { practiceHistory: [a('other-essay')], templates: {} };
  ctx.syncQueued = true;
  const next = ctx.flushSync();
  requests[0].reply({ success: true, practiceHistory: [a('private-old-essay')] });
  await until(() => requests.length === 2);
  assert.equal(await old, false);
  assert.equal(caches.length, 0);
  assert.equal(requests[1].url, '/api/sync/other');
  assert.equal(requests[1].options.headers['x-session-token'], 'session-b');
  assert(!requests[1].payload.practiceHistory.some(item => item.id === 'private-old-essay'));
  requests[1].reply({ success: true, practiceHistory: [a('other-essay')] });
  assert.equal(await next, true);
});

test('A failed save stays queued until a later retry succeeds', async () => {
  const { ctx, requests } = harness();
  const first = ctx.flushSync(); requests[0].fail();
  assert.equal(await first, false);
  assert.equal(ctx.syncQueued, true);
  const retry = ctx.flushSync();
  requests[1].reply({ success: true, practiceHistory: [a('local')] });
  assert.equal(await retry, true);
  assert.equal(ctx.syncQueued, false);
});

test('Refreshing another device’s attempts merges history and deletions without replacing the open draft', async () => {
  const { ctx, requests } = harness();
  ctx.syncQueued = false;
  ctx.userProfile.practiceHistory.push(a('deleted'));
  const draft = JSON.stringify(ctx.essays);
  const refresh = ctx.refreshPracticeHistory();
  requests[0].reply({ success: true, data: { practiceHistory: [a('remote', 2)], practiceHistoryDeleted: ['deleted'],
    essays: [{ id: 'draft', intro: 'Old cloud draft' }] } });
  assert.equal(await refresh, true);
  assert.deepEqual(Array.from(ctx.userProfile.practiceHistory, item => item.id), ['remote', 'local']);
  assert.equal(JSON.stringify(ctx.essays), draft);
});

test('A refresh finishing after sign-out does not repopulate private history', async () => {
  const { ctx, requests, caches } = harness();
  const refresh = ctx.refreshPracticeHistory();
  ctx.currentUserId = ''; ctx.sessionToken = ''; ctx.userProfile = null;
  requests[0].reply({ success: true, data: { practiceHistory: [a('private')] } });
  assert.equal(await refresh, false); assert.equal(caches.length, 0);
});

test('The shared sync helper has an explicit executable-JavaScript route', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const browserSource = fs.readFileSync(path.join(__dirname, '../essay-attempt-sync.js'), 'utf8');
  const htmlSource = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.match(serverSource, /app\.get\('\/essay-attempt-sync\.js'/);
  assert.match(serverSource, /sendFile\([^\n]*essay-attempt-sync\.js/);
  assert.match(htmlSource, /src="essay-attempt-sync\.js\?v=/);
  assert.match(browserSource, /root\.EssayAttemptSync/);
  const browser = {};
  vm.runInNewContext(browserSource, browser);
  assert.equal(typeof browser.EssayAttemptSync.mergeHistory, 'function');
  assert.equal(browser.EssayAttemptSync.canonicalUserId(' Student '), 'student');
});
