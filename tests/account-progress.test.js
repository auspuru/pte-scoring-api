'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const P = require('../public/account-progress');
const essaySync = require('../essay-attempt-sync');
const bank = require('../public/reading-bank.json');
const clone = value => JSON.parse(JSON.stringify(value));
const q = { uid: 'test:q1', id: 'q1', type: 'dropdown', passage: 'One _____.', blanks: [['answer']], answers: ['answer'] };
function session(id = 'mock-a') {
  return { id, mode: 'mock', name: 'Practice mock test 1', questions: [q, { ...q, uid: 'test:q2' }], index: 0,
    startedAt: 1000, updatedAt: 1000, deadline: 1501000, answers: {}, assessments: {}, audioStates: {}, times: {}, checked: [], flags: [], done: false };
}

test('SWT merges every passage and keeps newer drafts, cleared text, scores and history', () => {
  const a = { attempted: [1], summaries: { 1: { text: 'new', timestamp: 300 } }, scores: { 1: { overall_score: 80, __timestamp: 300 } }, history: { 1: [{ text: 'new', timestamp: 300 }] } };
  const b = { attempted: [2], summaries: { 1: { text: 'old', timestamp: 100 }, 2: { text: 'other', timestamp: 200 } }, scores: { 1: { overall_score: 40, __timestamp: 100 } }, history: { 1: [{ text: 'old', timestamp: 100 }] } };
  const merged = P.mergeProgress(a, b);
  assert.deepEqual(merged.attempted, [1, 2]); assert.equal(merged.summaries[1].text, 'new'); assert.equal(merged.scores[1].overall_score, 80);
  assert.equal(merged.history[1].length, 2);
  assert.equal(P.mergeProgress(merged, { summaries: { 1: { text: '', timestamp: 400 } } }).summaries[1].text, '');
});

test('Vocabulary merges different words and attempts while an unmark survives stale sync', () => {
  const original = { read: { 'cat:a': 10 }, attempts: {} };
  const a = P.stampVocab({ read: {}, attempts: { 'cat:a': [{ sentence: 'First', ts: 20 }] } }, original, 20);
  const b = P.stampVocab({ read: { 'cat:a': 10, 'cat:b': 30 }, attempts: { 'cat:a': [{ sentence: 'Second', ts: 30 }] } }, original, 30);
  const merged = P.mergeVocab(a, b);
  assert.equal(merged.read['cat:a'], undefined); assert.equal(merged.read['cat:b'], 30); assert.equal(merged.attempts['cat:a'].length, 2);
  assert.deepEqual(P.mergeVocab(merged, original), merged);
  assert.deepEqual(P.mergeVocab(b, a), merged);
});

test('Library edits merge per paragraph and deleted topics cannot return from an old device', () => {
  const initial = [{ id: 'essay', intro: 'Original introduction', bp1: 'Original paragraph' }, { id: 'delete', intro: 'Remove' }];
  const a = P.stampLibrary([{ ...initial[0], intro: 'Phone introduction' }], initial, {}, 20);
  const b = P.stampLibrary([{ ...initial[0], bp1: 'Laptop paragraph' }, initial[1]], initial, {}, 30);
  const merged = P.mergeProgress(a, b);
  assert.equal(merged.essays.length, 1); assert.equal(merged.essays[0].intro, 'Phone introduction'); assert.equal(merged.essays[0].bp1, 'Laptop paragraph');
  assert.deepEqual(P.mergeProgress(merged, { essays: initial }).essays, merged.essays);
});

test('Removed essay drafts stay removed and unchanged navigation does not change their timestamp', () => {
  const values = new Map(), storage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) };
  const store = require('../public/portal-workspace').createDraftStore(storage);
  const draft = { view: 'write', essayText: 'My response', questionText: 'My question', timerStartedAt: 1234 };
  store.write('Student', draft); const before = store.read('student'); store.write('student', draft);
  assert.equal(store.read('student').updatedAt, before.updatedAt);
  store.remove('student'); const removed = JSON.parse([...values.values()][0]);
  assert.equal(P.mergeDraft(removed, before).deleted, true); assert.equal(store.read('student'), null);
});

