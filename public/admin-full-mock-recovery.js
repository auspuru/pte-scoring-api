(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AdminFullMockRecovery=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const azureReview=typeof module==='object'&&module.exports?require('./admin-azure-reassessment'):globalThis.AdminAzureReassessment;
  const resultReview=typeof module==='object'&&module.exports?require('./admin-result-review'):globalThis.AdminResultReview;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function mount(host,{username,request,operationId=()=>crypto.randomUUID()}){
    let diagnostic=null,busy=false,operation=null,delivery=null;const deliveryOperations=new Map();const reviewOperations=new Map();const unavailableOperations=new Map();
    host.innerHTML='<h4>Full mock recording review</h4><p>Choose and inspect the exact submitted attempt. Reassess saved speaking recordings or resolve unavailable assessments. Review proposed changes before publishing; original recordings and score history are retained.</p><button type="button" class="btn-sm" data-full-list>Find submitted Full Mocks</button><div data-full-attempts></div><label>Full mock attempt ID<input data-full-attempt autocomplete="off" placeholder="Choose a saved attempt or enter its ID"></label><button type="button" class="btn-sm" data-full-inspect>Inspect full mock</button><p role="status" aria-live="polite" data-full-notice></p><div data-full-diagnostics></div>';
    const input=host.querySelector('[data-full-attempt]'),notice=host.querySelector('[data-full-notice]'),details=host.querySelector('[data-full-diagnostics]');
    const path=id=>'/api/admin/full-mocks/'+encodeURIComponent(username)+'/'+encodeURIComponent(id)+'/scoring';
    function lock(value){busy=value;input.disabled=value;host.querySelectorAll('button, select').forEach(button=>button.disabled=value);}
    function paint(){
      const d=diagnostic,eligible=d.questions.filter(row=>row.eligible&&!row.transcriptionEligible),held=d.questions.find(row=>row.deliveryEligible),heldTranscription=d.questions.find(row=>row.transcriptionEligible),unavailable=d.questions.filter(row=>row.retryableUnavailable);
      details.innerHTML='<p><strong>'+esc(d.assessedCount)+' assessed · '+esc(d.excludedCount)+' excluded · '+esc(d.accountedFor)+'/'+esc(d.total)+' accounted for</strong></p>'
        +(d.busy?'<p>Assessment work is active. Inspect again when it has settled.</p>':d.recovery.status==='scheduled'?'<p>Automatic recovery is scheduled. An explicit audio exclusion replaces recovery only for the selected recordings.</p>':'')
        +d.questions.map(row=>'<p>'+(row.eligible&&!row.transcriptionEligible&&!d.busy?'<label><input type="checkbox" data-full-question value="'+esc(row.id)+'"> ':'')+'Q'+esc(row.number)+' · '+esc(row.type)+' · '+esc(row.status)+(row.reason?' · '+esc(row.reason):'')+(row.exclusion?' · '+esc(row.exclusion.note):'')+(row.eligible&&!row.transcriptionEligible&&!d.busy?'</label>':'')+'</p>').join('')
        +(unavailable.length&&!d.busy?'<h5>Retry unavailable scores</h5><p>'+esc(unavailable.length)+' saved responses have a confirmed failed assessment, including provider 429 or a rejected provisional Writing grade. Retry their missing assessments after API credit is available. Existing confirmed marks stay saved.</p><label><input type="checkbox" data-full-retry-confirm> API credit is available; retry these exact unavailable questions.</label><button type="button" class="btn-sm" data-full-retry-unavailable>Retry '+esc(unavailable.length)+' unavailable assessments</button>':'')
        +(eligible.length&&!d.busy?'<label>Exclusion note<textarea data-full-note rows="3">Recording too quiet to assess. Excluded at instructor request; the original recording is retained.</textarea></label><label><input type="checkbox" data-full-reviewed> I reviewed the selected saved recordings and confirm the audio is unusable.</label><button type="button" class="btn-sm" data-full-exclude>Exclude selected unusable recordings</button>':'')
        +(heldTranscription&&!d.busy?'<h5>Final unavailable transcription</h5><p>Only Question '+esc(heldTranscription.number)+' will be excluded at instructor request. This records an unavailable assessment, without claiming a listening review.</p><label>Transcription exclusion note<textarea data-full-transcription-note rows="3">Excluded at instructor request because automatic transcription could not be completed. The original recording and all other confirmed assessments are retained.</textarea></label><label><input type="checkbox" data-full-transcription-confirm> I confirm the instructor requested exclusion of Question '+esc(heldTranscription.number)+'.</label><button type="button" class="btn-sm" data-full-exclude-transcription>Exclude Question '+esc(heldTranscription.number)+' and release report</button>':'')
        +(held&&!d.busy?'<h5>Final Repeat Sentence delivery assessment</h5><p>Only Question '+esc(held.number)+' will be excluded. Its recording and completed stages stay saved. The other 64 assessments are retained.</p><label>Instructor exclusion note<textarea data-full-delivery-note rows="3">Excluded at instructor request because the delivery assessment could not be completed. The saved response and completed assessment stages are retained.</textarea></label><label><input type="checkbox" data-full-instructor-confirm> I confirm the instructor requested exclusion of Question '+esc(held.number)+'.</label><button type="button" class="btn-sm" data-full-exclude-delivery>Exclude Question '+esc(held.number)+' and release report</button>':'');
    }
    const legacyPaint=paint;paint=function(){if(!diagnostic)return;legacyPaint();const saved=details.innerHTML;details.innerHTML=azureReview.render(diagnostic,delivery)+(diagnostic.review?.started?'':saved)+(resultReview?resultReview.render(diagnostic):'');};
    async function inspect(){
      if(busy)return;const id=input.value.trim();
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)){notice.textContent='Enter the exact Full Mock attempt ID.';return;}
      lock(true);notice.textContent='Loading saved Full Mock evidence…';
      try{const value=await request(path(id));if(!host.isConnected)return;if(value.owner!==username||value.attemptId!==id)throw Error('The returned attempt does not match.');diagnostic=value;delivery=null;operation=null;paint();notice.textContent=value.ready?'The complete report is ready.':'Review loaded. No marks or recordings have changed.';}
      catch(error){diagnostic=null;details.innerHTML='';notice.textContent=error.message;}finally{lock(false);}
    }
    host.querySelector('[data-full-list]').onclick=async()=>{
      if(busy)return;lock(true);notice.textContent='Finding submitted Full Mocks…';
      try{const value=await request('/api/admin/full-mocks/'+encodeURIComponent(username)+'/attempts');if(!host.isConnected)return;if(value.owner!==username)throw Error('The account does not match.');
        const list=host.querySelector('[data-full-attempts]');list.innerHTML=value.attempts.length?'<label>Saved Full Mock<select data-full-select><option value="">Choose an attempt</option>'+value.attempts.sort((a,b)=>(b.submittedAt||0)-(a.submittedAt||0)).map(a=>'<option value="'+esc(a.id)+'">'+esc(a.paperId||'Full Mock')+' · '+esc(a.submittedAt?new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Brisbane',dateStyle:'medium',timeStyle:'short'}).format(new Date(a.submittedAt)):a.id)+' · '+esc(a.id)+'</option>').join('')+'</select></label>':'<p>No submitted Full Mocks found for this account.</p>';
        const select=list.querySelector('select');if(select)select.onchange=()=>{input.value=select.value;input.oninput();};notice.textContent='Choose the exact saved attempt, then inspect it.';
      }catch(error){notice.textContent=error.message;}finally{if(host.isConnected)lock(false);}
    };
    input.oninput=()=>{diagnostic=null;delivery=null;operation=null;details.innerHTML='';notice.textContent='';};
    host.querySelector('[data-full-inspect]').onclick=inspect;
    details.onclick=async event=>{
      if(busy)return;
      if(event.target.closest('[data-full-retry-unavailable]')){
        if(!diagnostic)return;
        const before=diagnostic,questionIds=before.questions.filter(row=>row.retryableUnavailable).map(row=>row.id);
        if(!questionIds.length||!details.querySelector('[data-full-retry-confirm]')?.checked){notice.textContent='Confirm API credit is available before retrying saved unavailable assessments.';return;}
        const key=JSON.stringify({id:before.attemptId,evidenceHash:before.evidenceHash,questionIds});
        if(!unavailableOperations.has(key))unavailableOperations.set(key,'staff:'+operationId());
        lock(true);notice.textContent='Starting retries for the saved unavailable assessments…';
        try{const value=await request(path(before.attemptId)+'/retry-unavailable',{operation:unavailableOperations.get(key),evidenceHash:before.evidenceHash,questionIds,confirmRetry:true});
          if(value.owner!==username||value.attemptId!==before.attemptId||value.responsesHash!==before.responsesHash)throw Error('The saved responses changed. Inspect the attempt again.');
          diagnostic=value;paint();notice.textContent='Retry started. Inspect this attempt again after assessment settles to see recovered scores.';
        }catch(error){notice.textContent=error.message;}finally{lock(false);}return;
      }
      if(await azureReview.act(event,{host:details,diagnostic,delivery,operations:deliveryOperations,operationId,
        request:(suffix,body)=>request(path(diagnostic.attemptId)+'/delivery'+suffix,body),
        commit:async(value,published)=>{delivery=value;if(published){const current=await request(path(value.attemptId));if(current.owner!==username||current.attemptId!==value.attemptId)throw Error('The updated report does not match the selected attempt.');diagnostic=current;}paint();},
        lock:value=>{lock(value);if(!value)paint();},notice:value=>{notice.textContent=value;}}))return;
      if(resultReview&&await resultReview.act(event,{host,diagnostic,operations:reviewOperations,operationId,request:async body=>request(path(diagnostic.attemptId)+(body?'/review':''),body),commit:value=>{diagnostic=value;paint();},lock,notice:value=>{notice.textContent=value;}}))return;
      const deliveryExclusion=!!event.target.closest('[data-full-exclude-delivery]'),transcription=!!event.target.closest('[data-full-exclude-transcription]');
      if((!deliveryExclusion&&!transcription&&!event.target.closest('[data-full-exclude]'))||busy||!diagnostic)return;
      const held=diagnostic.questions.find(row=>transcription?row.transcriptionEligible:row.deliveryEligible);
      const questionIds=deliveryExclusion||transcription?(held?[held.id]:[]):[...details.querySelectorAll('[data-full-question]:checked')].map(input=>input.value),note=details.querySelector(deliveryExclusion?'[data-full-delivery-note]':transcription?'[data-full-transcription-note]':'[data-full-note]').value.trim();
      if(!questionIds.length||note.length<10||!details.querySelector(deliveryExclusion?'[data-full-instructor-confirm]':transcription?'[data-full-transcription-confirm]':'[data-full-reviewed]').checked){notice.textContent=deliveryExclusion||transcription?'Confirm the exact instructor-requested question exclusion and add a note.':'Select the exact recordings, add a note and confirm the audio review.';return;}
      const before=diagnostic,key=JSON.stringify({evidenceHash:before.evidenceHash,questionIds,note,deliveryExclusion,transcription});
      if(!operation||operation.key!==key)operation={key,id:'staff:'+operationId()};
      lock(true);notice.textContent='Saving the selected exclusions…';
      try{
        const value=await request(path(before.attemptId)+(deliveryExclusion?'/exclude-delivery':'/exclude-audio'),{operation:operation.id,evidenceHash:before.evidenceHash,questionIds,note,...(deliveryExclusion||transcription?{confirmInstructorExclusion:true,...(transcription?{mode:'failed-transcription'}:{})}:{confirmUnusableAudio:true})});
        if(value.owner!==username||value.attemptId!==before.attemptId||value.responsesHash!==before.responsesHash||value.confirmedHash!==before.confirmedHash)throw Error('The retained evidence requires verification. Inspect the saved record.');
        diagnostic=value;paint();notice.textContent=value.ready?(deliveryExclusion||transcription?'Result ready. The selected question is excluded at instructor request; saved responses and completed marks are unchanged.':'Result ready. Selected unusable recordings are excluded; original recordings and completed marks are unchanged.'):'Exclusions saved. Other missing assessments remain pending.';
      }catch(error){notice.textContent=error.message;}finally{lock(false);}
    };
    return {inspect};
  }
  return {mount};
});
