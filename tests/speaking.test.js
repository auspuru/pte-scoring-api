'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const bank=require('../content/speaking-bank'),scoring=require('../speaking-scoring'),delivery=require('../speaking-delivery'),{installSpeakingLab,transcribeRecording,question}=require('../speaking-lab');
const {createStore}=require('../writing-lab-store'),localEngine=require('../local-scoring-engine');
test('There are five original questions for each supported Speaking task, with samples and verified audio',()=>{
  assert.deepEqual(require('../scripts/validate-speaking-content').validate(),{questions:30,recordings:20});
  assert(!bank.types.asq);assert.equal(new Set(bank.questions.map(q=>q.sample)).size,30);
  for(const q of bank.questions.filter(q=>q.type==='sgd'))assert.equal(new Set(q.turns.map(t=>t[0])).size,3);
});
test('Read Aloud checks omissions, insertions and replacements without inventing a delivery score',()=>{
  const q={type:'ra',text:'Trees shade streets and protect wildlife.'};
  const perfect=scoring.exact(q,'Trees shade streets and protect wildlife!');assert.equal(perfect.total,6);
  const edited=scoring.exact(q,'Trees shade roads and protect');assert.equal(edited.total,4);
  assert.equal(edited.changes.filter(c=>c.kind==='replacement').length,1);assert.equal(edited.changes.filter(c=>c.kind==='omission').length,1);
  assert.equal(scoring.exact(q,'Trees shade streets and protect wildlife today').total,5);
  assert.equal(scoring.exact(q,'').total,0);assert.equal(perfect.pronunciation,null);assert.equal(perfect.fluency,null);assert.equal(perfect.score90,undefined);
});
test('Repeat Sentence uses ordered content and ignores filler and peripheral material',()=>{
  const q=bank.questions.find(q=>q.type==='rs');
  assert.equal(scoring.exact(q,q.text).total,3);
  assert.equal(scoring.exact(q,'um '+q.text+' thank you').total,3);
  const words=scoring.tokens(q.text);
  assert.equal(scoring.exact(q,words.slice(0,7).join(' ')).total,2);
  assert.equal(scoring.exact(q,words.slice(0,3).join(' ')).total,1);
  assert.equal(scoring.exact(q,'library').total,0);
  assert(scoring.exact(q,words.reverse().join(' ')).total<3);
});
function modelResult(q,text) {return {total:6,overview:'The response develops the main ideas accurately and connects them well.',strengths:['The main topic is clear.'],improvements:['Keep the important ideas connected.'],coverage:q.facts.map((point,i)=>({point:i,status:'covered',evidence:text.slice(0,20),feedback:'This relevant idea is represented in the response.'}))};}
test('Meaning feedback validates every coverage item and rejects invented student quotations',async()=>{
  for(const q of bank.questions.filter(q=>q.facts)) {
    const r=await scoring.grade(q,q.sample,async prompt=>{assert(prompt.includes('CONTENT ONLY'));assert(prompt.includes('Never score or comment on pronunciation'));return modelResult(q,q.sample);});
    assert.equal(r.total,6);assert.equal(r.maximum,6);assert.equal(r.coverage.length,q.facts.length);assert.equal(r.fluency,null);
  }
  const q=bank.questions.find(q=>q.type==='di'),raw=modelResult(q,q.sample);raw.coverage[0].evidence='invented student quotation';
  assert.throws(()=>scoring.normalize(q,q.sample,raw),/Unsupported/);
  assert.equal((await scoring.grade(q,'',()=>{throw Error('Must not call AI');})).total,0);
});
test('Describe Image does not require arithmetic that is not printed in the visual',()=>{
  const q=bank.questions.find(q=>q.title==='Getting to campus');
  assert(q);assert.equal(q.facts.some(f=>/400/.test(f)),false);assert.equal(/400/.test(q.sample),false);
  const p=scoring.prompt(q,q.sample);assert.match(p,/Do NOT penalise a student for failing to calculate or mention a total/);assert.match(p,/response time is only 40 seconds/);
});