test('Reading handoff merges different answers, locks Next and never extends a timer', () => {
  const original = { session: session() };
  const a = P.stampReading({ session: { ...session(), index: 1, answers: { 'test:q1': ['answer'] } } }, original, 2000);
  const b = P.stampReading({ session: { ...session(), deadline: 1900000, answers: { 'test:q1': ['wrong'], 'test:q2': ['answer'] } } }, original, 3000);
  const merged = P.mergeReading(a, b).session;
  assert.equal(merged.index, 1); assert.deepEqual(merged.answers['test:q1'], ['answer']); assert.deepEqual(merged.answers['test:q2'], ['answer']); assert.equal(merged.deadline, 1501000);
  const skipped = { ...session(), index: 1, updatedAt: 2000 };
  assert.deepEqual(P.mergeSession(skipped, b.session).answers['test:q1'], []);
});

test('Sectional handoff keeps the advanced stage and its original separate clock', () => {
  const a = { ...session(), stageIndex: 0, deadline: 11000, stages: [{ first: 0, last: 0, startedAt: 1000, deadline: 11000 }, { first: 1, last: 1 }] };
  const b = { ...clone(a), index: 1, stageIndex: 1, deadline: 16000, updatedAt: 6000 };
  b.stages[0].finishedAt = 6000; b.stages[1] = { ...b.stages[1], startedAt: 6000, deadline: 16000 };
  a.updatedAt = 10000;
  const merged = P.mergeSession(a, b);
  assert.equal(merged.stageIndex, 1); assert.equal(merged.deadline, 16000); assert.equal(merged.stages[1].startedAt, 6000);
});

test('Completed feedback and every saved result survive stale working assessments and repeated attempts', () => {
  const a = { ...session(), done: true, finishedAt: 5000, assessments: { 'test:q1': { status: 'complete', result: { feedback: 'Saved feedback' } } } };
  const b = { ...session(), updatedAt: 9000, assessments: { 'test:q1': { status: 'working' } } };
  const history = Array.from({ length: 80 }, (_, i) => ({ ...clone(a), id: 'history-' + i, finishedAt: 5000 + i }));
  const merged = P.mergeReading({ session: a, history }, { session: b });
  assert.equal(merged.history.length, 81); assert.equal(merged.session.done, true); assert.equal(merged.session.assessments['test:q1'].status, 'complete');
  const packed = P.packReading(merged);
  assert.equal(packed.questionPool.length, 2); assert.deepEqual(P.unpackReading(packed), merged);
  assert(JSON.stringify(packed).length < JSON.stringify(merged).length);
});

test('Concurrent different mocks remain resumable and library practice completion is additive', () => {
  const a = { session: session('phone'), sessionSelectedAt: 10, practiceResults: { 'dropdown:1': { earned: 3, finishedAt: 10 } } };
  const b = { session: session('laptop'), sessionSelectedAt: 20, practiceResults: { 'hiw:2': { earned: 6, finishedAt: 20 } } };
  const merged = P.mergeReading(a, b);
  assert.equal(merged.session.id, 'laptop'); assert.equal(merged.drafts[0].id, 'phone'); assert.equal(Object.keys(merged.practiceResults).length, 2);
});

test('Answer deltas preserve concurrent answers and fit the unload keepalive budget without repeating passages', () => {
  const large = { ...session(), questions: Array.from({ length: 30 }, (_, i) => ({ ...q, uid: 'q' + i, passage: 'A long passage. '.repeat(200) })) };
  const base = P.mergeProgress({}, { readingProgress: { session: large } });
  const phone = P.mergeProgress({}, { readingProgress: P.stampReading({ session: { ...large, answers: { q0: ['answer'] } } }, { session: large }, 2000) });
  const laptop = P.mergeProgress({}, { readingProgress: P.stampReading({ session: { ...large, answers: { q1: ['answer'] } } }, { session: large }, 3000) });
  const delta = P.progressDelta(base, phone);
  assert(Buffer.byteLength(JSON.stringify(delta)) < 4000);
  assert(!JSON.stringify(delta).includes('A long passage'));
  const merged = P.unpackReading(P.mergeProgress(laptop, delta).readingProgress);
  assert.deepEqual(merged.session.answers.q0, ['answer']); assert.deepEqual(merged.session.answers.q1, ['answer']);
});

