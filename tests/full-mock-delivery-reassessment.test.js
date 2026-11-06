'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {create}=require('../full-mock/delivery-reassessment'),{loadPaper}=require('../full-mock/paper'),session=require('../full-mock/session'),assessment=require('../full-mock/assessment'),adapters=require('../full-mock/adapters'),{inputHash,aggregate}=require('../full-mock/aggregation');
const {fixture,secondRecording}=require('./helpers/delivery-reassessment-fixture');
const result={version:'synthetic-continuous',pronunciation:{score:3,raw:60},fluency:{score:2,raw:40}};
test('An older Full Mock keeps its snapshot while explicit Azure reassessment publishes current bands',async t=>{
 const raw={version:'synthetic-continuous',pronunciation:{score:5,raw:94},fluency:{score:5,raw:90}};
 const f=await fixture(t,async()=>raw),delivery=require('../speaking-delivery');
 await f.store.update(f.owner,f.id,state=>{
  state.assessment.snapshot.configuration.delivery.version=delivery.PREVIOUS_VERSION;
  state.assessment.snapshot.scoringSources=require('../content/full-mock/delivery-bands-compatible-sources.json');
  state.assessment.snapshotHash=require('../full-mock/paper').digest(state.assessment.snapshot);
  for(const job of Object.values(state.assessment.items))job.snapshotHash=state.assessment.snapshotHash;
  return state;
 });
 const controller=create({store:f.store,validate:assessment.createEngine({store:f.store}).validate,assess:async()=>raw,rebandCurrent:true});
 const view=await controller.inspect(f.owner,f.id),body={operation:'delivery:current-bands',questionIds:[f.q.id],evidenceHash:view.evidenceHash,autoPublish:true};
 assert.equal((await f.store.get(f.owner,f.id)).state.assessment.items[f.q.id].result.scores.pronunciation,5);
 await controller.send(f.owner,f.id,body);await controller.drain();
 const published=(await controller.inspect(f.owner,f.id)).operations[body.operation];
 assert.equal(published.status,'published');assert.equal(published.items[0].result.bandPolicy,delivery.VERSION);
 assert.deepEqual([published.items[0].result.pronunciation.score,published.items[0].result.fluency.score],[4,4]);
 const after=(await f.store.get(f.owner,f.id)).state;
 assert.equal(after.assessment.snapshot.configuration.delivery.version,delivery.PREVIOUS_VERSION);
 assert.deepEqual([after.assessment.items[f.q.id].result.scores.pronunciation,after.assessment.items[f.q.id].result.scores.fluency],[4,4]);
});
test('Original recording is sent once; publication replaces only delivery with archived results and recalculated profiles',async t=>{
 let calls=0;const f=await fixture(t,async recording=>{calls++;assert.equal(Buffer.from(recording.data,'base64').toString(),f.bytes.toString());return result;});
 const before=(await f.store.get(f.owner,f.id)).state,view=await f.api.inspect(f.owner,f.id),body={operation:'delivery:test-one',questionId:f.q.id,evidenceHash:view.evidenceHash};
 let review=await f.api.send(f.owner,f.id,body);assert.equal(review.operations[body.operation].status,'review');
 await f.api.send(f.owner,f.id,body);assert.equal(calls,1);
 assert.deepEqual((await f.store.get(f.owner,f.id)).state.assessment,before.assessment);
 await assert.rejects(f.api.publish(f.owner,f.id,{operation:body.operation}),/Confirm/);
 await f.api.publish(f.owner,f.id,{operation:body.operation,confirmPublish:true});
 await f.api.publish(f.owner,f.id,{operation:body.operation,confirmPublish:true});
 const after=(await f.store.get(f.owner,f.id)).state;
 assert.deepEqual(after.responses,before.responses);assert.equal(after.assessment.snapshotHash,before.assessment.snapshotHash);
 for(const c of f.paper.questions)if(c.id!==f.q.id)assert.deepEqual(after.assessment.items[c.id],before.assessment.items[c.id]);
 assert.equal(after.assessment.items[f.q.id].result.scores.content,6);
 assert.equal(after.assessment.items[f.q.id].result.scores.pronunciation,3);assert.equal(after.assessment.items[f.q.id].result.scores.fluency,2);
 assert.deepEqual(after.deliveryReassessments[body.operation].previous,before.assessment.items[f.q.id]);
 assert(aggregate(f.paper,after).profiles.speaking.practiceIndex<aggregate(f.paper,before).profiles.speaking.practiceIndex);
 await assert.rejects(f.api.inspect('another-student',f.id),/not found/);
});
test('Changed evidence prevents publication',async t=>{
 const f=await fixture(t,async()=>result),view=await f.api.inspect(f.owner,f.id),operation='delivery:stale-input';
 await assert.rejects(f.api.send(f.owner,f.id,{operation,questionId:f.q.id,evidenceHash:'stale'}),/changed/);
 await f.api.send(f.owner,f.id,{operation,questionId:f.q.id,evidenceHash:view.evidenceHash});
 await f.store.update(f.owner,f.id,s=>{s.responses[f.number].answer=['changed'];return s;});
 await assert.rejects(f.api.publish(f.owner,f.id,{operation,confirmPublish:true}),/complete|changed/);
});
test('Unconfirmed calls remain blocked across controller restart; old marks stay intact',async t=>{
 let calls=0;const f=await fixture(t,async()=>{calls++;throw Object.assign(Error('timeout'),{uncertain:true});}),before=(await f.store.get(f.owner,f.id)).state;
 const view=await f.api.inspect(f.owner,f.id),body={operation:'delivery:uncertain',questionId:f.q.id,evidenceHash:view.evidenceHash};
 const review=await f.api.send(f.owner,f.id,body);assert.equal(review.operations[body.operation].status,'confirmation-pending');
 await f.api.send(f.owner,f.id,body);await assert.rejects(f.api.send(f.owner,f.id,{...body,operation:'delivery:new-operation'}),/confirmation/);assert.equal(calls,1);
 assert.deepEqual((await f.store.get(f.owner,f.id)).state.assessment,before.assessment);
});
test('Competing controllers claim one provider request and a live worker prevents publication',async t=>{
 let calls=0,finish;const f=await fixture(t,async()=>{calls++;return new Promise(resolve=>{finish=resolve;});});
 const view=await f.api.inspect(f.owner,f.id),body={operation:'delivery:concurrent',questionId:f.q.id,evidenceHash:view.evidenceHash};
 const running=f.api.send(f.owner,f.id,body);
 while(!finish)await new Promise(resolve=>setImmediate(resolve));
 const other=create({store:f.store,validate:assessment.createEngine({store:f.store}).validate,assess:async()=>{throw Error('must not call');}});
 const response=await other.send(f.owner,f.id,body);assert.equal(response.operations[body.operation].status,'running');assert.equal(calls,1);
 finish(result);await running;
 await f.store.update(f.owner,f.id,s=>{s.assessment.lease={id:'other-worker',expiresAt:Date.now()+60000};return s;});
 await assert.rejects(other.publish(f.owner,f.id,{operation:body.operation,confirmPublish:true}),/settled/);
 assert.equal((await f.store.get(f.owner,f.id)).state.assessment.items[f.q.id].result.scores.fluency,5);
});
test('Malformed provider scores never replace marks',async t=>{
 let calls=0;const f=await fixture(t,async()=>{calls++;return {...result,fluency:{score:9}};});
 const v=await f.api.inspect(f.owner,f.id),body={operation:'delivery:malformed',questionId:f.q.id,evidenceHash:v.evidenceHash};
 const review=await f.api.send(f.owner,f.id,body);assert.equal(review.operations[body.operation].status,'confirmation-pending');
 await assert.rejects(f.api.publish(f.owner,f.id,{operation:body.operation,confirmPublish:true}),/changed/);
 assert.equal((await f.store.get(f.owner,f.id)).state.assessment.items[f.q.id].result.scores.fluency,5);assert.equal(calls,1);
});
test('Admin endpoints require authentication and bind the account and exact submitted attempt',async t=>{
 const f=await fixture(t,async()=>result),express=require('express'),app=express();app.use(express.json());
 require('../full-mock/api').installFullMock(app,{directory:f.directory,assessment:{},verifyToken:()=>null,getAccount:async owner=>owner===f.owner?{username:owner}:null,requireAdmin:(req,res,next)=>req.headers['x-admin-key']==='synthetic-admin'?next():res.sendStatus(403)});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port+'/api/admin/full-mocks/',headers={'x-admin-key':'synthetic-admin'};
 for(const suffix of ['/scoring/delivery','/scoring/delivery/send','/scoring/delivery/publish'])assert.equal((await fetch(base+f.owner+'/'+f.id+suffix,{method:suffix.endsWith('/delivery')?'GET':'POST'})).status,403);
 const list=await fetch(base+f.owner+'/attempts',{headers});assert.equal(list.status,200);assert.equal((await list.json()).attempts[0].id,f.id);
 assert.equal((await fetch(base+'another-student/attempts',{headers})).status,404);
 assert.equal((await fetch(base+'another-student/'+f.id+'/scoring/delivery',{headers})).status,404);
 assert.equal((await fetch(base+f.owner+'/'+f.id+'/scoring/delivery',{headers})).status,200);
});
test('A proposal must be published or discarded before another paid send; discarded receipts remain available',async t=>{
 let calls=0;const f=await fixture(t,async()=>{calls++;return result;}),v=await f.api.inspect(f.owner,f.id),body={operation:'delivery:discard-first',questionId:f.q.id,evidenceHash:v.evidenceHash};
 await f.api.send(f.owner,f.id,body);
 await assert.rejects(f.api.send(f.owner,f.id,{...body,operation:'delivery:discard-second'}),/discard/);assert.equal(calls,1);
 const value=await f.api.discard(f.owner,f.id,{operation:body.operation});assert.equal(value.operations[body.operation].status,'discarded');assert.deepEqual(value.operations[body.operation].result,result);
 assert.equal((await f.store.get(f.owner,f.id)).state.assessment.items[f.q.id].result.scores.fluency,5);
 await f.api.send(f.owner,f.id,{...body,operation:'delivery:discard-second'});assert.equal(calls,2);
});
test('Tampered recording chunks never reach the provider or change published marks',async t=>{
 let calls=0;const f=await fixture(t,async()=>{calls++;return result;});
 await f.store.update(f.owner,f.id,s=>{s.responses[f.number].segments[0].chunks[0].sha256='0'.repeat(64);s.assessment.items[f.q.id].inputHash=inputHash(s.responses[f.number]);return s;});
 const v=await f.api.inspect(f.owner,f.id),body={operation:'delivery:bad-chunks',questionId:f.q.id,evidenceHash:v.evidenceHash};
 const value=await f.api.send(f.owner,f.id,body);assert.equal(value.operations[body.operation].status,'confirmation-pending');assert.equal(calls,0);
 assert.equal((await f.store.get(f.owner,f.id)).state.assessment.items[f.q.id].result.scores.fluency,5);
});
async function waitFor(check){const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw Error('Expected background checkpoint was not reached');await new Promise(resolve=>setTimeout(resolve,5));}}
test('Batch send returns promptly, checkpoints each original recording once, then publishes both atomically',async t=>{
 let finish,calls=0;const sent=[];const f=await fixture(t,async recording=>{sent.push(Buffer.from(recording.data,'base64').toString());calls++;if(calls===1)return new Promise(resolve=>{finish=resolve;});return result;});
 const second=await secondRecording(f),before=(await f.store.get(f.owner,f.id)).state,v=await f.api.inspect(f.owner,f.id),body={operation:'delivery:batch-two',questionIds:[f.q.id,second.candidate.id],evidenceHash:v.evidenceHash};
 const queued=await f.api.send(f.owner,f.id,body);assert(['queued','running'].includes(queued.operations[body.operation].status));await waitFor(()=>!!finish);
 await f.api.send(f.owner,f.id,body);assert.equal(calls,1);finish(result);await f.api.drain();
 const review=await f.api.inspect(f.owner,f.id);assert.equal(review.operations[body.operation].status,'review');assert.equal(review.operations[body.operation].completedCount,2);assert.deepEqual(sent,[f.bytes.toString(),second.bytes.toString()]);
 assert.deepEqual((await f.store.get(f.owner,f.id)).state.assessment,before.assessment);
 await f.api.publish(f.owner,f.id,{operation:body.operation,confirmPublish:true});await f.api.publish(f.owner,f.id,{operation:body.operation,confirmPublish:true});
 const after=(await f.store.get(f.owner,f.id)).state;assert.equal(calls,2);assert.deepEqual(after.responses,before.responses);assert.equal(after.assessment.snapshotHash,before.assessment.snapshotHash);
 for(const question of f.paper.questions)if(!body.questionIds.includes(question.id))assert.deepEqual(after.assessment.items[question.id],before.assessment.items[question.id]);
 for(const id of body.questionIds){assert.equal(after.assessment.items[id].result.scores.pronunciation,3);assert.equal(after.assessment.items[id].result.scores.content,before.assessment.items[id].result.scores.content);}
 assert.deepEqual(after.deliveryReassessments[body.operation].beforeProfiles,aggregate(f.paper,before).profiles);
});
test('Whole-mock selection is stable on retry and missing Azure configuration gives a visible error before queuing',async t=>{
 let calls=0;const f=await fixture(t,async()=>{calls++;return result;}),second=await secondRecording(f),v=await f.api.inspect(f.owner,f.id);
 const unavailable=create({store:f.store,validate:assessment.createEngine({store:f.store}).validate,assess:async()=>result,providerConfiguration:()=>({ready:false,message:'Configure Azure endpoint first.'})});
 await assert.rejects(unavailable.send(f.owner,f.id,{operation:'delivery:no-config',all:true,evidenceHash:v.evidenceHash}),/Configure Azure endpoint/);
 assert.equal((await f.store.get(f.owner,f.id)).state.deliveryReassessments,undefined);
 const body={operation:'delivery:whole-mock',all:true,evidenceHash:v.evidenceHash};await f.api.send(f.owner,f.id,body);await f.api.drain();await f.api.send(f.owner,f.id,body);await f.api.drain();assert.equal(calls,2);
 const op=(await f.api.inspect(f.owner,f.id)).operations[body.operation];assert.deepEqual(op.questionIds,[second.candidate.id,f.q.id]);assert.equal(op.status,'review');
});
test('Partial batch preserves unavailable marks and requires explicit partial publication',async t=>{
 let calls=0;const f=await fixture(t,async()=>{calls++;if(calls===1)throw Object.assign(Error('timeout'),{uncertain:true});return result;}),second=await secondRecording(f),v=await f.api.inspect(f.owner,f.id),body={operation:'delivery:partial-batch',questionIds:[f.q.id,second.candidate.id],evidenceHash:v.evidenceHash};
 await f.api.send(f.owner,f.id,body);await f.api.drain();const review=await f.api.inspect(f.owner,f.id);assert.equal(review.operations[body.operation].status,'partial');assert.equal(review.operations[body.operation].completedCount,1);
 await assert.rejects(f.api.publish(f.owner,f.id,{operation:body.operation,confirmPublish:true}),/only the completed/);
 await f.api.publish(f.owner,f.id,{operation:body.operation,confirmPublish:true,confirmPartial:true});const after=(await f.store.get(f.owner,f.id)).state;
 assert.equal(after.assessment.items[f.q.id].result.scores.fluency,5);assert.equal(after.assessment.items[second.candidate.id].result.scores.fluency,2);
 await f.api.send(f.owner,f.id,body);await f.api.drain();assert.equal(calls,2);
 assert.equal((await f.api.inspect(f.owner,f.id)).questions.find(q=>q.id===f.q.id).blocked,true);
});
test('Restart resumes unsent recordings after an expired worker without repeating the uncertain request',async t=>{
 let firstCalls=0,late;const f=await fixture(t,async()=>{firstCalls++;return new Promise(resolve=>{late=resolve;});}),second=await secondRecording(f),v=await f.api.inspect(f.owner,f.id),body={operation:'delivery:restart-batch',questionIds:[f.q.id,second.candidate.id],evidenceHash:v.evidenceHash};
 await f.api.send(f.owner,f.id,body);await waitFor(()=>!!late);
 await f.store.update(f.owner,f.id,s=>{s.deliveryReassessments[body.operation].items[0].leaseExpiresAt=0;return s;});
 let resumedCalls=0;const resumed=create({store:f.store,validate:assessment.createEngine({store:f.store}).validate,assess:async()=>{resumedCalls++;return result;}});
 await resumed.inspect(f.owner,f.id);await resumed.drain();const review=await resumed.inspect(f.owner,f.id);assert.equal(firstCalls,1);assert.equal(resumedCalls,1);assert.equal(review.operations[body.operation].status,'partial');
 await resumed.publish(f.owner,f.id,{operation:body.operation,confirmPublish:true,confirmPartial:true});late(result);await f.api.drain();
 const op=(await resumed.inspect(f.owner,f.id)).operations[body.operation];assert.equal(op.status,'published');assert.deepEqual(op.items[0].lateResult,result);assert.equal((await f.store.get(f.owner,f.id)).state.assessment.items[f.q.id].result.scores.fluency,5);
});
test('Batch controls accept the exact previous deployed snapshot and still reject native scorer drift',async t=>{
 const f=await fixture(t,async()=>result);
 await f.store.update(f.owner,f.id,s=>{s.assessment.snapshot.scoringSources=require('../content/full-mock/azure-batch-compatible-sources.json');s.assessment.snapshotHash=require('../full-mock/paper').digest(s.assessment.snapshot);for(const job of Object.values(s.assessment.items))job.snapshotHash=s.assessment.snapshotHash;return s;});
 assert.equal((await f.api.inspect(f.owner,f.id)).questions.length,1);
 await f.store.update(f.owner,f.id,s=>{s.assessment.snapshot.scoringSources.files['speaking-scoring.js'].sha256='0'.repeat(64);s.assessment.snapshotHash=require('../full-mock/paper').digest(s.assessment.snapshot);for(const job of Object.values(s.assessment.items))job.snapshotHash=s.assessment.snapshotHash;return s;});
 await assert.rejects(f.api.inspect(f.owner,f.id),/different assessment version/);
});
test('Independent batch controllers and storage instances send every selected recording once',async t=>{
 let calls=0;const assess=async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,15));return result;},f=await fixture(t,assess),second=await secondRecording(f),v=await f.api.inspect(f.owner,f.id);
 const store=require('../full-mock/store').createStore({directory:f.directory}),other=create({store,validate:assessment.createEngine({store}).validate,assess}),body={operation:'delivery:two-controllers',questionIds:[f.q.id,second.candidate.id],evidenceHash:v.evidenceHash};
 await Promise.all([f.api.send(f.owner,f.id,body),other.send(f.owner,f.id,body)]);await Promise.all([f.api.drain(),other.drain()]);
 assert.equal(calls,2);assert.equal((await other.inspect(f.owner,f.id)).operations[body.operation].status,'review');
});

