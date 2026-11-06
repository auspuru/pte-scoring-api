'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/delivery-reassessment-fixture');
const assessment=require('../full-mock/assessment'),exclusions=require('../full-mock/exclusions');
const adapters=require('../full-mock/adapters');
const {aggregate,inputHash,COMPLETION_POLICY}=require('../full-mock/aggregation');
const {digest}=require('../full-mock/paper');

test('A published provider-429 exclusion recovers from saved input once, retaining other marks and frozen source',async t=>{
  const f=await fixture(t,async()=>{}),baseline=require('../content/full-mock/credit-recovery-compatible-sources.json');
  await f.store.update(f.owner,f.id,state=>{
    state.assessment.run=1;
    state.assessment.snapshot.scoringSources=structuredClone(baseline);
    state.assessment.snapshotHash=digest(state.assessment.snapshot);
    state.assessment.completionPolicy={version:COMPLETION_POLICY,snapshotHash:state.assessment.snapshotHash};
    for(const job of Object.values(state.assessment.items))job.snapshotHash=state.assessment.snapshotHash;
    const job=state.assessment.items[f.q.id];job.status='failed';job.result={status:'failed',reason:'transcription-unavailable'};
    job.stages={transcription:{status:'failed',failureCode:429,uncertain:false,recoveryBlocked:false,attemptedRun:1}};
    assert(exclusions.releaseAvailable(state,f.paper,1234));return state;
  });
  let calls=0;
  const engine=assessment.createEngine({store:f.store,paper:f.paper,
    assemble:async()=>({status:'ready',recording:{mime:'audio/wav',data:'synthetic'}}),
    adapters:adapters.createAdapters({transcribe:async()=>{calls++;return 'The chart changes over time.';},
      gradeSpeaking:async q=>({total:4,maximum:adapters.maxima(q).content,version:'synthetic',scoringMode:'ai',contentStatus:'assessed'}),
      assessDelivery:async()=>({deliveryVersion:'synthetic',deliveryProvider:'azure',pronunciation:{score:3},fluency:{score:2}})})});
  const support=exclusions.createSupport({store:f.store,validate:engine.validate});
  const before=await support.inspect(f.owner,f.id),saved=(await f.store.get(f.owner,f.id)).state;
  assert.equal(before.assessedCount,64);assert.equal(before.excludedCount,1);
  assert.equal(before.questions.find(q=>q.id===f.q.id).retryableUnavailable,true);
  const body={operation:'staff:credit-retry-1',evidenceHash:before.evidenceHash,questionIds:[f.q.id],confirmRetry:true};
  await Promise.all([engine.retryUnavailable(f.owner,f.id,body),engine.retryUnavailable(f.owner,f.id,body)]);
  await engine.drain();
  const after=(await f.store.get(f.owner,f.id)).state,result=aggregate(f.paper,after);
  assert.equal(calls,1);assert.equal(result.assessedCount,65);assert.equal(result.excludedCount,0);
  assert.equal(result.ready,true);assert.deepEqual(after.responses,saved.responses);
  assert.equal(after.assessment.snapshotHash,saved.assessment.snapshotHash);
  for(const [id,job] of Object.entries(saved.assessment.items))if(id!==f.q.id)assert.deepEqual(after.assessment.items[id],job);
  assert.deepEqual(after.assessment.retryUnavailableOperations[body.operation].priorExclusions[f.q.id],saved.assessment.exclusions[f.q.id]);
  await engine.retryUnavailable(f.owner,f.id,body);await engine.drain();assert.equal(calls,1);
  await assert.rejects(engine.retryUnavailable(f.owner,f.id,{...body,questionIds:['changed']}),/different retry/);
  assert.equal(inputHash(after.responses[f.number]),saved.assessment.items[f.q.id].inputHash);
});

test('Retry refuses uncertain, blocked, unrecorded and stale selections',async t=>{
  const f=await fixture(t,async()=>{});
  await f.store.update(f.owner,f.id,state=>{
    state.assessment.run=1;
    state.assessment.completionPolicy={version:COMPLETION_POLICY,snapshotHash:state.assessment.snapshotHash};
    const job=state.assessment.items[f.q.id];job.status='failed';job.result={status:'failed',reason:'transcription-unavailable'};
    job.stages={transcription:{status:'failed',failureCode:429,uncertain:true},malformed:null};
    assert(exclusions.releaseAvailable(state,f.paper,1234));return state;
  });
  const engine=assessment.createEngine({store:f.store,paper:f.paper,adapters:{assess:async()=>{throw Error('No provider call allowed');}}});
  const support=exclusions.createSupport({store:f.store,validate:engine.validate}),view=await support.inspect(f.owner,f.id);
  assert.equal(view.questions.find(q=>q.id===f.q.id).retryableUnavailable,false);
  const body={operation:'staff:credit-retry-2',evidenceHash:view.evidenceHash,questionIds:[f.q.id],confirmRetry:true};
  await assert.rejects(engine.retryUnavailable(f.owner,f.id,body),/Only saved, certain provider failures/);
  await f.store.update(f.owner,f.id,state=>{state.assessment.exclusions[f.q.id].note+=' Review updated.';return state;});
  await assert.rejects(engine.retryUnavailable(f.owner,f.id,body),/Saved evidence changed/);
});

