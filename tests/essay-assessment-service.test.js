'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const policy = require('../public/essay-scoring');
const { needsResolver, normalizeReview, callAndNormalizeResolver } = require('../essay-assessment-service');

test('resolver is required when full Content disagrees with near-full Content', () => {
  const primary = { diagnosticScores: { content: 6, linguistic: 6, coherence: 6 } };
  const review = { scores: { content: 5, linguistic: 6, coherence: 6 } };
  assert.equal(needsResolver(primary, review), true);
});

test('one-point non-boundary disagreement does not force resolver', () => {
  const primary = { diagnosticScores: { content: 5, linguistic: 5, coherence: 5 } };
  const review = { scores: { content: 4, linguistic: 5, coherence: 5 } };
  assert.equal(needsResolver(primary, review), false);
});


test('duplicate evidence cannot satisfy two-example review requirement', () => {
  const essay = 'Mass media supports learning because it gives students useful information and encourages discussion.';
  const raw = {
    scores: { content: 6, linguistic: 6, coherence: 6 },
    promptCoverage: [{ requirement: 'address the task', status: 'addressed', evidence: 'Mass media supports learning', nextStep: '' }],
    scoringEvidence: {
      linguisticExamples: ['Mass media supports learning', 'Mass media supports learning'],
      developmentEvidence: ['Mass media supports learning', 'Mass media supports learning']
    },
    rationale: {}
  };
  assert.throws(() => normalizeReview(raw, essay), /lacks evidence/);
});

test('duplicate evidence cannot satisfy primary full-mark evidence requirement', () => {
  const essay = 'Mass media supports learning because it gives students useful information and encourages discussion.';
  const raw = {
    scores: { content: 6, spelling: 2, grammar: 2, vocabulary: 2, linguistic: 6, coherence: 6 },
    feedback: {
      content: 'Complete.',
      spelling: 'Accurate.',
      grammar: 'Accurate.',
      vocabulary: 'Appropriate.',
      linguistic: 'Varied.',
      coherence: 'Developed.'
    },
    errors: [],
    optionalRefinements: [],
    promptCoverage: [{ requirement: 'address the task', status: 'addressed', evidence: 'Mass media supports learning', nextStep: '' }],
    scoringEvidence: {
      linguisticExamples: ['Mass media supports learning', 'Mass media supports learning'],
      developmentEvidence: ['Mass media supports learning', 'Mass media supports learning'],
      vocabularyExamples: ['useful information']
    },
    strengths: [],
    improvements: [],
    templateDetector: 'ok',
    templateEvidence: [],
    templateNote: '',
    overallVerdict: 'Strong response.'
  };
  assert.throws(() => policy.normalizeAssessment(raw, essay), /incomplete/);
});


test('resolver validation retries once before falling back', async () => {
  const essay = 'Public transport improves access and reduces congestion for many commuters.';
  const primary = {
    diagnosticScores: { content: 5, linguistic: 5, coherence: 5 },
    promptCoverage: [{ requirement: 'address transport', status: 'addressed', evidence: 'Public transport improves access', nextStep: '' }],
    scoringEvidence: { linguisticExamples: [], developmentEvidence: [] }
  };
  const review = {
    scores: { content: 3, linguistic: 5, coherence: 5 },
    promptCoverage: [{ requirement: 'address transport', status: 'partial', evidence: 'Public transport improves access', nextStep: 'Develop the answer.' }],
    scoringEvidence: { linguisticExamples: [], developmentEvidence: [] },
    rationale: {}
  };
  let calls = 0;
  const result = await callAndNormalizeResolver('Discuss public transport.', essay, primary, review, async () => {
    calls += 1;
    if (calls === 1) return {};
    return {
      scores: { content: 5, linguistic: 5, coherence: 5 },
      promptCoverage: [{ requirement: 'address transport', status: 'addressed', evidence: 'Public transport improves access', nextStep: '' }],
      scoringEvidence: { linguisticExamples: [], developmentEvidence: [] },
      rationale: {}
    };
  }, () => {});

  assert.equal(calls, 2);
  assert.equal(result.scores.content, 5);
});
