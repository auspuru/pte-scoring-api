'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const manual=require('../speaking-manual-delivery'),{createStore}=require('../writing-lab-store');
const uid='mahabir1',id=()=>crypto.randomUUID();
const recording=n=>({hash:'recording-'+n,mime:'audio/webm',data:Buffer.alloc(200,n).toString('base64')});
async function fixture(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'manual-rs-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const store=createStore(null,directory,{table:'speaking_mock_attempts'}),attemptId=id();
 const data={id:attemptId,status:'submitted',questions:[{id:'intro',type:'intro'},{id:'ra',type:'ra'},{id:'rs-1',type:'rs'},{id:'rs-2',type:'rs'},{id:'rs-3',type:'rs'},{id:'di',type:'di'}],
   overall:{status:'assessed',overallScore:75,pronunciation:{score:4},fluency:{score:4}},grading:{status:'complete'},responses:[null,
     {recording:recording(1),content:{total:1},gpt:{status:'unavailable'}},
     {recording:recording(2),transcript:'Saved words.',content:{total:1},gpt:{status:'assessed',pronunciation:{score:4},fluency:{score:null,status:'unassessed'}},azure:{status:'unavailable'}},
     {recording:recording(3),content:{total:1},gpt:{status:'assessed',pronunciation:{score:0},fluency:{score:5}},azure:{status:'assessed',pronunciation:{score:2},fluency:{score:'3'}}},
     {skipped:true,gpt:{status:'unavailable'}},{recording:recording(5),content:{total:3},gpt:{status:'unavailable'}}]};
 await store.update(uid,attemptId,()=>structuredClone(data));return {directory,store,attemptId,data,options:{username:uid,attemptId,operation:'manual-rs-test',mockStore:store,logger:{info(){}}}};
}
test('Manual full marks fill only missing RS traits and preserve recordings, existing zeroes, content and overall',async t=>{
 const h=await fixture(t),report=await manual.fillMissingRepeatSentence(h.options),saved=await h.store.get(uid,h.attemptId);
 assert.equal(report.updatedTraits,3);assert.equal(report.updatedQuestions,1);assert.equal(report.remainingMissing,0);assert.equal(report.status,'complete');assert.equal(report.overallScore,75);
 assert.deepEqual(saved.overall,h.data.overall);assert.deepEqual(saved.responses[2].recording,h.data.responses[2].recording);
 for(const provider of ['gpt','azure'])assert.deepEqual(saved.responses[2][provider],h.data.responses[2][provider]);
 assert.deepEqual(saved.responses[2].content,h.data.responses[2].content);
 for(const index of [0,1,3,4,5])assert.deepEqual(saved.responses[index],h.data.responses[index]);
 const gpt=manual.effective(saved.responses[2],'gpt');assert.equal(gpt.pronunciation.score,4);assert.equal(gpt.fluency.score,5);assert.equal(gpt.fluency.source,'instructor_override');assert.equal(gpt.fluency.manualOverride,true);assert.equal(gpt.status,'mixed');
 const azure=manual.effective(saved.responses[2],'azure');assert.equal(azure.status,'manual');assert.equal(azure.pronunciation.score,5);assert.equal(azure.fluency.score,5);
 assert.deepEqual(saved.responses[2].manualDeliveryOverrides.gpt.fluency.previousTrait,{score:null,status:'unassessed'});
 assert.equal(gpt.fluency.previousTrait,undefined,'Internal audit state stays in storage.');
});
test('Manual operations are idempotent and bound to the authorized user, submitted attempt and exact recording',async t=>{
 const h=await fixture(t);await manual.fillMissingRepeatSentence(h.options);const before=await h.store.get(uid,h.attemptId);
 await manual.fillMissingRepeatSentence(h.options);assert.deepEqual(await h.store.get(uid,h.attemptId),before);
 const changed=structuredClone(before.responses[2]);changed.recording.hash='different-recording';assert.equal(manual.effective(changed,'azure').pronunciation,undefined);
 await assert.rejects(manual.fillMissingRepeatSentence({...h.options,username:'another-user'}),/Invalid manual/);
 const active=id();await h.store.update(uid,active,()=>({id:active,status:'active'}));await assert.rejects(manual.fillMissingRepeatSentence({...h.options,attemptId:active}),/submitted mock/);
});
test('Other student attempts are never edited by a pinned manual operation',async t=>{
 const h=await fixture(t),other=id(),otherData={...structuredClone(h.data),id:other};await h.store.update('pppp',other,()=>otherData);
 await manual.fillMissingRepeatSentence(h.options);assert.deepEqual(await h.store.get('pppp',other),otherData);
});
test('A later retry reuses manual RS delivery marks without calling either audio provider',async t=>{
 const express=require('express'),{installSpeakingMock}=require('../speaking-mock'),directory=await fs.mkdtemp(path.join(os.tmpdir(),'manual-rs-retry-')),app=express();app.use(express.json());let calls=0;
 const lab=installSpeakingMock(app,{directory,verifyToken:()=>uid,getAccount:async()=>({}),gptAvailable:true,azureAvailable:true,
   assessGpt:async()=>{calls++;throw Error('No GPT reassessment.');},assessAzure:async()=>{calls++;throw Error('No Azure reassessment.');},assessOverall:async()=>{throw Error('Keep the overall.');},transcribe:async()=>{throw Error('Keep the transcript.');},callModel:async()=>{throw Error('Keep content.');}});
 const attemptId=id(),q=require('../content/speaking-mocks').papers[0].questions.find(q=>q.type==='rs');
 await lab.store.update(uid,attemptId,()=>({id:attemptId,status:'submitted',questions:[q],responses:[{recording:recording(1),transcript:q.text,content:{total:1,maximum:1,scoringMode:'ai'},gpt:{status:'unavailable'},azure:{status:'unavailable'}}],index:1,questionCount:1,overall:{status:'assessed',overallScore:75},grading:{status:'complete'}}));
 await manual.fillMissingRepeatSentence({username:uid,attemptId,operation:'manual-before-retry',mockStore:lab.store,logger:{info(){}}});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(async()=>{await lab.waitForJobs();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port+'/api/speaking-mocks/attempts/'+attemptId;
 await fetch(base+'/retry',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});await lab.waitForJobs();const shown=await(await fetch(base)).json();
 assert.equal(calls,0);assert.equal(shown.overall,null);assert.equal(shown.responses[0].providers.gpt,undefined);assert.equal((await lab.store.get(uid,attemptId)).overall.overallScore,75);assert.equal(shown.responses[0].providers.azure.fluency.manualOverride,true);
});