test('Previously published instructor exclusions remain valid during a delivery batch preview and publication',async t=>{
 const f=await fixture(t,async()=>result),review=require('../mock-result-review'),{hash}=require('../scoring-jobs');
 // This simulates a batch already saved by the previously deployed version.
 await f.store.update(f.owner,f.id,state=>{state.assessment.snapshot.scoringSources=require('../content/full-mock/azure-publication-compatible-sources.json');state.assessment.snapshotHash=require('../full-mock/paper').digest(state.assessment.snapshot);for(const job of Object.values(state.assessment.items))job.snapshotHash=state.assessment.snapshotHash;return state;});
 const excluded=f.paper.questions.find(q=>q.question.type==='rs');
 await f.store.update(f.owner,f.id,state=>{
  const job=state.assessment.items[excluded.id],response=state.responses[f.paper.questions.indexOf(excluded)+1];
  job.status='failed';job.reason='content-unavailable';
  const plan=review.fullPlan(state,f.paper,Date.now());
  state.instructorReview={version:review.VERSION,status:'published',operation:'review:started',startedAt:1,inputsHash:plan.inputsHash,confirmed:review.confirmed(state,'full'),rounds:[]};
  state.assessment.exclusions={[excluded.id]:{reason:'instructor-review-unavailable',operation:'review:publication',at:2,note:'Unavailable assessment excluded by instructor.',inputHash:inputHash(response),snapshotHash:state.assessment.snapshotHash,previousJobHash:hash(job)}};
  state.instructorReview.publication={operation:'review:publication',at:2,questionIds:[excluded.id],exclusionsHash:hash(state.assessment.exclusions)};
  return state;
 });
 const before=(await f.store.get(f.owner,f.id)).state;assert.equal(aggregate(f.paper,before).ready,true);assert.equal(review.publicationValid(before,'full'),true);
 const view=await f.api.inspect(f.owner,f.id),body={operation:'delivery:excluded-review',questionIds:[f.q.id],evidenceHash:view.evidenceHash};
 await f.api.send(f.owner,f.id,body);await f.api.drain();
 let repeatedCalls=0;const reopened=create({store:f.store,validate:assessment.createEngine({store:f.store}).validate,assess:async()=>{repeatedCalls++;throw Error('Saved results must not be sent again');}});
 const proposal=await reopened.inspect(f.owner,f.id),op=proposal.operations[body.operation];
 assert.equal(op.proposalReady,true);for(const profile of Object.values(op.proposedProfiles))assert.equal(profile.status,'complete');
 await reopened.publish(f.owner,f.id,{operation:body.operation,confirmPublish:true});assert.equal(repeatedCalls,0);
 const after=(await f.store.get(f.owner,f.id)).state;assert.equal(aggregate(f.paper,after).ready,true);assert.equal(review.publicationValid(after,'full'),true);
 assert.deepEqual(after.assessment.exclusions,before.assessment.exclusions);assert.deepEqual(after.instructorReview.publication,before.instructorReview.publication);assert.deepEqual(after.responses,before.responses);assert.equal(after.assessment.items[f.q.id].result.scores.pronunciation,3);
 for(const q of f.paper.questions)if(q.id!==f.q.id)assert.deepEqual(after.assessment.items[q.id],before.assessment.items[q.id]);
 const audit=after.deliveryReassessments[body.operation].instructorReviewAmendment;
 assert.deepEqual(audit.beforeConfirmed,before.instructorReview.confirmed);assert.deepEqual(audit.afterConfirmed,after.instructorReview.confirmed);
 assert.equal(audit.beforeHash,hash(audit.beforeConfirmed));assert.equal(audit.afterHash,hash(audit.afterConfirmed));
 assert.deepEqual(after.deliveryReassessments[body.operation].beforeProfiles,aggregate(f.paper,before).profiles);
 assert.deepEqual(after.deliveryReassessments[body.operation].afterProfiles,op.proposedProfiles);
 const express=require('express'),app=express();app.use(express.json());
 require('../full-mock/api').installFullMock(app,{directory:f.directory,assessment:{},verifyToken:token=>token==='student-session'?f.owner:token==='other-session'?'other-student':null,getAccount:async()=>({role:'user'}),canPreview:()=>true});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url='http://127.0.0.1:'+server.address().port,headers={'x-session-token':'student-session'};
 const detail=await fetch(url+'/api/full-mocks/attempts/'+f.id+'/report',{headers}),history=await fetch(url+'/api/full-mocks/attempts',{headers});
 assert.equal(detail.status,200);assert.equal(history.status,200);const report=await detail.json(),rows=await history.json(),row=rows.find(value=>value.id===f.id);
 assert.equal(report.ready,true);assert.deepEqual(report.profiles,op.proposedProfiles);assert.equal(report.items.find(item=>item.id===excluded.id).status,'excluded');
 assert.equal(report.items.find(item=>item.id===f.q.id).scores.pronunciation,3);assert.equal(row.ready,true);assert.equal(row.profiles.speaking.practiceIndex,report.profiles.speaking.practiceIndex);
 assert.deepEqual(row.profiles.overall.practiceIndexRange,report.profiles.overall.practiceIndexRange);
 assert.equal((await fetch(url+'/api/full-mocks/attempts/'+f.id+'/report',{headers:{'x-session-token':'other-session'}})).status,404);assert.equal(repeatedCalls,0);
});


