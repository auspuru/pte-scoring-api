(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AdminResultReview=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function render(d){const r=d.review;if(!r||d.ready||r.published)return '';
  const deadlineOnly=r.questions.length>0&&r.questions.every(q=>q.reason==='Not reached before time expired');
  return '<section data-result-review><h5>Analyse and publish results</h5><p>'+esc(r.assessedCount)+' assessed · '+esc(r.questions.length)+' unresolved · Instructor review · Retry rounds '+esc(r.retries)+'/'+esc(r.limit)+'</p><ul>'+r.questions.map(q=>'<li>Question '+esc(q.number)+' · '+esc(q.type.toUpperCase())+' — '+esc(q.reason)+(q.retryable?'':' (cannot safely retry)')+'</li>').join('')+'</ul>'+(r.problem?'<p>'+esc(r.problem)+'</p>':'')
   +(deadlineOnly?'<p>These questions were not reached before the overall timer expired. There are no recorded answers to retry. Analysis cannot recover answers that were never recorded.</p>':'')
   +'<p>Only missing assessments are retried, up to twice. Your final publication remains a separate action. Unresolved questions are clearly excluded; saved answers and completed marks are retained.</p>'
   +(!r.started||r.canRetry||r.busy?'<button type="button" class="btn-sm" data-result-analyse>'+(!r.started?'Analyse and retry up to twice':'Continue analysis')+'</button>':'')
   +(r.canPublish?'<p>Analysis complete. Review the unresolved questions above before publishing.</p><label>Report note<textarea data-result-note rows="3">Published at instructor request after review of the available assessments. Unavailable questions are excluded; saved answers, recordings and completed marks are retained.</textarea></label><label><input type="checkbox" data-result-confirm> I confirm publication with the listed exclusions.</label><button type="button" class="btn-sm" data-result-publish>Publish results</button>':'')+'</section>';
 }
 async function act(event,{host,diagnostic,request,commit,lock,notice,operations,operationId=()=>crypto.randomUUID(),pause=()=>new Promise(r=>setTimeout(r,2000))}){
  const publish=event.target.closest('[data-result-publish]'),analyse=event.target.closest('[data-result-analyse]');if(!publish&&!analyse)return false;
  const before=diagnostic;if(!before?.review)return true;
  const check=value=>{if(!host.isConnected)throw Error('Review panel closed.');if(value.owner!==before.owner||value.attemptId!==before.attemptId||value.review?.inputsHash!==before.review.inputsHash)throw Error('The returned attempt or saved inputs changed. Inspect the record again.');return value;};
  const operation=key=>{if(!operations.has(key))operations.set(key,'review:'+operationId());return operations.get(key);};
  let note;if(publish){note=host.querySelector('[data-result-note]').value.trim();if(!host.querySelector('[data-result-confirm]').checked||note.length<10){notice('Confirm publication and add a report note.');return true;}}
  lock(true);
  try{
   let current=before;
   if(publish){notice('Publishing the reviewed results…');current=check(await request({action:'publish',operation:operation('publish:'+before.review.evidenceHash+':'+note),evidenceHash:before.review.evidenceHash,note,confirmPublish:true}));commit(current);if(!current.ready)throw Error('Publication was saved but the complete report needs verification.');notice('Results published. Saved answers, recordings and completed marks are retained.');return true;}
   notice('Analysing saved assessments and retrying missing work…');
   for(let poll=0;poll<450&&host.isConnected;poll++){
    const r=current.review;
    if(r.published)break;
    if(!r.started||!r.busy&&r.canRetry){current=check(await request({action:'analyse',operation:operation('analyse:'+r.evidenceHash),evidenceHash:r.evidenceHash}));commit(current);}
    if(current.review.canPublish||!current.review.busy&&!current.review.canRetry)break;
    await pause();if(!host.isConnected)break;current=check(await request());commit(current);notice('Retry rounds '+current.review.retries+'/2 · '+current.review.assessedCount+' assessed. Waiting for missing assessments…');
   }
   if(host.isConnected)notice(current.review.canPublish?'Analysis complete. Review the summary and click Publish results when ready.':current.review.problem||'Analysis is still running. Reopen this attempt and Continue analysis to resume.');
  }catch(error){if(host.isConnected)notice(error.message);}finally{if(host.isConnected)lock(false);}
  return true;
 }
 return {render,act};
});
