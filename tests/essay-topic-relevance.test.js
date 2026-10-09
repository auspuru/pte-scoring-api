'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../public/essay-scoring');
const { createEssayGrader, essayResultForClient } = require('../essay-grading');
const { question: mediaQuestion, essay: mediaEssay } = require('./essay-fixtures');

const transportQuestion = 'Some people believe that urban councils should invest in public transport rather than expanding roads. Discuss both views and give your opinion.';
const fishingQuestion = 'Some people believe legal restrictions on deep-sea commercial fishing are necessary to protect marine ecosystems. Discuss the benefits and drawbacks of these restrictions and give your opinion.';
const missing = requirement => ({ requirement, status: 'missing', evidence_span: [], nextStep: 'Explain ' + requirement + ' with a relevant reason.' });
const relevance = (status, evidence = '', reason = 'This essay discusses media rather than the requested topic.') => ({ status, evidence, reason });
function primary(taskRelevance, content, coverage) {
  return {
    scores: { content, form: 2, spelling: 2, grammar: 2, vocabulary: 2, linguistic: 5, coherence: 5 },
    taskRelevance, promptCoverage: coverage,
    feedback: Object.fromEntries(Object.keys(policy.MAXIMA).map(key => [key, 'Diagnostic feedback for ' + key + '.'])),
    errors: [], optionalRefinements: [],
    scoringEvidence: { linguisticExamples: ['mass media supports learning'], developmentEvidence: ['News reports help students understand events'], vocabularyExamples: ['critical reading'] },
    strengths: [], improvements: [], templateDetector: 'ok', templateEvidence: [], templateNote: '', overallVerdict: 'Original assessment.'
  };
}
function review(raw) {
  return { scores: { content: raw.scores.content, linguistic: 5, coherence: 5 }, taskRelevance: raw.taskRelevance,
    promptCoverage: raw.promptCoverage, scoringEvidence: raw.scoringEvidence,
    rationale: { content: raw.taskRelevance.reason, linguistic: 'Controlled language.', coherence: 'Logical structure.' } };
}
function sample() {
  return { sampleStatus: 'ready', sampleResponse: mediaEssay, sampleSourceIdeas: ['mass media supports learning'], sampleNote: '' };
}

test('two reviewers proposing Content 1 for a wholly unrelated essay cannot retain language marks', async () => {
  for (const question of [transportQuestion, fishingQuestion]) {
    const raw = primary(relevance('off_topic'), 1, [missing('both views'), missing('your opinion')]);
    const stages = [];
    const grader = createEssayGrader(async (prompt, options) => {
      stages.push(options?.stage || 'sample');
      assert.match(prompt, /Wholly unrelated responses receive 0, never a consolation Content 1/);
      assert(prompt.includes(question));
      return options.stage === 'assessment' ? raw : review(raw);
    });
    const result = await grader.grade(question, mediaEssay);
    assert.equal(result.scores.total, 0);
    assert.equal(result.scoreGate.status, 'zero_content');
    for (const key of Object.keys(policy.MAXIMA)) assert.equal(result.scores[key], 0);
    assert.equal(result.diagnosticScores.grammar, 2);
    assert.equal(result.diagnosticScores.form, 2);
    assert.equal(result.taskRelevance.status, 'off_topic');
    assert.equal(result.subjectiveReview.independent.content, 0);
    assert.equal(result.subjectiveReview.independentRelevance.status, 'off_topic');
    assert.equal(result.sampleStatus, 'needs-ideas');
    assert.equal(result.sampleResponse, '');
    assert.match(result.sampleNote, /both views/);
    assert.deepEqual(stages, ['assessment', 'subjective-review']);
    assert.deepEqual(policy.normalizeResult(result, mediaEssay), result);
    assert.equal(policy.normalizeResult(essayResultForClient(result, 'essay-unified-2.2'), mediaEssay).scores.total, 0);
    assert.deepEqual(await grader.grade(question, mediaEssay), result);
    assert.equal(stages.length, 2);
  }
});

test('minimal genuine relevance can retain Content 1 even when the requested parts are missing', async () => {
  const essay = mediaEssay.replace('The topic of mass media', 'Public transport can help people reach work. The topic of mass media');
  for (const proposedContent of [0, 1]) {
    const raw = primary(relevance('minimal', 'Public transport can help people reach work.', 'A transport benefit is present, but neither comparison nor opinion is developed.'), proposedContent,
      [missing('both views'), missing('your opinion')]);
    const grader = createEssayGrader(async (_prompt, options) => options?.stage === 'assessment' ? raw
      : options?.stage === 'subjective-review' ? review(raw)
        : { sampleStatus: 'needs-ideas', sampleResponse: '', sampleSourceIdeas: [], sampleNote: 'Add a comparison of public transport and road expansion, and your position.' });
    const result = await grader.grade(transportQuestion, essay);
    assert.equal(result.scores.content, 1);
    assert.equal(result.scores.total, 19);
    assert.equal(result.scoreGate.status, 'valid');
  }
});

