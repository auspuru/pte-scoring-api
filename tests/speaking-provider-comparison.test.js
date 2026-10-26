'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const combined=require('../speaking-mock-combined'),{createStore}=require('../writing-lab-store'),{present}=require('../speaking-mock');
const quiet={info(){},warn(){}};
function attempt(){
 const a={id:crypto.randomUUID(),status:'submitted',startedAt:1,questionCount:6,questions:combined.TYPES.map((type,i)=>({id:'q'+i,type,text:'Travel costs increased.',facts:['Travel costs increased.']})),
  responses:combined.TYPES.map((_,i)=>({recording:{mime:'audio/webm',hash:'audio-'+i,data:'private-audio'},transcript:'Travel costs increased.',content:{total:5,maximum:6,scoringMode:'ai'},gpt:{pronunciation:{score:0}},azure:{pronunciation:{score:0}},manualDeliveryOverrides:{gpt:{fluency:{score:5}}}})),
  overall:{status:'assessed',overallScore:81,recordingCount:6,pronunciation:{score:4},fluency:{score:4}},grading:{status:'complete'}};
 const content={score:5,maximum:6,summary:'Generally effective task fulfilment.',strengths:['Connected meaning.'],nextSteps:['Retain useful support.'],coverage:combined.entries(a).map(r=>({index:r.index,type:r.type,outcome:'adequate',materialError:false,evidence:r.student,reason:'Relevant meaning.'}))};
 a.combinedOverall={...combined.combine(content,a.overall),questionCount:6,recordingCount:6,contentReviewedCount:6,sourceFingerprint:combined.fingerprint(a)};
 return a;
}
const native=()=>({status:'assessed',recordingCount:6,pronunciation:{score:5,maximum:5,raw:94.6},fluency:{score:5,maximum:5,raw:94.1}});
async function setup(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'provider-comparison-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return {mockStore:createStore(null,directory,{table:'speaking_mock_attempts'}),logger:quiet,operation:'provider-test'};}
test('Two overall estimates share confirmed content while using independent whole-provider delivery',()=>{
 const a=attempt();a.overallAzure=native();const c=combined.providerComparisons(a);
 assert.equal(c.status,'complete');assert.equal(c.openai.overallScore,75);assert.equal(c.azure.overallScore,85);
 assert.deepEqual(c.openai.content,c.azure.content);assert.deepEqual(c.openai.method.weights,c.azure.method.weights);
 assert.equal(c.openai.method.deliverySource,'independent-blind-whole-mock-audio');assert.equal(c.azure.method.deliverySource,'whole-mock-azure-acoustic-summary');
 assert.equal(c.azure.pronunciation.raw,94.6);assert.equal(c.openai.pronunciation.score,4);assert.equal(c.openai.method.questionMarksUsed,false);
});
test('Azure gaps never substitute OpenAI marks, and stale shared content cannot produce either comparison',()=>{
 const a=attempt();let c=combined.providerComparisons(a);assert.equal(c.openai.overallScore,75);assert.equal(c.azure.overallScore,null);
 a.overallAzure={...native(),recordingCount:5};c=combined.providerComparisons(a);assert.equal(c.azure.status,'unavailable');assert.equal(c.azure.overallScore,null);
 a.responses[0].transcript='A changed response.';assert.equal(combined.providerComparisons(a),null);
});
test('Pinned provider comparison reuses all content and OpenAI results and persists distinct Azure-based scores once',async t=>{
 const s=await setup(t),a=attempt(),before=structuredClone(a);await s.mockStore.update('mahabir1',a.id,()=>a);let calls=0;
 const options={...s,targets:[{username:'mahabir1',attemptId:a.id}],ensureDelivery:async request=>{
  calls++;assert.equal(request.provider,'azure');assert.equal(request.attemptId,a.id);
  await s.mockStore.update('mahabir1',a.id,current=>({...current,overallAzure:native()}));
 }};
 const [result]=await combined.recoverComparisons(options);assert.equal(result.status,'complete');assert.equal(result.openaiOverall,75);assert.equal(result.azureOverall,85);
 const saved=await s.mockStore.get('mahabir1',a.id);assert.deepEqual(saved.responses,before.responses);assert.deepEqual(saved.overall,before.overall);assert.deepEqual(saved.combinedOverall,before.combinedOverall);
 assert.equal(saved.combinedComparisons.azure.overallScore,85);assert.equal(present(saved).combinedComparisons.openai.overallScore,75);assert(!JSON.stringify(present(saved)).includes('private-audio'));
 await combined.recoverComparisons(options);assert.equal(calls,1);
 await assert.rejects(combined.recoverComparisons({...options,targets:[{username:'pppp',attemptId:a.id}]}));
});
test('An Azure failure keeps the confirmed OpenAI-based result and reports the actual missing provider',async t=>{
 const s=await setup(t),a=attempt();await s.mockStore.update('mahdis',a.id,()=>a);
 const [result]=await combined.recoverComparisons({...s,targets:[{username:'mahdis',attemptId:a.id}],ensureDelivery:async()=>{
  await s.mockStore.update('mahdis',a.id,current=>({...current,overallAzure:{status:'unavailable',failure:{code:'AZURE_TIMEOUT'}}}));
 }});
 assert.equal(result.status,'needs-review');assert.equal(result.openaiOverall,75);assert.equal(result.azureOverall,null);assert.equal(result.failure.azure.code,'AZURE_TIMEOUT');
 assert.equal((await s.mockStore.get('mahdis',a.id)).combinedOverall.overallScore,75);
});
test('A source edit during Azure recovery prevents stale provider comparison publication',async t=>{
 const s=await setup(t),a=attempt();await s.mockStore.update('mahdis',a.id,()=>a);
 const [result]=await combined.recoverComparisons({...s,targets:[{username:'mahdis',attemptId:a.id}],ensureDelivery:async()=>{
  await s.mockStore.update('mahdis',a.id,current=>{current.responses[0].transcript='Changed words.';current.overallAzure=native();return current;});
 }});
 assert.equal(result.status,'needs-review');assert.equal((await s.mockStore.get('mahdis',a.id)).combinedComparisons,undefined);
});
