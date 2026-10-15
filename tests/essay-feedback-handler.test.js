'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {createEssayGradeHandler}=require('../essay-feedback-handler');
const F=require('../public/essay-feedback');
async function start(t,{env={ESSAY_FEEDBACK_V3:'true',ESSAY_FEEDBACK_V3_PERCENT:'100'},fail=false}={}) {
 const calls=[],lookups=[];
 const parent={id:'original',questionText:'Do you agree?',attemptGroupId:'original',feedbackVersion:F.VERSION,essayText:'Original draft',feedbackIssues:[],scores:{total:24}};
 const app=express();app.use(express.json());app.post('/grade',createEssayGradeHandler({env,
  verifyToken:token=>({'signed-a':'student-a','signed-b':'student-b'}[token]||null),
  getUserData:async uid=>{lookups.push(uid);return {practiceHistory:uid==='student-a'?[parent]:[]};},
  grader:{grade:async(...args)=>{calls.push(args);if(fail)throw Error('Provider failed');return {feedbackVersion:args[3].feedbackV3?F.VERSION:undefined,feedbackIssues:[],revisionDecisions:[],scores:{total:24},improvements:[]};}}
 }));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const post=async(body={},token='signed-a')=>{const res=await fetch('http://127.0.0.1:'+server.address().port+'/grade',{method:'POST',headers:{'content-type':'application/json','x-session-token':token},body:JSON.stringify({question:'Do you agree?',essay:'Current essay.',attemptId:'revision',includeSample:false,...body})});return {status:res.status,body:await res.json()};};
 return {post,calls,lookups,parent};
}
test('Revision handler loads only the signed-in account history and scopes its new result',async t=>{
 const h=await start(t);const r=await h.post({parentAttemptId:'original'});assert.equal(r.status,200);assert.deepEqual(h.lookups,['student-a']);assert.equal(r.body.attemptGroupId,'original');assert.equal(r.body.parentAttemptId,'original');assert.equal(h.calls[0][3].includeSample,false);assert.deepEqual(h.calls[0][3].revisionContext,{issues:[]});assert.equal(h.parent.essayText,'Original draft');
});
test('Another student cannot load a revision parent by guessing its ID',async t=>{
 const h=await start(t);const r=await h.post({parentAttemptId:'original'},'signed-b');assert.equal(r.status,404);assert.equal(h.calls.length,0);assert.deepEqual(h.lookups,['student-b']);
});
test('A different prompt cannot silently join an existing revision chain',async t=>{
 const h=await start(t);assert.equal((await h.post({parentAttemptId:'original',question:'Another question?'})).status,409);assert.equal(h.calls.length,0);
});
test('Anonymous requests and disabled rollout use the legacy grader contract',async t=>{
 const h=await start(t);await h.post({parentAttemptId:'original'},'forged');assert.equal(h.calls[0][3].feedbackV3,false);assert.deepEqual(h.lookups,[]);
 const off=await start(t,{env:{ESSAY_FEEDBACK_V3:'false',ESSAY_FEEDBACK_V3_PERCENT:'100'}});assert.equal((await off.post()).body.feedbackVersion,undefined);assert.equal(off.calls[0][3].feedbackV3,false);
});
test('Feedback failures return an honest unavailable response instead of an invented score',async t=>{
 const h=await start(t,{fail:true});const r=await h.post();assert.equal(r.status,503);assert.equal(r.body.scores,undefined);assert.match(r.body.error,/writing is safe/);
});
test('Invalid prompt and sample options stop before provider calls',async t=>{
 const h=await start(t);assert.equal((await h.post({question:''})).status,400);assert.equal((await h.post({sampleBand:'10'})).status,400);assert.equal(h.calls.length,0);
});