const serverSource = fs.readFileSync(require.resolve('../server'), 'utf8');
function backend() {
  let data = { users: {}, global: { totalAttempts: 0 } };
  const context = { AccountProgress: P, canonicalUserId: essaySync.canonicalUserId, mergeDeleted: essaySync.mergeDeleted, mergeHistory: essaySync.mergeHistory,
    fs: { readFile: async () => JSON.stringify(data) }, STORAGE_FILE: 'test-only', safeWriteJSON: async (_, value) => { await Promise.resolve(); data = clone(value); } };
  vm.createContext(context);
  const start = serverSource.indexOf('const JsonStorage = {'), end = serverSource.indexOf('const StorageAPI =', start);
  vm.runInContext(serverSource.slice(start, end) + '\nthis.store = JsonStorage;', context);
  return context.store;
}

test('Actual server storage serializes simultaneous sync writes and preserves every progress area', async () => {
  const store = backend();
  await Promise.all([
    store.setUserData(' Student ', { readingProgress: { session: session('phone') }, vocabProgress: { read: { wordA: 10 } } }),
    store.setUserData('student', { readingProgress: { session: session('laptop') }, vocabProgress: { read: { wordB: 20 } }, essayDraft: { essayText: 'Draft', updatedAt: 20 } }),
    store.setUserData('other', { essayDraft: { essayText: 'Other account', updatedAt: 30 } })
  ]);
  const saved = await store.getUserData('STUDENT'), reading = P.unpackReading(saved.readingProgress);
  assert.equal(Object.keys(saved.vocabProgress.read).length, 2); assert.equal(reading.drafts.length, 1); assert.equal(saved.essayDraft.essayText, 'Draft');
  assert.equal((await store.getUserData('other')).essayDraft.essayText, 'Other account');
});

test('Both sync and legacy progress routes require the matching account token', () => {
  for (const method of ['get', 'post']) for (const route of ['sync', 'progress']) assert(serverSource.includes(`app.${method}('/api/${route}/:userId', requireSyncAuth,`));
  const start = serverSource.indexOf('function requireSyncAuth('), end = serverSource.indexOf('\n}', start) + 2;
  const ctx = { verifySessionToken: token => token === 'student-token' ? 'student' : null, verifyImpersonationToken: () => null };
  vm.createContext(ctx); vm.runInContext(serverSource.slice(start, end), ctx);
  for (const [token, userId, expected] of [['', 'student', 401], ['student-token', 'other', 403], ['student-token', 'STUDENT', 200]]) {
    let status = 200, passed = false;
    ctx.requireSyncAuth({ headers: { 'x-session-token': token }, query: {}, params: { userId } }, { status: code => { status = code; return { json() {} }; } }, () => { passed = true; });
    assert.equal(status, expected); assert.equal(passed, expected === 200);
  }
});

