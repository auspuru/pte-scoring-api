'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {gradePracticeContent}=require('../speaking-lab'),academy=require('../describe-image-academy'),format=require('../speaking-judge-format');
const q={id:'synthetic-di',type:'di',title:'Sales',facts:['Australia has the highest sales at 80 million dollars.']};
const text='Australia has the highest sales at 80 million dollars.';
const valid=()=>({score:6,relevance:'image-specific',accuracy:'accurate',scoreImpact:null,reason:'The category, measure and maximum are connected.',nextStep:'Keep connecting sales values to their countries.',evidence:[{quote:text,factIndices:[0],kind:'relationship'}]});

test('Practice repairs a completed inconsistent review once using the same source and exact transcript',async()=>{
 let calls=0;
 const result=await gradePracticeContent(q,text,async(prompt,context)=>{
  calls++;assert.equal(context.question,q);assert.equal(context.transcript,text);
  if(calls===1){assert.equal(context.validationRepair,undefined);return {...valid(),accuracy:'minor-errors'};}
  assert.equal(context.validationRepair.issue,'accuracy-evidence');
  const wire=format.request(prompt,'fake-model',context);
  assert.match(wire.messages[0].content,/VALIDATION REPAIR/);
  assert(wire.messages[0].content.includes(text));assert(wire.messages[0].content.includes(q.facts[0]));
  return valid();
 });
 assert.equal(calls,2);assert.equal(result.total,6);assert.equal(result.contentRepair.status,'recovered');
});

test('A second invalid review remains unavailable rather than receiving invented credit',async()=>{
 let calls=0;const result=await gradePracticeContent(q,text,async()=>{calls++;return {...valid(),accuracy:'minor-errors'};});
 assert.equal(calls,2);assert.equal(result.total,null);assert.equal(result.contentStatus,'unavailable');
 assert.equal(result.contentRepair.status,'unavailable');
});

test('Transport failures, successful reviews and source-limited abstentions never trigger extra requests',async()=>{
 for(const outcome of ['timeout','http','valid','source-limited']){
  let calls=0;
  const result=await gradePracticeContent(q,text,async()=>{
   calls++;if(outcome==='timeout')throw Object.assign(Error('timeout'),{name:'TimeoutError'});
   if(outcome==='http')throw Object.assign(Error('provider unavailable'),{status:429});
   if(outcome==='valid')return valid();
   return {score:null,relevance:'source-limited',accuracy:'unverifiable',scoreImpact:null,reason:'The supplied facts cannot establish the image context.',nextStep:'Verify the original image reference.',evidence:[{quote:text,factIndices:[],kind:'generic'}]};
  });
  assert.equal(calls,1,outcome);assert.equal(result.contentRepair,undefined);
 }
});

test('Frozen Full Mock grader retains its existing single-request failure contract',async()=>{
 let calls=0;const result=await academy.grade(q,text,async()=>{calls++;return {...valid(),accuracy:'minor-errors'};});
 assert.equal(calls,1);assert.equal(result.total,null);
});

test('Saved practice retry repairs only content and preserves recording, transcript and confirmed Azure traits',async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
 const express=require('express'),{installSpeakingLab}=require('../speaking-lab');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'di-content-repair-')),app=express();app.use(express.json());
 const question=require('../content/speaking-bank').questions.find(q=>q.type==='di'),transcript=question.facts[0];let calls=0;
 const service=installSpeakingLab(app,{directory,verifyToken:token=>token==='synthetic-session'?'alice':null,getAccount:async()=>({}),
  deliveryAssessmentAvailable:true,azureComparisonAvailable:false,
  transcribe:async()=>{throw Error('Do not retranscribe saved words.');},
  assessDelivery:async()=>{throw Error('Do not reassess confirmed audio.');},
  callModel:async()=>{
   calls++;
   return {score:3,relevance:'image-specific',accuracy:calls===1?'minor-errors':'accurate',reason:'One relevant feature is supplied without developing the main comparison.',nextStep:'Connect the main features with an image-specific comparison.',
    scoreImpact:{kind:'relationship',quote:transcript,factIndices:[0],observation:'The response presents one feature without connecting it to the main comparison.',impact:'The relationship between the main features remains unclear.'},evidence:[{quote:transcript,factIndices:[0],kind:'feature'}]};
  }});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{await service.waitForAssessments();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port+'/api/speaking',id=crypto.randomUUID();
 async function post(route,body){const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','x-session-token':'synthetic-session'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();}
 await post('/attempts',{id,questionId:question.id});
 const recording={hash:'synthetic-original-hash',mime:'audio/wav',data:Buffer.alloc(200,2).toString('base64')};
 const pronunciation={score:4,maximum:5,raw:88},fluency={score:5,maximum:5,raw:95},deliveryVersion=require('../speaking-delivery').VERSION;
 await service.store.update('alice',id,a=>({...a,status:'submitted',transcript,transcription:transcript,recording,
  result:{total:null,maximum:6,scoringMode:'unavailable',contentStatus:'unavailable',contentPolicyVersion:academy.VERSION,score_provisional:true,pronunciation,fluency,deliveryVersion}}));
 const repaired=await post('/attempts/'+id+'/submit',{});
 assert.equal(repaired.result.total,3);assert.equal(calls,2);assert.deepEqual(repaired.result.pronunciation,pronunciation);assert.deepEqual(repaired.result.fluency,fluency);
 const saved=(await service.store.get('alice',id));assert.deepEqual(saved.recording,recording);assert.equal(saved.transcript,transcript);
 await post('/attempts/'+id+'/submit',{});assert.equal(calls,2,'Confirmed content is reused.');
});

test('Practice-only review wiring resumes the exact previous mock snapshot and rejects native drift',()=>{
 const assessment=require('../full-mock/assessment'),{digest}=require('../full-mock/paper');
 const adapters={assess:()=>{throw Error('Read-only compatibility check must not grade.');}},engine=assessment.createEngine({store:{},adapters});
 const frozen=structuredClone(engine.snapshot);frozen.scoringSources=structuredClone(require('../content/full-mock/di-practice-review-compatible-sources.json').previous);
 const state={paperHash:frozen.paperHash,assessment:assessment.stateFor(frozen)};
 assert.equal(engine.validate(state),adapters);assert.deepEqual(state.assessment.snapshot,frozen);
 const changed=structuredClone(state);changed.assessment.snapshot.scoringSources.files['speaking-scoring.js'].sha256='0'.repeat(64);changed.assessment.snapshotHash=digest(changed.assessment.snapshot);
 assert.throws(()=>engine.validate(changed),/different assessment version/);
});
