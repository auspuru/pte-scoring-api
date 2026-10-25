'use strict';
const providers=['gpt','azure'],traits=['pronunciation','fluency'];
const hasScore=trait=>['number','string'].includes(typeof trait?.score)&&String(trait.score).trim()!==''&&Number.isFinite(Number(trait.score))&&Number(trait.score)>=0&&Number(trait.score)<=5;
function effective(response,provider){
  const original=response?.[provider],overrides=response?.manualDeliveryOverrides?.[provider],patch={};
  if(!providers.includes(provider)||!response?.recording?.hash)return original;
  for(const trait of traits){const entry=overrides?.[trait];
    if(entry?.source==='instructor_override'&&entry.recordingHash===response.recording.hash&&entry.score===5){
      const {previousTrait,previousProviderStatus,recordingHash,operation,...display}=entry;patch[trait]={...display,manualOverride:true};
    }
  }
  return Object.keys(patch).length?{...(original||{}),...patch,status:Object.keys(patch).length===traits.length?'manual':'mixed',manualOverride:true,manualOverrideTraits:Object.keys(patch)}:original;
}
function complete(response,provider){const value=effective(response,provider);return !!value?.manualOverride&&traits.every(trait=>hasScore(value[trait]));}
async function fillMissingRepeatSentence({username,attemptId,operation,mockStore,now=Date.now,logger=console}={}){
  if(!require('./speaking-access').allowed(username)||typeof operation!=='string'||!/^[a-zA-Z0-9:_-]{1,120}$/.test(operation))throw Error('Invalid manual Repeat Sentence score scope.');
  await mockStore.update(username,attemptId,a=>{
    if(!a||a.status!=='submitted')throw Error('A saved submitted mock is required.');
    if(a.manualRsDeliveryOverride?.operation===operation)return a;
    const changes=[],at=now();
    for(const [index,q] of a.questions.entries()){
      const response=a.responses[index];if(q.type!=='rs'||!response?.recording?.hash)continue;
      for(const provider of providers)for(const trait of traits){
        if(hasScore(effective(response,provider)?.[trait]))continue;
        response.manualDeliveryOverrides||={};response.manualDeliveryOverrides[provider]||={};
        response.manualDeliveryOverrides[provider][trait]={status:'manual',score:5,maximum:5,source:'instructor_override',manualOverride:true,
          operation,recordingHash:response.recording.hash,assignedAt:at,assignedBy:'instructor',evidence:[],
          reason:'Full marks assigned manually by the instructor for a missing automated score.',coaching:'',
          previousTrait:structuredClone(response[provider]?.[trait]||null),previousProviderStatus:response[provider]?.status||null};
        changes.push({index,questionId:q.id,provider,trait,score:5,maximum:5});
      }
    }
    a.manualRsDeliveryOverride={operation,assignedAt:at,assignedBy:'instructor',changes};return a;
  });
  const saved=await mockStore.get(username,attemptId,{omitMockAudio:true});if(!saved)throw Error('Manual score verification failed.');
  const targets=saved.questions.flatMap((q,index)=>q.type==='rs'&&saved.responses[index]?.recording?.hash?[saved.responses[index]]:[]);
  const remaining=targets.reduce((count,response)=>count+providers.reduce((n,provider)=>n+traits.filter(trait=>!hasScore(effective(response,provider)?.[trait])).length,0),0);
  const changes=saved.manualRsDeliveryOverride?.operation===operation?saved.manualRsDeliveryOverride.changes:[];
  const report={operation,attemptId,status:remaining?'partial':'complete',rsQuestions:targets.length,updatedQuestions:new Set(changes.map(c=>c.index)).size,
    updatedTraits:changes.length,remainingMissing:remaining,overallScore:saved.overall?.overallScore??null,scores:changes};
  logger.info('[speaking-manual-rs-delivery]',JSON.stringify(report));return report;
}
module.exports={hasScore,effective,complete,fillMissingRepeatSentence};
