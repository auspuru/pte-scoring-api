'use strict';
const {randomUUID}=require('node:crypto'),report=require('../../speaking-mock-report');
function attempt(){
 const questions=structuredClone(require('../../content/speaking-mocks').papers[0].questions),index=18;
 return {id:randomUUID(),paperId:'speaking-mock-1',title:'Synthetic timed-out Speaking mock',questions,questionCount:27,status:'submitted',index,startedAt:1000,finishedAt:2001,deadline:2000,grading:{status:'incomplete'},assessmentProfile:{mode:'progressive-v1',owner:'alice'},
  submission:{version:1,reason:'deadline',state:'incomplete',startedAt:2000,closesAt:2000,pending:[],missing:[],unattempted:Array.from({length:10},(_,i)=>18+i)},
  responses:questions.map((q,i)=>i>=index?{deadlineUnattempted:true,reason:'deadline-unattempted'}:q.type==='intro'?{skipped:true}:{recording:{hash:'retained-'+i,mime:'audio/webm',data:'SYNTHETIC_AUDIO'},transcript:'Retained synthetic answer',transcriptionStatus:'assessed',content:{scoringMode:'ai',total:report.contentMaximum(q),maximum:report.contentMaximum(q)},azure:{status:'assessed',pronunciation:{score:5},fluency:{score:5}}})};
}
function command(plan){return {mode:'score-deadline',operation:'staff:deadline-zero-publication',evidenceHash:plan.evidenceHash,note:'Confirmed questions not reached before time expired count as zero; saved answers and confirmed marks are retained.',confirmDeadlineZeros:true};}
module.exports={attempt,command};
