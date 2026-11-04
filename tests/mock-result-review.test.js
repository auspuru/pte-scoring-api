'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const review=require('../mock-result-review'),{hash}=require('../scoring-jobs');
const report=require('../speaking-mock-report');
function speaking(){const questions=structuredClone(require('../content/speaking-mocks').papers[0].questions);return{id:randomUUID(),paperId:'speaking-mock-1',title:'Synthetic review',questions,questionCount:27,status:'submitted',index:28,startedAt:1000,finishedAt:2000,deadline:2000,grading:{status:'pending'},responses:questions.map((q,i)=>({recording:{hash:'audio-'+i,mime:'audio/webm',data:'SAVED_AUDIO'},transcript:'Retained exact spoken answer',transcriptionStatus:'assessed',content:{scoringMode:'ai',total:report.contentMaximum(q),maximum:report.contentMaximum(q)},azure:{status:'assessed',pronunciation:{score:4},fluency:{score:5}}}))};}
const command=(plan,action,operation)=>({mode:'instructor-review',action,operation,evidenceHash:plan.evidenceHash,...(action==='publish'?{note:'Published at instructor request after analysis; unavailable questions are excluded.',confirmPublish:true}:{})});
test('Deadline gaps can be analysed without fictitious retries, then published only by a separate explicit action',()=>{
 const a=speaking();a.index=27;a.submission={version:1,state:'incomplete',reason:'deadline',pending:[],missing:[],unattempted:[27]};a.responses[27]={deadlineUnattempted:true,reason:'deadline-unattempted'};
 let p=review.speakingPlan(a,a,[],3000);const analysed=review.applySpeaking(a,a,[],command(p,'analyse','review:analysis-1'),3000);
 assert(review.held(analysed));assert.deepEqual(analysed.responses,a.responses);assert.equal(analysed.instructorReview.rounds.length,0);
 p=review.speakingPlan(analysed,analysed,[],3000);assert(p.canPublish);assert.equal(p.canRetry,false);
 assert.throws(()=>review.applySpeaking(analysed,analysed,[],{...command(p,'publish','review:publish-1'),confirmPublish:false},3000),{status:400});
 const body=command(p,'publish','review:publish-1'),published=review.applySpeaking(analysed,analysed,[],body,3000);
 assert.equal(require('../speaking-mock-submission').blocked(published),false);assert.equal(report.summarize(published).azure.excludedCount,1);assert.equal(report.summarize(published).azure.assessedCount,26);
 assert.deepEqual(published.responses,a.responses);assert.equal(review.publicationValid(published,'speaking'),true);
 assert.deepEqual(review.applySpeaking(published,published,[],body,4000),published);
 const changed=structuredClone(published);changed.responses[1].content.total--;assert.equal(review.publicationValid(changed,'speaking'),false);
});
test('Speaking makes exactly two missing-stage calls, keeps companion marks, persists its cap and never publishes automatically',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-review-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const store=require('../writing-lab-store').createStore(null,directory,{table:'speaking_mock_attempts'}),a=speaking(),i=27;delete a.responses[i].azure.fluency;await store.update('owner',a.id,()=>a);
 let calls=0;const service=require('../speaking-mock-jobs').createMockJobs({directory,store,now:()=>3000,assessAzure:async()=>{calls++;throw Object.assign(Error('Synthetic temporary failure'),{status:503});}});t.after(()=>service.stop());
 await service.jobs.enqueue({id:'held-review-job',owner:'owner',groupId:a.id,inputHash:hash({recording:a.responses[i].recording.hash,question:a.questions[i]}),data:{index:i,recordingHash:a.responses[i].recording.hash,questionHash:hash(a.questions[i]),patch:{azure:a.responses[i].azure},stages:{azure:{status:'needs_attention',attempts:3,failure:503}}}});
 await service.wait();assert.equal(calls,0);
 let d=await service.diagnostics('owner',a.id);
 await assert.rejects(service.repair('another',a.id,command(d.review,'analyse','review:first-round')),{status:404});
 for(let n=1;n<=2;n++){
  const body=command(d.review,'analyse','review:round-'+n);await service.repair('owner',a.id,body);await service.wait();
  const copy=await store.get('owner',a.id);assert(review.held(copy));assert.equal(copy.assessment?.status==='ready',false);assert.equal(copy.responses[i].azure.pronunciation.score,4);
  await service.repair('owner',a.id,body);await service.wait();assert.equal(calls,n,'Replaying an operation does not add a provider call.');d=await service.diagnostics('owner',a.id);
 }
 assert.equal(d.review.retries,2);assert.equal(d.review.canRetry,false);assert.equal(d.review.canPublish,true);assert.equal(d.ready,false);
 await service.repair('owner',a.id,command(d.review,'analyse','review:third-round'));await service.wait();assert.equal(calls,2);
 d=await service.diagnostics('owner',a.id);const publish=command(d.review,'publish','review:publish-two');
 const after=await service.repair('owner',a.id,publish);assert.equal(after.ready,true);assert.equal(after.assessedCount,26);assert.equal(after.excludedCount,1);assert.equal(calls,2);
 const saved=await store.get('owner',a.id);assert.deepEqual(saved.responses,a.responses);assert.deepEqual(saved.questions,a.questions);
});
test('Speaking rejects active work, stale inputs, premature publication and loss of an entire task',()=>{
 const a=speaking();delete a.responses[27].azure;const row={id:'held',status:'needs_attention',data:{index:27,recordingHash:a.responses[27].recording.hash,questionHash:hash(a.questions[27]),stages:{azure:{status:'needs_attention',failure:503}}}};
 let p=review.speakingPlan(a,a,[row],3000),b=review.applySpeaking(a,a,[row],command(p,'analyse','review:guarded-start'),3000);
 p=review.speakingPlan(b,b,[row],3000);assert.equal(p.canPublish,false);assert.throws(()=>review.applySpeaking(b,b,[row],command(p,'publish','review:too-early'),3000));
 const c=structuredClone(b);c.responses[1].recording.hash='different';assert.equal(review.speakingPlan(c,c,[row],3000).canPublish,false);
 const active=speaking();active.status='active';delete active.responses[27].azure;p=review.speakingPlan(active,active,[row],3000);assert.equal(p.canAnalyse,false);
 const sole=speaking();sole.responses[26]={};sole.responses[27]={};p=review.speakingPlan(sole,sole,[],3000);assert.match(p.problem,/whole task/);
});
test('Protected provider failures are not repeated or mislabelled as two retries, and multiple unavailable questions remain explicit',()=>{
 const a=speaking();delete a.responses[26].azure;delete a.responses[27].azure;
 for(const code of [401,'invalid_api_key','insufficient_quota','uncertain_provider_outcome']){
  const rows=[26,27].map(i=>({id:'held-'+i,status:'needs_attention',data:{index:i,recordingHash:a.responses[i].recording.hash,questionHash:hash(a.questions[i]),stages:{azure:{status:'needs_attention',failure:code}}}}));
  let p=review.speakingPlan(a,a,rows,3000);assert(p.questions.every(q=>!q.retryable));const next=review.applySpeaking(a,a,rows,command(p,'analyse','review:protected-analysis'),3000);p=review.speakingPlan(next,next,rows,3000);assert.equal(p.retries,0);
  // Both RTS items would remove a complete task, so the original native
  // task-coverage rule must keep this case held instead.
  assert.match(p.problem,/whole task/);assert.equal(p.canPublish,false);
 }
});
test('Speaking remote DI retries use the retained receipt and a distinct idempotent operation for each of the two rounds',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-remote-review-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const store=require('../writing-lab-store').createStore(null,directory,{table:'speaking_mock_attempts'}),a=speaking(),i=a.questions.findIndex(q=>q.type==='di');delete a.responses[i].content;await store.update('owner',a.id,()=>a);
 const operations=[];const service=require('../speaking-mock-jobs').createMockJobs({directory,store,now:()=>3000,academyClient:{poll:async()=>({status:'failed',failures:[{stage:'content',code:503,retryable:true}]}),retry:async(receipt,body)=>{assert.equal(receipt.id,'retained-remote');operations.push(body.operation);}}});t.after(()=>service.stop());
 await service.jobs.enqueue({id:'remote-review-job',owner:'owner',groupId:a.id,inputHash:hash({recording:a.responses[i].recording.hash,question:a.questions[i]}),data:{index:i,recordingHash:a.responses[i].recording.hash,questionHash:hash(a.questions[i]),patch:{},remote:{id:'retained-remote'},remoteFailures:[{stage:'content',code:503,retryable:true}],stages:{academy:{status:'needs_attention'}}}});await service.wait();
 for(let n=1;n<=2;n++){const d=await service.diagnostics('owner',a.id);await service.repair('owner',a.id,command(d.review,'analyse','review:remote-round-'+n));await service.wait();}
 assert.equal(operations.length,2);assert.equal(new Set(operations).size,2);assert.equal((await service.diagnostics('owner',a.id)).review.canRetry,false);
});
async function fullFixture(t,{recover=false}={}){
 const {loadPaper}=require('../full-mock/paper'),session=require('../full-mock/session'),assessment=require('../full-mock/assessment'),adapters=require('../full-mock/adapters'),{inputHash}=require('../full-mock/aggregation');
 const paper=loadPaper(),directory=await fs.mkdtemp(path.join(os.tmpdir(),'full-review-')),store=require('../full-mock/store').createStore({directory});t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const state=session.create(randomUUID(),paper,1000,{preview:true});session.end(state,paper,2000);state.assessment=assessment.stateFor(assessment.snapshot());state.assessment.status='needs-attention';
 const index=paper.questions.findIndex(q=>q.question.type==='rs'),selected=paper.questions[index];
 for(const [i,q]of paper.questions.entries()){const r=state.responses[i+1];if(i===index)r.segments=[{id:randomUUID(),mime:'audio/webm',finished:true,chunkCount:1,chunks:{0:{stored:true,sha256:'a'.repeat(64),bytes:100}}}];
  state.assessment.items[q.id]={status:i===index?'failed':'assessed',inputHash:inputHash(r),snapshotHash:state.assessment.snapshotHash,...(i===index?{result:{status:'failed',reason:'delivery-unavailable'},stages:{transcription:{status:'complete',value:'Retained transcript'},content:{status:'complete',value:{total:3}},delivery:{status:'partial',uncertain:false,traits:{pronunciation:{score:4}}}}}:{result:adapters.result(q.question,adapters.maxima(q.question)),stages:{}})};
 }
 await store.create('owner',state.id,paper,()=>state,1000);let calls=0;
 const makeEngine=()=>assessment.createEngine({store,paper,now:()=>3000,assemble:async()=>({status:'ready',recording:{}}),adapters:{assess:async(q,r,options)=>{calls++;return recover?adapters.result(q,adapters.maxima(q),{stages:options.previous}):{status:'failed',reason:'delivery-unavailable',stages:options.previous};}}});const engine=makeEngine();t.after(()=>engine.stop());
 return{paper,store,state,index,selected,engine,makeEngine,calls:()=>calls};
}
test('Full Mock retries twice, survives controller recreation and publishes only with an explicit final POST',async t=>{
 const f=await fullFixture(t);t.after(()=>f.engine.stop());const plan=async()=>{const r=await f.store.get('owner',f.state.id);return review.fullPlan(r.state,r.paper,3000);};
 for(let n=1;n<=2;n++){const p=await plan(),body=command(p,'analyse','review:full-round-'+n);await f.engine.review('owner',f.state.id,body);await f.engine.drain();assert.equal(f.calls(),n);await f.engine.review('owner',f.state.id,body);await f.engine.drain();assert.equal(f.calls(),n);assert.equal((await f.engine.results('owner',f.state.id)).ready,false);if(n===1){await f.engine.stop();f.engine=f.makeEngine();}}
 const p=await plan();assert.equal(p.retries,2);assert(p.canPublish);assert.equal(p.canRetry,false);await f.engine.recover();await f.engine.drain();assert.equal(f.calls(),2);
 await assert.rejects(f.engine.request('owner',f.state.id,{retry:true}),{status:409});
 await assert.rejects(f.engine.review('another',f.state.id,command(p,'publish','review:full-pub')),{status:404});
 const body=command(p,'publish','review:full-pub');await f.engine.review('owner',f.state.id,body);await f.engine.review('owner',f.state.id,body);
 const record=await f.store.get('owner',f.state.id),result=await f.engine.results('owner',f.state.id);assert(result.ready);assert.equal(result.assessedCount,64);assert.equal(result.excludedCount,1);assert.equal(f.calls(),2);
 assert.deepEqual(record.state.responses,f.state.responses);assert.deepEqual(review.confirmed(record.state,'full'),review.confirmed(f.state,'full'));assert.equal(record.state.assessment.snapshotHash,f.state.assessment.snapshotHash);
});
test('Recovered Full Mock scores remain withheld until Publish results, without an unnecessary second retry',async t=>{
 const f=await fullFixture(t,{recover:true}),p=review.fullPlan(f.state,f.paper,3000);await f.engine.review('owner',f.state.id,command(p,'analyse','review:recover-one'));await f.engine.drain();
 let r=await f.store.get('owner',f.state.id),plan=review.fullPlan(r.state,r.paper,3000);assert.equal(f.calls(),1);assert.equal(plan.questions.length,0);assert(plan.canPublish);
 const result=await f.engine.results('owner',f.state.id);assert.equal(result.ready,false);assert.equal(result.profiles.overall.practiceIndexRange,null);
 const summary=require('../full-mock/report').summary(r.paper,r.state);assert.equal(summary.ready,false);assert.equal(summary.assessmentStatus,'awaiting-instructor');
 await f.engine.review('owner',f.state.id,command(plan,'publish','review:recovered-publish'));assert.equal((await f.engine.results('owner',f.state.id)).ready,true);assert.equal(f.calls(),1);
});
