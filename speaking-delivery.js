'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

const VERSION = 'azure-delivery-2026-10-27.1';
const DELIVERY_RUBRIC_VERSION = require('./delivery-rubric').RUBRIC_VERSION;
const CHUNK_SECONDS = 28;
const WAV_MIME = 'audio/wav';
const CONTENT_TYPE = 'audio/wav; codecs=audio/pcm; samplerate=16000';

function endpointFromEnv(env=process.env) {
  const configured=String(env.AZURE_SPEECH_ENDPOINT||'').trim().replace(/\/+$/,'');
  if(configured) {
    const regional=configured.match(/^https:\/\/([a-z0-9-]+)\.api\.cognitive\.microsoft\.com$/i);
    if(regional)return 'https://'+regional[1]+'.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1';
    if(configured.includes('/speech/recognition/')||configured.includes('/stt/speech/recognition/'))return configured;
    return configured+'/stt/speech/recognition/conversation/cognitiveservices/v1';
  }
  const resource=String(env.AZURE_SPEECH_RESOURCE||'').trim();
  if(resource&&!/^[a-zA-Z0-9-]+$/.test(resource)) return '';
  return resource ? 'https://'+resource+'.cognitiveservices.azure.com/stt/speech/recognition/conversation/cognitiveservices/v1' : '';
}

function isConfigured(env=process.env) {
  return !!(String(env.AZURE_SPEECH_KEY||'').trim() && endpointFromEnv(env));
}

function configurationSummary(env=process.env) {
  const endpoint=endpointFromEnv(env);
  let endpointHost='';
  try{endpointHost=endpoint?new URL(endpoint).host:'';}catch{}
  return {
    configured:isConfigured(env),
    hasKey:!!String(env.AZURE_SPEECH_KEY||'').trim(),
    hasEndpoint:!!String(env.AZURE_SPEECH_ENDPOINT||env.AZURE_SPEECH_RESOURCE||'').trim(),
    endpointHost,
    locale:String(env.AZURE_SPEECH_LOCALE||'en-AU').trim()||'en-AU'
  };
}

function band5(raw) {
  if(raw==null||raw==='')return null;
  const value=Number(raw);
  if(!Number.isFinite(value)) return null;
  // Conservative practice calibration. Azure's 0-100 acoustic scale is not
  // Pearson's proprietary 0-5 trait scale, so high bands require stronger evidence.
  if(value>=94)return 5;
  if(value>=84)return 4;
  if(value>=72)return 3;
  if(value>=58)return 2;
  if(value>=40)return 1;
  return 0;
}

function descriptor(kind,score) {
  if(!Number.isInteger(score)||score<0||score>5)return '';
  const labels=kind==='fluency'
    ? ['Disfluent','Limited','Intermediate','Good','Advanced','Highly proficient']
    : ['Non-English','Intrusive','Intermediate','Good','Advanced','Highly proficient'];
  return labels[score];
}

