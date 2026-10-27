'use strict';
const azure=require('./speaking-delivery');
const VERSION='azure-whole-audio-2026-10-25.2';
// These are fresh Azure acoustic chunks, never stored question marks. Azure
// does not provide GPT's holistic review or a calibrated PTE /90 estimate.
const pcm=azure.pcmData,balanceTail=azure.balanceShortTail;
function silent(wav){const data=pcm(wav);for(let i=0;i+1<data.length;i+=2)if(Math.abs(data.readInt16LE(i))>16)return false;return true;}
function summarize(chunks,{recordingCount,expectedCount,assessedRecordings,audioSeconds}={}){
  if(recordingCount!==expectedCount||assessedRecordings!==recordingCount||!chunks.length)throw Object.assign(Error('Azure needs assessable audio from every saved response.'),{code:'AZURE_COVERAGE',coverage:{recordingCount,assessedRecordings,expectedCount}});
  for(const c of chunks)for(const key of ['accuracy','fluency','seconds'])if(!Number.isFinite(c[key])||c[key]<0||(key==='seconds'?c[key]===0:c[key]>100))throw Error('Incomplete Azure whole-audio measurements.');
  const seconds=chunks.reduce((s,c)=>s+c.seconds,0),mean=key=>Math.round(chunks.reduce((s,c)=>s+c[key]*c.seconds,0)/seconds*10)/10;
  const pronunciation=mean('accuracy'),fluency=mean('fluency');
  const trait=raw=>({status:'scored',raw,rawMaximum:100,score:azure.band5(raw),maximum:5});
  return {status:'assessed',version:VERSION,provider:'azure-speech-pronunciation',scope:'whole-test-acoustic-summary',
    pronunciation:trait(pronunciation),fluency:trait(fluency),recordingCount,chunkCount:chunks.length,audioSeconds:Math.round(audioSeconds*10)/10,
    assessedSeconds:Math.round(seconds*10)/10,aggregation:'duration-weighted-fresh-audio-chunks',
    summary:'Fresh Azure assessment of all saved responses. Native accuracy and fluency are combined by assessed audio duration; saved question scores and manual overrides are excluded.',
    assessment:'Azure acoustic summary, not a holistic GPT judgment or Pearson score. The /5 bands use the portal acoustic mapping; no /90 score is inferred.'};
}
async function assess(recordings,{expectedCount=recordings.length,split=azure.splitToWav,measure=azure.azureAssess,...options}={}){
  if(!recordings.length||recordings.length!==expectedCount)throw Error('All original mock recordings are required for Azure overall assessment.');
  const tasks=[];let audioSeconds=0;
  for(let i=0;i<recordings.length;i++){
    // Whitelist audio only. Callers cannot leak marks, prompts or transcripts.
    const {mime,data}=recordings[i],parts=balanceTail(await split({mime,data}));
    for(const wav of parts){
      const seconds=azure.wavSeconds(wav);audioSeconds+=seconds;
      if(seconds<=0||seconds>=30)throw Object.assign(Error('Azure audio chunks must stay below 30 seconds.'),{code:'AZURE_CHUNK_DURATION'});
      if(!silent(wav))tasks.push({wav,recording:i,seconds});
    }
  }
  if(audioSeconds<60)throw Error('There is too little saved audio for an Azure whole-test summary.');
  const rows=[],seen=new Set();let cursor=0,failure;
  const worker=async()=>{while(!failure&&cursor<tasks.length){const task=tasks[cursor++];try{
    const result=await measure(task.wav,'',{...options,scripted:false,unscripted:true});
    if(!Number.isFinite(result?.accuracy)||!Number.isFinite(result?.fluency))throw Object.assign(Error('Azure did not return both acoustic traits.'),{code:'AZURE_TRAITS'});
    const recognizedSeconds=result.duration>0?result.duration/1e7:task.seconds;
    if(recognizedSeconds>task.seconds+.5)throw Object.assign(Error('Invalid Azure audio duration.'),{code:'AZURE_RECOGNIZED_DURATION'});
    rows.push({accuracy:result.accuracy,fluency:result.fluency,seconds:recognizedSeconds});seen.add(task.recording);
  }catch(error){failure=Object.assign(Error(error.message),{code:error.name==='TimeoutError'?'AZURE_TIMEOUT':error.code,providerStatus:error.providerStatus,recognitionStatus:error.recognitionStatus,
    audioSection:{recording:task.recording+1,section:tasks.indexOf(task)+1,seconds:Math.round(task.seconds*100)/100}});}}};
  await Promise.all([worker(),worker()]);if(failure)throw failure;
  return {...summarize(rows,{recordingCount:recordings.length,expectedCount,assessedRecordings:seen.size,audioSeconds}),locale:options.locale||process.env.AZURE_SPEECH_LOCALE||'en-AU'};
}
module.exports={VERSION,pcm,silent,balanceTail,summarize,assess};
