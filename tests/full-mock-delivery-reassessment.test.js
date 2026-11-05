'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {create}=require('../full-mock/delivery-reassessment'),{loadPaper}=require('../full-mock/paper'),session=require('../full-mock/session'),assessment=require('../full-mock/assessment'),adapters=require('../full-mock/adapters'),{inputHash,aggregate}=require('../full-mock/aggregation');
const {fixture,secondRecording}=require('./helpers/delivery-reassessment-fixture');
const result={version:'synthetic-continuous',pronunciation:{score:3,raw:60},fluency:{score:2,raw:40}};
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