const clientSource = fs.readFileSync(require.resolve('../public/index'), 'utf8');
function clientFunction(name) {
  let start = clientSource.indexOf('async function ' + name + '(');
  if (start < 0) start = clientSource.indexOf('function ' + name + '(');
  assert(start >= 0, name);
  return clientSource.slice(start, clientSource.indexOf('\n}', start) + 2);
}
function device(store, owner = 'student') {
  const values = new Map(), requests = [], statuses = [], timers = [];
  let offline = false;
  const host = { hidden: false, innerHTML: '', replaceChildren() { this.innerHTML = ''; }, querySelector: () => null, querySelectorAll: () => [] };
  const ctx = { currentUserId: owner, sessionToken: owner + '-token', currentUser: { uid: owner }, userProfile: { vocabProgress: {}, practiceHistory: [], templates: {} },
    essays: [], currentId: null, attempted: new Set(), currentPassageId: 1, currentVocabCategory: null, practiceState: { view: 'welcome' }, practiceSubmissionPending: false, portalDraftRevision: 0,
    syncQueued: false, syncInFlight: null, syncInFlightSession: null, syncTimer: null, syncRetryCount: 0, SYNC_MAX_RETRIES: 2, lastSyncOk: true, offlineMode: false,
    practiceHistoryDeleted: [], practiceRefreshInFlight: null, lastPracticeRefreshAt: 0, API_URL: '', BAND6_TEMPLATE: '', BAND9_TEMPLATE: '',
    document: { visibilityState: 'visible', hidden: false, activeElement: null, getElementById: id => id === 'readingPane' ? host : null },
    localStorage: { getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, v) }, AbortSignal, Date,
    console: { error() {} }, setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, confirm: () => true,
    canonicalClientUserId: essaySync.canonicalUserId, mergePracticeHistoryClient: essaySync.mergeHistory, mergePracticeDeletedClient: essaySync.mergeDeleted,
    todayStamp: () => '2026-09-11', safeLSRemove() {}, cachePracticeHistory() {}, getCurrent: () => ctx.essays.find(e => e.id === ctx.currentId),
    setSync: (state, text) => { statuses.push([state, text]); ctx.ReadingPractice?.setSyncStatus(state, text); },
    fetch: async (url, options = {}) => {
      if (url.startsWith('reading-bank')) return { ok: true, json: async () => clone(bank) };
      requests.push({ url, options });
      if (offline) throw Error('Offline');
      const uid = decodeURIComponent(url.split('/').at(-1));
      if (options.headers?.['x-session-token'] !== uid + '-token') return { ok: false, status: 403, json: async () => ({}) };
      const result = options.method === 'POST' ? await store.setUserData(uid, JSON.parse(options.body)) : { success: true, data: await store.getUserData(uid) };
      return { ok: true, status: 200, json: async () => clone(result) };
    }
  };
  ctx.window = ctx;
  for (const name of ['renderList', 'loadCurrent', 'renderPreview', 'renderVocabMain', 'updateVocabProgressSummary', 'updatePortalResume', 'updateDashboard', 'renderPracticeHistory', 'updatePracticeStats', 'handleAuthExpired']) ctx[name] = () => {};
  ctx.LocalStore = { get: k => { try { return JSON.parse(values.get(k) || 'null'); } catch (_) { return null; } }, set: (k, v) => { values.set(k, JSON.stringify(v)); return true; } };
  ctx.getPracticeHistory = () => ctx.userProfile.practiceHistory;
  vm.createContext(ctx);
  for (const name of ['account-progress', 'reading-mock-tools', 'reading-exam-player', 'reading-session-timing', 'reading-review', 'reading-practice']) vm.runInContext(fs.readFileSync(require.resolve('../public/' + name), 'utf8'), ctx);
  vm.runInContext('const accountProgressMemory = new Map(); const accountCloudSnapshot = new Map();\n' +
    ['localAccountProgress', 'cacheAccountProgress', 'captureAccountProgress', 'receiveAccountProgress', 'accountSyncPayload', 'queueSync', 'flushSync', 'flushSyncDirect', 'refreshPracticeHistory', 'resumeAccountSync'].map(clientFunction).join('\n'), ctx);
  const click = dataset => host.onclick({ target: { closest: () => ({ dataset, disabled: false, setAttribute() {} }) } });
  return { ctx, host, values, requests, statuses, timers, click, offline(value) { offline = value; } };
}