test('valid paraphrases and a missing requested opinion keep their assessed marks', async () => {
  const cases = [
    { content: 6, coverage: [{ requirement: 'positive and negative effects', status: 'addressed', evidence: 'unrealistic expectations', nextStep: '' }] },
    { content: 4, coverage: [{ requirement: 'positive and negative effects', status: 'addressed', evidence: 'unrealistic expectations', nextStep: '' }, missing('your opinion')] }
  ];
  for (const item of cases) {
    const raw = primary(relevance('relevant', 'Advertisements often connect expensive products with happiness or popularity', 'The essay explains how commercial messages influence young audiences.'), item.content, item.coverage);
    const stages = [];
    const grader = createEssayGrader(async (_prompt, options) => {
      stages.push(options?.stage || 'sample');
      return options?.stage === 'assessment' ? raw : options?.stage === 'subjective-review' ? review(raw) : sample();
    });
    const result = await grader.grade(mediaQuestion + (item.content === 4 ? ' Give your opinion.' : ''), mediaEssay);
    assert.equal(result.scores.content, item.content);
    assert.equal(result.scores.total, item.content + 18);
    assert.equal(result.scoreGate.status, 'valid');
    assert.deepEqual(stages, ['assessment', 'subjective-review', 'sample']);
  }
});

test('missing relevance decisions retry and cannot publish or cache an incomplete score', async () => {
  const raw = primary(relevance('relevant', 'mass media supports learning', 'An educational effect of media is explained.'), 5,
    [{ requirement: 'effects', status: 'addressed', evidence: 'mass media supports learning', nextStep: '' }]);
  const incomplete = structuredClone(raw); delete incomplete.taskRelevance;
  let primaryCalls = 0;
  const grader = createEssayGrader(async (prompt, options) => {
    if (options?.stage === 'assessment') {
      primaryCalls++;
      if (primaryCalls === 2) assert.match(prompt, /VALIDATION RETRY: Return taskRelevance/);
      return primaryCalls <= 2 ? incomplete : raw;
    }
    return options?.stage === 'subjective-review' ? review(raw) : sample();
  });
  await assert.rejects(grader.grade(mediaQuestion, mediaEssay), { code: 'task_relevance' });
  assert.equal((await grader.grade(mediaQuestion, mediaEssay)).scores.content, 5);
  assert.equal(primaryCalls, 3);
});

test('missing independent relevance cannot release the primary score', async () => {
  const raw = primary(relevance('relevant', 'mass media supports learning', 'Media learning benefits are discussed.'), 5,
    [{ requirement: 'effects', status: 'addressed', evidence: 'mass media supports learning', nextStep: '' }]);
  const incomplete = review(raw); delete incomplete.taskRelevance;
  let reviewCalls = 0;
  const grader = createEssayGrader(async (_prompt, options) => {
    if (options.stage === 'assessment') return raw;
    reviewCalls++; return incomplete;
  });
  await assert.rejects(grader.grade(mediaQuestion, mediaEssay), { code: 'task_relevance' });
  assert.equal(reviewCalls, 2);
});

test('contradictory off-topic coverage and inflated minimal relevance are rejected', () => {
  const addressed = [{ requirement: 'effects', status: 'addressed', evidence: 'mass media supports learning', nextStep: '' }];
  assert.throws(() => policy.normalizeAssessment(primary(relevance('off_topic'), 1, addressed), mediaEssay, { requireTaskRelevance: true }), { code: 'relevance_coverage' });
  assert.throws(() => policy.normalizeAssessment(primary(relevance('minimal', 'mass media supports learning', 'One relevant idea.'), 5, addressed), mediaEssay, { requireTaskRelevance: true }), { code: 'relevance_score' });
});

test('a zero-versus-positive relevance disagreement still requires a resolver before releasing a score', async () => {
  const raw = primary(relevance('off_topic'), 1, [missing('both views'), missing('your opinion')]);
  const weak = review(primary(relevance('minimal', 'mass media supports learning', 'The reviewer claims a weak connection.'), 1, raw.promptCoverage));
  const stages = [];
  const grader = createEssayGrader(async (prompt, options) => {
    stages.push(options.stage);
    if (options.stage === 'assessment') return raw;
    if (options.stage === 'subjective-review') return weak;
    assert.match(prompt, /TASK RELEVANCE BEFORE SCORING/);
    return review(raw);
  });
  const result = await grader.grade(transportQuestion, mediaEssay);
  assert.equal(result.scores.total, 0);
  assert.equal(result.subjectiveReview.source, 'resolver');
  assert.deepEqual(stages, ['assessment', 'subjective-review', 'subjective-resolver']);
});

test('historical saved assessments without relevance remain readable', () => {
  const raw = primary(relevance('relevant', 'mass media supports learning', 'Media effects.'), 5,
    [{ requirement: 'effects', status: 'addressed', evidence: 'mass media supports learning', nextStep: '' }]);
  delete raw.taskRelevance;
  assert.equal(policy.normalizeResult({ ...raw, ...sample() }, mediaEssay).scores.content, 5);
});
