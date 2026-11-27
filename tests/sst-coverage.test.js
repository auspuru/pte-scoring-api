'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const scoring = require('../writing-lab-scoring');
const { createAdapters } = require('../full-mock/adapters');
const question = require('../content/additional-practice-questions.json').find(item => item.id === 'sst-user-20261124-271');

const answer = 'Researchers can find a greater volume of information in less time, using digital collections and online surveys. Some online sources may be difficult to check, so researchers should balance search efficiency against the risks of unreliable information to protect the credibility of their work across a variety of fields and research settings.';
const coverage = [
  { status:'covered', evidence:'find a greater volume of information in less time' },
  { status:'covered', evidence:'online sources may be difficult to check' },
  { status:'covered', evidence:'balance search efficiency against the risks of unreliable information' }
];
const marks = {
  scores:{ content:4, form:2, grammar:2, vocabulary:2, spelling:2 },
  feedback:{ content:'Clear summary.', form:'Correct length.', grammar:'Clear sentences.', vocabulary:'Accurate vocabulary.', spelling:'Accurate spelling.' },
  formInvalid:false, strengths:[], improvements:[], errors:[]
};

test('SST coaching accepts evidenced paraphrases and leaves native marks intact', async () => {
  const graded = await scoring.grade(question, answer, async prompt => {
    assert.match(prompt, /Optional SST coaching/);
    return { ...marks, sstCoverage:coverage };
  });
  const prior = await scoring.grade(question, answer, async prompt => {
    assert.doesNotMatch(prompt, /Optional SST coaching/);
    return marks;
  }, { sstCoaching:false });
  const { sstCoverage, ...native } = graded;
  assert.deepEqual(native, prior);
  assert.equal(native.total, 12);
  assert.deepEqual(sstCoverage.ideas.map(item => item.status), ['covered', 'covered', 'covered']);

  const invalid = [{ ...coverage[0], evidence:'An invented quotation' }, ...coverage.slice(1)];
  assert.deepEqual(await scoring.grade(question, answer, async () => ({ ...marks, sstCoverage:invalid })), prior);
});

test('SST short unintelligible response keeps its Form gate and gets specific all-missed coaching', async () => {
  const text = 'Flim zorba nesh, tral vorn shem.';
  const misses = coverage.map(() => ({ status:'missed', evidence:'' }));
  const grader = async prompt => {
    assert.match(prompt, /coaching only/);
    return { sstCoverage:misses };
  };
  const result = await scoring.grade(question, text, grader);
  assert.equal(result.gated, true);
  assert.equal(result.total, 0);
  assert.deepEqual(result.sstCoverage.ideas.map(item => item.status), ['missed', 'missed', 'missed']);
  for (const idea of result.sstCoverage.ideas) assert.ok(result.sstCoverage.nextStep.includes(idea.main));
  const unavailable = await scoring.grade(question, text, async () => { throw Error('Unavailable'); });
  const { sstCoverage, ...gate } = result;
  assert.deepEqual(unavailable, gate);

  const adapters = createAdapters({ writingContentModel:grader, transcribe:async () => {}, assessDelivery:async () => {} });
  const response = { sealed:true, answer:[text] };
  const fullMock = await adapters.assess(question, response);
  assert.equal(fullMock.reason, 'Native Form gate');
  assert.equal(fullMock.total, 0);
  assert.deepEqual(fullMock.sstCoverage, sstCoverage);
  const frozen = await adapters.assess(question, response, { sstCoaching:false });
  assert.equal(frozen.reason, fullMock.reason);
  assert.equal(frozen.sstCoverage, undefined);
  assert.deepEqual(frozen.stages, {});
});