function coaching(kind,{score,accuracy,fluency,prosody,words=[]}={}) {
  if(!Number.isInteger(score))return '';
  if(kind==='pronunciation'){
    const practice=(words||[]).filter(w=>/[A-Za-z]/.test(w.word)&&!/^(the|and|for|was|are|is|to|of|a|an|in|on|at)$/i.test(w.word)).slice(0,3).map(w=>w.word);
    if(score>=5)return 'Maintain this clarity. Shadow one model sentence once, matching word stress and sentence stress rather than speaking faster.';
    if(score===4&&practice.length===1)return 'Check '+practice[0]+' in the recording. One flagged word does not establish a recurring pronunciation problem. If it is readily understood, treat word practice as optional; focus on a sound only if the same difficulty recurs across phrases.';
    if(score===4)return practice.length?'Check whether the same sound or stress difficulty recurs across phrases. Words worth reviewing: '+practice.join(', ')+'. If these are isolated clear slips, practice is optional. For a recurring difficulty, repeat one phrase and check that it is readily understood.':'Review clarity and useful stress across the whole response. If the message is clear and any slips are isolated, keep those refinements optional.';
    if(score===3)return practice.length?'Work on clarity before speed. Practise '+practice.join(', ')+' slowly, then repeat each inside a short phrase without changing the vowel or final consonant.':'Work on clarity before speed. Use short phrases, open the vowel sounds fully, and make final consonants audible.';
    if(score===2)return 'Slow down slightly and make each stressed syllable clear. Practise one sentence at a time: listen, mark the stressed syllables, then repeat it three times.';
    return 'Build intelligibility first. Use short model sentences, repeat them slowly, and focus on one difficult sound or stressed syllable at a time.';
  }
  if(score>=5)return 'Maintain the same steady pace and phrasing. Keep pausing only at natural idea boundaries.';
  if(score===4)return 'Listen for recurring mid-phrase stops that make ideas hard to follow. Natural pauses and an occasional stumble with smooth recovery are acceptable. If disruption recurs, practise joining one affected phrase, then record it once and check the recovery.';
  if(score===3)return 'Use 4–6 word meaning groups. Pause only between ideas, avoid restarting a sentence after a small mistake, and practise one 30-second response with a steady pace.';
  if(score===2)return 'Slow down enough to keep phrases connected. Speak in short meaning groups, reduce long silent pauses, and replace repeated restarts with a brief pause and continuation.';
  return 'First build continuous speech. Practise 10–15 second chunks without stopping, then connect two chunks while keeping a comfortable, even pace.';
}

function usefulPracticeWords(words) {
  const stop=/^(the|and|for|was|are|is|to|of|a|an|in|on|at|with|by|as|it)$/i;
  return (words||[]).filter(w=>/[A-Za-z]/.test(w.word)&&!/^\d+(?:[.,]\d+)?$/.test(w.word)&&!stop.test(w.word)).slice(0,5);
}

function round1(value) {
  if(value==null||value==='')return null;
  const n=Number(value);
  return Number.isFinite(n)?Math.round(n*10)/10:null;
}

