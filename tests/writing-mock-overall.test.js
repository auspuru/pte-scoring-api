'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const overall = require('../writing-mock-overall');
const { createStore } = require('../writing-lab-store');
const { installWritingLab, present } = require('../writing-lab');
const bank = require('../content/writing-lab.json');
function attempt() {
  const questions = structuredClone(bank.mocks[0].questions);
  return { id:randomUUID(), kind:'mock', module:'writing', title:'Saved mock', status:'submitted', questions,
    answers:questions.map(q => q.sample), results:questions.map(() => ({ total:0, feedback:'OLD FEEDBACK NEVER SENT' })),
    completed:questions.map(() => ({reason:'Submitted'})), deadline:null, index:6 };
}
function feedback(a) {
  return { summary:'Your ideas are relevant; improve accuracy across the summaries and essay.',
    strengths:[{ title:'Relevant ideas', advice:'You connect the source topic to the response.', questionIndices:[0] }],
    nextSteps:[{ title:'Check sentence control', advice:'Leave time to check sentence boundaries.', questionIndices:[0,2] }],
    coverage:Object.fromEntries(a.questions.map((q,i) => ['q'+i,{ observation:a.answers[i].trim()?'This response addresses the task.':'No answer was submitted.',
      status:a.answers[i].trim()?'reviewed':'unanswered', evidenceId:0 }])) };
}
async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'writing-overall-'));
  t.after(() => fs.rm(directory,{recursive:true,force:true}));
  return { directory, store:createStore(null,directory) };
}
test('Whole writing request includes all raw sources and answers, and excludes previous scores and samples', () => {
  const a=attempt();a.answers[5]='';
  const request=overall.request(a,'review-model'), prompt=JSON.parse(request.messages[0].content);
  assert.equal(prompt.questions.length,7);
  assert.equal(prompt.questions[5].answer,'');
  assert.equal(prompt.questions[2].source,a.questions[2].text);
  assert.deepEqual(prompt.questions[0].evidenceOptions.map(x=>x.quote),overall.excerpts(a.answers[0]));
  assert(!JSON.stringify(request).includes('OLD FEEDBACK NEVER SENT'));
  assert(!Object.hasOwn(prompt.questions[0],'sample'));
  assert.equal(request.tool_choice.name,overall.NAME);
  assert.equal(request.tools[0].input_schema.properties.coverage.required.length,7);
  assert.match(request.system,/untrusted evidence/);
});
test('Coverage validation rejects omitted questions, fabricated evidence, answered blanks and unsupported strengths', () => {
  const a=attempt();a.answers[5]='';
  const raw=feedback(a), result=overall.normalize(a,raw);
  assert.equal(result.questionCount,7);assert.equal(result.unansweredCount,1);
  assert.equal(result.coverage[5].status,'unanswered');assert.equal(result.coverage[5].quote,'');
  assert(a.answers[0].includes(result.coverage[0].quote));
  const omitted=structuredClone(raw);delete omitted.coverage.q6;assert.throws(()=>overall.normalize(a,omitted),/every question/);
  const invented=structuredClone(raw);invented.coverage.q0.evidenceId=999;assert.throws(()=>overall.normalize(a,invented),/evidence/);
  const blank=structuredClone(raw);blank.coverage.q5.status='reviewed';assert.throws(()=>overall.normalize(a,blank),/evidence/);
  const strength=structuredClone(raw);strength.strengths[0].questionIndices=[5];assert.throws(()=>overall.normalize(a,strength),/question reference/);
  const reference=structuredClone(raw);reference.nextSteps[0].questionIndices=[99];assert.throws(()=>overall.normalize(a,reference),/question reference/);
  assert.throws(()=>overall.response({stop_reason:'max_tokens',content:[]}),/Incomplete/);
});
test('Saved mock review is deduplicated, persists across reloads and is independent of individual scoring', async t => {
  const {store}=await setup(t), a=attempt();let calls=0,release;
  await store.update('tester',a.id,()=>a);
  const reviewer=overall.createReviewer({store,callModel:async current=>{calls++;await new Promise(r=>release=r);return feedback(current);}});
  const first=reviewer.ensure('tester',a), second=reviewer.ensure('tester',a);
  assert.equal(first,second);
  while(!release)await new Promise(r=>setImmediate(r));
  assert.equal(overall.view(await store.get('tester',a.id)).status,'processing');
  release();await first;
  const saved=await store.get('tester',a.id), view=present(saved).overallFeedback;
  assert.equal(view.status,'complete');assert.equal(view.coverage.length,7);assert.equal(view.fingerprint,undefined);
  assert.deepEqual(saved.results,a.results);
  await reviewer.ensure('tester',saved);assert.equal(calls,1);
  saved.results[0].total=8;assert.equal(overall.view(saved).status,'complete');
  saved.answers[0]+=' Changed answer.';assert.equal(overall.view(saved).status,'processing');
  saved.status='active';assert.equal(present(saved).overallFeedback,null);
});
test('All blank and legacy three-question mocks are fully accounted for without fabricated writing strengths', async t => {
  const {store}=await setup(t), a=attempt();a.questions=a.questions.slice(0,3);a.answers=['','',''];
  await store.update('tester',a.id,()=>a);
  const reviewer=overall.createReviewer({store,callModel:()=>{throw Error('Blank answers must not call model');}});
  const result=await reviewer.ensure('tester',a);
  assert.equal(result.status,'complete');assert.equal(result.questionCount,3);assert.equal(result.unansweredCount,3);
  assert.deepEqual(result.strengths,[]);assert(result.coverage.every(q=>q.status==='unanswered'));
  assert.equal(overall.eligible({...a,module:'listening'}),false);
  assert.equal(overall.eligible({...a,kind:'sst'}),false);
});
test('Failed providers stay unavailable without automatic paid retries; explicit retry can recover', async t => {
  const {store}=await setup(t),a=attempt();let calls=0;
  await store.update('tester',a.id,()=>a);
  const reviewer=overall.createReviewer({store,callModel:async current=>{if(++calls===1)throw Error('Provider unavailable');return feedback(current);}});
  await assert.rejects(reviewer.ensure('tester',a),/Provider/);
  let saved=await store.get('tester',a.id);assert.equal(present(saved).overallFeedback.status,'unavailable');
  await reviewer.ensure('tester',saved);assert.equal(calls,1);
  saved=await store.update('tester',a.id,value=>{value.overallFeedback.failedAt-=31000;return value;});
  assert.equal((await reviewer.ensure('tester',saved,{retry:true})).status,'complete');assert.equal(calls,2);
});
test('Cross-process leases prevent duplicate reviews and changed answers cannot receive stale feedback', async t => {
  const {store}=await setup(t),a=attempt();let release;
  await store.update('tester',a.id,()=>a);
  const first=overall.createReviewer({store,callModel:async current=>{await new Promise(r=>release=r);return feedback(current);}});
  const second=overall.createReviewer({store,callModel:()=>{throw Error('Duplicate provider call');}});
  const job=first.ensure('tester',a);while(!release)await new Promise(r=>setImmediate(r));
  assert.equal((await second.ensure('tester',a)).status,'processing');
  await store.update('tester',a.id,value=>{value.answers[0]='A different immutable response.';return value;});
  release();await job;
  assert.equal(present(await store.get('tester',a.id)).overallFeedback.status,'processing');
});
test('Opening an old submitted writing mock automatically saves a complete overview and protects access', async t => {
  const {directory}=await setup(t), app=express();app.use(express.json());let calls=0;
  const {store}=installWritingLab(app,{directory,verifyToken:token=>token==='tester'?'tester':null,getAccount:async()=>({}),
    overallGrader:async a=>{calls++;return feedback(a);}});
  const a=attempt();await store.update('tester',a.id,()=>a);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(()=>new Promise(r=>server.close(r)));
  const base='http://127.0.0.1:'+server.address().port+'/api/writing-lab/attempts/'+a.id,headers={'x-session-token':'tester'};
  assert.equal((await fetch(base)).status,401);
  assert.equal((await fetch(base,{headers})).status,200);
  let saved;for(let i=0;i<100;i++){saved=await store.get('tester',a.id);if(saved.overallFeedback?.status==='complete')break;await new Promise(r=>setTimeout(r,5));}
  assert.equal(saved.overallFeedback.status,'complete');assert.equal(calls,1);
  const reply=await (await fetch(base,{headers})).json();assert.equal(reply.overallFeedback.coverage.length,7);
  assert.equal(reply.overallFeedback.lease,undefined);
  const active=attempt();active.status='active';active.deadline=Date.now()+600000;
  await store.update('tester',active.id,()=>active);
  assert.equal((await fetch(base.replace(a.id,active.id)+'/overall-feedback',{method:'POST',headers})).status,409);
});
