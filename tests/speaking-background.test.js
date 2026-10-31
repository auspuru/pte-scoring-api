'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),express=require('express');
const bank=require('../content/speaking-mocks'),report=require('../speaking-mock-report'),{installSpeakingMock,present}=require('../speaking-mock'),{createMockJobs}=require('../speaking-mock-jobs'),{createStore}=require('../writing-lab-store');
const delivery=()=>({status:'assessed',pronunciation:{status:'scored',score:5,maximum:5},fluency:{status:'scored',score:4,maximum:5}});
function fixture(){const questions=structuredClone(bank.papers[0].questions);return{id:crypto.randomUUID(),title:'Speaking mock',paperId:bank.papers[0].id,status:'submitted',startedAt:1,deadline:999999,index:questions.length,questionCount:27,questions,responses:questions.map(()=>({skipped:true})),assessmentProfile:{mode:'progressive-v1',owner:'student',diBackend:'academy'},integrity:{events:[]},grading:{status:'pending'}};}
test('New mock DI jobs use the selected GPT reviewer with the Academy rubric and keep Azure delivery independent',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-gpt-content-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const store=createStore(null,directory,{table:'speaking_mock_attempts'}),a=fixture(),index=a.questions.findIndex(q=>q.type==='di');
 a.assessmentProfile={...a.assessmentProfile,diBackend:'portal-gpt',contentProvider:'openai',contentModel:'gpt-6.1-sol'};
 a.questions[index]={id:'test-di',type:'di',title:'Campus travel',imageCategory:'line',facts:['Trips rose from 200 to 450, with a brief fall.']};
 const text='The image shows trips rising from 200 to 450, despite a brief fall.';
 a.responses[index]={recording:recording(),transcript:text,transcriptionStatus:'assessed'};await store.update('student',a.id,()=>a);
 let contentCalls=0,azureCalls=0;
 const jobs=createMockJobs({directory,store,transcribe:()=>{throw Error('Reuse saved transcript');},
  academyClient:{submit:()=>{throw Error('New GPT jobs must not call the legacy remote model');}},
  callModel:async(prompt,context)=>{contentCalls++;assert.equal(context.contentPolicy,require('../describe-image-academy').VERSION);
   return {judgment:{score:6,relevance:'image-specific',accuracy:'accurate',scoreImpact:null,
    requiredEvidence:{quote:'trips rising from 200 to 450',factIndices:[0],kind:'relationship'},inaccuracy:null,otherEvidence:[]},
    reason:'The main trend and exception are connected.',nextStep:'Keep the connected comparison.'};},
  assessAzure:async()=>{azureCalls++;return delivery();}});t.after(()=>jobs.stop());
 await jobs.ensure('student',a);await jobs.wait();
 const saved=await store.get('student',a.id);assert.equal(saved.assessment.status,'ready');assert.equal(contentCalls,1);assert.equal(azureCalls,1);
 assert.equal(saved.responses[index].content.total,6);assert.equal(saved.responses[index].content.source,'Describe Image Academy');
 await jobs.ensure('student',saved);await jobs.wait();assert.equal(contentCalls,1);assert.equal(azureCalls,1);
});
const recording=()=>({hash:crypto.randomBytes(32).toString('hex'),data:Buffer.alloc(200,7).toString('base64'),mime:'audio/webm'});
test('Rejected DI content keeps a safe diagnostic across restart without changing saved audio, transcript or Azure',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-content-diagnostic-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const store=createStore(null,directory,{table:'speaking_mock_attempts'}),a=fixture(),i=a.questions.findIndex(q=>q.type==='di');
 a.assessmentProfile.diBackend='portal-gpt';a.questions[i]={id:'diagnostic-di',type:'di',title:'Travel',facts:['Trips increased.']};
 a.responses[i]={recording:recording(),transcript:'Trips increased.',transcriptionStatus:'assessed',azure:delivery()};await store.update('student',a.id,()=>a);
 let at=1000,calls=0,ready=false;
 const make=()=>createMockJobs({directory,store,now:()=>at,transcribe:()=>assert.fail('Reuse transcript'),assessAzure:()=>assert.fail('Reuse Azure'),callModel:async()=>{
  calls++;
  if(!ready)return {judgment:{score:null,relevance:'source-limited',accuracy:'unverifiable',scoreImpact:null,requiredEvidence:null,inaccuracy:null,otherEvidence:[{quote:'Trips increased.',factIndices:[],kind:'generic'}]},reason:'PRIVATE_MODEL_PROSE',nextStep:'PRIVATE_MODEL_PROSE'};
  return {judgment:{score:6,relevance:'image-specific',accuracy:'accurate',scoreImpact:null,requiredEvidence:{quote:'Trips increased.',factIndices:[0],kind:'relationship'},inaccuracy:null,otherEvidence:[]},reason:'The relationship is clear.',nextStep:'Keep the relationship.'};
 }});
 let jobs=make();await jobs.ensure('student',a);await jobs.wait();
 let d=await jobs.diagnostics('student',a.id);assert.deepEqual(d.jobs[0].stages.content.detail,{code:'source-limited',mode:'ai'});
 assert.equal(d.ready,false);assert(!JSON.stringify(d).includes('PRIVATE_MODEL_PROSE'));assert(!JSON.stringify(d).includes(a.responses[i].transcript));
 await jobs.stop();jobs=make();t.after(()=>jobs.stop());d=await jobs.diagnostics('student',a.id);assert.equal(d.jobs[0].stages.content.detail.code,'source-limited');
 assert.deepEqual((await store.get('student',a.id)).responses[i],a.responses[i]);
 ready=true;at+=16000;await jobs.wait();const saved=await store.get('student',a.id);
 assert.equal(saved.assessment.status,'ready');assert.equal(calls,2);assert.equal(saved.responses[i].content.total,6);
 for(const key of ['recording','transcript','transcriptionStatus','azure'])assert.deepEqual(saved.responses[i][key],a.responses[i][key]);
 assert.equal((await jobs.jobs.list('student',a.id))[0].data.contentRejection,undefined);
});
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
  assert.equal(value.resultsReady,true);assert.equal(value.speakingReport.openai,undefined);assert.equal(value.speakingReport.azure.assessedCount,27);assert.equal(value.responses[a.index].transcript,'PRIVATE_TRANSCRIPT');assert.equal(calls,1);
  assert.equal((await fetch(base+'/attempts/'+a.id+'/status',{headers:{'x-session-token':'other'}})).status,401);
});
test('known transient failure retries only the missing provider and publishes automatically, retaining saved stages',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-retry-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const store=createStore(null,directory,{table:'speaking_mock_attempts'}),a=fixture(),i=a.questions.findIndex(q=>q.type==='rs');let time=1000,gptCalls=0,azureCalls=0;
  a.responses[i]={recording:recording(),transcript:'A saved transcript.',content:{total:3,maximum:3,scoringMode:'ai'}};await store.update('student',a.id,()=>a);
  const jobs=createMockJobs({directory,store,now:()=>time,transcribe:()=>{throw Error('must reuse transcript');},assessGpt:async(_,options)=>{assert.equal(options.contentIndependent,true);gptCalls++;return delivery();},assessAzure:async(_,options)=>{assert.equal(options.contentIndependent,true);if(++azureCalls===1)throw Object.assign(Error('busy'),{providerStatus:429});return delivery();}});t.after(()=>jobs.stop());
  await jobs.ensure('student',a);await jobs.wait();let saved=await store.get('student',a.id);assert.notEqual(saved.grading.status,'complete');assert.equal(gptCalls,0);assert.equal(azureCalls,1);
  time+=16000;await jobs.wait();saved=await store.get('student',a.id);assert.equal(saved.grading.status,'complete');assert.equal(saved.assessment.status,'ready');assert.equal(gptCalls,0);assert.equal(azureCalls,2);assert.equal(saved.responses[i].recording.data,a.responses[i].recording.data);
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
test('DI uses the saved Academy job after a lost receipt, uses its content with Azure delivery and never calls the local GPT grader',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-di-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const store=createStore(null,directory,{table:'speaking_mock_attempts'}),a=fixture(),i=a.questions.findIndex(q=>q.type==='di');a.responses[i]={recording:recording(),transcript:'A verified image response.'};await store.update('student',a.id,()=>a);
  let time=1000,submits=0,polls=0,azureCalls=0;const version=require('../delivery-rubric').RUBRIC_VERSION;
  const academyClient={submit:async opts=>{submits++;await opts.onPrepared({id:opts.id,inputHash:'input',normalizedHash:'audio'});throw Object.assign(Error('lost HTTP receipt'),{status:503});},poll:async receipt=>{polls++;return{status:'ready',inputReady:true,content:{status:'scored',max:6,score:6,reason:'Accurate comparison.',nextStep:'Keep the connected comparison.'},feedback:{strength:{quote:'A verified image response.',why:'A clear comparison.'}},delivery:{pronunciation:{status:'scored',max:5,score:5,rubricVersion:version},fluency:{status:'scored',max:5,score:5,rubricVersion:version},durationSeconds:10,model:'Academy test'}};}};
  const make=()=>createMockJobs({directory,store,academyClient,now:()=>time,transcribe:()=>{throw Error('Must reuse saved transcript');},callModel:()=>{throw Error('DI must use Academy');},assessGpt:()=>{throw Error('DI delivery must use Academy');},assessAzure:async()=>{azureCalls++;return delivery();}});
  let jobs=make();await jobs.ensure('student',a);await jobs.wait();assert.equal((await jobs.status('student',a)).ready,false);await jobs.stop();
  time+=6000;jobs=make();await jobs.wait();await jobs.stop();const saved=await store.get('student',a.id);assert.equal(saved.assessment.status,'ready');assert.equal(submits,1);assert(polls>=1);assert.equal(azureCalls,1);assert.equal(saved.responses[i].content.source,'Describe Image Academy');const scores=report.summarize(saved);assert.equal(scores.openai,undefined);assert.equal(scores.azure.questions.find(r=>r.index===i).content,6);
});
test('rollout respects an assessment lease from the previous deployment before scheduling any new provider work',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-lease-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const store=createStore(null,directory,{table:'speaking_mock_attempts'}),a=fixture();delete a.assessmentProfile;a.responses[1]={recording:recording()};a.lease={owner:'previous-deployment',expiresAt:5000};let time=1000,calls=0;
  await store.update('student',a.id,()=>a);const jobs=createMockJobs({directory,store,now:()=>time,gradeResponse:async q=>{calls++;return{transcript:'Saved',content:{total:report.contentMaximum(q),maximum:report.contentMaximum(q),scoringMode:'ai'},gpt:delivery(),azure:delivery()};}});t.after(()=>jobs.stop());
  await jobs.ensure('student',a);await jobs.wait();assert.equal(calls,0);assert.equal((await jobs.jobs.list('student',a.id)).length,0);time=5001;await jobs.ensure('student',a);await jobs.wait();assert.equal(calls,1);assert.equal((await store.get('student',a.id)).assessment.status,'ready');
});

