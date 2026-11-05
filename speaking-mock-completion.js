'use strict';
const {hash}=require('./scoring-jobs');
const VERSION='speaking-available-marks-2026-11-06.1';
const notes={
 'recording-missing':'No recording was available when this report was prepared. This question does not contribute to the score.',
 'quiet-audio':'The recording was too quiet to assess. This question does not contribute to the score.',
 'unintelligible-audio':'No intelligible speech was recognised. This question does not contribute to the score.',
 'recording-unavailable':'The saved recording could not be prepared for assessment. This question does not contribute to the score.',
 'assessment-unavailable':'The assessment was unavailable when this report was prepared. The saved response is retained and this question does not contribute to the score.'
};
const policy=questions=>({version:VERSION,questionsHash:hash(questions)});
const active=a=>a?.assessmentProfile?.completionPolicy?.version===VERSION&&a.assessmentProfile.completionPolicy.questionsHash===hash(a.questions);
const missingProof=(a,index)=>hash({version:VERSION,id:a.id,index,question:a.questions[index],policy:a.assessmentProfile.completionPolicy,reason:'recording-missing'});
function frozenMissing(a,index){const value=a.assessment?.omissions?.[index];return !!(active(a)&&value?.version===VERSION&&value.proof===missingProof(a,index)&&Number.isFinite(value.at));}
function omissions(a,at){const values={...a.assessment?.omissions};if(active(a))a.questions.forEach((q,index)=>{if(q.type!=='intro'&&!a.responses[index]?.recording)values[index]||={version:VERSION,proof:missingProof(a,index),at,originalResponseHash:hash(a.responses[index]||null),reason:'recording-missing'};});return values;}
function evidence(q,r={}){return hash({question:q,recording:r.recording?.hash||null,transcript:r.transcript,transcriptionStatus:r.transcriptionStatus,content:r.content,azure:r.azure,manualDeliveryOverrides:r.manualDeliveryOverrides});}
function receipt(q,r,reason,at){return {version:VERSION,evidenceHash:evidence(q,r),reason,at};}
function validOutcome(q,r){const value=r?.assessmentOutcome;return !!(value?.version===VERSION&&value.evidenceHash===evidence(q,r)&&Number.isFinite(value.at)&&['available',...Object.keys(notes)].includes(value.reason));}
function replacement(a,index){
 const r=a.responses?.[index],proof=r?.deliveryReplacement,op=a.deliveryReassessments?.[proof?.operation];
 const item=op?.items?.find(row=>row.index===index);
 return !!(op?.status==='published'&&item?.status==='complete'&&proof.evidenceHash===evidence(a.questions[index],r)
   &&item.appliedHash===proof.evidenceHash&&item.questionId===a.questions[index].id);
}
async function quiet(recording,{prepare=require('./speaking-delivery').splitToWav}={}){
 const chunks=await prepare(recording),delivery=require('./speaking-delivery');
 return require('./full-mock/adapters').quietRecording({mime:'audio/wav',data:delivery.pcmWav(Buffer.concat(chunks.map(delivery.pcmData))).toString('base64')});
}
function changes(a){return Object.values(a.deliveryReassessments||{}).filter(op=>op.status==='published').sort((a,b)=>b.publishedAt-a.publishedAt).map(op=>({publishedAt:op.publishedAt,
 changes:op.items.filter(item=>item.status==='complete').flatMap(item=>{
  const before=item.previousScores||{},after=item.publishedScores||{},q=a.questions[item.index];
  const traits=['content','pronunciation','fluency'].filter(key=>Number.isFinite(after[key])&&before[key]!==after[key]).map(key=>({trait:{content:'Content',pronunciation:'Pronunciation',fluency:'Oral fluency'}[key],before:Number.isFinite(before[key])?before[key]:null,after:after[key],maximum:key==='content'?require('./speaking-mock-report').contentMaximum(q):5}));
  return traits.length?[{number:item.number,label:require('./speaking-mock-report').LABELS[q.type]||'Speaking',traits}]:[];
 })})).filter(op=>op.changes.length);}
module.exports={VERSION,policy,active,frozenMissing,omissions,evidence,receipt,validOutcome,replacement,quiet,notes,changes};
