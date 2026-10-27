'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const P = require('../public/account-progress'), sync = require('../essay-attempt-sync');
const source = fs.readFileSync(require.resolve('../server'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
function fn(name) {
  const start = source.indexOf('function ' + name + '(');
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function database(initial, conflict) {
  let data = clone(initial), version = 1, released = 0;
  const reads = [], writes = [];
  const query = async (sql, args) => {
    if (sql.includes('SELECT CASE')) {
      reads.push({ sql, args });
      return { rows: [{ data: args[1] === String(version) ? null : clone(data), version: String(version) }] };
    }
    if (sql.startsWith('SELECT')) {
      const selected = args[1] ? Object.fromEntries(args[1].filter(k => Object.hasOwn(data, k)).map(k => [k, data[k]])) : data;
      reads.push({ fields: args[1], bytes: Buffer.byteLength(JSON.stringify(selected)) });
      return { rows: [{ data: clone(selected), version: String(version) }] };
    }
    if (sql.includes('UPDATE user_data')) {
      assert(sql.includes('AND xmin::text = $3'));
      if (conflict) { const edit = conflict; conflict = null; edit(data); version++; }
      if (String(version) !== args[2]) return { rows: [] };
      const patch = JSON.parse(args[1]); writes.push(patch); data = { ...data, ...patch }; version++;
      return { rows: [{ version: String(version) }] };
    }
    throw Error('Unexpected query: ' + sql);
  };
  const ctx = { AccountProgress: P, canonicalUserId: sync.canonicalUserId, mergeDeleted: sync.mergeDeleted,
    mergeHistory: sync.mergeHistory, console: { info() {} }, pgPool: { query,
      connect: async () => ({ query, release: () => released++ }) } };
  vm.createContext(ctx);
  const start = source.indexOf('const PgStorage = {'), end = source.indexOf('\nconst JsonStorage =', start);
  vm.runInContext(['postgresSyncFields', 'postgresProgressPatch', 'compactSyncPushResponse'].map(fn).join('\n') + '\n' +
    source.slice(start, end) + '\nthis.store = PgStorage;', ctx);
  return { store: ctx.store, reads, writes, data: () => data, released: () => released };
}
function profile() {
  return { ...P.mergeProgress({}, { attempted: [1], history: { 1: [{ timestamp: 1, overall_score: 78 }] },
    essayDraft: { essayText: 'Saved response', updatedAt: 10 } }), stats: { totalAttempts: 1, averageScore: 78 },
    practiceHistory: [{ id: 'old', date: 1, essayText: 'Saved essay' }], practiceHistoryDeleted: ['deleted'],
    // Large unrelated records deliberately must never cross the DB connection
    // during a small draft save, nor be overwritten by its projected merge.
    readingProgress: { historicalFixture: 'Saved reading feedback. '.repeat(60000) },
    privateLegacyField: { retained: true } };
}
test('a draft autosave reads under 1 KB and preserves the full unrelated account history', async () => {
  const before = profile(), db = database(before);
  const next = { essayText: 'New response', updatedAt: 20 };
  const result = await db.store.setUserData(' STUDENT ', { essayDraft: next }, { compact: true });
  assert(db.reads[0].bytes < 1024);
  assert.deepEqual(Array.from(db.reads[0].fields).sort(), ['attempted', 'essayDraft', 'stats']);
  assert.deepEqual(db.data().readingProgress, before.readingProgress);
  assert.deepEqual(db.data().practiceHistory, before.practiceHistory);
  assert.deepEqual(db.data().privateLegacyField, before.privateLegacyField);
  assert.deepEqual(db.writes, [{ essayDraft: next }]);
  assert.deepEqual(clone(result.stats), before.stats);
  assert.equal(result.attemptCount, 1);
  assert.deepEqual(clone(result.progress), { essayDraft: next });
  assert.equal(db.released(), 1);
});
test('an unchanged compact draft does not write a row or invalidate its revision', async () => {
  const before = profile(), db = database(before);
  await db.store.setUserData('student', { essayDraft: before.essayDraft }, { compact: true });
  assert.equal(db.writes.length, 0);
  assert.equal(db.reads.length, 1);
});
test('a concurrent edit forces a fresh projected merge and a newer remote draft wins', async () => {
  const db = database(profile(), data => {
    data.essayDraft = { essayText: 'Newer phone draft', updatedAt: 30 };
    data.practiceHistory.push({ id: 'phone', date: 30 });
  });
  const result = await db.store.setUserData('student', { essayDraft: { essayText: 'Older laptop', updatedAt: 20 } }, { compact: true });
  assert.equal(db.reads.length, 2);
  assert.equal(db.writes.length, 0);
  assert.equal(result.progress.essayDraft.essayText, 'Newer phone draft');
  assert(db.data().practiceHistory.some(a => a.id === 'phone'));
});
test('every compact merge matches the full-profile merge, including dependencies and deletions', async () => {
  const before = profile(); delete before.readingProgress;
  for (const delta of [
    { summaries: { 2: { text: 'New summary', timestamp: 20 } } },
    { scratch: { 1: { text: '', updatedAt: 20 } } },
    { essays: [{ id: 'topic', intro: 'New paragraph', _syncFields: { intro: 20 } }] },
    { essayLibraryDeleted: { topic: 40 } },
    { practiceHistory: [{ id: 'new', date: 20 }], practiceHistoryDeleted: ['old'] },
    { readingProgress: { version: 3, patches: [], sessionId: null, sessionSelectedAt: 0, practiceResults: { q1: { finishedAt: 20 } } } },
    { vocabProgress: { read: { word: 20 }, readUpdatedAt: { word: 20 } } },
    { studyPlan: { updatedAt: 20, targetScore: 79 }, templates: { custom: 'Template' }, quotaUsed: { essay: 1 } }
  ]) {
    const full = database(before), compact = database(before);
    const expected = await full.store.setUserData('student', delta);
    const actual = await compact.store.setUserData('student', delta, { compact: true });
    assert.deepEqual(compact.data(), full.data());
    assert.deepEqual(clone(actual.stats), clone(expected.stats));
    for (const [key, value] of Object.entries(actual.progress || {})) assert.deepEqual(clone(value), clone(expected.progress[key]), key);
  }
});
test('conditional reads omit unchanged JSON and expose a changed revision on the next read', async () => {
  const db = database(profile());
  const first = await db.store.getUserData('student', { conditional: true });
  assert.equal(first.version, '1'); assert(first.data.essayDraft);
  const unchanged = await db.store.getUserData('student', { conditional: true, version: first.version });
  assert.deepEqual(clone(unchanged), { notModified: true, version: '1' });
  await db.store.setUserData('student', { essayDraft: { essayText: 'Changed', updatedAt: 20 } }, { compact: true });
  const changed = await db.store.getUserData('student', { conditional: true, version: first.version });
  assert.equal(changed.version, '2'); assert.equal(changed.data.essayDraft.essayText, 'Changed');
});
