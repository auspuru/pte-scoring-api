'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const predictions = require('../content/writing-predictions-sep-2026');
const policy = require('../writing-lab-scoring');
const { validatePredictionSwtSamples, longestCopiedRun } = require('../scripts/validate-prediction-swt-samples');

test('all 32 SWT samples have valid form and September samples retain provisional coverage checks', () => {
  const result = validatePredictionSwtSamples();
  assert.equal(result.count, 32);
  assert.equal(result.userScreenshots, 14);
  assert.equal(result.provisionalCoverage, 18);

  for (const q of predictions.swt) {
    assert.equal(policy.formFor('swt', q.sample).score, 1, q.id);
    assert.equal(policy.sentenceCount(q.sample), 1, q.id);
    if (q.predictionSource.provider === 'PTE Nepal') {
      const local = policy.localGrade(q, q.sample);
      assert.equal(local.scores.content, 3, q.id);
      assert.equal(local.score_provisional, true, q.id);
      assert.equal(local.full_content_eligible, false, q.id);
    }
    assert.equal(q.sampleReview.teacherEditable, true, q.id);
    assert.equal(q.sampleReview.humanReview, 'pending', q.id);
  }
});

test('valid connected source wording is not rejected by a copied-run or source-opening gate', () => {
  const items = structuredClone(predictions.swt);
  const q = items.find(q => q.predictionSource.provider === 'User supplied SWT prediction screenshots');
  q.sample = q.text.split(/\s+/).slice(0,25).join(' ').replace(/[.?!]+$/, '') + '.';
  assert(longestCopiedRun(q.text, q.sample) >= 12);
  assert.equal(policy.formFor('swt', q.sample).score, 1);
  assert.doesNotThrow(() => validatePredictionSwtSamples(items));
  // Authoring form validation does not certify that a topic-only sample earns
  // full semantic Content; that remains an independent assessment.
});

test('valid 5–75-word Form is accepted without an extra 25–65 authoring gate', () => {
  for (const count of [5, 24, 66, 75]) {
    const items = structuredClone(predictions.swt);
    items[0].sample = Array(count).fill('idea').join(' ') + '.';
    assert.doesNotThrow(() => validatePredictionSwtSamples(items));
  }
  const items = structuredClone(predictions.swt);
  items[0].sample = Array(76).fill('idea').join(' ') + '.';
  assert.throws(() => validatePredictionSwtSamples(items), /one complete/);
});

test('Published sample validation rejects unrelated content in the reviewed September cohort', () => {
  const index = predictions.swt.findIndex(q => q.predictionSource.provider === 'PTE Nepal');
  assert(index >= 14);
  for (const sample of [Array(30).fill('astronaut').join(' ') + '.', predictions.swt[index].sample.toUpperCase()]) {
    const items = structuredClone(predictions.swt);
    items[index].sample = sample;
    assert.throws(() => validatePredictionSwtSamples(items), /sample/);
  }
});
