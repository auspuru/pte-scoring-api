'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { needsResolver } = require('../essay-assessment-service');

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
