'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const gpt=require('../gpt-speaking-delivery'),azure=require('../speaking-delivery'),rubric=require('../delivery-rubric');
const evidence={sufficient:true,durationSeconds:8,spokenWords:20};
const item=(kind,observation,impact='')=>({start:.1,end:.8,kind,phrase:'trees shade streets',observation,impact});
const top=()=>({status:'scored',pattern:'clear',overallImpact:'none',score:5,reason:'Clear connected speech overall.',nextStep:'Keep this natural phrase stress.',evidence:[item('strength','The phrase is clear and naturally connected.')]});

test('The Academy rubric permits minor slips, clear accents, natural pauses and smooth recovery at the top band',()=>{
  assert.equal(rubric.RUBRIC_VERSION,'intelligibility-delivery-v4');
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
  const pronunciation={...top(),pattern:'recurring_difficulty',overallImpact:'noticeable',score:4,evidence:[item('score-impact','The vowel is unclear.','This adds listener effort.'),{...item('score-impact','The same vowel difficulty recurs in another phrase.','This repeatedly obscures words.'),start:3,end:3.8}]};
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

test('A clearly understood isolated pronunciation slip and smoothly recovered stumble can both receive five',()=>{
  const pronunciation={...top(),pattern:'minor_slips',reason:'The response is clear overall, including the readily understood isolated slip.',evidence:[{...item('refinement','The isolated semester slip leaves the word readily understood.'),phrase:'semester'}]};
  const fluency={...top(),pattern:'minor_slips',reason:'Connected phrasing is maintained with smooth recovery after an occasional hesitation.',evidence:[{...item('refinement','A brief hesitation in student needs is followed by smooth recovery.'),phrase:'student needs'}]};
  const result=gpt.normalize({pronunciation,fluency},evidence);
  assert.equal(result.pronunciation.score,5);assert.equal(result.fluency.score,5);
  assert.equal(result.pronunciation.pattern,'minor_slips');assert.equal(result.fluency.overallImpact,'none');
});

test('One event or two overlapping descriptions cannot establish a recurring difficulty',()=>{
  for(const name of ['pronunciation','fluency'])for(const duplicate of [false,true]){
    const problem=item('score-impact','The phrase is briefly unclear or interrupted.','The listener needs extra effort here.');
    const trait={...top(),score:4,pattern:'recurring_difficulty',overallImpact:'noticeable',evidence:duplicate?[problem,{...problem,start:.2}]:[problem]};
    const result=gpt.normalize({pronunciation:top(),fluency:top(),[name]:trait},evidence);
    assert.equal(result[name].score,null);
    assert.equal(result[name==='pronunciation'?'fluency':'pronunciation'].score,5);
  }
});

test('Repeated disruptive hesitations across the recording can lower fluency independently',()=>{
  const fluency={...top(),score:3,pattern:'recurring_difficulty',overallImpact:'substantial',reason:'Repeated mid-phrase restarts interrupt otherwise connected ideas across the recording.',evidence:[
    {...item('score-impact','A restart breaks the first phrase.','It disrupts following the idea.'),start:1,end:1.8},
    {...item('score-impact','A further restart breaks a later phrase.','Repeated interruptions make following ideas effortful.'),start:5,end:5.8}
  ]};
  const result=gpt.normalize({pronunciation:top(),fluency},evidence);
  assert.equal(result.fluency.score,3);assert.equal(result.pronunciation.score,5);
});

test('A genuine sustained breakdown remains a valid reason for a lower mark',()=>{
  const pronunciation={...top(),score:2,pattern:'sustained_difficulty',overallImpact:'substantial',reason:'A sustained stretch of unclear sounds obscures much of the recording.',evidence:[{...item('score-impact','Many words remain unclear throughout this stretch.','The listener cannot follow much of the message.'),phrase:'[unclear speech]',start:.5,end:6.5}]};
  assert.equal(gpt.normalize({pronunciation,fluency:top()},evidence).pronunciation.score,2);
});

test('A minor-slip or no-impact assessment cannot justify deductions, and difficulty cannot be silently labelled five',()=>{
  for(const [pattern,overallImpact,score]of [['minor_slips','none',4],['recurring_difficulty','none',4],['recurring_difficulty','noticeable',5]]){
    const pronunciation={...top(),pattern,overallImpact,score,evidence:score===5?top().evidence:[item('score-impact','A word was flagged.','Listener effort.') ]};
    const result=gpt.normalize({pronunciation,fluency:top()},evidence);
    assert.equal(result.pronunciation.score,null);assert.equal(result.fluency.score,5);
  }
});

test('Azure treats isolated word flags as practice cues without adding a trait deduction',()=>{
  const clear=[{accuracy:96,fluency:96,weight:20,words:[]}],flagged=[{...clear[0],words:[{word:'semester',accuracy:65,errorType:'Mispronunciation'}]}];
  const baseline=azure.aggregate(clear,{evidence}),result=azure.aggregate(flagged,{evidence});
  assert.equal(result.pronunciation.score,baseline.pronunciation.score);assert.equal(result.fluency.score,baseline.fluency.score);
  const advice=azure.coaching('pronunciation',{score:4,words:flagged[0].words});
  assert.match(advice,/does not establish a recurring pronunciation problem/);assert.match(advice,/optional/);
  assert.match(azure.coaching('fluency',{score:4}),/smooth recovery/);
});
