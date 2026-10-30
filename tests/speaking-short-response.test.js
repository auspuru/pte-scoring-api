'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const report=require('../speaking-mock-report');
function attempt(){
  const q={id:'ra-short',type:'ra',text:'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'};
  const response={recording:{hash:'original-recording',mime:'audio/webm',data:'PRIVATE_AUDIO'},transcriptionStatus:'assessed',transcript:'one two three',
    content:{total:3,maximum:20,scoringMode:'ai'},azure:{status:'assessed',recordingHash:'original-recording',
      pronunciation:{score:null,maximum:5,raw:80},fluency:{score:null,maximum:5,raw:70},
      deliveryEvidence:{sufficient:false,durationSeconds:6.2,spokenWords:3}}};
  return{id:require('node:crypto').randomUUID(),status:'submitted',index:1,questionCount:1,questions:[q],responses:[response],grading:{status:'pending'}};
}
test('confirmed short speech completes the practice result with content credit and unchanged provider marks',()=>{
  const a=attempt(),before=structuredClone(a),r=report.summarize(a).azure,row=r.questions[0];
  assert.equal(r.status,'assessed');assert.equal(r.assessedCount,1);assert.equal(r.insufficientSpeechCount,1);
  assert.equal(row.status,'insufficient-speech');assert.equal(row.content,3);assert.equal(row.total,3);assert.equal(row.maximum,30);
  assert.equal(row.pronunciation,0);assert.equal(row.fluency,0);assert.equal(r.overallScore,18);
  assert.match(row.deliveryNote,/no delivery points/);assert.deepEqual(a,before);assert(!JSON.stringify(r).includes('PRIVATE_AUDIO'));
});
test('provider failures, stale recordings, missing evidence and transcription failures remain pending',()=>{
  for(const mutate of [r=>r.azure.status='unavailable',r=>r.azure.recordingHash='stale',r=>delete r.recording,
    r=>delete r.transcriptionStatus,r=>r.transcript='',r=>r.azure.deliveryEvidence.durationSeconds=0,
    r=>delete r.azure.deliveryEvidence.spokenWords,r=>r.azure.deliveryEvidence.spokenWords=2,
    r=>delete r.azure.pronunciation.raw,r=>r.azure.fluency.raw=101,
    r=>r.azure.deliveryFailureTraits=['fluency'],r=>r.azure.score_provisional=true]){
    const a=attempt();mutate(a.responses[0]);assert.equal(report.summarize(a).azure.status,'pending');
  }
  const a=attempt();a.responses[0].transcript=a.questions[0].text;
  a.responses[0].azure.deliveryEvidence={sufficient:false,durationSeconds:30,spokenWords:20};
  assert.equal(report.summarize(a).azure.status,'pending','A false insufficient flag cannot replace available speech.');
});
test('held short speech publishes without repeating providers or changing saved evidence',async t=>{
  const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
  const {createStore}=require('../writing-lab-store'),{createMockJobs,identity}=require('../speaking-mock-jobs'),{hash}=require('../scoring-jobs');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'short-response-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const store=createStore(null,directory,{table:'speaking_mock_attempts'}),a=attempt(),response=a.responses[0],q=a.questions[0];
  await store.update('learner',a.id,()=>({...a,responses:[{...response,azure:undefined}]}));
  const forbidden=async()=>{throw Error('No provider calls for confirmed short speech.');};
  const jobs=createMockJobs({directory,store,transcribe:forbidden,assessAzure:forbidden,callModel:forbidden});t.after(()=>jobs.stop());
  await jobs.jobs.enqueue({id:identity(a,0),owner:'learner',groupId:a.id,inputHash:hash({recording:response.recording.hash,question:q}),
    data:{index:0,recordingHash:response.recording.hash,questionHash:hash(q),patch:{...response,recording:undefined},stages:{azure:{status:'needs_attention',failure:'validation',attempts:3}}}});
  const claimed=await jobs.jobs.claim();await jobs.jobs.save(claimed,claimed.data,{status:'needs_attention'});
  await jobs.ensure('learner',await store.get('learner',a.id));await jobs.wait();
  const saved=await store.get('learner',a.id);
  assert.equal(saved.assessment.status,'ready');assert.equal(saved.grading.status,'complete');
  assert.deepEqual(saved.responses[0].recording,response.recording);assert.deepEqual(saved.responses[0].content,response.content);
  assert.deepEqual(saved.responses[0].azure,response.azure);assert.equal((await jobs.status('learner',saved)).ready,true);
  const before=structuredClone(saved);await jobs.ensure('learner',saved);assert.deepEqual(await store.get('learner',a.id),before);
  const shown=require('../speaking-mock').present(saved,Date.now(),{completeOnly:true});
  assert.equal(shown.resultsReady,true);assert.equal(shown.responses[0].deliveryOutcome.status,'insufficient-speech');
  assert.equal(shown.responses[0].providers.azure.pronunciation.score,null);
});
