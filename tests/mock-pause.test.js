'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const full=require('../full-mock/session'),{loadPaper}=require('../full-mock/paper');
const speaking=require('../speaking-mock-pause');
const {pcmWav,wavSeconds}=require('../speaking-delivery');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),express=require('express');
const {installWritingLab,reconcile:reconcileWriting}=require('../writing-lab');

test('Full Mock pause freezes a recording and its section clock without sealing or changing a saved draft',()=>{
  const paper=loadPaper(),start=1000000,state=full.create(randomUUID(),paper,start,{preview:true});
  const token=state.current.token,originalEnd=state.current.endsAt;
  full.pause(state,paper,start+1000,{});
  assert.equal(full.phase(state,start+900000),'paused');
  full.reconcile(state,paper,start+900000);
  assert.equal(state.index,0);assert.equal(state.responses[0].sealed,false);
  assert.throws(()=>full.next(state,paper,{itemToken:token},start+900000),/paused/);
  full.resume(state,start+900000,state.pause.id);
  assert.equal(state.current.endsAt,originalEnd+899000);
  assert.equal(full.phase(state,start+900000),'preparing');
  full.reconcile(state,paper,state.current.endsAt+1);
  assert.equal(state.index,1);
});

test('A Full Mock answer sent with Pause wins over older queued saves and survives Continue',()=>{
  const paper=loadPaper(),state=full.create(randomUUID(),paper,1000000,{preview:true});
  while(full.item(paper,state.index).question.type!=='swt')full.next(state,paper,{itemToken:state.current.token,skip:true},state.current.enteredAt);
  const at=state.current.enteredAt,token=state.current.token;
  full.saveDraft(state,paper,{itemToken:token,sequence:2,answer:['Earlier']});
  full.pause(state,paper,at+1000,{draft:['Final answer'],sequence:3});
  full.saveDraft(state,paper,{itemToken:token,sequence:2,answer:['Earlier']});
  assert.throws(()=>full.saveDraft(state,paper,{itemToken:token,sequence:4,answer:['Changed while paused']}),/paused/);
  const id=state.pause.id;full.resume(state,at+500000,id);full.resume(state,at+500000,id);
  assert.deepEqual(state.responses[state.index].draft,['Final answer']);
  full.next(state,paper,{itemToken:token},at+500001);
  assert.deepEqual(state.responses.find(r=>r.token===token).answer,['Final answer']);
});

test('Speaking pause keeps a partial recording and continues with the same remaining time',async()=>{
  const at=1000000,a={status:'active',index:0,deadline:at+60000,questionStartedAt:at-5000,questions:[{audioSeconds:8}],responses:[{}]};
  speaking.pause(a,at,{hasPartial:true,audioPositionSeconds:2.5});
  assert.equal(a.deadline,null);assert.equal(a.pause.remainingMs,60000);
  assert.throws(()=>speaking.resume(a,at+900000,{pauseId:a.pause.id}),/Save the paused recording/);
  const pcm=Buffer.alloc(16000,1),fragment=pcmWav(pcm),final=pcmWav(Buffer.alloc(16000,2));
  speaking.saveFragment(a,0,a.pause.id,fragment,'audio/wav');
  const saved=await speaking.mergedRecording(a.responses[0].fragments,final,'audio/wav');
  assert.equal(saved.mime,'audio/wav');assert.equal(saved.fragmentCount,1);
  assert(wavSeconds(Buffer.from(saved.data,'base64'))>=0.9);
  const id=a.pause.id;speaking.resume(a,at+900000,{pauseId:id});speaking.resume(a,at+900000,{pauseId:id});
  assert.equal(a.deadline,at+960000);assert.deepEqual(a.resumedAudio,{index:0,positionSeconds:2.5,at:at+900000});
});

test('Writing Mock pause is owner-scoped, freezes the current question, and keeps its answer through Continue',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'writing-pause-')),app=express();app.use(express.json());
  const {store}=installWritingLab(app,{directory,verifyToken:value=>['alice','bob'].includes(value)?value:null,getAccount:async()=>({}),callModel:async()=>{throw Error('No grading expected');}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port+'/api/writing-lab';
  async function request(route,body,user='alice'){
    const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','x-session-token':user},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,value:await response.json()};
  }
  const id=randomUUID();await request('/attempts',{id,testId:'writing-mock-1'});
  const answer='A complete summary saved before pausing.';
  await request('/attempts/'+id+'/answer',{index:0,text:answer,revision:1});
  assert.equal((await request('/attempts/'+id+'/pause',{},'bob')).status,404);
  const first=(await request('/attempts/'+id+'/pause',{})).value;
  assert(first.pause);assert.equal(first.deadline,null);assert.equal(first.answers[0],answer);
  assert.equal((await request('/attempts/'+id+'/pause',{})).value.pause.id,first.pause.id);
  const paused=await store.update('alice',id,value=>reconcileWriting(value,Date.now()+3600000));
  assert.equal(paused.status,'active');assert.equal(paused.index,0);
  await request('/attempts/'+id+'/answer',{index:0,text:'Changed during pause',revision:2,next:true});
  assert.equal((await store.get('alice',id)).answers[0],answer);
  const resumed=(await request('/attempts/'+id+'/resume',{pauseId:first.pause.id})).value;
  assert.equal(resumed.pause,undefined);assert(resumed.deadline>Date.now());assert.equal(resumed.answers[0],answer);
  assert.equal((await request('/attempts/'+id+'/resume',{pauseId:first.pause.id})).value.index,0);
});
