'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
// Retain the original capture/save/timer audit: remove only the four reviewed
// pending-content display/retry substitutions and the submitted-only history filter.
module.exports=function project(source){
 const replace=(from,to='')=>{assert(source.includes(from),'Expected reviewed DI retry UI change');source=source.replace(from,to);};
 replace("  const contentNeedsReview=r=>!!r&&(r.scoringMode==='local'||r.score_provisional===true||r.needs_semantic_review===true||r.contentStatus==='unavailable'||r.total==null);\n");
 replace('const contentPending=contentNeedsReview(r);',"const contentPending=r.scoringMode==='local'||r.score_provisional===true;");
 replace("text=(!a.result||contentNeedsReview(a.result))?'Content review is still unavailable.","text=a.result?.scoringMode==='local'?'Content review is still unavailable.");
 replace('else if(contentNeedsReview(saved.result))contentRetries.add(saved.id);',"else if(saved.result?.scoringMode==='local')contentRetries.add(saved.id);");
 replace("rows.filter(a=>a.questionId===questionId&&(attempt.status!=='submitted'||a.status==='submitted')).sort","rows.filter(a=>a.questionId===questionId).sort");
 assert.equal(crypto.createHash('sha256').update(source).digest('hex'),'d9089f0ea9d690920067a41110aecb24ce278208cdd4012b5c309565ba3c7078');
 return source;
};
