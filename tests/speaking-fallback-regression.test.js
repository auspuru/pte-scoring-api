'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const scoring = require('../speaking-scoring');
const bank = require('../content/speaking-bank');
const { present } = require('../speaking-lab');

const graph = { type:'di', text:'Describe a line graph of annual sales.',
  facts:['Annual sales rose from 20 million in 2020 to 80 million in 2024.', 'Sales peaked at 100 million in 2022.', 'Sales fell after the 2022 peak.'],
  sample:'The line graph shows annual sales rising from 20 million in 2020 to 80 million in 2024. Sales peaked at 100 million in 2022, before falling after the peak.' };
for (const [name, response] of [
  ['accurate sample', graph.sample],
  ['swapped quantities', graph.sample.replace('20 million in 2020 to 80 million', '80 million in 2020 to 20 million')],
  ['reversed trend', graph.sample.replace('rising from', 'not rising from').replace('before falling', 'without falling')],
  ['unrelated response', 'The university library provides books and journals for students.'],
  ['pasted whitespace', graph.sample.replace(/ /g, '  ')]
]) {
  test(`Provider failure does not award native speaking marks: ${name}`, async () => {
    let calls = 0;
    const result = await scoring.grade(graph, response, async () => { calls++; throw Error('provider unavailable'); });
    assert.equal(calls, 2);
    assert.equal(result.total, null);
    assert.equal(result.score_provisional, true);
    assert.equal(result.contentStatus, 'unavailable');
    assert.equal(result.strengths.length, 0);
    assert(result.coverage.every(x => x.status === 'unverified'));
    assert(result.coverage.every(x => !x.evidence || response.includes(x.evidence)));
  });
}

test('Saved fallback full marks are hidden without changing stored data or audio feedback', () => {
  const q = bank.questions.find(x => x.type === 'di');
  const delivery = { score:4, maximum:5, coaching:'Group related ideas and pause between them.' };
  const attempt = { id:'saved-attempt', questionId:q.id, status:'submitted', transcript:'Sales fell in 2024.',
    result:{ scoringMode:'local', total:6, maximum:6, pronunciation:delivery, fluency:delivery,
      coverage:[{ point:'Sales rose.', status:'covered', evidence:'Sales fell in 2024.', feedback:'Fully covered.' }] } };
  const before = structuredClone(attempt);
  const result = present(attempt).result;
  assert.equal(result.total, null);
  assert.equal(result.coverage[0].status, 'unverified');
  assert.deepEqual(result.pronunciation, delivery);
  assert.deepEqual(result.fluency, delivery);
  assert.deepEqual(attempt, before);
});

test('Deterministic Read Aloud and Repeat Sentence retain their content marks offline', async () => {
  for (const type of ['ra', 'rs']) {
    const q = bank.questions.find(x => x.type === type);
    const result = await scoring.grade(q, q.text, async () => { throw Error('Must not call provider'); });
    assert.equal(result.total, result.maximum);
    assert.equal(scoring.resultForClient(result).total, result.maximum);
  }
});

test('An AI full score that flags an inaccurate fact must be reviewed before it is confirmed', async () => {
  const raw={total:6,overview:'A complete summary.',strengths:[],improvements:[],
    coverage:graph.facts.map((_,point)=>({point,status:point===0?'inaccurate':'covered',evidence:graph.sample,feedback:'Check this fact.'}))};
  assert.throws(()=>scoring.normalize(graph,graph.sample,raw),/Full content score contradicts/);
  let calls=0;
  const result=await scoring.grade(graph,graph.sample,async()=>{calls++;return structuredClone(raw);});
  assert.equal(calls,2);
  assert.equal(result.total,null);
  assert.equal(result.contentStatus,'unavailable');
});

test('Missing optional details do not impose a fact-count quota on full AI content', () => {
  const raw={total:6,overview:'The main pattern and relationships are accurately developed.',strengths:['Accurate main trend.'],improvements:[],
    coverage:graph.facts.map((_,point)=>({point,status:point===0?'covered':'missing',evidence:point===0?graph.sample:'',feedback:point===0?'Accurate main pattern.':'Optional detail omitted.'}))};
  assert.equal(scoring.normalize(graph,graph.sample,raw).total,6);
});
