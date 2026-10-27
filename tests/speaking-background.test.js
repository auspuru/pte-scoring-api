'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),express=require('express');
const bank=require('../content/speaking-mocks'),report=require('../speaking-mock-report'),{installSpeakingMock,present}=require('../speaking-mock'),{createMockJobs}=require('../speaking-mock-jobs'),{createStore}=require('../writing-lab-store');
const delivery=()=>({status:'assessed',pronunciation:{status:'scored',score:5,maximum:5},fluency:{status:'scored',score:4,maximum:5}});
function fixture(){const questions=structuredClone(bank.papers[0].questions);return{id:crypto.randomUUID(),title:'Speaking mock',paperId:bank.papers[0].id,status:'submitted',startedAt:1,deadline:999999,index:questions.length,questionCount:27,questions,responses:questions.map(()=>({skipped:true})),assessmentProfile:{mode:'progressive-v1',owner:'student',diBackend:'academy'},integrity:{events:[]},grading:{status:'pending'}};}
const recording=()=>({hash:crypto.randomBytes(32).toString('hex'),data:Buffer.alloc(200,7).toString('base64'),mime:'audio/webm'});
test('an answer starts scoring at upload; no report or reference leaks before both reports are ready',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-bg-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  let release,started;const scoringStarted=new Promise(r=>started=r),gate=new Promise(r=>release=r),app=express();app.use(express.json());let calls=0;
  const service=installSpeakingMock(app,{directory,backgroundEnabled:true,verifyToken:token=>token==='test'?'student':null,getAccount:async()=>({}),now:()=>100000,
    gradeResponse:async(q)=>{calls++;started();await gate;return{content:{total:6,maximum:6,scoringMode:'ai'},transcript:'PRIVATE_TRANSCRIPT',gpt:delivery(),azure:delivery()};}});
  const a=fixture();a.status='active';a.index=a.questions.length-1;a.questionStartedAt=1;a.deadline=999999;delete a.responses[a.index];await service.store.update('student',a.id,()=>a);
  const server=app.listen(0);t.after(()=>new Promise(resolve=>server.close(resolve)));t.after(()=>service.stop());const base='http://127.0.0.1:'+server.address().port+'/api/speaking-mocks';
  const upload=()=>fetch(base+'/attempts/'+a.id+'/recordings/'+a.index,{method:'POST',headers:{'x-session-token':'test','Content-Type':'audio/webm'},body:Buffer.alloc(200,7)});
  assert.equal((await upload()).status,200);await scoringStarted;assert.equal((await upload()).status,200);assert.equal(calls,1);
  let response=await fetch(base+'/attempts/'+a.id+'/next',{method:'POST',headers:{'x-session-token':'test','Content-Type':'application/json'},body:JSON.stringify({index:a.index})}),value=await response.json();
  assert.equal(value.status,'submitted');assert.equal(value.resultsReady,false);assert.equal(value.responses,undefined);assert.equal(value.question,undefined);assert.equal(value.speakingReport,null);
  const headers={'x-session-token':'test'};value=await(await fetch(base+'/attempts',{headers})).json();assert.equal(value[0].speakingReport,null);
  assert.equal((await fetch(base+'/attempts/'+a.id+'/recordings/'+a.index,{headers})).status,409);
  release();await service.waitForJobs();value=await(await fetch(base+'/attempts/'+a.id,{headers})).json();
  assert.equal(value.resultsReady,true);assert.equal(value.speakingReport.openai.assessedCount,27);assert.equal(value.speakingReport.azure.assessedCount,27);assert.equal(value.responses[a.index].transcript,'PRIVATE_TRANSCRIPT');assert.equal(calls,1);
  assert.equal((await fetch(base+'/attempts/'+a.id+'/status',{headers:{'x-session-token':'other'}})).status,401);
});
test('known transient failure retries only the missing provider and publishes automatically, retaining saved stages',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-retry-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const store=createStore(null,directory,{table:'speaking_mock_attempts'}),a=fixture(),i=a.questions.findIndex(q=>q.type==='rs');let time=1000,gptCalls=0,azureCalls=0;
  a.responses[i]={recording:recording(),transcript:'A saved transcript.',content:{total:3,maximum:3,scoringMode:'ai'}};await store.update('student',a.id,()=>a);
  const jobs=createMockJobs({directory,store,now:()=>time,transcribe:()=>{throw Error('must reuse transcript');},assessGpt:async(_,options)=>{assert.equal(options.contentIndependent,true);gptCalls++;return delivery();},assessAzure:async(_,options)=>{assert.equal(options.contentIndependent,true);if(++azureCalls===1)throw Object.assign(Error('busy'),{providerStatus:429});return delivery();}});t.after(()=>jobs.stop());
  await jobs.ensure('student',a);await jobs.wait();let saved=await store.get('student',a.id);assert.notEqual(saved.grading.status,'complete');assert.equal(gptCalls,1);assert.equal(azureCalls,1);
  time+=16000;await jobs.wait();saved=await store.get('student',a.id);assert.equal(saved.grading.status,'complete');assert.equal(saved.assessment.status,'ready');assert.equal(gptCalls,1);assert.equal(azureCalls,2);assert.equal(saved.responses[i].recording.data,a.responses[i].recording.data);
});
test('restart recovers saved-but-not-enqueued audio and does not rescore a completed mock',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-restart-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const store=createStore(null,directory,{table:'speaking_mock_attempts'}),a=fixture(),i=1;let calls=0;
  a.responses[i]={recording:recording()};await store.update('student',a.id,()=>a);const create=()=>createMockJobs({directory,store,gradeResponse:async q=>{calls++;return{transcript:'Saved',content:{total:report.contentMaximum(q),maximum:report.contentMaximum(q),scoringMode:'ai'},gpt:delivery(),azure:delivery()};}});
  let jobs=create();await jobs.start();await jobs.wait();await jobs.stop();assert.equal((await store.get('student',a.id)).assessment.status,'ready');jobs=create();await jobs.start();await jobs.wait();await jobs.stop();assert.equal(calls,1);
});
test('publication hides every legacy score field, comparison, transcript and sample when a single Azure trait is missing',()=>{
  const a=fixture();a.overall={overallScore:88};a.overallAzure={pronunciation:{raw:90}};a.combinedOverall={status:'assessed',overallScore:88};a.responses[1]={recording:recording(),transcript:'SECRET',content:{total:report.contentMaximum(a.questions[1]),maximum:report.contentMaximum(a.questions[1]),scoringMode:'ai'},gpt:delivery(),azure:delivery()};delete a.responses[1].azure.fluency;
  const value=present(a,1,{completeOnly:true});assert.equal(value.resultsReady,false);assert.equal(value.responses,undefined);assert.equal(value.overall,null);assert.equal(value.overallAzure,null);assert.equal(value.combinedOverall,null);assert.equal(value.combinedComparisons,null);assert.equal(value.question,undefined);assert(!JSON.stringify(value).includes('SECRET'));
});
test('DI uses the saved Academy job after a lost receipt, shares its content across both totals and never calls the local GPT grader',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-di-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const store=createStore(null,directory,{table:'speaking_mock_attempts'}),a=fixture(),i=a.questions.findIndex(q=>q.type==='di');a.responses[i]={recording:recording(),transcript:'A verified image response.'};await store.update('student',a.id,()=>a);
  let time=1000,submits=0,polls=0,azureCalls=0;const version=require('../delivery-rubric').RUBRIC_VERSION;
  const academyClient={submit:async opts=>{submits++;await opts.onPrepared({id:opts.id,inputHash:'input',normalizedHash:'audio'});throw Object.assign(Error('lost HTTP receipt'),{status:503});},poll:async receipt=>{polls++;return{status:'ready',inputReady:true,content:{status:'scored',max:6,score:6,reason:'Accurate comparison.',nextStep:'Keep the connected comparison.'},feedback:{strength:{quote:'A verified image response.',why:'A clear comparison.'}},delivery:{pronunciation:{status:'scored',max:5,score:5,rubricVersion:version},fluency:{status:'scored',max:5,score:5,rubricVersion:version},durationSeconds:10,model:'Academy test'}};}};
  const make=()=>createMockJobs({directory,store,academyClient,now:()=>time,transcribe:()=>{throw Error('Must reuse saved transcript');},callModel:()=>{throw Error('DI must use Academy');},assessGpt:()=>{throw Error('DI delivery must use Academy');},assessAzure:async()=>{azureCalls++;return delivery();}});
  let jobs=make();await jobs.ensure('student',a);await jobs.wait();assert.equal((await jobs.status('student',a)).ready,false);await jobs.stop();
  time+=6000;jobs=make();await jobs.wait();await jobs.stop();const saved=await store.get('student',a.id);assert.equal(saved.assessment.status,'ready');assert.equal(submits,1);assert(polls>=1);assert.equal(azureCalls,1);assert.equal(saved.responses[i].content.source,'Describe Image Academy');const scores=report.summarize(saved);assert.equal(scores.openai.questions.find(r=>r.index===i).content,6);assert.equal(scores.azure.questions.find(r=>r.index===i).content,6);
});
test('rollout respects an assessment lease from the previous deployment before scheduling any new provider work',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-lease-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const store=createStore(null,directory,{table:'speaking_mock_attempts'}),a=fixture();delete a.assessmentProfile;a.responses[1]={recording:recording()};a.lease={owner:'previous-deployment',expiresAt:5000};let time=1000,calls=0;
  await store.update('student',a.id,()=>a);const jobs=createMockJobs({directory,store,now:()=>time,gradeResponse:async q=>{calls++;return{transcript:'Saved',content:{total:report.contentMaximum(q),maximum:report.contentMaximum(q),scoringMode:'ai'},gpt:delivery(),azure:delivery()};}});t.after(()=>jobs.stop());
  await jobs.ensure('student',a);await jobs.wait();assert.equal(calls,0);assert.equal((await jobs.jobs.list('student',a.id)).length,0);time=5001;await jobs.ensure('student',a);await jobs.wait();assert.equal(calls,1);assert.equal((await store.get('student',a.id)).assessment.status,'ready');
});
