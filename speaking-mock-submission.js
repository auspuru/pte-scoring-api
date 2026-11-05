'use strict';
// One durable deadline transition for request handlers and background workers.
// This module never reopens an already submitted attempt or replaces an answer.
const GRACE_MS=90000;
const {hash}=require('./scoring-jobs');
function releaseEvidence(a){const {release,...submission}=a.submission||{};return hash({id:a.id,paperId:a.paperId,questions:a.questions,deadline:a.deadline,index:a.index,submission,inputs:(a.responses||[]).map(r=>r?{recording:r.recording?.hash||null,skipped:r.skipped===true,deadlineUnattempted:r.deadlineUnattempted===true,reason:r.reason||null}:null)});}
function validRelease(a){
 const s=a?.submission,r=s?.release,i=s?.unattempted?.[0],e=a?.assessmentExclusions?.[i];
 return !!(a?.status==='submitted'&&s?.version===1&&s.reason==='deadline'&&s.state==='incomplete'&&s.unattempted?.length===1&&!s.pending?.length&&!s.missing?.length
  &&e&&r?.version===1&&r.authorizedBy==='administrator'&&r.index===i&&r.evidenceHash===releaseEvidence(a)&&r.exclusionHash===hash(e)
  &&e?.reason==='deadline-unattempted'&&e.operation===r.operation&&e.index===i&&e.attemptId===a.id&&e.questionId===a.questions?.[i]?.id
  &&a.responses?.[i]?.deadlineUnattempted===true&&a.responses[i].reason==='deadline-unattempted'&&!a.responses[i].recording);
}
const due=(a,now)=>a?.status==='active'&&now>=a.deadline&&(a.submission?.state!=='finalizing'||now>a.submission.closesAt);
const blocked=a=>a?.submission?.state==='finalizing'||a?.submission?.state==='incomplete'&&!(a.status==='submitted'&&require('./speaking-mock-completion').active(a))&&!validRelease(a)&&!require('./mock-result-review').publicationValid(a,'speaking')&&!require('./speaking-mock-deadline-score').valid(a);
function progress(a){return {status:a.submission.state,ready:false,total:a.questionCount,pendingUploads:a.submission.pending||[],missingUploads:a.submission.missing||[],unattemptedQuestions:a.submission.unattempted||[],uploadClosesAt:a.submission.closesAt};}
function reconcile(a,now,clock=require('./speaking-mock').timing){
 if(a.status!=='active'||now<a.deadline)return a;
 if(!a.submission){
  const t=clock(a,a.deadline),i=a.index;
  const pending=!!a.questionStartedAt&&!a.responses[i]?.recording&&!a.responses[i]?.skipped&&Number.isFinite(t.recordingAt)&&t.recordingAt<=a.deadline&&t.endsAt+GRACE_MS>=a.deadline;
  a.submission={version:1,reason:'deadline',state:'finalizing',startedAt:a.deadline,closesAt:pending?Math.min(a.deadline+GRACE_MS,t.endsAt+GRACE_MS):a.deadline,pending:pending?[i]:[],missing:[],unattempted:a.questions.map((q,index)=>index).filter(index=>index>=i&&!a.responses[index]&&(!pending||index!==i)),...(pending?{window:{recordingAt:t.recordingAt,endsAt:t.endsAt}}:{})};
 }
 const s=a.submission;
 s.pending=s.pending.filter(i=>!a.responses[i]?.recording);
 if(s.pending.length&&now<=s.closesAt)return a;
 s.missing=[...s.pending];s.pending=[];s.state=s.missing.length||s.unattempted.length?'incomplete':'complete';
 // Explicit deadline outcomes distinguish never-reached questions from a lost upload.
 for(let i=a.index;i<a.questions.length;i++)if(!a.responses[i]&&!s.missing.includes(i))a.responses[i]={deadlineUnattempted:true,reason:'deadline-unattempted'};
 a.status='submitted';a.finishedAt=now;a.grading={status:s.state==='incomplete'?'incomplete':'pending'};
 return a;
}
function canUpload(a,index,now){return a.status==='active'&&a.submission?.state==='finalizing'&&a.submission.pending.includes(index)&&now<=a.submission.closesAt;}
module.exports={GRACE_MS,due,blocked,progress,reconcile,canUpload,releaseEvidence,validRelease};
