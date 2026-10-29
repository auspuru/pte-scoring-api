(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else {root.MockReportUI=api;api.install(root);}
})(typeof globalThis==='undefined'?this:globalThis,function(){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const names={score:'Score report',answers:'Answers',analysis:'Analysis',feedback:'Feedback'};
  const colors={listening:'#326c9f',reading:'#3f9279',speaking:'#8270bb',writing:'#d49a46'};
  const number=value=>typeof value==='number'&&Number.isFinite(value)?String(Math.round(value*10)/10):value==null?'Pending':String(value);
  const date=value=>value?new Date(value).toLocaleDateString(undefined,{day:'numeric',month:'long',year:'numeric'}):'';
  function identity(){try{return typeof currentUserId==='undefined'?'Your report':String(currentUserId||'Your report');}catch{return 'Your report';}}
  function logo(){return '<img class="ipr-logo" src="/assets/ipt-brisbane-logo.png" alt="IPT Brisbane" width="112" height="68">';}
  function hero({title='',user='',at,duration='',count,overall,unit='/90',scoreLabel='Overall score',skills=[],status='Completed'}={}){
    return '<article class="ipr-score-report"><div class="ipr-brand-row">'+logo()+'<span class="ipr-status">'+esc(status)+'</span></div><div class="ipr-score-heading"><div><p class="ipr-eyebrow">'+esc(title)+'</p><h2>'+esc(user||identity())+'</h2><dl class="ipr-meta">'+[[date(at),'Test date'],[duration,'Duration'],[count==null?'':count+' question'+(count===1?'':'s'),'Test']].filter(([value])=>value).map(([value,label])=>'<div><dt>'+label+'</dt><dd>'+esc(value)+'</dd></div>').join('')+'</dl></div><div class="ipr-overall'+(number(overall).length>3?' ipr-overall-long':'')+'"><span>'+esc(scoreLabel)+'</span><strong>'+esc(number(overall))+'</strong><small>'+esc(unit)+'</small></div></div>'
      +(skills.length?'<div class="ipr-skills"><h3>Communicative skills</h3><div class="ipr-skill-grid">'+skills.map(skill=>{const value=number(skill.value),numeric=Number(value),fill=Number.isFinite(numeric)?Math.max(0,Math.min(100,numeric/(skill.maximum||90)*100)):0;return '<div class="ipr-skill"><div class="ipr-ring" style="--ipr-color:'+esc(colors[skill.name.toLowerCase()]||'#326c9f')+';--ipr-fill:'+fill+'%" role="img" aria-label="'+esc(skill.name+' '+value+(skill.unit||unit))+'"><strong>'+esc(value)+'</strong></div><p>'+esc(skill.name)+'</p></div>';}).join('')+'</div></div>':'')+'<footer>IPT Brisbane · Practice results</footer></article>';
  }
  function traits(rows=[]){return '<div class="ipr-traits">'+rows.map(row=>'<span class="ipr-trait'+(row.value==null?' ipr-trait-pending':'')+'"><span>'+esc(row.label)+'</span><strong>'+esc(number(row.value))+'</strong>'+(row.maximum==null?'':'<small>/'+esc(row.maximum)+'</small>')+'</span>').join('')+'</div>';}
  function frame({key,title,meta='',actions='',score='',answers='',analysis='',feedback='',status=''}={}){
    return '<section class="ipt-mock-report" data-mock-key="'+esc(key)+'"><header class="ipr-heading"><div><p class="ipr-eyebrow">IPT Brisbane · Mock report</p><h1>'+esc(title)+'</h1>'+(meta?'<p class="ipr-subtitle">'+esc(meta)+'</p>':'')+'</div><div class="ipr-actions">'+actions+'</div></header><nav class="ipr-tabs" role="tablist" aria-label="Mock report sections">'+Object.entries(names).map(([value,label])=>'<button type="button" role="tab" id="'+esc(key)+'-tab-'+value+'" data-mock-tab="'+value+'" aria-controls="'+esc(key)+'-'+value+'" aria-selected="'+(value==='score')+'" tabindex="'+(value==='score'?0:-1)+'">'+label+'</button>').join('')+'</nav>'+(status?'<div class="ipr-report-status" role="status">'+status+'</div>':'')+Object.entries({score,answers,analysis,feedback}).map(([value,content])=>'<section class="ipr-panel" id="'+esc(key)+'-'+value+'" role="tabpanel" aria-labelledby="'+esc(key)+'-tab-'+value+'" data-mock-panel="'+value+'"'+(value==='score'?'':' hidden')+'>'+(content||'<p class="ipr-empty">'+(value==='feedback'?'Open an answer to review its saved feedback.':'No '+names[value].toLowerCase()+' is available yet.')+'</p>')+'</section>').join('')+'</section>';
  }
  function historyCard({title,at,status='Completed',score,unit='/90',detail='',actions=''}={}){return '<article class="ipr-history-card"><div class="ipr-history-top"><span class="ipr-status">'+esc(status)+'</span><small>'+esc(date(at))+'</small></div><h3>'+esc(title)+'</h3>'+(score==null?'':'<p class="ipr-history-score">'+esc(number(score))+' <small>'+esc(unit)+'</small></p>')+(detail?'<p class="ipr-history-detail">'+esc(detail)+'</p>':'')+'<div class="ipr-history-actions">'+actions+'</div></article>';}
  function sectionFor(type,section){return ['ra','rs','di','rl','asq','sgd','rts'].includes(type)?'speaking':['swt','essay'].includes(type)?'writing':section==='reading'?'reading':'listening';}
  function sectionTabs(current='speaking',attribute='data-report-section'){return '<div class="ipr-section-tabs" role="group" aria-label="Answer sections">'+['speaking','writing','reading','listening'].map(name=>'<button type="button" '+attribute+'="'+name+'" aria-pressed="'+(name===current)+'">'+name[0].toUpperCase()+name.slice(1)+'</button>').join('')+'</div>';}
  const states=new Map(),filters=new Map();
  const attribute=(node,name,value)=>{value=String(value);if(node.getAttribute(name)!==value)node.setAttribute(name,value);};
  function activate(frame,tab,remember=true){
    if(!names[tab])tab='score';if(remember)states.set(frame.dataset.mockKey,tab);
    attribute(frame,'data-mock-active',tab);
    frame.querySelectorAll('[data-mock-tab]').forEach(button=>{const active=button.dataset.mockTab===tab;attribute(button,'aria-selected',active);attribute(button,'tabindex',active?0:-1);});
    frame.querySelectorAll('[data-mock-panel]').forEach(panel=>{const hidden=panel.dataset.mockPanel!==tab;if(panel.hidden!==hidden)panel.hidden=hidden;});
    const filter=filters.get(frame.dataset.mockKey)||'all';
    frame.querySelectorAll('[data-mock-filter]').forEach(button=>attribute(button,'aria-pressed',button.dataset.mockFilter===filter));
    frame.querySelectorAll('[data-mock-question-type]').forEach(card=>{const hidden=filter!=='all'&&card.dataset.mockQuestionType!==filter;if(card.hidden!==hidden)card.hidden=hidden;});
    frame.querySelectorAll('audio').forEach(audio=>{if(audio.closest('[data-mock-panel]')?.hidden)audio.pause?.();});
  }
  function enhanceReading(root){
    const overview=root.querySelector('[data-review-overview]');if(!overview?.querySelector('[data-reading-hero]'))return;
    let report=root.querySelector('.ipt-mock-report');
    if(!report){
      const holder=root.ownerDocument.createElement('div'),title=root.querySelector('.reading-session-toolbar strong')?.textContent||'Reading mock';
      holder.innerHTML=frame({key:'reading-'+root.dataset.reviewSession,title});report=holder.firstElementChild;
      const actions=report.querySelector('.ipr-actions'),toolbar=root.querySelector('.reading-session-toolbar');
      if(toolbar){const back=toolbar.querySelector('[data-action="home"]');if(back)actions.append(back);toolbar.hidden=true;}
      root.prepend(report);report.querySelector('[data-mock-panel="score"]').replaceChildren(overview);
      const answers=report.querySelector('[data-mock-panel="answers"]');answers.replaceChildren();
      for(const selector of ['.reading-review-intro','.reading-review-tools','[data-review-empty]','.reading-complete-review']){const node=root.querySelector(selector);if(node)answers.append(node);}
    }
    for(const [selector,tab] of [['[data-reading-analysis]','analysis'],['[data-reading-feedback]','feedback']]){const node=overview.querySelector(selector);if(node)report.querySelector('[data-mock-panel="'+tab+'"]').replaceChildren(node);}
    activate(report,states.get(report.dataset.mockKey)||'score',false);
  }
  function install(env){
    const doc=env.document;if(!doc||doc.__iptMockLayoutInstalled)return;doc.__iptMockLayoutInstalled=true;
    const update=()=>{doc.querySelectorAll('[data-reading-recent-results] .reading-history').forEach(list=>{if(!list.classList.contains('ipr-history-grid'))list.classList.add('ipr-history-grid');list.querySelectorAll('li').forEach(card=>{if(!card.classList.contains('ipr-history-card'))card.classList.add('ipr-history-card');});});doc.querySelectorAll('.reading-results-view').forEach(enhanceReading);doc.querySelectorAll('.ipt-mock-report[data-mock-key]').forEach(report=>activate(report,states.get(report.dataset.mockKey)||'score',false));};
    doc.addEventListener('click',event=>{
      const open=event.target.closest?.('[data-mock-open]');if(open)states.set(open.dataset.mockTarget,open.dataset.mockOpen);
      const jump=event.target.closest?.('[data-mock-jump]');if(jump){const report=jump.closest('.ipt-mock-report');if(report){filters.set(report.dataset.mockKey,'all');activate(report,'answers');const target=[...report.querySelectorAll('[id]')].find(node=>node.id===jump.dataset.mockJump);target?.scrollIntoView?.({behavior:'smooth',block:'start'});target?.focus?.({preventScroll:true});}return;}
      const taskFilter=event.target.closest?.('[data-mock-filter]');if(taskFilter){const report=taskFilter.closest('.ipt-mock-report');if(report){filters.set(report.dataset.mockKey,taskFilter.dataset.mockFilter);activate(report,'answers');}return;}
      const tab=event.target.closest?.('[data-mock-tab]');if(tab){const report=tab.closest('.ipt-mock-report');if(report)activate(report,tab.dataset.mockTab);return;}
      const review=event.target.closest?.('[data-review-type],[data-review-filter],[data-fm="review-type"]');if(review){const report=review.closest('.ipt-mock-report');if(report)activate(report,'answers');}
      const filter=event.target.closest?.('[data-report-section]');if(filter){const report=filter.closest('.ipt-mock-report'),select=report?.querySelector('#fm-review-select');if(!select)return;const option=[...select.options].find(row=>row.dataset.reportSection===filter.dataset.reportSection);if(option){select.value=option.value;select.dispatchEvent(new env.Event('change',{bubbles:true}));}}
    });
    doc.addEventListener('keydown',event=>{const button=event.target.closest?.('[data-mock-tab]');if(!button||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const values=Object.keys(names),at=values.indexOf(button.dataset.mockTab),next=event.key==='Home'?0:event.key==='End'?values.length-1:(at+(event.key==='ArrowRight'?1:-1)+values.length)%values.length;event.preventDefault();const report=button.closest('.ipt-mock-report');activate(report,values[next]);report.querySelector('[data-mock-tab="'+values[next]+'"]').focus();});
    let queued=false;const schedule=()=>{if(queued)return;queued=true;(env.queueMicrotask||queueMicrotask)(()=>{queued=false;update();});};
    if(env.MutationObserver)new env.MutationObserver(records=>{if(records.some(record=>record.target.closest?.('.reading-results-view,.ipt-mock-report,[data-reading-recent-results]')||[...record.addedNodes].some(node=>node.nodeType===1&&(node.matches?.('.reading-results-view,.ipt-mock-report,[data-reading-recent-results]')||node.querySelector?.('.reading-results-view,.ipt-mock-report,[data-reading-recent-results]')))))schedule();}).observe(doc.documentElement,{childList:true,subtree:true});
    if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',update,{once:true});else update();
  }
  return {esc,number,date,identity,logo,hero,traits,frame,historyCard,sectionFor,sectionTabs,activate,enhanceReading,install};
});
