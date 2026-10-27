'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const azure=require('../speaking-delivery'),gpt=require('../gpt-speaking-delivery');
function wav(seconds){const pcm=Buffer.alloc(Math.round(seconds*16000)*2);for(let p=0;p<pcm.length;p+=2)pcm.writeInt16LE(Math.round(Math.sin(p/31)*8000),p);return azure.pcmWav(pcm);}
const native=()=>({ok:true,json:async()=>({RecognitionStatus:'Success',NBest:[{PronunciationAssessment:{AccuracyScore:90,FluencyScore:91},Words:[{Word:'spoken',PronunciationAssessment:{AccuracyScore:90,ErrorType:'None'}}]}]})});
const question={type:'rs',text:'The university library will be closed for renovation during the summer vacation.'},transcript='university library closed renovation something else again';
test('partial content coverage cannot prevent an independent delivery judgment when the recorded phrase has enough speech',async()=>{
  assert.equal(azure.deliveryEvidence(question,transcript,9.3).sufficient,false);const e=azure.deliveryEvidence(question,transcript,9.3,{contentIndependent:true});assert.equal(e.sufficient,true);assert(e.coverage<50);assert.equal(e.evidencePolicy,'content-independent-delivery-v1');
  const trait={status:'scored',pattern:'clear',overallImpact:'none',score:5,reason:'The recorded words are readily understood.',nextStep:'Keep this connected phrase.',evidence:[{start:1,end:2,kind:'strength',phrase:'university library',observation:'The phrase is clear and connected.',impact:''}]};let calls=0;
  const result=await gpt.assessRecording({mime:'audio/wav',data:'saved'},{question,transcript,contentIndependent:true,apiKey:'test',convert:async()=>({wav:wav(9.3),seconds:9.3}),request:async(_,args)=>{calls++;assert(!args.body.includes(transcript));return{ok:true,json:async()=>({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{type:'function',function:{name:'record_delivery_assessment',arguments:JSON.stringify({pronunciation:trait,fluency:trait})}}]}}]})};}});
  assert.equal(calls,1);assert.equal(result.pronunciation.score,5);assert.equal(result.fluency.score,5);assert.equal(result.deliveryEvidence.sufficient,true);
  assert.equal(azure.deliveryEvidence(question,'one',.4,{contentIndependent:true}).sufficient,false,'The audio sufficiency safeguards still apply.');
});
test('Azure retains its own acoustic marks for a partially repeated sentence instead of withholding them for content omissions',async()=>{
  let calls=0;const result=await azure.assessRecording({mime:'audio/wav',data:wav(9.3).toString('base64')},{question,transcript,contentIndependent:true,apiKey:'test',endpoint:'https://speech.test',request:async()=>{calls++;return native();}});
  assert.equal(calls,1);assert.equal(result.pronunciation.raw,90);assert.equal(result.pronunciation.score,4);assert.equal(result.fluency.raw,91);assert.equal(result.fluency.score,4);assert.equal(result.deliveryEvidence.sufficient,true);
});
for(const seconds of [28.7,29.5,58.6])test(`Azure recovery preserves every audio sample and pause in a ${seconds}-second recording without a tiny terminal request`,async()=>{
  const original=wav(seconds),recording={mime:'audio/wav',data:original.toString('base64')},parts=await azure.splitToWav(recording);
  assert.deepEqual(Buffer.concat(parts.map(azure.pcmData)),azure.pcmData(original));assert(parts.every(p=>azure.wavSeconds(p)>=4&&azure.wavSeconds(p)<30));
  const text='The speaker explains that trees provide shade and absorb rainwater so cities should maintain suitable species in local neighbourhoods.';let requests=0,transcriptions=0;
  const chunkCache=seconds>30?{[crypto.createHash('sha256').update(parts[0]).digest('hex')]:{transcript:text,result:{accuracy:90,fluency:91,words:[]}}}:{};
  const result=await azure.assessRecording(recording,{question:{type:'sgd'},transcript:text,apiKey:'test',endpoint:'https://speech.test',chunkCache,transcribe:async()=>{transcriptions++;return text;},request:async(_,args)=>{requests++;assert(azure.wavSeconds(args.body)>=4,'A tiny final request would fail recognition.');assert(azure.wavSeconds(args.body)<30);return native();}});
  assert.equal(requests,parts.length-(seconds>30?1:0));assert.equal(result.pronunciation.raw,90);assert.equal(result.fluency.raw,91);if(seconds>30)assert.equal(transcriptions,parts.length-1,'The previously successful first chunk is retained.');
});
