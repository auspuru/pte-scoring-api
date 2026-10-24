'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {promisify} = require('node:util');
const run = promisify(require('node:child_process').execFile);
const azure = require('./speaking-delivery');
const rubric = require('./delivery-rubric');
const MODEL = process.env.OPENAI_SPEAKING_AUDIO_MODEL || 'gpt-audio-1.5';
const VERSION = 'gpt-delivery-2026-10-24.2:' + MODEL;
const applies = question => ['rl','sgd'].includes(question?.type);
const isConfigured = (env=process.env) => !!String(env.OPENAI_API_KEY||'').trim();

const PROMPT = rubric.instructions;

function wavDuration(wav) {
  if(!Buffer.isBuffer(wav)||wav.length<44||wav.toString('ascii',0,4)!=='RIFF')throw Error('Invalid converted audio.');
  let rate=0;
  for(let offset=12;offset+8<=wav.length;){
    const tag=wav.toString('ascii',offset,offset+4),size=wav.readUInt32LE(offset+4),start=offset+8;
    if(tag==='fmt '&&size>=16&&start+16<=wav.length)rate=wav.readUInt32LE(start+8);
    if(tag==='data'&&rate>0)return Math.min(size,wav.length-start)/rate;
    offset=start+size+(size%2);
  }
  throw Error('Converted audio has no usable speech data.');
}

async function toWav(recording,{ffmpeg='ffmpeg'}={}) {
  const extensions={'audio/webm':'webm','audio/mp4':'mp4','audio/wav':'wav','audio/mpeg':'mp3'};
  if(!recording?.data||!extensions[recording.mime])throw Error('A saved recording is required for GPT audio assessment.');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pte-gpt-delivery-'));
  try {
    const source=path.join(directory,'source.'+extensions[recording.mime]),target=path.join(directory,'response.wav');
    await fs.writeFile(source,Buffer.from(recording.data,'base64'));
    await run(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',source,'-t','131','-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',target],{timeout:30000,maxBuffer:1024*1024});
    const wav=await fs.readFile(target),seconds=wavDuration(wav);
    if(seconds>130)throw Error('The recording exceeds the supported response duration.');
    return {wav,seconds};
  } finally {await fs.rm(directory,{recursive:true,force:true}).catch(()=>{});}
}

function normalize(raw,evidence,{model=MODEL}={}) {
  const data=rubric.normalizeDelivery(raw),traits={},failed=[];
  for(const kind of ['pronunciation','fluency']){
    let verified;
    try {verified=rubric.validateDelivery({pronunciation:data?.[kind],fluency:data?.[kind]},evidence.durationSeconds)[kind];}
    catch {failed.push(kind);verified=rubric.unavailableDelivery('The '+kind+' assessment could not be verified from audio evidence.')[kind];}
    const scored=evidence.sufficient&&verified.status==='scored';
    traits[kind]={...verified,score:scored?verified.score:null,status:scored?'scored':'unassessed',maximum:5,
      descriptor:scored?azure.descriptor(kind,verified.score):'',coaching:verified.nextStep||'',evidence:scored?verified.evidence:[]};
  }
  if(failed.length===2)throw Error('Incomplete GPT audio assessment.');
  const enough=evidence.sufficient&&Object.values(traits).some(t=>t.score!==null);
  return {deliveryVersion:VERSION,deliveryProvider:'openai-gpt-audio',deliveryModel:model,
    pronunciation:traits.pronunciation,fluency:traits.fluency,deliveryRubricVersion:rubric.RUBRIC_VERSION,
    deliveryEvidence:{...evidence,sufficient:enough},...(failed.length?{deliveryFailureTraits:failed}:{}),
    deliveryStatus:failed.length?'One audio trait could not be verified; the companion score is retained.':enough?'Audio assessed — GPT practice estimate':'Not enough speech for a reliable GPT delivery estimate.',
    deliveryAssessment:'Independent audio-based practice estimate from GPT; not Pearson scoring.'};
}

async function assessRecording(recording,{question,transcript='',apiKey=process.env.OPENAI_API_KEY,model=MODEL,request=fetch,convert=toWav}={}) {
  if(!apiKey)throw Error('GPT audio assessment is not configured.');
  const {wav,seconds}=await convert(recording);
  const evidence=azure.deliveryEvidence(question,transcript,seconds);
  if(!evidence.sufficient)return {deliveryVersion:VERSION,deliveryProvider:'openai-gpt-audio',deliveryModel:model,
    pronunciation:{score:null,maximum:5},fluency:{score:null,maximum:5},deliveryEvidence:evidence,
    deliveryStatus:'Not enough speech for a reliable GPT delivery estimate.',deliveryAssessment:'Delivery scores are withheld when there is insufficient speech.'};
  const response=await request('https://api.openai.com/v1/chat/completions',{
    method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},signal:AbortSignal.timeout(45000),
    body:JSON.stringify({model,modalities:['text'],temperature:0,max_completion_tokens:1800,store:false,
      tools:[{type:'function',function:{name:'record_delivery_assessment',description:'Return independent audio-based pronunciation and fluency scores with timestamped strengths, optional refinements and explicit audible impacts for deductions.',parameters:rubric.deliverySchema(seconds)}}],
      tool_choice:{type:'function',function:{name:'record_delivery_assessment'}},parallel_tool_calls:false,messages:[
      {role:'system',content:PROMPT},
      {role:'user',content:[{type:'text',text:'DATA='+JSON.stringify({task:question?.type,durationSeconds:seconds})},
        {type:'input_audio',input_audio:{data:wav.toString('base64'),format:'wav'}}]}
    ]})
  });
  if(!response.ok){const error=Error('GPT audio assessment is temporarily unavailable.');error.providerStatus=response.status;throw error;}
  const json=await response.json(),choice=json?.choices?.[0];
  const raw=rubric.deliveryData(choice);
  return normalize(raw,evidence,{model});
}

module.exports={MODEL,VERSION,PROMPT,applies,isConfigured,wavDuration,toWav,normalize,assessRecording};
