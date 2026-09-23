(function(){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const style=document.createElement('style');style.textContent=`
  .improve-btn{border-color:rgba(0,92,139,.35)!important;color:#0b6b92!important}.improve-modal .modal-box{max-width:980px;width:min(96vw,980px);max-height:90vh;overflow:auto}.improve-layout{display:grid;grid-template-columns:1fr 1.25fr;gap:18px}.improve-section{border:1px solid var(--line);background:var(--surface);border-radius:12px;padding:14px}.improve-section h4{margin:0 0 10px}.improve-field{display:grid;gap:5px;margin:10px 0}.improve-field label{font-size:12px;font-weight:700;color:var(--ink-muted)}.improve-field input,.improve-field select,.improve-field textarea{width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink)}.improve-field textarea{min-height:70px;resize:vertical}.improve-inline{display:grid;grid-template-columns:1fr 1fr;gap:10px}.improve-items{display:grid;gap:8px}.improve-item{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:9px 10px;border:1px solid var(--line);border-radius:9px}.improve-item small{display:block;color:var(--ink-muted);margin-top:2px}.improve-question-tools{display:grid;grid-template-columns:150px 160px 1fr;gap:8px;margin:10px 0}.improve-question-list{max-height:260px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:6px}.improve-question{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px;border-bottom:1px solid var(--line)}.improve-question:last-child{border-bottom:0}.improve-question small{color:var(--ink-muted);display:block}.improve-plan{padding:10px 0;border-bottom:1px solid var(--line)}.improve-plan:last-child{border-bottom:0}.improve-plan-head{display:flex;justify-content:space-between;gap:10px}.improve-plan-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.improve-pill{font-size:11px;font-weight:700;border:1px solid var(--line);border-radius:999px;padding:4px 7px}.improve-status{min-height:20px;font-size:12px;color:var(--ink-muted)}@media(max-width:800px){.improve-layout{grid-template-columns:1fr}.improve-question-tools,.improve-inline{grid-template-columns:1fr}}
  `;document.head.appendChild(style);

  let currentStudent='',modules=[],plans=[],draftItems=[],questions=[],questionLoaded=false;
  const key=()=>sessionStorage.getItem('adminKey')||'';
  async function request(path,{method='GET',body}={}){
    const r=await fetch(path,{method,cache:'no-store',headers:{'Content-Type':'application/json','x-admin-key':key()},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
    let d={};try{d=await r.json();}catch(_){}
    if(!r.ok)throw Error(d.error||('Request failed (HTTP '+r.status+')'));return d;
  }
  async function loadModules(){
    if(modules.length)return modules;
    const r=await fetch('/improvement-modules.json?v=3',{cache:'no-store'});const d=await r.json();modules=d.modules||[];return modules;
  }
  function injectModal(){
    if(document.getElementById('improveModal'))return;
    const modal=document.createElement('div');modal.className='modal improve-modal';modal.id='improveModal';
    modal.onclick=e=>{if(e.target===modal)closeManager();};
    modal.innerHTML='<div class="modal-box"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><div><h3 style="margin:0">Student Improvement</h3><p id="improveStudent" style="margin:4px 0 0;color:var(--ink-muted)"></p></div><button class="btn-sm" data-improve-close>Close</button></div><div class="improve-layout" style="margin-top:14px"><section class="improve-section"><h4>Current plans</h4><div id="improvePlans"></div></section><section class="improve-section"><h4>Assign next step</h4><div class="improve-field"><label>Improvement module</label><select id="improveModule"></select></div><div class="improve-field"><label>Plan title</label><input id="improveTitle" placeholder="e.g. SWT content practice"></div><div class="improve-inline"><div class="improve-field"><label>Area</label><input id="improveArea" placeholder="e.g. Writing"></div><div class="improve-field"><label>Task</label><input id="improveTask" placeholder="e.g. Summarize Written Text"></div></div><div class="improve-inline"><div class="improve-field"><label>Priority</label><select id="improvePriority"><option value="high">High</option><option value="normal" selected>Normal</option><option value="low">Low</option></select></div><div class="improve-field"><label>Due date (optional)</label><input id="improveDue" type="date"></div></div><div class="improve-field"><label>Why this is assigned</label><textarea id="improveReason"></textarea></div><div class="improve-field"><label>Teacher note (optional)</label><textarea id="improveNote" placeholder="e.g. Focus on final sounds and do not rush."></textarea></div><div class="improve-field"><label>Plan items</label><div id="improveItems" class="improve-items"></div></div><div class="improve-section" style="margin:10px 0;padding:10px"><strong style="font-size:13px">Add your own step</strong><div class="improve-field"><label>Step title</label><input id="improveManualTitle" placeholder="e.g. Review your connector mistakes"></div><div class="improve-field"><label>Instruction</label><textarea id="improveManualDescription" placeholder="Write exactly what you want the student to do."></textarea></div><div class="improve-field"><label>Optional link</label><input id="improveManualUrl" type="url" placeholder="https://..."></div><button type="button" class="btn-sm" id="improveManualAdd">+ Add manual step</button></div><button class="btn-sm" id="improveQuestionsBtn">+ Add practice questions</button><div id="improveQuestionPicker" hidden><div class="improve-question-tools"><select id="improveQuestionSection"><option value="all">All sections</option></select><select id="improveQuestionType"><option value="all">All types</option></select><input id="improveQuestionSearch" placeholder="Search questions"></div><div id="improveQuestionList" class="improve-question-list"></div></div><label style="display:flex;gap:8px;align-items:center;margin:12px 0;font-size:13px"><input type="checkbox" id="improveNotify" checked> Notify student with a one-time popup</label><div class="improve-status" id="improveStatus"></div><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn-sm btn-accent" id="improveAssign">Assign to student</button></div></section></div></div>';
    document.body.appendChild(modal);
    modal.querySelector('[data-improve-close]').onclick=closeManager;
    document.getElementById('improveModule').onchange=applyModule;
    document.getElementById('improveQuestionsBtn').onclick=toggleQuestions;
    document.getElementById('improveManualAdd').onclick=addManualStep;
    document.getElementById('improveQuestionSection').onchange=renderQuestions;
    document.getElementById('improveQuestionType').onchange=renderQuestions;
    document.getElementById('improveQuestionSearch').oninput=renderQuestions;
    document.getElementById('improveAssign').onclick=assign;
    document.getElementById('improveItems').onclick=e=>{const b=e.target.closest('[data-remove-item]');if(!b)return;draftItems.splice(Number(b.dataset.removeItem),1);renderItems();};
    document.getElementById('improveQuestionList').onclick=e=>{const b=e.target.closest('[data-add-question]');if(!b)return;const q=questions.find(x=>x.key===b.dataset.addQuestion);if(!q)return;addQuestion(q);};
    document.getElementById('improvePlans').onclick=e=>{const b=e.target.closest('[data-plan-action]');if(b)updatePlan(b.dataset.planId,b.dataset.planAction);};
  }
  function closeManager(){document.getElementById('improveModal')?.classList.remove('show');currentStudent='';}
  async function openManager(username){
    injectModal();currentStudent=username;questionLoaded=false;questions=[];
    document.getElementById('improveStudent').textContent=username;
    document.getElementById('improveStatus').textContent='Loading…';
    document.getElementById('improveModal').classList.add('show');
    try{
      const [mods,data]=await Promise.all([loadModules(),request('/api/admin/interventions/'+encodeURIComponent(username))]);
      plans=data.plans||[];const select=document.getElementById('improveModule');
      select.innerHTML='<option value="">Custom plan</option>'+mods.map(m=>'<option value="'+esc(m.code)+'">'+esc(m.code+' — '+m.title)+'</option>').join('');
      renderPlans();select.value='';draftItems=[];renderItems();
      ['improveTitle','improveArea','improveTask','improveReason','improveNote','improveManualTitle','improveManualDescription','improveManualUrl'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
      document.getElementById('improveStatus').textContent='';
    }catch(e){document.getElementById('improveStatus').textContent=e.message;}
  }
  function applyModule(){
    const code=document.getElementById('improveModule').value,m=modules.find(x=>x.code===code);
    draftItems=(m?.items||[]).map(x=>({...x}));
    document.getElementById('improveTitle').value=m?.title||'';
    document.getElementById('improveArea').value=m?.area||'';
    document.getElementById('improveTask').value=m?.task||'';
    document.getElementById('improveReason').value=m?.reason||'';
    renderItems();
  }
  function addManualStep(){
    const title=document.getElementById('improveManualTitle').value.trim();
    const description=document.getElementById('improveManualDescription').value.trim();
    const url=document.getElementById('improveManualUrl').value.trim();
    if(!title && !description){document.getElementById('improveStatus').textContent='Write a title or instruction for the manual step.';return;}
    const youtube=/youtu(?:\.be|be\.com)/i.test(url);
    draftItems.push({kind:url&&youtube?'video':'practice',title:title||'Teacher instruction',description,url,required:true});
    ['improveManualTitle','improveManualDescription','improveManualUrl'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('improveStatus').textContent='';
    renderItems();
  }
  function renderItems(){
    const host=document.getElementById('improveItems');
    if(!draftItems.length){host.innerHTML='<p style="font-size:12px;color:var(--ink-muted);margin:0">No items yet. Choose a module or add individual practice questions.</p>';return;}
    host.innerHTML=draftItems.map((item,i)=>'<div class="improve-item"><div><strong>'+esc(item.title||'Step')+'</strong><small>'+esc(item.kind==='question'?(item.section+' · '+item.type):(item.description||item.kind))+'</small></div><button class="btn-action danger" data-remove-item="'+i+'">Remove</button></div>').join('');
  }
  function renderPlans(){
    const host=document.getElementById('improvePlans');
    if(!plans.length){host.innerHTML='<p style="font-size:12px;color:var(--ink-muted)">No plans assigned yet.</p>';return;}
    const order={ready_for_review:0,in_progress:1,not_started:2,mastered:3,archived:4};
    host.innerHTML=[...plans].sort((a,b)=>(order[a.status]??9)-(order[b.status]??9)).map(p=>{
      const complete=(p.items||[]).filter(i=>i.status==='completed').length,total=(p.items||[]).filter(i=>i.required!==false).length;
      const actions=p.status==='ready_for_review'
        ?'<button class="btn-action" data-plan-action="mastered" data-plan-id="'+esc(p.id)+'">Mark Mastered</button><button class="btn-action" data-plan-action="in_progress" data-plan-id="'+esc(p.id)+'">Continue</button>'
        :p.status==='mastered'?'<button class="btn-action" data-plan-action="in_progress" data-plan-id="'+esc(p.id)+'">Reopen</button>'
        :p.status==='archived'?'<button class="btn-action" data-plan-action="in_progress" data-plan-id="'+esc(p.id)+'">Reopen</button>'
        :'<button class="btn-action" data-plan-action="mastered" data-plan-id="'+esc(p.id)+'">Mark Mastered</button><button class="btn-action warn" data-plan-action="archived" data-plan-id="'+esc(p.id)+'">Archive</button>';
      return '<div class="improve-plan"><div class="improve-plan-head"><div><strong>'+esc(p.title)+'</strong><small style="display:block;color:var(--ink-muted);margin-top:3px">'+esc(p.area||'PTE')+(p.task?' · '+esc(p.task):'')+' · '+complete+'/'+total+' required steps</small></div><span class="improve-pill">'+esc((p.status||'').replaceAll('_',' '))+'</span></div>'+(p.teacherNote?'<p style="font-size:12px;color:var(--ink-muted);margin:7px 0 0">'+esc(p.teacherNote)+'</p>':'')+'<div class="improve-plan-actions">'+actions+'</div></div>';
    }).join('');
  }
  async function updatePlan(id,status){
    try{
      document.getElementById('improveStatus').textContent='Updating…';
      const d=await request('/api/admin/interventions/'+encodeURIComponent(currentStudent)+'/'+encodeURIComponent(id),{method:'POST',body:{status,notify:status==='in_progress'}});
      plans=plans.map(p=>p.id===d.plan.id?d.plan:p);renderPlans();document.getElementById('improveStatus').textContent='Updated.';
    }catch(e){document.getElementById('improveStatus').textContent=e.message;}
  }
  async function toggleQuestions(){
    const panel=document.getElementById('improveQuestionPicker');panel.hidden=!panel.hidden;
    if(panel.hidden)return;
    if(!questionLoaded){document.getElementById('improveQuestionList').innerHTML='<p style="padding:10px;color:var(--ink-muted)">Loading question bank…</p>';try{await loadQuestions();questionLoaded=true;fillQuestionFilters();renderQuestions();}catch(e){document.getElementById('improveQuestionList').innerHTML='<p style="padding:10px;color:#b91c1c">'+esc(e.message)+'</p>';}}
  }
  async function loadQuestions(){
    const imp=await request('/api/admin/impersonate/'+encodeURIComponent(currentStudent));
    const headers={'x-session-token':imp.token};
    const [speakingR,readingR,writingR,swtR,essayData]=await Promise.all([
      fetch('/api/speaking/catalog',{cache:'no-store',headers}),
      fetch('/reading-bank.json?v=8',{cache:'no-store'}),
      fetch('/api/writing-lab/catalog',{cache:'no-store',headers}),
      fetch('/api/passages',{cache:'no-store'}),
      request('/api/admin/user-data/'+encodeURIComponent(currentStudent))
    ]);
    const [speaking,reading,writing,swt]=await Promise.all([speakingR.json(),readingR.json(),writingR.json(),swtR.json()]);
    const out=[];
    (speaking.questions||[]).forEach((q,i)=>out.push({key:'sp:'+q.id,section:'Speaking',type:speaking.types?.[q.type]?.name||q.type,title:(speaking.types?.[q.type]?.name||q.type)+' — Question '+((speaking.questions||[]).filter(x=>x.type===q.type).findIndex(x=>x.id===q.id)+1),item:{kind:'question',title:(speaking.types?.[q.type]?.name||'Speaking')+' question',description:'Complete a new assigned speaking attempt.',engine:'speaking',route:'speaking-'+q.type,questionId:String(q.id),requireNewAttempt:true,required:true}}));
    const routeByType={};(window.PracticeCatalogue?.groups||[]).forEach(g=>(g.tasks||[]).forEach(t=>{if(t.type)routeByType[t.type]=t.route;}));
    (window.PracticeCatalogue?.readingLibraries?.(reading)||reading.practiceLibraries||[]).forEach(lib=>(lib.questions||[]).forEach((q,i)=>{const uid=q.uid||('pte:'+q.id);out.push({key:'rd:'+uid,section:['hcs','hiw'].includes(lib.id)?'Listening':'Reading',type:lib.name||lib.id,title:(lib.name||lib.id)+' — Question '+(i+1),item:{kind:'question',title:(lib.name||'Reading')+' — Question '+(i+1),description:'Complete a new assigned practice attempt.',engine:'reading',route:routeByType[lib.id]||('reading-'+lib.id),questionId:String(uid),requireNewAttempt:true,required:true}});}));
    (writing.spoken||[]).forEach((q,i)=>out.push({key:'sst:'+q.id,section:'Listening',type:'Summarise Spoken Text',title:'SST — Question '+(i+1)+(q.title?' · '+q.title:''),item:{kind:'question',title:'SST — Question '+(i+1),description:q.title||'Complete a new SST attempt.',engine:'writing-lab',route:'spoken-text',testId:String(q.id),requireNewAttempt:true,required:true}}));
    (writing.dictation||[]).forEach((q,i)=>out.push({key:'wfd:'+q.id,section:'Listening',type:'Write From Dictation',title:'WFD — Question '+(i+1)+(q.title?' · '+q.title:''),item:{kind:'question',title:'WFD — Question '+(i+1),description:q.title||'Complete a new dictation attempt.',engine:'writing-lab',route:'dictation',testId:String(q.id),requireNewAttempt:true,required:true}}));
    (swt.passages||[]).forEach((p,i)=>out.push({key:'swt:'+p.id,section:'Writing',type:'Summarize Written Text',title:'SWT P'+p.id+(p.title?' · '+p.title:''),item:{kind:'question',title:'SWT P'+p.id+(p.title?' — '+p.title:''),description:'Complete a new SWT attempt for this passage.',engine:'swt',route:'swt',passageId:String(p.id),requireNewAttempt:true,required:true}}));
    (essayData.progress?.essays||[]).filter(e=>e&&e.id&&e.question&&String(e.question).trim()).forEach((e,i)=>out.push({key:'essay:'+e.id,section:'Writing',type:'Write Essay',title:'Essay — '+(e.title||('Question '+(i+1))),item:{kind:'question',title:'Essay — '+(e.title||('Question '+(i+1))),description:String(e.question).trim().slice(0,240),engine:'essay',route:'practice',questionId:String(e.id),requireNewAttempt:true,required:true}}));
    questions=out;
  }
  function fillQuestionFilters(){
    const sections=[...new Set(questions.map(q=>q.section))].sort(),types=[...new Set(questions.map(q=>q.type))].sort();
    document.getElementById('improveQuestionSection').innerHTML='<option value="all">All sections</option>'+sections.map(x=>'<option>'+esc(x)+'</option>').join('');
    document.getElementById('improveQuestionType').innerHTML='<option value="all">All types</option>'+types.map(x=>'<option>'+esc(x)+'</option>').join('');
  }
  function renderQuestions(){
    const section=document.getElementById('improveQuestionSection').value,type=document.getElementById('improveQuestionType').value,q=document.getElementById('improveQuestionSearch').value.trim().toLowerCase();
    const list=questions.filter(x=>(section==='all'||x.section===section)&&(type==='all'||x.type===type)&&(!q||x.title.toLowerCase().includes(q))).slice(0,80);
    document.getElementById('improveQuestionList').innerHTML=list.length?list.map(x=>'<div class="improve-question"><div><strong>'+esc(x.title)+'</strong><small>'+esc(x.section+' · '+x.type)+'</small></div><button class="btn-action" data-add-question="'+esc(x.key)+'">Add</button></div>').join(''):'<p style="padding:10px;color:var(--ink-muted)">No questions match.</p>';
  }
  function addQuestion(q){
    const key=[q.item.engine,q.item.questionId||q.item.testId||q.item.passageId].join(':');
    if(draftItems.some(i=>[i.engine,i.questionId||i.testId||i.passageId].join(':')===key))return;
    draftItems.push({...q.item});renderItems();
  }
  async function assign(){
    const code=document.getElementById('improveModule').value,m=modules.find(x=>x.code===code);
    if(!draftItems.length){document.getElementById('improveStatus').textContent='Add at least one plan item or practice question.';return;}
    const body={moduleCode:code,area:document.getElementById('improveArea').value.trim()||m?.area||'PTE',task:document.getElementById('improveTask').value.trim()||m?.task||'',weakness:m?.weakness||'',title:document.getElementById('improveTitle').value.trim()||m?.title||'Teacher Practice Plan',reason:document.getElementById('improveReason').value.trim(),teacherNote:document.getElementById('improveNote').value.trim(),priority:document.getElementById('improvePriority').value,dueAt:document.getElementById('improveDue').value||null,notify:document.getElementById('improveNotify').checked,items:draftItems};
    try{
      const btn=document.getElementById('improveAssign');btn.disabled=true;document.getElementById('improveStatus').textContent='Assigning…';
      const d=await request('/api/admin/interventions/'+encodeURIComponent(currentStudent),{method:'POST',body});
      plans.unshift(d.plan);renderPlans();draftItems=[];renderItems();document.getElementById('improveModule').value='';
      ['improveTitle','improveArea','improveTask','improveReason','improveNote','improveDue','improveManualTitle','improveManualDescription','improveManualUrl'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
      document.getElementById('improveStatus').textContent='Assigned. The student will see it in My Next Steps.';
    }catch(e){document.getElementById('improveStatus').textContent=e.message;}finally{document.getElementById('improveAssign').disabled=false;}
  }
  function addButtons(){
    document.querySelectorAll('#usersBody tr').forEach(row=>{
      if(row.dataset.hasAccount==='false'||row.querySelector('.improve-btn'))return;
      const username=row.querySelector('.username-cell')?.textContent?.trim();const actions=row.querySelector('.actions');if(!username||!actions)return;
      const b=document.createElement('button');b.className='btn-action improve-btn';b.type='button';b.textContent='Improvement';b.onclick=()=>openManager(username);actions.insertBefore(b,actions.firstChild);
    });
  }
  const observer=new MutationObserver(addButtons);
  document.addEventListener('DOMContentLoaded',()=>{injectModal();const body=document.getElementById('usersBody');if(body){observer.observe(body,{childList:true,subtree:true});addButtons();}});
})();