'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const reading = require('../public/reading-practice');
const lab = require('../public/writing-lab-report');

test('Reading mock weights each task type once, not every possible point equally', () => {
  const questions = [
    {uid:'blank', type:'dropdown', answers:['first','second']},
    {uid:'single', type:'mcsa', answers:[], answer:2}
  ];
  const session={mode:'reading-section',questions,answers:{blank:['first','wrong'],single:[2]},assessments:{},audioStates:{}};
  const result=reading.totals(session);
  assert.equal(result.earned,2);
  assert.equal(result.possible,3);
  assert.equal(result.percent,67);
  assert.equal(result.score90,54); // 10 + 80 × ((25 × .5 + 3 × 1) / 28)
  assert.equal(result.weighting.profile,'reading');
  assert.equal(result.weighting.fullProfile,false);
  assert.equal(reading.totals({...session,mode:'practice'}).score90,null);
});

test('Pending SWT or unassessed audio prevents a complete weighted Reading estimate', () => {
  const swt={uid:'swt',type:'swt'};
  const unanswered={uid:'audio',type:'hcs',answer:1};
  const session={mode:'full',questions:[swt,unanswered],answers:{swt:['A saved summary.'],audio:[]},assessments:{},audioStates:{}};
  assert.equal(reading.totals(session).score90,null);
  const pending=reading.totals(session);
  assert.equal(pending.pending,1);
  assert.equal(pending.excluded,1);
  assert.equal(pending.weighting.performancePercent,null);
});

test('Listening sectional mocks use the Listening weights, not raw-point conversion', () => {
  const questions=[
    {type:'lfi',answers:['a','b','c','d']},
    {type:'smw',answer:1}
  ];
  const scores=[
    {total:2,maximum:4},
    {total:1,maximum:1}
  ];
  const result=lab.summarize(questions,scores,{kind:'mock',module:'listening'});
  assert.equal(result.complete,true);
  assert.equal(result.total,3);
  assert.equal(result.maximum,5);
  assert.equal(result.score90,54); // 10 + 80 × ((8 × .5 + 1 × 1) / 9)
  assert.equal(result.weighting.profile,'listening');
  assert.equal(result.weighting.fullProfile,false);
  assert.equal(result.weighting.weights.lfi,8);
  assert.equal(result.weighting.weights.wfd,13);
  assert.equal(result.byType[0].normalizedWeight,8/9*100);
});

test('Provisional Listening SST and missing tasks do not create misleading estimates', () => {
  const sst={type:'sst'};
  const pending=lab.summarize([sst],[{total:9,maximum:12,score_provisional:true}],{kind:'mock',module:'listening'});
  assert.equal(pending.complete,false);
  assert.equal(pending.score90,null);
  const absent=lab.summarize([sst],[null],{kind:'mock',module:'listening'});
  assert.equal(absent.complete,false);
  assert.equal(absent.score90,null);
  const individual=lab.summarize([sst],[{total:12,maximum:12}],{kind:'sst',module:'listening'});
  assert.equal(individual.weighting,undefined);
});

test('Writing mock weighting remains unchanged', () => {
  const result=lab.summarize([{type:'essay'}],[{total:26,maximum:26}],{kind:'mock',module:'writing'});
  assert.equal(result.weighting.profile,'writing');
  assert.equal(result.weighting.weights.essay,31);
  assert.equal(result.score90,90);
});
