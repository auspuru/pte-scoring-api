'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const scoring = require('../speaking-scoring');
const policy = require('../spoken-summary-policy');

const lecture = {
  type:'rl',
  text:'Urban trees shade streets and reduce summer heat. They also absorb rainwater, reducing runoff. A local planting trial ran for twelve weeks. The lecturer recommends suitable species and maintenance rather than simply planting as many trees as possible.',
  facts:['Trees provide shade and reduce heat.', 'Trees absorb rainwater and reduce runoff.', 'The trial lasted twelve weeks.', 'Suitable species and maintenance matter.'],
  sample:'Trees reduce heat by shading streets and reduce runoff by absorbing rainwater, so cities should choose suitable species and maintain them.'
};
const discussion = {
  type:'sgd',
  text:'Mia: We need a quiet study area because the shared room is noisy. Leo: Keep group space too, but separate the quiet zone. Ava: Trial separate zones for four weeks before a permanent change. Mia: Yes, quieter study without removing group work. Leo: Agreed.',
  facts:['Mia wants quiet study because of noise.', 'Leo wants to retain group space while separating quiet study.', 'Ava suggests a four-week trial.', 'They agree on separate zones rather than removing group work.'],
  sample:'The first speaker wants quieter study because the room is noisy, while the second wants group space retained. The third proposes a four-week trial, and they agree to try separate zones so both needs can be met.'
};
function review(question, text, {total=6, statuses, impacts={}, assessment={}}={}) {
  return {
    total, overview:'The main message and useful supporting ideas are connected.', strengths:['Relevant ideas are linked.'], improvements:[],
    coverage:question.facts.map((_, point) => {
      const status=statuses?.[point]||'covered';
      return {point,status,evidence:status==='missing'?'':text,feedback:status==='missing'?'Optional detail omitted.':'The response expresses this idea.',
        ...(status==='inaccurate'?{errorImpact:impacts[point]||'minor'}:{})};
    }),
    summaryAssessment:{responseForm:'connected',mainMessageAccurate:true,relationshipsClear:true,sufficientSubstance:true,
      mostlyAccurate:true,materialMeaningChange:false,speakerAttributionClear:true,evidence:text,
      reason:'The main message is preserved with relevant, connected supporting substance.',...assessment}
  };
}

for (const [question, minorText, statuses] of [
  [lecture,'Trees shade streets to reduce heat and absorb rainwater to reduce runoff. After a trial of about ten weeks, the lecturer recommends suitable species and maintenance.',['covered','covered','inaccurate','covered']],
  [discussion,'The first speaker wants quiet study because of noise, while the second wants group space retained. The third proposes a five-week trial, and they agree to separate the zones so both needs are met.',['covered','covered','inaccurate','covered']]
]) {
  test(`${question.type}: connected accurate and connected minor-error summaries share 6/6`, async () => {
    for (const [text, states] of [[question.sample,undefined],[minorText,statuses]]) {
      let calls=0;
      const result=await scoring.grade(question,text,async () => {calls++;return review(question,text,{statuses:states});});
      assert.equal(result.total,6);
      assert.equal(result.scoringMode,'ai');
      assert.equal(result.contentPolicyVersion,policy.VERSION);
      assert.equal(result.summaryAssessment.responseForm,'connected');
      assert.equal(result.pronunciation,null);
      assert.equal(calls,1,'A minor inaccuracy must not trigger a paid repair request.');
      if(states)assert.equal(result.coverage[2].errorImpact,'minor');
    }
  });
  test(`${question.type}: omitted optional detail imposes no coverage quota`, () => {
    const raw=review(question,question.sample,{statuses:['covered','covered','missing','covered']});
    assert.equal(scoring.normalize(question,question.sample,raw).total,6);
  });
  test(`${question.type}: missing semantic assessment, invented evidence and unclassified errors fail visibly`, () => {
    const missing=review(question,question.sample);delete missing.summaryAssessment;
    assert.throws(()=>scoring.normalize(question,question.sample,missing),/Incomplete connected-meaning/);
    const invented=review(question,question.sample);invented.summaryAssessment.evidence='These words were never spoken.';
    assert.throws(()=>scoring.normalize(question,question.sample,invented),/Unsupported assessment evidence/);
    const unclassified=review(question,minorText,{statuses});delete unclassified.coverage[2].errorImpact;
    assert.throws(()=>scoring.normalize(question,minorText,unclassified),/Incomplete connected-meaning/);
  });
  test(`${question.type}: accuracy alone does not give a sparse or disconnected response full marks`, () => {
    for (const change of [{sufficientSubstance:false},{relationshipsClear:false},{mostlyAccurate:false},{mainMessageAccurate:false}]) {
      assert.throws(()=>scoring.normalize(question,question.sample,review(question,question.sample,{assessment:change})),/score contradicts/);
    }
    const sparse=review(question,question.sample,{total:5,assessment:{sufficientSubstance:false}});
    assert.equal(scoring.normalize(question,question.sample,sparse).total,5);
  });
}