test('Delivery feedback includes actionable coaching and filters noisy numeric/function-word practice tokens',()=>{
  const evidence={sufficient:true,durationSeconds:39,spokenWords:70};
  const r=delivery.aggregate([{accuracy:95,fluency:86,prosody:69,weight:39,words:[
    {word:'for',accuracy:4,errorType:'Mispronunciation'},{word:'120',accuracy:17,errorType:'Mispronunciation'},{word:'transport',accuracy:62,errorType:'Mispronunciation'}
  ]}],{evidence});
  assert.equal(r.pronunciation.score,4);assert.equal(r.fluency.score,3);
  assert.match(r.pronunciation.coaching,/stress|emphasis/i);assert.match(r.fluency.coaching,/meaning groups|steady pace|pause/i);
  assert.deepEqual(r.pronunciation.words.map(w=>w.word),['transport']);
});

test('Prompt transcripts, content keys and samples stay hidden until submission',()=>{
  for(const q of bank.questions) {
    const publicQ=question(q);assert.equal(publicQ.sample,undefined);assert.equal(publicQ.facts,undefined);assert.equal(publicQ.visual,undefined);
    if(['rs','rl','sgd'].includes(q.type))assert.equal(publicQ.text,undefined);
    assert.equal(question(q,true).sample,q.sample);
  }
});
test('AI quotations tolerate typography differences but preserve the original student evidence',()=>{
  const q={facts:['Household electricity use']};
  const text='The household’s electricity use is “high”.  Heating accounts for 40 percent.';
  const raw={total:5,overview:'The main feature is accurately described.',strengths:['Correct main feature.'],improvements:[],coverage:[{point:0,status:'covered',evidence:'The household\'s electricity use is "high". Heating accounts for 40 percent.',feedback:'You identify the main feature.'}]};
  assert.equal(scoring.normalize(q,text,raw).coverage[0].evidence,text);
  raw.coverage[0].evidence='The household\'s electricity use is "low".';
  assert.throws(()=>scoring.normalize(q,text,raw),/Unsupported assessment evidence/);
});
test('Exact chart graphics have labels and values rather than generated-image guesses',()=>{
  const {render}=require('../speaking-visuals');
  for(const q of bank.questions.filter(q=>q.visual)) {
    const svg=render(q.visual);assert(svg.startsWith('<svg'));assert(svg.includes(q.visual.title));assert(!/NaN|undefined/.test(svg));
    if(q.visual.kind==='pie')q.visual.values.forEach(value=>assert(svg.includes(value+'%')));
  }
});
test('Transcription uploads audio only, never the reference text, and fails clearly without configuration',async()=>{
  const recording={mime:'audio/webm',data:Buffer.alloc(200).toString('base64')};
  await assert.rejects(transcribeRecording(recording,{apiKey:''}),/not configured/);
  const text=await transcribeRecording(recording,{apiKey:'test-only',fetch:async(url,args)=>{assert(url.endsWith('/audio/transcriptions'));assert.equal(args.body.get('prompt'),null);assert.equal(args.body.get('language'),'en');assert.equal(args.body.get('file').type,'audio/webm');return {ok:true,json:async()=>({text:'The words actually spoken.'})};}});
  assert.equal(text,'The words actually spoken.');
  await assert.rejects(transcribeRecording(recording,{apiKey:'test-only',fetch:async()=>({ok:false,json:async()=>({})})}),/recording is saved/);
});
test('Azure delivery accepts the regional endpoint shown by the portal and normalises it to Speech STT',()=>{
  const env={AZURE_SPEECH_KEY:'test',AZURE_SPEECH_ENDPOINT:'https://australiaeast.api.cognitive.microsoft.com/'};
  assert.equal(delivery.endpointFromEnv(env),'https://australiaeast.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1');
  const summary=delivery.configurationSummary(env);assert.equal(summary.configured,true);assert.equal(summary.endpointHost,'australiaeast.stt.speech.microsoft.com');assert.equal(summary.locale,'en-AU');
});

test('Short incomplete Read Aloud responses do not receive misleading pronunciation or fluency bands',()=>{
  const question={type:'ra',text:'Urban parks provide shade absorb rainwater create habitats and improve city life for local residents.'};
  const evidence=delivery.deliveryEvidence(question,'Urban parks provide shade',3);
  assert.equal(evidence.sufficient,false);assert(evidence.coverage<35);
  const result=delivery.aggregate([{accuracy:89,fluency:100,prosody:81,pronScore:88,weight:3,words:[]}],{evidence});
  assert.equal(result.pronunciation.score,null);assert.equal(result.fluency.score,null);
  assert.match(result.deliveryStatus,/Not enough speech/);assert.equal(result.deliveryEvidence.spokenWords,4);
});

