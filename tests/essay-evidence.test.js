'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const evidence = require('../essay-evidence');
const policy = require('../public/essay-scoring');

test('Numbered citations recover original punctuation, spacing and spelling without rewriting evidence', () => {
  const essay = 'Schools  support learning;\nstudent’s ideas matter.';
  const raw = { scoringEvidence:{linguisticExamples:[{span:[1,3]}],developmentEvidence:[{span:[4,6]}],vocabularyExamples:['learning;']},
    promptCoverage:[{status:'addressed',evidence_span:[1,3]}],errors:[{phrase_span:[4,4],correction:'students’'}] };
  const result = evidence.materialise(raw,essay);
  assert.equal(result.scoringEvidence.linguisticExamples[0],'Schools  support learning;');
  assert.equal(result.scoringEvidence.developmentEvidence[0],'student’s ideas matter.');
  assert.equal(result.errors[0].phrase,'student’s');
  assert.equal(result.promptCoverage[0].evidence,'Schools  support learning;');
  assert(policy.exactQuote(essay,result.scoringEvidence.linguisticExamples[0]));
  assert.deepEqual(raw.scoringEvidence.linguisticExamples,[{span:[1,3]}]);
  assert.match(evidence.instructions(essay),/scoring criteria unchanged/);
});

test('Out of bounds, reversed and invented evidence remains invalid; legacy quotations stay subject to validation', () => {
  for (const span of [[0,2],[2,1],[1,99],['1',2],[1.5,2],[],null]) {
    assert.throws(()=>evidence.materialise({scoringEvidence:{linguisticExamples:[{span}]}},'One real sentence.'),{code:'scoring_quote'});
  }
  const result=evidence.materialise({scoringEvidence:{linguisticExamples:['invented phrase']}},'One real sentence.');
  assert.equal(policy.exactQuote('One real sentence.',result.scoringEvidence.linguisticExamples[0]),'');
});
