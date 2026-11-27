'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const scoring = require('../writing-lab-scoring');

const question = {type:'sst', text:'Larger telescopes gather more light and show finer detail.'};
const base = 'The lecture explains that larger telescopes can gather more light and show finer details. Small telescopes make faint objects harder to see. Modern detectors gather light more efficiently than the human eye, so telescope images can show faint objects. These improvements let astronomers study things that they could not previously see.';
function result(errors=[], vocabulary=1) {
  return {scores:{content:3,form:2,grammar:2,vocabulary,spelling:2},
    feedback:{content:'Link the main points.',form:'Full form.',grammar:'Clear.',vocabulary:'The range is limited.',spelling:'Correct.'},
    formInvalid:false,formReason:'',strengths:[],improvements:['Link the main points.'],errors};
}

test('New SST marks credit simple accurate source language without changing other traits or frozen grading', async () => {
  const current=await scoring.grade(question,base,async prompt=>{
    assert.match(prompt,/accurate wording from the lecture/);
    return result();
  });
  assert.deepEqual(current.scores,{content:3,form:2,grammar:2,vocabulary:2,spelling:2});
  assert.match(current.feedback.vocabulary,/Simple, accurate wording/);
  const frozen=await scoring.grade(question,base,async prompt=>{
    assert.match(prompt,/1 limited or imprecise/);
    return result();
  },{sstVocabularyAccuracy:false});
  assert.equal(frozen.scores.vocabulary,1);
  assert.equal(frozen.feedback.vocabulary,'The range is limited.');
});

test('SST vocabulary deductions require an exact quote and an explained correction', () => {
  const answer=base.replace('gather more light','borrow more light');
  const error={trait:'vocabulary',phrase:'borrow more light',correction:'gather more light',explanation:'Telescopes collect light. They do not borrow it.'};
  assert.equal(scoring.normalize(question,answer,result([error])).scores.vocabulary,2);
  const clear=scoring.normalize(question,answer,result([{...error,communicationHindered:false}]));
  assert.equal(clear.scores.vocabulary,1);
  assert.equal(clear.errors[0].affectsScore,true);
  const unclear=scoring.normalize(question,answer,result([{...error,communicationHindered:true}]));
  assert.equal(unclear.scores.vocabulary,0);
  assert.throws(()=>scoring.normalize(question,answer,result([{...error,phrase:'words not present',communicationHindered:true}])),/Invalid scoring evidence/);
});
