'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto'),express=require('express');
const {installSpeakingLab}=require('../speaking-lab'),{createPromptNarrator}=require('../speaking-practice-prompts');
test('Speaking API persists distinct modes, defaults old clients to timed and authenticates saved RTS prompt audio',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-mode-')),app=express(),spoken=[];app.use(express.json());
 const audio=path.resolve(__dirname,'../content/speaking-audio/rs-1.mp3');
 const service=installSpeakingLab(app,{directory,verifyToken:token=>['alice','bob'].includes(token)?token:null,getAccount:async()=>({blocked:false}),transcriptionAvailable:false,deliveryAssessmentAvailable:false,azureComparisonAvailable:false,narratePrompt:async q=>{spoken.push(q.text);return audio;}});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(async()=>{await service.waitForAssessments();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port;
 async function request(route,body,user='alice'){const r=await fetch(base+'/api/speaking'+route,{method:body===undefined?'GET':'POST',headers:{'x-session-token':user,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json()};}
 const timed=await request('/attempts',{id:randomUUID(),questionId:'ra-1'});assert.equal(timed.data.practiceMode,'timed');
 const id=randomUUID(),untimed=await request('/attempts',{id,questionId:'rts-original-20261024-01',practiceMode:'untimed'});assert.equal(untimed.data.practiceMode,'untimed');assert.equal((await request('/attempts/'+id)).data.practiceMode,'untimed');
 assert.equal((await request('/attempts',{id,questionId:untimed.data.questionId,practiceMode:'timed'})).status,409);
 for(const practiceMode of ['exam',{},[],false])assert.equal((await request('/attempts',{id:randomUUID(),questionId:'ra-1',practiceMode})).status,400);
 const history=(await request('/attempts')).data;assert.equal(history.find(a=>a.id===id).practiceMode,'untimed');assert.equal(history.find(a=>a.id===timed.data.id).practiceMode,'timed');
 const route=untimed.data.question.audioUrl;assert(route.endsWith('/prompt'));assert.equal((await fetch(base+route)).status,401);assert.equal((await fetch(base+route,{headers:{'x-session-token':'bob'}})).status,404);assert.equal(spoken.length,0);
 const reply=await fetch(base+route,{headers:{'x-session-token':'alice'}});assert.equal(reply.status,200);assert.match(reply.headers.get('content-type'),/audio\/mpeg/);assert.equal(reply.headers.get('cache-control'),'no-store');assert(Buffer.from(await reply.arrayBuffer()).equals(await fs.readFile(audio)));assert.deepEqual(spoken,[untimed.data.question.text]);
 const oldText='A saved historical situation. What would you say to your lecturer?';await service.store.update('alice',id,a=>{a.questionSnapshot.text=oldText;return a;});await fetch(base+route,{headers:{'x-session-token':'alice'}});assert.equal(spoken.at(-1),oldText,'Narration must use the saved snapshot rather than a changed bank question');
});
test('RTS narration coalesces concurrent requests, reuses cached bytes and separates changed snapshots',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'rts-narration-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));let calls=0;
 const narrate=createPromptNarrator(directory,{render:async(text,file)=>{calls++;await new Promise(resolve=>setTimeout(resolve,10));await fs.writeFile(file,Buffer.alloc(1200,calls));}}),q={type:'rts',text:'Ask your tutor for help.'};
 const [a,b]=await Promise.all([narrate(q),narrate(q)]);assert.equal(a,b);assert.equal(calls,1);assert.equal(await narrate(q),a);assert.equal(calls,1);
 assert.notEqual(await narrate({...q,text:'Ask your lecturer for an extension.'}),a);assert.equal(calls,2);await assert.rejects(narrate({...q,type:'ra'}),/unavailable/);
});
test('Failed or empty RTS narration is never cached and can be retried',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'rts-narration-failure-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));let calls=0;
 const narrate=createPromptNarrator(directory,{render:async(text,file)=>{calls++;await fs.writeFile(file,Buffer.alloc(calls===1?10:1200));}}),q={type:'rts',text:'Tell your neighbour about the noise.'};
 await assert.rejects(narrate(q),error=>error.status===503);assert.deepEqual(await fs.readdir(directory),[]);assert(await narrate(q));assert.equal(calls,2);
});
