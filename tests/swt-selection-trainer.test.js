const test=require('node:test');
const assert=require('node:assert/strict');
const passages=require('../passages.json');
const {studentPassage}=require('../swt-reference');
const trainer=require('../swt-selection-trainer');

const bank=passages.map(studentPassage);

test('SWT highlight trainer builds 15 exercises from the existing passage bank',()=>{
  const catalog=trainer.makeCatalog(bank,{limit:15});
  assert.equal(catalog.length,15);
  assert(catalog.every(x=>x.id&&x.title&&x.sentenceCount>=3));
  assert.deepEqual(catalog.map(x=>Number(x.id)),[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]);
});

test('highlight exercise hides the answer until grading',()=>{
  const ex=trainer.exercise(bank[2]);
  assert.equal(ex.id,'3');
  assert(ex.sentences.length>=4);
  assert.equal(Object.hasOwn(ex,'targetSentenceIndexes'),false);
  assert.equal(Object.hasOwn(ex,'studyGuide'),false);
});

test('grading explains missed central ideas and exposes central sentences and phrases',()=>{
  const p=bank[2];
  const key=trainer.answerKey(p);
  assert(key.targets.length>=3);
  const selected=[key.targetSentenceIndexes[0]];
  const result=trainer.grade(p,selected);
  assert(result.ideaRecall.captured<result.ideaRecall.total);
  assert(result.missedIdeas.length>=1);
  assert(result.missedIdeas.every(x=>x.idea&&x.why&&Array.isArray(x.sentenceIndexes)));
  assert(Array.isArray(result.targetSentenceIndexes));
  assert.equal(result.targetSentenceIndexes.includes(selected[0]),true);
  assert.match(result.feedback,/missed/i);
});

test('selecting all central sentences captures all key ideas',()=>{
  const p=bank[3],key=trainer.answerKey(p);
  const result=trainer.grade(p,key.targetSentenceIndexes);
  assert.equal(result.ideaRecall.percent,100);
  assert.equal(result.missedIdeas.length,0);
  assert.equal(result.extraSelections.length,0);
});
