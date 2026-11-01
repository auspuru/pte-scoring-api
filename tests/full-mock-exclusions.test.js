'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {loadPaper,digest}=require('../full-mock/paper'),session=require('../full-mock/session'),assessment=require('../full-mock/assessment');
const adapters=require('../full-mock/adapters'),{aggregate,inputHash}=require('../full-mock/aggregation');
const {createSupport,evidenceHash}=require('../full-mock/exclusions'),{createStore}=require('../full-mock/store');
const paper=loadPaper(),owner='synthetic-audio-review';
async function fixture(t,{historical=false,returnFull=false}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'full-audio-review-')),store=createStore({directory}),id=randomUUID();
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const state=session.create(id,paper,1000,{preview:true});session.end(state,paper,2000);
  const snapshot=structuredClone(assessment.snapshot());
  if(historical)snapshot.scoringSources=require('../content/full-mock/audio-exclusion-compatible-sources.json');
  state.assessment=assessment.stateFor(snapshot);state.assessment.status='needs-attention';
  state.assessment.recovery={status:'scheduled',retries:3,nextAt:9999999};
  const selected=paper.questions.filter(candidate=>candidate.question.type==='asq').slice(0,3);
  for(const [index,candidate] of paper.questions.entries()){
    const response=state.responses[index+1];
    if(selected.includes(candidate))response.segments=[{id:randomUUID(),mime:'audio/webm',finished:true,chunkCount:1,chunks:{0:{sha256:'a'.repeat(64),stored:true,bytes:123}}}];
    state.assessment.items[candidate.id]={status:selected.includes(candidate)?'failed':'assessed',inputHash:inputHash(response),snapshotHash:state.assessment.snapshotHash,
      ...(selected.includes(candidate)?{result:{status:'failed',reason:'transcription-unavailable'},stages:{transcription:{status:'failed',attemptedRun:4,uncertain:false,failureCode:'provider'}}}
        :{result:adapters.result(candidate.question,adapters.maxima(candidate.question)),stages:{content:{status:'complete',value:{total:1}}}})};
  }
  await store.create(owner,id,paper,()=>state,1000);
  let calls=0;
  const engine=assessment.createEngine({store,paper,now:()=>3000,adapters:{assess:async q=>{calls++;if(returnFull)return adapters.result(q,adapters.maxima(q));throw Error('No provider calls allowed.');}}});
  t.after(()=>engine.stop());
  const support=createSupport({store,validate:engine.validate,now:()=>3000});
  const body=()=>({operation:'staff:one-review',questionIds:selected.map(candidate=>candidate.id),evidenceHash:evidenceHash(state),note:'Audio too quiet to assess; excluded at instructor request.',confirmUnusableAudio:true});
  return {store,id,state,selected,engine,support,body,calls:()=>calls};
}
test('Explicit silent ASQ review publishes 62 assessed + 3 exclusions, preserves every response, job and snapshot, and replays without provider work',async t=>{
  const f=await fixture(t,{historical:true}),before=await f.support.inspect(owner,f.id);
  assert.equal(before.assessedCount,62);assert.equal(before.questions.filter(row=>row.eligible).length,3);
  const done=await f.support.exclude(owner,f.id,f.body());assert.equal(done.ready,true);assert.equal(done.accountedFor,65);assert.equal(done.excludedCount,3);
  assert.equal(done.responsesHash,before.responsesHash);assert.equal(done.confirmedHash,before.confirmedHash);
  const saved=(await f.store.get(owner,f.id)).state;
  assert.deepEqual(saved.responses,f.state.responses);assert.deepEqual(saved.assessment.items,f.state.assessment.items);assert.deepEqual(saved.assessment.snapshot,f.state.assessment.snapshot);
  assert.equal(saved.assessment.recovery.status,'complete');assert.equal(saved.assessment.recovery.nextAt,undefined);
  const result=aggregate(paper,saved);assert.equal(result.groups.asq.possible,2);assert.equal(result.groups.asq.earned,2);
  assert(result.items.filter(row=>row.status==='excluded').every(row=>row.scores===undefined&&row.total===undefined));
  const report=require('../full-mock/report').buildReport(paper,saved);
  const alert=require('../mock-test-alert-sources').snapshot('full',saved,{paper});assert.equal(alert.ready,true);assert.equal(alert.pending,0);
  const renderer=require('../public/full-mock-report');
  assert.match(renderer.overview(report),/62 assessed · 3 excluded/);assert.match(renderer.review(report.items[23]),/Excluded from scoring/);
  assert.match(report.items[23].feedback.overview,/Audio too quiet/);assert.doesNotMatch(renderer.review(report.items[23]),/Assessment pending/);
  const again=await f.support.exclude(owner,f.id,f.body());assert.equal(again.ready,true);
  assert.deepEqual((await f.store.get(owner,f.id)).state,saved);
  await f.engine.request(owner,f.id,{retry:true});await f.engine.drain();assert.equal(f.calls(),0);
  await assert.rejects(f.support.exclude(owner,f.id,{...f.body(),note:'A different explanation is not the same operation.'}),{status:409});
});
test('Review rejects wrong ownership, stale evidence, active work, completed marks and unconfirmed exclusions',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.support.inspect('another-student',f.id),{status:404});
  await assert.rejects(f.support.exclude(owner,f.id,{...f.body(),confirmUnusableAudio:false}),{status:400});
  await assert.rejects(f.support.exclude(owner,f.id,{...f.body(),evidenceHash:'b'.repeat(64)}),{status:409});
  await assert.rejects(f.support.exclude(owner,f.id,{...f.body(),questionIds:[paper.questions[0].id]}),{status:409});
  await f.store.update(owner,f.id,state=>{state.assessment.status='processing';return state;});
  await assert.rejects(f.support.exclude(owner,f.id,f.body()),{status:409});
  assert.deepEqual((await f.store.get(owner,f.id)).state.responses,f.state.responses);
});
test('A later missing-stage worker skips excluded audio and finishes only the other missing assessment',async t=>{
  const f=await fixture(t,{returnFull:true}),first=paper.questions[0];
  await f.store.update(owner,f.id,state=>{state.assessment.items[first.id]={...state.assessment.items[first.id],status:'failed',result:{status:'failed',reason:'content-unavailable'},stages:{}};return state;});
  const before=await f.support.inspect(owner,f.id);
  const partial=await f.support.exclude(owner,f.id,{...f.body(),evidenceHash:before.evidenceHash});assert.equal(partial.ready,false);
  const excluded=(await f.store.get(owner,f.id)).state.assessment.exclusions;
  await f.engine.request(owner,f.id,{retry:true});await f.engine.drain();
  assert.equal(f.calls(),1);const saved=(await f.store.get(owner,f.id)).state;
  assert.equal(aggregate(paper,saved).ready,true);assert.deepEqual(saved.assessment.exclusions,excluded);
  for(const candidate of f.selected)assert.deepEqual(saved.assessment.items[candidate.id],f.state.assessment.items[candidate.id]);
});
test('Uncertain requests, missing uploads and changed evidence never become an exclusion',async t=>{
  const f=await fixture(t),candidate=f.selected[0];
  await f.store.update(owner,f.id,state=>{state.assessment.items[candidate.id].stages.transcription.uncertain=true;return state;});
  let diagnostic=await f.support.inspect(owner,f.id);assert.equal(diagnostic.questions.find(row=>row.id===candidate.id).eligible,false);
  await assert.rejects(f.support.exclude(owner,f.id,{...f.body(),evidenceHash:diagnostic.evidenceHash}),{status:409});
  await f.store.update(owner,f.id,state=>{state.assessment.items[candidate.id].stages.transcription.uncertain=false;state.responses[24].segments[0].chunks[0].stored=false;return state;});
  diagnostic=await f.support.inspect(owner,f.id);assert.equal(diagnostic.questions.find(row=>row.id===candidate.id).eligible,false);
  const complete=await fixture(t);await complete.support.exclude(owner,complete.id,complete.body());
  await complete.store.update(owner,complete.id,state=>{state.responses[24].segments[0].chunks[0].sha256='c'.repeat(64);return state;});
  const altered=aggregate(paper,(await complete.store.get(owner,complete.id)).state);assert.equal(altered.ready,false);assert.equal(altered.items[23].status,'failed');
});
test('Full Mock review endpoints require admin authentication and preserve owner binding',async t=>{
  const f=await fixture(t),express=require('express'),app=express();app.use(express.json());
  // Use the same durable directory through a separate authenticated API instance.
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'full-audio-api-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const service=require('../full-mock/api').installFullMock(app,{directory,paper,assessment:{adapters:{assess:async()=>{throw Error('No provider work');}}},
    verifyToken:()=>null,getAccount:async()=>null,requireAdmin:(req,res,next)=>req.headers['x-admin-key']==='test-only-admin'?next():res.status(403).json({error:'Forbidden'})});
  await service.store.create(owner,f.id,paper,()=>f.state,1000);t.after(()=>service.stop());
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base='http://127.0.0.1:'+server.address().port+'/api/admin/full-mocks/';
  assert.equal((await fetch(base+owner+'/'+f.id+'/scoring')).status,403);
  const headers={'x-admin-key':'test-only-admin','Content-Type':'application/json'};
  assert.equal((await fetch(base+'wrong/'+f.id+'/scoring',{headers})).status,404);
  const response=await fetch(base+owner+'/'+f.id+'/scoring',{headers});assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
  const diagnostic=await response.json();assert.equal(diagnostic.owner,owner);
  const done=await fetch(base+owner+'/'+f.id+'/scoring/exclude-audio',{method:'POST',headers,body:JSON.stringify({...f.body(),evidenceHash:diagnostic.evidenceHash})});
  assert.equal(done.status,200);assert.equal((await done.json()).ready,true);
});