test('an old GPT-only hold is retired and saved Azure marks publish without either audio provider being called again',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'azure-only-migration-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const store=createStore(null,directory,{table:'speaking_mock_attempts'}),a=fixture(),i=a.questions.findIndex(q=>q.type==='rs'),record=recording();a.responses[i]={recording:record,transcript:'Already transcribed.',content:{total:3,maximum:3,scoringMode:'ai'}};await store.update('student',a.id,()=>a);let calls=0;
  const jobs=createMockJobs({directory,store,assessGpt:async()=>{calls++;throw Error('Retired');},assessAzure:async()=>{calls++;throw Error('Reuse saved Azure');}});t.after(()=>jobs.stop());const jobId=require('../speaking-mock-jobs').identity(a,i),hash=require('../scoring-jobs').hash;
  await jobs.jobs.enqueue({id:jobId,owner:'student',groupId:a.id,inputHash:hash({recording:record.hash,question:a.questions[i]}),data:{index:i,recordingHash:record.hash,questionHash:hash(a.questions[i]),patch:{azure:delivery()},stages:{gpt:{status:'needs_attention',failure:'uncertain_provider_outcome'},azure:{status:'ready'}}}});
  const row=await jobs.jobs.claim();await jobs.jobs.save(row,row.data,{status:'needs_attention'});await jobs.ensure('student',a);await jobs.wait();const saved=await store.get('student',a.id);assert.equal(saved.assessment.status,'ready');assert.equal(calls,0);assert.equal((await jobs.jobs.get('student',jobId)).data.stages.gpt.status,'retired');assert.equal(report.summarize(saved).openai,undefined);
});

