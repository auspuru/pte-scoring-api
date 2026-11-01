(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AdminFullMockRecovery=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function mount(host,{username,request,operationId=()=>crypto.randomUUID()}){
    let diagnostic=null,busy=false,operation=null;
    host.innerHTML='<h4>Full mock recording review</h4><p>Inspect the exact submitted attempt. After listening to the saved recordings, exclude only unusable Answer Short Question audio. Completed marks and original recordings are retained.</p><label>Full mock attempt ID<input data-full-attempt autocomplete="off" placeholder="Attempt ID from the alert email"></label><button type="button" class="btn-sm" data-full-inspect>Inspect full mock</button><p role="status" aria-live="polite" data-full-notice></p><div data-full-diagnostics></div>';
    const input=host.querySelector('[data-full-attempt]'),notice=host.querySelector('[data-full-notice]'),details=host.querySelector('[data-full-diagnostics]');
    const path=id=>'/api/admin/full-mocks/'+encodeURIComponent(username)+'/'+encodeURIComponent(id)+'/scoring';
    function lock(value){busy=value;input.disabled=value;host.querySelectorAll('button').forEach(button=>button.disabled=value);}
    function paint(){
      const d=diagnostic,eligible=d.questions.filter(row=>row.eligible);
      details.innerHTML='<p><strong>'+esc(d.assessedCount)+' assessed · '+esc(d.excludedCount)+' excluded · '+esc(d.accountedFor)+'/'+esc(d.total)+' accounted for</strong></p>'
        +(d.busy?'<p>Assessment work is active. Inspect again when it has settled.</p>':d.recovery.status==='scheduled'?'<p>Automatic recovery is scheduled. An explicit audio exclusion replaces recovery only for the selected recordings.</p>':'')
        +d.questions.map(row=>'<p>'+(row.eligible&&!d.busy?'<label><input type="checkbox" data-full-question value="'+esc(row.id)+'"> ':'')+'Q'+esc(row.number)+' · '+esc(row.type)+' · '+esc(row.status)+(row.reason?' · '+esc(row.reason):'')+(row.exclusion?' · '+esc(row.exclusion.note):'')+(row.eligible&&!d.busy?'</label>':'')+'</p>').join('')
        +(eligible.length&&!d.busy?'<label>Exclusion note<textarea data-full-note rows="3">Recording too quiet to assess. Excluded at instructor request; the original recording is retained.</textarea></label><label><input type="checkbox" data-full-reviewed> I reviewed the selected saved recordings and confirm the audio is unusable.</label><button type="button" class="btn-sm" data-full-exclude>Exclude selected unusable recordings</button>':'');
    }
    async function inspect(){
      if(busy)return;const id=input.value.trim();
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)){notice.textContent='Enter the exact Full Mock attempt ID.';return;}
      lock(true);notice.textContent='Loading saved Full Mock evidence…';
      try{const value=await request(path(id));if(!host.isConnected)return;if(value.owner!==username||value.attemptId!==id)throw Error('The returned attempt does not match.');diagnostic=value;operation=null;paint();notice.textContent=value.ready?'The complete report is ready.':'Review loaded. No marks or recordings have changed.';}
      catch(error){diagnostic=null;details.innerHTML='';notice.textContent=error.message;}finally{lock(false);}
    }
    input.oninput=()=>{diagnostic=null;operation=null;details.innerHTML='';notice.textContent='';};
    host.querySelector('[data-full-inspect]').onclick=inspect;
    details.onclick=async event=>{
      if(!event.target.closest('[data-full-exclude]')||busy||!diagnostic)return;
      const questionIds=[...details.querySelectorAll('[data-full-question]:checked')].map(input=>input.value),note=details.querySelector('[data-full-note]').value.trim();
      if(!questionIds.length||note.length<10||!details.querySelector('[data-full-reviewed]').checked){notice.textContent='Select the exact recordings, add a note and confirm the audio review.';return;}
      const before=diagnostic,key=JSON.stringify({evidenceHash:before.evidenceHash,questionIds,note});
      if(!operation||operation.key!==key)operation={key,id:'staff:'+operationId()};
      lock(true);notice.textContent='Saving the selected exclusions…';
      try{
        const value=await request(path(before.attemptId)+'/exclude-audio',{operation:operation.id,evidenceHash:before.evidenceHash,questionIds,note,confirmUnusableAudio:true});
        if(value.owner!==username||value.attemptId!==before.attemptId||value.responsesHash!==before.responsesHash||value.confirmedHash!==before.confirmedHash)throw Error('The retained evidence requires verification. Inspect the saved record.');
        diagnostic=value;paint();notice.textContent=value.ready?'Result ready. Selected unusable recordings are excluded; original recordings and completed marks are unchanged.':'Exclusions saved. Other missing assessments remain pending.';
      }catch(error){notice.textContent=error.message;}finally{lock(false);}
    };
    return {inspect};
  }
  return {mount};
});