test('Delivery band calibration is deliberately stricter than raw Azure percentages',()=>{
  assert.equal(delivery.band5(93),4);assert.equal(delivery.band5(94),5);
  assert.equal(delivery.band5(83),3);assert.equal(delivery.band5(84),4);
  assert.equal(delivery.descriptor('pronunciation',4),'Advanced');assert.equal(delivery.descriptor('fluency',3),'Good');
});

test('Open speaking tasks need enough speech before delivery bands are shown',()=>{
  assert.equal(delivery.deliveryEvidence({type:'di'},'The chart shows prices rising quickly.',4.5).sufficient,false);
  assert.equal(delivery.deliveryEvidence({type:'di'},'The chart shows prices rising quickly across all five categories during the year.',8).sufficient,true);
});

test('A sufficiently complete Read Aloud can receive delivery bands independently from content',()=>{
  const text='Urban parks provide shade absorb rainwater create habitats and improve city life for local residents throughout the year.';
  const evidence=delivery.deliveryEvidence({type:'ra',text},text,18);
  assert.equal(evidence.sufficient,true);assert.equal(evidence.coverage,100);
  const result=delivery.aggregate([{accuracy:86,fluency:82,prosody:78,weight:18,words:[]}],{evidence});
  assert.equal(result.pronunciation.score,4);assert.equal(result.pronunciation.descriptor,'Advanced');assert.equal(result.fluency.score,3);assert.equal(result.fluency.descriptor,'Good');
});

test('Audio delivery parses Azure pronunciation data and maps it to PTE-style /5 practice scores',async()=>{
  const raw={Duration:250000000,NBest:[{PronunciationAssessment:{AccuracyScore:86,FluencyScore:82,ProsodyScore:78,PronScore:84},Words:[
    {Word:'environmental',PronunciationAssessment:{AccuracyScore:61,ErrorType:'Mispronunciation'}},
    {Word:'research',PronunciationAssessment:{AccuracyScore:91,ErrorType:'None'}}
  ]}]};
  const parsed=delivery.extractAssessment(raw);assert.equal(parsed.accuracy,86);assert.equal(parsed.fluency,82);assert.equal(parsed.words[0].word,'environmental');
  const combined=delivery.aggregate([{...parsed,weight:25}]);
  assert.equal(combined.pronunciation.score,4);assert.equal(combined.pronunciation.maximum,5);assert.equal(combined.pronunciation.descriptor,'Advanced');assert.equal(combined.fluency.score,3);assert.equal(combined.fluency.descriptor,'Good');assert.equal(combined.pronunciation.words.length,1);
  let sent;
  const assessed=await delivery.azureAssess(Buffer.alloc(100), 'The full scripted reference.', {apiKey:'azure-test',endpoint:'https://example.cognitiveservices.azure.com/stt/speech/recognition/conversation/cognitiveservices/v1',locale:'en-AU',scripted:true,request:async(url,args)=>{
    sent={url,args};return {ok:true,json:async()=>raw};
  }});
  const config=JSON.parse(Buffer.from(sent.args.headers['Pronunciation-Assessment'],'base64').toString('utf8'));
  assert.equal(config.ReferenceText,'The full scripted reference.');assert.equal(config.Dimension,'Comprehensive');assert.equal(config.EnableProsodyAssessment,'True');assert.equal(config.EnableMiscue,true);assert.match(sent.url,/language=en-AU/);assert.equal(assessed.prosody,78);
});

