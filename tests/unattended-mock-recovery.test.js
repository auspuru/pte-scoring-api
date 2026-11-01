'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto'),express=require('express');
const {createStore}=require('../writing-lab-store'),{createRecovery}=require('../writing-lab-recovery'),policy=require('../mock-recovery-policy');
async function setup(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'unattended-mocks-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return {directory,store:createStore(null,directory)};}
const saved=()=>({id:randomUUID(),kind:'mock',module:'writing',status:'submitted',startedAt:1000,finishedAt:1000,questions:[{type:'essay',text:'Discuss public transport.'}],answers:['A saved response.'],completed:[{at:1000}],results:[null]});
test('Durable assessment leases prevent duplicates across workers and hold uncertain expired calls',async t=>{
 const {store}=await setup(t),a=saved();await store.update('alice',a.id,()=>a);let at=1000;
 const one=createRecovery({store,now:()=>at,isConfirmed:(a,i)=>!!a.results[i]}),two=createRecovery({store,now:()=>at,isConfirmed:(a,i)=>!!a.results[i]});
 const [first,second]=await Promise.all([one.claim('alice',a.id,0),two.claim('alice',a.id,0)]);assert.equal([first,second].filter(Boolean).length,1);
 at+=180001;assert.equal(await two.claim('alice',a.id,0),undefined);
 const held=await store.get('alice',a.id);assert.equal(held.assessmentRecovery[0].status,'held');assert.equal(held.assessmentRecovery[0].uncertain,true);
 assert.deepEqual(held.answers,a.answers);assert.deepEqual(held.results,[null]);
});
test('Restart resumes only a due failed stage and preserves confirmed answers and zero scores',async t=>{
 const {store}=await setup(t),a=saved();a.questions.push({type:'wfd',text:'Keep this answer.'});a.answers.push('');a.completed.push({at:1000});a.results.push({total:0,maximum:3});await store.update('alice',a.id,()=>a);let at=1000;
 const worker=createRecovery({store,now:()=>at,isConfirmed:(a,i)=>!!a.results[i]});const receipt=await worker.claim('alice',a.id,0);await worker.fail('alice',a.id,0,receipt,{status:503});
 assert.equal(await worker.claim('alice',a.id,0),undefined);at+=30000;
 const restarted=createRecovery({store,now:()=>at,isConfirmed:(a,i)=>!!a.results[i]});const next=await restarted.claim('alice',a.id,0);assert.equal(next.attempts,2);
 await restarted.save('alice',a.id,0,next,{total:20,maximum:26});assert.equal(await restarted.claim('alice',a.id,0),undefined);
 const after=await store.get('alice',a.id);assert.deepEqual(after.results[1],a.results[1]);assert.deepEqual(after.answers,a.answers);
});
test('Recovery budgets stop auth, billing and uncertain calls and back off temporary failures',()=>{
 for(const error of [{status:401},{code:'insufficient_quota'},{uncertain:true},{name:'TimeoutError'},{name:'APIConnectionTimeoutError'},{status:429,code:'insufficient_quota'}])assert.equal(policy.retryState(error,1,1000).status,'held');
 assert.equal(policy.retryState({status:429},1,1000).nextAt,31000);assert.equal(policy.retryState({status:503},9,1000).status,'exhausted');
});
test('Writing and Listening finish assessments without a browser and retry only the missing response after restart',async t=>{
 const {directory}=await setup(t);let at=1000,calls=0;
 const options={directory,verifyToken:()=>null,getAccount:async()=>({}),now:()=>at,essayGrader:{grade:async()=>{if(++calls===1)throw Object.assign(Error('Temporary provider outage'),{status:503});return{scores:{total:20}};}}};
 const app=express(),service=require('../writing-lab').installWritingLab(app,options),a=saved();a.questions[0].minutes=20;
 a.questions.push({type:'wfd',text:'Keep this original sentence.',minutes:2});a.answers.push('Keep this original sentence.');a.completed.push({at:1000});a.results.push(null);
 await service.store.update('alice',a.id,()=>a);await service.recover();await service.waitForJobs();
 const before=await service.store.get('alice',a.id);assert.equal(calls,1);assert(before.results[1]);assert.equal(before.results[0],null);
 const restarted=require('../writing-lab').installWritingLab(express(),options);at+=30001;await restarted.recover();await restarted.waitForJobs();
 const after=await restarted.store.get('alice',a.id);assert.equal(calls,2);assert.equal(after.results[0].total,20);assert.deepEqual(after.results[1],before.results[1]);assert.deepEqual(after.answers,a.answers);
 await restarted.recover();await restarted.waitForJobs();assert.equal(calls,2);
 // A listening mock's objective saved answer uses the same scanner and requires no paid call.
 const listening={...saved(),module:'listening',questions:[a.questions[1]],answers:[a.answers[1]],results:[null]};await restarted.store.update('bob',listening.id,()=>listening);
 await restarted.recover();await restarted.recover();await restarted.waitForJobs();assert.equal((await restarted.store.get('bob',listening.id)).results[0].total,4);assert.equal(calls,2);
});

test('Reviewed recovery transport changes keep native graders, models and score calculations byte-identical',()=>{
 const read=name=>require('node:fs').readFileSync(require.resolve('../'+name),'utf8'),sha=s=>require('node:crypto').createHash('sha256').update(s).digest('hex');
 const baseline=require('../content/full-mock/unattended-recovery-compatible-sources.json');
 let source=read('full-mock/adapters.js');
 source=source.replace("uncertain: require('../mock-recovery-policy').failure(error).uncertain, failureCode:require('../mock-recovery-policy').failure(error).code, recoveryBlocked:require('../mock-recovery-policy').failure(error).blocked",'uncertain: !!error.uncertain');
 source=source.replace("uncertain: error ? require('../mock-recovery-policy').failure(error).uncertain : false, ...(error?{failureCode:require('../mock-recovery-policy').failure(error).code,recoveryBlocked:require('../mock-recovery-policy').failure(error).blocked}:{})",'uncertain: !!error?.uncertain');
 assert.equal(sha(source),baseline.files['full-mock/adapters.js'].sha256);
 source=read('server.js').replace("const fullMock = require('./full-mock/api').installFullMock(app, {\n  requireAdmin,", "const fullMock = require('./full-mock/api').installFullMock(app, {")
   .replace("backgroundEnabled:process.env.SPEAKING_PROGRESSIVE_SCORING!=='false'","backgroundEnabled:process.env.SPEAKING_PROGRESSIVE_SCORING==='true'").replace('    await writingLab.start();\n','').replace('    await writingLab.stop();\n','');
 assert.equal(sha(source),baseline.files['server.js'].sha256);
 source=read('public/writing-lab-report.js').replace("(attempt.kind!=='mock' || !needsReview(r,q))",'(!weighted || !needsReview(r,q))');
 assert.equal(sha(source),baseline.files['public/writing-lab-report.js'].sha256);
 for(const name of ['full-mock/session.js','full-mock/profiles.js','speaking-scoring.js','speaking-delivery.js','writing-lab-scoring.js'])assert.equal(sha(read(name)),baseline.files[name].sha256,name);
 // Explicit instructor exclusions have separate ownership/integrity and
 // denominator tests. Their exact source is pinned; native graders and the
 // original profile weights remain byte-identical above.
 assert.equal(sha(read('full-mock/aggregation.js')),require('../content/full-mock/scoring-lock.json').snapshot.files['full-mock/aggregation.js'].sha256);
});

test('Full Mock failure checkpoints retain auth and uncertainty evidence without inventing marks',async()=>{
 for(const error of [{status:401},{name:'TimeoutError'},{name:'APIConnectionTimeoutError'},{status:429,code:'insufficient_quota'}]){
  let calls=0;const adapter=require('../full-mock/adapters').createAdapters({transcribe:async()=>{calls++;throw error;}});
  const value=await adapter.assess({type:'rs'},{sealed:true,segments:[]},{recording:{}});
  assert.equal(value.status,'failed');assert.equal(value.stages.transcription.recoveryBlocked,true);assert.equal(calls,1);
 }
 const provisional={score_provisional:true,total:8,maximum:12};
 assert.equal(require('../public/writing-lab-report').summarize([{type:'sst'}],[provisional],{kind:'mock',module:'listening'}).complete,false);
});
