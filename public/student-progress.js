(function(root){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=v=>{const n=typeof v==='number'?v:Date.parse(v);return Number.isFinite(n)?n:0;};
const date=v=>stamp(v)?new Date(stamp(v)).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'}):'Date unavailable';
const avg=rows=>rows.length?rows.reduce((n,x)=>n+x,0)/rows.length:null;
function readingRows(state){
 const all=[...(state?.history||[]),state?.session,...(state?.drafts||[])].filter(Boolean);
 return [...new Map(all.map(a=>[a.id,a])).values()];
}
function ratio(total,maximum){return Number.isFinite(total)&&Number.isFinite(maximum)&&maximum>0?Math.max(0,Math.min(1,total/maximum)):null;}
function trend(values){
 if(values.length<2)return null;
 const delta=(values.at(-1)-values[0])*100;
 if(Math.abs(delta)<2)return {label:'Stable',delta:0};
 return {label:delta>0?'Improving':'Needs attention',delta:Math.round(delta)};
}
function model(data,writing){
 const reading=readingRows(data.reading),swt=Object.values(data.swt||{}).flat().filter(Boolean),essays=data.essays||[];
 const mocks=[
  ...reading.filter(a=>!a.practiceUid).map(a=>({id:a.id,engine:'reading',title:a.name||'Reading mock',at:a.startedAt,done:!!a.done,pending:!!a.pending,
    score:a.done&&!a.pending&&Number.isFinite(a.percent)?Math.round(a.percent):null,unit:'%',detail:'Accuracy',estimate90:null,nativeTotal:null,nativeMaximum:null})),
  ...writing.filter(a=>a.kind==='mock').map(a=>({id:a.id,engine:'writing',title:a.title,at:a.startedAt,done:a.status==='submitted',pending:a.status==='submitted'&&a.total==null,
    score:Number.isFinite(a.total)?a.total:null,unit:Number.isFinite(a.maximum)?'/'+a.maximum:'',detail:'Native practice marks',estimate90:Number.isFinite(a.score90)?a.score90:null,
    nativeTotal:a.total,nativeMaximum:a.maximum}))
 ].sort((a,b)=>stamp(b.at)-stamp(a.at));

 const practiceReading=reading.filter(a=>a.practiceUid&&a.done);
 const readingScores=practiceReading.map(a=>ratio(Number(a.earned??a.total),Number(a.maximum))).filter(Number.isFinite);
 const essayScores=essays.map(a=>ratio(Number(a?.scores?.total),26)).filter(Number.isFinite);
 const sstRows=writing.filter(a=>a.kind==='sst'&&a.status==='submitted'),wfdRows=writing.filter(a=>a.kind==='wfd'&&a.status==='submitted');
 const sstScores=sstRows.map(a=>ratio(Number(a.total),Number(a.maximum))).filter(Number.isFinite);
 const wfdScores=wfdRows.map(a=>ratio(Number(a.total),Number(a.maximum))).filter(Number.isFinite);

 const areas=[
  {name:'Write Essay',route:'practice',scores:essayScores,latest:essays.map(a=>a.date)},
  {name:'Reading practice',route:'practice-hub',scores:readingScores,latest:practiceReading.map(a=>a.finishedAt)},
  {name:'Summarise Spoken Text',route:'spoken-text',scores:sstScores,latest:sstRows.map(a=>a.startedAt)},
  {name:'Write From Dictation',route:'dictation',scores:wfdScores,latest:wfdRows.map(a=>a.startedAt)}
 ].map(a=>({...a,count:a.scores.length,average:avg(a.scores),trend:trend(a.scores.slice(-5))}));
 const weakest=areas.filter(a=>a.count>=2&&Number.isFinite(a.average)).sort((a,b)=>a.average-b.average)[0]||null;

 const groups=[
  {name:'Summarise Written Text',count:swt.length,route:'swt',dates:swt.map(a=>a.timestamp)},
  {name:'Write Essay',count:essays.length,route:'practice',dates:essays.map(a=>a.date)},
  {name:'Reading & listening questions',count:practiceReading.length,route:'practice-hub',dates:practiceReading.map(a=>a.finishedAt)},
  {name:'Summarise Spoken Text',count:sstRows.length,route:'spoken-text',dates:sstRows.map(a=>a.startedAt)},
  {name:'Write From Dictation',count:wfdRows.length,route:'dictation',dates:wfdRows.map(a=>a.startedAt)}
 ];
 const days=new Set([...groups.flatMap(g=>g.dates),...mocks.filter(a=>a.done).map(a=>a.at)].map(stamp).filter(Boolean).map(n=>new Date(n).toLocaleDateString('en-CA')));
 const recent=[
  ...essays.map(a=>({title:a.questionTitle||'Write Essay',route:'practice',at:a.date,result:Number.isFinite(a?.scores?.total)?a.scores.total+'/26':null})),
  ...practiceReading.map(a=>({title:a.name||'Reading practice',route:'practice-hub',at:a.finishedAt,result:Number.isFinite(a.percent)?Math.round(a.percent)+'%':null})),
  ...sstRows.map(a=>({title:a.title||'Summarise Spoken Text',route:'spoken-text',at:a.startedAt,result:Number.isFinite(a.total)?a.total+'/'+a.maximum:null})),
  ...wfdRows.map(a=>({title:a.title||'Write From Dictation',route:'dictation',at:a.startedAt,result:Number.isFinite(a.total)?a.total+'/'+a.maximum:null})),
  ...swt.map(a=>({title:'Summarise Written Text',route:'swt',at:a.timestamp,result:Number.isFinite(a.overall_score)?a.overall_score+'/90 estimate':null}))
 ].sort((a,b)=>stamp(b.at)-stamp(a.at)).slice(0,6);
 return {mocks,groups,areas,weakest,recent,practice:groups.reduce((n,g)=>n+g.count,0),complete:mocks.filter(a=>a.done).length,active:mocks.filter(a=>!a.done).length,days:days.size};
}
function create({document:doc,identity,loadLocal,navigate,review,fetch:get=fetch}){
 let serial=0,current=null,filter='all';
 const host=()=>doc.getElementById('progressPane');
 function paint(local,writing,error){
  const m=model(local,writing);current=m;
  const list=m.mocks.filter(a=>filter==='all'||a.engine===filter);
  const focus=m.weakest
   ? '<section class="progress-focus"><div><span class="progress-caption">Suggested focus</span><h3>'+esc(m.weakest.name)+'</h3><p>Based on '+m.weakest.count+' saved native-result attempts. Average comparison: '+Math.round(m.weakest.average*100)+'% of available task marks.</p></div><button class="portal-button primary" data-progress-route="'+m.weakest.route+'">Practise this</button></section>'
   : '<section class="progress-focus"><div><span class="progress-caption">Suggested focus</span><h3>Build a reliable baseline</h3><p>Complete at least two scored attempts in a task type before a weakest area is suggested.</p></div><button class="portal-button primary" data-progress-route="practice-hub">Start practice</button></section>';
  host().innerHTML='<div class="progress-heading"><div><h2>My Progress</h2><p>Your saved activity, recent trend and next useful action.</p></div><button class="portal-button" data-progress-refresh>Refresh</button></div>'+
  (error?'<p class="progress-notice" role="alert">'+esc(error)+' <button class="portal-button" data-progress-refresh>Retry</button></p>':'')+
  '<div class="progress-stats">'+[['Practice attempts',m.practice],['Completed mocks',m.complete],['Mocks in progress',m.active],['Study days',m.days]].map(([label,n])=>'<div><strong>'+n+'</strong><span>'+label+'</span></div>').join('')+'</div>'+
  '<p class="progress-caption">Based on saved activity'+(error?' currently available':'')+'. Cross-task percentages below are comparison aids only; native task marks remain the primary result.</p>'+focus+
  '<section class="progress-section"><h3>Task trends</h3><div class="progress-activity">'+m.areas.map(a=>'<div><div><h4>'+esc(a.name)+'</h4><span class="progress-caption">'+(a.count?a.count+' scored attempt'+(a.count===1?'':'s')+' · '+(a.trend?(a.trend.label+(a.trend.delta? ' '+(a.trend.delta>0?'+':'')+a.trend.delta+' pp':'')):'Need another result for a trend'):'No comparable native results yet')+'</span></div><button class="portal-button" data-progress-route="'+a.route+'">'+(a.count?'Practise again':'Start practice')+'</button></div>').join('')+'</div></section>'+
  '<section class="progress-section"><div class="progress-heading"><div><h3>Mock-test results</h3><p>Native marks are shown first; /90 values are secondary practice estimates.</p></div><label>Module<select id="progressFilter"><option value="all">All modules</option><option value="reading">Reading</option><option value="writing">Writing</option></select></label></div>'+
  (list.length?'<div class="progress-results">'+list.map(a=>'<article class="progress-result"><div><span class="progress-caption">'+esc(a.engine==='reading'?'Reading':'Writing')+' · '+date(a.at)+'</span><h4>'+esc(a.title)+'</h4><span class="progress-caption">'+(!a.done?'In progress':a.pending?'Assessment pending':'Completed')+'</span></div><div class="progress-result-score"><strong>'+(!a.done||a.pending||!Number.isFinite(a.score)?'—':Math.round(a.score)+'<small>'+a.unit+'</small>')+'</strong><span class="progress-caption">'+esc(a.detail)+(Number.isFinite(a.estimate90)?' · '+a.estimate90+'/90 estimate':'')+'</span></div><button class="portal-button" data-progress-review="'+m.mocks.indexOf(a)+'">'+(a.done?'Review result':'Continue')+'</button></article>').join('')+'</div>':'<div class="progress-empty"><p>No '+(filter==='all'?'':filter+' ')+'mock tests saved yet.</p><button class="portal-button primary" data-progress-route="mock-tests">Browse mock tests</button></div>')+'</section>'+
  '<section class="progress-section"><h3>Recent activity</h3>'+(m.recent.length?'<div class="progress-activity">'+m.recent.map(a=>'<div><div><h4>'+esc(a.title)+'</h4><span class="progress-caption">'+date(a.at)+(a.result?' · '+esc(a.result):'')+'</span></div><button class="portal-button" data-progress-route="'+a.route+'">Open</button></div>').join('')+'</div>':'<div class="progress-empty"><p>Your recent practice will appear here.</p></div>')+'</section>'+
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
