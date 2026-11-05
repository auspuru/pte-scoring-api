(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AdminAzureReassessment=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const index=value=>value?.practiceIndex??(value?.practiceIndexRange?value.practiceIndexRange.low+'–'+value.practiceIndexRange.high:'pending');
  function render(diagnostic,delivery){
    if(!diagnostic)return '';
    if(!diagnostic.ready)return '<section><h5>Azure delivery reassessment</h5><p>The saved report must finish its original assessment before confirmed delivery marks can be replaced. Use the missing-result controls below.</p></section>';
    if(!delivery)return '<section><h5>Azure delivery reassessment</h5><button type="button" class="btn-sm" data-delivery-load>Load saved recordings for reassessment</button></section>';
    const ops=Object.entries(delivery.operations||{}),busy=ops.some(([,op])=>op.batch&&['queued','running','paused'].includes(op.status)),review=ops.some(([,op])=>['review','partial'].includes(op.status)&&op.evidenceHash===delivery.evidenceHash),available=delivery.questions.filter(q=>!q.blocked),canSend=!busy&&!review&&delivery.provider?.ready!==false&&available.length>0;
    const button=(text,attribute,disabled=false)=>'<button type="button" class="btn-sm" '+attribute+(disabled?' style="opacity:.55;cursor:not-allowed" disabled':'')+'>'+text+'</button>';
    return '<section data-azure-panel><h5>Azure delivery reassessment</h5><p><strong>Account '+esc(delivery.owner)+' · '+esc(delivery.paperId)+' v'+esc(delivery.paperVersion)+'</strong><br>Attempt '+esc(delivery.attemptId)+'</p><p>Select several recordings or send all available speaking recordings from this saved mock. Azure reassesses pronunciation and fluency. Content, Writing, Reading and Listening answers stay unchanged. Each recording requests a paid assessment.</p>'
      +(delivery.provider?.ready===false?'<p role="alert">'+esc(delivery.provider.message)+'</p>':'')
      +(busy?'<p role="status">Reassessment is running in the background. Refresh status to see saved progress; reloading the page does not resend completed recordings.</p>':'')
      +(review?'<p role="status">A reassessment is ready. Publish or discard it before starting another batch.</p>':'')
      +'<p>'+available.length+' available recordings · '+(delivery.questions.length-available.length)+' already in a saved reassessment. ASQ, gated answers and unavailable recordings have no replaceable delivery marks.</p>'
      +button('Select all available','data-delivery-select-all',!canSend)+button('Clear selection','data-delivery-select-none',!canSend)
      +delivery.questions.map(q=>'<div style="padding:8px 0"><label style="display:flex;gap:8px;align-items:flex-start;text-transform:none"><input type="checkbox" style="width:auto;margin:2px 0" data-delivery-question value="'+esc(q.id)+'"'+(!canSend||q.blocked?' disabled':'')+'> <span>Q'+esc(q.number)+' · '+esc(q.type.toUpperCase())+' · Pronunciation '+esc(q.previous.pronunciation)+'/5 · Fluency '+esc(q.previous.fluency)+'/5'+(q.blocked?' · Already in a saved reassessment; see its status below.':'')+'</span></label>'+button('Send this recording','data-delivery-send="'+esc(q.id)+'"',!canSend||q.blocked)+'</div>').join('')
      +button('Send selected recordings','data-delivery-send-selected',!canSend)+button('Send whole mock for reassessment','data-delivery-send-all',!canSend)
      +ops.map(([id,op])=>{
        const items=op.batch?op.items:[{...op,status:op.result?'complete':op.status}],completed=items.filter(item=>item.status==='complete'),failed=items.filter(item=>['failed','confirmation-pending'].includes(item.status)),previewCurrent=['review','partial'].includes(op.status)&&op.evidenceHash===delivery.evidenceHash,ready=previewCurrent&&op.proposalReady!==false;
        return '<section style="padding:12px 0"><h5>'+(op.batch?'Batch reassessment':'Earlier recording request')+' · '+esc(op.status)+'</h5><p>'+completed.length+'/'+items.length+' confirmed'+(failed.length?' · '+failed.length+' unavailable; original marks retained':'')+'</p>'
          +items.map(item=>'<p>Q'+esc(item.number??item.questionId)+' · '+esc(item.status)+(item.result?' · Pronunciation '+esc(item.previous.result.scores.pronunciation)+' → '+esc(item.result.pronunciation.score)+'/5 · Fluency '+esc(item.previous.result.scores.fluency)+' → '+esc(item.result.fluency.score)+'/5':'')+(item.message?'<br>'+esc(item.message):'')+'</p>').join('')
          +(op.message?'<p role="status">'+esc(op.message)+'</p>':'')
          +(op.proposedProfiles?'<p>Report indices: '+Object.entries(op.proposedProfiles).map(([name,value])=>esc(name)+' '+esc(index(delivery.profiles[name]))+' → '+esc(index(value))).join(' · ')+'</p>':'')
          +(previewCurrent&&op.proposalReady===false?'<p role="alert">'+esc(op.proposalError||'The proposed report is incomplete. Publication is unavailable until its saved assessments can be verified; original marks are retained.')+'</p>':'')
          +(previewCurrent&&op.proposalReady===false&&op.proposalIssues?.length?'<p>Questions needing review: '+op.proposalIssues.map(item=>'Q'+esc(item.number)+' · '+esc(item.type.toUpperCase())).join(', ')+'</p>':'')
          +(ready&&completed.length?'<label style="display:flex;gap:8px;text-transform:none"><input type="checkbox" style="width:auto" data-delivery-confirm="'+esc(id)+'"> Replace published delivery marks for '+completed.length+' confirmed recording(s) and recalculate the report.'+(failed.length?' Keep the original marks for '+failed.length+' unavailable recording(s).':'')+'</label>'+button('Publish replacement scores','data-delivery-publish="'+esc(id)+'"'):'')
          +(['review','partial','stale'].includes(op.status)?button('Discard proposed replacement','data-delivery-discard="'+esc(id)+'"'):'')+'</section>';
      }).join('')+button('Refresh reassessment status','data-delivery-load')+'</section>';
  }
  async function act(event,{host,diagnostic,delivery,request,commit,lock,notice,operations,operationId=()=>crypto.randomUUID(),pause=()=>new Promise(resolve=>setTimeout(resolve,2000))}){
    const target=event.target,load=target.closest('[data-delivery-load]'),single=target.closest('[data-delivery-send]'),selected=target.closest('[data-delivery-send-selected]'),all=target.closest('[data-delivery-send-all]'),publish=target.closest('[data-delivery-publish]'),discard=target.closest('[data-delivery-discard]'),selectAll=target.closest('[data-delivery-select-all]'),clear=target.closest('[data-delivery-select-none]');
    if(selectAll||clear){host.querySelectorAll('[data-delivery-question]').forEach(input=>{if(!input.disabled)input.checked=!!selectAll;});notice(selectAll?'All available recordings selected. Click Send selected recordings.':'Recording selection cleared.');return true;}
    if(!load&&!single&&!selected&&!all&&!publish&&!discard)return false;
    if(!diagnostic?.ready){notice('Inspect a complete submitted Full Mock before sending saved recordings.');return true;}
    const check=value=>{if(!host.isConnected)throw Error('Review panel closed. Reopen the attempt to see its saved status.');if(value.owner!==diagnostic.owner||value.attemptId!==diagnostic.attemptId)throw Error('The returned account or attempt does not match.');return value;};
    const sending=single||selected||all;let body,suffix='';
    if(sending){
      if(!delivery){notice('Load saved recordings first.');return true;}
      const questionIds=single?[single.dataset.deliverySend]:all?delivery.questions.filter(q=>!q.blocked).map(q=>q.id):[...host.querySelectorAll('[data-delivery-question]')].filter(input=>input.checked&&!input.disabled).map(input=>input.value);
      if(!questionIds.length){notice('Select at least one available recording to send.');return true;}
      const key=delivery.evidenceHash+':'+[...questionIds].sort().join(',');if(!operations.has(key))operations.set(key,'delivery:'+operationId());body={operation:operations.get(key),questionIds,evidenceHash:delivery.evidenceHash};suffix='/send';
    }
    if(publish){const op=delivery.operations[publish.dataset.deliveryPublish],confirmation=[...host.querySelectorAll('[data-delivery-confirm]')].find(input=>input.dataset.deliveryConfirm===publish.dataset.deliveryPublish);if(!confirmation?.checked){notice('Confirm replacement of the published marks first.');return true;}body={operation:publish.dataset.deliveryPublish,confirmPublish:true,...(op.status==='partial'?{confirmPartial:true}:{})};suffix='/publish';}
    if(discard){body={operation:discard.dataset.deliveryDiscard};suffix='/discard';}
    const reconcile=value=>{for(const [key,id] of operations)if(['published','discarded','stale'].includes(value.operations?.[id]?.status))operations.delete(key);return value;};
    lock(true);notice(sending?'Queueing the selected original recordings for Azure reassessment…':publish?'Publishing the reviewed replacement scores…':'Loading reassessment status…');
    try{
      let current=reconcile(check(await request(suffix,body)));
      if(discard)for(const [key,value] of operations)if(value===body.operation)operations.delete(key);
      await commit(current,!!publish);lock(true);
      for(let poll=0;poll<900&&host.isConnected&&Object.values(current.operations||{}).some(op=>op.batch&&['queued','running'].includes(op.status));poll++){
        const running=Object.values(current.operations).find(op=>op.batch&&['queued','running'].includes(op.status));notice('Azure reassessment: '+running.items.filter(item=>item.status==='complete').length+'/'+running.items.length+' confirmed. Progress is saved; you may reopen this attempt later.');
        await pause();if(!host.isConnected)return true;current=reconcile(check(await request('',undefined)));await commit(current,false);lock(true);
      }
      const unfinished=Object.values(current.operations||{}).some(op=>op.batch&&['queued','running'].includes(op.status));
      notice(publish?'Replacement scores published. The report was recalculated and original scores remain in history.':discard?'Proposed replacement discarded. Published scores are unchanged.':unfinished?'The saved reassessment is still running. Reopen this attempt or refresh status to continue watching.':'Reassessment status loaded. Review confirmed scores below before publishing. Any unavailable recordings keep their original marks.');
    }catch(error){if(host.isConnected)notice(error.message+' Refresh reassessment status to check saved work before sending again.');}
    finally{if(host.isConnected)lock(false);}
    return true;
  }
  return {render,act};
});
