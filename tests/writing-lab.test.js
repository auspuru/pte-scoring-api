'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const express=require('express');
const policy=require('../writing-lab-scoring');
const {installWritingLab,reconcile,present,advance}=require('../writing-lab');
const report=require('../public/writing-lab-report');
const {createStore}=require('../writing-lab-store');
const {createNarration}=require('../writing-lab-audio');
const bank=require('../content/writing-lab.json');
const sentence=n=>Array(n).fill('word').join(' ')+'.';
test('Published form boundaries and SWT sentence structure',()=>{
  for(const [type,bounds] of Object.entries({sst:[[39,0],[40,1],[49,1],[50,2],[70,2],[71,1],[100,1],[101,0]],essay:[[119,0],[120,1],[199,1],[200,2],[300,2],[301,1],[380,1],[381,0]],swt:[[4,0],[5,1],[75,1],[76,0]]})) {
    for(const [n,score] of bounds) assert.equal(policy.formFor(type,sentence(n)).score,score,type+' '+n);
  }
  assert.equal(policy.formFor('swt','Cities need trees because they provide shade; planners must maintain them carefully.').score,1);
  assert.equal(policy.formFor('swt','Cities need trees. Planners should care for them.').score,0);
  assert.equal(policy.sentenceCount('Dr. Lee suggests that U.S. cities need 2.5 times more trees; suitable care is essential.'),1);
  assert.equal(policy.formFor('sst',sentence(60).toUpperCase()).score,0);
  assert.equal(policy.formFor('essay',sentence(220).replace('.','')).score,0);
});
test('Zero-form answers never call the model or receive invented marks',async()=>{
  const r=await policy.grade(bank.mocks[0].questions[0],'',()=>{throw Error('Must not call model');});
  assert.equal(r.total,0);assert.equal(r.maximum,9);assert.equal(r.gated,true);
});
test('Scoring rejects malformed traits and fabricated error evidence, gates off-topic answers',()=>{
  const q=bank.spoken[0],text=q.sample;
  const raw={scores:{content:4,form:2,grammar:2,vocabulary:2,spelling:2},formInvalid:false,formReason:'',
    feedback:Object.fromEntries(Object.keys(policy.MAXIMA.sst).map(k=>[k,'Clear and appropriate.'])),strengths:['Relevant summary'],improvements:[],errors:[]};
  assert.equal(policy.normalize(q,text,raw).total,12);
  assert.throws(()=>policy.normalize(q,text,{...raw,scores:{...raw.scores,content:5}}));
  assert.throws(()=>policy.normalize(q,text,{...raw,errors:[{phrase:'invented quotation',correction:'...',explanation:'...'}]}));
  assert.equal(policy.normalize(q,text,{...raw,scores:{...raw.scores,content:0},improvements:['Answer the lecture topic.']}).total,0);
});
test('Elapsed clocks do not reset on refresh, and future prompts/samples stay hidden',()=>{
  const a={status:'active',questions:bank.mocks[0].questions.slice(0,3),index:0,deadline:600000,completed:[null,null,null]};
  assert.equal(present(a).questions[1].text,undefined);assert.equal(present(a).questions[0].sample,undefined);
  reconcile(a,1200100);assert.equal(a.index,2);assert.equal(a.deadline,2400000);
  reconcile(a,2400001);assert.equal(a.status,'submitted');assert.equal(a.completed.filter(Boolean).length,3);
});
test('Original content has correct task counts, lengths and usable reference answers',()=>{
  assert.equal(bank.spoken.length,5);assert.equal(bank.mocks.length,2);
  for(const q of bank.spoken) {assert(policy.wordCount(q.text)>=175);assert.equal(policy.formFor('sst',q.sample).score,2);}
  for(const mock of bank.mocks) {
    assert.deepEqual(mock.questions.map(q=>q.type),['swt','swt','essay','sst','wfd','wfd','wfd']);
    assert.equal(report.minutesFor(mock.questions),54);
    for(const q of mock.questions) {
      if(q.type==='wfd') { assert.equal(policy.gradeDictation(q,q.sample).total,report.maximumFor(q)); continue; }
      assert.equal(policy.formFor(q.type,q.sample).score,policy.MAXIMA[q.type].form);
      if(q.type==='sst') assert(policy.wordCount(q.text)>=175);
    }
  }
  assert.equal(bank.mocks[0].questions[2].text,"Age restrictions are placed on many activities. It is believed that people should not do things until they reach the right ages, such as getting married, driving, voting, buying certain products, and doing particular things. Give an example, state which minimum age you think it should be and share your own experience.");
  assert.equal(bank.mocks[1].questions[2].text,"Some universities deduct marks from students' work if it is given in late. What is your opinion? Suggest some alternative actions.");
});
test('Authenticated attempts persist, isolate users and lock submitted answers',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'writing-lab-test-'));
  const app=express();app.use(express.json());
  const {store}=installWritingLab(app,{directory:dir,verifyToken:x=>['alice','bob','blocked'].includes(x)?x:null,
    getAccount:async uid=>({blocked:uid==='blocked'}),callModel:async()=>{throw Error('Not used');}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port+'/api/writing-lab';
  async function request(route,body,user='alice') {const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','x-session-token':user},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
  const id=randomUUID();
  assert.equal((await request('/attempts',{id,testId:'writing-mock-1'},'')).status,401);
  assert.equal((await request('/attempts',undefined,'blocked')).status,401);
  const start=(await request('/attempts',{id,testId:'writing-mock-1'})).body;
  assert.equal(start.index,0);assert.equal(start.questions[1].text,undefined);
  assert.equal((await request('/attempts/'+id,undefined,'bob')).status,404);
  assert.equal((await request('/attempts/'+id+'/score/0',{})).status,409);
  const answer={index:0,text:'Cities need sustainable planning; public services make them accessible.',revision:1,next:true};
  const first=(await request('/attempts/'+id+'/answer',answer)).body;
  assert.equal(first.index,1);
  assert.equal((await request('/attempts/'+id+'/answer',answer)).body.index,1);
  assert.equal((await request('/attempts/'+id+'/answer',{...answer,text:'Changed answer',revision:3})).body.answers[0],answer.text);
  await store.update('alice',id,a=>{a.answers[0]='';a.deadline=Date.now()-4000000;return a;});
  const done=(await request('/attempts/'+id)).body;assert.equal(done.status,'submitted');
  const grade=(await request('/attempts/'+id+'/score/0',{})).body;assert.equal(grade.total,0);
  const restarted=createStore(null,dir);assert.equal((await restarted.list('alice'))[0].results[0].total,0);
  assert.equal((await restarted.list('bob')).length,0);
});
test('Narration accepts only bank IDs, shares concurrent generation and survives restart',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'writing-audio-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  let calls=0;const audio=createNarration(dir,async data=>{calls++;assert.equal(data.input,bank.spoken[0].text);return Buffer.alloc(2000,7);});
  const [a,b]=await Promise.all([audio.get(bank.spoken[0].id),audio.get(bank.spoken[0].id)]);assert.equal(a,b);assert.equal(calls,1);
  assert.equal(await createNarration(dir,()=>{throw Error('Should use cache');}).get(bank.spoken[0].id),a);
  await assert.rejects(audio.get('../../private'));
});

