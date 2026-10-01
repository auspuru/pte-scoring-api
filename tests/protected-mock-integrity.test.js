'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const express=require('express');
const {installWritingLab}=require('../writing-lab');
const {createStore}=require('../writing-lab-store');
const predictions=require('../content/writing-predictions-sep-2026');

test('Mock interruption records are authenticated, append-only, deduplicated and independent of answers and scores',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'protected-mock-'));
  const app=express();app.use(express.json());
  const {store}=installWritingLab(app,{directory,verifyToken:token=>['alice','bob'].includes(token)?token:null,getAccount:async()=>({}),callModel:async()=>{throw Error('No grading needed');}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port+'/api/writing-lab';
  async function request(route,body,user='alice') {
    const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','x-session-token':user},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  }
  const id=randomUUID(),route='/attempts/'+id+'/integrity';
  const initial=(await request('/attempts',{id,testId:'writing-mock-1'})).body;
  assert.deepEqual(initial.integrity,{protected:true,events:[]});
  const event={id:randomUUID(),reason:'window-blur',at:Date.now()};
  assert.equal((await request(route,{events:[event]},'')).status,401);
  assert.equal((await request(route,{events:[event]},'bob')).status,404);
  assert.equal((await request(route,{events:[{...event,reason:'invented'}]})).status,400);
  assert.equal((await request(route,{events:Array(21).fill(event)})).status,400);
  const first=await request(route,{events:[event],answers:['Injected'],status:'submitted',results:[{total:90}]});
  assert.equal(first.status,200);assert.equal(first.body.events.length,1);assert(Number.isSafeInteger(first.body.events[0].receivedAt));
  const duplicate=await request(route,{events:[{...event,reason:'tab-hidden',at:1}]});
  assert.deepEqual(duplicate.body.events,first.body.events);
  await Promise.all(['tab-hidden','fullscreen-exit'].map(reason=>request(route,{events:[{id:randomUUID(),reason,at:Date.now()}]})));
  await request('/attempts/'+id+'/answer',{index:0,text:'My saved response.',revision:1,next:false,integrity:{protected:false,events:[]}});
  const saved=(await store.list('alice')).find(attempt=>attempt.id===id);
  assert.equal(saved.integrity.events.length,3);assert.equal(saved.status,'active');assert.equal(saved.answers[0],'My saved response.');assert(saved.results.every(result=>result===null));assert.equal(saved.deadline,initial.deadline);
  const reloaded=(await createStore(null,directory).list('alice')).find(attempt=>attempt.id===id);assert.deepEqual(reloaded.integrity,saved.integrity);
  const history=(await request('/attempts')).body;assert.equal(history.find(a=>a.id===id).integrity.events.length,3);
  const practiceId=randomUUID();await request('/attempts',{id:practiceId,testId:predictions.sst[0].id});
  assert.equal((await request('/attempts/'+practiceId+'/integrity',{events:[event]})).status,409);
});
