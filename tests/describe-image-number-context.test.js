'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const academy=require('../describe-image-academy');
const scoring=require('../speaking-scoring');

const question={type:'di',title:'Sales by country',facts:[
  'Australia has the highest sales at 80 million dollars.',
  'Canada has the lowest sales at 20 million dollars.'
]};

test('Mock and practice requests distinguish bare values from contextual comparisons',()=>{
  for(const text of [
    'The highest number is 80 and the lowest is 20.',
    'Australia leads in sales. Its figure is 80 million dollars.'
  ]){
    const prompts=[academy.request('fake-model',{question,transcript:text}).messages[0].content,scoring.prompt(question,text)];
    for(const prompt of prompts){
      assert(prompt.includes(text),'The full response remains available for contextual interpretation.');
      assert.match(prompt,/Do not borrow an unstated label from the image facts/);
      assert.match(prompt,/Do not use those bare figures as evidence of a developed category comparison/);
      assert.match(prompt,/across sentences and deserves the same credit/);
      assert.match(prompt,/A single unlinked number does not impose an automatic score cap/);
      assert.match(prompt,/Do not classify a correct but unidentified number as a factual contradiction/);
      assert.match(prompt,/non-numerical images/);
      assert.match(prompt,/Never invent a category or unit/);
    }
  }
});

test('Frozen mock policy still sends exactly the deployed scoring instructions',async()=>{
  const legacy=academy.LEGACY_VERSION;
  const prompt=academy.request('fake-model',{question,transcript:'The highest number is 80.',contentPolicy:legacy}).messages[0].content;
  assert(!prompt.includes('Numerical meaning:'));
  assert(prompt.includes(require('../describe-image-academy/legacy-scoring-policy').instructions));
  assert(academy.applies({question,contentPolicy:legacy}));
  let seen;
  const result=await academy.grade(question,'Australia has the highest sales at 80 million dollars.',async(p,context)=>{
    seen=context.contentPolicy;
    assert(!p.includes('Numerical meaning:'));
    return {score:6,relevance:'image-specific',accuracy:'accurate',scoreImpact:null,
      reason:'The main comparison is clear.',nextStep:'Keep linking sales figures to countries.',
      evidence:[{kind:'relationship',quote:'Australia has the highest sales at 80 million dollars.',factIndices:[0]}]};
  },{contentPolicy:legacy});
  assert.equal(seen,legacy);assert.equal(result.total,6);assert.equal(result.contentPolicyVersion,legacy);
  await assert.rejects(academy.grade(question,'answer',()=>{}, {contentPolicy:'unknown'}));
});

test('Exact deployed mock snapshot resumes; unreviewed source drift remains blocked',()=>{
  const assessment=require('../full-mock/assessment'),{digest}=require('../full-mock/paper');
  const adapters={assess:()=>{throw Error('Validation must not regrade.');}};
  const engine=assessment.createEngine({store:{},adapters});
  const frozen=structuredClone(engine.snapshot);
  frozen.scoringSources=structuredClone(require('../content/full-mock/di-number-context-previous-sources.json'));
  frozen.configuration.speakingContent.describeImagePolicy=academy.LEGACY_VERSION;
  const state={paperHash:frozen.paperHash,assessment:assessment.stateFor(frozen)};
  assert.equal(engine.validate(state),adapters);
  assert.deepEqual(state.assessment.snapshot,frozen);
  for(const file of ['speaking-scoring.js','full-mock/aggregation.js','describe-image-academy/scoring-policy.js']){
    const invalid=structuredClone(state);invalid.assessment.snapshot.scoringSources.files[file].sha256='0'.repeat(64);
    invalid.assessment.snapshotHash=digest(invalid.assessment.snapshot);
    assert.throws(()=>engine.validate(invalid),/different assessment version/);
  }
});
