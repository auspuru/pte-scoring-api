'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const whole=require('../speaking-mock-azure'),azure=require('../speaking-delivery'),bank=require('../content/speaking-mocks'),{installSpeakingMock}=require('../speaking-mock');
function wav(seconds=8,sound=true){const b=Buffer.alloc(44+32000*seconds);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);if(sound)for(let i=44;i<b.length;i+=2)b.writeInt16LE(100,i);return b;}

test('Azure whole-mock summary weights fresh acoustic audio measurements, not question marks',()=>{
 const result=whole.summarize([{accuracy:90,fluency:95,seconds:10},{accuracy:80,fluency:90,seconds:30}],{recordingCount:2,expectedCount:2,assessedRecordings:2,audioSeconds:45});
 assert.equal(result.pronunciation.raw,82.5);assert.equal(result.fluency.raw,91.3);assert.equal(result.pronunciation.score,azure.band5(82.5));assert.equal(result.overallScore,undefined);assert.equal(result.scope,'whole-test-acoustic-summary');
 assert.throws(()=>whole.summarize([],{recordingCount:2,expectedCount:3}),/every saved response/);
});

test('Every original recording is assessed without reference text, earlier results or manual overrides',async()=>{
 let calls=0;
 const result=await whole.assess(Array.from({length:8},(_,i)=>({mime:'audio/webm',data:'audio-'+i,transcript:'PRIVATE',question:{text:'PRIVATE'},score:0,manualDeliveryOverrides:{score:5}})),{
  split:async recording=>{assert.deepEqual(Object.keys(recording).sort(),['data','mime']);return [wav()];},
  measure:async(audio,reference,options)=>{calls++;assert.equal(reference,'');assert.equal(options.unscripted,true);assert.equal(options.scripted,false);return {accuracy:96,fluency:90,duration:8e7};}
 });
 assert.equal(calls,8);assert.equal(result.recordingCount,8);assert.equal(result.chunkCount,8);assert.equal(result.pronunciation.raw,96);assert.equal(result.fluency.raw,90);
});

test('Short final sections retain every audio sample and enough recognition context without exceeding 30 seconds',async()=>{
 for(const tail of [.72,3]){
  const parts=[wav(28),wav(tail)],balanced=whole.balanceTail(parts);
  assert.deepEqual(Buffer.concat(balanced.map(whole.pcm)),Buffer.concat(parts.map(whole.pcm)));
  assert(balanced.every(p=>azure.wavSeconds(p)>=4&&azure.wavSeconds(p)<30));
 }
 let calls=0;const result=await whole.assess(Array.from({length:3},()=>({mime:'audio/wav',data:'audio'})),{split:async()=>[wav(28),wav(.72)],measure:async audio=>{
  calls++;assert(azure.wavSeconds(audio)>28);return {accuracy:95,fluency:96,duration:28.72e7};
 }});assert.equal(calls,3);assert.equal(result.recordingCount,3);assert.equal(result.chunkCount,3);
});

test('Azure whole-mock assessment withholds incomplete coverage and never substitutes partial success',async()=>{
 const recordings=Array.from({length:8},()=>({mime:'audio/wav',data:'audio'}));
 let i=0;await assert.rejects(whole.assess(recordings,{split:async()=>[++i===8?wav(8,false):wav()],measure:async()=>({accuracy:95,fluency:95})}),/every saved response/);
 let calls=0;await assert.rejects(whole.assess(recordings,{split:async()=>[wav()],measure:async()=>{calls++;throw Error('Azure failed');}}),/Azure failed/);assert(calls<=2,'No paid retry or new work after a failed request.');
 assert.equal(whole.silent(wav(1,false)),true);assert.equal(whole.silent(wav(1)),false);
});

test('Azure timeout diagnostics identify the affected audio section without modifying read-only provider errors',async()=>{
 await assert.rejects(whole.assess(Array.from({length:8},()=>({mime:'audio/wav',data:'audio'})),{split:async()=>[wav()],measure:async()=>{throw new DOMException('Timed out','TimeoutError');}}),error=>{
  assert.equal(error.code,'AZURE_TIMEOUT');assert(Number.isInteger(error.audioSection.recording));assert.equal(error.audioSection.seconds,8);return true;
 });
});

