'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const report=require('../speaking-mock-report'),bank=require('../content/speaking-mocks'),{createStore}=require('../writing-lab-store');
const {createMockJobs,identity}=require('../speaking-mock-jobs'),{hash}=require('../scoring-jobs'),{recover}=require('../speaking-incident-recovery');
const NOTE='Feedback could not be generated for your response to the faulty headphones question. This question is excluded from your overall assessment.';
function attempt(){
  const questions=structuredClone(bank.papers[1].questions),id=crypto.randomUUID();
  const a={id,paperId:'speaking-mock-2',title:'Speaking Mock 2',status:'submitted',index:questions.length,questionCount:27,startedAt:1,finishedAt:2,
    assessmentProfile:{mode:'progressive-v1',owner:'student',diBackend:'academy'},questions,
    responses:questions.map((q,i)=>q.type==='intro'?{skipped:true}:{recording:{mime:'audio/webm',hash:'saved-'+i,data:'PRIVATE_AUDIO'},transcript:'PRIVATE_TRANSCRIPT',transcriptionStatus:'assessed',
      content:{total:report.contentMaximum(q),maximum:report.contentMaximum(q),scoringMode:'ai'},azure:{status:'assessed',pronunciation:{score:5},fluency:{score:5}}})};
  a.responses[26].content.total=3;a.responses[26].azure.pronunciation.score=4;delete a.responses[27].content;return a;
}
function receipt(a){const q=a.questions[27];return{attemptId:a.id,username:'student',index:27,questionId:q.id,questionHash:hash(q),recordingHash:a.responses[27].recording.hash,
  operation:'exclude-headphones-test',note:NOTE,reason:'feedback-unavailable',authorizedBy:'administrator',excludedAt:1234};}
