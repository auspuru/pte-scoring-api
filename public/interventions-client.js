(function(root,factory){
  root.StudentInterventions=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const statusLabel={not_started:'Not started',in_progress:'In progress',ready_for_review:'Ready for review',mastered:'Mastered',archived:'Archived'};
  const priorityLabel={high:'High priority',normal:'Current focus',low:'Lower priority'};
  function create({document:doc,identity,navigate,launch}){
    let plans=[],loading=null,owner='',helpTask='swt',helpProblem='',helpResult=null,helpBusy=false,trainer=null;
    function auth(){
      const value=identity?.()||{};
      return {uid:String(value.uid||'').trim().toLowerCase(),token:value.token||''};
    }
    async function api(path,body){
      const {token}=auth();
      const response=await fetch('/api/interventions'+path,{method:body===undefined?'GET':'POST',cache:'no-store',
        headers:{'Content-Type':'application/json','x-session-token':token},body:body===undefined?undefined:JSON.stringify(body),
        signal:AbortSignal.timeout(20000)});
      let data={}; try{data=await response.json();}catch(_){}
      if(!response.ok)throw Error(data.error||'Your improvement plan could not be updated.');
      return data;
    }
    async function load(force=false){
      const id=auth().uid;if(!id)return [];
      if(!force&&loading&&owner===id)return loading;
      owner=id;
      loading=api('').then(data=>{if(owner===id)plans=Array.isArray(data.plans)?data.plans:[];return plans;}).finally(()=>{loading=null;});
      return loading;
    }
    const active=()=>plans.filter(p=>!['mastered','archived'].includes(p.status));
    const doneCount=p=>(p.items||[]).filter(i=>i.status==='completed').length;
    const requiredCount=p=>(p.items||[]).filter(i=>i.required!==false).length;
    const requiredDone=p=>(p.items||[]).filter(i=>i.required!==false&&i.status==='completed').length;
    function itemIcon(item){return item.status==='completed'?'✓':item.kind==='video'?'▶':item.kind==='question'?'Q':item.kind==='swt_selection_trainer'?'✦':item.kind==='practice_set'?'→':item.kind==='instruction'?'i':'•';}
    function itemAction(item){
      if(item.kind==='swt_selection_trainer'){
        const done=item.trainerProgress?.attemptedIds?.length||0,target=item.minimumToComplete||10,total=item.exerciseCount||15;
        return '<button type="button" class="portal-button primary" data-swt-trainer>'+((done||item.status==='started')?'Continue trainer':'Start trainer')+'</button><span class="next-step-sync-note">'+done+'/'+target+' required · '+total+' available</span>';
      }
      if(item.status==='completed'){
        const label=item.completionSource==='attempt_sync'?'Completed automatically':item.kind==='video'?'Watched':item.kind==='instruction'?'Reviewed':'Completed';
        return '<span class="next-step-done">'+label+'</span>';
      }
      if(item.kind==='video')return '<button type="button" class="portal-button" data-step-start="'+esc(item.id)+'">Watch</button><button type="button" class="portal-button primary" data-step-complete="'+esc(item.id)+'">Mark watched</button>';
      if(item.kind==='instruction')return (item.url?'<button type="button" class="portal-button" data-step-start="'+esc(item.id)+'">Open resource</button>':'')+'<button type="button" class="portal-button primary" data-step-complete="'+esc(item.id)+'">Mark reviewed</button>';
      if(item.kind==='practice_set'){
        const count=item.attemptProgress?.count||0,target=item.minimumAttempts||1;
        return '<button type="button" class="portal-button primary" data-practice-set>'+((count||item.status==='started')?'Continue practice':'Start practice')+'</button><span class="next-step-sync-note">'+count+'/'+target+' submitted · syncs automatically</span>';
      }
      if(item.kind==='question')return '<button type="button" class="portal-button primary" data-step-start="'+esc(item.id)+'">'+(item.status==='started'?'Open again':'Start question')+'</button><span class="next-step-sync-note">Completion syncs after you submit it</span>';
      if(item.kind==='practice')return '<span class="next-step-sync-note">This older practice step needs a real activity. Refresh the plan or ask your teacher to update it.</span>';
      return (item.url?'<button type="button" class="portal-button" data-step-start="'+esc(item.id)+'">Open link</button>':'')+'<button type="button" class="portal-button primary" data-step-complete="'+esc(item.id)+'">Mark reviewed</button>';
    }
    function card(plan){
      const required=requiredCount(plan),complete=requiredDone(plan),percent=required?Math.round(complete/required*100):100;
      const items=(plan.items||[]).map(item=>'<li class="next-step-item '+(item.status==='completed'?'complete':'')+'" data-item-id="'+esc(item.id)+'"><span class="next-step-item-icon">'+itemIcon(item)+'</span><div class="next-step-item-copy"><strong>'+esc(item.title)+'</strong>'
        +(item.description?'<p>'+esc(item.description)+'</p>':'')+(item.requireNewAttempt?'<span class="next-step-chip">New attempt required</span>':'')+'</div><div class="next-step-item-actions">'+itemAction(item)+'</div></li>').join('');
      const ready=plan.status==='ready_for_review';
      return '<article class="next-step-plan" data-plan-id="'+esc(plan.id)+'"><header><div><span class="next-step-kicker">'+esc(plan.area||'PTE')+(plan.task?' · '+esc(plan.task):'')+'</span><h2>'+esc(plan.title)+'</h2></div><span class="next-step-status '+esc(plan.status)+'">'+esc(statusLabel[plan.status]||plan.status)+'</span></header>'
        +(plan.reason?'<p class="next-step-reason"><strong>Why this was assigned:</strong> '+esc(plan.reason)+'</p>':'')
        +(plan.teacherNote?'<div class="next-step-note"><strong>Teacher note</strong><p>'+esc(plan.teacherNote)+'</p></div>':'')
        +'<div class="next-step-progress"><div><span>'+complete+' of '+required+' required steps completed</span><strong>'+percent+'%</strong></div><div class="next-step-progress-track"><span style="width:'+percent+'%"></span></div></div>'
        +'<ol class="next-step-items">'+items+'</ol>'
        +'<footer>'+(plan.dueAt?'<span>Due '+esc(new Date(plan.dueAt).toLocaleDateString('en-AU',{day:'numeric',month:'short'}))+'</span>':'<span>'+esc(priorityLabel[plan.priority]||'Current focus')+'</span>')
        +(ready?'<strong class="next-step-ready">Sent to your teacher for review</strong>':plan.status==='mastered'?'<strong class="next-step-mastered">Mastered ✓</strong>':'<button type="button" class="portal-button primary" data-plan-ready="'+esc(plan.id)+'" '+(complete<required?'disabled':'')+'>Ready for teacher review</button>')+'</footer></article>';
    }
    function helpPanel(){
      const score=helpResult?.latestScore;
      const traitLabels={content:'Content',form:'Form',grammar:'Grammar',vocabulary:'Vocabulary',spelling:'Spelling',linguistic:'Linguistic range',coherence:'Structure & coherence'};
      const scoreHtml=score?'<div class="next-step-beta-score"><strong>Recent portal result used</strong><div>'+Object.entries(score.scores||{}).filter(([k])=>!k.endsWith('_max')&&Number.isFinite(Number(score.maxima?.[k]))).map(([k,v])=>'<span>'+esc(traitLabels[k]||k.replaceAll('_',' '))+': '+esc(v)+'/'+esc(score.maxima[k])+'</span>').join('')+'</div></div>':'<p class="next-step-beta-muted">No recent scored attempt was found for this task, so the suggestions use your description and the task scoring method.</p>';
      const suggestions=helpResult?.suggestions||[];
      return '<section class="next-step-beta"><div class="next-step-beta-head"><div><p class="portal-eyebrow">Self-help · Beta</p><h3>Tell us what you are struggling with</h3><p>Choose a writing/listening task and describe the problem. Suggestions use your recent portal scores when available and the scoring traits used in this practice portal.</p></div><span>Beta</span></div>'
        +'<div class="next-step-beta-form"><label>Task<select data-beta-task><option value="swt" '+(helpTask==='swt'?'selected':'')+'>Summarize Written Text</option><option value="sst" '+(helpTask==='sst'?'selected':'')+'>Summarize Spoken Text</option><option value="essay" '+(helpTask==='essay'?'selected':'')+'>Essay Writing</option></select></label><label>What is difficult?<textarea data-beta-problem placeholder="e.g. I do not know how to pick content, how to structure it, or why my score is low.">'+esc(helpProblem)+'</textarea></label><button type="button" class="portal-button primary" data-beta-help '+(helpBusy?'disabled':'')+'>'+(helpBusy?'Checking…':'Get suggestions')+'</button></div>'
        +(helpResult?'<div class="next-step-beta-results">'+scoreHtml+(suggestions.length?suggestions.map(s=>'<article><div><strong>'+esc(s.title)+'</strong><p>'+esc(s.reason)+'</p>'+(s.action?'<p class="next-step-beta-action"><b>What you will do:</b> '+esc(s.action)+'</p>':'')+'</div><button type="button" class="portal-button" data-beta-add="'+esc(s.moduleCode)+'">'+(s.moduleCode==='SWT-CONTENT-01'?'Add highlight practice':'Add to My Next Steps')+'</button></article>').join(''):'<p>No suggestion is available yet.</p>')+'</div>':'')
        +'<p class="next-step-beta-disclaimer">These are study suggestions, not an official Pearson diagnosis or score prediction.</p></section>';
    }
    async function requestHelp(){
      helpBusy=true;render();
      try{helpResult=await api('/help',{task:helpTask,problem:helpProblem});}
      catch(e){notify(e.message,true);}
      finally{helpBusy=false;render();}
    }
    async function addSelfPlan(code){
      try{
        const data=await api('/self-plan',{moduleCode:code,problem:helpProblem,task:helpTask});
        plans.unshift(data.plan);helpResult=null;render();renderDashboard();notify('Added to My Next Steps.');
      }catch(e){notify(e.message,true);}
    }

    function trainerProgressText(data){
      const p=data?.progress||{};return (p.attempted||0)+'/'+(p.minimumToComplete||10)+' required exercises reviewed · '+(p.passed||0)+' met the target accuracy';
    }
    function overlaps(range,start,end){return range&&Number(range.start)<end&&Number(range.end)>start;}
    function mergeTrainerRanges(ranges){
      const source=String(trainer?.exercise?.text||'');
      const clean=(ranges||[]).map(r=>({start:Number(r.start),end:Number(r.end)}))
        .filter(r=>Number.isInteger(r.start)&&Number.isInteger(r.end)&&r.start>=0&&r.end<=source.length&&r.end>r.start)
        .sort((x,y)=>x.start-y.start||x.end-y.end);
      const out=[];
      for(const r of clean){const last=out.at(-1);if(last&&r.start<=last.end)last.end=Math.max(last.end,r.end);else out.push({...r});}
      return out.map(r=>({...r,text:source.slice(r.start,r.end)}));
    }
    function trainerParagraphs(){
      const ex=trainer?.exercise,source=String(ex?.text||'');
      if(Array.isArray(ex?.paragraphs)&&ex.paragraphs.every(p=>Number.isInteger(p.start)&&Number.isInteger(p.end)))return ex.paragraphs;
      return [{start:0,end:source.length,text:source}];
    }
    function trainerSegmentHtml(source,start,end){
      const text=source.slice(start,end);if(!text)return '';
      const selected=(trainer?.selected||[]).some(r=>overlaps(r,start,end));
      if(!trainer?.result){
        return selected
          ? '<mark class="swt-trainer-highlight selected" data-trainer-remove="'+start+':'+end+'" title="Click to remove this highlight">'+esc(text)+'</mark>'
          : esc(text);
      }
      const target=(trainer.result.targetRanges||[]).some(r=>overlaps(r,start,end));
      const cls=target?(selected?' correct-selected':' central-missed'):(selected?' extra-selected':'');
      return cls?'<mark class="swt-trainer-highlight '+cls+'">'+esc(text)+'</mark>':esc(text);
    }
    function trainerParagraphHtml(paragraph){
      const source=String(trainer?.exercise?.text||''),start=Number(paragraph.start)||0,end=Number(paragraph.end)||source.length;
      const ranges=[...(trainer?.selected||[]),...(trainer?.result?.targetRanges||[])].filter(r=>overlaps(r,start,end));
      const points=[start,end];
      for(const r of ranges){points.push(Math.max(start,Number(r.start)),Math.min(end,Number(r.end)));}
      const boundaries=[...new Set(points.filter(n=>Number.isFinite(n)&&n>=start&&n<=end))].sort((x,y)=>x-y);
      let html='';for(let i=0;i<boundaries.length-1;i++)html+=trainerSegmentHtml(source,boundaries[i],boundaries[i+1]);
      return '<p class="swt-trainer-paragraph" data-trainer-paragraph-start="'+start+'">'+html+'</p>';
    }
    function trainerFeedback(){
      const r=trainer?.result;if(!r)return '';
      const missed=(r.missedIdeas||[]).map(x=>'<article><strong>'+esc(x.label)+': '+esc(x.idea)+'</strong><p>'+esc(x.why)+'</p>'+(x.phrases?.length?'<div class="swt-trainer-phrases">'+x.phrases.map(p=>'<span>'+esc(p)+'</span>').join('')+'</div>':'')+'</article>').join('');
      const captured=(r.capturedIdeas||[]).map(x=>'<span>'+esc(x.label)+'</span>').join('');
      const central=(r.centralPhrases||[]).map(p=>'<span>'+esc(p)+'</span>').join('');
      const extras=(r.extraRanges||[]).map(x=>'<span>“'+esc(x.text)+'”</span>').join('');
      return '<section class="swt-trainer-feedback"><div class="swt-trainer-score"><strong>'+r.ideaRecall.captured+'/'+r.ideaRecall.total+' key ideas found</strong><span>'+r.selectionPrecision.percent+'% phrase precision</span></div><p>'+esc(r.feedback)+'</p>'
        +(captured?'<div class="swt-trainer-captured"><b>You captured:</b> '+captured+'</div>':'')
        +(central?'<h4>Central phrases</h4><div class="swt-trainer-phrases">'+central+'</div>':'')
        +(missed?'<h4>What you missed and why it matters</h4><div class="swt-trainer-missed">'+missed+'</div>':'')
        +(extras?'<div class="swt-trainer-extra"><b>Extra wording highlighted:</b><div class="swt-trainer-phrases">'+extras+'</div></div>':'')
        +'</section>';
    }
    function renderTrainer(){
      let overlay=doc.getElementById('swtHighlightTrainer');
      if(!trainer){overlay?.remove();return;}
      if(!overlay){overlay=doc.createElement('div');overlay.id='swtHighlightTrainer';overlay.className='swt-trainer-backdrop';doc.body.appendChild(overlay);}
      const ex=trainer.exercise,p=trainer.progress||{},selectedCount=(trainer.selected||[]).length;
      overlay.innerHTML='<div class="swt-trainer-modal" role="dialog" aria-modal="true" aria-labelledby="swtTrainerTitle"><header><div><p class="portal-eyebrow">SWT Content Selection</p><h2 id="swtTrainerTitle">'+esc(ex.title)+'</h2><p>'+esc(ex.instructions)+'</p></div><button type="button" class="portal-button" data-trainer-close>Close</button></header>'
        +'<div class="swt-trainer-progress"><span>Exercise '+((p.attempted||0)+1)+' of '+(p.total||15)+'</span><strong>'+esc(trainerProgressText(trainer))+'</strong></div>'
        +'<div class="swt-trainer-tip"><b>Your task:</b> Drag across the exact words or phrases you would use to build the summary. You can make several highlights. Click a yellow highlight to remove it before checking.</div>'
        +'<div class="swt-trainer-passage">'+trainerParagraphs().map(trainerParagraphHtml).join('')+'</div>'
        +trainerFeedback()
        +'<footer>'+(trainer.result?'<button type="button" class="portal-button primary" data-trainer-next>Next exercise</button>':'<span>'+selectedCount+' phrase'+(selectedCount===1?'':'s')+' highlighted</span><button type="button" class="portal-button primary" data-trainer-submit '+(!selectedCount?'disabled':'')+'>Check my selection</button>')+'</footer></div>';
      overlay.onclick=trainerClick;
      overlay.onpointerup=e=>{if(!e.target.closest('[data-trainer-remove],[data-trainer-submit],[data-trainer-next],[data-trainer-close]'))setTimeout(captureTrainerSelection,0);};
      overlay.onkeyup=e=>{if(e.key==='Shift')setTimeout(captureTrainerSelection,0);};
    }
    function selectionOffset(root,node,offset){
      const range=doc.createRange();range.selectNodeContents(root);range.setEnd(node,offset);return range.toString().length;
    }
    function captureTrainerSelection(){
      if(!trainer||trainer.result)return;
      const selection=doc.defaultView?.getSelection?.();if(!selection||selection.rangeCount<1||selection.isCollapsed)return;
      const range=selection.getRangeAt(0),paragraph=range.commonAncestorContainer.nodeType===1
        ? range.commonAncestorContainer.closest?.('[data-trainer-paragraph-start]')
        : range.commonAncestorContainer.parentElement?.closest?.('[data-trainer-paragraph-start]');
      if(!paragraph||!paragraph.contains(range.startContainer)||!paragraph.contains(range.endContainer))return;
      const base=Number(paragraph.dataset.trainerParagraphStart)||0;
      let start=base+selectionOffset(paragraph,range.startContainer,range.startOffset);
      let end=base+selectionOffset(paragraph,range.endContainer,range.endOffset);
      const source=String(trainer.exercise.text||'');
      while(start<end&&/\s/.test(source[start]))start++;
      while(end>start&&/\s/.test(source[end-1]))end--;
      selection.removeAllRanges();
      if(end-start<2)return;
      trainer.selected=mergeTrainerRanges([...(trainer.selected||[]),{start,end}]);
      renderTrainer();
    }
    async function openTrainer(plan,item,passageId=''){
      try{
        const qs=passageId?'?passageId='+encodeURIComponent(passageId):'';
        const data=await api('/'+encodeURIComponent(plan.id)+'/items/'+encodeURIComponent(item.id)+'/swt-selection'+qs);
        trainer={planId:plan.id,itemId:item.id,exercise:data.exercise,catalog:data.catalog||[],progress:data.progress||{},selected:[],result:null};
        renderTrainer();
      }catch(e){notify(e.message,true);}
    }
    async function trainerClick(e){
      if(e.target.closest('[data-trainer-close]')||e.target===doc.getElementById('swtHighlightTrainer')){trainer=null;renderTrainer();return;}
      const remove=e.target.closest('[data-trainer-remove]');
      if(remove&&!trainer.result){
        const [start,end]=String(remove.dataset.trainerRemove||'').split(':').map(Number);
        trainer.selected=(trainer.selected||[]).filter(r=>!(r.start===start&&r.end===end));renderTrainer();return;
      }
      if(e.target.closest('[data-trainer-submit]')){
        try{
          const data=await api('/'+encodeURIComponent(trainer.planId)+'/items/'+encodeURIComponent(trainer.itemId)+'/swt-selection/check',{passageId:trainer.exercise.id,selected:trainer.selected||[]});
          trainer.result=data.result;trainer.progress={...trainer.progress,...data.progress};plans=plans.map(p=>p.id===data.plan.id?data.plan:p);render();renderDashboard();renderTrainer();
        }catch(err){notify(err.message,true);}return;
      }
      if(e.target.closest('[data-trainer-next]')){
        const catalog=trainer.catalog||[],attempted=new Set(trainer.progress?.attemptedIds||[]);
        const currentIndex=catalog.findIndex(x=>x.id===trainer.exercise.id);
        let next=catalog.find((x,i)=>i>currentIndex&&!attempted.has(x.id))||catalog.find(x=>!attempted.has(x.id));
        if(!next){next=catalog[(currentIndex+1)%catalog.length];}
        const plan=plans.find(p=>p.id===trainer.planId),item=plan?.items?.find(i=>i.id===trainer.itemId);
        if(plan&&item)await openTrainer(plan,item,next?.id||'');
      }
    }

    function render(){
      const host=doc.getElementById('nextStepsPane');if(!host)return;
      const current=active().slice(0,3),completed=plans.filter(p=>p.status==='mastered');
      host.innerHTML='<div class="next-steps-shell"><div class="next-steps-heading"><div><p class="portal-eyebrow">Your current focus</p><h2>My Next Steps</h2><p>Work through assigned actions. Exact portal questions complete automatically after you submit a qualifying new attempt.</p></div><span class="next-step-count">'+current.length+' active</span></div>'
        +(current.length?'<div class="next-step-plan-list">'+current.map(card).join('')+'</div>':'<div class="next-step-empty"><span class="material-symbols-outlined">task_alt</span><h3>No assigned next steps right now</h3><p>Keep practising normally, or use the Beta helper below to choose a focused study path.</p><button type="button" class="portal-button primary" data-next-practice>Go to Practice</button></div>')
        +helpPanel()
        +(completed.length?'<details class="next-step-history"><summary>Completed plans <span>'+completed.length+'</span></summary><div class="next-step-plan-list completed">'+completed.slice(0,12).map(card).join('')+'</div></details>':'')+'</div>';
      host.onclick=handleClick;
      host.oninput=e=>{if(e.target.matches?.('[data-beta-problem]'))helpProblem=e.target.value;};
      host.onchange=e=>{if(e.target.matches?.('[data-beta-task]')){helpTask=e.target.value;helpResult=null;} };
    }
    function renderDashboard(){
      const host=doc.getElementById('nextStepsDashboardCard');if(!host)return;
      const current=active().slice(0,3);
      host.hidden=!current.length;
      if(!current.length){host.innerHTML='';return;}
      host.innerHTML='<div class="next-step-dashboard-head"><div><span class="portal-eyebrow">Teacher guidance</span><strong>My Next Steps</strong></div><button type="button" class="portal-button" data-open-next>View all</button></div><div class="next-step-dashboard-list">'
        +current.map(p=>'<button type="button" data-open-next><span><strong>'+esc(p.title)+'</strong><small>'+requiredDone(p)+'/'+requiredCount(p)+' steps · '+esc(statusLabel[p.status]||p.status)+'</small></span><span aria-hidden="true">→</span></button>').join('')+'</div>';
      host.onclick=e=>{if(e.target.closest('[data-open-next]'))navigate('next-steps');};
    }
    async function action(planId,itemId,kind){
      try{
        const data=await api('/'+encodeURIComponent(planId)+'/items/'+encodeURIComponent(itemId),{action:kind});
        plans=plans.map(p=>p.id===data.plan.id?data.plan:p);render();renderDashboard();return data.plan;
      }catch(e){notify(e.message,true);return null;}
    }
    function notify(message,error=false){
      if(typeof globalThis.toast==='function')globalThis.toast(message,error);
      else alert(message);
    }
    async function handleClick(e){
      const trainerButton=e.target.closest('[data-swt-trainer]');
      if(trainerButton){const planEl=trainerButton.closest('[data-plan-id]'),itemEl=trainerButton.closest('[data-item-id]');const plan=plans.find(p=>p.id===planEl?.dataset.planId),item=plan?.items?.find(i=>i.id===itemEl?.dataset.itemId);if(plan&&item)await openTrainer(plan,item);return;}
      const practiceSetButton=e.target.closest('[data-practice-set]');
      if(practiceSetButton){
        const planEl=practiceSetButton.closest('[data-plan-id]'),itemEl=practiceSetButton.closest('[data-item-id]');
        const plan=plans.find(p=>p.id===planEl?.dataset.planId),item=plan?.items?.find(i=>i.id===itemEl?.dataset.itemId);
        if(plan&&item){await action(plan.id,item.id,'start');navigate(item.route||'practice-hub');}
        return;
      }
      const help=e.target.closest('[data-beta-help]');if(help){await requestHelp();return;}
      const add=e.target.closest('[data-beta-add]');if(add){await addSelfPlan(add.dataset.betaAdd);return;}
      const practice=e.target.closest('[data-next-practice]');if(practice){navigate('practice-hub');return;}
      const ready=e.target.closest('[data-plan-ready]');
      if(ready){
        try{const data=await api('/'+encodeURIComponent(ready.dataset.planReady)+'/ready',{});plans=plans.map(p=>p.id===data.plan.id?data.plan:p);render();renderDashboard();notify('Sent to your teacher for review.');}
        catch(err){notify(err.message,true);}return;
      }
      const start=e.target.closest('[data-step-start]');
      const complete=e.target.closest('[data-step-complete]');
      const button=start||complete;if(!button)return;
      const planEl=button.closest('[data-plan-id]'),itemEl=button.closest('[data-item-id]');
      const plan=plans.find(p=>p.id===planEl?.dataset.planId),item=plan?.items?.find(i=>i.id===itemEl?.dataset.itemId);
      if(!plan||!item)return;
      if(start){
        const updated=await action(plan.id,item.id,'start');if(!updated)return;
        const next=updated.items.find(i=>i.id===item.id)||item;
        if(next.url&&next.kind!=='question'){window.open(next.url,'_blank','noopener');return;}
        if(next.kind==='question'){launch?.(next,updated);return;}
      }
      if(complete)await action(plan.id,item.id,'complete');
    }
    async function dismissNotification(plan){
      try{const data=await api('/'+encodeURIComponent(plan.id)+'/notification-read',{});plans=plans.map(p=>p.id===data.plan.id?data.plan:p);}
      catch(_){}
    }
    function popup(plan){
      if(doc.getElementById('nextStepNotification'))return;
      const overlay=doc.createElement('div');overlay.id='nextStepNotification';overlay.className='next-step-modal-backdrop';
      overlay.innerHTML='<div class="next-step-modal" role="dialog" aria-modal="true" aria-labelledby="nextStepNotificationTitle"><span class="material-symbols-outlined next-step-modal-icon">assignment_turned_in</span><p class="portal-eyebrow">New learning plan</p><h2 id="nextStepNotificationTitle">'+esc(plan.title)+'</h2><p>'+(plan.reason?esc(plan.reason):'Your teacher has assigned a new focus area for you.')+'</p><div class="next-step-modal-actions"><button type="button" class="portal-button" data-dismiss-next>Later</button><button type="button" class="portal-button primary" data-view-next>View My Next Steps</button></div></div>';
      doc.body.appendChild(overlay);
      const close=async(view)=>{await dismissNotification(plan);overlay.remove();renderDashboard();if(view)navigate('next-steps');};
      overlay.onclick=e=>{if(e.target.closest('[data-view-next]'))close(true);else if(e.target.closest('[data-dismiss-next]')||e.target===overlay)close(false);};
    }
    async function refresh({showPopup=true}={}){
      try{await load(true);renderDashboard();if(doc.body.dataset.section==='next-steps')render();const unread=active().find(p=>p.notificationUnread);if(showPopup&&unread)popup(unread);return plans;}
      catch(e){renderDashboard();return [];}
    }
    async function open(){await load(true);render();renderDashboard();}
    const completionListener=()=>{if(!auth().uid)return;refresh({showPopup:false});globalThis.setTimeout?.(()=>refresh({showPopup:false}),1200);};
    globalThis.addEventListener?.('pte:attempt-completed',completionListener);
    function reset(){plans=[];owner='';loading=null;helpResult=null;helpProblem='';trainer=null;doc.getElementById('swtHighlightTrainer')?.remove();const host=doc.getElementById('nextStepsPane');if(host)host.replaceChildren();const dash=doc.getElementById('nextStepsDashboardCard');if(dash){dash.hidden=true;dash.replaceChildren();}doc.getElementById('nextStepNotification')?.remove();}
    return {open,refresh,reset,plans:()=>plans.slice()};
  }
  return {create};
});