test('Two real client coordinators sync library practice answers, results, SWT, essays and vocabulary', async () => {
  const store = backend(), phone = device(store), laptop = device(store);
  await phone.ctx.ReadingPractice.open();
  const item = bank.practiceLibraries.find(l => l.id === 'dropdown').questions[0];
  await phone.click({ practiceUid: item.uid });
  phone.host.onchange({ target: { dataset: { answer: '0' }, value: item.answers[0] } });
  phone.click({ action: 'submit' });
  phone.ctx.LocalStore.set('pte_student_summaries', { 1: { text: 'A phone SWT draft', timestamp: 20 } });
  phone.ctx.LocalStore.set('ipt_essay_draft_v1:student', { version: 1, essayText: 'Essay draft from my phone', questionText: 'A question', updatedAt: 20 });
  phone.ctx.essays = [{ id: 'topic', intro: 'Written on my phone' }];
  phone.ctx.userProfile.vocabProgress = { read: { wordA: 20 }, attempts: {} };
  phone.ctx.queueSync(); assert.equal(await phone.ctx.flushSync(), true);
  assert.equal(await laptop.ctx.refreshPracticeHistory({ force: true }), true);
  await laptop.ctx.ReadingPractice.open();
  const saved = P.unpackReading(laptop.ctx.localAccountProgress().readingProgress);
  assert.equal(saved.history.length, 1); assert.equal(saved.session.done, true); assert.equal(saved.practiceResults[item.uid].earned, 1);
  assert.deepEqual(saved.session.answers[item.uid], [item.answers[0]]); assert.match(laptop.host.innerHTML, /Session complete/);
  assert.equal(laptop.ctx.localAccountProgress().summaries[1].text, 'A phone SWT draft');
  assert.equal(laptop.ctx.localAccountProgress().essayDraft.essayText, 'Essay draft from my phone');
  assert.equal(laptop.ctx.essays[0].intro, 'Written on my phone'); assert.equal(laptop.ctx.userProfile.vocabProgress.read.wordA, 20);
});

test('Offline progress remains queued, survives reload and merges on reconnect without erasing another device', async () => {
  const store = backend(), phone = device(store), laptop = device(store);
  phone.ctx.userProfile.vocabProgress = { read: { phoneWord: 20 } };
  phone.offline(true); phone.ctx.queueSync(); assert.equal(await phone.ctx.flushSync(), false);
  assert.equal(phone.ctx.LocalStore.get('pte_student_syncPending'), true);
  laptop.ctx.userProfile.vocabProgress = { read: { laptopWord: 30 } }; laptop.ctx.queueSync(); assert.equal(await laptop.ctx.flushSync(), true);
  const reopened = device(store);
  for (const [k, v] of phone.values) reopened.values.set(k, v);
  reopened.ctx.userProfile.vocabProgress = reopened.ctx.localAccountProgress().vocabProgress;
  await reopened.ctx.resumeAccountSync();
  assert.equal(reopened.ctx.LocalStore.get('pte_student_syncPending'), false);
  const cloud = await store.getUserData('student'); assert.equal(cloud.vocabProgress.read.phoneWord, 20); assert.equal(cloud.vocabProgress.read.laptopWord, 30);
});

test('Local-only Reading records migrate on login and stay isolated when the account changes', async () => {
  const store = backend(), browser = device(store);
  browser.values.set('ipt_reading_v1:student', JSON.stringify({ session: session(), history: [], practiceResults: { 'hiw:old': { earned: 6, finishedAt: 2000 } } }));
  await browser.ctx.refreshPracticeHistory({ force: true }); browser.ctx.queueSync(); await browser.ctx.flushSync();
  assert.equal(P.unpackReading((await store.getUserData('student')).readingProgress).practiceResults['hiw:old'].earned, 6);
  browser.ctx.currentUserId = 'other'; browser.ctx.sessionToken = 'other-token'; browser.ctx.essays = []; browser.ctx.userProfile = { vocabProgress: {}, practiceHistory: [], templates: {} };
  await browser.ctx.refreshPracticeHistory({ force: true }); await browser.ctx.ReadingPractice.open();
  assert.equal(browser.ctx.localAccountProgress().readingProgress.session, null); assert.doesNotMatch(browser.host.innerHTML, /Continue session/);
});