test('Attempt tables are namespaced and cannot accept an arbitrary SQL identifier',()=>{
  assert.throws(()=>createStore(null,'/unused',{table:'accounts'}),/Invalid attempt table/);
});
test('Speaking API preserves private recordings, transcript revisions, samples, reattempts and score retries',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-test-')),app=require('express')();app.use(require('express').json());let failModel=false,failDelivery=false;
  const deliveryResult={deliveryVersion:delivery.VERSION,pronunciation:{score:4,maximum:5,raw:84,accuracy:86,prosody:78,words:[{word:'environmental',accuracy:61,errorType:'Mispronunciation'}]},fluency:{score:4,maximum:5,raw:82},deliveryStatus:'Audio assessed — PTE-style practice estimate',deliveryAssessment:'Independent practice estimate from the saved recording; not Pearson scoring.',deliveryProvider:'azure-speech-pronunciation'};
  const {store}=installSpeakingLab(app,{directory,verifyToken:t=>['alice','bob'].includes(t)?t:null,getAccount:async()=>({}),transcriptionAvailable:true,deliveryAssessmentAvailable:true,
    transcribe:async()=>bank.questions[0].text,assessDelivery:async()=>{if(failDelivery)throw Error('azure offline');return deliveryResult;},callModel:async prompt=>{if(failModel)throw Error('offline');const data=JSON.parse(prompt.split('DATA=')[1]);return modelResult({facts:data.facts},data.student);}});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{await new Promise(r=>server.close(r));await fs.rm(directory,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  async function request(route,body,user='alice',raw=false) {const r=await fetch(base+'/api/speaking'+route,{method:body===undefined?'GET':'POST',headers:{'x-session-token':user,'Content-Type':raw?'audio/webm':'application/json'},body:body===undefined?undefined:raw?body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
  const catalog=await request('/catalog',undefined,'');assert.equal(catalog.body.questions.length,30);
  assert.equal((await request('/attempts',undefined,'')).status,401);
  const id=crypto.randomUUID(),q=bank.questions[0];
  let a=(await request('/attempts',{id,questionId:q.id})).body;assert.equal(a.status,'draft');assert.equal(a.question.sample,undefined);
  assert.equal((await request('/attempts/'+id,undefined,'bob')).status,404);
  a=(await request('/attempts/'+id+'/recording',Buffer.alloc(200,3),'alice',true)).body;assert.equal(a.recording.bytes,200);assert.equal(a.recording.data,undefined);
  assert.equal((await request('/attempts/'+id+'/recording',Buffer.alloc(200,4),'alice',true)).status,409);
  assert.equal((await request('/attempts/'+id+'/recording',Buffer.alloc(200,3),'alice',true)).status,200,'A lost upload response can retry idempotently');
  const audio=await fetch(base+'/api/speaking/attempts/'+id+'/recording',{headers:{'x-session-token':'alice'}});assert.equal(audio.status,200);assert.equal((await audio.arrayBuffer()).byteLength,200);assert.equal(audio.headers.get('cache-control'),'no-store');
  assert.equal((await fetch(base+'/api/speaking/attempts/'+id+'/recording',{headers:{'x-session-token':'bob'}})).status,404);
  a=(await request('/attempts/'+id+'/transcribe',{})).body;assert.equal(a.transcript,q.text);
  assert.equal((await request('/attempts/'+id+'/transcript',{text:'old text',revision:0})).status,409);
  a=(await request('/attempts/'+id+'/submit',{})).body;assert.equal(a.result.total,a.result.maximum);assert.equal(a.question.sample,q.sample);assert.equal(a.result.pronunciation.score,4);assert.equal(a.result.fluency.score,4);
  assert.equal((await request('/attempts/'+id+'/transcript',{text:'changed',revision:a.revision})).status,409);
  const retry=(await request('/attempts',{id:crypto.randomUUID(),questionId:q.id})).body;assert.equal(retry.transcript,'');assert.equal(retry.recording,null);
  assert.equal((await request('/attempts/'+retry.id+'/submit',{})).status,400);
  assert.equal((await request('/attempts/'+retry.id)).body.status,'draft');
  await request('/attempts/'+retry.id+'/recording',Buffer.alloc(200,5),'alice',true);
  failDelivery=true;let fromAudio=await request('/attempts/'+retry.id+'/submit',{});
  assert.equal(fromAudio.status,200);assert.equal(fromAudio.body.transcript,q.text);assert.equal(fromAudio.body.result.total,fromAudio.body.result.maximum);assert.equal(fromAudio.body.result.pronunciation,null);assert.match(fromAudio.body.result.deliveryStatus,/temporarily unavailable/);
  failDelivery=false;fromAudio=await request('/attempts/'+retry.id+'/submit',{});assert.equal(fromAudio.body.result.pronunciation.score,4);assert.equal(fromAudio.body.result.fluency.score,4);
  assert.equal((await request('/attempts')).body.length,2);assert.equal((await store.list('bob')).length,0);
  const di=bank.questions.find(q=>q.type==='di'),other=crypto.randomUUID();
  await request('/attempts',{id:other,questionId:di.id});await request('/attempts/'+other+'/transcript',{text:di.sample,revision:0});
  failModel=true;a=(await request('/attempts/'+other+'/submit',{})).body;assert.equal(a.status,'submitted');assert.equal(a.transcript,di.sample);assert.equal(a.question.sample,di.sample);assert(a.result);assert.equal(a.result.scoringMode,'local');assert(a.result.total>=4);
  failModel=false;a=(await request('/attempts/'+other+'/submit',{})).body;assert.equal(a.result.scoringMode,'ai');assert.equal(a.result.total,6);
  const prompt=await fetch(base+'/speaking-audio/rs-1.mp3',{headers:{Range:'bytes=0-1023'}});assert.equal(prompt.status,206);assert.equal((await prompt.arrayBuffer()).byteLength,1024);
  assert.equal((await fetch(base+'/speaking-image/di-1.svg')).headers.get('content-type').split(';')[0],'image/svg+xml');
  assert.equal((await fetch(base+'/speaking-audio/not-a-question.mp3')).status,404);
});

test('Transcription failures identify provider access and quota without exposing raw messages',async()=>{
 const recording={mime:'audio/webm',data:Buffer.alloc(200).toString('base64')};
 for(const [status,code,expected] of [[401,'invalid_api_key',/key is invalid/],[429,'insufficient_quota',/API credit/],[400,'invalid_value',/could not read this audio/]]){
  await assert.rejects(transcribeRecording(recording,{apiKey:'test-only',fetch:async()=>({ok:false,status,json:async()=>({error:{code,message:'SECRET SHOULD NEVER BE SHOWN'}})})}),e=>{
   assert.match(e.message,expected);assert.match(e.message,/recording is saved/);assert(!e.message.includes('SECRET'));return true;
  });
 }
});


test('The official noisy-kitchen sample receives full content credit even in local fallback',()=>{
  const q=bank.questions.find(q=>q.title==='A noisy shared kitchen');assert(q);
  const result=localEngine.speaking(q,q.sample);
  assert.equal(result.total,6);assert(result.coverage.every(item=>item.status==='covered'));
});

test('RTS local fallback recognises polite paraphrases rather than literal rubric words',()=>{
  const q=bank.questions.find(q=>q.title==='A noisy shared kitchen');
  const response='Hi everyone, could we please keep the kitchen a little quieter late at night? The conversations make it hard for me to sleep before my morning class. Could we keep our voices low after ten thirty or move longer chats to the lounge? If that does not suit everyone, I am happy to discuss another option.';
  const result=localEngine.speaking(q,response);
  assert(result.total>=5);assert.equal(result.coverage[0].status,'covered');assert.equal(result.coverage[2].status,'covered');assert.equal(result.coverage[3].status,'covered');
});

test('Semantic Speaking grading retries one invalid assessment before falling back',async()=>{
  const q=bank.questions.find(q=>q.title==='A noisy shared kitchen');let calls=0;
  const result=await scoring.grade(q,q.sample,async prompt=>{
    calls++;
    if(calls===1)return {total:4,overview:'Incomplete',strengths:[],improvements:[],coverage:[]};
    const data=JSON.parse(prompt.split('DATA=')[1]);return modelResult({facts:data.facts},data.student);
  });
  assert.equal(calls,2);assert.equal(result.scoringMode,'ai');assert.equal(result.total,6);
});

test('Semantic Speaking tasks fall back to local content scoring when the reviewer is offline',async()=>{
  for(const q of bank.questions.filter(q=>['di','rl','sgd','rts'].includes(q.type)).slice(0,8)){
    const result=await scoring.grade(q,q.sample,async()=>{throw Error('offline');});
    assert.equal(result.scoringMode,'local');
    assert.equal(result.maximum,6);
    assert(Number.isInteger(result.total));
    assert(result.total>=0&&result.total<=6);
    assert.equal(result.coverage.length,q.facts.length);
  }
});
