'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const gpt=require('../gpt-speaking-delivery'),azure=require('../speaking-delivery'),bank=require('../content/speaking-bank');
const {installSpeakingLab}=require('../speaking-lab');
const transcript='The speaker explains that trees shade streets and absorb rainwater, so cities should maintain suitable species.';
const top=()=>({status:'scored',score:5,reason:'The words and stress are clear overall.',nextStep:'Keep the useful emphasis on the next recording.',evidence:[{start:.1,end:.8,kind:'strength',phrase:'trees shade streets',observation:'The words are clear with useful stress.',impact:''}]});
const raw={pronunciation:top(),fluency:{status:'scored',score:4,reason:'A restart noticeably interrupts the phrase.',nextStep:'Join the two parts of this phrase, then record it once.',evidence:[{start:1,end:1.5,kind:'score-impact',phrase:'absorb rainwater',observation:'A restart breaks the phrase.',impact:'This noticeably disrupts connected flow.'}]}};
function wav(seconds=8){const b=Buffer.alloc(44+32000*seconds);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b;}
const evidence=azure.deliveryEvidence({type:'rl'},transcript,8);
const gptResult=()=>gpt.normalize(raw,evidence);
const azureResult={deliveryVersion:azure.VERSION,deliveryProvider:'azure-speech-pronunciation',pronunciation:{score:3,maximum:5},fluency:{score:3,maximum:5}};

test('GPT receives actual WAV audio, uses the confirmed model and makes one bounded request',async()=>{
  let calls=0;
  const result=await gpt.assessRecording({mime:'audio/webm',data:'saved'},{question:{type:'rl'},transcript,apiKey:'test-only',convert:async()=>({wav:wav(),seconds:8}),request:async(url,args)=>{
    calls++;assert.equal(url,'https://api.openai.com/v1/chat/completions');
    const body=JSON.parse(args.body);assert.equal(body.model,'gpt-audio-1.5');assert.deepEqual(body.modalities,['text']);assert.equal(body.store,false);
    assert.equal(body.tool_choice.function.name,'record_delivery_assessment');assert.equal(body.parallel_tool_calls,false);
    assert(!body.messages[1].content[0].text.includes(transcript),'Do not bias the acoustic review with transcript text.');
    assert.equal(body.response_format,undefined);assert.equal(body.messages[1].content[1].type,'input_audio');
    assert.equal(Buffer.from(body.messages[1].content[1].input_audio.data,'base64').length,wav().length);
    assert(args.signal);return {ok:true,json:async()=>({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{type:'function',function:{name:'record_delivery_assessment',arguments:JSON.stringify(raw)}}]}}]})};
  }});
  assert.equal(calls,1);assert.equal(result.pronunciation.score,5);assert.equal(result.fluency.score,4);
  assert.equal(result.deliveryProvider,'openai-gpt-audio');assert.equal(result.deliveryModel,'gpt-audio-1.5');
  assert.equal(result.pronunciation.accuracy,undefined,'Do not fabricate Azure-like acoustic percentages.');
});

test('Conversion preserves the complete response and parses ffmpeg WAV metadata',async()=>{
  const recording={mime:'audio/wav',data:wav().toString('base64')};
  const converted=await gpt.toWav(recording);
  assert.equal(converted.seconds,8);assert.equal(gpt.wavDuration(converted.wav),8);
  assert.throws(()=>gpt.wavDuration(Buffer.alloc(44)),/Invalid/);
});

test('Insufficient speech withholds GPT marks and avoids the paid provider call',async()=>{
  const result=await gpt.assessRecording({mime:'audio/wav',data:'saved'},{question:{type:'rl'},transcript:'Trees provide shade.',apiKey:'test-only',convert:async()=>({wav:wav(2),seconds:2}),request:async()=>{throw Error('Must not call');}});
  assert.equal(result.pronunciation.score,null);assert.equal(result.fluency.score,null);
  const unavailable={status:'unassessed',score:null,reason:'Clipping prevents a reliable judgment.',nextStep:'Record with less clipping.',evidence:[]};
  assert.equal(gpt.normalize({pronunciation:unavailable,fluency:unavailable},evidence).pronunciation.score,null);
});

