'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {createStore}=require('../writing-lab-store'),{createPracticeAssessment}=require('../speaking-practice-assessment');

test('Background assessment acknowledges the saved audio, deduplicates grading and serves reads while the grader holds a file lock',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'assessment-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const store=createStore(null,dir,{table:'speaking_lab_attempts'}),id=randomUUID();
 await store.update('alice',id,()=>({id,status:'draft',recording:{data:'saved audio'}}));
 let finish,started,calls=0;const working=new Promise(r=>started=r),gate=new Promise(r=>finish=r);
 const grader=createPracticeAssessment({store,assess:async(uid,id)=>{calls++;return store.update(uid,id,async a=>{started();await gate;a.status='submitted';a.result={total:3};return a;});}});
 const job=grader.request('alice',id),again=grader.request('alice',id);assert.equal(job,again);
 const pending=await job.pending;assert.equal(pending.recording.data,'saved audio');assert.equal(pending.assessment.status,'pending');await working;
 // A timeout is an assertion, not a simulated successful response.
 let timeout;try{const read=await Promise.race([grader.get('alice',id),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Read blocked on grading')),500);})]);assert.equal(read.assessment.status,'pending');}finally{clearTimeout(timeout);finish();}
 await assert.rejects(grader.get('bob',id),e=>e.status===404);await job.work;
 const complete=await grader.get('alice',id);assert.equal(complete.assessment.status,'complete');assert.equal(complete.result.total,3);assert.equal(calls,1);
});

test('Assessment failure retains audio and an interrupted stale job can be retried',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'assessment-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const store=createStore(null,dir,{table:'speaking_lab_attempts'}),id=randomUUID();
 await store.update('alice',id,()=>({id,status:'draft',recording:{data:'saved audio'},assessment:{status:'pending',startedAt:1}}));
 const grader=createPracticeAssessment({store,now:()=>700000,assess:async()=>{throw Error('private provider detail');}});
 const interrupted=await grader.get('alice',id);assert.equal(interrupted.assessment.status,'error');assert.equal(interrupted.recording.data,'saved audio');
 await assert.rejects(grader.request('alice',id).work);const failed=await grader.get('alice',id);
 assert.equal(failed.recording.data,'saved audio');assert.equal(failed.assessment.status,'error');assert.doesNotMatch(failed.assessment.error,/private/);
});

test('Speaking API returns 202 for background review and keeps private playback available until completion',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'assessment-api-')),express=require('express'),app=express();app.use(express.json());
 let release,calls=0;const gate=new Promise(r=>release=r),q=require('../content/speaking-bank').questions.find(q=>q.type==='ra');
 const lab=require('../speaking-lab').installSpeakingLab(app,{directory:dir,verifyToken:t=>['alice','bob'].includes(t)?t:null,getAccount:async()=>({}),transcribe:async()=>{calls++;await gate;return q.text;},deliveryAssessmentAvailable:false});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{release();await lab.waitForAssessments();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port+'/api/speaking',id=randomUUID();
 const request=(route,body,user='alice',raw=false)=>fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'x-session-token':user,'Content-Type':raw?'audio/webm':'application/json'},body:body===undefined?undefined:raw?body:JSON.stringify(body),signal:AbortSignal.timeout(2000)});
 await request('/attempts',{id,questionId:q.id});await request('/attempts/'+id+'/recording',Buffer.alloc(200,3),'alice',true);
 const review=await request('/attempts/'+id+'/submit',{background:true});assert.equal(review.status,202);assert.equal((await review.json()).assessment.status,'pending');
 const again=await request('/attempts/'+id+'/submit',{background:true});assert.equal(again.status,202);
 assert.equal((await (await request('/attempts/'+id)).json()).assessment.status,'pending');
 assert.equal((await (await request('/attempts/'+id+'/recording')).arrayBuffer()).byteLength,200);
 assert.equal((await request('/attempts/'+id+'/recording',undefined,'bob')).status,404);
 release();await lab.waitForAssessments();const done=await (await request('/attempts/'+id)).json();assert.equal(done.assessment.status,'complete');assert.equal(done.status,'submitted');assert.equal(calls,1);
});
