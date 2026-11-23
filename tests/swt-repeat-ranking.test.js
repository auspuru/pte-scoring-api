'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { verifiedRepeatCount, sortSwtPassages } = require('../swt-repeat-ranking');
const q = (id, count, evidence, extras={}) => ({id, questionSet:'nov23-2026-swt', repeatCount:count, repeatEvidence:evidence, ...extras});
test('question number is not a frequency', () => assert.equal(verifiedRepeatCount({id:519,sourceQuestionNumber:519,questionSet:'nov23-2026-swt'}),null));
test('counts sort descending', () => assert.deepEqual(sortSwtPassages([q(1,2,'dated'),q(2,12,'dated'),q(3,6,'dated')]).map(x=>x.id),[2,3,1]));
test('unknown count stays unranked', () => assert.deepEqual(sortSwtPassages([q(1,null,''),q(2,4,'dated'),q(3,3,'')]).map(x=>x.id),[2,1,3]));
test('ties use source order', () => assert.deepEqual(sortSwtPassages([q(1,2,'x',{sourceOrder:4}),q(2,2,'x',{sourceOrder:2})]).map(x=>x.id),[2,1]));
test('legacy prediction rank intact when unranked', () => assert.deepEqual(sortSwtPassages([{id:12},{id:91},{id:30}],new Map([[91,0],[30,1]])).map(x=>x.id),[91,30,12]));
test('other question sets not considered ranked',()=>assert.deepEqual(sortSwtPassages([{id:1,questionSet:'other',repeatCount:50,repeatEvidence:'x'},q(2,1,'dated')]).map(x=>x.id),[2,1]));

test('one student report moves question ahead of high source-report counts',()=>{
  const rows=[q(12,519,'source'),q(14,511,'source'),{id:1,title:'old question'}];
  assert.deepEqual(sortSwtPassages(rows,new Map(),new Map([[1,1]])).map(p=>p.id),[1,12,14]);
});
test('questions with most distinct student reports appear first',()=>{
  const rows=[q(12,519,'source'),q(14,511,'source'),{id:1},{id:2}];
  const reporters=new Map([[2,3],[14,1],[1,7]]);
  assert.deepEqual(sortSwtPassages(rows,new Map(),reporters).map(p=>p.id),[1,2,14,12]);
});
test('student report ties preserve source-reported count ordering',()=>{
  const rows=[q(12,1,'source'),q(14,100,'source'),q(15,5,'source')];
  const reporters=new Map([[12,3],[14,3],[15,1]]);
  assert.deepEqual(sortSwtPassages(rows,new Map(),reporters).map(p=>p.id),[14,12,15]);
});
test('ranking does not mutate the source array or any passage IDs',()=>{
  const rows=[{id:1},{id:2}],before=JSON.stringify(rows);
  const sorted=sortSwtPassages(rows,new Map(),new Map([[2,1]]));
  assert.deepEqual(sorted.map(p=>p.id),[2,1]);assert.equal(JSON.stringify(rows),before);
});
