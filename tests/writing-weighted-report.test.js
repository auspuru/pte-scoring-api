'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const report = require('../public/writing-lab-report');
const { installWritingLab, present } = require('../writing-lab');
const context = {kind:'mock',module:'writing'};
function fixture() {
  const questions = [
    {id:'swt-1',type:'swt',title:'Summary one'}, {id:'swt-2',type:'swt',title:'Summary two'},
    {id:'essay',type:'essay',title:'Essay'}, {id:'sst',type:'sst',title:'Summary',text:'A source about technology.',sample:Array(56).fill('technology').join(' ')+'.'},
    {id:'wfd-1',type:'wfd',title:'Dictation one',text:'Classical mechanics is sometimes considered as a branch of applied mathematics.'},
    {id:'wfd-2',type:'wfd',title:'Dictation two',text:'Coursework gives students the chance to thoroughly explore the subject.'},
    {id:'wfd-3',type:'wfd',title:'Dictation three',text:'In my view the damaged car should be repaired as soon as possible.'}
  ];
  const results = [8,7,16,9,8,7,12].map((total,i)=>({total,maximum:report.maximumFor(questions[i])}));
  return {questions,results};
}
test('The discussed seven-question Writing example uses task weights and yields 69 rather than pooled 70',()=>{
  const {questions,results}=fixture(),before=structuredClone(results);
  const score=report.summarize(questions,results,context);
  assert.equal(score.score90,69);assert.equal(score.total,67);assert.equal(score.maximum,90);
  assert(Math.abs(score.weighting.performancePercent-74.17496229260935)<1e-10);
  assert.equal(score.weighting.fullProfile,true);assert.equal(score.weighting.weightTotal,100);
  assert.equal(score.weighting.calibration,'uncalibrated');assert.equal(score.weighting.version,report.WEIGHTING_VERSION);
  assert.deepEqual(score.byType.map(g=>[g.type,g.total,g.maximum,g.normalizedWeight]),[['swt',15,18,28],['essay',16,26,31],['sst',9,12,18],['wfd',27,34,23]]);
  assert.deepEqual(results,before);
});
test('Repeating a task with identical performance does not multiply its overall weight',()=>{
  const {questions,results}=fixture(),original=report.summarize(questions,results,context);
  const repeated=report.summarize([...questions,...questions.slice(4)],[...results,...results.slice(4)],context);
  assert.equal(repeated.score90,original.score90);assert.equal(repeated.weighting.performancePercent,original.weighting.performancePercent);
  assert.equal(repeated.byType.find(g=>g.type==='wfd').normalizedWeight,23);
});
test('Pending, provisional, invalid and zero answers keep every question in the denominator',()=>{
  const {questions,results}=fixture();
  for(const replacement of [null,{total:9,maximum:999},{total:NaN,maximum:12},{total:13,maximum:12},
    {...results[3],score_provisional:true},{...results[3],needs_semantic_review:true}]) {
    const changed=results.slice();changed[3]=replacement;const score=report.summarize(questions,changed,context);
    assert.equal(score.complete,false);assert.equal(score.score90,null);assert.equal(score.weighting.performancePercent,null);
    assert.equal(score.maximum,90);assert.equal(score.weighting.weightTotal,100);assert.equal(score.byType.find(g=>g.type==='sst').count,1);
  }
  const zero=results.map(r=>({...r,total:0,gated:true}));assert.equal(report.summarize(questions,zero,context).score90,10);
  const perfect=results.map(r=>({...r,total:r.maximum}));assert.equal(report.summarize(questions,perfect,context).score90,90);
  const unanswered=perfect.slice();unanswered[2]={total:0,maximum:26,gated:true};
  assert.equal(report.summarize(questions,unanswered,context).score90,65); // 31% essay remains zero.
});
test('Legacy mocks have explicit partial coverage and unsupported types cannot silently disappear',()=>{
  const {questions,results}=fixture();const legacy=report.summarize(questions.slice(0,3),results.slice(0,3),{kind:'mock'});
  assert.equal(legacy.complete,true);assert.equal(legacy.weighting.weightTotal,59);assert.equal(legacy.weighting.fullProfile,false);
  assert.deepEqual(legacy.weighting.missingTypes,['sst','wfd']);
  assert(Math.abs(legacy.weighting.performancePercent-100*(28*15/18+31*16/26)/59)<1e-10);
  const unsupported=report.summarize([...questions,{type:'hcs',maximum:1}],[...results,{total:1,maximum:1}],context);
  assert.equal(unsupported.weighting.supported,false);assert.equal(unsupported.score90,null);
  assert.equal(report.summarize([],[],context).score90,null);
});
test('Listening mocks and individual practice retain their current unweighted calculation',()=>{
  const {questions,results}=fixture();
  const listening=report.summarize(questions,results,{kind:'mock',module:'listening'});
  assert.equal(listening.score90,70);assert.equal(listening.weighting,undefined);
  const practice=report.summarize(questions,results,{kind:'sst',module:'writing'});
  assert.equal(practice.score90,70);assert.equal(practice.weighting,undefined);
});
test('Opening saved attempts updates detail and history without regrading or overwriting stored marks',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'writing-weighted-'));
  const app=express();app.use(express.json());let calls=0;
  const {store}=installWritingLab(app,{directory,verifyToken:token=>token==='tester'?'tester':null,getAccount:async()=>({}),
    callModel:async()=>{calls++;return {scores:{content:3,form:2,grammar:1,vocabulary:1,spelling:2},formInvalid:false,formReason:'',
      feedback:{content:'Relevant ideas.',form:'Valid length.',grammar:'Check agreement.',vocabulary:'Improve precision.',spelling:'Correct spelling.'},strengths:[],improvements:['Check sentence agreement.'],errors:[]};}});
  const {questions,results}=fixture();
  const attempt={...context,id:randomUUID(),title:'Saved writing mock',status:'submitted',startedAt:Date.now(),index:6,questions,results,
    answers:questions.map(q=>q.sample||'Saved answer.'),completed:questions.map(()=>({reason:'Submitted'})),deadline:null};
  await store.update('tester',attempt.id,()=>attempt);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port+'/api/writing-lab',headers={'x-session-token':'tester'};
  const detail=await (await fetch(base+'/attempts/'+attempt.id,{headers})).json();
  const history=await (await fetch(base+'/attempts',{headers})).json();
  assert.equal(detail.report.score90,69);assert.equal(history[0].score90,69);
  assert.deepEqual(history[0].weighting,detail.report.weighting);assert.equal(calls,0);
  assert.deepEqual((await store.get('tester',attempt.id)).results,results);
  // A provisional SST must be repairable, rather than permanently reused by
  // the score route while blocking the new overall calculation.
  const pending=await store.update('tester',attempt.id,a=>{a.results[3]={...a.results[3],score_provisional:true};return a;});
  assert.equal(present(pending).report.score90,null);
  const retry=await fetch(base+'/attempts/'+attempt.id+'/score/3',{method:'POST',headers});assert.equal(retry.status,200);
  const repaired=await retry.json();assert.notEqual(repaired.score_provisional,true);assert.equal(calls,1);
  const after=await (await fetch(base+'/attempts/'+attempt.id,{headers})).json();assert.equal(after.report.score90,69);
  await store.update('tester',attempt.id,a=>{a.results[4]={total:8,maximum:999};a.answers[4]=a.questions[4].text;return a;});
  const invalid=await fetch(base+'/attempts/'+attempt.id+'/score/4',{method:'POST',headers});assert.equal(invalid.status,200);
  const fixed=await invalid.json();assert.equal(fixed.maximum,11);assert.equal(fixed.total,11);assert.equal(calls,1);
  const unauthorized=await fetch(base+'/attempts/'+attempt.id);assert.equal(unauthorized.status,401);
});
