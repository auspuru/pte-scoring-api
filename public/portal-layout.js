/* Layout only. Assessment, saved attempts and native report renderers stay in their controllers. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.PortalLayout=api;api.install(root);}})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const reports='.ipt-mock-report,.ipr-score-report,.speaking-result-card,.speaking-recording-card,.reading-results-view,.results,.swt-results,.practice-result-card,.practice-results,.reading-explanation,[data-review-session]';
 function mark(node,name,value){if(node&&node.classList.contains(name)!==!!value)node.classList.toggle(name,!!value);}
 function install(env){
  const doc=env.document,shell=doc?.getElementById('appShell');if(!shell||doc.__portalLayout)return doc?.__portalLayout;
  const header=doc.createElement('header');header.className='portal-layout-header';header.setAttribute('aria-label','IPT Brisbane workspace');
  header.innerHTML='<div class="portal-layout-header-inner"><div class="portal-layout-brand-slot"></div><nav class="portal-layout-primary" aria-label="Main destinations"></nav><div class="portal-layout-account"></div></div>';
  shell.insertBefore(header,shell.firstChild);
  const home=doc.getElementById('nav-dashboard');if(home){home.classList.add('portal-layout-brand');home.setAttribute('aria-label','Home');home.innerHTML='<img src="/assets/ipt-brisbane-logo.png" alt="" width="45" height="40"><span>IPT Brisbane<small>PTE practice</small></span>';header.querySelector('.portal-layout-brand-slot').appendChild(home);}
  const nav=header.querySelector('.portal-layout-primary');for(const id of ['nav-practice-hub','nav-mock-tests','nav-progress']){const node=doc.getElementById(id);if(node)nav.appendChild(node);}
  const results=doc.createElement('button');results.type='button';results.id='nav-saved-results';results.className='nav-item';results.textContent='Results';results.onclick=()=>env.switchSection?.('saved-results');nav.appendChild(results);
  const account=header.querySelector('.portal-layout-account');for(const id of ['portalMenuToggle','userBadge']){const node=doc.getElementById(id);if(node)account.appendChild(node);}
  const menu=doc.getElementById('portalMenuToggle');if(menu)menu.innerHTML='<span aria-hidden="true">☰</span> More';
  const theme=doc.getElementById('themeToggleBtn'),footer=doc.querySelector('#portalSidebar .sidebar-footer');if(theme&&footer)footer.insertBefore(theme,footer.firstChild);
  doc.body.classList.add('portal-layout');
  let skill='speaking',scheduled=false,lastResultsOwner=null,lastSection=null;
  const swtScreen=doc.getElementById('swtPracticeScreen'),swtHeading=swtScreen?.querySelector('.swt-heading');
  let swtFocusButton;
  function expandSwt(expanded){mark(doc.body,'portal-swt-expanded',expanded);if(swtFocusButton){const label=expanded?'Exit focus view':'Focus view';if(swtFocusButton.textContent!==label)swtFocusButton.textContent=label;if(swtFocusButton.getAttribute('aria-pressed')!==String(expanded))swtFocusButton.setAttribute('aria-pressed',String(expanded));}}
  if(swtHeading){
   swtFocusButton=doc.createElement('button');swtFocusButton.type='button';swtFocusButton.id='swtFocusButton';swtFocusButton.className='btn portal-swt-focus';swtFocusButton.textContent='Focus view';swtFocusButton.setAttribute('aria-pressed','false');
   swtFocusButton.onclick=()=>expandSwt(!doc.body.classList.contains('portal-swt-expanded'));swtHeading.appendChild(swtFocusButton);
   doc.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented&&doc.body.classList.contains('portal-swt-expanded')){event.preventDefault();expandSwt(false);swtFocusButton.focus({preventScroll:true});}});
  }
  function catalogue(){
   const host=doc.getElementById('practiceHubPane'),board=host?.querySelector('.practice-banners');if(!board)return;
   mark(host,'portal-layout-catalogue',true);
   const groups=[...board.querySelectorAll('.practice-banner')];if(!groups.length)return;
   let tabs=host.querySelector('.portal-layout-skills');
   if(!tabs){tabs=doc.createElement('nav');tabs.className='portal-layout-skills';tabs.setAttribute('aria-label','Practice skills');board.before(tabs);
    for(const group of groups){const name=group.querySelector('h3')?.textContent||'',id=['speaking','writing','reading','listening'].find(key=>group.classList.contains(key));if(!id)continue;const b=doc.createElement('button');b.type='button';b.textContent=name;b.dataset.layoutSkill=id;b.onclick=()=>{skill=id;selectSkill();};tabs.appendChild(b);}
   }
   function selectSkill(){const buttons=[...tabs.querySelectorAll('button')];if(!buttons.some(b=>b.dataset.layoutSkill===skill))skill=buttons[0]?.dataset.layoutSkill;
    for(const b of buttons){const active=b.dataset.layoutSkill===skill;b.setAttribute('aria-pressed',String(active));mark(b,'active',active);}
    for(const group of groups){const active=group.classList.contains(skill);if(group.open!==active)group.open=active;group.hidden=!active;}
   }
   selectSkill();
  }
  function wrapFilters(host){
   const filters=host.querySelector('.speaking-library-filters');if(!filters||filters.querySelector('.portal-layout-filters'))return;
   const extra=[...filters.children].slice(1);if(!extra.length)return;
   const details=doc.createElement('details');details.className='portal-layout-filters';const summary=doc.createElement('summary');summary.textContent='Filters';details.appendChild(summary);const content=doc.createElement('div');content.className='portal-layout-filter-content';for(const node of extra)content.appendChild(node);details.appendChild(content);filters.appendChild(details);
  }
  function openResults(){const host=doc.getElementById('savedResultsPane');if(!host)return;
   const speaking=typeof env.canUseSpeaking==='function'&&env.canUseSpeaking();const sections=[['Individual practice','progress'],...(speaking?[['Speaking mocks','speaking-history']]:[]),['Writing mocks','writing-history'],['Reading mocks','reading'],['Listening mocks','listening-history']];
   host.innerHTML='<div class="portal-layout-results-heading"><h2>Your saved results</h2><p>Open individual practice history or choose a mock section to review its original reports.</p></div><div class="portal-layout-result-list">'+sections.map(([title,route])=>'<article><div><h3>'+title+'</h3><p>Saved attempts, answers and feedback</p></div><button type="button" class="portal-button" data-saved-route="'+route+'">View results <span aria-hidden="true">→</span></button></article>').join('')+'</div>';
   host.onclick=event=>{const b=event.target.closest?.('[data-saved-route]');if(b&&!b.disabled)env.switchSection?.(b.dataset.savedRoute,{readingRequest:{history:true}});};
  }
  function refresh(){scheduled=false;
   if(footer&&doc.querySelector('.personal-ai-launcher')&&!footer.querySelector('[data-layout-assistant]')){const b=doc.createElement('button');b.type='button';b.dataset.layoutAssistant='';b.textContent='Study assistant';b.onclick=()=>{doc.querySelector('.personal-ai-launcher')?.click();doc.getElementById('portalMenuBackdrop')?.click();};footer.insertBefore(b,footer.firstChild);}
   const section=doc.body.dataset.section,exam=doc.body.classList.contains('portal-exam-active');
   const swtWriting=section==='swt'&&!exam&&swtScreen?.classList.contains('active')&&!doc.getElementById('swtResultsScreen')?.classList.contains('active');
   mark(doc.body,'portal-swt-workspace',swtWriting);
   if(!swtWriting)expandSwt(false);
   for(const id of ['speakingPane','readingPane','writingLabScreen','swtPane','practiceScreen','speakingMockPane','fullMockPane']){
    const host=doc.getElementById(id);if(!host)continue;
    const report=[...host.querySelectorAll(reports)].some(node=>{const swt=node.closest('#swtResultsScreen');return !node.closest('[hidden]')&&(!swt||swt.classList.contains('active'));})||!!host.querySelector('#swtResultsScreen.active');mark(host,'portal-layout-report',report);
    const library=!report&&!!host.querySelector('.speaking-question-list,.reading-library-list,.studio-library');
    mark(host,'portal-layout-library',library&&!exam);if(library){wrapFilters(host);const disclosure=host.querySelector('.speaking-exam-disclosure');if(disclosure&&!disclosure.closest('.portal-layout-help')){const details=doc.createElement('details');details.className='portal-layout-help';const summary=doc.createElement('summary');summary.textContent='Timing & saving';details.appendChild(summary);disclosure.before(details);details.appendChild(disclosure);}}
    // Apply question styling only to known individual-practice surfaces, never protected mocks or review output.
    const question=!report&&!exam&&!!host.querySelector('.speaking-exam-panel,.reading-individual-layout,.listening-studio.studio-focused .exam,#swtPracticeScreen.active,#practiceEssayInput');
    mark(host,'portal-layout-question',question);
    if(question){const intro=host.querySelector('.speaking-intro');if(intro&&!intro.closest('.portal-layout-help')){const help=doc.createElement('details');help.className='portal-layout-help';const summary=doc.createElement('summary');summary.textContent='Instructions';help.appendChild(summary);intro.before(help);help.appendChild(intro);}
     const aside=host.querySelector('.studio-side');if(aside&&!aside.closest('.portal-layout-questions-list')){const disclosure=doc.createElement('details');disclosure.className='portal-layout-questions-list';const summary=doc.createElement('summary');summary.textContent='Question list';disclosure.appendChild(summary);aside.before(disclosure);disclosure.appendChild(aside);}
    }
   }
   catalogue();
   const owner=typeof env.currentUserId==='string'?env.currentUserId:doc.getElementById('userName')?.textContent;
   if(section==='saved-results'&&(section!==lastSection||owner!==lastResultsOwner)){openResults();lastResultsOwner=owner;}
   lastSection=section;
  }
  function schedule(){if(scheduled)return;scheduled=true;(env.requestAnimationFrame||env.setTimeout)(refresh);}
  if(env.MutationObserver){const observer=new env.MutationObserver(schedule);observer.observe(doc.body,{attributes:true,attributeFilter:['data-section','class']});observer.observe(doc.getElementById('portalContent')||shell,{childList:true,subtree:true});for(const id of ['swtPracticeScreen','swtResultsScreen']){const node=doc.getElementById(id);if(node)observer.observe(node,{attributes:true,attributeFilter:['class']});}}
  doc.addEventListener('DOMContentLoaded',schedule,{once:true});
  doc.addEventListener('click',event=>{if(event.target.closest?.('#portalMenuToggle')&&doc.body.classList.contains('portal-menu-open'))doc.querySelector('#portalSidebar .nav-item')?.focus();});
  const api={refresh,openResults};doc.__portalLayout=api;refresh();return api;
 }
 return{install,reportSelector:reports};
});
