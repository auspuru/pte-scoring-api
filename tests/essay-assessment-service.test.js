'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const policy = require('../public/essay-scoring');
const { needsResolver, normalizeReview } = require('../essay-assessment-service');

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
