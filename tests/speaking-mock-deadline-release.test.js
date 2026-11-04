'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const support=require('../speaking-mock-deadline-release'),submission=require('../speaking-mock-submission'),report=require('../speaking-mock-report'),bank=require('../content/speaking-mocks'),{hash}=require('../scoring-jobs');
function fixture(){
 const questions=structuredClone(bank.papers[0].questions),index=questions.length-1;
 const a={id:crypto.randomUUID(),paperId:bank.papers[0].id,title:'Synthetic deadline mock',questionCount:27,questions,index,status:'submitted',startedAt:1000,deadline:2000,finishedAt:2001,grading:{status:'incomplete'},submission:{version:1,reason:'deadline',state:'incomplete',startedAt:2000,closesAt:2000,pending:[],missing:[],unattempted:[index]},responses:questions.map((q,i)=>i===index?{deadlineUnattempted:true,reason:'deadline-unattempted'}:{recording:{hash:'recording-'+i,mime:'audio/webm',data:'RETAINED_AUDIO'},transcript:'Retained spoken response',transcriptionStatus:'assessed',content:{scoringMode:'ai',total:report.contentMaximum(q),maximum:report.contentMaximum(q)},azure:{status:'assessed',pronunciation:{score:4},fluency:{score:5}}})};
 return a;
}
function body(a,h=a,rows=[]){const plan=support.inspect(a,h,rows,3000);return {mode:'release-deadline',operation:'staff:deadline-release-1',questionId:plan.questionId,evidenceHash:plan.evidenceHash,note:'This question was not reached before time expired. Excluded at instructor request; original responses retained.',confirmInstructorExclusion:true};}
test('An explicit final-question release preserves every original response and confirmed result, with a visible exclusion',()=>{
 const a=fixture(),before=structuredClone(a),request=body(a),next=support.apply(a,a,[],request,3000);
 assert.deepEqual(a,before);assert.deepEqual(next.questions,a.questions);assert.deepEqual(next.responses,a.responses);
 assert.deepEqual(next.submission.unattempted,a.submission.unattempted);assert.equal(next.submission.state,'incomplete');assert.equal(submission.blocked(next),false);assert.equal(submission.validRelease(next),true);
 const r=report.summarize(next).azure;assert.equal(r.status,'assessed');assert.equal(r.assessedCount,26);assert.equal(r.excludedCount,1);assert.equal(r.originalQuestionCount,27);assert.equal(r.questions.at(-1).total,null);assert.match(r.excludedQuestions[0].note,/instructor request/);
 assert.equal(support.confirmedHash(next),support.confirmedHash(a));assert.equal(submission.releaseEvidence(next),submission.releaseEvidence(a));
 assert.deepEqual(support.apply(next,next,[],request,4000),next,'A lost response reuses the same operation without another write.');
});
test('Ready background stages fill only missing results and never replace an existing confirmed trait',()=>{
 const a=fixture(),h=structuredClone(a);delete a.responses[1].content;delete a.responses[1].azure.fluency;h.responses[1].azure.pronunciation.score=1;
 const next=support.apply(a,h,[],body(a,h),3000);assert.equal(next.responses[1].azure.pronunciation.score,4);assert.equal(next.responses[1].azure.fluency.score,5);assert.deepEqual(next.responses[1].content,h.responses[1].content);assert.equal(next.responses[1].recording.data,a.responses[1].recording.data);
 const meta=structuredClone(a);for(const r of meta.responses)if(r.recording)delete r.recording.data;assert.equal(body(a,h).evidenceHash,body(meta,h).evidenceHash,'Metadata diagnostics and full stored audio bind to the same evidence.');
});
for(const condition of ['active','missing-upload','pending-upload','multiple','not-final','unmarked','has-audio','has-transcript','lease','running-job','held-job','missing-content','missing-azure','existing-exclusion','sole-task'])test('Deadline publication holds '+condition,()=>{
 const a=fixture(),rows=[];if(condition==='active')a.status='active';if(condition==='missing-upload')a.submission.missing=[1];if(condition==='pending-upload')a.submission.pending=[1];if(condition==='multiple')a.submission.unattempted.push(26);if(condition==='not-final'){a.submission.unattempted=[26];a.responses[26]=a.responses[27];}if(condition==='unmarked')a.responses[27]={};if(condition==='has-audio')a.responses[27].recording={hash:'late'};if(condition==='has-transcript')a.responses[27].transcript='Unverified';if(condition==='lease')a.lease={expiresAt:4000};if(condition==='running-job')rows.push({status:'running'});if(condition==='held-job')rows.push({status:'needs_attention'});if(condition==='missing-content')delete a.responses[1].content;if(condition==='missing-azure')delete a.responses[1].azure.fluency;if(condition==='existing-exclusion')a.assessmentExclusions={1:{}};if(condition==='sole-task')a.questions[26].type='sgd';
 const before=hash(a);assert.equal(support.inspect(a,a,rows,3000).eligible,false);assert.throws(()=>support.apply(a,a,rows,body(a,a,rows),3000));assert.equal(hash(a),before);
});
test('Stale evidence, missing confirmation and changed release proofs cannot publish',()=>{
 const a=fixture(),request=body(a);assert.throws(()=>support.apply(a,a,[],{...request,confirmInstructorExclusion:false},3000),{status:400});a.responses[1].recording.hash='changed';assert.throws(()=>support.apply(a,a,[],request,3000),{status:409});
 const original=fixture(),next=support.apply(original,original,[],body(original),3000);for(const change of [n=>n.responses[1].recording.hash='changed',n=>delete n.assessmentExclusions,n=>n.questions.at(-1).id='changed',n=>n.submission.release.exclusionHash='changed']){const invalid=structuredClone(next);change(invalid);assert.equal(submission.blocked(invalid),true);}
});
test('The owner-bound admin repair publishes an eligible record without provider calls and rejects another owner',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'deadline-release-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const {createStore}=require('../writing-lab-store'),{createMockJobs,complete}=require('../speaking-mock-jobs'),store=createStore(null,directory,{table:'speaking_mock_attempts'}),a=fixture();await store.update('owner',a.id,()=>a);
 let calls=0;const jobs=createMockJobs({directory,store,now:()=>3000,transcribe:async()=>{calls++;throw Error('No provider');},assessAzure:async()=>{calls++;throw Error('No provider');}});
 const before=await jobs.diagnostics('owner',a.id);assert.equal(before.deadlineRelease.eligible,true);assert.equal(before.accountedFor,26);
 const request={...body(a),evidenceHash:before.deadlineRelease.evidenceHash};await assert.rejects(jobs.repair('other',a.id,request),{status:404});
 const after=await jobs.repair('owner',a.id,request);assert.equal(after.ready,true);assert.equal(after.accountedFor,27);assert.equal(after.assessedCount,26);assert.equal(after.excludedCount,1);assert.equal(after.inputsHash,before.inputsHash);assert.equal(after.confirmedHash,before.confirmedHash);assert(complete(await store.get('owner',a.id)));assert.equal(calls,0);
 assert.equal((await jobs.repair('owner',a.id,request)).ready,true);assert.equal(calls,0);
});
