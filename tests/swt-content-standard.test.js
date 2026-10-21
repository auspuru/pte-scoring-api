'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const passages = require('../passages.json');
const writing = require('../content/writing-lab.json');
const predictions = require('../content/writing-predictions-sep-2026');
const userSwt = require('../content/user-swt-predictions');
const { words, validateSwtContent } = require('../scripts/validate-swt-content');

test('original SWT passages meet the 200–300 standard and screenshot text is kept verbatim', () => {
  const result = validateSwtContent();
  assert.deepEqual(result, {
    total: 114,
    standalone: 34,
    writingLab: 4,
    prediction: 32,
    advanced: 20,
    legacy: 24,
    minimum: 110,
    maximum: 341
  });
});

test('all published SWT reference samples remain one-sentence answers', () => {
  const all = [
    ...passages.map(p => ({ id: 'standalone-' + p.id, sample: p.sampleResponse })),
    ...require('../content/swt-legacy.json').map(p => ({id:'legacy-'+p.id,sample:p.sampleResponse})),
    ...require('../content/swt-advanced.json').map(p => ({id:p.title,sample:p.sampleResponse})),
    ...require('../content/swt-advanced-revisions.json').map(p => ({id:p.title,sample:p.sampleResponse})),
    ...userSwt.passages.map(p => ({ id: 'user-standalone-' + p.id, sample: p.sampleResponse })),
    ...writing.mocks.flatMap(m => m.questions.filter(q => q.type === 'swt').map(q => ({ id:q.id, sample:q.sample }))),
    ...predictions.swt.map(q => ({ id:q.id, sample:q.sample }))
  ];
  assert.equal(all.length, 114);
  for (const row of all) {
    assert(row.sample && words(row.sample) >= 5 && words(row.sample) <= 75, row.id);
  }
});

test('prediction SWT items keep traceable source metadata', () => {
  for (const q of predictions.swt) {
    if (q.id.startsWith('pred26-user-swt-')) {
      assert.equal(q.predictionSource.provider, 'User supplied SWT prediction screenshots');
      assert.equal(q.predictionSource.week, '20 October 2026');
    } else {
      assert.equal(q.predictionSource.provider, 'PTE Nepal');
      assert.equal(q.predictionSource.week, '21-27 September 2026');
    }
    assert(q.predictionSource.sourceId);
  }
});

test('user-provided priority SWT bank starts with the two requested passages', () => {
  assert.deepEqual(userSwt.passages.slice(0,2).map(p => p.sourceNumber), [498, 108]);
  assert.equal(userSwt.passages.length, 14);
  assert.deepEqual(predictions.swt.slice(0,14).map(q => Number(q.predictionSource.sourceId)), userSwt.passages.map(p => p.sourceNumber));
  assert.equal(new Set(userSwt.passages.map(p => p.id)).size, 14);
  for (const p of userSwt.passages) assert(p.text.length > 800, p.title);
});