test('A held transient Speaking stage recovers after cooldown without an administrator or repeated confirmed work',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'automatic-speaking-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const store=createStore(null,directory,{table:'speaking_mock_attempts'}),a=fixture(),i=a.questions.findIndex(q=>q.type==='rs'),record=recording();
 a.responses[i]={recording:record,transcript:'A previously transcribed response.',content:{total:3,maximum:3,scoringMode:'ai'}};await store.update('student',a.id,()=>a);
 let at=1000,calls=0;const make=()=>createMockJobs({directory,store,now:()=>at,assessAzure:async()=>{calls++;return delivery();},transcribe:()=>assert.fail('Reuse transcript'),callModel:()=>assert.fail('Reuse confirmed content')});
 let jobs=make();const jobId=require('../speaking-mock-jobs').identity(a,i),hash=require('../scoring-jobs').hash;
 await jobs.jobs.enqueue({id:jobId,owner:'student',groupId:a.id,inputHash:hash({recording:record.hash,question:a.questions[i]}),data:{index:i,recordingHash:record.hash,questionHash:hash(a.questions[i]),patch:{...a.responses[i]},stages:{azure:{status:'needs_attention',failure:503,attempts:3}}}});
 const row=await jobs.jobs.claim();await jobs.jobs.save(row,row.data,{status:'needs_attention'});await jobs.ensure('student',a);await jobs.wait();assert.equal(calls,0);await jobs.stop();
 at+=600001;jobs=make();t.after(()=>jobs.stop());await jobs.recover();await jobs.wait();
 const result=await store.get('student',a.id);assert.equal(result.assessment.status,'ready');assert.equal(calls,1);assert.deepEqual(result.responses[i].content,a.responses[i].content);
 await jobs.recover();await jobs.wait();assert.equal(calls,1);
});

