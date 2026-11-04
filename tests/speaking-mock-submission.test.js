'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),express=require('express');
const {reconcile,timing,installSpeakingMock,present}=require('../speaking-mock'),submission=require('../speaking-mock-submission'),report=require('../speaking-mock-report');
const q={id:'synthetic-ra',type:'ra',name:'Read Aloud',text:'A synthetic response.',preparation:0,seconds:40};
function attempt(){return {id:crypto.randomUUID(),questions:[q],responses:[],questionCount:1,index:0,status:'active',startedAt:1000,questionStartedAt:1000,deadline:10000};}
test('deadline reserves only the authorised current recording and hides results during upload',()=>{
 const a=attempt();reconcile(a,10000);assert.equal(a.status,'active');assert.equal(a.submission.state,'finalizing');assert.deepEqual(a.submission.pending,[0]);assert.equal(submission.canUpload(a,1,11000),false);assert.equal(report.questionResult(a,q,undefined,0,'azure').total,null);assert.equal(present(a,11000).resultsReady,false);
 a.responses[0]={recording:{hash:'original'}};reconcile(a,21000);assert.equal(a.status,'submitted');assert.equal(a.submission.state,'complete');assert.equal(a.responses[0].recording.hash,'original');
});
test('grace is bounded, missing media never becomes zero, and historical submitted attempts stay unchanged',()=>{
 const a=attempt();reconcile(a,10000);const close=a.submission.closesAt;reconcile(a,10001);assert.equal(a.submission.closesAt,close);assert(submission.canUpload(a,0,close));reconcile(a,close+1);assert.equal(a.submission.state,'incomplete');assert.equal(submission.canUpload(a,0,close+1),false);assert.equal(report.questionResult(a,q,undefined,0,'azure').status,'pending');
 const old={...attempt(),status:'submitted',grading:{status:'complete'}};const before=JSON.stringify(old);reconcile(old,1000000);assert.equal(JSON.stringify(old),before);
});
test('unreached deadline questions are incomplete; deliberate skips retain the native zero',()=>{
 const a=attempt();a.questions=[q,{...q,id:'next'}];a.questionCount=2;reconcile(a,10000);a.responses[0]={recording:{hash:'saved'}};reconcile(a,11000);assert.equal(a.submission.state,'incomplete');assert.deepEqual(a.submission.unattempted,[1]);assert.equal(report.questionResult(a,a.questions[1],a.responses[1],1,'azure').total,null);
 assert.equal(report.questionResult(a,q,{skipped:true},0,'azure').total,0);
});
test('expiry before capture starts cannot authorise a new recording through upload grace',()=>{
 const a=attempt();a.questions=[{...q,preparation:20}];reconcile(a,10000);assert.equal(a.status,'submitted');assert.equal(a.submission.state,'incomplete');assert.equal(submission.canUpload(a,0,11000),false);
});
test('server/worker deadline races accept one reserved upload, preserve bytes and reject replacement',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-deadline-')),app=express();app.use(express.json());let at=9000;
 const lab=installSpeakingMock(app,{directory:dir,getAccount:async()=>({}),transcribe:async()=>'',verifyToken:s=>s==='owner'?'owner':s==='other'?'other':null,now:()=>at,azureAvailable:false,azureOverallAvailable:false});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{await lab.waitForJobs();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});});
 const a=attempt();await lab.store.update('owner',a.id,()=>a);const base='http://127.0.0.1:'+server.address().port+'/api/speaking-mocks/attempts/'+a.id;
 const get=()=>fetch(base,{headers:{'x-session-token':'owner'}});at=10000;
 // The same durable store transition used by the background scan competes with GET.
 await Promise.all([get(),lab.store.update('owner',a.id,current=>submission.reconcile(current,at))]);
 const waiting=await(await get()).json();assert.equal(waiting.resultStatus.status,'finalizing');
 let writes=0;const update=lab.store.update;lab.store.update=(...args)=>{writes++;return update(...args);};
 for(let i=0;i<3;i++)assert.equal((await(await fetch(base+'/status',{headers:{'x-session-token':'owner'}})).json()).status,'finalizing');assert.equal(writes,0,'Waiting status polls must not rewrite all recording data');lab.store.update=update;
 const bytes=Buffer.alloc(300,3),post=(data,owner='owner')=>fetch(base+'/recordings/0',{method:'POST',headers:{'x-session-token':owner,'Content-Type':'audio/webm'},body:data});at=21000;
 assert.equal((await post(bytes,'other')).status,404);assert.equal((await fetch(base+'/next',{method:'POST',headers:{'x-session-token':'owner','Content-Type':'application/json'},body:JSON.stringify({index:0,skip:true})})).status,409);
 const replies=await Promise.all([post(bytes),post(bytes)]);assert(replies.every(r=>r.status===200));const saved=await lab.store.get('owner',a.id);assert.equal(saved.status,'submitted');assert.equal(saved.submission.state,'complete');assert.equal(saved.responses[0].recording.data,bytes.toString('base64'));assert.equal((await post(Buffer.alloc(300,9))).status,409);
});
