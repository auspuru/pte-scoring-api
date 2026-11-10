'use strict';
const {randomUUID,createHash}=require('node:crypto');
const VERSION='speaking-mock-pause-v1';
const fail=(message,status=409)=>Object.assign(Error(message),{status});
function pause(a,at,{hasPartial=false,audioPositionSeconds}={}){
  if(a?.pause)return a;
  if(a?.status!=='active'||!Number.isFinite(a.deadline)||at>=a.deadline)throw fail('This mock has already finished.');
  const remainingMs=a.deadline-at;
  if(!Number.isSafeInteger(remainingMs)||remainingMs<=0)throw fail('This mock has already finished.');
  const audioSeconds=a.questions?.[a.index]?.audioSeconds||0;
  const audioPosition=audioPositionSeconds==null?NaN:Number(audioPositionSeconds);
  a.pause={version:VERSION,id:randomUUID(),at,remainingMs,index:a.index,
    ...(Number.isFinite(audioPosition)&&audioPosition>=0&&audioPosition<=audioSeconds+1?{audioPositionSeconds:audioPosition}:{}),
    partialPending:hasPartial===true&&!a.responses?.[a.index]?.recording};
  a.deadline=null;
  return a;
}
function resume(a,at,{pauseId}={}){
  if(typeof pauseId!=='string'||!pauseId)throw fail('Select the saved pause before continuing.');
  if(!a?.pause){if(a?.lastResumedPause===pauseId)return a;throw fail('This mock is not paused.');}
  const p=a.pause;
  if(p.version!==VERSION||p.id!==pauseId||p.index!==a.index||p.partialPending)throw fail('Save the paused recording before continuing.');
  const elapsed=at-p.at;
  if(!Number.isSafeInteger(elapsed)||elapsed<0)throw fail('The saved pause time changed.');
  a.deadline=at+p.remainingMs;
  if(Number.isFinite(a.questionStartedAt))a.questionStartedAt+=elapsed;
  if(Number.isFinite(a.promptFinishedAt))a.promptFinishedAt+=elapsed;
  if(Number.isFinite(p.audioPositionSeconds)&&!a.promptFinishedAt)a.resumedAudio={index:p.index,positionSeconds:p.audioPositionSeconds,at};
  a.lastResumedPause=p.id;delete a.pause;
  return a;
}
function saveFragment(a,index,pauseId,bytes,mime){
  const p=a?.pause,r=a?.responses?.[index];
  if(p?.version!==VERSION||p.index!==index||p.id!==pauseId||a.status!=='active')throw fail('This paused question changed.');
  const hash=bytes?.length?createHash('sha256').update(bytes).digest('hex'):null;
  const prior=r?.fragments?.find(part=>part.pauseId===pauseId);
  if(prior){if(prior.hash!==hash)throw fail('The saved recording fragment cannot be replaced.');return a;}
  if(!p.partialPending)throw fail('This recording fragment is not expected.');
  if(bytes?.length&&(!Buffer.isBuffer(bytes)||bytes.length>3*1024*1024||bytes.length<100
    ||!['audio/webm','audio/mp4','audio/wav','audio/mpeg'].includes(mime)))throw fail('Invalid recording fragment.',400);
  a.responses[index]||={};a.responses[index].fragments||=[];
  if(a.responses[index].fragments.length>=32)throw fail('Too many recording interruptions. Contact support.');
  a.responses[index].fragments.push({pauseId,hash,mime:hash?mime:null,data:hash?bytes.toString('base64'):null});
  p.partialPending=false;
  return a;
}
async function mergedRecording(fragments,final,mime){
  if(!fragments?.some(part=>part.hash))return {mime,data:final.toString('base64'),hash:createHash('sha256').update(final).digest('hex')};
  const delivery=require('./speaking-delivery'),parts=[...fragments.filter(part=>part.hash).map(part=>({mime:part.mime,data:part.data})),{mime,data:final.toString('base64')}];
  const pcm=[];
  for(const part of parts)for(const wav of await delivery.splitToWav(part))pcm.push(delivery.pcmData(wav));
  const bytes=delivery.pcmWav(Buffer.concat(pcm));
  return {mime:'audio/wav',data:bytes.toString('base64'),hash:createHash('sha256').update(bytes).digest('hex'),
    finalHash:createHash('sha256').update(final).digest('hex'),fragmentCount:fragments.filter(part=>part.hash).length};
}
module.exports={VERSION,pause,resume,saveFragment,mergedRecording};
