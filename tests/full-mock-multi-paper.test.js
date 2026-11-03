'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto'),express=require('express');
const {loadPaper,registeredPapers,digest,validatePaper}=require('../full-mock/paper');
const {duplicates}=require('../full-mock/audit'),adapters=require('../full-mock/adapters'),assessment=require('../full-mock/assessment'),session=require('../full-mock/session');
const {createStore}=require('../full-mock/store'),{installFullMock}=require('../full-mock/api');
const active=registeredPapers({activeOnly:true});
test('Three independently frozen full papers have complete keys/media, clocks and unique stimuli',()=>{
 assert.deepEqual(active.map(p=>p.id),['full-mock-1','full-mock-2','full-mock-3']);
 assert.equal(digest(loadPaper('full-mock-1',1)),'f1dfe1045d4c657ed3a03c428ca3953f91dc706ff53281598b697a7ce84de173');
 assert.equal(digest(loadPaper()),'c76c0ea41112ed9d3b2ec12782fb05c6c26c0f9a4ed323ed26bde715cff0bbf2');
 const bank=require('../content/speaking-bank');
 for(const p of active.slice(1)){
  assert.deepEqual(validatePaper(p),[]);assert.deepEqual(duplicates(p.questions),[]);assert.deepEqual(p.clockPolicy,loadPaper().clockPolicy);
  assert.equal(p.questions.length,65);assert.equal(new Set(p.questions.map(c=>c.question.type)).size,22);
  assert(p.questions.every(c=>c.id.startsWith(p.id+'/fm'+p.id.slice(-1)+'-')));
  for(const c of p.questions){const q=c.question;
   if(c.image){const source=bank.questions.find(s=>s.id===q.sourceId);assert(source.predictionSource.suppliedFile);assert.equal(c.image.sha256,source.imageReference.source.sha256);assert.deepEqual(q.facts,source.facts);assert.deepEqual(q.sample,source.sample);}
   if(q.type==='sgd'){assert.equal(c.audio.entry.narrationIncluded,true);assert.equal(new Set(Object.values(c.audio.entry.speakerVoices)).size,3);assert.equal(new Set(c.audio.entry.voices).size,3);}
   if(['ra','rs'].includes(q.type))assert(q.contentOrigin.adaptation);
   if(['dropdown','mcma','reorder','wordbank','mcsa','lmcma','lfi','hcs','lmcsa','smw','hiw','wfd'].includes(q.type)){
    const answer=q.type==='wfd'?[q.text]:q.answers||[q.answer];const grade=adapters.objective(q,answer);assert.equal(grade.total,grade.maximum,c.id);
   }
  }
 }
 for(const [id,v]of [['full-mock-4',1],['full-mock-2',2],['../full-mock-1',2],['full-mock-2','1']])assert.throws(()=>loadPaper(id,v),/Unknown frozen/);
});
async function fixture(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'full-mock-registry-')),app=express();app.use(express.json());
 const service=installFullMock(app,{directory,now:()=>1000,verifyToken:s=>['alice','bob','student'].includes(s)?s:null,getAccount:async()=>({role:'user'}),canPreview:()=>true,assessment:{adapters:{assess:async q=>adapters.result(q,adapters.maxima(q))}}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await service.stop();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(directory,{recursive:true,force:true});});
 const request=async(route,body,user='alice')=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/full-mocks'+route,{method:body?'POST':'GET',headers:{'x-session-token':user,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json()};};
 const start=(paperId,user='alice')=>request('/attempts',{id:randomUUID(),paperId,checks:{microphone:true,playback:true}},user);
 return{service,request,start};
}
test('Catalogue/start/resume/history keep selected papers, native maxima, ownership and reports isolated',async t=>{
 const f=await fixture(t);assert.deepEqual((await f.request('/catalog')).body.papers.map(p=>p.id),active.map(p=>p.id));
 assert.equal((await f.start('full-mock-999')).status,400);
 const first=await f.start('full-mock-1');assert.equal(first.body.paperId,'full-mock-1');
 // The existing one-active-attempt rule resumes paper 1 instead of relabelling it.
 const resumed=await f.start('full-mock-2');assert.equal(resumed.body.id,first.body.id);assert.equal(resumed.body.paperId,'full-mock-1');
 await f.service.store.update('alice',first.body.id,s=>{session.end(s,loadPaper(),1000);return s;});
 for(const paper of active.slice(1)){
  const started=await f.start(paper.id);assert.equal(started.status,200);assert.equal(started.body.paperId,paper.id);assert.equal(started.body.paperHash,digest(paper));
  const stored=await f.service.store.get('alice',started.body.id);assert.deepEqual(stored.paper,paper);
  assert.equal(stored.state.assessment.snapshot.paperHash,digest(paper));assert.deepEqual(stored.state.assessment.snapshot.nativeMaxima,Object.fromEntries(paper.questions.map(c=>[c.id,adapters.maxima(c.question)])));
  assert.equal((await f.request('/attempts/'+started.body.id,undefined,'bob')).status,404);
  await f.service.store.update('alice',started.body.id,s=>{session.end(s,paper,1000);return s;});
  await f.service.assessor?.drain?.();
  const report=await f.request('/attempts/'+started.body.id+'/report');assert.equal(report.body.title,paper.title);
 }
 const rows=(await f.request('/attempts')).body;assert.equal(rows.length,3);assert.deepEqual(new Set(rows.map(r=>r.paperId)),new Set(active.map(p=>p.id)));
 const other=await f.start('full-mock-3','bob');assert.equal(other.body.paperId,'full-mock-3');assert.notEqual(other.body.id,first.body.id);
});
for(const paper of registeredPapers())test('Assessment/recovery trusts canonical '+paper.id+' v'+paper.version+' and retains confirmed marks',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'full-mock-version-')),store=createStore({directory}),id=randomUUID(),calls=new Map();
 let broken=true;
 const engine=assessment.createEngine({store,adapters:{assess:async q=>{calls.set(q.id,(calls.get(q.id)||0)+1);return broken&&q.id===paper.questions[0].question.id?{status:'failed',reason:'provider-unavailable'}:adapters.result(q,adapters.maxima(q));}}});
 t.after(async()=>{await engine.stop();await fs.rm(directory,{recursive:true,force:true});});
 const snapshot=structuredClone(engine.snapshotFor(paper));
 // Both old versions must finish from the immediately preceding production source snapshot.
 if(paper.id==='full-mock-1')snapshot.scoringSources=require('../content/full-mock/multi-paper-compatible-sources.json');
 await store.create('alice',id,paper,(key,at)=>session.create(key,paper,at,{preview:true,assessmentSnapshot:snapshot}),1000);
 await store.update('alice',id,s=>{session.end(s,paper,1000);return s;});
 await engine.request('alice',id);await engine.drain();assert.equal((await engine.results('alice',id)).assessedCount,64);
 const before=(await store.get('alice',id)).state.assessment.items;
 broken=false;await engine.request('alice',id,{retry:true});await engine.drain();assert.equal((await engine.results('alice',id)).ready,true);
 const after=(await store.get('alice',id)).state;
 assert.deepEqual(after.assessment.snapshot,snapshot);
 for(const c of paper.questions){assert.equal(calls.get(c.question.id),c===paper.questions[0]?2:1);if(c!==paper.questions[0])assert.deepEqual(after.assessment.items[c.id],before[c.id]);}
 await engine.recover();await engine.drain();assert.deepEqual((await store.get('alice',id)).state.assessment.items,after.assessment.items);
 // Caller-supplied maxima/config/source drift cannot become a trusted paper.
 const altered=structuredClone(snapshot);altered.nativeMaxima[paper.questions[0].id].content=999;
 const state=structuredClone(after);state.assessment=assessment.stateFor(altered);assert.throws(()=>engine.validate(state),/different assessment version/);
});
