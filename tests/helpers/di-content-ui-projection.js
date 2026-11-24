'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
// Retain the original capture/save/timer audit: remove only the four reviewed
// pending-content display/retry substitutions, then pin the reviewed practice index and timer controls.
module.exports=function project(source){
 const replace=(from,to='')=>{assert(source.includes(from),'Expected reviewed DI retry UI change');source=source.replace(from,to);};
 replace("  const contentNeedsReview=r=>!!r&&(r.scoringMode==='local'||r.score_provisional===true||r.needs_semantic_review===true||r.contentStatus==='unavailable'||r.total==null);\n");
 replace('const contentPending=contentNeedsReview(r);',"const contentPending=r.scoringMode==='local'||r.score_provisional===true;");
 replace("text=(!a.result||contentNeedsReview(a.result))?'Content review is still unavailable.","text=a.result?.scoringMode==='local'?'Content review is still unavailable.");
 replace('else if(contentNeedsReview(saved.result))contentRetries.add(saved.id);',"else if(saved.result?.scoringMode==='local')contentRetries.add(saved.id);");
 assert.equal(crypto.createHash('sha256').update(source).digest('hex'),'ab5d82319a4cd874e8497d40e3830b8bf1861b737872f741e74b5d5d704ed216');
 return source;
};
