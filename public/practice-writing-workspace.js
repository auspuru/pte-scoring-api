/* Approved individual Writing workspace. Native assessment and reports stay in index.js. */
(function(env){
 'use strict';
 const doc=env.document,studio=env.PracticeStudio;if(!doc||!studio||!doc.getElementById('swtPane'))return;
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const native={loadPassage,renderPracticeMain,showSwtScreen,backToEssayQuestions,pickLibraryQuestion,startExamSimulator,reattemptPractice,viewPracticeAttempt,moveEssayQuestion,renderQuestionPicker,setQuestionSource,startNewPractice};
 let owner='',swtSearch='',swtScroll=0,swtQueue=null,leaving=false,swtMenuGeneration=0,swtStatus='all',essayStatus='all',freshEssaySelection=null,writingSelection=0;
 let examReports=Object.create(null),examReportsReady=false,examReportFetch=0;
 const clocks=new Map();
 function scope(){if(owner!==currentUserId){owner=currentUserId;writingSelection++;swtSearch='';swtScroll=0;swtQueue=null;swtStatus='all';essayStatus='all';freshEssaySelection=null;clocks.clear();examReports=Object.create(null);examReportsReady=false;examReportFetch++;}}
 function currentSwt(){return swtPassageAt(currentPassageId);}
 function rememberSwt(){scope();const p=currentSwt();if(!p)return;clocks.set(String(p.id),{enabled:timerOn,seconds:timerSeconds});stopTimer();}
 async function saveSwtBeforeLeave(){if(leaving)return false;leaving=true;rememberSwt();const uid=currentUserId,token=sessionToken;try{const keys=['summaries','scratch','scratchUpdatedAt'].map(getPteStorageKey);if(keys.some(k=>!practiceStorage.isDurable(k))&&!await practiceStorage.flush(keys)){toast('Could not save your response. Keep this question open and retry.',true);return false;}return uid===currentUserId&&token===sessionToken;}finally{leaving=false;}}
 function swtHistory(){const p=currentSwt();return p?(localAccountProgress().history?.[p.id]||[]):[];}
 function swtPositions(){if(Array.isArray(swtQueue)&&swtQueue.includes(currentPassageId))return swtQueue;return swtNavigationPositions();}
 function historyHtml(kind,rows){return studio.attemptHistory(rows.map((a,i)=>({id:kind==='swt'?a.timestamp:a.id,label:'Attempt '+(rows.length-i),date:studio.brisbaneDate(kind==='swt'?a.timestamp:a.date),mode:kind==='swt'?'Saved practice':a.elapsedMs!=null?'Timed practice':'Untimed practice',status:'Completed',actions:kind==='swt'?'<button type="button" class="portal-button" data-writing-result="swt" data-timestamp="'+esc(a.timestamp)+'">Answer &amp; feedback</button>':'<button type="button" class="portal-button" data-writing-result="essay" data-attempt="'+esc(a.id)+'">Answer &amp; feedback</button>'})));}
 function refreshSwt(){
  if(!currentSwt())return;scope();const positions=swtPositions(),index=positions.indexOf(currentPassageId),p=currentSwt();
  let history=doc.getElementById('swtPreviousAttempts');if(!history){history=doc.createElement('div');history.id='swtPreviousAttempts';doc.getElementById('swtPracticeScreen').appendChild(history);}history.innerHTML=historyHtml('swt',swtHistory());
  let toolbar=doc.getElementById('swtWorkspaceActions');if(!toolbar){toolbar=doc.createElement('div');toolbar.id='swtWorkspaceActions';doc.getElementById('swtQuestionNavigation').prepend(toolbar);}
  toolbar.innerHTML='<button type="button" class="btn" data-writing-return="swt">← Return to questions</button><button type="button" class="btn practice-reattempt" data-writing-reattempt="swt">↻ Reattempt</button>';
  doc.getElementById('navPrev')?.toggleAttribute('disabled',index<=0);doc.getElementById('navNext')?.toggleAttribute('disabled',index<0||index>=positions.length-1);
  const label=doc.getElementById('navCurrent');if(label)label.textContent=String(index+1).padStart(2,'0');const total=doc.getElementById('navTotal');if(total)total.textContent=positions.length;
  const nav=doc.getElementById('swtPracticeNav');nav?.querySelectorAll('.swt-select-label').forEach(n=>n.hidden=true);
  const questionHeading=doc.getElementById('swtReadHeading'); questionHeading.textContent=p.title||'Read the passage';
 let newTag=doc.getElementById('swtQuestionNewBadge'); if(!newTag){newTag=doc.createElement('span');newTag.id='swtQuestionNewBadge';newTag.className='practice-library-label';newTag.textContent='NEW';newTag.setAttribute('aria-label','New question, not attempted yet');questionHeading.insertAdjacentElement('afterend',newTag);}
 newTag.style.display=env.SwtNewQuestion?.isNew(p,localAccountProgress().history,attempted)?'inline-flex':'none';
 }
 function archived(kind,id){return (LocalStore.get(getPteStorageKey('question-drafts'))||{})[kind]?.[id]||[];}
 async function archiveDraft(kind,id,snapshot){
  if(!snapshot?.text?.trim()&&!snapshot?.essayText?.trim())return true;
  const uid=currentUserId,token=sessionToken,key=getPteStorageKey('question-drafts'),all=LocalStore.get(key)||{};all[kind]||={};const rows=all[kind][id]||[];
  const text=snapshot.text??snapshot.essayText;if(!rows.some(row=>(row.text??row.essayText)===text))all[kind][id]=[{...snapshot,timerIntervalId:null,archivedAt:Date.now()},...rows];
  if(!LocalStore.set(key,all)&&!await practiceStorage.flush([key])){toast('Could not preserve your draft. Keep this question open and retry.',true);return false;}return uid===currentUserId&&token===sessionToken;
 }
 function swtDraft(p,progress=localAccountProgress()){
  const text=progress.summaries?.[p.id]?.text||'',submitted=(progress.history?.[p.id]||[]).some(a=>a.text===text)||progress.scores?.[p.id]?.__text===text;
  return text.trim()&&!submitted?{text,notes:progress.scratch?.[p.id]||'',clock:clocks.get(String(p.id))}:archived('swt',p.id)[0];
 }
 function swtRows(){const query=swtSearch.toLowerCase().trim(),progress=localAccountProgress();return passages.map((p,index)=>({p,position:index+1,done:(progress.history?.[p.id]||[]).length,latestScore:studio.latestWritingScore(progress.history?.[p.id]||[],'swt'),isNew:env.SwtNewQuestion?.isNew(p,progress.history,attempted)===true,draft:swtDraft(p,progress)})).filter(({p,position,done,draft})=>(!query||[position,p.id,p.title].join(' ').toLowerCase().includes(query))&&(swtStatus==='all'||swtStatus==='new'&&!done&&!draft||swtStatus==='done'&&done||swtStatus==='draft'&&draft));}
 function swtExamReportDetails(p){
  if(p.questionSet!=='nov23-2026-swt')return '';
  const data=examReports[p.id]||{};
  const source=Number.isSafeInteger(p.repeatCount)?'Source report: '+p.repeatCount+' mentions':'Source report count pending';
  const community=examReportsReady?'Student-reported encounters: '+(data.studentReportedTimes||0)+' from '+(data.reporterCount||0)+' students':'Student reports: loading';
  return source+' · '+community+(data.myTimes>0?' · Your count: '+data.myTimes:'');
 }
 function renderSwtRows(){
  const rows=swtRows(),list=doc.getElementById('swtQuestionRows');if(!list)return;
  list.innerHTML=studio.libraryRows(rows.map(({p,position,done,draft,latestScore,isNew})=>({
   id:p.id,number:position,title:p.title,badge:isNew?'NEW':'',latestScore,
   status:done?'Completed · '+done+' saved attempts':draft?'In progress':'Not attempted',
   detail:swtExamReportDetails(p),
   actions:'<button type="button" class="portal-button" data-swt-open="'+position+'">Practise →</button>'
     +(p.questionSet==='nov23-2026-swt'?'<button type="button" class="portal-button" data-swt-exam-report="'+esc(p.id)+'">Report exam encounters</button>':'')
     +(draft?'<button type="button" class="portal-button practice-library-resume" data-swt-resume="'+position+'">Resume draft</button>':'')
  })));
  const library=doc.getElementById('swtQuestionLibrary');
  library.dataset.queue=JSON.stringify(rows.map(row=>row.position));
  library.querySelector('.practice-library-count').textContent=rows.length+' questions';
 }
 async function loadSwtExamReports(){
  if(!sessionToken||!currentUserId||!passages.some(p=>p.questionSet==='nov23-2026-swt'))return;
  const uid=currentUserId,token=sessionToken,ticket=++examReportFetch;
  try {
   const response=await fetch(API_URL+'/api/swt/exam-reports',{headers:{'x-session-token':token},cache:'no-store'});
   if(!response.ok)throw Error('Report counts unavailable');
   const data=await response.json();
   if(uid!==currentUserId||token!==sessionToken||ticket!==examReportFetch)return;
   examReports=data.reports||Object.create(null);examReportsReady=true;
   if(doc.getElementById('swtQuestionLibrary')?.classList.contains('active'))renderSwtRows();
  }catch(_){if(ticket===examReportFetch)examReportsReady=false;}
 }
 function showSwtExamReportForm(questionId,button){
  const p=passages.find(row=>Number(row.id)===questionId);
  if(!p||p.questionSet!=='nov23-2026-swt')return;
  doc.querySelectorAll('.swt-exam-report-editor').forEach(node=>node.remove());
  const questionRow=button.closest('.practice-library-row');if(!questionRow)return;
  const previous=Number(examReports[questionId]?.myTimes)||0;
  const form=doc.createElement('form');
  form.className='swt-exam-report-editor';form.dataset.swtExamReportForm=String(questionId);
  form.innerHTML='<label for="swtExamReportTimes">How many times have you encountered this exact passage in an official PTE exam?</label><div class="swt-exam-report-actions"><input id="swtExamReportTimes" name="timesSeen" type="number" min="0" max="50" step="1" required value="'+previous+'"><button type="submit" class="portal-button">Save report</button><button type="button" class="portal-button" data-swt-report-cancel>Cancel</button></div><p>Enter the cumulative number of real exam encounters (0–50). Updates replace your old count. Enter 0 to remove it. Portal practice attempts do not count.</p><p class="swt-exam-report-error" role="alert" hidden></p>';
  questionRow.insertAdjacentElement('afterend',form);form.querySelector('input')?.focus();
 }
 async function saveSwtExamReport(form){
  const field=form.elements.namedItem('timesSeen'),timesSeen=Number(field?.value),id=Number(form.dataset.swtExamReportForm);
  const error=form.querySelector('.swt-exam-report-error');
  const fail=message=>{error.hidden=false;error.textContent=message;};
  if(!field||field.value.trim()===''||!Number.isSafeInteger(timesSeen)||timesSeen<0||timesSeen>50)return fail('Enter a whole number between 0 and 50.');
  if(!sessionToken)return fail('Please sign in before reporting.');
  const uid=currentUserId,token=sessionToken,button=form.querySelector('[type="submit"]');button.disabled=true;
  try {
   const response=await fetch(API_URL+'/api/swt/exam-reports/'+encodeURIComponent(id),{method:'POST',headers:{'Content-Type':'application/json','x-session-token':token},body:JSON.stringify({timesSeen})});
   const data=await response.json();if(!response.ok)throw Error(data.error||'Could not save report.');
   if(uid!==currentUserId||token!==sessionToken)return;
   examReports[id]=data.report;examReportsReady=true;renderSwtRows();
   toast(timesSeen?'Exam encounter report saved.':'Exam encounter report removed.');
  }catch(e){button.disabled=false;fail(e.message||'Could not save report.');}
 }
 function renderSwtMenu(){
  scope();let library=doc.getElementById('swtQuestionLibrary');if(!library){library=doc.createElement('section');library.id='swtQuestionLibrary';library.className='swt-sub-screen';doc.getElementById('swtPane').prepend(library);}
  library.innerHTML=studio.questionLibrary({skill:'Writing',title:'Summarise Written Text',total:swtRows().length,searchId:'swtQuestionSearch',search:swtSearch,filterId:'swtQuestionFilter',filter:swtStatus,rowsId:'swtQuestionRows'});renderSwtRows();native.showSwtScreen('swtQuestionLibrary');library.querySelector('.practice-library-rows').scrollTop=swtScroll;
 }
 async function openSwtMenu(){const ticket=++swtMenuGeneration;if(!await saveSwtBeforeLeave()||ticket!==swtMenuGeneration||portalWorkspace?.current()!=='swt')return;renderSwtMenu();loadSwtExamReports();}
 async function openSwt(position,{resume=false}={}){
  scope();const ticket=++writingSelection,uid=currentUserId,token=sessionToken,current=()=>ticket===writingSelection&&uid===currentUserId&&token===sessionToken&&portalWorkspace?.current()==='swt';
  if(!await saveSwtBeforeLeave()||!current())return;const p=swtPassageAt(position);if(!p)return;
  const library=doc.getElementById('swtQuestionLibrary'),saved=swtDraft(p);swtScroll=library?.querySelector('.practice-library-rows')?.scrollTop||0;swtQueue=JSON.parse(library?.dataset.queue||'[]');
  if(!resume&&saved&&!await archiveDraft('swt',p.id,saved))return;if(!current())return;loadPassage(position);native.showSwtScreen('swtPracticeScreen');
  if(resume&&saved){doc.getElementById('summaryInput').value=saved.text;onSummaryInput();const notes=doc.getElementById('scratchInput');if(notes&&saved.notes!=null){notes.value=saved.notes;notes.dispatchEvent(new Event('input',{bubbles:true}));}if(saved.clock){stopTimer();timerOn=saved.clock.enabled;timerSeconds=saved.clock.seconds;if(timerOn)startTimer();else renderTimer();}}
  else{resetSummary();const notes=doc.getElementById('scratchInput');if(notes){notes.value='';notes.dispatchEvent(new Event('input',{bubbles:true}));}stopTimer();timerSeconds=TIMER_START_SECONDS;clocks.delete(String(p.id));if(timerOn)startTimer();else renderTimer();}
  refreshSwt();
 }
 env.loadPassage=function(position){swtMenuGeneration++;scope();if(portalWorkspace?.current()==='swt'&&doc.getElementById('swtPracticeScreen').classList.contains('active'))rememberSwt();const result=native.loadPassage(position),p=currentSwt(),clock=p&&clocks.get(String(p.id));if(clock){stopTimer();timerOn=clock.enabled;timerSeconds=clock.seconds;doc.getElementById('timerState').textContent=timerOn?'Timer on':'Timer off';doc.getElementById('timerToggle').setAttribute('aria-pressed',String(timerOn));if(timerOn)startTimer();else doc.getElementById('timerDisplay').textContent='—';}refreshSwt();if(portalWorkspace?.current()==='swt')native.showSwtScreen('swtPracticeScreen');return result;};
 env.showSwtScreen=function(id){if(id!=='swtQuestionLibrary')swtMenuGeneration++;return native.showSwtScreen(id);};
 env.moveSwtQuestion=function(direction){const positions=swtPositions(),index=positions.indexOf(currentPassageId),target=positions[index+direction];if(index>=0&&target!=null)jumpToPassage(target);};
 function essayQuestionId(){return practiceState.view==='results'?practiceState.currentAttempt?.questionId:practiceState.selectedQuestionId;}
 function essayHistory(){const id=essayQuestionId(),q=essays.find(e=>String(e.id)===String(id));return (q?studio.essayAttempts(q,getPracticeHistory()):getPracticeHistory().filter(a=>a.questionId===id)).sort((a,b)=>new Date(b.date)-new Date(a.date));}
 function essayToolbar(){
  if(!['loading','results'].includes(practiceState.view)&&!(practiceState.view==='write'&&practiceState.writeStep===2))return '';
  const ids=practiceState.questionQueue||essays.filter(e=>e.question?.trim()).map(e=>e.id),index=ids.indexOf(essayQuestionId()),status=practiceState.view==='loading'?'Scoring':practiceState.view==='results'?'Completed':'In progress';
  return studio.questionToolbar({title:'Write Essay',position:index<0?'Custom prompt':'Question '+(index+1)+' of '+ids.length,mode:practiceState.timerEnabled?'Timed practice':'Untimed practice',status,actions:'<button type="button" class="btn" data-writing-return="essay">← Return to questions</button><button type="button" class="btn practice-reattempt" data-writing-reattempt="essay">↻ Reattempt</button><button type="button" class="btn" onclick="moveEssayQuestion(-1)" '+(index<=0?'disabled':'')+'>← Back</button><button type="button" class="btn" onclick="moveEssayQuestion(1)" '+(index<0||index>=ids.length-1?'disabled':'')+'>Next →</button>'});
 }
 function refreshEssay(){if(practiceState.view==='write'&&practiceState.writeStep===2)env.PortalQuestionNavigation?.update({question:practiceState.selectedQuestionId||'custom',mode:practiceState.timerEnabled?'timed':'untimed'});const nav=doc.getElementById('essayQuestionNav');if(!nav)return;nav.innerHTML=essayToolbar();const content=doc.getElementById('practiceContent');if(nav.innerHTML)content.prepend(nav);let history=doc.getElementById('essayPreviousAttempts');if(!history){history=doc.createElement('div');history.id='essayPreviousAttempts';content.appendChild(history);}history.innerHTML=nav.innerHTML?historyHtml('essay',essayHistory()):'';}
 env.renderPracticeMain=function(){scope();if(practiceState.view==='welcome')Object.assign(practiceState,{view:'write',writeStep:1,questionSource:'library'});if(practiceState.view==='write'&&practiceState.writeStep===1&&practiceState.questionSource==='library')return renderEssayMenu();const result=native.renderPracticeMain();refreshEssay();return result;};
 async function returnToEssayQuestions(){if(leaving)return;leaving=true;try{const input=doc.getElementById('practiceEssayInput');if(input)practiceState.essayText=input.value;const uid=currentUserId,token=sessionToken,portalSaved=savePortalEssayDraft(),questionSaved=practiceState.writeStep===2||practiceState.view==='loading'?saveEssayQuestionDraft():true;if(!portalSaved||!questionSaved){if(!await practiceStorage.flush([getPteStorageKey('essay-question-drafts'),'ipt_essay_draft_v1:'+encodeURIComponent(uid)])){toast('Could not save your essay. Keep this question open.',true);return;}}if(uid!==currentUserId||token!==sessionToken||portalWorkspace?.current()!=='practice')return;native.backToEssayQuestions();refreshEssay();}finally{leaving=false;}}
 env.backToEssayQuestions=returnToEssayQuestions;
 function currentEssayDraft(id){const saved=(LocalStore.get(getPteStorageKey('essay-question-drafts'))||{})[id];return saved&&saved.writeStep===2&&saved.essayText?.trim()&&['write','loading'].includes(saved.view)&&!getPracticeHistory().some(a=>a.questionId===id&&a.essayText===saved.essayText)?saved:archived('essay',id)[0];}
 function essayRows(){const query=(practiceState.pickerSearch||'').toLowerCase().trim(),history=getPracticeHistory();return essays.filter(e=>e.question?.trim()).map((e,i)=>({e,number:i+1,done:studio.essayAttempts(e,history).length,latestScore:studio.latestWritingScore(studio.essayAttempts(e,history),'essay'),draft:currentEssayDraft(e.id)})).filter(({e,number,done,draft})=>(!query||[number,e.id,e.title,e.question].join(' ').toLowerCase().includes(query))&&(essayStatus==='all'||essayStatus==='new'&&!done&&!draft||essayStatus==='done'&&done||essayStatus==='draft'&&draft));}
 function renderEssayRows(){const rows=essayRows(),list=doc.getElementById('practiceQuestionPicker');if(!list)return;list.innerHTML=studio.libraryRows(rows.map(({e,number,done,draft,latestScore})=>({id:e.id,number,title:e.title||e.question,latestScore,status:done?'Completed · '+done+' saved attempts':draft?'In progress':'Not attempted',actions:'<button type="button" class="portal-button" data-essay-open="'+esc(e.id)+'">Practise →</button>'+(draft?'<button type="button" class="portal-button practice-library-resume" data-essay-resume="'+esc(e.id)+'">Resume draft</button>':'')})));const count=doc.querySelector('#practiceContent .practice-library-count');if(count)count.textContent=rows.length+' questions';}
 function renderEssayMenu(){scope();const content=doc.getElementById('practiceContent');content.dataset.view='questions';content.setAttribute('aria-busy','false');env.PortalQuestionNavigation?.update({library:true,context:{search:practiceState.pickerSearch||'',status:essayStatus}});content.innerHTML=studio.questionLibrary({skill:'Writing',title:'Write Essay',total:essayRows().length,searchId:'practiceQuestionSearch',search:practiceState.pickerSearch||'',filterId:'essayQuestionStatus',filter:essayStatus,rowsId:'practiceQuestionPicker',options:'<label class="practice-library-timer"><input type="checkbox" id="practiceTimerToggle" '+(practiceState.timerEnabled?'checked':'')+'> Time mode · 20-minute target</label>',extras:'<details><summary>Saved responses</summary>'+studio.attemptHistory(getPracticeHistory().map(a=>({id:a.id,label:a.questionTitle||'Essay',date:studio.brisbaneDate(a.date),mode:a.elapsedMs!=null?'Timed practice':'Untimed practice',status:'Completed',actions:'<button type="button" class="portal-button" data-writing-result="essay" data-attempt="'+esc(a.id)+'">Answer &amp; feedback</button>'})))+'</details><details><summary>Custom prompt</summary><p>Use your own essay question.</p><button type="button" class="btn" data-writing-custom="essay">Enter a custom prompt</button></details>'});renderEssayRows();doc.getElementById('practiceQuestionPicker').scrollTop=practiceState.pickerScroll||0;}
 async function openEssayMenu(){if(env.PortalExamMode?.isActive())return;return returnToEssayQuestions();}
 async function openEssayQuestion(id,{resume=false}={}){
  scope();const ticket=++writingSelection,uid=currentUserId,token=sessionToken,current=()=>ticket===writingSelection&&uid===currentUserId&&token===sessionToken&&portalWorkspace?.current()==='practice';
  const q=essays.find(e=>e.id===id);if(!q){if(resume&&id==='custom'&&practiceState.writeStep===2)renderPracticeMain();return;}const input=doc.getElementById('practiceEssayInput');if(input)practiceState.essayText=input.value;
  if(practiceState.selectedQuestionId&&practiceState.essayText?.trim()){const portalSaved=savePortalEssayDraft(),questionSaved=practiceState.writeStep===2||practiceState.view==='loading'?saveEssayQuestionDraft():true;if(!portalSaved||!questionSaved){if(!await practiceStorage.flush([getPteStorageKey('essay-question-drafts'),'ipt_essay_draft_v1:'+encodeURIComponent(currentUserId)]))return;}}
  if(!current())return;const saved=currentEssayDraft(id);if(!resume&&saved&&!await archiveDraft('essay',id,saved))return;if(!current())return;
  const context={questionQueue:essayRows().map(row=>row.e.id),pickerSearch:practiceState.pickerSearch,pickerScroll:doc.getElementById('practiceQuestionPicker')?.scrollTop||0};
  if(resume&&saved){Object.assign(practiceState,saved,context,{timerIntervalId:null});if(practiceState.view==='loading'&&!essayReviewPending(practiceState.submissionId))practiceState.view='write';renderPracticeMain();env.PortalQuestionNavigation?.update({question:id,mode:practiceState.timerEnabled?'timed':'untimed'});return;}
  Object.assign(practiceState,{view:'write',writeStep:1,questionSource:'library',selectedQuestionId:id,questionTitle:q.title||'',questionText:q.question,essayText:'',revisionParentId:null,submissionId:null,submissionSignature:'',currentAttempt:null,viewingAttemptId:null,timerStartedAt:null,timerIntervalId:null},context);freshEssaySelection=id;env.PortalQuestionNavigation?.update({question:id,mode:practiceState.timerEnabled?'timed':'untimed'});return startExamSimulator();
 }
 env.moveEssayQuestion=async function(direction){const uid=currentUserId,token=sessionToken;await native.moveEssayQuestion(direction);if(uid!==currentUserId||token!==sessionToken||portalWorkspace?.current()!=='practice')return;if(practiceState.view==='write'&&practiceState.writeStep===1&&practiceState.selectedQuestionId)return openEssayQuestion(practiceState.selectedQuestionId,{resume:true});};
 env.startNewPractice=function(){if(practiceState.view==='write'&&practiceState.writeStep===1&&practiceState.essayText?.trim())practiceState.writeStep=2;return native.startNewPractice();};
 env.renderQuestionPicker=renderEssayRows;
 env.setQuestionSource=function(source){if(source==='library'){practiceState.questionSource='library';return renderEssayMenu();}practiceState.questionSource=source;renderPracticeMain();updateSubmitBtnState();};
 function restoreEssayDraft(){const id=practiceState.selectedQuestionId,saved=(LocalStore.get(getPteStorageKey('essay-question-drafts'))||{})[id];if(!saved||!['results','loading'].includes(saved.view)&&saved.writeStep!==2)return false;const context={questionQueue:practiceState.questionQueue,pickerSearch:practiceState.pickerSearch,pickerScroll:practiceState.pickerScroll};Object.assign(practiceState,saved,context,{timerIntervalId:null});if(practiceState.view==='loading'&&!essayReviewPending(practiceState.submissionId))practiceState.view='write';renderPracticeMain();return true;}
 env.startExamSimulator=function(){if(freshEssaySelection===practiceState.selectedQuestionId){freshEssaySelection=null;return native.startExamSimulator();}if(restoreEssayDraft())return;return native.startExamSimulator();};
 env.reattemptPractice=function(){const original=practiceState.currentAttempt,id=essayQuestionId();if(original){native.reattemptPractice();if(id)practiceState.selectedQuestionId=id;}else{archivePracticeDraftForUndo('Previous essay draft archived.');Object.assign(practiceState,{view:'write',writeStep:2,essayText:'',submissionId:null,submissionSignature:'',currentAttempt:null,viewingAttemptId:null,revisionParentId:null});resetPracticeTimer();renderPracticeMain();}saveEssayQuestionDraft();savePortalEssayDraft();refreshEssay();};
 doc.addEventListener('input',event=>{if(event.target.id==='swtQuestionSearch'){swtSearch=event.target.value;renderSwtRows();}if(event.target.id==='practiceQuestionSearch'){practiceState.pickerSearch=event.target.value;renderEssayRows();}});
 doc.addEventListener('change',event=>{if(event.target.id==='swtQuestionFilter'){swtStatus=event.target.value;swtScroll=0;renderSwtRows();}if(event.target.id==='essayQuestionStatus'){essayStatus=event.target.value;renderEssayRows();}if(event.target.id==='practiceTimerToggle')toggleTimerMode(event.target.checked);});
 doc.addEventListener('click',async event=>{const b=event.target.closest('button');if(!b||b.disabled)return;const d=b.dataset;if(d.swtExamReport){return showSwtExamReportForm(Number(d.swtExamReport),b);}if(d.swtReportCancel){b.closest('.swt-exam-report-editor')?.remove();return;}if(d.swtOpen){return openSwt(Number(d.swtOpen));}if(d.swtResume){return openSwt(Number(d.swtResume),{resume:true});}if(d.essayOpen){return openEssayQuestion(d.essayOpen);}if(d.essayResume){return openEssayQuestion(d.essayResume,{resume:true});}if(d.writingCustom){Object.assign(practiceState,{view:'write',writeStep:1,questionSource:'custom'});return renderPracticeMain();}if(d.writingReturn){return d.writingReturn==='swt'?openSwtMenu():returnToEssayQuestions();}if(d.writingReattempt){if(d.writingReattempt==='essay')return reattemptPractice();if(!await saveSwtBeforeLeave())return;resetSummary();stopTimer();timerSeconds=TIMER_START_SECONDS;if(timerOn)startTimer();refreshSwt();return;}if(d.writingResult==='essay'){if(!await savePortalEssayDraft())return;if(practiceState.writeStep===2||practiceState.view==='loading'){if(!saveEssayQuestionDraft()&&!await practiceStorage.flush([getPteStorageKey('essay-question-drafts')]))return;}return native.viewPracticeAttempt(d.attempt);}if(d.writingResult==='swt'){if(!await saveSwtBeforeLeave())return;const saved=swtHistory().find(a=>String(a.timestamp)===d.timestamp);if(saved)openSavedSwtResponse({passageId:currentSwt().id,timestamp:saved.timestamp,responseText:saved.text});}});
 doc.addEventListener('submit',event=>{const form=event.target.closest('form[data-swt-exam-report-form]');if(!form)return;event.preventDefault();saveSwtExamReport(form);});
 env.PracticeWritingWorkspace={openSwtMenu,openEssayMenu,openEssayQuestion,refreshSwt,refreshEssay};
})(window);
