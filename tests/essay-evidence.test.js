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

test('Invalid coverage spans preserve only verified exact quotation fallback', () => {
  const essay = 'Schools support learning.';
  const raw = {promptCoverage:[{requirement:'benefit',status:'addressed',evidence_span:[99,100],evidence:'Schools support learning.'}]};
  assert.equal(evidence.materialise(raw,essay).promptCoverage[0].evidence,essay);
  raw.promptCoverage[0].evidence = 'Schools improve outcomes.';
  assert.throws(()=>evidence.materialise(raw,essay),error => error.code==='coverage_quote' && error.evidenceIssues[0].path.join('.')==='promptCoverage.0.evidence_span');
});

test('Missing coverage aliases are normalized before requiring a citation', () => {
  for (const status of ['missing', 'NOT ADDRESSED', 'not-covered', 'absent']) {
    const raw = { promptCoverage: [{ requirement: 'personal experience', status,
      evidence_span: [], nextStep: 'Include your own experience.' }] };
    const result = evidence.materialise(raw, 'Schools support learning.');
    assert.equal(result.promptCoverage[0].status, 'missing');
    assert.equal(result.promptCoverage[0].evidence, '');
    assert.equal(raw.promptCoverage[0].status, status);
  }
  const result = evidence.materialise({ promptCoverage: [{ addressed: false, evidence_span: [] }] }, 'One sentence.');
  assert.equal(result.promptCoverage[0].status, 'missing');
  for (const status of ['partial', 'partially addressed', 'addressed', 'unknown', '']) {
    assert.throws(() => evidence.materialise({ promptCoverage: [{ status, evidence_span: [] }] }, 'One sentence.'), { code: 'coverage_quote' });
  }
});

test('Targeted repair changes only citations and preserves original decisions', async () => {
  const essay='Schools support learning.';
  const raw={scores:{content:4},promptCoverage:[{requirement:'benefit',status:'partial',evidence_span:[],nextStep:'Develop the reason.'}]};
  const calls=[];
  const stages=[];
  const result=await evidence.callWithRepair(async (prompt, options)=>{
    calls.push(prompt); stages.push(options.stage);
    return calls.length===1 ? raw : {scores:{content:6},repairs:[{path:['promptCoverage',0,'evidence_span'],span:[1,3]}]};
  },'Return {"evidence":"exact essay phrase"}',essay,{stage:'subjective-review'});
  assert.equal(calls.length,2);
  assert.deepEqual(stages,['subjective-review','evidence-repair']);
  assert.match(calls[0],/"evidence_span":\[1,3\]/);
  assert.equal(result.scores.content,4);
  assert.equal(result.promptCoverage[0].status,'partial');
  assert.equal(result.promptCoverage[0].evidence,essay);
  assert.deepEqual(raw.promptCoverage[0].evidence_span,[]);
});

test('Unrepairable evidence cannot become a successful assessment', async () => {
  let calls=0;
  await assert.rejects(evidence.callWithRepair(async()=>++calls===1
    ? {promptCoverage:[{status:'addressed',evidence_span:[]}]}
    : {repairs:[{path:['promptCoverage',0,'evidence_span'],span:[]}]},'Assess','One real sentence.'),
    error=>error.code==='coverage_quote' && error.evidenceRepairExhausted);
  assert.equal(calls,2);
});
