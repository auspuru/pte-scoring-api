'use strict';
// Reopen only confirmed deadline-unattempted questions of a saved Speaking mock.
// Earlier recordings, provider marks and the original publication evidence stay intact.
const {hash}=require('./scoring-jobs');
const VERSION='speaking-deadline-continuation-v1';
const fail=(message,status=409)=>Object.assign(Error(message),{status});
function inspect(a){
  const s=a?.submission,indices=s?.unattempted;
  if(a?.status!=='submitted'||a.continuation||a.deadlineZeroPublication
    ||a.grading?.status!=='complete'||a.assessment?.status!=='ready'
    ||a.lease||Object.keys(a.assessmentExclusions||{}).length
    ||s?.version!==1||s.reason!=='deadline'||s.state!=='incomplete'
    ||!Array.isArray(s.pending)||s.pending.length||!Array.isArray(s.missing)||s.missing.length
    ||!Array.isArray(indices)||!indices.length||!Number.isInteger(a.index)
    ||!Number.isFinite(a.deadline)||!Number.isFinite(a.finishedAt)||a.finishedAt<a.deadline
    ||s.startedAt!==a.deadline||a.questions?.[0]?.type!=='intro'
    ||!a.questions?.length||a.questionCount!==a.questions.length-1
    ||indices.length!==a.questions.length-a.index
    ||indices.some((index,offset)=>index!==a.index+offset))return {eligible:false};
  for(let index=1;index<a.index;index++)if(!a.responses?.[index]?.recording&&!a.responses?.[index]?.skipped)return {eligible:false};
  for(const index of indices){
    const response=a.responses?.[index];
    if(!response||response.deadlineUnattempted!==true||response.reason!=='deadline-unattempted'
      ||Object.keys(response).some(key=>!['deadlineUnattempted','reason'].includes(key)))return {eligible:false};
  }
  const remainingMs=indices.reduce((total,index)=>{
    const q=a.questions[index];
    // Keep each original prompt, preparation and response window, plus time
    // to save the recording and move to the next question.
    return total+18000+Math.max(0,q.audioSeconds||0)*1000
      +Math.max(0,q.preparation||0)*1000+Math.max(0,q.startCueMs||0)
      +Math.max(0,q.seconds||0)*1000;
  },0);
  if(!Number.isSafeInteger(remainingMs)||remainingMs<1000)return {eligible:false};
  return {eligible:true,indices:[...indices],remainingMs,
    evidenceHash:hash({id:a.id,paperId:a.paperId,questions:a.questions,index:a.index,
      deadline:a.deadline,finishedAt:a.finishedAt,submission:s,
      responses:a.responses.map((r,i)=>({index:i,recording:r?.recording?.hash||null,skipped:r?.skipped===true,deadlineUnattempted:r?.deadlineUnattempted===true})),
      confirmedHash:hash(require('./mock-result-review').confirmed(a,'speaking')),
      assessment:a.assessment,grading:a.grading,exclusions:a.assessmentExclusions||{}})};
}
function apply(a,{operation,evidenceHash},at){
  if(!/^[a-zA-Z0-9:_-]{8,100}$/.test(operation||'')||!/^[a-f0-9]{64}$/.test(evidenceHash||''))throw fail('Select the exact saved attempt again.',400);
  if(a.continuation?.operation===operation){if(a.continuation.evidenceHash!==evidenceHash)throw fail('The continuation request changed.');return a;}
  const plan=inspect(a);
  if(!plan.eligible||plan.evidenceHash!==evidenceHash)throw fail('The saved timeout evidence or assessments changed. Inspect this attempt again.');
  const previous=structuredClone({finishedAt:a.finishedAt,deadline:a.deadline,submission:a.submission,
    assessment:a.assessment,grading:a.grading,combinedOverall:a.combinedOverall||null,
    overallAzure:a.overallAzure||null,report:require('./speaking-mock-report').summarize(a).azure});
  a.continuation={version:VERSION,operation,evidenceHash,startedAt:at,indices:plan.indices,
    remainingMs:plan.remainingMs,previous};
  a.status='active';a.deadline=at+plan.remainingMs;
  delete a.finishedAt;delete a.submission;delete a.questionStartedAt;
  delete a.promptFinishedAt;delete a.questionTimingVersion;
  for(const index of plan.indices){delete a.responses[index];if(a.assessment?.omissions)delete a.assessment.omissions[index];}
  a.grading={status:'pending'};
  a.assessment={...a.assessment,status:'pending'};
  delete a.combinedOverall;delete a.overallAzure;
  return a;
}
module.exports={VERSION,inspect,apply};
