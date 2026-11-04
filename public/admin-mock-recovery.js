(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AdminMockRecovery=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const resultReview=typeof module==='object'&&module.exports?require('./admin-result-review'):globalThis.AdminResultReview;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stages=new Set(['transcription','content','azure','academy']);
  function canRepair(job,name,value){
    return stages.has(name)&&job.status==='needs_attention'&&!job.exclusion&&value.status==='needs_attention'
      &&!['academy_transport','uncertain_provider_outcome','insufficient_quota','billing_hard_limit_reached','invalid_api_key'].includes(String(value.code))
      &&![400,401,403,404,409,413,422].includes(Number(value.code))
      &&!(name==='academy'&&(job.remoteFailures||[]).some(f=>f.uncertain||f.code==='uncertain_provider_outcome'||!f.retryable&&![429,500,502,503,504].includes(Number(f.code||f.status))))
      &&!['insufficient_quota','billing_hard_limit_reached','invalid_api_key'].includes(value.detail?.code);
  }
  function mount(host,{username,request,operationId=()=>crypto.randomUUID()}){
    let diagnostic=null,busy=false,serial=0;
    const operations=new Map();
    host.innerHTML='<h4>Speaking mock recovery</h4><p>Inspect one saved attempt and retry only a held, missing assessment. Active automatic work and uncertain requests cannot be reset here.</p><label>Speaking mock attempt ID<input data-mock-attempt autocomplete="off" placeholder="Attempt ID from the alert email"></label><button type="button" class="btn-sm" data-mock-inspect>Inspect scoring</button><p role="status" aria-live="polite" data-mock-notice></p><div data-mock-diagnostics></div>';
    const input=host.querySelector('[data-mock-attempt]'),notice=host.querySelector('[data-mock-notice]'),details=host.querySelector('[data-mock-diagnostics]');
    const path=id=>'/api/admin/speaking-mocks/'+encodeURIComponent(username)+'/'+encodeURIComponent(id)+'/scoring';
    function lock(value){busy=value;input.disabled=value;host.querySelectorAll('button').forEach(b=>b.disabled=value);}
    function paint(){
      const d=diagnostic;
      details.innerHTML='<p><strong>'+esc(d.accountedFor)+'/'+esc(d.total)+' questions accounted for · '+esc(d.status)+'</strong></p>'+(d.jobs||[]).filter(j=>j.status!=='ready').map(job=>'<section><h5>Question index '+esc(job.index)+'</h5>'+Object.entries(job.stages||{}).map(([name,s])=>'<p>'+esc(name)+': '+esc(s.status)+(s.code?' · '+esc(s.code):'')+(s.detail?' · '+esc(JSON.stringify(s.detail)):'')+(canRepair(job,name,s)?' <button type="button" class="btn-sm" data-mock-job="'+esc(job.id)+'" data-mock-stage="'+esc(name)+'">Retry missing '+esc(name)+'</button>':'')+'</p>').join('')+'</section>').join('');
      if(d.deadlineRelease?.eligible&&!d.review?.started)details.innerHTML+='<h5>Final unreached question</h5><p>Question '+esc(d.deadlineRelease.number)+' was not reached before the overall timer expired. All other 26 assessments are confirmed.</p><label>Exclusion note<textarea data-mock-deadline-note rows="3">This question was not reached before the overall timer expired. Excluded at instructor request; saved recordings and completed marks are retained.</textarea></label><label><input type="checkbox" data-mock-deadline-confirm> I confirm the instructor requested exclusion of Question '+esc(d.deadlineRelease.number)+'.</label><button type="button" class="btn-sm" data-mock-deadline-release>Exclude Question '+esc(d.deadlineRelease.number)+' and release report</button>';
      if(d.review?.started)details.innerHTML='<p><strong>'+esc(d.accountedFor)+'/'+esc(d.total)+' questions accounted for</strong></p>';
      if(resultReview)details.innerHTML+=resultReview.render(d);
    }
    async function inspect(){
      if(busy)return;const id=input.value.trim();
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)){notice.textContent='Enter the exact attempt ID from the alert.';return;}
      const ticket=++serial;lock(true);notice.textContent='Loading saved scoring diagnostics…';
      try{const value=await request(path(id));if(ticket!==serial||!host.isConnected)return;if(value.attemptId!==id)throw Error('The returned attempt does not match.');diagnostic=value;paint();notice.textContent=value.ready?'The complete report is ready.':'Saved diagnostics loaded. Only eligible held stages have a retry action.';}
      catch(e){diagnostic=null;details.innerHTML='';notice.textContent=e.message;}
      finally{lock(false);}
    }
    input.oninput=()=>{serial++;diagnostic=null;details.innerHTML='';notice.textContent='';};
    host.querySelector('[data-mock-inspect]').onclick=inspect;
    details.onclick=async event=>{
      if(busy)return;if(resultReview&&await resultReview.act(event,{host,diagnostic,operations,operationId,request:async body=>request(path(diagnostic.attemptId)+(body?'/retry':''),body?{...body,mode:'instructor-review'}:undefined),commit:value=>{diagnostic=value;paint();},lock,notice:value=>{notice.textContent=value;}}))return;
      if(event.target.closest('[data-mock-deadline-release]')){
        if(busy||!diagnostic?.deadlineRelease?.eligible)return;
        const before=diagnostic,release=before.deadlineRelease,note=details.querySelector('[data-mock-deadline-note]').value.trim();
        if(!details.querySelector('[data-mock-deadline-confirm]').checked||note.length<10){notice.textContent='Confirm the instructor-requested exclusion and add a note.';return;}
        const key=JSON.stringify({id:before.attemptId,evidence:release.evidenceHash,note});if(!operations.has(key))operations.set(key,'staff:'+operationId());
        lock(true);notice.textContent='Releasing the saved report…';
        try{const value=await request(path(before.attemptId)+'/retry',{mode:'release-deadline',questionId:release.questionId,evidenceHash:release.evidenceHash,operation:operations.get(key),note,confirmInstructorExclusion:true});
          if(value.owner!==username||value.attemptId!==before.attemptId||value.inputsHash!==before.inputsHash||value.confirmedHash!==before.confirmedHash)throw Error('Retained evidence needs verification. Inspect the attempt again.');
          diagnostic=value;paint();notice.textContent=value.ready?'Report ready. 26 assessed and 1 excluded; saved recordings and completed marks are unchanged.':'Release saved. Inspect scoring to check publication.';
        }catch(e){notice.textContent=e.message;}finally{lock(false);}return;
      }
      const button=event.target.closest('[data-mock-job]');if(!button||button.disabled||busy||!diagnostic)return;
      const id=diagnostic.attemptId,job=diagnostic.jobs.find(j=>j.id===button.dataset.mockJob),name=button.dataset.mockStage;
      if(!job||!canRepair(job,name,job.stages?.[name]||{}))return;
      const key=id+':'+job.id+':'+name+':'+job.updatedAt;
      if(!operations.has(key))operations.set(key,'staff:'+operationId());
      lock(true);notice.textContent='Queuing only the missing '+name+' assessment…';
      try{await request(path(id)+'/retry',{jobId:job.id,stage:name,operation:operations.get(key),acknowledgeUncertain:false});diagnostic=null;details.innerHTML='';notice.textContent='Recovery queued. Completed assessments are retained. Select Inspect scoring to check progress.';}
      catch(e){notice.textContent=e.message;}
      finally{lock(false);}
    };
    return {inspect};
  }
  return {mount,canRepair};
});
