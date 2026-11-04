'use strict';
const {hash}=require('./scoring-jobs'),report=require('./speaking-mock-report'),submission=require('./speaking-mock-submission');
const fail=(message,status=409)=>Object.assign(Error(message),{status});
// Merge only missing confirmed stages. Retain every saved recording, answer,
// successful content result, delivery trait and manual override.
function candidate(a,hydrated){
 const next=structuredClone(a);
 for(let i=0;i<a.questions.length;i++){
  const r=next.responses[i],h=hydrated.responses[i],q=a.questions[i];if(!r?.recording||!h||h.recording?.hash!==r.recording.hash)continue;
  if(!r.transcript&&r.transcriptionStatus!=='assessed'){if(h.transcript!=null)r.transcript=h.transcript;if(h.transcriptionStatus)r.transcriptionStatus=h.transcriptionStatus;}
  if(!report.validContent(q,r.content)&&report.validContent(q,h.content))r.content=structuredClone(h.content);
  const old=report.deliveryTraits(r,'azure');
  if(old.missing.length&&h.azure){const fresh=structuredClone(h.azure);for(const key of ['pronunciation','fluency'])if(old[key]!==null&&r.azure?.[key])fresh[key]=structuredClone(r.azure[key]);r.azure=fresh;}
 }
 return next;
}
const confirmedHash=a=>hash(a.questions.map((q,i)=>q.type==='intro'?null:{index:i,content:report.validContent(q,a.responses[i]?.content)?a.responses[i].content:null,azure:report.deliveryTraits(a.responses[i],'azure')}));
function evidenceHash(a,rows){const attempt=structuredClone(a);for(const r of attempt.responses||[])if(r?.recording)delete r.recording.data;return hash({attempt,rows});}
function inspect(a,hydrated,rows,at){
 const next=candidate(a,hydrated),s=a.submission||{},index=s.unattempted?.[0],q=a.questions[index],r=a.responses[index];
 const result=report.summarize(next).azure;
 const eligible=a.status==='submitted'&&s.version===1&&s.reason==='deadline'&&s.state==='incomplete'
  &&s.pending?.length===0&&s.missing?.length===0&&s.unattempted?.length===1&&index===a.questions.length-1&&index===a.index
  &&a.questionCount===27&&a.questions.length===28&&q?.type!=='intro'&&r?.deadlineUnattempted===true&&r.reason==='deadline-unattempted'&&!r.recording&&!r.transcript
  &&!Object.keys(a.assessmentExclusions||{}).length&&!(a.lease?.expiresAt>at)
  &&rows.every(row=>row.status==='ready')&&result.assessedCount===26&&result.excludedCount===0
  &&result.questions.some(row=>row.index!==index&&row.type===q.type&&row.total!==null)
  &&a.questions.every((question,i)=>i===index||question.type==='intro'||a.responses[i]?.recording?.hash||a.responses[i]?.skipped===true);
 return {eligible:!!eligible,index,questionId:q?.id,number:a.questions.slice(0,index+1).filter(q=>q.type!=='intro').length,
  evidenceHash:evidenceHash(a,rows),inputsHash:submission.releaseEvidence(a),confirmedHash:confirmedHash(next),assessedCount:result.assessedCount,excludedCount:result.excludedCount};
}
function apply(a,hydrated,rows,body,at){
 const {operation,evidenceHash:expected,questionId,note,confirmInstructorExclusion}=body;
 if(!/^[a-zA-Z0-9:_-]{8,100}$/.test(operation||'')||!/^[a-f0-9]{64}$/.test(expected||'')||typeof questionId!=='string'
  ||typeof note!=='string'||note.trim().length<10||note.length>500||confirmInstructorExclusion!==true)throw fail('Confirm the one unreached question and instructor exclusion note.',400);
 const requestHash=hash({operation,expected,questionId,note:note.trim()});
 if(a.submission?.release?.operation===operation){if(a.submission.release.requestHash!==requestHash||!submission.validRelease(a))throw fail('This operation belongs to another release.');return a;}
 const plan=inspect(a,hydrated,rows,at);
 if(!plan.eligible||plan.questionId!==questionId)throw fail('Only one final unreached question with all other 26 assessments confirmed can be released.');
 if(plan.evidenceHash!==expected)throw fail('Saved evidence changed. Inspect the attempt again.');
 const next=candidate(a,hydrated),i=plan.index,q=next.questions[i];
 next.assessmentExclusions||={};next.assessmentExclusions[i]={reason:'deadline-unattempted',authorizedBy:'administrator',attemptId:a.id,index:i,questionId:q.id,
  operation,note:note.trim(),excludedAt:at,questionHash:hash(q),responseHash:hash(next.responses[i])};
 next.submission.release={version:1,authorizedBy:'administrator',index:i,operation,requestHash,evidenceHash:plan.inputsHash,exclusionHash:hash(next.assessmentExclusions[i]),releasedAt:at};
 const result=report.summarize(next).azure;
 if(submission.blocked(next)||result.status!=='assessed'||result.assessedCount!==26||result.excludedCount!==1||confirmedHash(next)!==plan.confirmedHash)throw fail('The retained results could not be verified.');
 next.grading={status:'complete'};next.assessment={status:'ready',version:'progressive-speaking-v1',publishedAt:at};
 return next;
}
module.exports={candidate,inspect,apply,confirmedHash};
