'use strict';
// Explicitly opt in to an isolated review host. No student data or credentials
// are read. Disposable passwords and session tokens stay in memory.
const fs=require('node:fs/promises'),assert=require('node:assert/strict'),{randomBytes}=require('node:crypto');
const F=require('../public/essay-feedback');
const fixture=require('../tests/essay-feedback-cases').cases.find(c=>c.id==='jobs_automation');
const preview=require('../public/essay-feedback-preview.json');
const revisedEssay=`Automation can improve working life by taking over repetitive work, but its benefits depend on how employers introduce it. I support its use when managers train workers and share productivity gains with them.

Machines can perform repeated movements throughout the day. A factory using machines may finish more products in the same period, allowing managers to meet orders without asking employees to repeat the same physical action. This can reduce tiring tasks and give staff time to check quality. Employees still need training to operate the equipment and respond when it stops working.

Greater productivity does not automatically shorten working hours. If managers use the time saved to reduce shifts while maintaining pay, staff can work fewer hours without losing income. If managers instead use the machines only to increase output, working hours may remain unchanged. Shorter hours therefore require an explicit decision about how the gains will be shared.

Employment effects also depend on the transition. Machines may replace some assembly tasks, while creating demand for maintenance and quality-control work. Retraining can help affected employees move into those roles, although the new positions may not cover every displaced job. Employers should identify suitable roles before replacing tasks and offer practical training to the people affected.

Overall, automation can make work less repetitive and support shorter hours when employers share the gains. Its employment benefits require planning and training, so I favour a managed transition rather than assuming every worker will automatically benefit.`;
async function main(){
 const base=process.env.ESSAY_REVIEW_URL,output=process.env.ESSAY_REVIEW_OUTPUT;
 if(!base || !output || !new URL(base).hostname.includes('review'))throw Error('Provide an isolated ESSAY_REVIEW_URL containing review and ESSAY_REVIEW_OUTPUT.');
 async function request(path,body,token){
  const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{'x-session-token':token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(300000)});
  return {status:r.status,body:await r.json()};
 }
 async function register(suffix){const username='revisionqa_'+Date.now()+'_'+suffix;
  const r=await request('/api/auth/register',{username,password:randomBytes(24).toString('base64url')});assert.equal(r.status,200);assert(r.body.token);return {username,token:r.body.token};}
 const owner=await register('a'),other=await register('b');
 const original={...F.scope(preview.examples.find(c=>c.id===fixture.id).assessment,{attemptId:'qa_original'}),id:'qa_original',type:'essay',date:Date.now(),questionText:fixture.question,essayText:fixture.essay};
 const path='/api/sync/'+owner.username;
 assert.equal((await request(path,{practiceHistory:[original]},owner.token)).status,200);
 const body={question:fixture.question,essay:revisedEssay,includeSample:false,attemptId:'qa_revision',parentAttemptId:original.id};
 const started=Date.now(),graded=await request('/api/essay/grade',body,owner.token),latencyMs=Date.now()-started;
 await fs.writeFile(output,JSON.stringify({synthetic:true,passed:false,status:graded.status,latencyMs,assessment:graded.body},null,2));
 assert.equal(graded.status,200,JSON.stringify(graded.body));const a=graded.body;
 assert.equal(a.parentAttemptId,original.id);assert.equal(a.originalAttemptId,original.id);assert.equal(a.revisionNumber,1);
 const resolved=a.revisionDecisions.filter(d=>d.status==='resolved');assert(resolved.length>0,'No original issue was confirmed resolved.');
 for(const d of resolved){assert(d.evidence && revisedEssay.includes(d.evidence));assert(d.reason);}
 const revised={...a,id:a.attemptId,type:'essay',date:Date.now(),questionText:fixture.question,essayText:revisedEssay,isFinalDraft:true};
 assert.equal((await request(path,{practiceHistory:[original,revised]},owner.token)).status,200);
 const retryStarted=Date.now(),retry=await request('/api/essay/grade',body,owner.token),retryLatencyMs=Date.now()-retryStarted;
 assert.equal(retry.status,200);assert.deepEqual(retry.body,a);
 assert.equal((await request(path,{practiceHistory:[original,revised,revised]},owner.token)).status,200);
 const reload=await request(path,undefined,owner.token);assert.equal(reload.status,200);
 const history=reload.body.data.practiceHistory;assert.equal(history.length,2);
 const savedOriginal=history.find(v=>v.id===original.id),savedRevision=history.find(v=>v.id===revised.id);
 assert.equal(savedOriginal.essayText,original.essayText);assert.deepEqual(savedOriginal.scores,original.scores);
 assert.equal(savedRevision.isFinalDraft,true);assert.deepEqual(savedRevision.revisionDecisions,a.revisionDecisions);
 assert.equal((await request('/api/essay/grade',body,other.token)).status,404);
 assert.equal((await request(path,undefined,other.token)).status,403);
 await fs.writeFile(output,JSON.stringify({synthetic:true,passed:true,latencyMs,retryLatencyMs,checks:['resolved-current-evidence','revision-links','save-reload','duplicate-retry','original-preserved','marked-final','account-isolation'],originalIssueCodes:original.feedbackIssues.map(i=>i.code),assessment:a},null,2));
 console.log('PASS: revision assessment, evidence, save/reload, duplicate retry, original preservation, final marker and account isolation.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
