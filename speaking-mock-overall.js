'use strict';
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const run=require('node:util').promisify(require('node:child_process').execFile);
const rubric=require('./delivery-rubric'),gpt=require('./gpt-speaking-delivery');
const VERSION='whole-speaking-audio-2026-10-24.1';
const PROMPT=`${rubric.instructions}
WHOLE SPEAKING MOCK: This is a new, blind assessment of ALL the supplied audio responses together. You receive only original student audio in order, never question prompts, task identities, reference answers, transcripts, per-question marks, earlier feedback, student identity or integrity events. Judge the student's demonstrated pronunciation and connected delivery across the full set. Listen to every response before judging. Do not average or reconstruct individual question scores. Do not allow a single atypically weak answer or a few isolated slips to define the whole test. Equally, do not ignore recurring difficulty across multiple responses, or cherry-pick the best response. Audio boundaries are separate answers, not fluency breaks; don't penalise the silence or change between files. Apply the same minor-slip and smooth-recovery policy throughout. Do not assess content accuracy without the questions.
Return record_mock_delivery with assessable, overallScore, summary, pronunciation and fluency. overallScore is a direct holistic speaking-delivery practice estimate from 10 to 90, NOT a sum/average/conversion of question marks or trait marks and NOT a Pearson score or verified prediction. Use 85–90 for consistently clear, connected delivery across the set with only harmless minor slips; 75–84 for generally strong delivery with noticeable recurring limitations; 60–74 for generally understandable but uneven delivery; 40–59 for frequent difficulty; 10–39 for pervasive difficulty understanding or following speech. Choose the exact estimate by the quality and extent of the demonstrated pattern, not an error count. The two /5 traits also describe the WHOLE set. Any recurring or sustained difficulty used to lower a whole-test trait must be evidenced in at least two DIFFERENT recordings, with recording, start and end identifying the actual observations. A single weak answer alone does not establish a whole-test recurring weakness. For a sustained-difficulty judgment explain its extent across the set rather than using one unusually poor response to characterize every answer. Evidence timestamps are relative to the specified recording, whose indices start at 1. Keep summary under 60 words and give one achievable next step per trait. If assessable speech across the set is insufficient, use assessable=false, overallScore=null and unassessed traits. Never treat a recording fault as poor speaking.`;
async function compress(recording){
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'pte-mock-audio-'));
  try{
    const {wav,seconds}=await gpt.toWav(recording),input=path.join(folder,'response.wav'),output=path.join(folder,'response.mp3');
    await fs.writeFile(input,wav);
    await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',input,'-ac','1','-ar','16000','-b:a','48k',output],{timeout:30000,maxBuffer:1024*1024});
    return {data:(await fs.readFile(output)).toString('base64'),seconds};
  }finally{await fs.rm(folder,{recursive:true,force:true}).catch(()=>{});}
}
function schema(durations){
  const total=durations.reduce((s,n)=>s+n,0),base=rubric.deliverySchema(total);
  const trait=structuredClone(base.properties.pronunciation);
  const item=trait.properties.evidence.items;
  item.properties.recording={type:'integer',minimum:1,maximum:durations.length};item.required.push('recording');
  return {type:'object',additionalProperties:false,required:['assessable','overallScore','summary','pronunciation','fluency'],properties:{
    assessable:{type:'boolean'},overallScore:{type:['integer','null'],minimum:10,maximum:90},summary:{type:'string',maxLength:1000},pronunciation:trait,fluency:trait
  }};
}
function normalize(raw,durations){
  if(typeof raw?.assessable!=='boolean'||typeof raw.summary!=='string'||!raw.summary.trim()||raw.summary.length>1000)throw Error('Incomplete whole-test audio review.');
  const total=durations.reduce((s,n)=>s+n,0),assessment={};
  for(const name of ['pronunciation','fluency']){
    const trait=raw[name];if(!trait||!Array.isArray(trait.evidence))throw Error('Incomplete whole-test audio review.');
    const clips=new Set();
    const evidence=trait.evidence.map(e=>{
      const i=e.recording-1;if(!Number.isInteger(i)||i<0||i>=durations.length||e.start<0||e.end>durations[i]+.01)throw Error('Unsupported whole-test audio evidence.');
      if(e.kind==='score-impact')clips.add(i);
      const offset=durations.slice(0,i).reduce((s,n)=>s+n,0);return {...e,start:e.start+offset,end:e.end+offset};
    });
    if(trait.status==='scored'&&trait.score<5&&clips.size<2)throw Error('A single answer cannot establish a whole-test recurring weakness.');
    assessment[name]={...trait,evidence};
  }
  const validated=gpt.normalize(assessment,{sufficient:true,durationSeconds:total});
  if(raw.assessable&&(!Number.isInteger(raw.overallScore)||raw.overallScore<10||raw.overallScore>90||validated.pronunciation.score==null||validated.fluency.score==null))throw Error('Unverified whole-test speaking estimate.');
  if(!raw.assessable&&(raw.overallScore!==null||validated.pronunciation.score!==null||validated.fluency.score!==null))throw Error('Unverified whole-test speaking estimate.');
  return {...validated,scope:'whole-test',version:VERSION,status:raw.assessable?'assessed':'unassessed',overallScore:raw.overallScore,maximum:90,summary:raw.summary,
    assessment:'Independent whole-test speaking-delivery estimate; not Pearson scoring.',recordingCount:durations.length,
    ...Object.fromEntries(['pronunciation','fluency'].map(name=>[name,{...validated[name],evidence:raw[name].evidence}]))};
}
async function assess(recordings,{expectedCount=recordings.length,apiKey=process.env.OPENAI_API_KEY,request=fetch,convert=compress}={}){
  if(!apiKey)throw Error('Whole-test audio review is not configured.');
  if(!recordings.length||recordings.length<Math.ceil(expectedCount*.8))return {version:VERSION,status:'unassessed',overallScore:null,summary:'There are too few saved responses for a reliable whole-test speaking estimate.'};
  const clips=[];for(const recording of recordings)clips.push(await convert(recording));
  if(clips.reduce((s,c)=>s+c.seconds,0)<60)return {version:VERSION,status:'unassessed',overallScore:null,summary:'There is too little recorded speech for a reliable whole-test speaking estimate.'};
  if(clips.reduce((s,c)=>s+c.data.length,0)>24*1024*1024)throw Error('The saved mock audio is too large for one complete review.');
  const durations=clips.map(c=>c.seconds);
  const response=await request('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},signal:AbortSignal.timeout(180000),
    body:JSON.stringify({model:gpt.MODEL,modalities:['text'],temperature:0,max_completion_tokens:3600,store:false,
      tools:[{type:'function',function:{name:'record_mock_delivery',description:'Assess the complete set of original audio responses holistically, without question marks or metadata.',parameters:schema(durations)}}],
      tool_choice:{type:'function',function:{name:'record_mock_delivery'}},parallel_tool_calls:false,
      messages:[{role:'system',content:PROMPT},{role:'user',content:[{type:'text',text:JSON.stringify({recordingDurations:durations})},...clips.map(c=>({type:'input_audio',input_audio:{data:c.data,format:'mp3'}}))]}]})});
  if(!response.ok)throw Error('Whole-test audio assessment is temporarily unavailable.');
  const data=await response.json(),choice=data.choices?.[0],calls=choice?.message?.tool_calls;
  if(choice?.finish_reason!=='tool_calls'||calls?.length!==1||calls[0]?.function?.name!=='record_mock_delivery')throw Error('Incomplete whole-test audio review.');
  return normalize(JSON.parse(calls[0].function.arguments),durations);
}
module.exports={VERSION,PROMPT,compress,schema,normalize,assess};
