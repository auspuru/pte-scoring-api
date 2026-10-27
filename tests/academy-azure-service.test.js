'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),express=require('express');
const {installAcademyAzure,VERSION}=require('../academy-azure-service'),{hash}=require('../scoring-jobs'),{pcmWav}=require('../speaking-delivery');
const native=()=>({deliveryProvider:'azure-speech-pronunciation',deliveryVersion:'azure-test',deliveryEvidence:{sufficient:true,durationSeconds:2},pronunciation:{score:4,maximum:5,raw:88},fluency:{score:3,maximum:5,raw:78}});
async function fixture(t,assess){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'academy-azure-')),app=express(),secret='t'.repeat(48);app.use(express.json({limit:'5mb'}));let time=1000,calls=0;
  const service=installAcademyAzure(app,{directory,secret,available:true,now:()=>time,assess:async(recording,options)=>{calls++;assert.equal(options.contentIndependent,true);assert.equal(options.question.type,'di');return assess?assess(recording,options,calls):native();}});await service.start();
  const server=app.listen(0);t.after(async()=>{await service.stop();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(directory,{recursive:true,force:true});});
  const bytes=pcmWav(Buffer.alloc(64000,7)),body={id:'a'.repeat(64),version:VERSION,recordingHash:hash(bytes),transcript:'A private description of the main chart features.',wav:bytes.toString('base64')},headers={Authorization:'Bearer '+secret,'Content-Type':'application/json'},base='http://127.0.0.1:'+server.address().port+'/internal/v1/academy-azure';
  return{service,body,headers,base,calls:()=>calls,advance:ms=>time+=ms,directory};}
test('the Academy bridge is authenticated, validates audio hashes and returns only native Azure delivery once',async t=>{
  const h=await fixture(t);assert.equal((await fetch(h.base+'/capabilities')).status,401);const cap=await(await fetch(h.base+'/capabilities',{headers:h.headers})).json();assert.equal(cap.provider,'azure');assert.equal(cap.ready,true);
  const submit=body=>fetch(h.base+'/jobs',{method:'POST',headers:h.headers,body:JSON.stringify(body)});assert.equal((await submit({...h.body,recordingHash:'0'.repeat(64)})).status,400);
  assert.equal((await submit(h.body)).status,202);await h.service.wait();assert.equal((await submit(h.body)).status,202);await h.service.wait();assert.equal(h.calls(),1);
  const result=await(await fetch(h.base+'/jobs/'+h.body.id,{headers:h.headers})).json();assert.equal(result.status,'ready');assert.equal(result.delivery.pronunciation.raw,88);assert.equal(result.delivery.fluency.score,3);assert(!JSON.stringify(result).includes(h.body.wav));assert(!JSON.stringify(result).includes(h.body.transcript));
  assert.equal((await submit({...h.body,transcript:'Different words.'})).status,409);assert.equal(h.calls(),1);
});
test('temporary Azure failures retain chunk checkpoints and retry only the same durable assessment',async t=>{
  const h=await fixture(t,async(_,options,calls)=>{if(calls===1){await options.checkpointChunk('saved-chunk',{transcript:'Saved',result:{accuracy:88,fluency:78}});throw Object.assign(Error('busy'),{providerStatus:429});}assert.equal(options.chunkCache['saved-chunk'].result.accuracy,88);return native();});
  await fetch(h.base+'/jobs',{method:'POST',headers:h.headers,body:JSON.stringify(h.body)});await h.service.wait();let result=await(await fetch(h.base+'/jobs/'+h.body.id,{headers:h.headers})).json();assert.equal(result.status,'retry_wait');h.advance(16000);await h.service.wait();result=await(await fetch(h.base+'/jobs/'+h.body.id,{headers:h.headers})).json();assert.equal(result.status,'ready');assert.equal(h.calls(),2);
});
test('a previously in-flight Azure request is held without another paid call',async t=>{
  const h=await fixture(t);await h.service.jobs.enqueue({id:h.body.id,owner:'visual-academy',groupId:h.body.id,inputHash:'prepared',data:{recordingHash:h.body.recordingHash,transcript:h.body.transcript,stages:{azure:{status:'calling',attempts:1}}}});await fs.writeFile(path.join(h.directory,'audio',h.body.id+'.wav'),Buffer.from(h.body.wav,'base64'));await h.service.wait();const row=await h.service.jobs.get('visual-academy',h.body.id);assert.equal(row.status,'needs_attention');assert.equal(row.data.stages.azure.failure,'uncertain_provider_outcome');assert.equal(h.calls(),0);
});
