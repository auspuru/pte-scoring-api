'use strict';
const crypto=require('node:crypto'),bank=require('./content/speaking-bank'),scoring=require('./speaking-scoring');
const confirmed=r=>Number.isFinite(r?.total)&&r.scoringMode!=='local'&&!r.score_provisional&&!r.needs_semantic_review;
const deliveryKeys=['pronunciation','fluency','deliveryVersion','deliveryEvidence','deliveryStatus','deliveryAssessment','deliveryProvider','deliveryModel','deliveryObservation','deliveryComparisons','deliveryRubricVersion','deliveryCalibration','deliveryFailureTraits','deliveryComparisonHistory','deliveryRequestedModel'];
async function recoverLatest({username,operation,practiceStore,mockStore,callModel,transcribe,logger=console,now=Date.now}){
 if(!require('./speaking-access').allowed(username)||!operation||operation.length>120)throw Error('Invalid content repair scope.');
 const lists=await Promise.all([practiceStore.list(username),mockStore.list(username)]);
 const completed=lists.flat().find(a=>a.contentRecovery?.operation===operation);
 if(completed){logger.info('[speaking-content-recovery]',JSON.stringify({operation,attemptId:completed.id,status:'already-run'}));return completed.contentRecovery;}
 const choices=lists.flatMap((rows,kind)=>rows.filter(a=>a.status==='submitted').map(a=>({kind,id:a.id,startedAt:a.startedAt}))).sort((a,b)=>b.startedAt-a.startedAt);
 if(!choices.length){logger.info('[speaking-content-recovery]',JSON.stringify({operation,status:'no-submitted-attempt'}));return;}
 const chosen=choices[0],store=chosen.kind===0?practiceStore:mockStore,claim=crypto.randomUUID();let claimed=false;
 let saved=await store.update(username,chosen.id,a=>{claimed=false;if(a.contentRecovery?.operation===operation)return a;claimed=true;a.contentRecovery={operation,claim,status:'processing',startedAt:now()};return a;});
 if(!claimed){logger.info('[speaking-content-recovery]',JSON.stringify({operation,attemptId:chosen.id,status:'already-run'}));return saved.contentRecovery;}
 const report={operation,attemptId:chosen.id,kind:chosen.kind===0?'practice':'mock',startedAt:chosen.startedAt,reviewed:0,recovered:0,unavailable:0,scores:[],existing:[],issues:[]};
 logger.info('[speaking-content-recovery]',JSON.stringify({...report,status:'started'}));
 try{
  const entries=chosen.kind===0?[{index:null,q:bank.questions.find(q=>q.id===saved.questionId),r:saved,result:saved.result}]:saved.questions.flatMap((q,index)=>q.type!=='intro'&&saved.responses[index]?.recording?[{index,q,r:saved.responses[index],result:saved.responses[index].content}]:[]);
  for(const {index,q,r,result} of entries){
   if(confirmed(result)){report.existing.push({index,questionId:q?.id,total:result.total,maximum:result.maximum});continue;}report.reviewed++;
   if(!q){report.unavailable++;continue;}
   let text=r.transcript||'';if(!text.trim()&&r.recording&&transcribe)text=await transcribe(r.recording);
   if(!text.trim()){report.unavailable++;continue;}
   const assessed=await scoring.grade(q,text,callModel);if(!confirmed(assessed)){report.unavailable++;report.issues.push({index,type:q.type,issue:String(assessed.fallbackReason||'').includes('contradicts')?'score_conflict':'review_unavailable'});continue;}
   let written=false;
   await store.update(username,chosen.id,a=>{
    written=false;if(a.contentRecovery?.claim!==claim)return a;
    const target=index===null?a:a.responses[index];if(!target||(target.transcript||'')!==(r.transcript||'')||target.recording?.hash!==r.recording?.hash)return a;
    const previous=index===null?target.result:target.content;if(confirmed(previous))return a;
    target.contentScoreHistory=[...(target.contentScoreHistory||[]),{operation,at:now(),previous:previous||null}].slice(-3);
    if(index===null){const delivery=Object.fromEntries(deliveryKeys.filter(k=>Object.hasOwn(previous||{},k)).map(k=>[k,previous[k]]));target.result={...assessed,...delivery};if(!target.transcript){target.transcription=text;target.revision=(target.revision||0)+1;}}
    else{target.content=assessed;target.transcriptionStatus='assessed';}
    target.transcript=text;written=true;return a;
   });
   if(written){report.recovered++;report.scores.push({index,questionId:q.id,total:assessed.total,maximum:assessed.maximum});}else report.unavailable++;
  }
  report.status=report.unavailable?'needs-review':'complete';
 }catch(e){report.status='interrupted';report.failure=String(e.code||e.name||'error').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,60);}
 await store.update(username,chosen.id,a=>{if(a.contentRecovery?.claim===claim)a.contentRecovery={...a.contentRecovery,...report,finishedAt:now()};return a;});
 logger.info('[speaking-content-recovery]',JSON.stringify(report));return report;
}
module.exports={recoverLatest,confirmed};
