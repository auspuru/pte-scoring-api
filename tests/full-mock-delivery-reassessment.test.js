'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {create}=require('../full-mock/delivery-reassessment'),{loadPaper}=require('../full-mock/paper'),session=require('../full-mock/session'),assessment=require('../full-mock/assessment'),adapters=require('../full-mock/adapters'),{inputHash,aggregate}=require('../full-mock/aggregation');
async function fixture(t,assess){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'delivery-review-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const store=require('../full-mock/store').createStore({directory}),paper=loadPaper(),id=randomUUID(),owner='synthetic-student',snap=assessment.snapshot(),bytes=Buffer.from('original synthetic recording'),segment=randomUUID();
 await store.create(owner,id,paper,(id,at)=>session.create(id,paper,at,{preview:true,assessmentSnapshot:snap}),1000);
 const q=paper.questions.find(c=>c.question.type==='di'),number=paper.questions.indexOf(q)+1;
 await store.putChunk(owner,id,segment,0,'audio/webm',bytes);
 await store.update(owner,id,s=>{session.end(s,paper,1000);s.assessment.status='complete';
  for(let i=0;i<paper.questions.length;i++){
   const item=paper.questions[i],r=s.responses[i+1];
   if(item.id===q.id)r.segments.push({id:segment,chunkCount:1,finished:true,cancelled:false,mime:'audio/webm',chunks:{0:{stored:true,bytes:bytes.length,sha256:require('../full-mock/store').hash(bytes)}}});
   s.assessment.items[item.id]={status:'assessed',inputHash:inputHash(r),snapshotHash:s.assessment.snapshotHash,result:adapters.result(item.question,adapters.maxima(item.question)),stages:{delivery:{status:'complete',traits:{pronunciation:{score:5},fluency:{score:5}}}}};
  }return s;});
 const engine=assessment.createEngine({store});const api=create({store,validate:engine.validate,assess});
 return {store,paper,id,owner,q,number,api,bytes,directory};
}
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