function tokens(text) {
  return String(text||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9' ]+/g,' ').split(/\s+/).filter(Boolean);
}

function lcsLength(a,b) {
  if(!a.length||!b.length)return 0;
  let previous=new Uint16Array(b.length+1),current=new Uint16Array(b.length+1);
  for(let i=1;i<=a.length;i++){
    for(let j=1;j<=b.length;j++)current[j]=a[i-1]===b[j-1]?previous[j-1]+1:Math.max(previous[j],current[j-1]);
    [previous,current]=[current,previous];current.fill(0);
  }
  return previous[b.length];
}

function deliveryEvidence(question,transcript,durationSeconds,{contentIndependent=false}={}) {
  const spoken=tokens(transcript),type=String(question?.type||''),scripted=['ra','rs'].includes(type);
  const reference=scripted?tokens(question?.text):[],matched=scripted?lcsLength(reference,spoken):null;
  const coverage=scripted&&reference.length?matched/reference.length:null;
  let sufficient=true;
  // Delivery traits need enough continuous speech to be meaningful.
  // These are portal safeguards, not official Pearson cut-offs.
  if(type==='ra')sufficient=durationSeconds>=10&&spoken.length>=18&&(contentIndependent||coverage>=0.50);
  else if(type==='rs')sufficient=durationSeconds>=2&&spoken.length>=4&&(contentIndependent||coverage>=0.50);
  else sufficient=durationSeconds>=6&&spoken.length>=12;
  return {
    sufficient,
    durationSeconds:round1(durationSeconds),
    spokenWords:spoken.length,
    ...(contentIndependent?{evidencePolicy:'content-independent-delivery-v1'}:{}),
    ...(scripted?{referenceWords:reference.length,matchedWords:matched,coverage:round1(coverage*100)}:{})
  };
}

function pcmData(buffer){
  if(!Buffer.isBuffer(buffer)||buffer.length<44||buffer.toString('ascii',0,4)!=='RIFF'||buffer.toString('ascii',8,12)!=='WAVE')throw Error('Invalid PCM recording.');
  let format,pcm;for(let p=12;p+8<=buffer.length;){const tag=buffer.toString('ascii',p,p+4),size=buffer.readUInt32LE(p+4),start=p+8,end=start+size;if(end>buffer.length)throw Error('Invalid PCM chunk.');
    if(tag==='fmt '&&size>=16)format={encoding:buffer.readUInt16LE(start),channels:buffer.readUInt16LE(start+2),sampleRate:buffer.readUInt32LE(start+4),byteRate:buffer.readUInt32LE(start+8),align:buffer.readUInt16LE(start+12),bits:buffer.readUInt16LE(start+14)};
    if(tag==='data')pcm=buffer.subarray(start,end);p=end+(size%2);
  }if(!format||!pcm||format.encoding!==1||format.channels!==1||format.sampleRate!==16000||format.bits!==16||format.align!==2||format.byteRate!==32000||pcm.length%2)throw Error('Unsupported PCM recording.');return pcm;
}
function wavSeconds(buffer) {try{return pcmData(buffer).length/32000;}catch{return 0;}}
function pcmWav(pcm){const b=Buffer.alloc(44+pcm.length);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(pcm.length,40);pcm.copy(b,44);return b;}
function balanceShortTail(chunks){
  if(chunks.length<2||wavSeconds(chunks.at(-1))>=4)return chunks;
  // Azure pronunciation requests allow up to 30 seconds. Retain every PCM
  // sample and every pause; change only a tiny final segment's boundaries.
  const prefix=chunks.slice(0,-2),pcm=Buffer.concat(chunks.slice(-2).map(pcmData));
  if(pcm.length<30*32000)return[...prefix,pcmWav(pcm)];
  const split=Math.floor(pcm.length/4)*2;return[...prefix,pcmWav(pcm.subarray(0,split)),pcmWav(pcm.subarray(split))];
}

function extractAssessment(json) {
  const best=json?.NBest?.[0];
  const assessment=best?.PronunciationAssessment||best||{};
  const words=(best?.Words||[]).map(word=>{
    const detail=word?.PronunciationAssessment||word||{};
    return {
      word:String(word?.Word||'').trim(),
      accuracy:round1(detail.AccuracyScore),
      errorType:String(detail.ErrorType||'None')
    };
  }).filter(word=>word.word);
  return {
    accuracy:round1(assessment.AccuracyScore),
    fluency:round1(assessment.FluencyScore),
    prosody:round1(assessment.ProsodyScore),
    completeness:round1(assessment.CompletenessScore),
    pronScore:round1(assessment.PronScore),
    duration:Number(json?.Duration)||0,
    words
  };
}

function aggregate(chunks,{evidence}={}) {
  const usable=chunks.filter(item=>Number.isFinite(item?.fluency)||Number.isFinite(item?.accuracy));
  if(!usable.length) throw Error('Azure pronunciation assessment returned no usable delivery scores.');
  const weight=item=>item.weight>0?item.weight:1;
  const average=key=>{
    const rows=usable.filter(item=>Number.isFinite(item[key]));
    if(!rows.length)return null;
    const total=rows.reduce((sum,item)=>sum+weight(item),0);
    return round1(rows.reduce((sum,item)=>sum+item[key]*weight(item),0)/total);
  };
  const accuracy=average('accuracy'),fluency=average('fluency'),prosody=average('prosody'),completeness=average('completeness');
  // Pearson's Pronunciation and Oral Fluency are distinct traits. Keep them
  // separate instead of using Azure PronScore, which also mixes completeness.
  // Apply the Academy's independent-trait policy: a secondary prosody signal
  // must not create another penalty for otherwise clear sounds or connected flow.
  // Preserve native evidence and the disclosed acoustic mapping; no score bonus.
  const pronunciationRaw=accuracy;
  const fluencyRaw=fluency;
  const issues=[];
  for(const item of usable)for(const word of item.words||[]) {
    if(word.errorType!=='None'||(Number.isFinite(word.accuracy)&&word.accuracy<70))issues.push(word);
  }
  const weakest=usefulPracticeWords([...new Map(issues.sort((a,b)=>(a.accuracy??101)-(b.accuracy??101)).map(item=>[item.word.toLowerCase(),item])).values()]);
  const enough=evidence?.sufficient!==false;
  const evidenceText=evidence&&!enough
    ? (Number.isFinite(evidence.coverage)
      ? 'Only '+evidence.matchedWords+' of '+evidence.referenceWords+' reference words were matched in '+evidence.durationSeconds+' seconds.'
      : 'Only '+evidence.spokenWords+' words were available in '+evidence.durationSeconds+' seconds.')
    : '';
  return {
    deliveryVersion:VERSION,
    deliveryRubricVersion:DELIVERY_RUBRIC_VERSION,
    deliveryCalibration:'Independent Azure trait signals; prosody and weak-word flags are diagnostic only.',
    pronunciation:{
      score:enough?band5(pronunciationRaw):null,maximum:5,raw:pronunciationRaw,
      descriptor:enough?descriptor('pronunciation',band5(pronunciationRaw)):'',
      coaching:enough?coaching('pronunciation',{score:band5(pronunciationRaw),accuracy,prosody,words:weakest}):'',
      accuracy,prosody,completeness,words:weakest
    },
    fluency:{
      score:enough?band5(fluencyRaw):null,maximum:5,raw:fluencyRaw,
      descriptor:enough?descriptor('fluency',band5(fluencyRaw)):'',
      coaching:enough?coaching('fluency',{score:band5(fluencyRaw),fluency,prosody}):'',
      acousticFluency:fluency,prosody
    },
    deliveryEvidence:evidence||null,
    deliveryStatus:enough?'Audio assessed — PTE-style practice estimate':'Not enough speech for a reliable pronunciation or oral-fluency estimate. '+evidenceText,
    deliveryAssessment:enough
      ? 'Independent practice estimate from the saved recording; not Pearson scoring.'
      : 'Delivery scores are withheld when the response is too short or too incomplete to support a reliable PTE-style estimate.',
    deliveryProvider:'azure-speech-pronunciation'
  };
}

function suffixForMime(mime) {
  return {'audio/webm':'webm','audio/mp4':'mp4','audio/wav':'wav','audio/mpeg':'mp3'}[mime]||'bin';
}

async function splitToWav(recording,{directory,ffmpeg='ffmpeg'}={}) {
  const work=directory||await fs.mkdtemp(path.join(os.tmpdir(),'pte-delivery-'));
  const owned=!directory,source=path.join(work,'source.'+suffixForMime(recording.mime)),pattern=path.join(work,'chunk-%03d.wav');
  try {
    await fs.writeFile(source,Buffer.from(recording.data,'base64'));
    await run(ffmpeg,[
      '-hide_banner','-loglevel','error','-y','-i',source,'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',
      '-f','segment','-segment_time',String(CHUNK_SECONDS),'-reset_timestamps','1',pattern
    ],{timeout:60000,maxBuffer:1024*1024});
    const names=(await fs.readdir(work)).filter(name=>/^chunk-\d+\.wav$/.test(name)).sort();
    if(!names.length)throw Error('No assessable audio was produced.');
    const chunks=[];
    for(const name of names){const data=await fs.readFile(path.join(work,name));if(data.length>44)chunks.push(data);}
    return balanceShortTail(chunks);
  } finally {
    if(owned)await fs.rm(work,{recursive:true,force:true}).catch(()=>{});
  }
}

async function azureAssess(wav,reference,{apiKey=process.env.AZURE_SPEECH_KEY,endpoint=endpointFromEnv(),locale=process.env.AZURE_SPEECH_LOCALE||'en-AU',scripted=false,unscripted=false,request=fetch}={}) {
  if(!apiKey||!endpoint)throw Error('Azure Speech pronunciation assessment is not configured.');
  const config={
    ReferenceText:String(reference||'').trim(),
    GradingSystem:'HundredMark',
    Granularity:'Word',
    Dimension:'Comprehensive',
    ...(!unscripted?{EnableProsodyAssessment:'True'}:{}),
    ...(scripted?{EnableMiscue:true}:{})
  };
  if(!config.ReferenceText&&!unscripted)throw Error('No spoken words were available for delivery assessment.');
  const url=endpoint+(endpoint.includes('?')?'&':'?')+'language='+encodeURIComponent(String(locale||'en-AU'))+'&format=detailed';
  let response;try{response=await request(url,{
    method:'POST',
    headers:{
      'Ocp-Apim-Subscription-Key':apiKey,
      'Pronunciation-Assessment':Buffer.from(JSON.stringify(config),'utf8').toString('base64'),
      'Content-Type':CONTENT_TYPE,
      'Accept':'application/json'
    },
    body:wav,
    signal:AbortSignal.timeout(45000)
  });}catch{throw Object.assign(Error('Azure audio request could not be confirmed.'),{uncertain:true});}
  if(!response.ok){
    console.warn('[speaking-delivery-provider]',JSON.stringify({status:response.status}));
    const error=Error('Audio delivery assessment is temporarily unavailable.');
    error.providerStatus=response.status;
    throw error;
  }
  const json=await response.json();
  if(json?.RecognitionStatus&&json.RecognitionStatus!=='Success')throw Object.assign(Error('Azure Speech could not assess this audio.'),{code:'AZURE_RECOGNITION',recognitionStatus:json.RecognitionStatus});
  return extractAssessment(json);
}

async function assessRecording(recording,{
  transcribe,
  transcript='',
  question=null,
  apiKey=process.env.AZURE_SPEECH_KEY,
  endpoint=endpointFromEnv(),
  request=fetch,
  locale=process.env.AZURE_SPEECH_LOCALE||'en-AU',
  ffmpeg='ffmpeg',
  directory,
  chunkCache={},checkpointChunk=async()=>{},contentIndependent=false
}={}) {
  if(!recording?.data||!recording?.mime)throw Error('A saved recording is required for delivery assessment.');
  if(!apiKey||!endpoint)return null;
  const chunks=await splitToWav(recording,{directory,ffmpeg}),confirmed=String(transcript||'').trim(),confirmedWords=tokens(confirmed);
  const scriptedReference=['ra','rs'].includes(question?.type)?String(question?.text||'').trim():'';
  const results=[];let fallbackCursor=0,totalSeconds=0;
  for(let i=0;i<chunks.length;i++){
    const wav=chunks[i],chunkHash=require('node:crypto').createHash('sha256').update(wav).digest('hex'),cached=chunkCache[chunkHash]||{};let reference=cached.transcript||'',scripted=false;
    const seconds=wavSeconds(wav)||1;totalSeconds+=seconds;
    if(cached.result){results.push({...cached.result,weight:seconds});continue;}
    if(chunks.length===1&&scriptedReference){reference=scriptedReference;scripted=true;}
    else if(chunks.length===1&&confirmed)reference=confirmed;
    else if(!reference&&typeof transcribe==='function'){
      try{reference=String(await transcribe({mime:WAV_MIME,data:wav.toString('base64')})).trim();}catch{}
    }
    if(!reference&&confirmedWords.length){
      const remaining=confirmedWords.length-fallbackCursor,parts=chunks.length-i,take=Math.max(1,Math.ceil(remaining/parts));
      reference=confirmedWords.slice(fallbackCursor,fallbackCursor+take).join(' ');fallbackCursor+=take;
    }
    if(!reference)continue;
    await checkpointChunk(chunkHash,{transcript:reference});
    const assessed=await azureAssess(wav,reference,{apiKey,endpoint,locale,scripted,request});
    await checkpointChunk(chunkHash,{transcript:reference,result:assessed});
    assessed.weight=seconds;
    results.push(assessed);
  }
  return aggregate(results,{evidence:deliveryEvidence(question,confirmed,totalSeconds,{contentIndependent})});
}

module.exports={VERSION,CHUNK_SECONDS,endpointFromEnv,isConfigured,configurationSummary,band5,descriptor,coaching,usefulPracticeWords,tokens,lcsLength,deliveryEvidence,extractAssessment,aggregate,azureAssess,assessRecording,splitToWav,wavSeconds,pcmData,pcmWav,balanceShortTail};