test('a recorded technical exclusion removes every trait and its denominator without applying a zero or losing the question',()=>{
  const a=attempt();assert.equal(report.summarize(a).azure.overallScore,null);const before=structuredClone(a);
  a.assessmentExclusions={27:receipt(a)};const value=report.summarize(a).azure;
  assert.equal(value.status,'assessed');assert.equal(value.overallScore,87);assert.equal(value.questionCount,26);assert.equal(value.assessedCount,26);assert.equal(value.excludedCount,1);assert.equal(value.originalQuestionCount,27);assert.equal(value.questions.length,27);
  assert.equal(value.unansweredCount,0);assert.equal(value.weightTotal,101);assert.equal(value.coverageValid,true);assert.equal(value.fullProfile,true);assert.deepEqual(value.missingQuestions,[]);
  const rts=value.byType.find(g=>g.type==='rts');assert.equal(rts.count,1);assert.equal(rts.total,12);assert.equal(rts.maximum,16);assert.equal(rts.weight,13);assert.equal(rts.content.maximum,6);assert.equal(rts.pronunciation.maximum,5);assert.equal(rts.fluency.maximum,5);
  const excluded=value.questions.at(-1);assert.equal(excluded.status,'excluded');assert.equal(excluded.total,null);assert.equal(excluded.content,null);assert.equal(excluded.pronunciation,null);assert.equal(excluded.fluency,null);assert.equal(value.excludedQuestions[0].note,NOTE);assert.equal(value.excludedQuestions[0].number,27);
  assert.deepEqual(a.questions,before.questions);assert.deepEqual(a.responses,before.responses);
  delete a.responses[1].azure.fluency;const partial=report.summarize(a).azure;assert.equal(partial.status,'pending');assert.equal(partial.overallScore,null);assert.equal(partial.questionCount,26);assert.deepEqual(partial.missingQuestions.map(q=>q.index),[1]);
});
test('wrong question, recording, attempt, actor or incomplete receipts never exclude a missing assessment',()=>{
  for(const change of [{questionHash:'wrong'},{recordingHash:'wrong'},{questionId:'rts-3'},{index:26},{attemptId:crypto.randomUUID()},{authorizedBy:'student'},{reason:'unanswered'},{note:''},{operation:''}]){
    const a=attempt();a.assessmentExclusions={27:{...receipt(a),...change}};const value=report.summarize(a).azure;assert.equal(value.excludedCount,0);assert.equal(value.questionCount,27);assert.equal(value.status,'pending');
  }
  const a=attempt();a.assessmentExclusions={27:{note:NOTE}};assert.equal(report.summarize(a).azure.status,'pending');
});
async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-exclusion-')),store=createStore(null,directory,{table:'speaking_mock_attempts'}),a=attempt(),logs=[];let providerCalls=0;
  const forbidden=async()=>{providerCalls++;throw Error('Existing scores must be reused.');};
  const progressive=createMockJobs({directory,store,gradeResponse:forbidden,assessAzure:forbidden,transcribe:forbidden});
  t.after(async()=>{await progressive.stop();await fs.rm(directory,{recursive:true,force:true});});await store.update('student',a.id,()=>a);
  const q=a.questions[27],response=a.responses[27],job=await progressive.jobs.enqueue({id:identity(a,27),owner:'student',groupId:a.id,inputHash:hash({recording:response.recording.hash,question:q}),
    data:{index:27,recordingHash:response.recording.hash,questionHash:hash(q),patch:{azure:structuredClone(response.azure)},stages:{content:{status:'needs_attention',failure:'validation',attempts:3},azure:{status:'ready'}}}});
  const claim=await progressive.jobs.claim();await progressive.jobs.save(claim,claim.data,{status:'needs_attention'});
  return{a,store,progressive,job,logs,calls:()=>providerCalls,options:{username:'student',attemptId:a.id,operation:'exclude-headphones-test',action:'exclude',indices:[27],questionId:'rts-4',note:NOTE,mockStore:store,progressive,logger:{info:(tag,value)=>logs.push(value)}}};
}
test('one scoped exclusion publishes 26 scored answers, preserves recordings and marks, and cannot be repaired into a paid regrade',async t=>{
  const f=await fixture(t),before=structuredClone(f.a),result=await recover(f.options);
  assert.equal(result.status,'ready');assert.equal(result.accountedFor,27);assert.equal(result.assessedCount,26);assert.equal(result.excludedCount,1);assert.equal(result.overallScore,87);assert.equal(f.calls(),0);
  const saved=await f.store.get('student',f.a.id);assert.equal(saved.assessment.status,'ready');assert.equal(saved.grading.status,'complete');assert.deepEqual(saved.responses,before.responses);assert.deepEqual(saved.questions,before.questions);assert.equal(saved.assessmentExclusions[27].note,NOTE);
  const row=await f.progressive.jobs.get('student',f.job.id);assert.equal(row.status,'ready');assert.equal(row.data.stages.content.attempts,3);assert.equal(row.data.stages.content.status,'needs_attention');assert.equal(row.data.assessmentExclusion.operation,f.options.operation);assert.equal((await f.progressive.jobs.list('student',f.a.id)).length,1);
  await assert.rejects(f.progressive.repair('student',f.a.id,{jobId:f.job.id,stage:'content',operation:'retry-excluded'}),/excluded/);
  const repeated=await recover(f.options);assert.equal(repeated.status,'ready');assert.equal(f.calls(),0);assert.deepEqual(await f.store.get('student',f.a.id),saved);assert(!f.logs.join().includes('PRIVATE_'));
  const view=require('../speaking-mock').present(saved,Date.now(),{completeOnly:true});assert.equal(view.resultsReady,true);assert.equal(view.questionCount,27);assert.equal(view.speakingReport.azure.questionCount,26);assert.equal(view.responses[27].exclusion.note,NOTE);assert.equal(view.responses[27].content,null);assert.equal(view.responses[27].providers.azure,null);assert.equal(view.responses[27].recording,true);
});
test('exclusion rejects unrelated questions, malformed scope and changed input before writing a receipt',async t=>{
  const f=await fixture(t),before=await f.store.get('student',f.a.id);
  for(const change of [{indices:[]},{indices:[26,27]},{indices:[26]},{questionId:'rts-3'},{note:''},{username:'other'},{operation:'bad operation'}])await assert.rejects(recover({...f.options,...change}));
  assert.deepEqual(await f.store.get('student',f.a.id),before);assert.equal((await f.progressive.jobs.get('student',f.job.id)).status,'needs_attention');assert.equal(f.calls(),0);
  await f.store.update('student',f.a.id,a=>{a.responses[27].recording.hash='changed';return a;});await assert.rejects(recover(f.options),/changed/);assert.equal(f.calls(),0);
});
test('a restart between settling the held job and saving the attempt converges through the same exclusion receipt',async t=>{
  const f=await fixture(t);let first=true;
  const interrupted={get:(...args)=>f.store.get(...args),update:(...args)=>{if(first){first=false;throw Error('Simulated interruption');}return f.store.update(...args);}};
  await assert.rejects(recover({...f.options,mockStore:interrupted}),/Simulated interruption/);assert.equal((await f.progressive.jobs.get('student',f.job.id)).status,'ready');assert.equal((await f.store.get('student',f.a.id)).assessmentExclusions,undefined);
  assert.equal((await recover(f.options)).status,'ready');assert.equal(f.calls(),0);
});
