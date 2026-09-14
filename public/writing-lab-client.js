(function () {
  'use strict';
  const root = document.getElementById('lab');
  const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const count = text => text.trim().split(/\s+/).filter(Boolean).length;
  const clock = seconds => Math.floor(Math.max(0,seconds)/60)+':'+String(Math.floor(Math.max(0,seconds)%60)).padStart(2,'0');
  const labels = {content:'Content',form:'Form',grammar:'Grammar',vocabulary:'Vocabulary',spelling:'Spelling',linguistic:'General linguistic range',coherence:'Development, structure & coherence'};
  const source = 'https://www.pearsonpte.com/content/dam/ELL/pte/pearsonpte/pdfs/pte-academic-pdfs/PTE-Academic-Test-Taker-Score-Guide.pdf';
  let catalog, username, attempt = null, view = location.pathname === '/spoken-text' ? 'sst' : 'mocks';
  let timer, saveTimer, noticeTimer, offset = 0, saving = Promise.resolve(), grading = false, moving = false, expiryBusy = false, saveConflict = false;
  let audio = null, audioAttempt = null, audioFinished = false;
  const storage = { get(k) { try { return localStorage.getItem(k); } catch(_) { return null; } },
    put(k,v) { try { localStorage.setItem(k,v); return true; } catch(_) { return false; } },
    remove(k) { try { localStorage.removeItem(k); } catch(_) {} } };
  const draftKey = () => 'ipt-writing-lab:' + username + ':' + attempt?.id;
  function notify(text) { clearTimeout(noticeTimer); document.getElementById('notice').textContent=text; noticeTimer=setTimeout(()=>document.getElementById('notice').textContent='',6500); }
  function token() { try { return sessionStorage.getItem('pte_impersonate_token') || storage.get('pte_session_token') || ''; } catch(_) { return ''; } }
  async function api(path, body) {
    const response = await fetch('/api/writing-lab'+path, {method:body===undefined?'GET':'POST',cache:'no-store',
      headers:{'Content-Type':'application/json','x-session-token':token()},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(150000)});
    let value;
    try { value=await response.json(); } catch(_) { throw Error('The connection was interrupted. Please retry.'); }
    if(!response.ok) throw Error(value.error || 'The request could not be completed.');
    return value;
  }
  function setAttempt(value) { attempt=value; offset=value.serverNow-Date.now(); saveConflict=false; }
  function writeDraft() {
    const editor=document.getElementById('answer');
    if(!attempt || attempt.status!=='active' || !editor) return;
    const value={index:attempt.index,text:editor.value,revision:attempt.revisions[attempt.index],notes:document.getElementById('notes')?.value || '',
      at:Date.now()+offset,audioTime:audio?.currentTime||0,audioFinished};
    const saved=storage.put(draftKey(),JSON.stringify(value));
    const status=document.getElementById('save-status');
    if(status && !saveConflict) status.textContent=saved?'Saved on this device · syncing…':'Device saving unavailable · syncing to your account…';
  }
  function draft() { try { return JSON.parse(storage.get(draftKey())||'null'); } catch(_) { return null; } }
  function scoringNote() { return '<div class="note"><p><b>About your score.</b> AI practice marks follow the task criteria in <a href="'+source+'" target="_blank" rel="noopener">Pearson’s score guide</a>. These are practice totals, not an official Pearson score or a prediction on the 10–90 scale.</p><p>The writing mocks cover SWT and essay tasks. Other parts of the full PTE Academic test also contribute to the official Writing score.</p></div>'; }
  async function hub(tab=view) {
    clearInterval(timer); clearTimeout(saveTimer);
    if(audio) audio.pause();
    document.body.classList.remove('exam-mode');
    attempt=null; view=tab;
    const auth=username?'':'<div class="auth-note"><a href="/">Sign in to your existing account</a>, then open Writing sectional mocks or Summarise spoken text from the sidebar.</div>';
    let content='';
    if(tab==='history') {
      content='<h1>My attempts</h1><p class="muted">Resume an unfinished attempt or review your saved feedback.</p><div id="history-list" class="history-list"><p>Loading attempts…</p></div>';
    } else if(tab==='mocks') {
      content='<section class="hero"><div><p class="eyebrow">PTE Academic · Writing practice</p><h1>Your next exam rehearsal.</h1><p>Two complete writing sectional mocks. A focused exam screen, timed questions and detailed feedback when you finish.</p></div><div class="hero-metric"><strong>40</strong><span>MINUTES PER MOCK</span></div></section>'+auth+
        '<div class="section-heading"><h2>Choose your mock</h2><span class="muted">2 papers · 3 questions each</span></div><div class="cards">'+catalog.mocks.map((m,i)=>'<article class="card"><span class="tag">Mock '+String(i+1).padStart(2,'0')+'</span><h2>'+esc(m.title)+'</h2><p>'+esc(m.description)+'</p><div class="rules"><span><b>2 × SWT</b>10 minutes each</span><span><b>1 × Essay</b>20 minutes</span></div><div class="card-footer"><span class="meta">44 available practice marks</span><button class="primary" data-start="'+m.id+'">Start mock '+(i+1)+' →</button></div></article>').join('')+'</div><div class="rules"><span><b>One question at a time</b>Submitted answers are locked.</span><span><b>No pause</b>The clock continues if you leave.</span><span><b>Automatic submission</b>Saved answers submit when time expires.</span></div>'+scoringNote();
    } else {
      content='<section class="hero"><div><p class="eyebrow">PTE Academic · Listening & writing</p><h1>Listen. Connect. Summarise.</h1><p>Practise with five original short lectures. Listen once, take notes and write a clear summary of 50–70 words.</p></div><div class="hero-metric"><strong>05</strong><span>LISTENING EXERCISES</span></div></section>'+auth+
        '<div class="section-heading"><h2>Summarise Spoken Text</h2><span class="muted">10 minutes per question</span></div><div class="cards">'+catalog.spoken.map((q,i)=>'<article class="card"><span class="tag">'+String(i+1).padStart(2,'0')+' · '+esc(q.topic)+'</span><h2>'+esc(q.title)+'</h2><p>Listen to a short lecture, then summarise its central idea and essential supporting points.</p><div class="card-footer"><span class="meta">50–70 words · 12 marks</span><button class="primary" data-start="'+q.id+'">Practise →</button></div></article>').join('')+'</div><div class="note">Original practice material with AI-generated narration. Audio plays once per attempt; the transcript and sample summary appear after submission. The 10-minute timer includes listening time.</div>'+scoringNote();
    }
    root.innerHTML='<div class="hub"><nav class="tabs" aria-label="Practice sections"><button data-tab="mocks" class="'+(tab==='mocks'?'selected':'')+'">Writing mocks</button><button data-tab="sst" class="'+(tab==='sst'?'selected':'')+'">Spoken text practice</button><button data-tab="history" class="'+(tab==='history'?'selected':'')+'">My attempts</button></nav>'+content+'</div>';
    if(tab==='history') {
      const target=document.getElementById('history-list');
      if(!username) { target.innerHTML=auth; return; }
      try {
        const history=await api('/attempts');
        if(!target.isConnected) return;
        target.innerHTML=history.length?history.map(a=>'<article class="history-row"><div><b>'+esc(a.title)+'</b><p class="muted">'+new Date(a.startedAt).toLocaleString()+' · '+(a.status==='submitted'?(a.total===null?'Submitted · feedback pending':a.total+'/'+a.maximum+' practice marks'):'In progress · '+a.completed+'/'+a.questions+' submitted')+'</p></div><button class="secondary" data-resume="'+a.id+'">'+(a.status==='submitted'?'Review':'Resume')+'</button></article>').join(''):'<p class="empty">Your attempts will appear here after you start practising.</p>';
      } catch(e) { if(target.isConnected) target.innerHTML='<p class="error">'+esc(e.message)+'</p><button class="secondary" data-tab="history">Retry</button>'; }
    }
  }
  function confirmAction(title,text,button) {
    const dialog=document.getElementById('confirm-dialog');
    document.getElementById('confirm-title').textContent=title;
    document.getElementById('confirm-text').textContent=text;
    document.getElementById('confirm-ok').textContent=button;
    dialog.showModal();
    return new Promise(resolve=>{
      let accepted=false;
      document.getElementById('confirm-ok').onclick=()=>{accepted=true;dialog.close();};
      document.getElementById('confirm-cancel').onclick=()=>dialog.close();
      dialog.onclose=()=>resolve(accepted);
    });
  }
  async function start(testId, button) {
    if(!username) { notify('Sign in from your workspace first. Your existing account works here.'); return; }
    if(testId.startsWith('writing-') && !await confirmAction('Ready to begin?','You have 10 minutes for each written summary and 20 minutes for the essay. You cannot return to a submitted question. The timer continues if you leave or refresh.','Begin 40-minute mock')) return;
    button.disabled=true;
    try {
      setAttempt(await api('/attempts',{id:crypto.randomUUID(),testId}));
      showAttempt();
    } catch(e) { notify(e.message); button.disabled=false; }
  }
  async function resume(id,button) {
    button.disabled=true;
    try {
      setAttempt(await api('/attempts/'+id));
      const local=draft();
      if(attempt.status==='active' && local?.index===attempt.index && local.at<attempt.deadline && local.revision>=attempt.revisions[attempt.index]) {
        attempt.answers[attempt.index]=local.text; attempt.revisions[attempt.index]=local.revision; attempt.notes=local.notes||'';
      }
      showAttempt();
      if(attempt?.status==='active') saveAnswer(false);
    } catch(e) { notify(e.message); button.disabled=false; }
  }
  function showAttempt() {
    clearInterval(timer); clearTimeout(saveTimer);
    if(attempt.status==='submitted') { if(audio) audio.pause(); storage.remove(draftKey()); renderResults(); return; }
    document.body.classList.add('exam-mode');
    const q=attempt.questions[attempt.index], sst=q.type==='sst';
    const instruction=sst?'Listen to the recording and write a summary of 50–70 words. You have 10 minutes in total, including listening time.':q.type==='swt'?'Read the passage and summarise it in one complete sentence. Write 5–75 words. You have 10 minutes.':'Write an essay of 200–300 words in response to the question below. Support your ideas with reasons and examples. You have 20 minutes.';
    root.innerHTML='<section class="exam"><header class="exam-header"><div><strong>IPT Brisbane · '+(sst?'Listening practice':'Writing sectional mock')+'</strong><small>'+esc(username)+' · '+esc(attempt.title)+'</small></div><div class="timer-wrap"><span>TIME REMAINING</span><strong id="timer">'+q.minutes+':00</strong></div></header><div class="exam-strip"><b>'+({swt:'Summarise Written Text',sst:'Summarise Spoken Text',essay:'Write Essay'}[q.type])+'</b><span>Question '+(attempt.index+1)+' of '+attempt.questions.length+'</span></div><div class="exam-main"><p class="instruction">'+instruction+'</p>'+
      (sst?'<div class="audio-panel"><h2>Audio recording</h2><div class="audio-meta"><span id="audio-status">Preparing audio…</span><span id="audio-time">0:00</span></div><progress id="audio-progress" value="0" max="100" aria-label="Recording progress"></progress><p class="muted">AI-generated narration · one play per attempt</p><button id="audio-start" class="primary" disabled>'+(attempt.status==='ready'?'Start recording & timer':'Continue recording')+'</button> <label class="meta">Volume <input id="audio-volume" type="range" min="0" max="1" step="0.05" value="1"></label></div><label class="answer-label" for="notes">My notes (not scored)</label><textarea id="notes" class="notes-area" spellcheck="false" placeholder="Note the main idea and supporting points…">'+esc(attempt.notes)+'</textarea>':'<div class="passage">'+esc(q.text)+'</div>')+
      '<label class="answer-label" for="answer">Your response</label><textarea id="answer" spellcheck="false" autocorrect="off" autocapitalize="off" autocomplete="off" '+(attempt.status==='ready'?'disabled':'')+'>'+esc(attempt.answers[attempt.index])+'</textarea><div class="editor-tools"><div class="clipboard"><button data-edit="cut">Cut</button><button data-edit="copy">Copy</button><button data-edit="paste">Paste</button></div><span>Total Word Count: <b id="word-count">'+count(attempt.answers[attempt.index])+'</b></span></div><p id="save-status" class="save-status">'+(attempt.status==='ready'?'The timer starts when you start the recording.':'Your answers are saved to your account as you write.')+'</p></div><footer class="exam-footer"><button class="secondary" data-leave="1">Exit</button><p>Check your response before continuing.</p><button id="next" class="primary" '+(attempt.status==='ready'?'disabled':'')+'>'+(attempt.index===attempt.questions.length-1?'Finish & submit':'Next →')+'</button></footer></section>';
    document.getElementById('answer').addEventListener('input',onInput);
    document.getElementById('notes')?.addEventListener('input',onInput);
    document.getElementById('next').onclick=nextQuestion;
    if(sst) setupAudio(q); else if(audio) audio.pause();
    timer=setInterval(tick,500); tick();
    root.focus(); window.scrollTo(0,0);
  }
  function onInput() {
    if(!attempt || attempt.status!=='active') return;
    attempt.revisions[attempt.index]++;
    document.getElementById('word-count').textContent=count(document.getElementById('answer').value);
    writeDraft(); clearTimeout(saveTimer); saveTimer=setTimeout(()=>saveAnswer(false),650);
  }
  function saveAnswer(next) {
    if(!attempt || attempt.status!=='active' || saveConflict) return Promise.resolve();
    const id=attempt.id,index=attempt.index,editor=document.getElementById('answer');
    if(!editor) return Promise.resolve();
    const body={index,text:editor.value,revision:++attempt.revisions[index],next,notes:document.getElementById('notes')?.value || ''};
    writeDraft();
    const task=saving.catch(()=>{}).then(async()=>{
      if(saveConflict && attempt?.id===id) return;
      const value=await api('/attempts/'+id+'/answer',body);
      if(attempt?.id!==id) return;
      if(value.index!==index || value.status==='submitted') {
        setAttempt(value); moving=false; showAttempt(); return;
      }
      offset=value.serverNow-Date.now();
      if(value.revisions[index]!==body.revision || value.answers[index]!==body.text) {
        saveConflict=true; moving=false;
        const status=document.getElementById('save-status');
        if(status) status.innerHTML='Another tab updated this answer. Your draft is kept on this device. <button class="secondary" id="keep-draft">Save my current draft</button>';
        const button=document.getElementById('next');if(button)button.disabled=true;
        document.getElementById('keep-draft')?.addEventListener('click',()=>{
          attempt.revisions[index]=Math.max(attempt.revisions[index],value.revisions[index]);saveConflict=false;
          document.getElementById('answer').readOnly=false;if(button)button.disabled=false;saveAnswer(false);
        });
        return;
      }
      if(body.revision>=attempt.revisions[index]) {
        const status=document.getElementById('save-status');
        if(status) status.textContent='Saved to your account';
      }
    });
    saving=task;
    return task.catch(e=>{
      const status=document.getElementById('save-status');
      if(status) status.textContent='Connection issue · answer kept on this device. Reconnecting…';
      if(next) throw e;
    });
  }
  async function nextQuestion() {
    if(moving || saveConflict || !attempt || attempt.status!=='active') return;
    const originalId=attempt.id, originalIndex=attempt.index;
    const text=document.getElementById('answer').value;
    const final=attempt.index===attempt.questions.length-1;
    if(!await confirmAction(final?'Finish this attempt?':'Submit this answer?',(text.trim()?'Your answer will be locked. ':'This answer is blank and will receive zero marks. ')+(final?'You can review scores and feedback after submission.':'You cannot return to this question.'),final?'Finish & submit':'Submit and continue')) return;
    // The timer may have advanced the question while the dialog was open.
    if(!attempt || attempt.status!=='active' || attempt.id!==originalId || attempt.index!==originalIndex) return;
    moving=true; clearTimeout(saveTimer);
    const button=document.getElementById('next'); button.disabled=true;
    document.getElementById('answer').readOnly=true;
    try { await saveAnswer(true); }
    catch(e) { notify(e.message); moving=false; if(button.isConnected) {button.disabled=false;document.getElementById('answer').readOnly=false;} }
  }
  async function tick() {
    if(!attempt || attempt.status!=='active') return;
    const remaining=Math.max(0,Math.ceil((attempt.deadline-Date.now()-offset)/1000));
    const timerNode=document.getElementById('timer');
    if(timerNode) { timerNode.textContent=clock(remaining); timerNode.parentElement.classList.toggle('warning',remaining<60); }
    if(remaining===0 && !expiryBusy) {
      expiryBusy=true; clearTimeout(saveTimer);
      const editor=document.getElementById('answer'); if(editor) editor.readOnly=true;
      const button=document.getElementById('next'); if(button) button.disabled=true;
      document.getElementById('confirm-dialog').close();
      try {
        const id=attempt.id; await saving.catch(()=>{});
        const value=await api('/attempts/'+id);
        if(attempt?.id===id) { setAttempt(value); moving=false; showAttempt(); notify('Time expired. Your last saved answer was submitted.'); }
      } catch(_) { const status=document.getElementById('save-status'); if(status) status.textContent='Time expired. Reconnecting to retrieve your submitted answer…'; }
      finally { expiryBusy=false; }
    }
  }
  function setupAudio(q) {
    const id=attempt.id, local=draft();
    if(audioAttempt!==id) {
      if(audio) audio.pause();
      audio=new Audio(q.audioUrl); audio.preload='auto'; audioAttempt=id; audioFinished=!!local?.audioFinished;
    }
    const startButton=document.getElementById('audio-start'),status=document.getElementById('audio-status');
    const update=()=>{
      if(attempt?.id!==id || !document.getElementById('audio-progress')) return;
      document.getElementById('audio-progress').value=audio.duration?audio.currentTime/audio.duration*100:0;
      document.getElementById('audio-time').textContent=clock(audio.currentTime)+' / '+clock(audio.duration||0);
    };
    audio.ontimeupdate=()=>{update(); if(attempt?.status==='active') {
      const old=draft(); if(old) storage.put(draftKey(),JSON.stringify({...old,audioTime:audio.currentTime,audioFinished}));
    }};
    const ready=()=>{
      if(attempt?.id!==id) return;
      if(local?.audioTime && audio.currentTime===0 && local.audioTime<audio.duration) audio.currentTime=local.audioTime;
      startButton.disabled=false;status.textContent=audioFinished?'Recording complete. Write your summary.':audio.paused?'Ready to play':'Playing…';
      if(audioFinished || !audio.paused) startButton.classList.add('hidden');
      update();
    };
    audio.onloadedmetadata=ready; if(audio.readyState>=1) ready();
    audio.onended=()=>{audioFinished=true;status.textContent='Recording complete. Write your summary.';startButton.classList.add('hidden');writeDraft();};
    audio.onerror=()=>{status.textContent='Audio could not load. Check your connection and retry.';startButton.textContent='Retry audio';startButton.disabled=false;startButton.classList.remove('hidden');};
    document.getElementById('audio-volume').oninput=e=>audio.volume=Number(e.target.value);
    startButton.onclick=async()=>{
      if(audio.error) { audio.load(); status.textContent='Loading audio…'; startButton.disabled=true; return; }
      startButton.disabled=true;
      try {
        // Resume audio from its saved position if the page was refreshed.
        if(attempt.status==='ready') {
          const value=await api('/attempts/'+id+'/begin');
          setAttempt(value);document.getElementById('answer').disabled=false;document.getElementById('next').disabled=false;
        }
        await audio.play();status.textContent='Playing…';startButton.classList.add('hidden');writeDraft();
      } catch(e) {startButton.disabled=false;startButton.textContent='Play recording';status.textContent='Press Play recording to continue.';notify(e.message);}
    };
  }
  function renderResults() {
    document.body.classList.remove('exam-mode'); clearInterval(timer);
    const scored=attempt.results.every(Boolean), total=attempt.results.reduce((n,r)=>n+(r?.total||0),0);
    const maximum=attempt.questions.reduce((n,q)=>n+(q.type==='swt'?9:q.type==='sst'?12:26),0);
    root.innerHTML='<section class="results"><div class="results-header"><div><p class="eyebrow" style="color:#287e8a">Attempt complete</p><h1>'+esc(attempt.title)+'</h1><p class="muted">'+new Date(attempt.startedAt).toLocaleString()+' · Saved to '+esc(username)+'</p></div><button class="secondary" data-tab="history">My attempts</button></div><div class="score-banner"><div class="score-total">'+(scored?total:'—')+'<small> / '+maximum+'</small></div><div><h2>Writing practice marks</h2><p>'+(scored?'Your task marks and feedback are ready.':'Your answers are submitted. Preparing your assessment…')+'</p><p>Independent AI assessment · not an official Pearson score</p></div></div><div id="scoring-status" class="scoring-status"></div>'+attempt.questions.map((q,i)=>reviewCard(q,i)).join('')+scoringNote()+'</section>';
    root.focus();
    if(!scored && !grading) scoreRemaining();
  }
  function reviewCard(q,i) {
    const r=attempt.results[i];
    return '<article class="review-card" id="review-'+i+'"><div class="review-top"><h2>'+(i+1)+'. '+esc(q.title)+'</h2><strong>'+(r?r.total+'/'+r.maximum:'Awaiting score')+'</strong></div><p class="muted">'+({swt:'Summarise Written Text',sst:'Summarise Spoken Text',essay:'Write Essay'}[q.type])+' · '+count(attempt.answers[i])+' words · '+esc(attempt.completed[i]?.reason||'Submitted')+'</p><h3>Your response</h3><div class="response">'+esc(attempt.answers[i]||'No answer submitted.')+'</div>'+
      (r? (r.gated?'<div class="gate"><b>No marks awarded for this response.</b> '+esc(r.reasons.join(' '))+'</div>':'')+'<table class="trait-table"><thead><tr><th>Criterion</th><th>Marks</th><th>Feedback</th></tr></thead><tbody>'+Object.keys(r.maxima).map(k=>'<tr><td>'+labels[k]+'</td><td>'+r.scores[k]+'/'+r.maxima[k]+'</td><td>'+esc(r.feedback[k]||(r.gated?'No further marks when Content or Form is zero.':''))+'</td></tr>').join('')+'</tbody></table>'+
      (r.strengths.length?'<h3>What worked well</h3><ul>'+r.strengths.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul>':'')+
      (r.improvements.length?'<h3>What to improve</h3><ul>'+r.improvements.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul>':'')+
      (r.errors.length?'<h3>Language corrections</h3><ul>'+r.errors.map(e=>'<li><b>'+esc(e.phrase)+'</b> → '+esc(e.correction)+'<br>'+esc(e.explanation)+'</li>').join('')+'</ul>':''):'')+
      '<details><summary>Review '+(q.type==='sst'?'recording, transcript and key points':'question and key points')+'</summary>'+(q.type==='sst'?'<p class="muted">AI-generated narration · replay available for review</p><audio controls src="'+esc(q.audioUrl)+'" preload="none"></audio>':'')+'<div class="response">'+esc(q.text)+'</div><ul>'+q.keyPoints.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul></details><details><summary>View sample '+(q.type==='essay'?'essay':'summary')+'</summary><p class="muted">One possible strong response. Other accurate answers can also earn high marks.</p><div class="response sample">'+esc(q.sample)+'</div><p class="muted">'+count(q.sample)+' words</p></details></article>';
  }
  async function scoreRemaining() {
    if(grading || !attempt) return;
    grading=true; const id=attempt.id, questionCount=attempt.questions.length;
    try {
      for(let i=0;i<questionCount;i++) {
        if(attempt?.id!==id) return;
        if(attempt.results[i]) continue;
        const status=document.getElementById('scoring-status');if(status) status.textContent='Assessing question '+(i+1)+' of '+attempt.questions.length+'… You can leave; your submitted answers are saved.';
        const result=await api('/attempts/'+id+'/score/'+i,{});
        if(attempt?.id!==id) return;
        attempt.results[i]=result; renderResults();
      }
    } catch(e) {
      const status=document.getElementById('scoring-status');
      if(status && attempt?.id===id) status.innerHTML=esc(e.message)+' <button class="secondary" id="retry-scores">Retry assessment</button>';
      document.getElementById('retry-scores')?.addEventListener('click',scoreRemaining);
    } finally { grading=false; }
  }
  async function edit(command) {
    const editor=document.getElementById('answer');if(!editor || editor.disabled || editor.readOnly) return;
    const start=editor.selectionStart,end=editor.selectionEnd;
    try {
      if(command==='paste') { const text=await navigator.clipboard.readText();editor.setRangeText(text,start,end,'end');onInput(); }
      else { await navigator.clipboard.writeText(editor.value.slice(start,end)); if(command==='cut') {editor.setRangeText('',start,end,'end');onInput();} }
      editor.focus();
    } catch(_) {notify('Use your keyboard shortcut for '+command+' (Ctrl or Command + '+({cut:'X',copy:'C',paste:'V'}[command])+').');editor.focus();}
  }
  root.addEventListener('click',async e=>{
    const b=e.target.closest('button'); if(!b) return;
    if(b.dataset.tab) return hub(b.dataset.tab);
    if(b.dataset.start) return start(b.dataset.start,b);
    if(b.dataset.resume) return resume(b.dataset.resume,b);
    if(b.dataset.edit) return edit(b.dataset.edit);
    if(b.dataset.leave && await confirmAction('Leave this attempt?','Your saved answers remain in My attempts. The timer continues while you are away.','Save and exit')) {
      await saveAnswer(false); hub(attempt?.kind==='sst'?'sst':'mocks');
    }
  });
  window.addEventListener('beforeunload',e=>{ if(attempt?.status==='active') {writeDraft();e.preventDefault();e.returnValue='';} });
  document.addEventListener('visibilitychange',()=>{if(document.hidden) {writeDraft();saveAnswer(false);} else tick();});
  window.addEventListener('online',()=>saveAnswer(false));
  window.addEventListener('storage',event=>{if(event.key==='pte_session_token') location.reload();});
  setInterval(()=>{if(attempt?.status==='active' && !moving) saveAnswer(false);},15000);
  (async()=>{
    try { const values=await Promise.all([api('/catalog'),api('/session')]); catalog=values[0];username=values[1].username;await hub(); }
    catch(e) {root.innerHTML='<div class="hub"><h1>Unable to load practice</h1><p>'+esc(e.message)+'</p><button class="primary" id="reload-lab">Retry</button></div>';document.getElementById('reload-lab').onclick=()=>location.reload();}
  })();
})();