test('Dictation awards exact spelling in sequence without shifted, repeated or extra-word credit',async()=>{
  const q={type:'wfd',text:'The library is open to the public.'};
  const grade=text=>policy.gradeDictation(q,text);
  assert.equal((await policy.grade(q,'THE LIBRARY IS OPEN TO THE PUBLIC!',()=>{throw Error('No AI for dictation');})).total,7);
  assert.equal(grade('The library is open to public.').total,6);
  assert.equal(grade('The library is openn to the public.').total,6);
  assert.equal(grade('The library is open to the public tomorrow.').total,7);
  assert.equal(grade('the the the the').total,2);
  assert.equal(grade('').total,0);
  assert.equal(grade('public the to open is library the').total,3);
  assert.deepEqual(grade('The library is openn to the public.').wordFeedback.filter(x=>!x.correct).map(x=>x.word),['open']);
});

test('Scores out of 90 use complete marks and retain old three-question attempts',()=>{
  const questions=bank.mocks[0].questions;
  const full=questions.map(q=>({total:report.maximumFor(q),maximum:report.maximumFor(q)}));
  assert.equal(report.summarize(questions,full).score90,90);
  assert.deepEqual(report.summarize(questions,full).byType.map(g=>g.type),['swt','essay','sst','wfd']);
  assert.equal(report.summarize(questions,full.map(r=>({...r,total:0}))).score90,10);
  assert.equal(report.score90(5,10),50);
  assert.equal(report.score90(10,9),null);
  assert.equal(report.summarize(questions,full.slice(0,-1)).score90,null);
  assert.equal(report.summarize(questions,full.map((r,i)=>i===6?{...r,maximum:999}:r)).score90,null);
  const legacy=questions.slice(0,3), results=full.slice(0,3);
  assert.equal(report.summarize(legacy,results).maximum,44);
  assert.equal(report.summarize(legacy,results).score90,90);
  assert.equal(report.minutesFor(legacy),40);
});