for(const mode of ['billing','insufficient-audio'])test('Delayed Speaking recovery does not repeat a held '+mode+' assessment',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'held-speaking-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const store=createStore(null,directory,{table:'speaking_mock_attempts'}),a=fixture(),i=a.questions.findIndex(q=>q.type==='rs'),record=recording();
 a.responses[i]={recording:record,transcript:'Saved transcript.',content:{total:3,maximum:3,scoringMode:'ai'}};await store.update('student',a.id,()=>a);let at=1000,calls=0;
 const jobs=createMockJobs({directory,store,now:()=>at,assessAzure:async()=>{calls++;return delivery();}});t.after(()=>jobs.stop());const jobId=require('../speaking-mock-jobs').identity(a,i),hash=require('../scoring-jobs').hash;
 const azure=mode==='insufficient-audio'?{deliveryEvidence:{sufficient:false}}:undefined;
 await jobs.jobs.enqueue({id:jobId,owner:'student',groupId:a.id,inputHash:hash({recording:record.hash,question:a.questions[i]}),data:{index:i,recordingHash:record.hash,questionHash:hash(a.questions[i]),patch:{...a.responses[i],...(azure?{azure}:{})},stages:{azure:{status:'needs_attention',failure:mode==='billing'?429:'validation',...(mode==='billing'?{detail:{code:'insufficient_quota'}}:{}),attempts:3}}}});
 const row=await jobs.jobs.claim();await jobs.jobs.save(row,row.data,{status:'needs_attention'});at+=600001;
 await jobs.ensure('student',a);await jobs.wait();assert.equal(calls,0);assert.equal((await jobs.jobs.get('student',jobId)).status,'needs_attention');
});
