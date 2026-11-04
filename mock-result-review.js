'use strict';
// Opt-in instructor review. This ledger never edits answers, recordings or
// confirmed marks, and never publishes without a separate administrator POST.
const {hash}=require('./scoring-jobs');
const VERSION='instructor-mock-review-v1',LIMIT=2;
const fail=(message,status=409)=>Object.assign(Error(message),{status});
const held=a=>a?.instructorReview?.version===VERSION&&a.instructorReview.status!=='published';
const metadata=a=>{const copy=structuredClone(a);for(const r of copy.responses||[])if(r?.recording)delete r.recording.data;return copy;};
const speakingInputs=a=>hash({id:a.id,paper:a.paperId,questions:a.questions,deadline:a.deadline,index:a.index,submission:require('./speaking-mock-submission').releaseEvidence(a)});
const fullInputs=a=>hash({id:a.id,paper:a.paperHash,snapshot:a.assessment?.snapshotHash,responses:a.responses.map(require('./full-mock/aggregation').inputHash)});
function confirmed(a,kind){
 const values={};
 if(kind==='full')for(const [id,job]of Object.entries(a.assessment?.items||{})){
  if(!job||typeof job!=='object')continue;
  if(job.status==='assessed')values[id]=hash(job);
  for(const [name,s]of Object.entries(job.stages||{})){
   if(s?.status==='complete')values[id+':'+name]=hash(s);
   else if(name==='delivery')for(const [trait,value]of Object.entries(s?.traits||{}))if(value?.score!=null)values[id+':delivery:'+trait]=hash(value);
  }
 }else a.questions.forEach((q,i)=>{if(q.type==='intro')return;const r=a.responses[i];
  if(require('./speaking-mock-report').validContent(q,r?.content))values[i+':content']=hash(r.content);
  for(const trait of ['pronunciation','fluency'])if(require('./speaking-mock-report').deliveryTraits(r,'azure')[trait]!==null)values[i+':'+trait]=hash(r.manualDeliveryOverrides?.azure?.[trait]||r.azure?.[trait]);
 });
 return values;
}
function verify(a,kind){const review=a.instructorReview,inputs=kind==='full'?fullInputs(a):speakingInputs(a),marks=confirmed(a,kind);
 if(review?.version!==VERSION||review.inputsHash!==inputs||Object.entries(review.confirmed).some(([key,value])=>marks[key]!==value))throw fail('Saved inputs or confirmed marks changed. Retain this attempt for review.');
}
function publicationValid(a,kind){try{verify(a,kind);const r=a.instructorReview,p=r.publication,ex=kind==='full'?a.assessment?.exclusions:a.assessmentExclusions;
 return r.status==='published'&&p?.operation&&p.exclusionsHash===hash(ex||{})&&Array.isArray(p.questionIds);
 }catch{return false;}}
function speakingExclusion(a,q,response,index,value){return publicationValid(a,'speaking')&&a.instructorReview.publication.questionIds.includes(q.id)
 &&value?.reason==='instructor-review-unavailable'&&value.operation===a.instructorReview.publication.operation
 &&value.attemptId===a.id&&value.index===index&&value.questionId===q.id&&value.questionHash===hash(q)
 &&value.responseHash===hash(metadata({responses:[response||null]}).responses[0]);}
function fullExclusion(a,candidate,response,job,value){return publicationValid(a,'full')&&a.instructorReview.publication.questionIds.includes(candidate.id)
 &&value?.reason==='instructor-review-unavailable'&&value.operation===a.instructorReview.publication.operation
 &&value.inputHash===require('./full-mock/aggregation').inputHash(response)&&value.snapshotHash===a.assessment.snapshotHash
 &&value.previousJobHash===hash(job||null);}
