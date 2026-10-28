'use strict';
const scoring=require('./speaking-scoring');
const {confirmed}=require('./speaking-content-recovery');
const manual=require('./speaking-manual-delivery');
const {hash}=require('./scoring-jobs');

const VERSION='speaking-task-weighted-azure-2026-10-27.1';
// Pearson's rounded average Speaking contributions total 101, not 100.
// Normalise their relative weights; never silently change RTS from 13 to 12.
const WEIGHTS=Object.freeze({ra:9,rs:16,di:31,rl:13,sgd:19,rts:13});
const LABELS={ra:'Read Aloud',rs:'Repeat Sentence',di:'Describe Image',rl:'Retell Lecture',sgd:'Summarise Group Discussion',rts:'Respond to a Situation'};
const unavailable=value=>['unavailable','unassessed','pending','processing','failed','error','source-limited'].includes(value?.status)
  ||['local','unavailable'].includes(value?.scoringMode)||value?.score_provisional===true||value?.needs_semantic_review===true;
const number=value=>typeof value==='number'?value:typeof value==='string'&&value.trim()?Number(value):NaN;
const bounded=(value,maximum)=>Number.isFinite(value)&&value>=0&&value<=maximum;
function contentMaximum(q){return q.type==='ra'?(scoring.tokens(q.text).length||null):q.type==='rs'?3:Object.hasOwn(WEIGHTS,q.type)?6:null;}
function validContent(q,result){
  const maximum=contentMaximum(q);
  return maximum!==null&&confirmed(result)&&!unavailable(result)&&result.maximum===maximum&&Number.isInteger(result.total)&&bounded(result.total,maximum);
}
function validExclusion(value,q,response,index,attemptId){
  return !!(value&&q&&value.reason==='feedback-unavailable'&&value.authorizedBy==='administrator'
    &&value.attemptId===attemptId&&value.index===index&&value.questionId===q.id
    &&typeof value.operation==='string'&&/^[a-zA-Z0-9:_-]{1,100}$/.test(value.operation)
    &&typeof value.note==='string'&&value.note.trim()&&value.note.length<=500&&Number.isFinite(value.excludedAt)
    &&value.questionHash===hash(q)&&response?.recording?.hash&&value.recordingHash===response.recording.hash);
}
function exclusionFor(a,q,index){
  const value=a.assessmentExclusions?.[index];
  return validExclusion(value,q,a.responses?.[index],index,a.id)?value:null;
}
function deliveryTraits(response,provider){
  const original=response?.[provider],effective=manual.effective(response,provider),values={},missing=[],manualTraits=[];
  for(const name of ['pronunciation','fluency']){
    const trait=effective?.[name],override=trait?.manualOverride===true,score=number(trait?.score);
    const fresh=!original?.recordingHash||original.recordingHash===response?.recording?.hash;
    const valid=Number.isInteger(score)&&bounded(score,5)&&(trait.maximum==null||number(trait.maximum)===5)&&!unavailable(trait)
      &&(override||original?.status==='assessed'&&!unavailable(original)&&fresh&&original.deliveryEvidence?.sufficient!==false);
    values[name]=valid?score:null;
    if(!valid)missing.push(name);else if(override)manualTraits.push(name);
  }
  return {...values,missing,manualTraits};
}
function questionResult(a,q,response,index,provider){
  const cmax=contentMaximum(q),maximum=cmax===null?null:cmax+10;
  const base={index,questionId:q.id,type:q.type,maximum,contentMaximum:cmax,content:null,pronunciation:null,fluency:null,total:null,manualTraits:[]};
  const exclusion=exclusionFor(a,q,index);
  if(exclusion)return {...base,status:'excluded',excluded:true,exclusion:{reason:exclusion.reason,note:exclusion.note},missing:[]};
  if(cmax===null)return {...base,status:'pending',missing:['question-rubric']};
  // An explicit skip, or an unvisited item when the timer submitted the test,
  // is zero. An unexplained hole in an already visited response stays pending.
  const unanswered=!response?.recording&&!response?.transcript?.trim()
    &&(response?.skipped===true||response==null&&Number.isInteger(a.index)&&index>=a.index);
  if(unanswered)return {...base,status:'unanswered',content:0,pronunciation:0,fluency:0,total:0,missing:[]};
  if(!response?.recording)return {...base,status:'pending',missing:['recording']};
  if(!validContent(q,response.content))return {...base,status:'pending',missing:['content']};
  const content=response.content.total;
  if(content===0)return {...base,status:'content-gated',content:0,pronunciation:0,fluency:0,total:0,missing:[]};
  const traits=deliveryTraits(response,provider);
  return {...base,...traits,content,status:traits.missing.length?'pending':'scored',
    total:traits.missing.length?null:content+traits.pronunciation+traits.fluency};
}
function providerReport(a,provider){
  const rows=a.questions.flatMap((q,index)=>q.type==='intro'?[]:[questionResult(a,q,a.responses?.[index],index,provider)]);
  const included=rows.filter(r=>!r.excluded),excluded=rows.filter(r=>r.excluded);
  const missingTypes=Object.keys(WEIGHTS).filter(type=>!included.some(r=>r.type===type));
  const supported=included.every(r=>r.maximum!==null&&Object.hasOwn(WEIGHTS,r.type));
  const coverageValid=Number.isInteger(a.questionCount)&&a.questionCount===rows.length&&rows.length>0;
  const byType=[...new Set(included.map(r=>r.type))].map(type=>{
    const items=included.filter(r=>r.type===type),marked=items.filter(r=>r.total!==null),maximum=items.reduce((n,r)=>n+(r.maximum||0),0);
    const total=marked.reduce((n,r)=>n+r.total,0),sum=key=>marked.reduce((n,r)=>n+r[key],0);
    return {type,label:LABELS[type]||type,count:items.length,marked:marked.length,total,maximum,
      content:{total:sum('content'),maximum:items.reduce((n,r)=>n+(r.contentMaximum||0),0)},
      pronunciation:{total:sum('pronunciation'),maximum:5*items.length},fluency:{total:sum('fluency'),maximum:5*items.length},
      weight:WEIGHTS[type]||0,performancePercent:marked.length===items.length&&maximum>0?100*total/maximum:null};
  });
  const weightTotal=byType.reduce((n,g)=>n+g.weight,0);
  for(const group of byType)group.normalizedWeight=weightTotal?100*group.weight/weightTotal:0;
  const complete=a.status==='submitted'&&supported&&coverageValid&&weightTotal>0&&included.every(r=>r.total!==null);
  const ratio=complete?byType.reduce((n,g)=>n+g.weight*g.total/g.maximum,0)/weightTotal:null;
  return {status:complete?'assessed':'pending',version:VERSION,scope:'task-weighted-speaking',provider:provider==='gpt'?'openai':'azure',
    overallScore:complete?Math.round(10+80*ratio):null,maximum:90,performancePercent:complete?100*ratio:null,
    questionCount:included.length,originalQuestionCount:rows.length,assessedCount:included.filter(r=>r.total!==null).length,
    excludedCount:excluded.length,excludedQuestions:excluded.map(r=>({index:r.index,number:a.questions.slice(0,r.index+1).filter(q=>q.type!=='intro').length,questionId:r.questionId,title:a.questions[r.index].title,note:r.exclusion.note})),
    unansweredCount:rows.filter(r=>r.status==='unanswered').length,contentGatedCount:rows.filter(r=>r.status==='content-gated').length,
    manualOverrideCount:rows.filter(r=>r.manualTraits.length).length,
    missingQuestions:included.filter(r=>r.total===null).map(r=>({index:r.index,missing:r.missing})),
    coverageValid,supported,fullProfile:missingTypes.length===0,missingTypes,weightTotal,byType,questions:rows};
}
function summarize(a,{includeArchived=false}={}){
  return {version:VERSION,scope:'speaking-sectional',weights:{...WEIGHTS},
    calibration:'uncalibrated',conversion:'round(10 + 80 × weighted task accuracy)',
    assessment:'Provisional Speaking practice estimate. Pearson item difficulty and proprietary scaling are not available.',
    provider:'azure',requiredProviders:['azure'],...(includeArchived?{openai:providerReport(a,'gpt')}:{}),azure:providerReport(a,'azure')};
}
module.exports={VERSION,WEIGHTS,contentMaximum,validContent,validExclusion,exclusionFor,deliveryTraits,questionResult,providerReport,summarize};
