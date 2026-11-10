'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createStore}=require('../writing-lab-store');
const {createRunner,OWNER,ATTEMPT,OPERATION}=require('../writing-lab-sst-reassessment');

async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sst-reassessment-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const store=createStore(null,directory),types=['swt','swt','essay','sst','wfd','wfd','wfd'],totals=[8,6.5,17,4,7,5,6];
  const questions=types.map((type,i)=>({type,id:i===3?'pred26-user-sst-03':'saved-'+i,
    text:type==='wfd'?Array(totals[i]).fill('word').join(' '):'Original saved source'}));
  const a={id:ATTEMPT,kind:'mock',module:'writing',status:'submitted',title:'Writing Prediction Mock 01',
    questions,answers:types.map((_,i)=>i===3?'a'.repeat(360):'Saved response'),completed:types.map(()=>({at:1000})),
    results:types.map((type,i)=>({total:totals[i],maximum:type==='essay'?26:type==='sst'?12:type==='swt'?9:totals[i]})),
    overallFeedback:{status:'complete',result:{summary:'Prior review'}},
    sstReassessment:{status:'queued',operation:OPERATION}};
  await store.update(OWNER,ATTEMPT,()=>a);
  return {store,a};
}
const revised=()=>({total:6,maximum:12,scores:{content:2,form:2,grammar:1,vocabulary:1,spelling:0},feedback:{content:'New review'}});

test('Only Sukhpal’s saved SST is replaced after a confirmed review; the operation is idempotent',async t=>{
  const {store,a}=await fixture(t);let calls=0,feedbackRefreshes=0;
  const runner=createRunner({store,score:async()=>{calls++;return revised();},
    onComplete:async(uid,attempt)=>{assert.equal(uid,OWNER);assert.equal(attempt.results[3].total,6);feedbackRefreshes++;}});
  await Promise.all([runner.run(OWNER,ATTEMPT),runner.run(OWNER,ATTEMPT)]);
  const after=await store.get(OWNER,ATTEMPT);
  assert.equal(calls,1);assert.equal(feedbackRefreshes,1);assert.equal(after.sstReassessment.status,'complete');assert.equal(after.results[3].total,6);
  assert.equal(after.results[3].scoringProvider,'anthropic');
  assert.deepEqual(after.results.filter((_,i)=>i!==3),a.results.filter((_,i)=>i!==3));
  assert.deepEqual(after.answers,a.answers);assert.deepEqual(after.questions,a.questions);
  assert.deepEqual(after.sstReassessmentHistory[0].oldResult,a.results[3]);
  await runner.run(OWNER,ATTEMPT);assert.equal(calls,1);
  assert.equal(await runner.run('other-student',ATTEMPT),null);
});

test('A failed or provisional review retains every published mark',async t=>{
  const {store,a}=await fixture(t);
  const runner=createRunner({store,score:async()=>({...revised(),score_provisional:true})});
  await runner.run(OWNER,ATTEMPT);
  const after=await store.get(OWNER,ATTEMPT);
  assert.equal(after.sstReassessment.status,'needs-review');
  assert.deepEqual(after.results,a.results);assert.equal(after.sstReassessmentHistory,undefined);
});

test('Changed saved input prevents a late review from replacing the original score',async t=>{
  const {store,a}=await fixture(t);let release,started;
  const began=new Promise(resolve=>{started=resolve;});
  const runner=createRunner({store,score:async()=>{started();return new Promise(resolve=>{release=resolve;});}});
  const job=runner.run(OWNER,ATTEMPT);await began;
  await store.update(OWNER,ATTEMPT,value=>{value.answers[3]='changed'+value.answers[3];return value;});
  release(revised());await job;
  const after=await store.get(OWNER,ATTEMPT);
  assert.equal(after.sstReassessment.status,'needs-review');
  assert.deepEqual(after.results,a.results);assert.equal(after.sstReassessmentHistory,undefined);
});