test('An invalid prior publication blocks the proposal and keeps all saved marks unchanged',async t=>{
 const f=await fixture(t,async()=>result),review=require('../mock-result-review');
 await f.store.update(f.owner,f.id,state=>{const plan=review.fullPlan(state,f.paper,Date.now());state.instructorReview={version:review.VERSION,status:'published',inputsHash:plan.inputsHash,confirmed:{[f.q.id]:'incorrect-hash'},rounds:[],publication:{operation:'review:invalid',questionIds:[],exclusionsHash:require('../scoring-jobs').hash({})}};return state;});
 const before=(await f.store.get(f.owner,f.id)).state;assert.equal(aggregate(f.paper,before).ready,true);assert.equal(review.publicationValid(before,'full'),false);
 const view=await f.api.inspect(f.owner,f.id),body={operation:'delivery:invalid-history',questionIds:[f.q.id],evidenceHash:view.evidenceHash};await f.api.send(f.owner,f.id,body);await f.api.drain();
 const proposal=await f.api.inspect(f.owner,f.id);assert.equal(proposal.operations[body.operation].proposalReady,false);assert.match(proposal.operations[body.operation].proposalError,/earlier instructor publication/);
 await assert.rejects(f.api.publish(f.owner,f.id,{operation:body.operation,confirmPublish:true}),/earlier instructor publication/);
 const after=(await f.store.get(f.owner,f.id)).state;assert.deepEqual(after.assessment,before.assessment);assert.deepEqual(after.instructorReview,before.instructorReview);
});
test('The replacement total follows the saved native maxima when historical results contain additional score metadata',async t=>{
 const f=await fixture(t,async()=>result);
 await f.store.update(f.owner,f.id,state=>{state.assessment.items[f.q.id].result.scores.diagnosticOnly=7;return state;});
 const before=(await f.store.get(f.owner,f.id)).state;assert.equal(aggregate(f.paper,before).ready,true);
 const view=await f.api.inspect(f.owner,f.id),body={operation:'delivery:extra-score-metadata',questionIds:[f.q.id],evidenceHash:view.evidenceHash};
 await f.api.send(f.owner,f.id,body);await f.api.drain();const proposal=await f.api.inspect(f.owner,f.id);assert.equal(proposal.operations[body.operation].proposalReady,true);
 await f.api.publish(f.owner,f.id,{operation:body.operation,confirmPublish:true});const after=(await f.store.get(f.owner,f.id)).state;
 assert.equal(aggregate(f.paper,after).ready,true);assert.equal(after.assessment.items[f.q.id].result.scores.diagnosticOnly,7);
 assert.equal(after.assessment.items[f.q.id].result.total,after.assessment.items[f.q.id].result.scores.content+3+2);
});

