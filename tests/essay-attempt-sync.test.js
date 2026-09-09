'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sync = require('../essay-attempt-sync');

function attempt(id, date, score = 20) {
  return { id, date, questionId: 'q1', essayText: `Essay ${id}`, scores: { total: score } };
}

test('essay attempts from two devices are merged and capped without duplicates', () => {
  const merged = sync.mergeHistory(
    [attempt('a', 1000), attempt('same', 1000, 18)],
    [attempt('b', 2000), attempt('same', 3000, 22)],
    []
  );
  assert.deepEqual(merged.map(item => item.id), ['same', 'b', 'a']);
  assert.equal(merged[0].scores.total, 22);
});

test('a deletion tombstone prevents a stale device from resurrecting an attempt', () => {
  const deleted = sync.mergeDeleted([], ['old-id']);
  const merged = sync.mergeHistory(
    [attempt('old-id', 1000)],
    [attempt('new-id', 2000), attempt('old-id', 3000)],
    deleted
  );
  assert.deepEqual(merged.map(item => item.id), ['new-id']);
});

test('legacy attempts without ids still deduplicate across a cloud pull', () => {
  const legacy = { date: 1000, questionTitle: 'Question', essayText: 'same essay', scores: { total: 19 } };
  const merged = sync.mergeHistory([legacy], [{ ...legacy }], []);
  assert.equal(merged.length, 1);
});

test('user identity is case-insensitive for all sync devices', () => {
  assert.equal(sync.canonicalUserId('  Student42 '), 'student42');
});
