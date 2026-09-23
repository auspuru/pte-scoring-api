(function () {
  'use strict';
  const root = document.getElementById('lab');
  const report = window.WritingLabReport;
  const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const count = text => text.trim().split(/\s+/).filter(Boolean).length;
  const clock = seconds => Math.floor(Math.max(0,seconds)/60)+':'+String(Math.floor(Math.max(0,seconds)%60)).padStart(2,'0');
  const labels = {content:'Content',form:'Form',grammar:'Grammar',vocabulary:'Vocabulary',spelling:'Spelling',linguistic:'General linguistic range',coherence:'Development, structure & coherence'};
  let libraryPage=0;
  let catalog, username, attempt = null, view = location.pathname === '/spoken-text' ? 'sst' : 'mocks', requestedView = view;
  let workspaceVisible = true, navigationSerial = 0, pendingRequest = null, handledRequest = null, historyKind = 'mock';
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
  function returnToPortal(section) {
    if (window.parent !== window) window.parent.postMessage({ type: 'writing-lab-navigate', section }, location.origin);
    else location.href = '/#/' + (section === 'practice-hub' ? 'practice' : 'mock-tests');
  }
  async function hub(tab=view) {
    if(tab!==view)libraryPage=0;
    requestedView=tab;
    if(tab !== 'history') historyKind=tab === 'mocks' ? 'mock' : tab;
    clearInterval(timer); clearTimeout(saveTimer); stopAudio();
    document.body.classList.remove('exam-mode');
    attempt=null; view=tab;
    const destination=historyKind==='mock'?'mock-tests':'practice-hub';
    const back='<button class="secondary" data-portal="'+destination+'">← '+(destination==='mock-tests'?'Mock Tests':'Practice')+'</button>';
    const auth=username?'':'<p class="auth-note">Sign in to your existing workspace account to practise.</p>';
    let content='';
    if(tab==='history') {
      content='<h1>'+(historyKind==='mock'?'Writing mock attempts':historyKind==='wfd'?'Dictation attempts':'Spoken text attempts')+'</h1><p class="muted">Resume an attempt or review saved feedback.</p><div id="history-list" class="history-list"><p>Loading attempts…</p></div>';
    } else if(tab==='mocks') {
      content='<h1>Writing sectional mock</h1><p>Choose a paper in Mock Tests, or resume a saved attempt below.</p><button class="secondary" data-tab="history">Saved mock attempts</button>';
    } else {
      const dictation=tab==='wfd', questions=dictation?(catalog.dictation||[]):catalog.spoken;
      libraryPage=Math.min(libraryPage,Math.max(0,Math.ceil(questions.length/12)-1));
      content='<div class="section-heading"><div><p class="eyebrow">Listening Practice</p><h1>'+(dictation?'Write From Dictation':'Summarise Spoken Text')+'</h1><p class="muted">'+(dictation?'Listen to a sentence and type exactly what you hear.':'Listen to a short lecture and write a summary of 50–70 words.')+'</p></div><button class="secondary" data-tab="history">My attempts</button></div>'+auth
        +'<div class="cards">'+questions.slice(libraryPage*12,libraryPage*12+12).map((q,i)=>'<article class="card"><h2>Question '+(libraryPage*12+i+1)+'</h2><div class="card-footer"><span class="meta">'+q.minutes+' minutes</span><button class="primary" data-start="'+esc(q.id)+'">Practise →</button></div></article>').join('')+'</div><nav class="exam-footer" aria-label="Question pages"><button class="secondary" data-library-page="'+(libraryPage-1)+'" '+(libraryPage===0?'disabled':'')+'>Back</button><span>'+ (libraryPage+1)+' / '+Math.max(1,Math.ceil(questions.length/12))+'</span><button class="secondary" data-library-page="'+(libraryPage+1)+'" '+((libraryPage+1)*12>=questions.length?'disabled':'')+'>Next</button></nav>';
    }
    root.innerHTML='<div class="hub"><div class="section-heading">'+back+'</div>'+content+'</div>';
    if(tab==='history') {
      const target=document.getElementById('history-list');
      if(!username) { target.innerHTML=auth; return; }
      try {
        const all=await api('/attempts');
        if(!target.isConnected) return;
        const history=all.filter(a=>a.kind===historyKind);
        target.innerHTML=history.length?history.map(a=>'<article class="history-row"><div><b>'+esc(a.title)+'</b><p class="muted">'+new Date(a.startedAt).toLocaleString()+' · '+(a.status==='submitted'?(a.score90==null?'Submitted · feedback pending':a.score90+'/90 · practice estimate'):'In progress · '+a.completed+'/'+a.questions+' submitted')+'</p></div><button class="secondary" data-resume="'+a.id+'">'+(a.status==='submitted'?'Review':'Resume')+'</button></article>').join(''):'<p class="empty">Your attempts will appear here after you start.</p>';
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
  async function start(testId, button, serial=navigationSerial) {
    if(!username) { notify('Sign in from your workspace first. Your existing account works here.'); return; }
    const mock=catalog.mocks.find(m=>m.id===testId);
    if(mock && !await confirmAction('Ready to begin?','Allow '+mock.minutes+' minutes. The timer continues if you leave.','Begin '+mock.minutes+'-minute mock')) return;
    if (serial!==navigationSerial || !workspaceVisible) return;
    button.disabled=true;
    try {
      const started=await api('/attempts',{id:crypto.randomUUID(),testId});
      if (serial!==navigationSerial || !workspaceVisible) return;
      setAttempt(started);
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
      historyKind=attempt.kind;
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
  function questionPosition() {
    const questions=catalog&&(attempt.kind==='sst'?catalog.spoken:attempt.kind==='wfd'?catalog.dictation:null);
    const index=questions?questions.findIndex(q=>q.id===attempt.testId):attempt.index;
    return 'Question '+(index+1)+' of '+(questions?questions.length:attempt.questions.length);
  }
  function showAttempt() {
    clearInterval(timer); clearTimeout(saveTimer);
    if(attempt.status==='submitted') { stopAudio(); storage.remove(draftKey()); renderResults(); return; }
    document.body.classList.add('exam-mode');
    const q=attempt.questions[attempt.index], sst=q.type==='sst', listening=audioQuestion(q);
    const instruction=q.type==='wfd'?'Listen and type the sentence.' :sst?'Listen and write a summary of 50–70 words.':q.type==='swt'?'Summarise the passage in one sentence of 5–75 words.':'Write an essay of 200–300 words.';
    root.innerHTML='<section class="exam"><header class="exam-header"><div><strong>IPT Brisbane · '+(attempt.kind==='mock'?'Writing sectional mock':'Listening practice')+'</strong><small>'+esc(username)+'</small></div><div class="timer-wrap"><span>'+(q.timeGroup?'DICTATION TIME REMAINING':'TIME REMAINING')+'</span><strong id="timer">'+q.minutes+':00</strong></div></header><div class="exam-strip"><b>'+report.labels[q.type]+'</b><span>'+questionPosition()+'</span></div><div class="exam-main"><p class="instruction">'+instruction+'</p>'+
      (listening?'<div class="audio-panel"><h2>Audio recording</h2><div class="audio-meta"><span id="audio-status">Preparing audio…</span><span id="audio-time">0:00</span></div><progress id="audio-progress" value="0" max="100" aria-label="Recording progress"></progress><button id="audio-start" class="primary" disabled>'+(attempt.status==='ready'?'Play':'Play')+'</button> <label class="meta">Volume <input id="audio-volume" type="range" min="0" max="1" step="0.05" value="1"></label></div><details><summary>Notes</summary><label class="answer-label" for="notes">Notes</label><textarea id="notes" class="notes-area" spellcheck="false" placeholder="Take notes while you listen…">'+esc(attempt.notes)+'</textarea></details>':'<div class="passage">'+esc(q.text)+'</div>')+
      '<label class="answer-label" for="answer">Your response</label><textarea id="answer" spellcheck="false" autocorrect="off" autocapitalize="off" autocomplete="off" '+(attempt.status==='ready'?'disabled':'')+'>'+esc(attempt.answers[attempt.index])+'</textarea><div class="editor-tools"><div class="clipboard"><button data-edit="cut">Cut</button><button data-edit="copy">Copy</button><button data-edit="paste">Paste</button></div><span>Words: <b id="word-count">'+count(attempt.answers[attempt.index])+'</b></span></div><p id="save-status" class="save-status">'+(attempt.status==='ready'?'Ready':'Saved automatically')+'</p></div><footer class="exam-footer"><button class="secondary" data-leave="1">Exit</button><button id="next" class="primary" '+(attempt.status==='ready'?'disabled':'')+'>'+(attempt.index===attempt.questions.length-1?'Submit':'Next →')+'</button></footer>'+practiceNavigation()+'</section>';
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
        setAttempt(value); moving=false; showAttempt();
        if(value.status==='submitted'&&typeof window!=='undefined'&&typeof window.CustomEvent==='function')window.dispatchEvent(new window.CustomEvent('pte:attempt-completed',{detail:{engine:'writing-lab',testId:value.testId}}));
        return;
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
    if(attempt.kind==='mock'&&!await confirmAction(final?'Finish this attempt?':'Submit this answer?',(text.trim()?'Your answer will be locked. ':'This answer is blank and will receive zero marks. ')+(final?'You can review scores and feedback after submission.':'You cannot return to this question.'),final?'Finish & submit':'Submit and continue')) return;
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
        startButton.disabled=false; startButton.classList.remove('hidden'); startButton.textContent='Play';
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
      startButton.textContent=attempt.status==='ready'?'Play':player.currentTime>0?'Continue recording':'Play';
      if(!player.paused) startButton.classList.add('hidden');
      update();
      if(!prepared && attempt.kind==='mock' && attempt.status==='active' && player.currentTime===0 && !document.hidden && workspaceVisible) {
        let remaining=3;
        status.textContent='Recording starts in '+remaining+'…';
        clearInterval(audioCountdown);
        audioCountdown=setInterval(()=>{
          if(!current() || document.hidden || !workspaceVisible) { clearInterval(audioCountdown); return; }
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
  function practiceNavigation() {
    if(!catalog||!attempt||!['sst','wfd'].includes(attempt.kind))return '';
    const questions=attempt.kind==='sst'?catalog.spoken:catalog.dictation,index=questions.findIndex(q=>q.id===attempt.testId);
    return '<nav class="exam-footer" aria-label="Practice questions"><button class="secondary" data-practice-move="-1" '+(index<=0?'disabled':'')+'>← Back</button><span>Question '+(index+1)+' of '+questions.length+'</span><button class="secondary" data-practice-move="1" '+(index>=questions.length-1?'disabled':'')+'>Next →</button></nav>';
  }
  async function movePractice(direction,button) {
    if(moving||saveConflict||!attempt)return;
    const questions=attempt.kind==='sst'?catalog.spoken:catalog.dictation,index=questions.findIndex(q=>q.id===attempt.testId),target=questions[index+direction];
    if(!target)return;
    const serial=navigationSerial;moving=true;button.disabled=true;clearTimeout(saveTimer);stopAudio();writeDraft();
    try {await saveAnswer(false);await saving;if(saveConflict)throw Error('Resolve the saved-answer conflict before changing questions.');
      const history=await api('/attempts'),saved=history.filter(a=>a.testId===target.id).sort((a,b)=>new Date(b.startedAt)-new Date(a.startedAt))[0];
      if(serial!==navigationSerial||!workspaceVisible)return;
      clearInterval(timer);if(saved)await resume(saved.id,button);else await start(target.id,button);
    }catch(e){notify(e.message);}finally{moving=false;if(button.isConnected)button.disabled=false;}
  }
  function renderResults() {
    document.body.classList.remove('exam-mode'); clearInterval(timer);
    const summary=report.summarize(attempt.questions,attempt.results), scored=summary.complete;
    const retry=['sst','wfd'].includes(attempt.kind) && attempt.questions.length===1 ? '<button class="primary" data-reattempt="'+esc(attempt.testId)+'">Reattempt this question</button>' : '';
    root.innerHTML='<section class="results"><div class="results-header"><div><p class="eyebrow" style="color:#287e8a">Attempt complete</p><h1>'+esc(attempt.title)+'</h1><p class="muted">'+new Date(attempt.startedAt).toLocaleString()+' · Saved to '+esc(username)+'</p></div><div class="results-actions"><button class="secondary" data-tab="history">My attempts</button>'+retry+'</div></div><div class="score-banner"><div class="score-total">'+(scored?summary.score90:'—')+'<small> / 90</small></div><div><h2>'+'Result'+'</h2><p>'+(scored?'Your score and detailed feedback are ready.':'Your answers are submitted. Preparing your assessment…')+'</p></div></div><div class="task-scores">'+summary.byType.map(g=>'<div class="task-score"><span>'+esc(g.label)+'</span><strong>'+(g.score90==null?'—':g.score90)+'<small> /90</small></strong><small>'+g.count+' question'+(g.count===1?'':'s')+(g.score90==null?' · Feedback pending':'')+'</small></div>').join('')+'</div><div id="scoring-status" class="scoring-status"></div>'+attempt.questions.map((q,i)=>reviewCard(q,i)).join('')+practiceNavigation()+'</section>';
    root.focus();
    if(!scored && !grading.has(attempt.id)) scoreRemaining();
  }
  function reviewCard(q,i) {
    const r=attempt.results[i], listening=audioQuestion(q), dictation=q.type==='wfd';
    return '<article class="review-card" id="review-'+i+'"><div class="review-top"><h2>'+(i+1)+'. '+esc(q.title)+'</h2><strong>'+(r?report.score90(r.total,r.maximum)+'/90':'Awaiting score')+'</strong></div><p class="muted">'+report.labels[q.type]+' · '+count(attempt.answers[i])+' words · '+esc(attempt.completed[i]?.reason||'Submitted')+'</p><h3>Your response</h3><div class="response">'+esc(attempt.answers[i]||'No answer submitted.')+'</div>'+
      (r? (r.gated?'<div class="gate"><b>No marks awarded for this response.</b> '+esc(r.reasons.join(' '))+'</div>':'')+
      (q.type==='swt' ? window.PteEstimateDisplay.render(report.score90(r.scores.content,r.maxima.content),report.score90(r.total,r.maximum)) : '')+
      (dictation&&r.wordFeedback?'<h3>Sentence check</h3><p class="muted">Green = correct · underlined = missing, misspelled or out of order</p><div class="word-feedback">'+r.wordFeedback.map(w=>'<span class="'+(w.correct?'word-correct':'word-missed')+'">'+esc(w.word)+'</span>').join(' ')+'</div>':'')+
      '<table class="trait-table"><thead><tr><th>Criterion</th><th>Marks</th><th>Feedback</th></tr></thead><tbody>'+Object.keys(r.maxima).map(k=>'<tr><td>'+labels[k]+'</td><td>'+r.scores[k]+'/'+r.maxima[k]+'</td><td>'+esc(r.feedback[k]||(r.gated?'No further marks when Content or Form is zero.':''))+'</td></tr>').join('')+'</tbody></table>'+
      (r.strengths.length?'<h3>What worked well</h3><ul>'+r.strengths.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul>':'')+
      (r.improvements.length?'<h3>What to improve</h3><ul>'+r.improvements.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul>':'')+
      (r.errors.length?'<h3>Language corrections</h3><ul>'+r.errors.map(e=>'<li><b>'+esc(e.phrase)+'</b> → '+esc(e.correction)+'<br>'+esc(e.explanation)+'</li>').join('')+'</ul>':''):'')+
      '<details><summary>Review '+(listening?'recording, transcript and key points':'question and key points')+'</summary>'+(listening?'<audio controls src="'+esc(q.audioUrl)+'" preload="none"></audio>':'')+'<div class="response">'+esc(q.text)+'</div><ul>'+q.keyPoints.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul></details><details><summary>'+(dictation?'View correct sentence':'View sample '+(q.type==='essay'?'essay':'summary'))+'</summary>'+(dictation?'':'')+'<div class="response sample">'+esc(q.sample)+'</div><p class="muted">'+count(q.sample)+' words</p></details></article>';
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
  async function handleRequest(request) {
    if (!catalog) { pendingRequest=request; return; }
    if (request.requestId && handledRequest === request.requestId) return;
    handledRequest=request.requestId;
    const serial=++navigationSerial;
    workspaceVisible=true;
    const tab=['sst','wfd','mocks','history'].includes(request.tab)?request.tab:'mocks';
    requestedView=tab;
    if (attempt?.status==='active') await saveAnswer(false);
    if (serial!==navigationSerial || !workspaceVisible) return;
    if (request.attemptId) return resume(request.attemptId,{disabled:false});
    if (request.testId) {
      historyKind='mock';
      if (attempt?.testId===request.testId && ['active','ready'].includes(attempt.status)) return showAttempt();
      // Opening another paper never deletes the attempt already saved on the server.
      return start(request.testId,{disabled:false},serial);
    }
    if (tab==='history') { historyKind='mock'; return hub(tab); }
    const kind=tab==='mocks'?'mock':tab;
    historyKind=kind;
    if (attempt?.kind===kind && ['active','ready'].includes(attempt.status)) return showAttempt();
    return hub(tab);
  }
  window.addEventListener('message',e=>{
    if(e.source!==window.parent || e.origin!==location.origin || !e.data) return;
    if(e.data.type==='writing-lab-suspend') {
      navigationSerial++; pendingRequest=null; workspaceVisible=false; stopAudio(); writeDraft(); saveAnswer(false); return;
    }
    if(e.data.type==='writing-lab-tab') handleRequest(e.data).catch(error=>notify(error.message));
  });
  root.addEventListener('click',async e=>{
    const b=e.target.closest('button'); if(!b) return;
    if(b.disabled)return;
    if(b.dataset.libraryPage!==undefined){libraryPage=Math.max(0,Number(b.dataset.libraryPage));return hub(view);}
    if(b.dataset.practiceMove!==undefined)return movePractice(Number(b.dataset.practiceMove),b);
    if(b.dataset.portal) { writeDraft(); await saveAnswer(false); stopAudio(); return returnToPortal(b.dataset.portal); }
    if(b.dataset.tab) return hub(b.dataset.tab);
    if(b.dataset.start) return start(b.dataset.start,b);
    if(b.dataset.reattempt) return reattempt(b.dataset.reattempt,b);
    if(b.dataset.resume) return resume(b.dataset.resume,b);
    if(b.dataset.edit) return edit(b.dataset.edit);
    if(b.dataset.leave && await confirmAction('Leave this attempt?','Your saved answers remain in My attempts. The timer continues while you are away.','Save and exit')) {
      const kind=attempt?.kind; await saveAnswer(false); hub(kind==='mock'?'mocks':kind || 'sst');
      if(kind==='mock')returnToPortal('mock-tests');
    }
  });

  window.addEventListener('beforeunload',e=>{ if(attempt?.status==='active') {writeDraft();e.preventDefault();e.returnValue='';} });
  document.addEventListener('visibilitychange',()=>{if(document.hidden) {stopAudio();writeDraft();saveAnswer(false);} else tick();});
  window.addEventListener('online',()=>saveAnswer(false));
  window.addEventListener('storage',event=>{if(event.key==='pte_session_token') location.reload();});
  setInterval(()=>{if(attempt?.status==='active' && !moving) saveAnswer(false);},15000);
  (async()=>{
    try { const values=await Promise.all([api('/catalog'),api('/session')]); catalog=values[0];username=values[1].username;if(pendingRequest)await handleRequest(pendingRequest);else await hub(requestedView); }
    catch(e) {root.innerHTML='<div class="hub"><h1>Unable to load practice</h1><p>'+esc(e.message)+'</p><button class="primary" id="reload-lab">Retry</button></div>';document.getElementById('reload-lab').onclick=()=>location.reload();}
  })();
})();
