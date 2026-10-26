'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const report=require('../speaking-mock-report'),bank=require('../content/speaking-mocks');
const delivery=(score=5)=>({status:'assessed',pronunciation:{status:'scored',score,maximum:5},fluency:{status:'scored',score,maximum:5}});
function attempt(){
  const questions=structuredClone(bank.papers[0].questions);
  return {id:crypto.randomUUID(),title:'Saved Speaking mock',status:'submitted',paperId:bank.papers[0].id,
    index:questions.length,startedAt:1,deadline:2,questionCount:27,questions,grading:{status:'complete'},
    responses:questions.map((q,i)=>({recording:{mime:'audio/webm',hash:'saved-'+i,data:'PRIVATE_AUDIO'},transcript:'Saved response.',
      content:{total:report.contentMaximum(q),maximum:report.contentMaximum(q),scoringMode:'ai'},gpt:delivery(),azure:delivery(4)}))};
}
test('Task weighting uses the published Speaking column, native maxima and every question',()=>{
  const a=attempt(),before=structuredClone(a),r=report.summarize(a);
  assert.deepEqual(r.weights,{ra:9,rs:16,di:31,rl:13,sgd:19,rts:13});
  assert.equal(r.openai.weightTotal,101);assert.equal(r.openai.overallScore,90);assert.equal(r.azure.overallScore,80);
  assert.equal(r.openai.questionCount,27);assert.equal(r.openai.assessedCount,27);assert.equal(r.openai.fullProfile,true);
  assert.deepEqual(r.openai.byType.map(g=>g.count),[6,10,5,2,2,2]);
  assert.equal(r.openai.byType.find(g=>g.type==='rs').maximum,130);
  assert.equal(r.openai.byType.find(g=>g.type==='di').maximum,80);
  assert.equal(r.calibration,'uncalibrated');assert.deepEqual(a,before);
  assert(!JSON.stringify(r).includes('PRIVATE_AUDIO'));assert(!JSON.stringify(r).includes('Saved response.'));
});
test('A fixed mixed-performance example combines C/P/F within types before applying their weights',()=>{
  const types=['ra','rs','di','rl','sgd','rts'],c=[2,1,3,4,5,6],p=[4,5,4,3,4,5],f=[3,4,4,4,3,4];
  const a={status:'submitted',index:6,questionCount:6,questions:types.map(type=>({type,text:'one two three four'})),
    responses:types.map((type,i)=>({recording:{hash:'saved'},content:{total:c[i],maximum:type==='ra'?4:type==='rs'?3:6,scoringMode:'ai'},
      gpt:{status:'assessed',pronunciation:{score:p[i]},fluency:{score:f[i]}}}))};
  const r=report.summarize(a);
  assert.equal(r.openai.overallScore,69);assert(Math.abs(r.openai.performancePercent-74.0405015776303)<1e-10);
  assert.equal(r.azure.overallScore,null);
});
test('Content zero gates all traits; fluent irrelevant answers and explicit skips cannot disappear',()=>{
  for(const type of Object.keys(report.WEIGHTS)){
    const a=attempt();for(const [i,q]of a.questions.entries())if(q.type===type)a.responses[i].content.total=0;
    const r=report.summarize(a).openai;
    assert.equal(r.overallScore,Math.round(10+80*(101-report.WEIGHTS[type])/101));
    for(const row of r.questions.filter(row=>row.type===type)){assert.equal(row.total,0);assert.equal(row.pronunciation,0);assert.equal(row.fluency,0);}
  }
  const a=attempt();a.responses=a.responses.map(()=>({skipped:true}));
  let r=report.summarize(a);assert.equal(r.openai.overallScore,10);assert.equal(r.azure.overallScore,10);assert.equal(r.openai.unansweredCount,27);
  const b=attempt();b.responses[7]={skipped:true};b.responses[8]={skipped:true};
  r=report.summarize(b);assert.equal(r.openai.overallScore,87);assert.equal(r.openai.unansweredCount,2);assert.equal(r.openai.byType.find(g=>g.type==='rs').maximum,130);
});
test('Pending, invalid, provisional and stale marks withhold only the affected provider, with full denominators',()=>{
  const mutations=[r=>delete r.azure.fluency,r=>r.azure.fluency.score=null,r=>r.azure.fluency.score=6,
    r=>r.azure.fluency.score=4.5,r=>r.azure.fluency.maximum=100,r=>r.azure.status='unavailable',
    r=>r.azure.recordingHash='wrong-audio',r=>r.azure.score_provisional=true,
    r=>r.azure.deliveryEvidence={sufficient:false}];
  for(const mutate of mutations){const a=attempt();mutate(a.responses[1]);const r=report.summarize(a);
    assert.equal(r.openai.overallScore,90);assert.equal(r.azure.overallScore,null);assert.equal(r.azure.assessedCount,26);
    assert.equal(r.azure.byType[0].count,6);assert.deepEqual(r.azure.missingQuestions.map(row=>row.index),[1]);
  }
  for(const mutate of [r=>delete r.content,r=>r.content.total=NaN,r=>r.content.total=-1,r=>r.content.total=.5,
    r=>r.content.maximum=999,r=>r.content.scoringMode='local',r=>r.content.score_provisional=true,r=>r.content.needs_semantic_review=true,
    r=>delete r.recording]){
    const a=attempt();mutate(a.responses[1]);const r=report.summarize(a);assert.equal(r.openai.overallScore,null);assert.equal(r.azure.overallScore,null);
  }
});
test('A timer-submitted unvisited question is zero, but unexplained holes in visited answers stay pending',()=>{
  const a=attempt();a.index=20;a.responses=a.responses.slice(0,20);const r=report.summarize(a).openai;
  assert.equal(r.assessedCount,27);assert.equal(r.unansweredCount,8);assert(r.overallScore<90);
  const b=attempt();delete b.responses[2];assert.equal(report.summarize(b).openai.overallScore,null);
  const c=attempt();c.status='active';assert.equal(report.summarize(c).openai.overallScore,null);
});
test('Task counts do not multiply their published weight, and unsupported or mismatched coverage cannot vanish',()=>{
  const a=attempt();for(const [i,q]of a.questions.entries())if(q.type==='rs')a.responses[i].content.total=1;
  const initial=report.summarize(a).openai;
  for(const [i,q]of [...a.questions].entries())if(q.type==='rs'){a.questions.push(structuredClone(q));a.responses.push(structuredClone(a.responses[i]));a.questionCount++;}
  assert.equal(report.summarize(a).openai.overallScore,initial.overallScore);
  const b=attempt();b.questions.push({type:'unknown'});b.responses.push({skipped:true});b.questionCount++;
  assert.equal(report.summarize(b).openai.overallScore,null);assert.equal(report.summarize(b).openai.supported,false);
  const c=attempt();c.questionCount++;assert.equal(report.summarize(c).openai.coverageValid,false);assert.equal(report.summarize(c).openai.overallScore,null);
  const d=attempt();d.questions=d.questions.filter(q=>q.type==='di');d.responses=d.questions.map(q=>({recording:{hash:'saved'},content:{total:6,maximum:6,scoringMode:'ai'},gpt:delivery()}));d.questionCount=5;
  const partial=report.summarize(d).openai;assert.equal(partial.overallScore,90);assert.equal(partial.fullProfile,false);assert.equal(partial.weightTotal,31);
});
test('Recording-matched instructor overrides are disclosed; stale overrides and global legacy caps are not applied',()=>{
  const a=attempt();a.overall={overallScore:10};a.combinedOverall={overallScore:10};delete a.responses[7].gpt;
  const override={score:5,maximum:5,source:'instructor_override',recordingHash:a.responses[7].recording.hash};
  a.responses[7].manualDeliveryOverrides={gpt:{pronunciation:override,fluency:override}};
  let r=report.summarize(a).openai;assert.equal(r.overallScore,90);assert.equal(r.manualOverrideCount,1);
  override.recordingHash='old-audio';r=report.summarize(a).openai;assert.equal(r.overallScore,null);assert.equal(r.manualOverrideCount,0);
});
test('Saved detail and history recalculate identically without paid calls, audio leakage or mark changes',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-weighted-')),app=require('express')();app.use(require('express').json());
  let calls=0;const forbidden=async()=>{calls++;throw Error('No grading on a saved report read.');};
  const lab=require('../speaking-mock').installSpeakingMock(app,{directory,verifyToken:token=>token==='alice'?'alice':null,getAccount:async()=>({}),
    gptAvailable:true,azureAvailable:true,callModel:forbidden,assessGpt:forbidden,assessAzure:forbidden,assessOverall:forbidden,assessAzureOverall:forbidden});
  const a=attempt();a.overall={status:'assessed',overallScore:10};a.combinedOverall={status:'assessed',overallScore:10};
  await lab.store.update('alice',a.id,()=>a);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await lab.waitForJobs();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port+'/api/speaking-mocks';
  const detail=await(await fetch(base+'/attempts/'+a.id,{headers:{'x-session-token':'alice'}})).json();
  const history=await(await fetch(base+'/attempts',{headers:{'x-session-token':'alice'}})).json();
  assert.equal(detail.speakingReport.openai.overallScore,90);assert.equal(detail.speakingReport.azure.overallScore,80);
  assert.deepEqual(history[0].speakingReport,detail.speakingReport);assert(!JSON.stringify(detail).includes('PRIVATE_AUDIO'));assert(!JSON.stringify(history).includes('PRIVATE_AUDIO'));
  assert.equal(calls,0);assert.deepEqual(await lab.store.get('alice',a.id),a);
  assert.equal((await fetch(base+'/attempts/'+a.id)).status,401);
});
test('Retry repairs a missing trait without erasing its verified companion, and content gates avoid further delivery calls',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-trait-retry-')),app=require('express')();app.use(require('express').json());
  let calls=0;const forbidden=async()=>{throw Error('Completed stages must not be repeated.');};
  const lab=require('../speaking-mock').installSpeakingMock(app,{directory,verifyToken:()=> 'alice',getAccount:async()=>({}),gptAvailable:true,azureAvailable:true,
    callModel:forbidden,transcribe:forbidden,assessAzure:forbidden,assessOverall:forbidden,assessAzureOverall:forbidden,
    assessGpt:async()=>{if(++calls===1)throw Error('Temporary provider failure');return {pronunciation:{score:null,status:'unassessed'},fluency:{score:4,status:'scored'}};}});
  const q=structuredClone(bank.papers[0].questions.find(q=>q.type==='rs')),id=crypto.randomUUID();
  await lab.store.update('alice',id,()=>({id,status:'submitted',index:1,questionCount:1,questions:[q],grading:{status:'complete'},
    responses:[{recording:{mime:'audio/webm',data:'PRIVATE_AUDIO',hash:'saved'},transcript:q.text,content:{total:3,maximum:3},
      gpt:{...delivery(),recordingHash:'saved',fluency:{score:null,status:'unassessed'}},azure:delivery(4)}]}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await lab.waitForJobs();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
  const url='http://127.0.0.1:'+server.address().port+'/api/speaking-mocks/attempts/'+id;
  const retry=async()=>{assert.equal((await fetch(url+'/retry',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,200);await lab.waitForJobs();return lab.store.get('alice',id);};
  let saved=await retry();assert.equal(saved.responses[0].gpt.pronunciation.score,5);assert.equal(report.summarize(saved).openai.overallScore,null);
  saved=await retry();assert.equal(saved.responses[0].gpt.pronunciation.score,5);assert.equal(saved.responses[0].gpt.fluency.score,4);
  assert.equal(report.summarize(saved).openai.overallScore,84);assert.equal(calls,2);
  await lab.store.update('alice',id,a=>{a.responses[0].content.total=0;delete a.responses[0].gpt;delete a.responses[0].azure;return a;});
  saved=await retry();assert.equal(calls,2);assert.equal(report.summarize(saved).openai.overallScore,10);assert.equal(report.summarize(saved).azure.overallScore,10);
});
