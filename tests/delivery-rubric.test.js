'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const gpt=require('../gpt-speaking-delivery'),azure=require('../speaking-delivery'),rubric=require('../delivery-rubric');
const evidence={sufficient:true,durationSeconds:8,spokenWords:20};
const item=(kind,observation,impact='')=>({start:.1,end:.8,kind,phrase:'trees shade streets',observation,impact});
const top=()=>({status:'scored',score:5,reason:'Clear connected speech overall.',nextStep:'Keep this natural phrase stress.',evidence:[item('strength','The phrase is clear and naturally connected.')]});

test('The Academy rubric permits minor slips, clear accents, natural pauses and smooth recovery at the top band',()=>{
  assert.equal(rubric.RUBRIC_VERSION,'intelligibility-delivery-v3');
  for(const phrase of ['regional and national accents','not an automatic deduction','Natural sentence/phrase-boundary pauses','smooth recovery','task time limit','not automatically a pronunciation error'])assert(gpt.PROMPT.includes(phrase));
  const pronunciation=top();pronunciation.evidence.push(item('refinement','An optional isolated sound refinement leaves the word clear.'));
  const result=gpt.normalize({pronunciation,fluency:top()},evidence);
  assert.equal(result.pronunciation.score,5);assert.equal(result.fluency.score,5);
  assert.equal(result.deliveryRubricVersion,rubric.RUBRIC_VERSION);
});

test('An unsupported deduction is withheld rather than raised or counted against the other trait',()=>{
  const pronunciation=top();pronunciation.score=3;pronunciation.evidence=[item('refinement','An optional sound refinement could improve slightly.')];
  const result=gpt.normalize({pronunciation,fluency:top()},evidence);
  assert.equal(result.pronunciation.score,null);assert.equal(result.fluency.score,5);assert.deepEqual(result.deliveryFailureTraits,['pronunciation']);
});

test('A real audible impact can justify a lower band, but invalid timestamps and optional polish cannot',()=>{
  const pronunciation={...top(),score:4,evidence:[item('score-impact','The word is unclear.','This adds listener effort.')]};
  assert.equal(gpt.normalize({pronunciation,fluency:top()},evidence).pronunciation.score,4);
  const bad=structuredClone(pronunciation);bad.evidence[0].end=9;
  assert.equal(gpt.normalize({pronunciation:bad,fluency:top()},evidence).pronunciation.score,null);
  const optional=structuredClone(pronunciation);optional.evidence=[item('score-impact','Optional polish could improve slightly.','Cosmetic refinement.')];
  assert.equal(gpt.normalize({pronunciation:optional,fluency:top()},evidence).pronunciation.score,null);
});

test('Azure does not double-penalise strong native traits using secondary prosody or isolated weak-word flags',()=>{
  const result=azure.aggregate([{accuracy:98,fluency:97,prosody:20,weight:20,words:[{word:'trees',accuracy:60,errorType:'Mispronunciation'}]}],{evidence});
  assert.equal(result.pronunciation.score,5);assert.equal(result.fluency.score,5);
  assert.equal(result.pronunciation.raw,98);assert.equal(result.fluency.raw,97);assert.equal(result.pronunciation.prosody,20);
  assert.equal(result.pronunciation.words[0].word,'trees');assert.equal(result.deliveryRubricVersion,rubric.RUBRIC_VERSION);
  assert.match(result.deliveryCalibration,/diagnostic only/);
});

test('Azure keeps its disclosed acoustic mapping and does not copy GPT marks or invent a score floor',()=>{
  const result=azure.aggregate([{accuracy:70,fluency:55,prosody:100,weight:20,words:[]}],{evidence});
  assert.equal(result.pronunciation.score,azure.band5(70));assert.equal(result.fluency.score,azure.band5(55));
  assert.equal(result.pronunciation.raw,70);assert.equal(result.fluency.raw,55);
});
