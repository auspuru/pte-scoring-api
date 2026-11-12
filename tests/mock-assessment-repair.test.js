'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createAdapters}=require('../full-mock/adapters');
const {assessmentFailure}=require('../mock-recovery-policy');
const {loadPaper,digest}=require('../full-mock/paper');
const assessment=require('../full-mock/assessment');
const academy=require('../describe-image-academy');
const sst=loadPaper().questions.find(row=>row.question.type==='sst').question;
const answer='The lecture explains how communities can improve public transport through better planning and investment. Reliable services help residents reach work and education while reducing traffic and pollution. The speaker highlights the importance of cooperation between local authorities and passengers. Overall, careful planning and regular evaluation can produce a more efficient system that meets the needs of different people.';
const response={sealed:true,answer:[answer],segments:[]};
const native=()=>({scores:{content:4,form:2,grammar:2,vocabulary:2,spelling:2},formInvalid:false,formReason:'',
  feedback:Object.fromEntries(['content','form','grammar','vocabulary','spelling'].map(key=>[key,'Accurate and clear.'])),
  strengths:['Relevant meaning.'],improvements:[],errors:[]});
const di={id:'repair-di',type:'di',title:'Campus travel',imageCategory:'line',facts:['Trips rose from 200 to 450, with a brief fall in 2021.']};
const transcript='The image shows trips rising from 200 to 450, despite a brief fall.';
const judgment=()=>({judgment:{score:6,relevance:'image-specific',accuracy:'accurate',scoreImpact:null,
  requiredEvidence:{quote:'trips rising from 200 to 450',factIndices:[0],kind:'relationship'},otherEvidence:[]},
  reason:'The main trend and exception form a clear picture.',nextStep:'Keep the connected trend and exception.'});

