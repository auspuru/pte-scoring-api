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
const numeric=value=>value===null||value===undefined||value===''?null:(Number.isFinite(Number(value))?Number(value):null);
function ratio(total,maximum){
 const t=numeric(total),m=numeric(maximum);
 return Number.isFinite(t)&&Number.isFinite(m)&&m>0?Math.max(0,Math.min(1,t/m)):null;
}
function scoredPoints(rows,score,when,source='practice'){
 return rows.map(row=>({value:score(row),at:stamp(when(row)),source}))
  .filter(item=>Number.isFinite(item.value))
  .sort((a,b)=>a.at-b.at);
}
const mergePoints=(...groups)=>groups.flat().filter(item=>Number.isFinite(item?.value)).sort((a,b)=>a.at-b.at);
const values=points=>points.map(item=>item.value);
function trend(series){
 if(series.length<2)return null;
 const delta=(series.at(-1)-series[0])*100;
 if(Math.abs(delta)<2)return {label:'Stable',delta:0};
 return {label:delta>0?'Improving':'Needs attention',delta:Math.round(delta)};
}
function model(data,writing,speaking=[]){
 const reading=readingRows(data.reading),swt=Object.values(data.swt||{}).flat().filter(Boolean),essays=data.essays||[];
 const swtDrafts=Object.entries(data.swtDrafts||{}).flatMap(([passageId,draft])=>{
  const text=String(draft?.text||'').trim(),draftAt=stamp(draft?.timestamp);
  const latestScored=Math.max(0,...((data.swt||{})[passageId]||[]).map(a=>stamp(a?.timestamp)));
  return text&&draftAt>latestScored?[{passageId,draft,text,at:draftAt}]:[];
 });
 const essayDraft=data.essayDraft&&data.essayDraft.deleted!==true&&(String(data.essayDraft.essayText||'').trim()||String(data.essayDraft.questionText||'').trim())
  ? data.essayDraft:null;
 const submittedSpeaking=(Array.isArray(speaking)?speaking:[]).filter(a=>a?.status==='submitted'&&a.result);
 const writingMocks=writing.filter(a=>a.kind==='mock');
 const mocks=[
  ...reading.filter(a=>!a.practiceUid).map(a=>({id:a.id,engine:'reading',title:a.name||'Reading mock',at:a.startedAt,done:!!a.done,pending:!!a.pending,
    score:a.done&&!a.pending&&Number.isFinite(a.percent)?Math.round(a.percent):null,unit:'%',detail:'Accuracy',estimate90:null,nativeTotal:null,nativeMaximum:null})),
  ...writingMocks.map(a=>({id:a.id,engine:'writing',title:a.title,at:a.startedAt,done:a.status==='submitted',pending:a.status==='submitted'&&a.total==null,
    score:Number.isFinite(a.total)?a.total:null,unit:Number.isFinite(a.maximum)?'/'+a.maximum:'',detail:'Native practice marks',estimate90:Number.isFinite(a.score90)?a.score90:null,
    nativeTotal:a.total,nativeMaximum:a.maximum}))
 ].sort((a,b)=>stamp(b.at)-stamp(a.at));

 const practiceReading=reading.filter(a=>a.practiceUid&&a.done);
 const completedReading=reading.filter(a=>a.done);
 const readingMeta={
  dropdown:{name:'Reading Blanks (Dropdown)',route:'reading-dropdown'},
  mcma:{name:'Reading Multiple Answers',route:'reading-mcma'},
  reorder:{name:'Reorder Paragraphs',route:'reading-reorder'},
  wordbank:{name:'Reading Blanks (Drag & Drop)',route:'reading-wordbank'},
  mcsa:{name:'Reading Single Answer',route:'reading-mcsa'},
  hcs:{name:'Highlight Correct Summary',route:'listening-hcs'},
  hiw:{name:'Highlight Incorrect Words',route:'listening-hiw'}
 };
 const speakingMeta={
  ra:{name:'Read Aloud',route:'speaking-ra'},rs:{name:'Repeat Sentence',route:'speaking-rs'},
  di:{name:'Describe Image',route:'speaking-di'},rl:{name:'Retell Lecture',route:'speaking-rl'},
  sgd:{name:'Summarise Group Discussion',route:'speaking-sgd'},rts:{name:'Respond to a Situation',route:'speaking-rts'}
 };
 const activePractice=[
  ...swtDrafts.map(({passageId,text,at})=>({
    engine:'swt',id:'swt-draft-'+passageId,title:'Summarise Written Text',route:'swt',at,
    detail:'Passage '+passageId+' · '+text.split(/\s+/).filter(Boolean).length+' words saved'
  })),
  ...(essayDraft?[{
    engine:'essay',id:'essay-draft',title:'Write Essay',route:'practice',at:essayDraft.updatedAt,
    detail:(String(essayDraft.questionTitle||'').trim()||'Essay draft')+' · '+String(essayDraft.essayText||'').trim().split(/\s+/).filter(Boolean).length+' words saved'
  }]:[]),
  ...reading.filter(a=>a.practiceUid&&!a.done).map(a=>{const meta=readingMeta[a.questions?.[0]?.type];return {
    engine:'reading',id:a.id,title:meta?.name||a.name||'Reading practice',route:meta?.route||'practice-hub',
    at:a.updatedAt||a.startedAt,detail:'Question '+(Number(a.index||0)+1)+' of '+Math.max(1,a.questions?.length||1)
  };}),
  ...writing.filter(a=>a?.kind!=='mock'&&a?.status!=='submitted').map(a=>({
    engine:'writing',id:a.id,title:a.title||(a.kind==='sst'?'Summarise Spoken Text':a.kind==='wfd'?'Write From Dictation':'Writing practice'),
    route:a.kind==='sst'?'spoken-text':a.kind==='wfd'?'dictation':'practice-hub',at:a.startedAt,
    detail:(Number.isFinite(a.completed)&&Number.isFinite(a.questions)?a.completed+' of '+a.questions+' completed':'Saved response in progress')
  })),
  ...(Array.isArray(speaking)?speaking:[]).filter(a=>a?.status!=='submitted').map(a=>({
    engine:'speaking',id:a.id,title:speakingMeta[a.type]?.name||a.title||'Speaking practice',
    route:speakingMeta[a.type]?.route||'practice-hub',at:a.startedAt,detail:'Saved response in progress'
  }))
 ].sort((a,b)=>stamp(b.at)-stamp(a.at));
 const readingTaskPoints=type=>completedReading.flatMap(a=>{
  const row=Array.isArray(a.rows)?a.rows.find(r=>r?.type===type):null;
  let value=null;
  if(row && !row.pending) value=ratio(row.earned,row.gradedPossible??row.possible);
  else if(!row && a.practiceUid && a.questions?.[0]?.type===type) value=ratio(a.earned??a.total,a.possible??a.maximum);
  return Number.isFinite(value)?[{value,at:stamp(a.finishedAt||a.startedAt),source:a.practiceUid?'practice':'mock'}]:[];
 }).sort((a,b)=>a.at-b.at);
 const writingMockPoints=type=>writingMocks.flatMap(a=>{
  if(a.status!=='submitted')return [];
  const group=Array.isArray(a.byType)?a.byType.find(g=>g?.type===type):null;
  if(!group || group.marked!==group.count)return [];
  const value=ratio(group.total,group.maximum);
  return Number.isFinite(value)?[{value,at:stamp(a.startedAt),source:'mock'}]:[];
 }).sort((a,b)=>a.at-b.at);
 const swtPracticePoints=scoredPoints(swt,a=>{
  const traits=a?.trait_scores||{},parts=['content','form','grammar','vocabulary'].map(k=>numeric(traits[k]));
  return parts.every(x=>Number.isFinite(x))?ratio(parts.reduce((n,x)=>n+x,0),9):ratio(a?.overall_score,90);
 },a=>a.timestamp);
 const essayPracticePoints=scoredPoints(essays,a=>ratio(a?.scores?.total,26),a=>a.date||a.updatedAt);
 const sstRows=writing.filter(a=>a.kind==='sst'&&a.status==='submitted'),wfdRows=writing.filter(a=>a.kind==='wfd'&&a.status==='submitted');
 const sstPracticePoints=scoredPoints(sstRows,a=>ratio(a.total,a.maximum),a=>a.startedAt);
 const wfdPracticePoints=scoredPoints(wfdRows,a=>ratio(a.total,a.maximum),a=>a.startedAt);
 const speakingAreas=Object.entries(speakingMeta).map(([type,meta])=>{
  const rows=submittedSpeaking.filter(a=>a.type===type);
  return {...meta,points:scoredPoints(rows,a=>ratio(a.result?.total,a.result?.maximum),a=>a.startedAt),latest:rows.map(a=>a.startedAt)};
 });
 const readingAreas=Object.entries(readingMeta).map(([type,meta])=>({...meta,points:readingTaskPoints(type),
  latest:completedReading.filter(a=>Array.isArray(a.rows)?a.rows.some(r=>r?.type===type):a.practiceUid&&a.questions?.[0]?.type===type).map(a=>a.finishedAt||a.startedAt)}));
 const areas=[
  {name:'Summarise Written Text',route:'swt',points:mergePoints(swtPracticePoints,readingTaskPoints('swt'),writingMockPoints('swt')),latest:swt.map(a=>a.timestamp)},
  {name:'Write Essay',route:'practice',points:mergePoints(essayPracticePoints,writingMockPoints('essay')),latest:essays.map(a=>a.date||a.updatedAt)},
  ...readingAreas,
  ...speakingAreas,
  {name:'Summarise Spoken Text',route:'spoken-text',points:mergePoints(sstPracticePoints,writingMockPoints('sst')),latest:sstRows.map(a=>a.startedAt)},
  {name:'Write From Dictation',route:'dictation',points:mergePoints(wfdPracticePoints,writingMockPoints('wfd')),latest:wfdRows.map(a=>a.startedAt)}
 ].map(a=>{
  const scores=values(a.points),practiceCount=a.points.filter(p=>p.source==='practice').length,mockCount=a.points.filter(p=>p.source==='mock').length;
  return {...a,scores,count:scores.length,practiceCount,mockCount,average:avg(scores),trend:trend(scores.slice(-5))};
 });
 const weakest=areas.filter(a=>a.count>=2&&Number.isFinite(a.average)).sort((a,b)=>a.average-b.average)[0]||null;

 const groups=[
  {name:'Summarise Written Text',count:swt.length,route:'swt',dates:swt.map(a=>a.timestamp)},
  {name:'Write Essay',count:essays.length,route:'practice',dates:essays.map(a=>a.date||a.updatedAt)},
  {name:'Reading & listening questions',count:practiceReading.length,route:'practice-hub',dates:practiceReading.map(a=>a.finishedAt||a.startedAt)},
  {name:'Speaking practice',count:submittedSpeaking.length,route:'practice-hub',dates:submittedSpeaking.map(a=>a.startedAt)},
  {name:'Summarise Spoken Text',count:sstRows.length,route:'spoken-text',dates:sstRows.map(a=>a.startedAt)},
  {name:'Write From Dictation',count:wfdRows.length,route:'dictation',dates:wfdRows.map(a=>a.startedAt)}
 ];
 const days=new Set([...groups.flatMap(g=>g.dates),...mocks.filter(a=>a.done).map(a=>a.at)].map(stamp).filter(Boolean).map(n=>new Date(n).toLocaleDateString('en-CA')));
 const recent=[
  ...activePractice.map(a=>({title:a.title,route:a.route,at:a.at,result:'In progress · '+a.detail})),
  ...essays.map(a=>({title:a.questionTitle||'Write Essay',route:'practice',at:a.date||a.updatedAt,result:Number.isFinite(a?.scores?.total)?a.scores.total+'/26':null})),
  ...practiceReading.map(a=>{const meta=readingMeta[a.questions?.[0]?.type];return {title:meta?.name||a.name||'Reading practice',route:meta?.route||'practice-hub',at:a.finishedAt||a.startedAt,result:Number.isFinite(a.earned)&&Number.isFinite(a.possible)?a.earned+'/'+a.possible:null};}),
  ...submittedSpeaking.map(a=>({title:speakingMeta[a.type]?.name||a.title||'Speaking practice',route:speakingMeta[a.type]?.route||'practice-hub',at:a.startedAt,result:Number.isFinite(a.result?.total)&&Number.isFinite(a.result?.maximum)?a.result.total+'/'+a.result.maximum:null})),
  ...sstRows.map(a=>({title:a.title||'Summarise Spoken Text',route:'spoken-text',at:a.startedAt,result:Number.isFinite(a.total)?a.total+'/'+a.maximum:null})),
  ...wfdRows.map(a=>({title:a.title||'Write From Dictation',route:'dictation',at:a.startedAt,result:Number.isFinite(a.total)?a.total+'/'+a.maximum:null})),
  ...swt.map(a=>({title:'Summarise Written Text',route:'swt',at:a.timestamp,result:Number.isFinite(a.overall_score)?a.overall_score+'/90 estimate':null}))
 ].sort((a,b)=>stamp(b.at)-stamp(a.at)).slice(0,8);
 return {mocks,groups,areas,weakest,recent,activePractice,practice:groups.reduce((n,g)=>n+g.count,0),complete:mocks.filter(a=>a.done).length,active:mocks.filter(a=>!a.done).length,days:days.size};
}
function create({document:doc,identity,loadLocal,navigate,review,fetch:get=fetch}){
 let serial=0,current=null,filter='all';
 const host=()=>doc.getElementById('progressPane');
 function paint(local,writing,speaking,error){
  const m=model(local,writing,speaking);current=m;
  const list=m.mocks.filter(a=>filter==='all'||a.engine===filter);
  const focus=m.weakest
   ? '<section class="progress-focus"><div><span class="progress-caption">Suggested focus</span><h3>'+esc(m.weakest.name)+'</h3><p>Based on '+m.weakest.count+' saved scored results from practice and mocks. Average comparison: '+Math.round(m.weakest.average*100)+'% of available task marks.</p></div><button class="portal-button primary" data-progress-route="'+m.weakest.route+'">Practise this</button></section>'
   : '<section class="progress-focus"><div><span class="progress-caption">Suggested focus</span><h3>Build a reliable baseline</h3><p>Complete at least two scored attempts in a task type before a weakest area is suggested.</p></div><button class="portal-button primary" data-progress-route="practice-hub">Start practice</button></section>';
  host().innerHTML='<div class="progress-heading"><div><h2>My Progress</h2><p>Your saved activity, recent trend and next useful action.</p></div><button class="portal-button" data-progress-refresh>Refresh</button></div>'+
  (error?'<p class="progress-notice" role="alert">'+esc(error)+' <button class="portal-button" data-progress-refresh>Retry</button></p>':'')+
  '<div class="progress-stats">'+[['Practice attempts',m.practice],['Practice in progress',m.activePractice.length],['Completed mocks',m.complete],['Mocks in progress',m.active],['Study days',m.days]].map(([label,n])=>'<div><strong>'+n+'</strong><span>'+label+'</span></div>').join('')+'</div>'+
  '<p class="progress-caption">Based on saved activity'+(error?' currently available':'')+'. In-progress practice is shown as soon as it reaches your account, while task trends use completed scored results. Task trends combine normal practice with matching per-task mock results; mock tests are also listed separately below. Cross-task percentages are comparison aids only.</p>'+focus+
  (m.activePractice.length?'<section class="progress-section"><h3>Currently in progress</h3><div class="progress-activity">'+m.activePractice.map(a=>'<div><div><h4>'+esc(a.title)+'</h4><span class="progress-caption">'+date(a.at)+' · '+esc(a.detail)+'</span></div><button class="portal-button" data-progress-route="'+a.route+'">Open</button></div>').join('')+'</div></section>':'')+
  '<section class="progress-section"><h3>Task trends</h3><div class="progress-activity">'+m.areas.map(a=>'<div><div><h4>'+esc(a.name)+'</h4><span class="progress-caption">'+(a.count?a.count+' scored result'+(a.count===1?'':'s')+' · '+a.practiceCount+' practice'+(a.mockCount?' + '+a.mockCount+' mock':'')+' · '+(a.trend?(a.trend.label+(a.trend.delta? ' '+(a.trend.delta>0?'+':'')+a.trend.delta+' pp':'')):'Need another result for a trend'):'No scored practice or mock results yet')+'</span></div><button class="portal-button" data-progress-route="'+a.route+'">'+(a.count?'Practise again':'Start practice')+'</button></div>').join('')+'</div></section>'+
  '<section class="progress-section"><div class="progress-heading"><div><h3>Mock-test results</h3><p>Native marks are shown first; /90 values are secondary practice estimates.</p></div><label>Module<select id="progressFilter"><option value="all">All modules</option><option value="reading">Reading</option><option value="writing">Writing</option></select></label></div>'+
  (list.length?'<div class="progress-results">'+list.map(a=>'<article class="progress-result"><div><span class="progress-caption">'+esc(a.engine==='reading'?'Reading':'Writing')+' · '+date(a.at)+'</span><h4>'+esc(a.title)+'</h4><span class="progress-caption">'+(!a.done?'In progress':a.pending?'Assessment pending':'Completed')+'</span></div><div class="progress-result-score"><strong>'+(!a.done||a.pending||!Number.isFinite(a.score)?'—':Math.round(a.score)+'<small>'+a.unit+'</small>')+'</strong><span class="progress-caption">'+esc(a.detail)+(Number.isFinite(a.estimate90)?' · '+a.estimate90+'/90 estimate':'')+'</span></div><button class="portal-button" data-progress-review="'+m.mocks.indexOf(a)+'">'+(a.done?'Review result':'Continue')+'</button></article>').join('')+'</div>':'<div class="progress-empty"><p>No '+(filter==='all'?'':filter+' ')+'mock tests saved yet.</p><button class="portal-button primary" data-progress-route="mock-tests">Browse mock tests</button></div>')+'</section>'+
  '<section class="progress-section"><h3>Recent activity</h3>'+(m.recent.length?'<div class="progress-activity">'+m.recent.map(a=>'<div><div><h4>'+esc(a.title)+'</h4><span class="progress-caption">'+date(a.at)+(a.result?' · '+esc(a.result):'')+'</span></div><button class="portal-button" data-progress-route="'+a.route+'">Open</button></div>').join('')+'</div>':'<div class="progress-empty"><p>Your recent practice will appear here.</p></div>')+'</section>'+
  '<section class="progress-section"><h3>Practice activity</h3><div class="progress-activity">'+m.groups.map(g=>'<div><div><h4>'+esc(g.name)+'</h4><span class="progress-caption">'+g.count+' saved attempt'+(g.count===1?'':'s')+(g.count?' · Latest '+date(Math.max(...g.dates.map(stamp))):'')+'</span></div><button class="portal-button" data-progress-route="'+g.route+'">'+(g.count?'Open practice':'Start practice')+'</button></div>').join('')+'</div></section>';
  doc.getElementById('progressFilter').value=filter;
  doc.getElementById('progressFilter').onchange=e=>{filter=e.target.value;paint(local,writing,speaking,error);};
 }
 async function open(){
  const ticket=++serial,owner=identity();if(!owner.uid||!owner.token)return;
  const same=()=>ticket===serial&&identity().uid===owner.uid&&identity().token===owner.token;
  host().innerHTML='<p role="status">Loading your progress…</p>';
  const results=await Promise.allSettled([
   loadLocal(),
   (async()=>{const r=await get('/api/writing-lab/attempts',{headers:{'x-session-token':owner.token},cache:'no-store',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Writing and listening results could not load.');return r.json();})(),
   (async()=>{const r=await get('/api/speaking/attempts',{headers:{'x-session-token':owner.token},cache:'no-store',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Speaking results could not load.');return r.json();})()
  ]);
  if(!same())return;
  const local=results[0].status==='fulfilled'?results[0].value:{};
  const writing=results[1].status==='fulfilled'?results[1].value:[];
  const speaking=results[2].status==='fulfilled'?results[2].value:[];
  paint(local,writing,speaking,results.some(r=>r.status==='rejected')?'Some progress could not be refreshed. Available saved activity is shown below.':'');
 }
 host().onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-progress-refresh'))return open();if(b.dataset.progressRoute)return navigate(b.dataset.progressRoute);if(b.dataset.progressReview!==undefined){const a=current?.mocks[Number(b.dataset.progressReview)];if(a)review(a);}};
 return {open};
}
root.StudentProgress={create,model};
})(typeof window!=='undefined'?window:globalThis);