test('The template, keyword, fragment and connected-response ladder is enforced', () => {
  const cases=[
    ['template_only','The speaker discussed important information. Moreover, it was very important.',0],
    ['keywords','Trees, heat, rainwater, maintenance.',1],
    ['fragments','Trees reduce heat. Rainwater absorbed. Suitable species. Maintenance important.',2],
    ['connected','Trees shade streets to increase heat, so cities should choose suitable species and maintain them.',3]
  ];
  for(const [responseForm,text,total] of cases){
    const raw=review(lecture,text,{total,assessment:{responseForm,mainMessageAccurate:false,relationshipsClear:responseForm==='connected',sufficientSubstance:false,mostlyAccurate:false,materialMeaningChange:responseForm==='connected'}});
    assert.equal(scoring.normalize(lecture,text,raw).total,total);
    assert.throws(()=>scoring.normalize(lecture,text,{...raw,total:6}),/score contradicts/);
    if(total<3)assert.throws(()=>scoring.normalize(lecture,text,{...raw,total:3}),/score contradicts/);
  }
});

test('Material reversals and important speaker mix-ups cannot be called minor full-score errors', () => {
  for(const [question,text] of [
    [lecture,'Trees increase heat by shading streets and increase runoff by absorbing rainwater, so cities should maintain them.'],
    [discussion,'The first speaker wants group space, the second wants group work removed, and all agree to close the shared room.']
  ]){
    const material=review(question,text,{statuses:['inaccurate','covered','missing','covered'],impacts:{0:'material'}});
    assert.throws(()=>scoring.normalize(question,text,material),/score contradicts/);
    const changedMeaning=review(question,text,{assessment:{materialMeaningChange:true}});
    assert.throws(()=>scoring.normalize(question,text,changedMeaning),/score contradicts/);
  }
  const mixed=review(discussion,discussion.sample,{assessment:{speakerAttributionClear:false}});
  assert.throws(()=>scoring.normalize(discussion,discussion.sample,mixed),/score contradicts/);
});

test('A connected minor-error summary is not relegated to 5 when all full-score conditions hold', async () => {
  let calls=0;
  const text=lecture.sample;
  const result=await scoring.grade(lecture,text,async prompt=>{
    calls++;
    if(calls===1)return review(lecture,text,{total:5});
    assert.match(prompt,/RETRY NOTE/);
    assert.match(prompt,/SAME 6\/6/);
    assert.doesNotMatch(prompt,/no inaccurate facts/);
    return review(lecture,text);
  });
  assert.equal(calls,2);
  assert.equal(result.total,6);
});

test('Repeated contradictory reviews withhold marks rather than awarding keyword-based fallback scores', async () => {
  const result=await scoring.grade(lecture,lecture.sample,async()=>review(lecture,lecture.sample,{assessment:{materialMeaningChange:true}}));
  assert.equal(result.total,null);
  assert.equal(result.contentStatus,'unavailable');
});

test('RL and SGD prompts use accuracy as a holistic guide and preserve source wording and simple connections', () => {
  for(const question of [lecture,discussion]){
    const prompt=scoring.prompt(question,question.sample);
    assert.match(prompt,/80–90% accuracy/);
    assert.match(prompt,/NOT a keyword-match percentage, a coverage quota/);
    assert.match(prompt,/SAME top category/);
    assert.match(prompt,/Source phrases and simple language are acceptable/);
    assert.match(prompt,/not a claim about Pearson/);
    assert.match(prompt,/Names, every turn, every detail and a fixed number of points per speaker are not required/);
    assert.doesNotMatch(prompt,/accurate comprehensive main ideas/);
  }
  for(const type of ['di','rts','ra','rs'])assert.equal(policy.prompt({type}),'');
});

test('Describe Image keeps the existing full-score accuracy guard and needs no summary fields', () => {
  for(const type of ['di']){
    const question={...lecture,type};
    const accurate=review(question,question.sample);delete accurate.summaryAssessment;
    assert.equal(scoring.normalize(question,question.sample,accurate).total,6);
    accurate.coverage[2]={...accurate.coverage[2],status:'inaccurate',errorImpact:'minor'};
    assert.throws(()=>scoring.normalize(question,question.sample,accurate),/Full content score contradicts/);
    assert.doesNotMatch(scoring.prompt(question,question.sample),/CONNECTED-MEANING CONTENT POLICY/);
  }
});