test('A provider-429 writing failure is eligible without changing a saved essay',async t=>{
  const f=await fixture(t,async()=>{}),candidate=f.paper.questions.find(q=>q.question.type==='essay'),number=f.paper.questions.indexOf(candidate)+1;
  const original=(await f.store.get(f.owner,f.id)).state.assessment.items[candidate.id].result;
  await f.store.update(f.owner,f.id,state=>{
    state.assessment.run=1;state.assessment.completionPolicy={version:COMPLETION_POLICY,snapshotHash:state.assessment.snapshotHash};
    const response=state.responses[number],job=state.assessment.items[candidate.id];
    response.answer=['The saved essay response is retained for assessment. '.repeat(40)];
    job.inputHash=inputHash(response);job.status='failed';job.result={status:'failed',reason:'writing-unavailable'};
    job.stages={writing:{status:'failed',failureCode:429,uncertain:false,attemptedRun:1}};
    assert(exclusions.releaseAvailable(state,f.paper,1234));return state;
  });
  let calls=0;const engine=assessment.createEngine({store:f.store,paper:f.paper,adapters:{assess:async()=>{calls++;return {...structuredClone(original),stages:{writing:{status:'complete',value:original}}};}}});
  const view=await exclusions.createSupport({store:f.store,validate:engine.validate}).inspect(f.owner,f.id);
  assert.equal(view.questions.find(row=>row.id===candidate.id).retryableUnavailable,true);
  const saved=(await f.store.get(f.owner,f.id)).state.responses[number].answer;
  await engine.retryUnavailable(f.owner,f.id,{operation:'staff:writing-retry',evidenceHash:view.evidenceHash,questionIds:[candidate.id],confirmRetry:true});
  await engine.drain();const state=(await f.store.get(f.owner,f.id)).state;
  assert.equal(calls,1);assert.deepEqual(state.responses[number].answer,saved);
  assert.equal(aggregate(f.paper,state).assessedCount,65);
});

test('Only the protected administrator route can start an unavailable-score retry',async t=>{
  const f=await fixture(t,async()=>{});
  await f.store.update(f.owner,f.id,state=>{
    state.assessment.run=1;
    state.assessment.completionPolicy={version:COMPLETION_POLICY,snapshotHash:state.assessment.snapshotHash};
    const job=state.assessment.items[f.q.id];job.status='failed';job.result={status:'failed',reason:'transcription-unavailable'};
    job.stages={transcription:{status:'failed',failureCode:429,uncertain:false,attemptedRun:1}};
    assert(exclusions.releaseAvailable(state,f.paper,1234));return state;
  });
  const express=require('express'),app=express();app.use(express.json());
  const service=require('../full-mock/api').installFullMock(app,{directory:f.directory,paper:f.paper,papers:[f.paper],
    verifyToken:()=>null,getAccount:async()=>({role:'admin'}),requireAdmin:(req,res,next)=>req.get('x-admin')==='yes'?next():res.sendStatus(403),
    assessment:{adapters:{assess:async()=>{throw Error('No provider call during auth test');}}}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await service.stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const url='http://127.0.0.1:'+server.address().port+'/api/admin/full-mocks/'+f.owner+'/'+f.id+'/scoring';
  assert.equal((await fetch(url)).status,403);
  const view=await (await fetch(url,{headers:{'x-admin':'yes'}})).json();
  assert.equal(view.questions.find(q=>q.id===f.q.id).retryableUnavailable,true);
  const body={operation:'staff:route-locked',evidenceHash:view.evidenceHash,questionIds:[f.q.id],confirmRetry:true};
  assert.equal((await fetch(url+'/retry-unavailable',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).status,403);
  assert.equal((await fetch(url+'/retry-unavailable',{method:'POST',headers:{'content-type':'application/json','x-admin':'yes'},body:JSON.stringify({...body,confirmRetry:false})})).status,400);
  assert.equal((await fetch(url+'/retry-unavailable',{method:'POST',headers:{'content-type':'application/json','x-admin':'yes'},body:JSON.stringify(body)})).status,200);
  await service.assessor.drain();
  assert((await f.store.get(f.owner,f.id)).state.assessment.retryUnavailableOperations[body.operation]);
});
