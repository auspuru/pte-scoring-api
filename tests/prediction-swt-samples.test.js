'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const predictions = require('../content/writing-predictions-sep-2026');
const policy = require('../writing-lab-scoring');
const { predictionMocks, present } = require('../writing-lab');
const { validatePredictionSwtSamples, longestCopiedRun } = require('../scripts/validate-prediction-swt-samples');

test('all 35 SWT samples have valid form and September samples retain provisional coverage checks', () => {
  const result = validatePredictionSwtSamples();
  assert.equal(result.count, 35);
  assert.equal(result.userScreenshots, 17);
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

test('expanded September passages include their concluding relationships in the key and sample', () => {
  const conclusion = {
    '6000322': /review each case/,
    '6000281': /maintain/,
    '6000195': /limited military force/,
    '6000478': /lasting livelihoods/,
    '6000475': /challenge and test/,
    '6000470': /a simpler method would work better/,
    '6000469': /alternatives to driving/,
    '6000467': /improv(?:e|ing) the design/,
    '6000466': /recovery/,
    '6000465': /existing residents/,
    '6000327': /clean production.*realistic scale/,
    '6000272': /revise mistaken assumptions/,
    '6000237': /deeper shortage.*longer-term planning/,
    '6000235': /unevenly/,
    '6000222': /constructive discussion/i,
    '6000213': /independent archaeological or historical evidence/,
    '6000199': /grid planning/,
    '6000183': /shap(?:e|ed) each other|shape one another/
  };
  const september = predictions.swt.filter(q => q.predictionSource.provider === 'PTE Nepal');
  assert.equal(september.length, Object.keys(conclusion).length);
  for (const q of september) {
    const expected = conclusion[q.predictionSource.sourceId];
    assert.match(q.keyPoints.join(' '), expected, q.id + ' key');
    assert.match(q.sample, expected, q.id + ' sample');
  }
});

test('Writing Lab uses the reviewed reference for new mocks and shows the snapshot for saved mocks', () => {
  const id = 'pred26-swt-03';
  const published = predictions.swt.find(q => q.id === id);
  const mock = predictionMocks.find(paper => paper.questions.some(q => q.id === id));
  const index = mock.questions.findIndex(q => q.id === id);
  const attempt = {
    kind: 'mock', module: 'writing', testId: mock.id, status: 'active', index,
    questions: structuredClone(mock.questions), results: mock.questions.map(() => null)
  };
  assert.equal(present(attempt).questions[index].sample, undefined);
  assert.equal(present(attempt).questions[index].keyPoints, undefined);

  attempt.status = 'submitted';
  const review = present(attempt).questions[index];
  assert.deepEqual(review.keyPoints, published.keyPoints);
  assert.equal(review.sample, published.sample);
  assert.match(review.sample, /limited military force/);
  assert.doesNotMatch(review.sample, /increasingly/);

  const saved = structuredClone(attempt);
  const oldKey = ['Previously saved key.'];
  const oldSample = 'This is the previously saved sample response.';
  Object.assign(saved.questions[index], { keyPoints: oldKey, sample: oldSample });
  const oldReview = present(saved).questions[index];
  assert.deepEqual(oldReview.keyPoints, oldKey);
  assert.equal(oldReview.sample, oldSample);
  assert.equal(oldReview.text, review.text);
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
  assert(index >= 17);
  for (const sample of [Array(30).fill('astronaut').join(' ') + '.', predictions.swt[index].sample.toUpperCase()]) {
    const items = structuredClone(predictions.swt);
    items[index].sample = sample;
    assert.throws(() => validatePredictionSwtSamples(items), /sample/);
  }
});