test('SST transcripts stay hidden and three dictations share one clock through Next and expiry',()=>{
  const a={status:'active',questions:bank.mocks[0].questions,index:3,deadline:600000,completed:Array(7).fill(null)};
  assert.equal(present(a).questions[3].text,'');
  assert.equal(present(a).questions[3].sample,undefined);
  assert.equal(present(a).questions[4].audioUrl,undefined);
  advance(a,100000,'Submitted');
  assert.equal(a.index,4);assert.equal(a.deadline,340000);
  assert.equal(present(a).questions[4].text,'');
  assert.match(present(a).questions[4].audioUrl,/wm1-wfd1/);
  advance(a,120000,'Submitted');
  assert.equal(a.index,5);assert.equal(a.deadline,340000);
  reconcile(a,340001);
  assert.equal(a.status,'submitted');assert.equal(a.finishedAt,340000);
  assert.equal(a.completed[5].at,a.completed[6].at);
  assert.equal(present(a).questions[4].text,bank.mocks[0].questions[4].text);
});

test('Integrated recordings resolve distinct original narration for both mocks',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mock-narration-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const inputs=[];
  const narration=createNarration(dir,async input=>{inputs.push(input.input);return Buffer.alloc(2000,7);});
  const questions=bank.mocks.flatMap(m=>m.questions.filter(q=>['sst','wfd'].includes(q.type)));
  const files=[];
  for(const q of questions) files.push(await narration.get(q.id));
  assert.equal(new Set(files).size,8);assert.equal(new Set(inputs).size,8);
  assert.deepEqual(inputs,questions.map(q=>q.text));
  await assert.rejects(narration.get('wm1-swt1'));
});

test('Seven-question API saves separate playback and returns scores and history out of 90',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mock-api-test-'));
  const app=express();app.use(express.json());
  const {store}=installWritingLab(app,{directory:dir,verifyToken:x=>x==='tester'?'tester':null,getAccount:async()=>({}),callModel:async()=>{throw Error('Not required');}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port+'/api/writing-lab';
  async function request(route,body) {
    const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','x-session-token':'tester'},body:body===undefined?undefined:JSON.stringify(body)});
    assert.equal(response.status,200);return response.json();
  }
  const catalog=await request('/catalog');assert.equal(catalog.mocks[0].questionCount,7);assert.equal(catalog.mocks[0].minutes,54);
  const id=randomUUID();
  const started=await request('/attempts',{id,testId:'writing-mock-1'});assert.equal(started.questions.length,7);
  for(let index=0;index<3;index++) await request('/attempts/'+id+'/answer',{index,text:'',revision:1,next:true});
  await store.update('tester',id,a=>{a.playback[3]={position:0,finished:true};return a;});
  let a=await request('/attempts/'+id+'/answer',{index:3,text:'',revision:1,playback:{position:0,finished:false}});
  assert.deepEqual(a.playback[3],{position:0,finished:false});
  a=await request('/attempts/'+id+'/answer',{index:3,text:'',revision:2,playback:{position:70,finished:true}});
  a=await request('/attempts/'+id+'/answer',{index:3,text:'',revision:3,next:true,playback:{position:0,finished:false}});
  assert.deepEqual(a.playback[3],{position:70,finished:true});assert.equal(a.playback[4],null);
  const deadline=a.deadline;
  for(let index=4;index<7;index++) {
    const q=bank.mocks[0].questions[index];
    a=await request('/attempts/'+id+'/answer',{index,text:q.text,revision:1,next:true,playback:{position:4,finished:true}});
    if(index<6) assert.equal(a.deadline,deadline);
  }
  assert.equal(a.status,'submitted');assert.equal(a.report.score90,null);
  for(let index=0;index<7;index++) await request('/attempts/'+id+'/score/'+index,{});
  const finished=await request('/attempts/'+id), history=await request('/attempts');
  assert.equal(finished.report.complete,true);
  assert.equal(finished.report.byType.find(g=>g.type==='wfd').score90,90);
  assert.equal(history[0].score90,finished.report.score90);
  assert.equal(history[0].maximum,finished.report.maximum);
  assert.equal((await createStore(null,dir).list('tester'))[0].results[6].total,report.maximumFor(bank.mocks[0].questions[6]));
  // Existing snapshots are never extended by the new catalogue.
  const oldId=randomUUID();
  await store.update('tester',oldId,()=>({...started,id:oldId,status:'active',questions:bank.mocks[0].questions.slice(0,3),completed:[null,null,null],results:[null,null,null],deadline:Date.now()+600000}));
  assert.equal((await request('/attempts/'+oldId)).questions.length,3);
});
