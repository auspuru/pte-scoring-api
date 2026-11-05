'use strict';
// An explicit instructor publication of durable deadline-unattempted answers.
// No provider work, answer replacement, exclusions or denominator changes.
const {hash}=require('./scoring-jobs');
const VERSION='speaking-deadline-zero-v1';
const NOTE='Not reached before the overall timer expired. Counted as an unattempted answer with zero credit.';
const fail=(message,status=409)=>Object.assign(Error(message),{status});
function indices(a){
 const s=a?.submission,values=s?.unattempted;
 if(a?.status!=='submitted'||s?.version!==1||s.reason!=='deadline'||s.state!=='incomplete'
  ||!Number.isFinite(a.deadline)||!Number.isFinite(a.finishedAt)||a.finishedAt<a.deadline||s.startedAt!==a.deadline
  ||!Array.isArray(s.pending)||s.pending.length||!Array.isArray(s.missing)||s.missing.length
  ||!Array.isArray(values)||!values.length||new Set(values).size!==values.length||!Number.isInteger(a.index))return [];
 if(values.some(i=>!Number.isInteger(i)||i<a.index||a.questions?.[i]?.type==='intro'||!a.questions?.[i]
  ||a.responses?.[i]?.deadlineUnattempted!==true||a.responses[i].reason!=='deadline-unattempted'
  ||Object.keys(a.responses[i]).some(key=>!['deadlineUnattempted','reason'].includes(key))))return [];
 return [...values];
}
const inputsHash=a=>require('./speaking-mock-submission').releaseEvidence(a);
const confirmedHash=a=>hash(require('./mock-result-review').confirmed(a,'speaking'));
function valid(a){
 const p=a?.deadlineZeroPublication,list=indices(a);
 return !!(p?.version===VERSION&&p.authorizedBy==='administrator'&&/^[a-zA-Z0-9:_-]{8,100}$/.test(p.operation||'')&&typeof p.note==='string'&&p.note.trim().length>=10&&p.note.length<=400&&Array.isArray(p.indices)
  &&list.length&&hash(list)===hash(p.indices)&&p.inputsHash===inputsHash(a)&&p.confirmedHash===confirmedHash(a)
  &&p.exclusionsHash===hash(a.assessmentExclusions||{}));
}
function credited(a,index){return valid(a)&&a.deadlineZeroPublication.indices.includes(index);}
function inspect(a,hydrated,rows,at){
 const candidate=require('./speaking-mock-deadline-release').candidate(a,hydrated),list=indices(candidate);
 const report=require('./speaking-mock-report').summarize(candidate).azure;
 const review=require('./mock-result-review');let reviewValid=true;try{if(review.held(a))review.verify(candidate,'speaking');}catch{reviewValid=false;}
 const eligible=list.length>0&&!a.deadlineZeroPublication&&!Object.keys(a.assessmentExclusions||{}).length
  &&a.questionCount===27&&a.questions.length===28&&report.coverageValid&&report.supported;
 const settled=!(a.lease?.expiresAt>at)&&rows.every(row=>row.status==='ready')&&reviewValid;
 const ready=!!eligible&&settled&&report.questions.every(row=>list.includes(row.index)||row.total!==null)
  &&rows.every(row=>a.questions[row.data.index]&&row.data.recordingHash===a.responses[row.data.index]?.recording?.hash&&row.data.questionHash===hash(a.questions[row.data.index]));
 return {eligible:ready,published:valid(a),zeroCount:list.length,assessedCount:report.assessedCount,
  questions:list.map(index=>({index,number:a.questions.slice(0,index+1).filter(q=>q.type!=='intro').length,type:a.questions[index].type})),
  inputsHash:inputsHash(a),confirmedHash:confirmedHash(candidate),evidenceHash:require('./speaking-mock-deadline-release').inspect(a,hydrated,rows,at).evidenceHash};
}
function apply(a,hydrated,rows,body,at){
 const {operation,evidenceHash,note,confirmDeadlineZeros}=body;
 if(!/^[a-zA-Z0-9:_-]{8,100}$/.test(operation||'')||!/^[a-f0-9]{64}$/.test(evidenceHash||'')||typeof note!=='string'||note.trim().length<10||note.length>400||confirmDeadlineZeros!==true)throw fail('Confirm the timed-out questions and add a visible publication note.',400);
 const requestHash=hash(body);
 if(a.deadlineZeroPublication?.operation===operation){if(a.deadlineZeroPublication.requestHash!==requestHash||!valid(a))throw fail('This operation belongs to another publication.');return a;}
 const plan=inspect(a,hydrated,rows,at);
 if(!plan.eligible||evidenceHash!==plan.evidenceHash)throw fail('Saved timeout evidence or assessments changed. Inspect the exact attempt again.');
 const next=require('./speaking-mock-deadline-release').candidate(a,hydrated);
 next.deadlineZeroPublication={version:VERSION,authorizedBy:'administrator',operation,requestHash,at,note:note.trim(),indices:indices(next),inputsHash:inputsHash(next),confirmedHash:confirmedHash(next),exclusionsHash:hash(next.assessmentExclusions||{})};
 if(require('./mock-result-review').held(next)){
  next.instructorReview.status='published';next.instructorReview.publication={operation,requestHash,at,questionIds:[],exclusionsHash:hash(next.assessmentExclusions||{})};
 }
 if(!valid(next)||require('./speaking-mock-submission').blocked(next)||require('./speaking-mock-report').summarize(next).azure.status!=='assessed'||confirmedHash(next)!==plan.confirmedHash)throw fail('The retained report could not be verified.');
 next.grading={...next.grading,status:'complete'};next.assessment={...next.assessment,status:'ready',version:'progressive-speaking-v1',publishedAt:at};return next;
}
module.exports={VERSION,NOTE,indices,valid,credited,inspect,apply};
