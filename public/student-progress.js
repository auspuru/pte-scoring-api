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
    score:a.weighting?.profile==='writing'?(Number.isFinite(a.score90)?a.score90:null):(Number.isFinite(a.total)?a.total:null),unit:a.weighting?.profile==='writing'?'/90':(Number.isFinite(a.maximum)?'/'+a.maximum:''),detail:a.weighting?.profile==='writing'?'Weighted Writing practice estimate · provisional':'Native practice marks',estimate90:a.weighting?.profile==='writing'?null:(Number.isFinite(a.score90)?a.score90:null),
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
  hcs:{name:'Highlight Correct Summary',route:'listening-hcs-bank'},
  hiw:{name:'Highlight Incorrect Words',route:'listening-hiw-bank'}
 };
 const listeningMeta={lmcma:{name:'Multiple Choice, Multiple Answers',route:'listening-lmcma'},lfi:{name:'Listening Fill in the Blanks',route:'listening-lfi'},hcs:{name:'Highlight Correct Summary',route:'listening-hcs'},lmcsa:{name:'Multiple Choice, Single Answer',route:'listening-lmcsa'},smw:{name:'Select Missing Word',route:'listening-smw'},hiw:{name:'Highlight Incorrect Words',route:'listening-hiw'}};
 const listeningRows=writing.filter(a=>listeningMeta[a.kind]&&a.status==='submitted');
 const listeningPoints=type=>scoredPoints(listeningRows.filter(a=>a.kind===type),a=>ratio(a.total,a.maximum),a=>a.startedAt);
 const speakingMeta={
  ra:{name:'Read Aloud',route:'speaking-ra'},rs:{name:'Repeat Sentence',route:'speaking-rs'},
  di:{name:'Describe Image',route:'speaking-di'},rl:{name:'Retell Lecture',route:'speaking-rl'},
  sgd:{name:'Summarise Group Discussion',route:'speaking-sgd'},rts:{name:'Respond to a Situation',route:'speaking-rts'}
 };
 const activePractice=[
  ...swtDrafts.map(({passageId,text,at})=>({
    engine:'swt',id:'swt-draft-'+passageId,passageId,draft:true,title:'Summarise Written Text',route:'swt',at,
    detail:'Passage '+passageId+' · '+text.split(/\s+/).filter(Boolean).length+' words saved'
  })),
  ...(essayDraft?[{
    engine:'essay',id:'essay-draft',draft:true,title:'Write Essay',route:'practice',at:essayDraft.updatedAt,
    detail:(String(essayDraft.questionTitle||'').trim()||'Essay draft')+' · '+String(essayDraft.essayText||'').trim().split(/\s+/).filter(Boolean).length+' words saved'
  }]:[]),
  ...reading.filter(a=>a.practiceUid&&!a.done).map(a=>{const meta=readingMeta[a.questions?.[0]?.type];return {
    engine:'reading',id:a.id,title:meta?.name||a.name||'Reading practice',route:meta?.route||'practice-hub',
    at:a.updatedAt||a.startedAt,detail:'Question '+(Number(a.index||0)+1)+' of '+Math.max(1,a.questions?.length||1)
  };}),
  ...writing.filter(a=>a?.kind!=='mock'&&a?.status!=='submitted').map(a=>({
    engine:'writing',id:a.id,title:a.title||(a.kind==='sst'?'Summarise Spoken Text':a.kind==='wfd'?'Write From Dictation':'Writing practice'),
    route:a.kind==='sst'?'spoken-text':a.kind==='wfd'?'dictation':listeningMeta[a.kind]?.route||'practice-hub',at:a.startedAt,
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
 const readingAreas=Object.entries(readingMeta).map(([type,meta])=>({...meta,points:mergePoints(readingTaskPoints(type),listeningPoints(type),writingMockPoints(type)),
  latest:completedReading.filter(a=>Array.isArray(a.rows)?a.rows.some(r=>r?.type===type):a.practiceUid&&a.questions?.[0]?.type===type).map(a=>a.finishedAt||a.startedAt)}));
 const areas=[
  {name:'Summarise Written Text',route:'swt',points:mergePoints(swtPracticePoints,readingTaskPoints('swt'),writingMockPoints('swt')),latest:swt.map(a=>a.timestamp)},
  {name:'Write Essay',route:'practice',points:mergePoints(essayPracticePoints,writingMockPoints('essay')),latest:essays.map(a=>a.date||a.updatedAt)},
  ...readingAreas,
  ...speakingAreas,
  ...Object.entries(listeningMeta).filter(([type])=>!readingMeta[type]).map(([type,meta])=>({...meta,points:mergePoints(listeningPoints(type),writingMockPoints(type)),latest:listeningRows.filter(a=>a.kind===type).map(a=>a.startedAt)})),
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
  {name:'Write From Dictation',count:wfdRows.length,route:'dictation',dates:wfdRows.map(a=>a.startedAt)},
  {name:'Listening objective questions',count:listeningRows.length,route:'practice-hub',dates:listeningRows.map(a=>a.startedAt)}
 ];
 const days=new Set([...groups.flatMap(g=>g.dates),...mocks.filter(a=>a.done).map(a=>a.at)].map(stamp).filter(Boolean).map(n=>new Date(n).toLocaleDateString('en-CA')));
 const recentWriting=[
  ...essays.map(a=>({
    engine:'essay',title:a.questionTitle||'Write Essay',route:'practice',at:a.date||a.updatedAt,
    detail:Number.isFinite(a?.scores?.total)?'Completed · '+a.scores.total+'/26':'Completed'
  })),
  ...swt.map(a=>({
    engine:'swt',title:'Summarise Written Text',route:'swt',at:a.timestamp,
    detail:Number.isFinite(a.overall_score)?'Completed · '+a.overall_score+'/90 estimate':'Completed'
  }))
 ].filter(a=>stamp(a.at)).sort((a,b)=>stamp(b.at)-stamp(a.at)).slice(0,6);
 const recent=[
  ...activePractice.map(a=>({title:a.title,route:a.route,at:a.at,result:'In progress · '+a.detail})),
  ...essays.map(a=>({title:a.questionTitle||'Write Essay',route:'practice',at:a.date||a.updatedAt,result:Number.isFinite(a?.scores?.total)?a.scores.total+'/26':null})),
  ...practiceReading.map(a=>{const meta=readingMeta[a.questions?.[0]?.type];return {title:meta?.name||a.name||'Reading practice',route:meta?.route||'practice-hub',at:a.finishedAt||a.startedAt,result:Number.isFinite(a.earned)&&Number.isFinite(a.possible)?a.earned+'/'+a.possible:null};}),
  ...submittedSpeaking.map(a=>({title:speakingMeta[a.type]?.name||a.title||'Speaking practice',route:speakingMeta[a.type]?.route||'practice-hub',at:a.startedAt,result:Number.isFinite(a.result?.total)&&Number.isFinite(a.result?.maximum)?a.result.total+'/'+a.result.maximum:null})),
  ...listeningRows.map(a=>({title:listeningMeta[a.kind].name,route:listeningMeta[a.kind].route,at:a.startedAt,result:Number.isFinite(a.total)?a.total+'/'+a.maximum:null})),
  ...sstRows.map(a=>({title:a.title||'Summarise Spoken Text',route:'spoken-text',at:a.startedAt,result:Number.isFinite(a.total)?a.total+'/'+a.maximum:null})),
  ...wfdRows.map(a=>({title:a.title||'Write From Dictation',route:'dictation',at:a.startedAt,result:Number.isFinite(a.total)?a.total+'/'+a.maximum:null})),
  ...swt.map(a=>({title:'Summarise Written Text',route:'swt',at:a.timestamp,result:Number.isFinite(a.overall_score)?a.overall_score+'/90 estimate':null}))
 ].sort((a,b)=>stamp(b.at)-stamp(a.at)).slice(0,8);
 const activity=[
  ...activePractice.map(a=>({...a,status:'Saved draft',action:'Continue response'})),
  ...essays.map(a=>({engine:'essay',id:a.id,title:a.questionTitle||'Write Essay',task:'Write Essay',route:'practice',at:a.date||a.updatedAt,status:'Feedback ready',action:'View response & feedback'})),
  ...Object.entries(data.swt||{}).flatMap(([passageId,attempts])=>(Array.isArray(attempts)?attempts:[]).filter(Boolean).map((a,index)=>({
   engine:'swt',id:passageId+':'+(a.timestamp||index),passageId,timestamp:a.timestamp,responseText:a.text,attemptIndex:index,
   title:(data.passages||[]).find(p=>String(p.id)===String(passageId))?.title||'SWT passage '+passageId,task:'Summarise Written Text',route:'swt',at:a.timestamp,status:'Feedback ready',action:'View response & feedback'
  }))),
  ...practiceReading.map(a=>({engine:'reading',id:a.id,title:a.questions?.[0]?.title||a.name||'Reading practice',task:readingMeta[a.questions?.[0]?.type]?.name||'Reading practice',route:readingMeta[a.questions?.[0]?.type]?.route||'reading',at:a.finishedAt||a.startedAt,status:a.pending?'Assessment pending':'Feedback ready',action:'View response & feedback'})),
  ...(Array.isArray(speaking)?speaking:[]).filter(a=>a?.status==='submitted').map(a=>({engine:'speaking',id:a.id,title:a.title||a.questionId||speakingMeta[a.type]?.name||'Speaking practice',task:speakingMeta[a.type]?.name||'Speaking practice',route:speakingMeta[a.type]?.route||'practice-hub',at:a.finishedAt||a.startedAt,status:a.result?'Feedback ready':'Assessment pending',action:'View response & feedback'})),
  ...writing.filter(a=>a?.kind!=='mock'&&a?.status==='submitted').map(a=>({engine:'writing',id:a.id,title:a.title||'Saved practice',task:a.kind==='sst'?'Summarise Spoken Text':a.kind==='wfd'?'Write From Dictation':listeningMeta[a.kind]?.name||'Listening practice',route:a.kind==='sst'?'spoken-text':a.kind==='wfd'?'dictation':listeningMeta[a.kind]?.route||'writing-history',at:a.finishedAt||a.startedAt,status:a.total==null?'Assessment pending':'Feedback ready',action:'View response & feedback'}))
 ].sort((a,b)=>stamp(b.at)-stamp(a.at));
 return {activity,mocks,groups,areas,weakest,recent,recentWriting,activePractice,practice:groups.reduce((n,g)=>n+g.count,0),complete:mocks.filter(a=>a.done).length,active:mocks.filter(a=>!a.done).length,days:days.size};
}
function create({document:doc,identity,loadLocal,navigate,review,fetch:get=fetch}){
 let serial=0,current=null,currentOwner=null,visibleCount=20;
 const host=()=>doc.getElementById('progressPane');
 function paint(local,writing,speaking,error){
  const m=model(local,writing,speaking);current=m;currentOwner=identity();
  const rows=m.activity.slice(0,visibleCount);
  const row=(a,index)=>'<button type="button" class="progress-attempt" data-progress-attempt="'+index+'"><span class="progress-attempt-copy"><strong>'+esc(a.title)+'</strong><span class="progress-caption">'+esc(a.task||a.title)+' · '+date(a.at)+' · '+esc(a.status)+'</span></span><span class="progress-attempt-action">'+esc(a.action)+' <span aria-hidden="true">→</span></span></button>';
  host().innerHTML='<div class="progress-heading"><div><h2>My Progress</h2><p>Your latest questions first. Select a response to review your saved work and feedback.</p></div><button type="button" class="portal-button" data-progress-refresh>Refresh</button></div>'+
   (error?'<p class="progress-notice" role="alert">'+esc(error)+' <button type="button" class="portal-button" data-progress-refresh>Retry</button></p>':'')+
   '<section class="progress-section progress-recent"><h3>Recently attempted questions</h3>'+(rows.length?'<div class="progress-attempts">'+rows.map(row).join('')+'</div>':'<div class="progress-empty"><p>Your saved questions will appear here after you practise.</p><button type="button" class="portal-button primary" data-progress-route="practice-hub">Go to Practice</button></div>')+
   (m.activity.length>rows.length?'<button type="button" class="portal-button progress-more" data-progress-more>Show more questions</button>':'')+'</section>'+
   (m.mocks.length?'<details class="progress-section"><summary>Saved mock tests ('+m.mocks.length+')</summary><div class="progress-attempts">'+m.mocks.map((a,index)=>'<button type="button" class="progress-attempt" data-progress-review="'+index+'"><span class="progress-attempt-copy"><strong>'+esc(a.title)+'</strong><span class="progress-caption">'+date(a.at)+' · '+(!a.done?'In progress':a.pending?'Assessment pending':'Completed')+'</span></span><span class="progress-attempt-action">'+(a.done?'View result':'Continue')+' →</span></button>').join('')+'</div></details>':'');
  host().querySelector('[data-progress-more]')?.addEventListener('click',()=>{visibleCount+=20;paint(local,writing,speaking,error);});
 }
 async function open(){
  const ticket=++serial,owner=identity();if(!owner.uid||!owner.token)return;
  const same=()=>ticket===serial&&identity().uid===owner.uid&&identity().token===owner.token;
  current=null;currentOwner=null;visibleCount=20;host().innerHTML='<p role="status">Loading your progress…</p>';
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
 host().onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-progress-refresh'))return open();const user=identity();if(!currentOwner||currentOwner.uid!==user.uid||currentOwner.token!==user.token)return;if(b.dataset.progressRoute)return navigate(b.dataset.progressRoute);const entry=b.dataset.progressAttempt!==undefined?current?.activity[Number(b.dataset.progressAttempt)]:b.dataset.progressReview!==undefined?current?.mocks[Number(b.dataset.progressReview)]:null;if(entry)return review(entry);};
 return {open};
}
root.StudentProgress={create,model};
})(typeof window!=='undefined'?window:globalThis);
