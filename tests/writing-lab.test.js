'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const express=require('express');
const policy=require('../writing-lab-scoring');
const {installWritingLab,reconcile,present}=require('../writing-lab');
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
  const a={status:'active',questions:bank.mocks[0].questions,index:0,deadline:600000,completed:[null,null,null]};
  assert.equal(present(a).questions[1].text,undefined);assert.equal(present(a).questions[0].sample,undefined);
  reconcile(a,1200100);assert.equal(a.index,2);assert.equal(a.deadline,2400000);
  reconcile(a,2400001);assert.equal(a.status,'submitted');assert.equal(a.completed.filter(Boolean).length,3);
});
test('Original content has correct task counts, lengths and usable reference answers',()=>{
  assert.equal(bank.spoken.length,5);assert.equal(bank.mocks.length,2);
  for(const q of bank.spoken) {assert(policy.wordCount(q.text)>=175);assert.equal(policy.formFor('sst',q.sample).score,2);}
  for(const mock of bank.mocks) {
    assert.deepEqual(mock.questions.map(q=>q.type),['swt','swt','essay']);
    assert.equal(mock.questions.reduce((n,q)=>n+q.minutes,0),40);
    for(const q of mock.questions) assert.equal(policy.formFor(q.type,q.sample).score,policy.MAXIMA[q.type].form);
  }
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
  await store.update('alice',id,a=>{a.answers[0]='';a.deadline=Date.now()-2000000;return a;});
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