test('Azure unscripted wire requests have no reference text, miscue or unsupported prosody requirement',async()=>{
 const result=await azure.azureAssess(wav(),'',{apiKey:'test-only',endpoint:'https://example.test/speech',unscripted:true,request:async(_,args)=>{
  const config=JSON.parse(Buffer.from(args.headers['Pronunciation-Assessment'],'base64').toString());
  assert.equal(config.ReferenceText,'');assert.equal(config.EnableMiscue,undefined);assert.equal(config.EnableProsodyAssessment,undefined);assert.equal(config.GradingSystem,'HundredMark');
  return {ok:true,json:async()=>({RecognitionStatus:'Success',Duration:8e7,NBest:[{PronunciationAssessment:{AccuracyScore:94,FluencyScore:96}}]})};
 }});assert.equal(result.accuracy,94);assert.equal(result.fluency,96);
 assert.equal(azure.extractAssessment({NBest:[{PronunciationAssessment:{AccuracyScore:null,FluencyScore:null}}]}).accuracy,null);
 assert.equal(azure.band5(null),null);
});

async function fixture(t,{failure=false}={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mock-azure-')),app=require('express')();let calls=0;
 const lab=installSpeakingMock(app,{directory,getAccount:async()=>({}),verifyToken:()=> 'mahabir1',azureOverallAvailable:true,
  transcribe:async()=>{throw Error('Do not transcribe again');},assessGpt:async()=>{throw Error('Do not regrade questions');},assessAzure:async()=>{throw Error('Do not regrade questions');},assessOverall:async()=>{throw Error('Do not reassess GPT overall');},
  assessAzureOverall:async(recordings,options)=>{calls++;assert.equal(recordings.length,27);assert.equal(options.expectedCount,27);assert(recordings.every(r=>Object.keys(r).sort().join(',')==='data,hash,mime'));if(failure)throw Object.assign(Error('Unavailable'),{providerStatus:429});return whole.summarize([{accuracy:96,fluency:92,seconds:180}],{recordingCount:27,expectedCount:27,assessedRecordings:27,audioSeconds:200});}});
 t.after(async()=>{await lab.waitForJobs();await fs.rm(directory,{recursive:true,force:true});});
 const id=crypto.randomUUID(),questions=structuredClone(bank.papers[0].questions),responses=questions.map((_,i)=>({recording:{mime:'audio/wav',data:'saved-'+i,hash:'hash-'+i},transcript:'saved',gpt:{score:5},azure:{score:5},manualDeliveryOverrides:{gpt:{fluency:{score:5}}}})),overall={status:'assessed',overallScore:85,pronunciation:{score:5},fluency:{score:5}};
 await lab.store.update('mahabir1',id,()=>({id,status:'submitted',questions,responses,questionCount:27,completedCount:27,grading:{status:'complete'},overall}));
 return {...lab,id,calls:()=>calls,responses,overall,request:{provider:'azure',username:'mahabir1',attemptId:id,operation:'azure-whole-test'}};
}

test('Pinned Azure recovery saves a separate result exactly once and preserves every existing assessment',async t=>{
 const h=await fixture(t);await Promise.all([h.recoverOverall(h.request),h.recoverOverall(h.request)]);
 const saved=await h.store.get('mahabir1',h.id);assert.equal(h.calls(),1);assert.equal(saved.overallAzure.pronunciation.raw,96);assert.deepEqual(saved.overall,h.overall);assert.deepEqual(saved.responses,h.responses);
 assert.equal((await h.recoverOverall(h.request)).status,'complete');assert.equal(h.calls(),1);
 await assert.rejects(h.recoverOverall({...h.request,username:'another-user'}),/Invalid Azure/);
});

test('Azure recovery failures retain GPT results and are not repeated on restart',async t=>{
 const h=await fixture(t,{failure:true}),report=await h.recoverOverall(h.request);assert.equal(report.status,'needs-review');assert.equal(report.failure.providerStatus,429);
 const saved=await h.store.get('mahabir1',h.id);assert.deepEqual(saved.overall,h.overall);assert.deepEqual(saved.responses,h.responses);await h.recoverOverall(h.request);assert.equal(h.calls(),1);
});
