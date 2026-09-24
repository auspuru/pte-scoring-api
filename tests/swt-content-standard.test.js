'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const passages = require('../passages.json');
const writing = require('../content/writing-lab.json');
const predictions = require('../content/writing-predictions-sep-2026');
const { words, validateSwtContent } = require('../scripts/validate-swt-content');

test('all published SWT passages meet the 200–300 word editorial standard', () => {
  const result = validateSwtContent();
  assert.deepEqual(result, {
    total: 42,
    standalone: 20,
    writingLab: 4,
    prediction: 18,
    minimum: 200,
    maximum: 300
  });
});

test('all published SWT reference samples remain one-sentence answers', () => {
  const all = [
    ...passages.map(p => ({ id: 'standalone-' + p.id, sample: p.sampleResponse })),
    ...writing.mocks.flatMap(m => m.questions.filter(q => q.type === 'swt').map(q => ({ id:q.id, sample:q.sample }))),
    ...predictions.swt.map(q => ({ id:q.id, sample:q.sample }))
  ];
  assert.equal(all.length, 42);
  for (const row of all) {
    assert(row.sample && words(row.sample) >= 5 && words(row.sample) <= 75, row.id);
  }
});

test('prediction SWT items keep traceable source metadata', () => {
  for (const q of predictions.swt) {
    assert.equal(q.predictionSource.provider, 'PTE Nepal');
    assert.equal(q.predictionSource.week, '21-27 September 2026');
    assert(q.predictionSource.sourceId);
  }
});
