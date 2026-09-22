(function(root){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=v=>{const n=typeof v==='number'?v:Date.parse(v);return Number.isFinite(n)?n:0;};
const date=v=>stamp(v)?new Date(stamp(v)).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'}):'Date unavailable';
function readingRows(state){
 const all=[...(state?.history||[]),state?.session,...(state?.drafts||[])].filter(Boolean);
 return [...new Map(all.map(a=>[a.id,a])).values()];
}
function model(data,writing){
 const reading=readingRows(data.reading),swt=Object.values(data.swt||{}).flat().filter(Boolean),essays=data.essays||[];
 const mocks=[...reading.filter(a=>!a.practiceUid).map(a=>({id:a.id,engine:'reading',title:a.name||'Reading mock',at:a.startedAt,done:!!a.done,pending:!!a.pending,score:a.done&&!a.pending&&Number.isFinite(a.percent)?a.percent:null,unit:'%',detail:'Accuracy'})),
 ...writing.filter(a=>a.kind==='mock').map(a=>({id:a.id,engine:'writing',title:a.title,at:a.startedAt,done:a.status==='submitted',pending:a.status==='submitted'&&a.score90==null,score:a.score90,unit:'/90',detail:'Practice estimate'}))].sort((a,b)=>stamp(b.at)-stamp(a.at));
 const practiceReading=reading.filter(a=>a.practiceUid&&a.done);
 const groups=[
 {name:'Summarise Written Text',count:swt.length,route:'swt',dates:swt.map(a=>a.timestamp)},
 {name:'Write Essay',count:essays.length,route:'practice',dates:essays.map(a=>a.date)},
 {name:'Reading & listening questions',count:practiceReading.length,route:'practice-hub',dates:practiceReading.map(a=>a.finishedAt)},
 ...[['sst','Summarise Spoken Text','spoken-text'],['wfd','Write From Dictation','dictation']].map(([kind,name,route])=>{const rows=writing.filter(a=>a.kind===kind&&a.status==='submitted');return {name,route,count:rows.length,dates:rows.map(a=>a.startedAt)};})
 ];
 const days=new Set([...groups.flatMap(g=>g.dates),...mocks.filter(a=>a.done).map(a=>a.at)].map(stamp).filter(Boolean).map(n=>new Date(n).toLocaleDateString('en-CA')));
 return {mocks,groups,practice:groups.reduce((n,g)=>n+g.count,0),complete:mocks.filter(a=>a.done).length,active:mocks.filter(a=>!a.done).length,days:days.size};
}
function create({document:doc,identity,loadLocal,navigate,review,fetch:get=fetch}){
 let serial=0,current=null,filter='all';
 const host=()=>doc.getElementById('progressPane');
 function paint(local,writing,error){
  const m=model(local,writing);current=m;
  const list=m.mocks.filter(a=>filter==='all'||a.engine===filter);
  host().innerHTML='<div class="progress-heading"><div><h2>My Progress</h2><p>Your practice and mock-test results, in one place.</p></div><button class="portal-button" data-progress-refresh>Refresh</button></div>'+
  (error?'<p class="progress-notice" role="alert">'+esc(error)+' <button class="portal-button" data-progress-refresh>Retry</button></p>':'')+
  '<div class="progress-stats">'+[['Practice attempts',m.practice],['Completed mocks',m.complete],['Mocks in progress',m.active],['Study days',m.days]].map(([label,n])=>'<div><strong>'+n+'</strong><span>'+label+'</span></div>').join('')+'</div>'+
  '<p class="progress-caption">Based on saved activity'+(error?' currently available':'')+'.</p>'+
  '<section class="progress-section"><div class="progress-heading"><div><h3>Mock-test results</h3><p>Reopen feedback or continue a saved test.</p></div><label>Module<select id="progressFilter"><option value="all">All modules</option><option value="reading">Reading</option><option value="writing">Writing</option></select></label></div>'+
  (list.length?'<div class="progress-results">'+list.map((a,i)=>'<article class="progress-result"><div><span class="progress-caption">'+esc(a.engine==='reading'?'Reading':'Writing')+' · '+date(a.at)+'</span><h4>'+esc(a.title)+'</h4><span class="progress-caption">'+(!a.done?'In progress':a.pending?'Assessment pending':'Completed')+'</span></div><div class="progress-result-score"><strong>'+(!a.done||a.pending||!Number.isFinite(a.score)?'—':Math.round(a.score)+'<small>'+a.unit+'</small>')+'</strong><span class="progress-caption">'+esc(a.detail)+'</span></div><button class="portal-button" data-progress-review="'+m.mocks.indexOf(a)+'">'+(a.done?'Review result':'Continue')+'</button></article>').join('')+'</div>':'<div class="progress-empty"><p>No '+(filter==='all'?'':filter+' ')+'mock tests saved yet.</p><button class="portal-button primary" data-progress-route="mock-tests">Browse mock tests</button></div>')+'</section>'+
  '<section class="progress-section"><h3>Practice activity</h3><div class="progress-activity">'+m.groups.map(g=>'<div><div><h4>'+esc(g.name)+'</h4><span class="progress-caption">'+g.count+' saved attempt'+(g.count===1?'':'s')+(g.count?' · Latest '+date(Math.max(...g.dates.map(stamp))):'')+'</span></div><button class="portal-button" data-progress-route="'+g.route+'">'+(g.count?'Open practice':'Start practice')+'</button></div>').join('')+'</div></section>';
  doc.getElementById('progressFilter').value=filter;
  doc.getElementById('progressFilter').onchange=e=>{filter=e.target.value;paint(local,writing,error);};
 }
 async function open(){
  const ticket=++serial,owner=identity();if(!owner.uid||!owner.token)return;
  const same=()=>ticket===serial&&identity().uid===owner.uid&&identity().token===owner.token;
  host().innerHTML='<p role="status">Loading your progress…</p>';
  const results=await Promise.allSettled([loadLocal(),(async()=>{const r=await get('/api/writing-lab/attempts',{headers:{'x-session-token':owner.token},cache:'no-store',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Writing and listening results could not load.');return r.json();})()]);
  if(!same())return;
  const local=results[0].status==='fulfilled'?results[0].value:{};
  const writing=results[1].status==='fulfilled'?results[1].value:[];
  paint(local,writing,results.some(r=>r.status==='rejected')?'Some progress could not be refreshed. Available saved activity is shown below.':'');
 }
 host().onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-progress-refresh'))return open();if(b.dataset.progressRoute)return navigate(b.dataset.progressRoute);if(b.dataset.progressReview!==undefined){const a=current?.mocks[Number(b.dataset.progressReview)];if(a)review(a);}};
 return {open};
}
root.StudentProgress={create,model};
})(typeof window!=='undefined'?window:globalThis);