for(const error of [Object.assign(Error('private provider body'),{status:401}),
  Object.assign(Error('private billing body'),{status:429,code:'insufficient_quota'}),
  Object.assign(Error('private timeout body'),{name:'TimeoutError'}),
  Object.assign(Error('private service body'),{status:503})]){
 test('SST preserves '+(error.code||error.status||error.name)+' without an internal transport retry',async()=>{
  let calls=0;const service=createAdapters({writingContentModel:async()=>{calls++;throw error;}});
  const result=await service.assess(sst,response),stage=result.stages.writing,expected=assessmentFailure(error);
  assert.equal(result.status,'failed');assert.equal(result.reason,'writing-unavailable');assert.equal(calls,1);
  assert.equal(stage.failureCode,expected.code);assert.equal(stage.uncertain,expected.uncertain);
  assert.equal(stage.recoveryBlocked,expected.blocked);assert.equal(stage.providerCalls,1);
  assert(!JSON.stringify(stage).includes('private'));
  await service.assess(sst,response,{previous:result.stages,run:1});assert.equal(calls,1);
 });
}
test('SST repairs one invalid completed assessment and never repeats a confirmed result',async()=>{
 let calls=0;const checkpoints=[],service=createAdapters({writingContentModel:async prompt=>{
  calls++;if(calls===1)return {...native(),scores:{...native().scores,form:0}};
  assert.match(prompt,/VALIDATION RETRY/);assert.match(prompt,/SST permits multiple complete sentences/);return native();
 }});
 const result=await service.assess(sst,response,{checkpoint:async stages=>checkpoints.push(structuredClone(stages))});
 assert.equal(result.status,'assessed');assert.equal(result.total,12);assert.equal(calls,2);
 assert.equal(result.stages.writing.providerCalls,2);
 assert(checkpoints.some(s=>s.writing.status==='running'&&s.writing.uncertain&&s.writing.providerCalls===2));
 await service.assess(sst,response,{previous:result.stages,run:2});assert.equal(calls,2);
});
test('SST malformed JSON gets one correction; exhausted invalid evidence retains its validation code',async()=>{
 let calls=0;const service=createAdapters({writingContentModel:async()=>{if(++calls===1)throw new SyntaxError('Invalid JSON');return native();}});
 assert.equal((await service.assess(sst,response)).status,'assessed');assert.equal(calls,2);
 calls=0;const failed=await createAdapters({writingContentModel:async()=>{calls++;return {...native(),errors:[{phrase:'invented student words',correction:'x',explanation:'x'}]};}}).assess(sst,response);
 assert.equal(calls,2);assert.equal(failed.status,'failed');assert.equal(failed.stages.writing.failureCode,'assessment_validation');
 assert.equal(failed.stages.writing.validationCode,'writing_validation');assert.equal(failed.stages.writing.failureCategory,'validation');
 assert.equal(failed.stages.writing.uncertain,false);assert.equal(failed.stages.writing.providerStatus,undefined);
});
test('DI corrects inconsistent output once using the same transcript and validation rule',async()=>{
 let calls=0;const service=createAdapters({transcribe:async()=>transcript,speakingContentModel:async(_,context)=>{
  calls++;assert.equal(context.transcript,transcript);
  const raw=judgment();if(calls===1)raw.judgment.relevance='limited';
  else {assert.equal(context.validationIssue,'inconsistent-score');assert.match(academy.request('test',context).messages[0].content,/VALIDATION RETRY: inconsistent-score/);}
  return raw;
 },assessDelivery:async()=>({pronunciation:{score:4},fluency:{score:4}})});
 const result=await service.assess(di,{sealed:true,segments:[{chunkCount:1}]},{recording:{}});
 assert.equal(result.status,'assessed');assert.equal(result.scores.content,6);assert.equal(calls,2);
 assert.equal(result.stages.content.providerCalls,2);
 await service.assess(di,{sealed:true,segments:[{chunkCount:1}]},{recording:{},previous:result.stages,run:2});assert.equal(calls,2);
});
test('DI does not repair transport failures or source-limited judgments; invalid judgments have a two-call cap',async()=>{
 for(const mode of ['auth','timeout','source','invalid']){
  let calls=0;const service=createAdapters({transcribe:async()=>transcript,speakingContentModel:async()=>{
   calls++;if(mode==='auth')throw Object.assign(Error('private'),{status:403});
   if(mode==='timeout')throw Object.assign(Error('private'),{name:'TimeoutError'});
   if(mode==='source')return {judgment:{score:null,relevance:'source-limited',accuracy:'unverifiable',scoreImpact:null,
    otherEvidence:[{quote:transcript,factIndices:[],kind:'generic'}]},reason:'Source cannot verify the response.',nextStep:'Review the original source.'};
   const raw=judgment();raw.judgment.relevance='limited';return raw;
  }});
  const result=await service.assess(di,{sealed:true,segments:[{chunkCount:1}]},{recording:{}}),stage=result.stages.content;
  assert.equal(result.status,'failed',mode);assert.equal(calls,mode==='invalid'?2:1,mode);
  assert.equal(stage.recoveryBlocked,mode!=='invalid',mode);
  if(mode==='invalid'){assert.equal(stage.validationCode,'inconsistent-score');assert.equal(stage.providerStatus,undefined);}
 }
});
test('Recovery transport preserves exact older snapshots and rejects tampered scoring sources',()=>{
 const pins=require('../content/full-mock/assessment-recovery-pins.json');
 const engine=assessment.createEngine({store:{}}),snapshot={...engine.snapshot,scoringSources:structuredClone(pins.previous)};
 const state={paperHash:snapshot.paperHash,assessment:{version:assessment.VERSION,snapshot,snapshotHash:digest(snapshot)}};
 assert.doesNotThrow(()=>engine.validate(state));
 snapshot.scoringSources.files['writing-lab-scoring.js'].sha256='0'.repeat(64);state.assessment.snapshotHash=digest(snapshot);
 assert.throws(()=>engine.validate(state),/different assessment version/);
});
