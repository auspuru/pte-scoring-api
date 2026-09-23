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
  assert.equal(ex.text,bank[2].text);
  assert(ex.paragraphs.length>=1);
  assert(ex.paragraphs.every(p=>Number.isInteger(p.start)&&Number.isInteger(p.end)&&p.text));
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

test('phrase grading scores exact highlighted ranges instead of whole sentences',()=>{
  const p=bank[2],key=trainer.answerKey(p);
  const first=key.targets.find(t=>t.ranges.length).ranges[0];
  const result=trainer.grade(p,[{start:first.start,end:first.end}]);
  assert.equal(result.mode,'phrases');
  assert.equal(result.selectedRanges.length,1);
  assert(result.ideaRecall.captured>=1);
  assert(Array.isArray(result.targetRanges));
  assert(Array.isArray(result.centralPhrases));
  assert.equal(result.selectedRanges[0].text,p.text.slice(first.start,first.end));
});

test('range selections are validated against passage offsets',()=>{
  const p=bank[2];
  const result=trainer.grade(p,[{start:-1,end:20},{start:0,end:p.text.length+10},{start:0,end:1}]);
  assert.equal(result.mode,'phrases');
  assert.equal(result.selectedRanges.length,0);
});


test('central source phrase inside a paraphrased fallback idea is not marked extra',()=>{
  const passage={
    id:999,
    text:'Urban trees cool neighbourhoods during heatwaves and make streets more comfortable. Researchers also record local bird species. Councils therefore protect mature trees when redesigning hot streets.',
    studyGuide:{items:[{label:'Main idea',idea:'Green infrastructure reduces dangerous urban heat',phrases:[]}]}
  };
  const key=trainer.answerKey(passage);
  assert.equal(key.targets[0].ranges[0].kind,'fallback');
  const phrase='cool neighbourhoods during heatwaves';
  const start=passage.text.indexOf(phrase);
  const result=trainer.grade(passage,[{start,end:start+phrase.length}]);
  assert.equal(result.ideaRecall.percent,100);
  assert.equal(result.extraRanges.length,0);
  assert.equal(result.correctRanges[0].text,phrase);
});
