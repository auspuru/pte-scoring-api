'use strict';
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const run=require('node:util').promisify(require('node:child_process').execFile);
const rubric=require('./delivery-rubric'),gpt=require('./gpt-speaking-delivery');
const VERSION='whole-speaking-audio-2026-10-25.1';
const PROMPT=`${rubric.instructions}
WHOLE SPEAKING MOCK: This is a new, blind assessment of ALL the supplied audio responses together. You receive only original student audio in order, never question prompts, task identities, reference answers, transcripts, per-question marks, earlier feedback, student identity or integrity events. Judge the student's demonstrated pronunciation and connected delivery across the full set. Listen to every response before judging. Do not average or reconstruct individual question scores. Do not allow a single atypically weak answer or a few isolated slips to define the whole test. Equally, do not ignore recurring difficulty across multiple responses, or cherry-pick the best response. Audio boundaries are separate answers, not fluency breaks; don't penalise the silence or change between files. Apply the same minor-slip and smooth-recovery policy throughout. Harmless slips, slight inaccuracies and smooth recoveries must not lower either trait or the overall band, even when similar harmless variations occur in several recordings. Do not accumulate harmless local observations into a whole-test weakness. A lower band needs actual recurring or sustained interference with intelligibility or connected delivery, not a preference for more polished or native-like speech. Do not assess content accuracy without the questions.
Return record_mock_delivery with assessable, overallScore, summary, pronunciation and fluency. overallScore is a direct holistic speaking-delivery practice estimate from 10 to 90, NOT a sum/average/conversion of question marks or trait marks and NOT a Pearson score or verified prediction. Use 85–90 for consistently clear, connected delivery across the set with only harmless minor slips; 75–84 for generally strong delivery with noticeable recurring limitations; 60–74 for generally understandable but uneven delivery; 40–59 for frequent difficulty; 10–39 for pervasive difficulty understanding or following speech. If both whole-test traits are 5 with clear/minor_slips and no overall impact, the overall must stay in the 85–90 top band; do not invent a separate penalty or automatically cap clear speech below 90 because it contains minor slips. Choose the exact estimate by the quality and extent of the demonstrated pattern, not an error count. This is a consistency check on this independent whole-test review, never a conversion of individual question marks. The two /5 traits also describe the WHOLE set. Any recurring or sustained difficulty used to lower a whole-test trait must be evidenced in at least two DIFFERENT recordings, with recording, start and end identifying the actual observations. A single weak answer alone does not establish a whole-test recurring weakness. For a sustained-difficulty judgment explain its extent across the set rather than using one unusually poor response to characterize every answer. Evidence timestamps are relative to the specified recording, whose indices start at 1. Keep summary under 60 words and give one achievable next step per trait. If assessable speech across the set is insufficient, use assessable=false, overallScore=null and unassessed traits. Never treat a recording fault as poor speaking.`;
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
  item.properties.recording={type:'integer',enum:durations.map((_,i)=>i+1),description:'The numbered student recording containing this evidence; use its local start/end times.'};item.required.push('recording');
  for(const name of ['start','end'])item.properties[name].description='Seconds from the start of this numbered recording, bounded by that recording duration. Never use the cumulative time of the complete mock.';
  return {type:'object',additionalProperties:false,required:['assessable','overallScore','summary','pronunciation','fluency'],properties:{
    assessable:{type:'boolean'},overallScore:{type:['integer','null'],minimum:10,maximum:90},summary:{type:'string',maxLength:1000},pronunciation:trait,fluency:trait
  }};
}
function normalize(raw,durations){
  if(typeof raw?.assessable!=='boolean'||typeof raw.summary!=='string'||!raw.summary.trim()||raw.summary.length>1000)throw Error('Incomplete whole-test audio review.');
  const total=durations.reduce((s,n)=>s+n,0),assessment={},prepared=rubric.normalizeDelivery(raw);
  for(const name of ['pronunciation','fluency']){
    const trait=prepared[name];if(!trait||!Array.isArray(trait.evidence))throw Error('Incomplete whole-test audio review.');
    const clips=new Set();
    const evidence=trait.evidence.map(e=>{
      const i=e?.recording-1;
      if(!Number.isInteger(i)||i<0||i>=durations.length||!Number.isFinite(e.start)||!Number.isFinite(e.end)||e.start<0||e.end<=e.start||e.end>durations[i]+.01){
        const number=value=>Number.isFinite(value)?value:null;
        throw Object.assign(Error('Unsupported whole-test audio evidence.'),{code:'WHOLE_VALIDATION',evidenceIssue:{trait:name,recording:number(i+1),start:number(e?.start),end:number(e?.end),durationSeconds:number(durations[i]),reason:!Number.isInteger(i)||i<0||i>=durations.length?'recording_index':'timestamp_range'}});
      }
      if(e.kind==='score-impact')clips.add(i);
      const offset=durations.slice(0,i).reduce((s,n)=>s+n,0);return {...e,start:e.start+offset,end:e.end+offset};
    });
    if(trait.status==='scored'&&trait.score<5&&clips.size<2)throw Error('A single answer cannot establish a whole-test recurring weakness.');
    assessment[name]={...trait,evidence};
  }
  const validated=gpt.normalize(assessment,{sufficient:true,durationSeconds:total});
  if(raw.assessable&&(!Number.isInteger(raw.overallScore)||raw.overallScore<10||raw.overallScore>90||validated.pronunciation.score==null||validated.fluency.score==null))throw Error('Unverified whole-test speaking estimate.');
  if(!raw.assessable&&(raw.overallScore!==null||validated.pronunciation.score!==null||validated.fluency.score!==null))throw Error('Unverified whole-test speaking estimate.');
  // A blind holistic estimate must agree with its own evidence, without ever
  // comparing, averaging or importing individual-question marks.
  if(raw.assessable&&raw.overallScore<85&&validated.pronunciation.score===5&&validated.fluency.score===5)
    throw Object.assign(Error('The overall band contradicts the clear whole-test delivery assessment.'),{code:'WHOLE_VALIDATION',validationIssue:'overall_band_conflict'});
  return {...validated,scope:'whole-test',version:VERSION,status:raw.assessable?'assessed':'unassessed',overallScore:raw.overallScore,maximum:90,summary:raw.summary,
    assessment:'Independent whole-test speaking-delivery estimate; not Pearson scoring.',recordingCount:durations.length,
    ...Object.fromEntries(['pronunciation','fluency'].map(name=>[name,{...validated[name],evidence:prepared[name].evidence}]))};
}
function parseReview(choice,durations){
  if(choice?.message?.refusal)throw Object.assign(Error('The whole-test audio review was not completed.'),{code:'WHOLE_REFUSAL'});
  const calls=choice?.message?.tool_calls;let text;
  // Audio models can label a complete function call with finish_reason=stop.
  // Match the individual audio scorer and still validate the complete judgment.
  if(['stop','tool_calls'].includes(choice?.finish_reason)&&calls?.length===1&&calls[0]?.function?.name==='record_mock_delivery')text=calls[0].function.arguments;
  else if(choice?.finish_reason==='stop'&&!calls?.length&&typeof choice?.message?.content==='string')text=choice.message.content.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i,'$1');
  else throw Object.assign(Error('Incomplete whole-test audio review.'),{code:choice?.finish_reason==='length'?'WHOLE_TRUNCATED':'WHOLE_INCOMPLETE'});
  try{return normalize(JSON.parse(text),durations);}
  catch(error){error.code||='WHOLE_VALIDATION';throw error;}
}
function diagnostic(error){
  const safe=value=>typeof value==='string'&&/^[a-zA-Z0-9_.\[\]-]{1,100}$/.test(value)?value:undefined;
  return {code:safe(error?.code)||safe(error?.name)||'unknown',
    ...(Number.isInteger(error?.providerStatus)?{providerStatus:error.providerStatus}:{}),
    ...(safe(error?.providerCode)?{providerCode:error.providerCode}:{}),...(safe(error?.providerParam)?{providerParam:error.providerParam}:{}),
    ...(error?.providerMessage?{providerMessage:error.providerMessage}:{}),
    ...(error?.evidenceIssue?{evidenceIssue:error.evidenceIssue}:{}),
    ...(error?.code==='WHOLE_VALIDATION'?{validationIssue:safe(error.validationIssue)||(/single answer/.test(error.message)?'single_answer_pattern':/evidence/.test(error.message)?'audio_evidence':'assessment_contract')}:{})};
}
async function assess(recordings,{expectedCount=recordings.length,apiKey=process.env.OPENAI_API_KEY,request=fetch,convert=compress}={}){
  if(!apiKey)throw Error('Whole-test audio review is not configured.');
  if(!recordings.length||recordings.length<Math.ceil(expectedCount*.8))return {version:VERSION,status:'unassessed',overallScore:null,summary:'There are too few saved responses for a reliable whole-test speaking estimate.'};
  const clips=[];for(const recording of recordings)clips.push(await convert(recording));
  if(clips.reduce((s,c)=>s+c.seconds,0)<60)return {version:VERSION,status:'unassessed',overallScore:null,summary:'There is too little recorded speech for a reliable whole-test speaking estimate.'};
  if(clips.reduce((s,c)=>s+c.data.length,0)>24*1024*1024)throw Error('The saved mock audio is too large for one complete review.');
  const durations=clips.map(c=>c.seconds);
  const audioContent=[{type:'text',text:JSON.stringify({recordingDurations:durations})},...clips.flatMap((c,i)=>[
    {type:'text',text:JSON.stringify({recording:i+1,durationSeconds:c.seconds,timeOrigin:'start_of_this_recording'})},
    {type:'input_audio',input_audio:{data:c.data,format:'mp3'}}
  ])];
  let correction;
  for(let attempt=0;attempt<2;attempt++){
   const response=await request('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},signal:AbortSignal.timeout(180000),
    body:JSON.stringify({model:gpt.MODEL,modalities:['text'],temperature:0,max_completion_tokens:attempt?5400:3600,store:false,
      tools:[{type:'function',function:{name:'record_mock_delivery',description:'Assess the complete set of original audio responses holistically, without question marks or metadata.',parameters:schema(durations)}}],
      tool_choice:{type:'function',function:{name:'record_mock_delivery'}},parallel_tool_calls:false,
      messages:[{role:'system',content:PROMPT},{role:'user',content:[...audioContent,...(correction?[{type:'text',text:correction}]:[])]}]})});
  if(!response.ok){
    const error=Object.assign(Error('Whole-test audio assessment is temporarily unavailable.'),{code:'WHOLE_PROVIDER',providerStatus:response.status});
    try{const body=await response.json(),detail=body?.error;
      error.providerCode=detail?.code;error.providerParam=detail?.param;
      if(typeof detail?.message==='string')error.providerMessage=detail.message.replace(/(?:sk-|Bearer\s+)[A-Za-z0-9_-]+/g,'[credential]').replace(/[A-Za-z0-9+/=]{50,}/g,'[audio-data]').slice(0,500);
    }catch{}throw error;
  }
   const data=await response.json();
   try{return {...parseReview(data.choices?.[0],durations),providerCalls:attempt+1};}
   catch(error){
     if(attempt||error.code!=='WHOLE_VALIDATION')throw error;
     const issue=diagnostic(error);
     console.warn('[speaking-mock-overall-repair]',JSON.stringify({attempt:attempt+1,...issue}));
     correction='VALIDATION REPAIR: The prior whole-test review was not saved because its audio evidence failed validation: '+JSON.stringify(issue)+'. Reassess ALL the supplied recordings independently. No prior score is supplied. A validation failure is not a speaking weakness. Use each recording label and exact duration. Evidence start/end are seconds local to that numbered recording, never cumulative across files. Cite only brief audible passages inside those bounds. Preserve the whole-test rubric, and do not infer an overall mark from individual question metadata.';
   }
  }
}
module.exports={VERSION,PROMPT,compress,schema,normalize,parseReview,diagnostic,assess};