async function publishInstructorExclusion(f,avoid=[]){
 const review=require('../mock-result-review'),{hash}=require('../scoring-jobs'),excluded=f.paper.questions.find(q=>q.question.type==='rs'&&!avoid.includes(q.id));
 await f.store.update(f.owner,f.id,state=>{
  const job=state.assessment.items[excluded.id],response=state.responses[f.paper.questions.indexOf(excluded)+1];job.status='failed';job.reason='content-unavailable';
  const plan=review.fullPlan(state,f.paper,Date.now());
  state.instructorReview={version:review.VERSION,status:'published',operation:'review:started',startedAt:1,inputsHash:plan.inputsHash,confirmed:review.confirmed(state,'full'),rounds:[]};
  state.assessment.exclusions={[excluded.id]:{reason:'instructor-review-unavailable',operation:'review:publication',at:2,note:'Unavailable assessment excluded by instructor.',inputHash:inputHash(response),snapshotHash:state.assessment.snapshotHash,previousJobHash:hash(job)}};
  state.instructorReview.publication={operation:'review:publication',at:2,questionIds:[excluded.id],exclusionsHash:hash(state.assessment.exclusions)};return state;
 });return excluded;
}
test('A delivery batch updates only the confirmed review hashes for selected questions and is idempotent across concurrent publications',async t=>{
 let calls=0;const f=await fixture(t,async()=>{calls++;return result;}),second=await secondRecording(f);await publishInstructorExclusion(f,[second.candidate.id]);
 const review=require('../mock-result-review'),before=(await f.store.get(f.owner,f.id)).state,view=await f.api.inspect(f.owner,f.id),body={operation:'delivery:instructor-two',questionIds:[f.q.id,second.candidate.id],evidenceHash:view.evidenceHash};
 await f.api.send(f.owner,f.id,body);await f.api.drain();const proposed=await f.api.inspect(f.owner,f.id);assert.equal(proposed.operations[body.operation].proposalReady,true);
 const store=require('../full-mock/store').createStore({directory:f.directory}),other=create({store,validate:assessment.createEngine({store}).validate,assess:async()=>{throw Error('No further provider request');}});
 await Promise.all([f.api.publish(f.owner,f.id,{operation:body.operation,confirmPublish:true}),other.publish(f.owner,f.id,{operation:body.operation,confirmPublish:true})]);
 const after=(await f.store.get(f.owner,f.id)).state;assert.equal(review.publicationValid(after,'full'),true);assert.equal(aggregate(f.paper,after).ready,true);assert.equal(calls,2);
 const beforeKeys=before.instructorReview.confirmed,afterKeys=after.instructorReview.confirmed;
 const changed=[...new Set([...Object.keys(beforeKeys),...Object.keys(afterKeys)])].filter(key=>beforeKeys[key]!==afterKeys[key]).sort();
 assert.deepEqual(changed,[f.q.id,f.q.id+':delivery',second.candidate.id,second.candidate.id+':delivery'].sort());
 assert.deepEqual(after.assessment.exclusions,before.assessment.exclusions);assert.deepEqual(after.instructorReview.publication,before.instructorReview.publication);
 assert.deepEqual(after.deliveryReassessments[body.operation].instructorReviewAmendment.beforeConfirmed,beforeKeys);assert.deepEqual(after.deliveryReassessments[body.operation].afterProfiles,proposed.operations[body.operation].proposedProfiles);
});
test('An earlier instructor exclusion is also preserved when a single-recording result is published',async t=>{
 const f=await fixture(t,async()=>result);await publishInstructorExclusion(f);const before=(await f.store.get(f.owner,f.id)).state,view=await f.api.inspect(f.owner,f.id),body={operation:'delivery:instructor-single',questionId:f.q.id,evidenceHash:view.evidenceHash};
 const proposal=await f.api.send(f.owner,f.id,body);assert.equal(proposal.operations[body.operation].proposalReady,true);
 await f.api.publish(f.owner,f.id,{operation:body.operation,confirmPublish:true});const after=(await f.store.get(f.owner,f.id)).state;
 assert.equal(require('../mock-result-review').publicationValid(after,'full'),true);assert.equal(aggregate(f.paper,after).ready,true);
 assert.deepEqual(after.assessment.exclusions,before.assessment.exclusions);assert.deepEqual(after.deliveryReassessments[body.operation].instructorReviewAmendment.beforeConfirmed,before.instructorReview.confirmed);
});