test('Malformed GPT marks and provider failures remain failures without paid repair calls',async()=>{
  const partial=gpt.normalize({...raw,pronunciation:{score:90,coaching:'Clear.'}},evidence);
  assert.equal(partial.pronunciation.score,null);assert.equal(partial.fluency.score,4);
  let calls=0;
  await assert.rejects(gpt.assessRecording({mime:'audio/wav',data:'saved'},{apiKey:'test-only',question:{type:'sgd'},transcript,convert:async()=>({wav:wav(),seconds:8}),request:async()=>{calls++;return {ok:false,status:429};}}),/temporarily unavailable/);
  assert.equal(calls,1);assert.equal(gpt.applies({type:'rts'}),true);assert.equal(gpt.applies({type:'di'}),false);
});

async function harness(t,{failGpt=false,failAzure=false,existingAzure=false}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dual-delivery-')),app=require('express')();app.use(require('express').json());
  let primaryCalls=0,comparisonCalls=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  const {store}=installSpeakingLab(app,{directory,verifyToken:v=>['alice','bob'].includes(v)?v:null,getAccount:async()=>({}),
    deliveryAssessmentAvailable:true,gptDeliveryAvailable:true,azureComparisonAvailable:true,
    transcribe:async()=>transcript,callModel:async()=>{throw Error('Existing content should be reused.');},
    assessGptDelivery:async()=>{primaryCalls++;if(failGpt)throw Error('OpenAI unavailable');return gptResult();},
    assessDelivery:async()=>{comparisonCalls++;await gate;if(failAzure)throw Error('Azure unavailable');return azureResult;}
  });
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{release();for(let n=0;n<10;n++)await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port+'/api/speaking';
  async function request(route,body,user='alice'){
    const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'x-session-token':user,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  }
  async function seed(type='rl'){
    const id=crypto.randomUUID(),q=bank.questions.find(q=>q.type===type);
    await store.update('alice',id,()=>({id,questionId:q.id,status:'submitted',startedAt:Date.now(),transcript,recording:{mime:'audio/wav',data:wav().toString('base64'),hash:'same-recording'},
      result:{scoringMode:'ai',total:6,maximum:6,strengths:[],improvements:[],overview:'Saved content.',...(existingAzure?azureResult:{pronunciation:null,fluency:null})}}));
    return id;
  }
  return {request,seed,release,store,calls:()=>({primaryCalls,comparisonCalls})};
}

for(const type of ['rl','sgd','rts'])test(`${type}: GPT is immediate, Azure runs in the background, and both scores persist on the same recording`,async t=>{
  const h=await harness(t),id=await h.seed(type);
  const catalog=(await h.request('/catalog')).body;assert.equal(catalog.deliveryVersions[type],gpt.VERSION);assert.equal(catalog.deliveryVersions.di,undefined);
  const first=await h.request('/attempts/'+id+'/submit',{});
  assert.equal(first.status,200);assert.equal(first.body.result.pronunciation.score,5);assert.equal(first.body.result.deliveryComparisons.azure.status,'pending');
  assert.equal(first.body.result.deliveryComparisons.gpt.recordingHash,'same-recording');
  const cached=await h.request('/attempts/'+id+'/submit',{});assert.equal(cached.body.result.pronunciation.score,5);
  assert.equal((await h.request('/attempts/'+id,undefined,'bob')).status,404);
  assert.deepEqual(h.calls(),{primaryCalls:1,comparisonCalls:1});
  h.release();
  let saved;
  for(let n=0;n<30;n++){saved=(await h.request('/attempts/'+id)).body;if(saved.result.deliveryComparisons.azure.status==='assessed')break;await new Promise(resolve=>setImmediate(resolve));}
  assert.equal(saved.result.deliveryComparisons.azure.pronunciation.score,3);
  assert.equal(saved.result.deliveryComparisons.azure.recordingHash,'same-recording');assert.equal(saved.result.pronunciation.score,5);
  assert.equal(saved.result.total,6);assert.equal(saved.transcript,transcript);assert.deepEqual(h.calls(),{primaryCalls:1,comparisonCalls:1});
});

for(const type of ['rl','rts'])test(`${type}: updating an old Azure attempt retains its original comparison without assessing that audio again`,async t=>{
  const h=await harness(t,{existingAzure:true}),id=await h.seed(type);
  const result=(await h.request('/attempts/'+id+'/submit',{})).body.result;
  assert.equal(result.pronunciation.score,5);assert.equal(result.deliveryComparisons.azure.pronunciation.score,3);
  assert.deepEqual(h.calls(),{primaryCalls:1,comparisonCalls:0});
});

test('An explicit policy update preserves earlier provider snapshots before refreshing both assessments',async t=>{
  const h=await harness(t,{existingAzure:true}),id=await h.seed();
  await h.store.update('alice',id,a=>{
    a.result.deliveryVersion='old-azure';
    a.result.deliveryComparisons={gpt:{...gptResult(),status:'assessed',deliveryVersion:'old-gpt',pronunciation:{score:4,maximum:5}},azure:{...azureResult,status:'assessed',deliveryVersion:'old-azure'}};
    return a;
  });
  const result=(await h.request('/attempts/'+id+'/submit',{})).body.result;
  assert.equal(result.deliveryComparisonHistory.gpt[0].pronunciation.score,4);
  assert.equal(result.deliveryComparisonHistory.azure[0].deliveryVersion,'old-azure');
  assert.equal(result.deliveryComparisons.gpt.deliveryVersion,gpt.VERSION);
  assert.equal(result.deliveryComparisons.azure.status,'pending');h.release();
  let saved;
  for(let n=0;n<30;n++){saved=(await h.request('/attempts/'+id)).body;if(saved.result.deliveryComparisons.azure.status==='assessed')break;await new Promise(resolve=>setImmediate(resolve));}
  assert.equal(saved.result.deliveryComparisons.azure.deliveryVersion,azure.VERSION);
  assert.equal(saved.result.deliveryComparisonHistory.gpt[0].pronunciation.score,4);
  assert.deepEqual(h.calls(),{primaryCalls:1,comparisonCalls:1});
});

test('Azure failure does not replace valid GPT or content scores',async t=>{
  const h=await harness(t,{failAzure:true}),id=await h.seed();await h.request('/attempts/'+id+'/submit',{});h.release();
  let saved;
  for(let n=0;n<30;n++){saved=(await h.request('/attempts/'+id)).body;if(saved.result.deliveryComparisons.azure.status==='unavailable')break;await new Promise(resolve=>setImmediate(resolve));}
  assert.equal(saved.result.deliveryComparisons.azure.status,'unavailable');assert.equal(saved.result.pronunciation.score,5);assert.equal(saved.result.total,6);
});

test('GPT failure is labelled and still permits an independent Azure comparison',async t=>{
  const h=await harness(t,{failGpt:true}),id=await h.seed();const result=(await h.request('/attempts/'+id+'/submit',{})).body.result;
  assert.equal(result.pronunciation,null);assert.equal(result.deliveryComparisons.gpt.status,'unavailable');assert.match(result.deliveryStatus,/GPT audio assessment temporarily unavailable/);
  assert.notEqual(result.deliveryVersion,gpt.VERSION);assert.equal(result.total,6);h.release();
  let saved;
  for(let n=0;n<30;n++){saved=(await h.request('/attempts/'+id)).body;if(saved.result.deliveryComparisons.azure.status==='assessed')break;await new Promise(resolve=>setImmediate(resolve));}
  assert.equal(saved.result.deliveryComparisons.azure.status,'assessed');assert.equal(saved.result.pronunciation,null);
});
