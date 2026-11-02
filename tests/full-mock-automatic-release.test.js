'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {loadPaper,digest}=require('../full-mock/paper'),{createStore}=require('../full-mock/store'),assessment=require('../full-mock/assessment');
const {aggregate,inputHash}=require('../full-mock/aggregation'),{releaseExhausted,validExclusion,AUTOMATIC_VERSION}=require('../full-mock/exclusions');
const {make}=require('./helpers/full-mock-final-question'),paper=loadPaper(),owner='synthetic-final-release';
async function setup(t,options={}){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'final-release-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const store=createStore({directory}),f=make(paper,options);await store.create(owner,f.state.id,paper,()=>f.state,1000);return {...f,store,directory};}
test('Exhausted last-question recovery releases on restart exactly once without providers, preserving evidence and report/history/alert readiness',async t=>{
 const f=await setup(t,{historical:true}),before=structuredClone(f.state);let calls=0;
 const engines=[f.store,createStore({directory:f.directory})].map(store=>assessment.createEngine({store,paper,now:()=>3000,adapters:{assess:async()=>{calls++;throw Error('No paid calls');}}}));t.after(()=>Promise.all(engines.map(e=>e.stop())));
 await Promise.all(engines.map(e=>e.recover()));await Promise.all(engines.map(e=>e.drain()));
 const saved=(await f.store.get(owner,f.state.id)).state,result=aggregate(paper,saved);
 assert.equal(result.ready,true);assert.equal(result.assessedCount,64);assert.equal(result.excludedCount,1);assert.equal(calls,0);
 assert.deepEqual(saved.responses,before.responses);assert.deepEqual(saved.assessment.items,before.assessment.items);assert.deepEqual(saved.assessment.snapshot,before.assessment.snapshot);
 assert.equal(Object.keys(saved.assessment.exclusionOperations).length,1);assert.equal(saved.assessment.recovery.finalQuestionReview.status,'released');
 const row=result.items.find(row=>row.id===f.selected.id);assert.equal(row.total,undefined);assert.equal(row.exclusion.reason,'automatic-recovery-exhausted');
 const report=require('../full-mock/report').buildReport(paper,saved);assert.equal(report.ready,true);assert.equal(report.items[f.position-1].assessment.label,'Excluded · assessment unavailable');assert.match(report.items[f.position-1].feedback.overview,/excluded automatically/);
 assert.equal(require('../mock-test-alert-sources').snapshot('full',saved,{paper}).pending,0);
 assert.equal((await f.store.list(owner))[0].assessment.status,'complete');
 await engines[0].recover();await engines[0].request(owner,f.state.id,{retry:true});await engines[0].drain();assert.equal(calls,0);assert.deepEqual((await f.store.get(owner,f.state.id)).state.assessment.items,before.assessment.items);
 await f.store.update(owner,f.state.id,state=>{state.responses[f.position].segments[0].chunks[0].sha256='b'.repeat(64);return state;});assert.equal(aggregate(paper,(await f.store.get(owner,f.state.id)).state).ready,false);
});
for(const condition of ['uncertain','running','billing','auth','no-provenance','no-stage','null-stage','incomplete-audio','other-missing','bad-hash','wrong-snapshot','unsealed','not-exhausted','unverified-budget','lease','already-assessed','whole-task'])test('Automatic release holds '+condition+' and preserves every answer/job',()=>{
 const f=make(paper,{type:condition==='whole-task'?'essay':'rs'}),s=f.state,a=s.assessment,j=a.items[f.selected.id],stage=j.stages[condition==='whole-task'?'writing':'delivery'];
 if(condition==='uncertain')stage.uncertain=true;if(condition==='running')stage.status='running';if(condition==='billing')stage.failureCode='insufficient_quota';if(condition==='auth')stage.failureCode=401;if(condition==='no-provenance')delete stage.failureCode;if(condition==='no-stage')j.stages={};if(condition==='null-stage')j.stages.invalid=null;
 if(condition==='incomplete-audio'){s.responses[f.position].segments[0].chunks[0].stored=false;j.inputHash=inputHash(s.responses[f.position]);}
 if(condition==='other-missing')a.items[paper.questions[0].id].status='failed';if(condition==='bad-hash')j.inputHash='bad';if(condition==='wrong-snapshot')j.snapshotHash='bad';if(condition==='unsealed')s.responses[f.position].sealed=false;
 if(condition==='not-exhausted')a.recovery.status='held';if(condition==='unverified-budget')a.recovery.retries=7;if(condition==='lease')a.lease={id:'other',expiresAt:9000};
 if(condition==='already-assessed'){j.status='assessed';j.result=require('../full-mock/adapters').result(f.selected.question,require('../full-mock/adapters').maxima(f.selected.question));}
 const responses=digest(s.responses),jobs=digest(a.items);assert.equal(releaseExhausted(s,paper,3000),false);assert.equal(digest(s.responses),responses);assert.equal(digest(a.items),jobs);assert.equal(a.exclusions,undefined);
});
test('Held records are reviewed once, malformed automatic exclusions are rejected safely',async t=>{
 const f=await setup(t);await f.store.update(owner,f.state.id,s=>{s.assessment.items[f.selected.id].stages.delivery.uncertain=true;return s;});
 const engine=assessment.createEngine({store:f.store,paper,now:()=>3000,adapters:{assess:async()=>{throw Error('No provider work');}}});t.after(()=>engine.stop());assert.equal((await f.store.assessmentQueue(3000)).length,1);await engine.recover();assert.equal((await f.store.assessmentQueue(3000)).length,0);
 const s=(await f.store.get(owner,f.state.id)).state;assert.equal(s.assessment.recovery.finalQuestionReview.status,'held');
 s.assessment.exclusions={[f.selected.id]:{version:AUTOMATIC_VERSION,reason:'automatic-recovery-exhausted',retries:8}};assert.equal(validExclusion(s,f.selected,undefined,undefined),false);
});
test('Final worker exhausts all persisted backoffs and releases only after eighth automatic retry',async t=>{
 const f=await setup(t),before=structuredClone(f.state);let at=3000,calls=0;
 await f.store.update(owner,f.state.id,s=>{s.assessment.recovery={version:1,status:'scheduled',retries:0,nextAt:at};return s;});
 const engine=assessment.createEngine({store:f.store,paper,now:()=>at,assemble:async()=>({status:'ready',recording:{}}),adapters:{assess:async(q,response,{previous})=>{calls++;return {status:'failed',reason:'delivery-unavailable',stages:previous};}}});t.after(()=>engine.stop());
 for(let n=1;n<=8;n++){await engine.recover();await engine.drain();const saved=(await f.store.get(owner,f.state.id)).state;assert.equal(saved.assessment.recovery.retries,n);assert.equal(aggregate(paper,saved).ready,n===8);if(n<8)at=saved.assessment.recovery.nextAt;}
 const saved=(await f.store.get(owner,f.state.id)).state;assert.equal(calls,8);assert.deepEqual(saved.responses,before.responses);assert.deepEqual(saved.assessment.items[f.selected.id].stages,before.assessment.items[f.selected.id].stages);
});
test('A confirmed zero is assessed, while changed native source pins never receive compatibility',async t=>{
 const f=await setup(t,{historical:true}),engine=assessment.createEngine({store:f.store,paper,adapters:{assess:async()=>{throw Error('No provider');}}});t.after(()=>engine.stop());
 engine.validate(f.state);const changed=structuredClone(f.state);changed.assessment.snapshot.scoringSources.files['full-mock/adapters.js'].sha256='f'.repeat(64);changed.assessment.snapshotHash=digest(changed.assessment.snapshot);assert.throws(()=>engine.validate(changed),{status:409});
 const j=f.state.assessment.items[f.selected.id],a=require('../full-mock/adapters');j.status='assessed';j.result=a.result(f.selected.question,Object.fromEntries(Object.keys(a.maxima(f.selected.question)).map(k=>[k,0])));
 assert.equal(aggregate(paper,f.state).assessedCount,65);assert.equal(releaseExhausted(f.state,paper,3000),false);assert.equal(j.result.total,0);assert.equal(f.state.assessment.exclusions,undefined);
});
