'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {loadPaper,digest}=require('../full-mock/paper'),{aggregate,inputHash}=require('../full-mock/aggregation');
const adapters=require('../full-mock/adapters'),assessment=require('../full-mock/assessment');
const {createStore}=require('../full-mock/store'),{make}=require('./helpers/full-mock-final-question');
const {releaseUnclearAudio,validExclusion,createSupport}=require('../full-mock/exclusions');
const paper=loadPaper(),owner='synthetic-unclear-audio';
function fixture(type='asq'){
 const f=make(paper,{type}),a=f.state.assessment,j=a.items[f.selected.id];
 a.recovery={version:1,status:'scheduled',retries:0,nextAt:999999};
 j.result={status:'failed',reason:type==='asq'?'transcription-unavailable':'delivery-unavailable'};
 j.stages=type==='asq'?{transcription:{status:'failed',uncertain:false,failureCode:'unintelligible_audio'}}:{transcription:{status:'complete',value:'Retained words'},content:{status:'complete',value:{total:2,maximum:3}},delivery:{status:'partial',uncertain:false,audioQuality:'insufficient-speech',traits:{pronunciation:{score:3}}}};
 return f;
}
for(const type of ['asq','rs'])test('One confirmed unusable '+type+' releases without retry, zero, provider calls or changed evidence',()=>{
 const f=fixture(type),before=digest({responses:f.state.responses,jobs:f.state.assessment.items,snapshot:f.state.assessment.snapshot});
 assert.equal(releaseUnclearAudio(f.state,paper,3000),true);
 const result=aggregate(paper,f.state);assert.equal(result.ready,true);assert.equal(result.assessedCount,64);assert.equal(result.excludedCount,1);
 assert.equal(digest({responses:f.state.responses,jobs:f.state.assessment.items,snapshot:f.state.assessment.snapshot}),before);
 assert(validExclusion(f.state,f.selected,f.state.responses[f.position],f.state.assessment.items[f.selected.id]));
 assert.equal(releaseUnclearAudio(f.state,paper,3001),false);
});
for(const condition of ['unknown-error','server-error','auth','quota','uncertain','running','blocked','incomplete-upload','wrong-input','wrong-snapshot','active','lease','multiple','already-scored','no-same-task'])test('Unclear-audio policy holds '+condition,()=>{
 const f=fixture(condition==='no-same-task'?'essay':'asq'),s=f.state,a=s.assessment,j=a.items[f.selected.id],stage=j.stages.transcription;
 if(condition==='unknown-error')stage.failureCode='provider';if(condition==='server-error')stage.failureCode=503;
 if(condition==='auth')stage.failureCode=401;if(condition==='quota')stage.failureCode='insufficient_quota';
 if(condition==='uncertain')stage.uncertain=true;if(condition==='running')stage.status='running';if(condition==='blocked')stage.recoveryBlocked=true;
 if(condition==='incomplete-upload'){s.responses[f.position].segments[0].chunks[0].stored=false;j.inputHash=inputHash(s.responses[f.position]);}
 if(condition==='wrong-input')j.inputHash='wrong';if(condition==='wrong-snapshot')j.snapshotHash='wrong';if(condition==='active')s.status='active';if(condition==='lease')a.lease={id:'another',expiresAt:9000};
 if(condition==='multiple')a.items[paper.questions[0].id].status='failed';
 if(condition==='already-scored'){j.status='assessed';j.result=adapters.result(f.selected.question,{content:0});}
 const selectedPaper=paper;
 const before=digest({responses:s.responses,jobs:a.items});assert.equal(releaseUnclearAudio(s,selectedPaper,3000),false);assert.equal(a.exclusions,undefined);assert.equal(digest({responses:s.responses,jobs:a.items}),before);
});
test('Empty successful recognition has a distinct code; network and malformed responses do not',async()=>{
 for(const mode of ['empty','malformed','network']){
  const engine=adapters.createAdapters({transcribe:async()=>{if(mode==='network')throw Object.assign(Error('timeout'),{uncertain:true});return mode==='empty'?'   ':{};},assessDelivery:async()=>{throw Error('No delivery');},gradeSpeaking:async()=>{throw Error('No content');}});
  const value=await engine.assess({type:'asq',answers:['answer']},{sealed:true,segments:[{chunkCount:1}]},{recording:{}});
  assert.equal(value.status,'failed');assert.equal(value.stages.transcription.failureCode==='unintelligible_audio',mode==='empty');
  if(mode==='network')assert.equal(value.stages.transcription.uncertain,true);
 }
});
test('An explicit instructor request releases the one older failed ASQ without claiming audio review',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'unclear-audio-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const store=createStore({directory}),f=fixture();f.state.assessment.items[f.selected.id].stages.transcription.failureCode='provider';
 const snapshot=structuredClone(assessment.snapshot());snapshot.scoringSources=require('../content/full-mock/unclear-audio-compatible-sources.json');
 f.state.assessment.snapshot=snapshot;f.state.assessment.snapshotHash=digest(snapshot);for(const j of Object.values(f.state.assessment.items))j.snapshotHash=f.state.assessment.snapshotHash;
 await store.create(owner,f.state.id,paper,()=>f.state,1000);
 const engine=assessment.createEngine({store,paper,adapters:{assess:async()=>{throw Error('No provider');}},now:()=>3000});t.after(()=>engine.stop());
 engine.validate(f.state);
 const support=createSupport({store,validate:engine.validate,now:()=>3000}),before=await support.inspect(owner,f.state.id);
 assert.equal(before.questions[0].transcriptionEligible,true);
 const body={mode:'failed-transcription',confirmInstructorExclusion:true,operation:'instructor-transcription-1',evidenceHash:before.evidenceHash,questionIds:[f.selected.id],note:'Excluded at instructor request because transcription is unavailable. Original recording retained.'};
 const after=await support.exclude(owner,f.state.id,body);assert.equal(after.ready,true);assert.equal(after.assessedCount,64);assert.equal(after.excludedCount,1);assert.equal(after.responsesHash,before.responsesHash);assert.equal(after.confirmedHash,before.confirmedHash);
 assert.equal((await support.exclude(owner,f.state.id,body)).evidenceHash,after.evidenceHash);
 const changed=structuredClone(f.state);changed.assessment.snapshot.scoringSources.files['full-mock/adapters.js'].sha256='f'.repeat(64);changed.assessment.snapshotHash=digest(changed.assessment.snapshot);assert.throws(()=>engine.validate(changed));
});
test('The worker releases the final confirmed unclear recording as soon as other assessments are complete',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'unclear-worker-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const store=createStore({directory}),f=fixture();await store.create(owner,f.state.id,paper,()=>f.state,1000);let calls=0;
 const engine=assessment.createEngine({store,paper,now:()=>3000,assemble:async()=>({status:'ready',recording:{}}),adapters:{assess:async(q,r,{previous})=>{calls++;return {status:'failed',reason:'transcription-unavailable',stages:previous};}}});t.after(()=>engine.stop());
 await engine.request(owner,f.state.id,{retry:true});await engine.drain();const saved=(await store.get(owner,f.state.id)).state;
 assert.equal(saved.assessment.status,'complete');assert.equal(aggregate(paper,saved).excludedCount,1);assert.equal(saved.assessment.recovery.retries,0);assert.equal(calls,1);
});
