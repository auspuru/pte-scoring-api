'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

const VERSION = 'azure-delivery-2026-09-29.1';
const CHUNK_SECONDS = 28;
const WAV_MIME = 'audio/wav';
const CONTENT_TYPE = 'audio/wav; codecs=audio/pcm; samplerate=16000';

function endpointFromEnv(env=process.env) {
  const configured=String(env.AZURE_SPEECH_ENDPOINT||'').trim().replace(/\/+$/,'');
  if(configured) return configured.includes('/stt/speech/recognition/')
    ? configured
    : configured+'/stt/speech/recognition/conversation/cognitiveservices/v1';
  const resource=String(env.AZURE_SPEECH_RESOURCE||'').trim();
  if(resource&&!/^[a-zA-Z0-9-]+$/.test(resource)) return '';
  return resource ? 'https://'+resource+'.cognitiveservices.azure.com/stt/speech/recognition/conversation/cognitiveservices/v1' : '';
}

function isConfigured(env=process.env) {
  return !!(String(env.AZURE_SPEECH_KEY||'').trim() && endpointFromEnv(env));
}

function band5(raw) {
  const value=Number(raw);
  if(!Number.isFinite(value)) return null;
  if(value>=90)return 5;
  if(value>=80)return 4;
  if(value>=65)return 3;
  if(value>=50)return 2;
  if(value>=30)return 1;
  return 0;
}

function round1(value) {
  const n=Number(value);
  return Number.isFinite(n)?Math.round(n*10)/10:null;
}

function wavSeconds(buffer) {
  if(!Buffer.isBuffer(buffer)||buffer.length<44)return 0;
  const rate=buffer.readUInt32LE(28);
  return rate>0?Math.max(0,(buffer.length-44)/rate):0;
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

function aggregate(chunks) {
  const usable=chunks.filter(item=>Number.isFinite(item?.fluency)||Number.isFinite(item?.accuracy));
  if(!usable.length) throw Error('Azure pronunciation assessment returned no usable delivery scores.');
  const weight=item=>item.weight>0?item.weight:1;
  const average=key=>{
    const rows=usable.filter(item=>Number.isFinite(item[key]));
    if(!rows.length)return null;
    const total=rows.reduce((sum,item)=>sum+weight(item),0);
    return round1(rows.reduce((sum,item)=>sum+item[key]*weight(item),0)/total);
  };
  const accuracy=average('accuracy'),fluency=average('fluency'),prosody=average('prosody'),pronScore=average('pronScore');
  const issues=[];
  for(const item of usable)for(const word of item.words||[]) {
    if(word.errorType!=='None'||(Number.isFinite(word.accuracy)&&word.accuracy<70))issues.push(word);
  }
  const weakest=[...new Map(issues.sort((a,b)=>(a.accuracy??101)-(b.accuracy??101)).map(item=>[item.word.toLowerCase(),item])).values()].slice(0,8);
  const pronunciationRaw=Number.isFinite(pronScore)?pronScore:accuracy;
  return {
    deliveryVersion:VERSION,
    pronunciation:{
      score:band5(pronunciationRaw),maximum:5,raw:pronunciationRaw,
      accuracy,prosody,words:weakest
    },
    fluency:{score:band5(fluency),maximum:5,raw:fluency},
    deliveryStatus:'Audio assessed — PTE-style practice estimate',
    deliveryAssessment:'Independent practice estimate from the saved recording; not Pearson scoring.',
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
    return chunks;
  } finally {
    if(owned)await fs.rm(work,{recursive:true,force:true}).catch(()=>{});
  }
}

async function azureAssess(wav,reference,{apiKey=process.env.AZURE_SPEECH_KEY,endpoint=endpointFromEnv(),request=fetch}={}) {
  if(!apiKey||!endpoint)throw Error('Azure Speech pronunciation assessment is not configured.');
  const config={
    ReferenceText:String(reference||'').trim(),
    GradingSystem:'HundredMark',
    Granularity:'Word',
    Dimension:'Comprehensive',
    EnableProsodyAssessment:'True'
  };
  if(!config.ReferenceText)throw Error('No spoken words were available for delivery assessment.');
  const url=endpoint+(endpoint.includes('?')?'&':'?')+'language=en-US&format=detailed';
  const response=await request(url,{
    method:'POST',
    headers:{
      'Ocp-Apim-Subscription-Key':apiKey,
      'Pronunciation-Assessment':Buffer.from(JSON.stringify(config),'utf8').toString('base64'),
      'Content-Type':CONTENT_TYPE,
      'Accept':'application/json'
    },
    body:wav,
    signal:AbortSignal.timeout(45000)
  });
  if(!response.ok){
    console.warn('[speaking-delivery-provider]',JSON.stringify({status:response.status}));
    throw Error('Audio delivery assessment is temporarily unavailable.');
  }
  const json=await response.json();
  if(json?.RecognitionStatus&&json.RecognitionStatus!=='Success')throw Error('Azure Speech could not assess this audio.');
  return extractAssessment(json);
}

async function assessRecording(recording,{
  transcribe,
  transcript='',
  apiKey=process.env.AZURE_SPEECH_KEY,
  endpoint=endpointFromEnv(),
  request=fetch,
  ffmpeg='ffmpeg',
  directory
}={}) {
  if(!recording?.data||!recording?.mime)throw Error('A saved recording is required for delivery assessment.');
  if(!apiKey||!endpoint)return null;
  const chunks=await splitToWav(recording,{directory,ffmpeg}),confirmed=String(transcript||'').trim(),confirmedWords=confirmed.split(/\\s+/u).filter(Boolean);
  const results=[];let fallbackCursor=0;
  for(let i=0;i<chunks.length;i++){
    const wav=chunks[i];let reference='';
    if(chunks.length===1&&confirmed)reference=confirmed;
    else if(typeof transcribe==='function'){
      try{reference=String(await transcribe({mime:WAV_MIME,data:wav.toString('base64')})).trim();}catch{}
    }
    if(!reference&&confirmedWords.length){
      const remaining=confirmedWords.length-fallbackCursor,parts=chunks.length-i,take=Math.max(1,Math.ceil(remaining/parts));
      reference=confirmedWords.slice(fallbackCursor,fallbackCursor+take).join(' ');fallbackCursor+=take;
    }
    if(!reference)continue;
    const assessed=await azureAssess(wav,reference,{apiKey,endpoint,request});
    assessed.weight=wavSeconds(wav)||1;
    results.push(assessed);
  }
  return aggregate(results);
}

module.exports={VERSION,CHUNK_SECONDS,endpointFromEnv,isConfigured,band5,extractAssessment,aggregate,azureAssess,assessRecording,splitToWav,wavSeconds};