const activeRow=row=>['pending','running','retry_wait'].includes(row.status);
function retryable(row){
 if(row.status!=='needs_attention'||row.data.assessmentExclusion)return [];
 return Object.entries(row.data.stages||{}).filter(([name,s])=>['transcription','content','azure','academy'].includes(name)&&s?.status==='needs_attention'
  &&!require('./mock-recovery-policy').failure({status:s.code||s.failure,code:s.detail?.code,uncertain:s.failure==='uncertain_provider_outcome'}).blocked
  &&!(name==='azure'&&row.data.patch?.azure?.deliveryEvidence?.sufficient===false)
  &&!(name==='academy'&&(!row.data.remoteFailures?.length||row.data.remoteFailures.some(f=>f.uncertain||!f.retryable&&![429,500,502,503,504].includes(Number(f.code||f.status)))))).map(([name])=>name);
}
function common(a,kind,result,unresolved,busy,evidenceHash){
 const review=a.instructorReview,started=review?.version===VERSION,retries=review?.rounds?.length||0;
 let problem=null;try{if(started)verify(a,kind);}catch(e){problem=e.message;}
 const allCovered=unresolved.every(row=>result.items.some(other=>other.type===row.type&&other.status==='assessed'));
 return {version:VERSION,started,retries,limit:LIMIT,status:review?.status||'not-started',busy,evidenceHash,
  inputsHash:kind==='full'?fullInputs(a):speakingInputs(a),confirmedHash:hash(confirmed(a,kind)),
  assessedCount:result.assessedCount,excludedCount:result.excludedCount,questions:unresolved,
  canAnalyse:a.status==='submitted'&&!busy&&!result.ready&&!problem&&review?.status!=='published',
  canRetry:started&&!busy&&!problem&&(retries<LIMIT||review.rounds.some(r=>!r.completedAt))&&unresolved.some(row=>row.retryable),
  canPublish:started&&!busy&&!problem&&review.status!=='published'&&allCovered&&review.rounds.every(r=>r.completedAt)
   &&(retries>=LIMIT||!unresolved.some(row=>row.retryable)),
  problem:problem||(!allCovered?'A whole task has no verified assessment. An overall score cannot be published until at least one assessment for that task is recovered.':null),
  published:review?.status==='published'};
}
function speakingPlan(a,hydrated,rows,at){
 const next=require('./speaking-mock-deadline-release').candidate(a,hydrated),report=require('./speaking-mock-report').summarize(next).azure;
 for(const round of next.instructorReview?.rounds||[])if(round.targets.every(t=>{const row=rows.find(r=>r.id===t.jobId);return row?.data.repairs?.some(r=>r.operation===t.operation)&&!activeRow(row);}))round.completedAt||=at;
 const items=report.questions.map(row=>({...row,status:row.excluded?'excluded':row.total!==null?'assessed':'pending'}));
 const unresolved=items.filter(row=>row.status==='pending').map(row=>{const job=rows.find(j=>j.data.index===row.index),r=a.responses[row.index],stages=job?retryable(job):[];
  return {id:row.questionId,index:row.index,number:a.questions.slice(0,row.index+1).filter(q=>q.type!=='intro').length,type:row.type,
   reason:r?.deadlineUnattempted?'Not reached before time expired':!r?.recording?'Recording unavailable':stages.length?'Assessment unavailable':'Assessment requires review',
   retryable:stages.length>0,jobId:job?.id,stages};});
 const busy=a.status!=='submitted'||a.lease?.expiresAt>at||rows.some(activeRow)||a.submission?.state==='finalizing';
 const plan=common(next,'speaking',{...report,ready:report.status==='assessed',items},unresolved,!!busy,hash({attempt:metadata(a),rows}));
 if(rows.some(row=>!a.questions[row.data.index]||row.data.recordingHash!==a.responses[row.data.index]?.recording?.hash||row.data.questionHash!==hash(a.questions[row.data.index])))return {...plan,canAnalyse:false,canRetry:false,canPublish:false,integrityIssue:true,problem:'Saved assessment inputs do not match the retained question or recording. Input recovery is required.'};
 return plan;
}
function fullPlan(a,paper,at){
 const result=require('./full-mock/aggregation').aggregate(paper,a,{ignorePublication:true});
 const unresolved=result.items.filter(row=>!['assessed','excluded'].includes(row.status)).map(row=>{
  const index=paper.questions.findIndex(q=>q.id===row.id),response=a.responses[index+1],job=a.assessment.items[row.id];
  return {id:row.id,index,number:index+1,type:row.type,response,job};
 });
 for(const row of unresolved){const {response,job}=row;delete row.response;delete row.job;
  const spoken=require('./full-mock/adapters').SPOKEN.has(row.type),segments=(response?.segments||[]).filter(s=>!s.cancelled&&s.chunkCount!==0);
  const mediaReady=!spoken||segments.length>0&&segments.every(s=>s.finished&&s.chunkCount>0&&Object.keys(s.chunks||{}).length===s.chunkCount&&Object.values(s.chunks).every(c=>c?.stored));
  row.retryable=!!response?.sealed&&mediaReady&&(!job||job.status==='failed')&&!Object.values(job?.stages||{}).some(s=>!s||s.uncertain||s.recoveryBlocked||s.status==='running'||s.failureCode!=null&&require('./mock-recovery-policy').failure({status:s.failureCode}).blocked);
  row.reason=!mediaReady?'Recording unavailable':row.retryable?'Assessment unavailable':'Assessment requires review';
 }
 const busy=a.status!=='submitted'||a.assessment.status==='processing'||a.assessment.lease?.expiresAt>at;
 const plan=common(a,'full',result,unresolved,!!busy,hash({attempt:metadata(a)}));
 if(unresolved.some(row=>{const job=a.assessment.items[row.id],response=a.responses[row.index+1];return !response?.sealed||job&&(job.inputHash!==require('./full-mock/aggregation').inputHash(response)||job.snapshotHash!==a.assessment.snapshotHash||job.status==='assessed');}))return {...plan,canAnalyse:false,canRetry:false,canPublish:false,integrityIssue:true,problem:'Saved assessment inputs or native results could not be verified. Input recovery is required.'};
 return plan;
}
function begin(a,kind,plan,body,at){
 if(plan.integrityIssue)throw fail(plan.problem);
 if(!/^[a-zA-Z0-9:_-]{8,100}$/.test(body.operation||''))throw fail('Invalid review operation.',400);
 if(a.instructorReview){verify(a,kind);if(a.instructorReview.status==='published')throw fail('This report is already published.');if(a.instructorReview.operation===body.operation||a.instructorReview.rounds.some(r=>r.operation===body.operation))return;}
 if(body.evidenceHash!==plan.evidenceHash)throw fail('Saved evidence changed. Analyse the exact attempt again.');
 if(a.instructorReview)return;
 if(!plan.canAnalyse)throw fail('Only a submitted, settled incomplete mock can be analysed.');
 a.instructorReview={version:VERSION,status:'analysing',operation:body.operation,startedAt:at,inputsHash:plan.inputsHash,confirmed:confirmed(a,kind),rounds:[]};
}
function publication(a,kind,plan,body,at){
 if(!/^[a-zA-Z0-9:_-]{8,100}$/.test(body.operation||'')||typeof body.note!=='string'||body.note.trim().length<10||body.note.length>400||body.confirmPublish!==true)throw fail('Confirm publication and add the visible report note.',400);
 verify(a,kind);const r=a.instructorReview,requestHash=hash(body);
 if(r.publication?.operation===body.operation){if(r.publication.requestHash!==requestHash)throw fail('This operation belongs to another publication.');return false;}
 if(body.evidenceHash!==plan.evidenceHash||!plan.canPublish)throw fail(plan.problem||'Finish the two retry rounds, then inspect the analysis before publishing.');
 r.status='published';r.publication={operation:body.operation,requestHash,at,questionIds:plan.questions.map(q=>q.id)};return true;
}
function applySpeaking(a,hydrated,rows,body,at){
 const plan=speakingPlan(a,hydrated,rows,at),next=require('./speaking-mock-deadline-release').candidate(a,hydrated);
 for(const round of next.instructorReview?.rounds||[])if(round.targets.every(t=>{const row=rows.find(r=>r.id===t.jobId);return row?.data.repairs?.some(r=>r.operation===t.operation)&&!activeRow(row);}))round.completedAt||=at;
 if(body.action==='analyse'){
  begin(next,'speaking',plan,body,at);const r=next.instructorReview;
  if(r.rounds.some(x=>x.operation===body.operation))return next;
  if(plan.busy||r.rounds.length>=LIMIT||r.rounds.some(x=>!x.completedAt))return next;
  const targets=plan.questions.filter(q=>q.retryable).map(q=>({jobId:q.jobId,stages:q.stages,operation:'review:'+hash(r.operation).slice(0,32)+':'+(r.rounds.length+1)+':'+q.index}));
  if(targets.length)r.rounds.push({operation:body.operation,at,targets});r.status=targets.length?'analysing':'awaiting-publication';return next;
 }
 if(body.action!=='publish')throw fail('Unknown review action.',400);
 const publishingPlan={...plan,canPublish:!!next.instructorReview&&next.instructorReview.rounds.every(r=>r.completedAt)&&!plan.busy&&!plan.problem&&(next.instructorReview.rounds.length>=LIMIT||!plan.questions.some(q=>q.retryable))};
 if(!publication(next,'speaking',publishingPlan,body,at))return next;
 next.assessmentExclusions||={};for(const row of plan.questions)next.assessmentExclusions[row.index]={reason:'instructor-review-unavailable',authorizedBy:'administrator',attemptId:a.id,index:row.index,questionId:row.id,operation:body.operation,note:body.note.trim()+' '+row.reason+'.',excludedAt:at,questionHash:hash(a.questions[row.index]),responseHash:hash(metadata({responses:[next.responses[row.index]||null]}).responses[0])};
 next.instructorReview.publication.exclusionsHash=hash(next.assessmentExclusions);
 verify(next,'speaking');if(require('./speaking-mock-report').summarize(next).azure.status!=='assessed')throw fail('The remaining report could not be verified.');
 next.grading={...next.grading,status:'complete'};next.assessment={...next.assessment,status:'ready',version:'progressive-speaking-v1',publishedAt:at};return next;
}
async function fullAction({store,uid,id,body,at,validate,queue}){
 const record=await store.get(uid,id);if(!record)throw fail('Attempt not found.',404);
 const saved=await store.update(uid,id,a=>{
  validate(a);if(a.status!=='submitted')throw fail('Only submitted mocks can be reviewed.');
  const plan=fullPlan(a,record.paper,at);
  if(body.action==='analyse'){
   begin(a,'full',plan,body,at);const r=a.instructorReview;a.assessment.recovery={...a.assessment.recovery,status:'instructor-review'};delete a.assessment.recovery.nextAt;
   if(r.rounds.some(x=>x.operation===body.operation))return a;
   if(plan.busy||r.rounds.length>=LIMIT)return a;
   const targets=plan.questions.filter(q=>q.retryable).map(q=>q.id);
   if(targets.length){r.rounds.push({operation:body.operation,at,targets});a.assessment.status='processing';a.assessment.run++;a.assessment.requestedAt=at;r.status='analysing';}
   else r.status='awaiting-publication';return a;
  }
  if(body.action!=='publish')throw fail('Unknown review action.',400);
  if(!publication(a,'full',plan,body,at))return a;
  a.assessment.exclusions||={};for(const row of plan.questions){const response=a.responses[row.index+1],job=a.assessment.items[row.id];a.assessment.exclusions[row.id]={reason:'instructor-review-unavailable',operation:body.operation,at,note:body.note.trim()+' '+row.reason+'.',inputHash:require('./full-mock/aggregation').inputHash(response),snapshotHash:a.assessment.snapshotHash,previousJobHash:hash(job||null)};}
  a.instructorReview.publication.exclusionsHash=hash(a.assessment.exclusions);
  if(!require('./full-mock/aggregation').aggregate(record.paper,a).ready)throw fail('The remaining report could not be verified.');
  a.assessment.status='complete';a.assessment.finishedAt=at;a.assessment.recovery={...a.assessment.recovery,status:'complete'};delete a.assessment.recovery.nextAt;return a;
 });
 if(saved.assessment.status==='processing')queue(uid,id);
 return saved;
}
module.exports={VERSION,LIMIT,held,publicationValid,speakingExclusion,fullExclusion,speakingPlan,fullPlan,applySpeaking,fullAction,confirmed,verify};
