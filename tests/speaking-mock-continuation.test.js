'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const policy=require('../speaking-mock-continuation'),report=require('../speaking-mock-report');
const {attempt}=require('./helpers/speaking-deadline-zero-fixture');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),express=require('express');
function timedOut(){
  const a=attempt();a.index=24;a.completedCount=23;
  a.submission.unattempted=[24,25,26,27];
  a.responses=a.questions.map((q,index)=>{
    if(index===0)return{skipped:true};
    if(index>=24)return{deadlineUnattempted:true,reason:'deadline-unattempted'};
    return {recording:{hash:'retained-'+index,mime:'audio/webm',data:'SYNTHETIC_AUDIO'},
      transcript:'Retained synthetic answer',transcriptionStatus:'assessed',
      content:{scoringMode:'ai',total:report.contentMaximum(q),maximum:report.contentMaximum(q)},
      azure:{status:'assessed',pronunciation:{score:5},fluency:{score:5}}};
  });
  a.assessmentProfile.completionPolicy=require('../speaking-mock-completion').policy(a.questions);
  a.assessment={status:'ready',version:'progressive-speaking-v1',omissions:require('../speaking-mock-completion').omissions(a,2500)};
  a.grading={status:'complete'};
  return a;
}
test('A published 23-of-27 timeout reopens only four never-reached questions with their normal time',()=>{
  const a=timedOut(),before=structuredClone(a),plan=policy.inspect(a);
  assert(plan.eligible);assert.deepEqual(plan.indices,[24,25,26,27]);
  const command={operation:'student:continue-23-of-27',evidenceHash:plan.evidenceHash};
  const next=policy.apply(a,command,3000);
  assert.equal(next.status,'active');assert.equal(next.index,24);
  assert.equal(next.deadline,3000+plan.remainingMs);
  assert.equal(next.completedCount,23);
  assert.deepEqual(next.responses.slice(0,24),before.responses.slice(0,24));
  assert(next.responses.slice(24).every(value=>value===undefined));
  assert.equal(next.continuation.previous.report.assessedCount,23);
  assert.equal(next.continuation.previous.report.excludedCount,4);
  assert.deepEqual(next.continuation.previous.assessment,before.assessment);
  assert.equal(next.assessment.status,'pending');assert.equal(next.submission,undefined);
  assert.deepEqual(policy.apply(next,command,4000),next);
  assert.equal(policy.inspect(next).eligible,false);
  for(const index of plan.indices){
    const q=next.questions[index],maximum=report.contentMaximum(q);
    next.responses[index]={recording:{hash:'new-'+index,mime:'audio/webm',data:'SYNTHETIC_NEW_AUDIO'},
      transcript:'New synthetic answer',transcriptionStatus:'assessed',
      content:{scoringMode:'ai',total:maximum,maximum},
      azure:{status:'assessed',pronunciation:{score:4},fluency:{score:4}}};
  }
  next.index=next.questions.length;next.status='submitted';next.finishedAt=5000;
  const final=report.summarize(next).azure;
  assert.equal(final.status,'assessed');assert.equal(final.assessedCount,27);
  assert.equal(final.excludedCount,0);assert.equal(final.deadlineUnattemptedCount,0);
  assert.deepEqual(next.responses.slice(0,24),before.responses.slice(0,24));
});
test('Only unchanged, settled deadline omissions can be continued',()=>{
  const cases=[a=>a.responses[24].recording={hash:'late'},a=>a.submission.missing=[24],
    a=>a.submission.unattempted=[24,25,26],a=>a.assessmentExclusions={24:{reason:'instructor-review-unavailable'}},
    a=>a.deadlineZeroPublication={version:'speaking-deadline-zero-v1'},a=>a.grading.status='processing',
    a=>a.lease={expiresAt:4000},a=>a.index=23];
  for(const change of cases){const a=timedOut(),command={operation:'student:continue-23-of-27',evidenceHash:policy.inspect(a).evidenceHash};change(a);
    assert.equal(policy.inspect(a).eligible,false);assert.throws(()=>policy.apply(a,command,3000));}
  const a=timedOut(),command={operation:'student:continue-23-of-27',evidenceHash:policy.inspect(a).evidenceHash};
  a.responses[1].azure.pronunciation.score=4;
  assert.throws(()=>policy.apply(a,command,3000),/changed/);
});
test('Only the owner can continue the exact saved attempt through the student route',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-continuation-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const app=express();app.use(express.json());
  const service=require('../speaking-mock').installSpeakingMock(app,{directory,
    verifyToken:token=>token==='owner'?'mandeep':token==='other'?'other':null,
    getAccount:async()=>({}),now:()=>3000,azureAvailable:false});
  t.after(()=>service.stop());
  const a=timedOut();delete a.assessmentProfile.mode;
  await service.store.update('mandeep',a.id,()=>a);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url='http://127.0.0.1:'+server.address().port+'/api/speaking-mocks/attempts/'+a.id;
  const request=async(token,route,body)=>{
    const reply=await fetch(url+route,{method:body?'POST':'GET',headers:{'x-session-token':token,...(body?{'content-type':'application/json'}:{})},body:body&&JSON.stringify(body)});
    return {status:reply.status,value:await reply.json()};
  };
  const detail=await request('owner','');assert.equal(detail.status,200);
  assert(detail.value.continuationPlan?.eligible);
  const command={operation:'student:continue-23-of-27',evidenceHash:detail.value.continuationPlan.evidenceHash};
  assert.equal((await request('other','/continue',command)).status,404);
  assert.equal((await request('owner','/continue',{...command,evidenceHash:'f'.repeat(64)})).status,409);
  const result=await request('owner','/continue',command);
  assert.equal(result.status,200);assert.equal(result.value.status,'active');assert.equal(result.value.index,24);
  assert.equal(result.value.continuationPlan,undefined);
  assert.equal((await request('owner','/continue',command)).status,200);
  const saved=await service.store.get('mandeep',a.id);
  assert.deepEqual(saved.responses.slice(0,24),a.responses.slice(0,24));
  assert(saved.responses.slice(24).every(value=>value==null));
  assert.equal(saved.continuation.previous.report.assessedCount,23);
});
