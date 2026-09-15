(function () {
  'use strict';
  const root = document.getElementById('lab');
  const report = window.WritingLabReport;
  const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const count = text => text.trim().split(/\s+/).filter(Boolean).length;
  const clock = seconds => Math.floor(Math.max(0,seconds)/60)+':'+String(Math.floor(Math.max(0,seconds)%60)).padStart(2,'0');
  const labels = {content:'Content',form:'Form',grammar:'Grammar',vocabulary:'Vocabulary',spelling:'Spelling',linguistic:'General linguistic range',coherence:'Development, structure & coherence'};
  const source = 'https://www.pearsonpte.com/content/dam/ELL/pte/pearsonpte/pdfs/pte-academic-pdfs/PTE-Academic-Test-Taker-Score-Guide.pdf';
  let catalog, username, attempt = null, view = location.pathname === '/spoken-text' ? 'sst' : 'mocks', requestedView = view;
  let timer, saveTimer, noticeTimer, offset = 0, saving = Promise.resolve(), moving = false, expiryBusy = false, saveConflict = false;
  const grading = new Set();
  let audio = null, audioAttempt = null, audioFinished = false, audioCountdown, audioSaveAt = 0;
  const questionKey = () => attempt ? attempt.id + ':' + attempt.index + ':' + attempt.questions[attempt.index].id : '';
  const audioQuestion = q => ['sst','wfd'].includes(q.type);
  function stopAudio() { clearInterval(audioCountdown); if(audio) audio.pause(); }
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
      at:Date.now()+offset,audioTime:audioAttempt===questionKey()?audio?.currentTime||0:0,audioFinished:audioAttempt===questionKey()&&audioFinished};
    const saved=storage.put(draftKey(),JSON.stringify(value));
    const status=document.getElementById('save-status');
    if(status && !saveConflict) status.textContent=saved?'Saved on this device · syncing…':'Device saving unavailable · syncing to your account…';
  }
  function draft() { try { return JSON.parse(storage.get(draftKey())||'null'); } catch(_) { return null; } }
  function scoringNote() { return '<div class="note"><p><b>About your score.</b> Your Writing practice estimate is shown out of 90. Summaries and essays receive AI feedback using the task criteria in <a href="'+source+'" target="_blank" rel="noopener">Pearson’s score guide</a>; dictation is checked word by word.</p><details><summary>How the estimate is calculated</summary><p>We combine the marks earned across this attempt, then calculate 10 + 80 × (marks earned ÷ marks available), rounded to a whole number. The same method is used for each task breakdown. Missing assessments stay pending. This is an independent practice scale, not an official Pearson score or a calibrated prediction of your exam result.</p><p>Each new mock contains SWT, an essay, SST and dictation. The three dictation sentences share a four-minute practice allocation; the full exam uses the remaining Listening section time.</p></details></div>'; }
  async function hub(tab=view) {
    requestedView=tab;
    clearInterval(timer); clearTimeout(saveTimer);
    stopAudio();
    document.body.classList.remove('exam-mode');
    attempt=null; view=tab;
    const auth=username?'':'<div class="auth-note"><a href="/">Sign in to your existing account</a>, then open Writing sectional mocks or Summarise spoken text from the sidebar.</div>';
    let content='';
    if(tab==='history') {
      content='<h1>My attempts</h1><p class="muted">Resume an unfinished attempt or review your saved feedback.</p><div id="history-list" class="history-list"><p>Loading attempts…</p></div>';
    } else if(tab==='mocks') {
      content='<section class="hero"><div><p class="eyebrow">PTE Academic · Writing practice</p><h1>Your next exam rehearsal.</h1><p>Practise written and spoken summaries, essay writing and dictation in one timed mock. Get detailed feedback and a Writing practice estimate out of 90.</p></div><div class="hero-metric"><strong>'+catalog.mocks[0].minutes+'</strong><span>MINUTES PER MOCK</span></div></section>'+auth+
        '<div class="section-heading"><h2>Choose your mock</h2><span class="muted">'+catalog.mocks.length+' papers · '+catalog.mocks[0].questionCount+' questions each</span></div><div class="cards">'+catalog.mocks.map((m,i)=>'<article class="card"><span class="tag">Mock '+String(i+1).padStart(2,'0')+'</span><h2>'+esc(m.title)+'</h2><p>'+esc(m.description)+'</p><div class="rules task-rules">'+m.tasks.map(t=>'<span><b>'+t.count+' × '+esc(t.label)+'</b>'+t.minutes+' minutes'+(t.shared?' shared':t.count>1?' each':'')+'</span>').join('')+'</div><div class="card-footer"><span class="meta">Writing estimate /90</span><button class="primary" data-start="'+m.id+'">Start mock '+(i+1)+' →</button></div></article>').join('')+'</div><div class="rules"><span><b>One question at a time</b>Submitted answers are locked.</span><span><b>No pause</b>The clock continues if you leave.</span><span><b>Automatic submission</b>Saved answers submit when time expires.</span></div>'+scoringNote();
    } else {
      content='<section class="hero"><div><p class="eyebrow">PTE Academic · Listening & writing</p><h1>Listen. Connect. Summarise.</h1><p>Practise with five original short lectures. Listen once, take notes and write a clear summary of 50–70 words.</p></div><div class="hero-metric"><strong>05</strong><span>LISTENING EXERCISES</span></div></section>'+auth+
        '<div class="section-heading"><h2>Summarise Spoken Text</h2><span class="muted">10 minutes per question</span></div><div class="cards">'+catalog.spoken.map((q,i)=>'<article class="card"><span class="tag">'+String(i+1).padStart(2,'0')+' · '+esc(q.topic)+'</span><h2>'+esc(q.title)+'</h2><p>Listen to a short lecture, then summarise its central idea and essential supporting points.</p><div class="card-footer"><span class="meta">50–70 words · estimate /90</span><button class="primary" data-start="'+q.id+'">Practise →</button></div></article>').join('')+'</div><div class="note">Original practice material with AI-generated narration. Audio plays once per attempt; the transcript and sample summary appear after submission. Choose <b>Reattempt this question</b> on the results screen whenever you want another try. The 10-minute timer includes listening time.</div>'+scoringNote();
    }
    root.innerHTML='<div class="hub"><nav class="tabs" aria-label="Practice sections"><button data-tab="mocks" class="'+(tab==='mocks'?'selected':'')+'">Writing mocks</button><button data-tab="sst" class="'+(tab==='sst'?'selected':'')+'">Spoken text practice</button><button data-tab="history" class="'+(tab==='history'?'selected':'')+'">My attempts</button></nav>'+content+'</div>';
    if(tab==='history') {
      const target=document.getElementById('history-list');
      if(!username) { target.innerHTML=auth; return; }
      try {
        const history=await api('/attempts');
        if(!target.isConnected) return;
        target.innerHTML=history.length?history.map(a=>'<article class="history-row"><div><b>'+esc(a.title)+'</b><p class="muted">'+new Date(a.startedAt).toLocaleString()+' · '+(a.status==='submitted'?(a.score90==null?'Submitted · feedback pending':a.score90+'/90 · practice estimate'):'In progress · '+a.completed+'/'+a.questions+' submitted')+'</p></div><button class="secondary" data-resume="'+a.id+'">'+(a.status==='submitted'?'Review':'Resume')+'</button></article>').join(''):'<p class="empty">Your attempts will appear here after you start practising.</p>';
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
    const mock=catalog.mocks.find(m=>m.id===testId);
    if(mock && !await confirmAction('Ready to begin?','This mock includes 2 written summaries, 1 essay, 1 spoken summary and 3 dictation sentences. Allow '+mock.minutes+' minutes and check your audio volume. Dictation shares one four-minute timer. You cannot return to submitted questions; the timer continues if you leave.','Begin '+mock.minutes+'-minute mock')) return;
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
  async function reattempt(testId,button) {
    if(!username || !testId) return;
    button.disabled=true;
    try {
      // A new UUID keeps the completed attempt and its feedback in My attempts.
      setAttempt(await api('/attempts',{id:crypto.randomUUID(),testId}));
      showAttempt();
    } catch(e) { notify(e.message); button.disabled=false; }
  }
  function showAttempt() {
    clearInterval(timer); clearTimeout(saveTimer);
    if(attempt.status==='submitted') { stopAudio(); storage.remove(draftKey()); renderResults(); return; }
    document.body.classList.add('exam-mode');
    const q=attempt.questions[attempt.index], sst=q.type==='sst', listening=audioQuestion(q);
    const instruction=q.type==='wfd'?'Listen to the sentence once and type exactly what you hear. Check your spelling and word order. The dictation questions share the remaining time shown above.':sst?'Listen to the recording and write a summary of 50–70 words. You have 10 minutes in total, including listening time.':q.type==='swt'?'Read the passage and summarise it in one complete sentence. Write 5–75 words. You have 10 minutes.':'Write an essay of 200–300 words in response to the question below. Support your ideas with reasons and examples. You have 20 minutes.';
    root.innerHTML='<section class="exam"><header class="exam-header"><div><strong>IPT Brisbane · '+(attempt.kind==='mock'?'Writing sectional mock':'Listening practice')+'</strong><small>'+esc(username)+' · '+esc(attempt.title)+'</small></div><div class="timer-wrap"><span>'+(q.timeGroup?'DICTATION TIME REMAINING':'TIME REMAINING')+'</span><strong id="timer">'+q.minutes+':00</strong></div></header><div class="exam-strip"><b>'+report.labels[q.type]+'</b><span>Question '+(attempt.index+1)+' of '+attempt.questions.length+'</span></div><div class="exam-main"><p class="instruction">'+instruction+'</p>'+
      (listening?'<div class="audio-panel"><h2>Audio recording</h2><div class="audio-meta"><span id="audio-status">Preparing audio…</span><span id="audio-time">0:00</span></div><progress id="audio-progress" value="0" max="100" aria-label="Recording progress"></progress><p class="muted">AI-generated narration · one play per question</p><button id="audio-start" class="primary" disabled>'+(attempt.status==='ready'?'Start recording & timer':'Play recording')+'</button> <label class="meta">Volume <input id="audio-volume" type="range" min="0" max="1" step="0.05" value="1"></label></div><label class="answer-label" for="notes">My notes (not scored)</label><textarea id="notes" class="notes-area" spellcheck="false" placeholder="Take notes while you listen…">'+esc(attempt.notes)+'</textarea>':'<div class="passage">'+esc(q.text)+'</div>')+
      '<label class="answer-label" for="answer">Your response</label><textarea id="answer" spellcheck="false" autocorrect="off" autocapitalize="off" autocomplete="off" '+(attempt.status==='ready'?'disabled':'')+'>'+esc(attempt.answers[attempt.index])+'</textarea><div class="editor-tools"><div class="clipboard"><button data-edit="cut">Cut</button><button data-edit="copy">Copy</button><button data-edit="paste">Paste</button></div><span>Total Word Count: <b id="word-count">'+count(attempt.answers[attempt.index])+'</b></span></div><p id="save-status" class="save-status">'+(attempt.status==='ready'?'The timer starts when you start the recording.':'Your answers are saved to your account as you write.')+'</p></div><footer class="exam-footer"><button class="secondary" data-leave="1">Exit</button><p>Check your response before continuing.</p><button id="next" class="primary" '+(attempt.status==='ready'?'disabled':'')+'>'+(attempt.index===attempt.questions.length-1?'Finish & submit':'Next →')+'</button></footer></section>';
    document.getElementById('answer').addEventListener('input',onInput);
    document.getElementById('notes')?.addEventListener('input',onInput);
    document.getElementById('next').onclick=nextQuestion;
    if(listening) setupAudio(q); else stopAudio();
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
    const body={index,text:editor.value,revision:++attempt.revisions[index],next,notes:document.getElementById('notes')?.value || '',
      ...(audioAttempt===questionKey()?{playback:{position:audio?.currentTime||0,finished:audioFinished}}:{})};
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
      stopAudio();
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
    const id=attempt.id, index=attempt.index, key=questionKey();
    const savedDraft=draft(), local=savedDraft?.index===index?savedDraft:null;
    const saved=attempt.playback?.[index];
    if(audioAttempt!==key) {
      stopAudio();
      audio=new Audio(q.audioUrl); audio.preload='auto'; audioAttempt=key; audioSaveAt=0;
      audioFinished=(!!saved?.finished && saved.position>0) || (!!local?.audioFinished && local.audioTime>0);
    }
    const player=audio, startButton=document.getElementById('audio-start'), status=document.getElementById('audio-status');
    const current=()=>attempt?.id===id && attempt.index===index && attempt.status!=='submitted' && audioAttempt===key && status.isConnected;
    const completeText=q.type==='wfd'?'Recording complete. Check your sentence.':'Recording complete. Write your summary.';
    let prepared=false, starting=false, resumePosition=Math.max(local?.audioTime||0,saved?.position||0);
    const update=()=>{
      if(!current()) return;
      document.getElementById('audio-progress').value=player.duration?player.currentTime/player.duration*100:0;
      document.getElementById('audio-time').textContent=clock(player.currentTime)+' / '+clock(player.duration||0);
    };
    const play=async()=>{
      clearInterval(audioCountdown);
      if(!current() || audioFinished || document.hidden || starting) return;
      if(player.error) { resumePosition=Math.max(resumePosition,player.currentTime||0); player.load(); status.textContent='Loading audio…'; startButton.disabled=true; return; }
      if(attempt.status==='active' && attempt.deadline<=Date.now()+offset) { tick(); return; }
      starting=true;
      startButton.disabled=true;
      let phase='playback';
      try {
        // Call play directly in the click handler, before a network await loses
        // Safari's user gesture. A blocked play must not start the SST timer.
        await player.play();
        if(!current() || document.hidden) { player.pause(); return; }
        if(attempt.status==='ready') {
          phase='attempt';
          status.textContent='Starting your attempt…';
          const value=await api('/attempts/'+id+'/begin',{});
          if(!current()) { player.pause(); return; }
          setAttempt(value);
          if(attempt.status!=='active') { player.pause(); showAttempt(); return; }
          document.getElementById('answer').disabled=false; document.getElementById('next').disabled=false;
        }
        if(!current() || attempt.deadline<=Date.now()+offset || document.hidden) { player.pause(); if(current()) tick(); return; }
        status.textContent='Playing…'; startButton.classList.add('hidden'); writeDraft(); saveAnswer(false);
      } catch(e) {
        player.pause();
        if(!current()) return;
        startButton.disabled=false; startButton.classList.remove('hidden'); startButton.textContent='Play recording';
        status.textContent=phase==='attempt' ? e.message+' Press Play recording to retry.' : 'Press Play recording to allow audio and continue.';
      } finally { starting=false; }
    };
    player.ontimeupdate=()=>{
      if(!current()) return;
      update(); writeDraft();
      if(Date.now()-audioSaveAt>5000) { audioSaveAt=Date.now(); saveAnswer(false); }
    };
    const ready=()=>{
      if(!current()) return;
      const position=resumePosition;
      if(position && player.currentTime<position) player.currentTime=Math.min(position,player.duration||position);
      if(audioFinished) { status.textContent=completeText; startButton.classList.add('hidden'); update(); return; }
      startButton.disabled=starting; status.textContent=player.paused?'Ready to play':'Playing…';
      startButton.textContent=attempt.status==='ready'?'Start recording & timer':player.currentTime>0?'Continue recording':'Play recording';
      if(!player.paused) startButton.classList.add('hidden');
      update();
      if(!prepared && attempt.kind==='mock' && attempt.status==='active' && player.currentTime===0 && !document.hidden) {
        let remaining=3;
        status.textContent='Recording starts in '+remaining+'…';
        clearInterval(audioCountdown);
        audioCountdown=setInterval(()=>{
          if(!current() || document.hidden) { clearInterval(audioCountdown); return; }
          if(--remaining<=0) { clearInterval(audioCountdown); play(); }
          else status.textContent='Recording starts in '+remaining+'…';
        },1000);
      }
      prepared=true;
    };
    player.onloadedmetadata=update;
    player.oncanplay=ready; if(player.readyState>=3) ready();
    player.onended=()=>{
      if(!current()) return;
      audioFinished=true; status.textContent=completeText; startButton.classList.add('hidden'); writeDraft(); saveAnswer(false);
    };
    player.onpause=()=>{
      if(!current() || audioFinished || player.ended) return;
      startButton.disabled=false; startButton.classList.remove('hidden'); startButton.textContent='Continue recording';
      status.textContent='Press Continue recording to resume from your saved position.';
    };
    player.onerror=()=>{
      if(!current()) return;
      clearInterval(audioCountdown);
      if(audioFinished) { status.textContent=completeText; startButton.classList.add('hidden'); return; }
      resumePosition=Math.max(resumePosition,player.currentTime||0);
      status.textContent='Audio could not load. Check your connection and retry.';
      startButton.textContent='Retry audio'; startButton.disabled=false; startButton.classList.remove('hidden');
    };
    document.getElementById('audio-volume').oninput=e=>player.volume=Number(e.target.value);
    startButton.onclick=play;
  }
  function renderResults() {
    document.body.classList.remove('exam-mode'); clearInterval(timer);
    const summary=report.summarize(attempt.questions,attempt.results), scored=summary.complete;
    const retry=attempt.kind==='sst' && attempt.questions[0]?.type==='sst' ? '<button class="primary" data-reattempt="'+esc(attempt.testId)+'">Reattempt this question</button>' : '';
    root.innerHTML='<section class="results"><div class="results-header"><div><p class="eyebrow" style="color:#287e8a">Attempt complete</p><h1>'+esc(attempt.title)+'</h1><p class="muted">'+new Date(attempt.startedAt).toLocaleString()+' · Saved to '+esc(username)+'</p></div><div class="results-actions"><button class="secondary" data-tab="history">My attempts</button>'+retry+'</div></div><div class="score-banner"><div class="score-total">'+(scored?summary.score90:'—')+'<small> / 90</small></div><div><h2>Writing practice estimate</h2><p>'+(scored?'Your score and detailed feedback are ready.':'Your answers are submitted. Preparing your assessment…')+'</p><p>Independent practice estimate · not an official Pearson score</p></div></div><div class="task-scores">'+summary.byType.map(g=>'<div class="task-score"><span>'+esc(g.label)+'</span><strong>'+(g.score90==null?'—':g.score90)+'<small> /90</small></strong><small>'+g.count+' question'+(g.count===1?'':'s')+' · '+(g.score90==null?'Feedback pending':g.total+'/'+g.maximum+' raw marks')+'</small></div>').join('')+'</div><div id="scoring-status" class="scoring-status"></div>'+attempt.questions.map((q,i)=>reviewCard(q,i)).join('')+scoringNote()+'</section>';
    root.focus();
    if(!scored && !grading.has(attempt.id)) scoreRemaining();
  }
  function reviewCard(q,i) {
    const r=attempt.results[i], listening=audioQuestion(q), dictation=q.type==='wfd';
    return '<article class="review-card" id="review-'+i+'"><div class="review-top"><h2>'+(i+1)+'. '+esc(q.title)+'</h2><strong>'+(r?report.score90(r.total,r.maximum)+'/90':'Awaiting score')+'</strong></div><p class="muted">'+report.labels[q.type]+' · '+count(attempt.answers[i])+' words · '+esc(attempt.completed[i]?.reason||'Submitted')+(r?' · '+r.total+'/'+r.maximum+' raw marks':'')+'</p><h3>Your response</h3><div class="response">'+esc(attempt.answers[i]||'No answer submitted.')+'</div>'+
      (r? (r.gated?'<div class="gate"><b>No marks awarded for this response.</b> '+esc(r.reasons.join(' '))+'</div>':'')+
      (dictation&&r.wordFeedback?'<h3>Sentence check</h3><p class="muted">Green = correct · underlined = missing, misspelled or out of order</p><div class="word-feedback">'+r.wordFeedback.map(w=>'<span class="'+(w.correct?'word-correct':'word-missed')+'">'+esc(w.word)+'</span>').join(' ')+'</div>':'')+
      '<table class="trait-table"><thead><tr><th>Criterion</th><th>Marks</th><th>Feedback</th></tr></thead><tbody>'+Object.keys(r.maxima).map(k=>'<tr><td>'+labels[k]+'</td><td>'+r.scores[k]+'/'+r.maxima[k]+'</td><td>'+esc(r.feedback[k]||(r.gated?'No further marks when Content or Form is zero.':''))+'</td></tr>').join('')+'</tbody></table>'+
      (r.strengths.length?'<h3>What worked well</h3><ul>'+r.strengths.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul>':'')+
      (r.improvements.length?'<h3>What to improve</h3><ul>'+r.improvements.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul>':'')+
      (r.errors.length?'<h3>Language corrections</h3><ul>'+r.errors.map(e=>'<li><b>'+esc(e.phrase)+'</b> → '+esc(e.correction)+'<br>'+esc(e.explanation)+'</li>').join('')+'</ul>':''):'')+
      '<details><summary>Review '+(listening?'recording, transcript and key points':'question and key points')+'</summary>'+(listening?'<p class="muted">AI-generated narration · replay available for review</p><audio controls src="'+esc(q.audioUrl)+'" preload="none"></audio>':'')+'<div class="response">'+esc(q.text)+'</div><ul>'+q.keyPoints.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul></details><details><summary>'+(dictation?'View correct sentence':'View sample '+(q.type==='essay'?'essay':'summary'))+'</summary>'+(dictation?'':'<p class="muted">One possible strong response. Other accurate answers can also earn high marks.</p>')+'<div class="response sample">'+esc(q.sample)+'</div><p class="muted">'+count(q.sample)+' words</p></details></article>';
  }
  async function scoreRemaining() {
    if(!attempt || grading.has(attempt.id)) return;
    const id=attempt.id, questionCount=attempt.questions.length;
    grading.add(id); let failed=false;
    try {
      for(let i=0;i<questionCount;i++) {
        if(attempt?.id!==id) return;
        if(attempt.results[i]) continue;
        const status=document.getElementById('scoring-status');
        if(status) status.textContent='Assessing question '+(i+1)+' of '+questionCount+'… You can leave; your submitted answers are saved.';
        try {
          const result=await api('/attempts/'+id+'/score/'+i,{});
          if(attempt?.id!==id) return;
          attempt.results[i]=result; renderResults();
        } catch(e) { failed=true; }
      }
      if(failed && attempt?.id===id) {
        const status=document.getElementById('scoring-status');
        if(status) status.innerHTML='Some assessments are still pending. Your completed marks and answers are saved. <button class="secondary" id="retry-scores">Retry assessment</button>';
        document.getElementById('retry-scores')?.addEventListener('click',scoreRemaining);
      }
    } finally { grading.delete(id); }
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
  window.addEventListener('message',e=>{
    if(e.source!==window.parent || e.origin!==location.origin || !e.data || e.data.type!=='writing-lab-tab') return;
    const tab=e.data.tab==='sst'?'sst':'mocks'; requestedView=tab;
    if(!catalog) return;
    if(attempt?.status==='active') {
      if((attempt.kind==='sst'?'sst':'mocks')!==tab) notify('Your current attempt is still open. Its timer continues while you are away.');
      return;
    }
    hub(tab);
  });
  root.addEventListener('click',async e=>{
    const b=e.target.closest('button'); if(!b) return;
    if(b.dataset.tab) return hub(b.dataset.tab);
    if(b.dataset.start) return start(b.dataset.start,b);
    if(b.dataset.reattempt) return reattempt(b.dataset.reattempt,b);
    if(b.dataset.resume) return resume(b.dataset.resume,b);
    if(b.dataset.edit) return edit(b.dataset.edit);
    if(b.dataset.leave && await confirmAction('Leave this attempt?','Your saved answers remain in My attempts. The timer continues while you are away.','Save and exit')) {
      await saveAnswer(false); hub(attempt?.kind==='sst'?'sst':'mocks');
    }
  });
  window.addEventListener('beforeunload',e=>{ if(attempt?.status==='active') {writeDraft();e.preventDefault();e.returnValue='';} });
  document.addEventListener('visibilitychange',()=>{if(document.hidden) {stopAudio();writeDraft();saveAnswer(false);} else tick();});
  window.addEventListener('online',()=>saveAnswer(false));
  window.addEventListener('storage',event=>{if(event.key==='pte_session_token') location.reload();});
  setInterval(()=>{if(attempt?.status==='active' && !moving) saveAnswer(false);},15000);
  (async()=>{
    try { const values=await Promise.all([api('/catalog'),api('/session')]); catalog=values[0];username=values[1].username;await hub(requestedView); }
    catch(e) {root.innerHTML='<div class="hub"><h1>Unable to load practice</h1><p>'+esc(e.message)+'</p><button class="primary" id="reload-lab">Retry</button></div>';document.getElementById('reload-lab').onclick=()=>location.reload();}
  })();
})();
