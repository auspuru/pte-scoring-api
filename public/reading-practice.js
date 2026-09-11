/* Reading is a native portal pane; it does not contact the former mock service. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./reading-mock-tools') : root.ReadingMockTools,
    typeof module === 'object' && module.exports ? require('./reading-exam-player') : root.ReadingExamPlayer,
    typeof module === 'object' && module.exports ? require('./reading-session-timing') : root.ReadingSessionTiming,
    typeof module === 'object' && module.exports ? require('./reading-review') : root.ReadingReview);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReadingPractice = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (mock, exam, timing, review) {
  'use strict';
  const labels = { dropdown: 'Dropdown blanks', wordbank: 'Drag-and-drop blanks', reorder: 'Reorder paragraphs', mcsa: 'Single answer', mcma: 'Multiple answers' };
  const taskLabels = { ...labels, ...mock.extraLabels };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function score(q, answer = [], assessment) {
    const extra = mock.scoreExtra(q, answer, assessment);
    if (extra) return extra;
    const a = Array.isArray(answer) ? answer : [];
    const possible = q.type === 'mcsa' ? 1 : q.type === 'reorder' ? q.answers.length - 1 : q.answers.length;
    let earned = 0;
    if (q.type === 'mcsa') earned = a.length && a[0] === q.answer ? 1 : 0;
    else if (q.type === 'mcma') earned = Math.max(0, [...new Set(a)].reduce((n, x) => n + (q.answers.includes(x) ? 1 : -1), 0));
    else if (q.type === 'reorder') earned = q.answers.slice(0, -1).filter((x, i) => a.some((y, j) => x === y && a[j + 1] === q.answers[i + 1])).length;
    else earned = q.answers.filter((x, i) => x === a[i]).length;
    return { earned: Math.min(possible, earned), possible };
  }
  function diagnostic(sets) {
    // Two items per task type, drawn from different versions; no invented skill ratings.
    return Object.keys(labels).flatMap((type, i) => [0, 1].map((offset) => {
      const set = sets[(i + offset) % sets.length];
      const q = set.questions.filter(q => q.type === type)[offset] || set.questions.find(q => q.type === type);
      return { ...q, uid: set.id + ':' + q.id, reasoning: set.reasoning[q.id] || {} };
    }));
  }
  function report(questions, answers, assessments = {}, audioStates = {}) {
    return Object.entries(taskLabels).map(([type, label]) => {
      const items = questions.filter(q => q.type === type);
      const points = items.map(q => {
        const p = score(q, answers[q.uid], assessments[q.uid]);
        return mock.isAudio(q) && audioStates[q.uid]?.status !== 'complete' ? { ...p, earned: 0, excluded: true } : p;
      });
      return { type, label, count: items.length, earned: points.reduce((n,p)=>n+p.earned,0), possible: points.reduce((n,p)=>n+p.possible,0),
        gradedPossible: points.reduce((n,p)=>n+(p.pending || p.excluded ? 0 : p.possible),0),
        pending: points.filter(p=>p.pending).length, excluded: points.filter(p=>p.excluded).length };
    }).filter(row => row.count);
  }
  function totals(session) {
    const rows = report(session.questions, session.answers, session.assessments, session.audioStates);
    const sum = key => rows.reduce((n,r)=>n+r[key],0);
    const earned = sum('earned'), possible = sum('gradedPossible');
    return { rows, earned, possible, pending: sum('pending'), excluded: sum('excluded'), percent: possible ? Math.round(earned/possible*100) : null };
  }
  function storageKey(owner) { return 'ipt_reading_v1:' + encodeURIComponent(String(owner).trim().toLowerCase()); }
  function remaining(session, now = Date.now()) { return session.deadline == null ? null : Math.max(0, Math.ceil((session.deadline - now) / 1000)); }
  let host, bank, owner = '', state, generation = 0, interval, selectedWord = '', saveNotice = '';
  let activeSince = 0, viewingQuestion = false, lastPersisted = 0, starting = false, speaker;
  let selectedParagraph = {}, examNotice = null;
  let startGeneration = 0;
  let homeFamily = 'practice';
  let mockPage = 0, libraryView = null;
  let reviewView = { id: null, filter: 'all', type: 'all', context: false };
  const pendingGrades = new Map();
  const initialState = () => ({ session: null, history: [], drafts: [], practiceResults: {} });
  let lastSnapshot = null;
  let cloudStatus = null;
  const progressSync = () => globalThis.AccountProgress;
  function identity() { return typeof currentUserId !== 'undefined' ? String(currentUserId).trim().toLowerCase() : ''; }
  function authToken() { return typeof sessionToken !== 'undefined' ? sessionToken : null; }
  function persist() {
    if (!owner || identity() !== owner) return;
    if (progressSync()) {
      const stamped = progressSync().stampReading(state, lastSnapshot);
      // Keep session objects alive for in-flight assessment callbacks.
      if (state.session && stamped.session) Object.assign(state.session, stamped.session);
      state.sessionSelectedAt = stamped.sessionSelectedAt;
      state.history = stamped.history; state.drafts = stamped.drafts;
    }
    const snapshot = progressSync() ? progressSync().packReading(state) : state;
    const changed = JSON.stringify(snapshot) !== JSON.stringify(lastSnapshot);
    try { localStorage.setItem(storageKey(owner), JSON.stringify(snapshot)); saveNotice = cloudStatus?.text || 'Saved on this device'; lastPersisted = Date.now(); }
    catch (_) { saveNotice = 'Could not save on this device. Keep this page open.'; }
    lastSnapshot = JSON.parse(JSON.stringify(snapshot));
    if (changed && typeof queueSync === 'function') queueSync();
    const el = host?.querySelector('[data-save-status]'); if (el) el.textContent = saveNotice;
  }
  function setSyncStatus(status, text) {
    cloudStatus = { status, text };
    saveNotice = text;
    const el = host?.querySelector('[data-save-status]'); if (el) el.textContent = text;
  }
  function receiveProgress(remote, uid) {
    if (!state || !progressSync() || owner !== String(uid).trim().toLowerCase() || owner !== identity()) return;
    const before = state.session, beforeView = before && JSON.stringify([before.id, before.index, before.done, before.answers, before.assessments]);
    const navigation = before && JSON.stringify([before.id, before.index, before.done]);
    const merged = progressSync().mergeReading(state, remote);
    // Recalculate display totals using the existing grader, never a sync rule.
    merged.history = merged.history.map(s => ({ ...s, ...totals(s) }));
    if (before?.id === merged.session?.id) { Object.assign(before, merged.session); merged.session = before; }
    state = merged;
    lastSnapshot = progressSync().packReading(state);
    try { localStorage.setItem(storageKey(owner), JSON.stringify(lastSnapshot)); } catch (_) { /* The cloud copy remains available. */ }
    const afterView = state.session && JSON.stringify([state.session.id, state.session.index, state.session.done, state.session.answers, state.session.assessments]);
    const moved = navigation !== (state.session && JSON.stringify([state.session.id, state.session.index, state.session.done]));
    if (beforeView !== afterView && !host.hidden && viewingQuestion && (moved || !document.activeElement?.matches?.('textarea,input'))) {
      cancelAudio(); render();
    } else if (!viewingQuestion && !host.hidden) renderHomeView();
    resumeSwtAssessments();
  }
  function recordTime() {
    const s = state?.session;
    if (s && !s.done && activeSince && viewingQuestion && !host.hidden && !document.hidden) {
      const q = s.questions[s.index];
      const end = s.deadline == null ? Date.now() : Math.min(Date.now(), s.deadline);
      s.times[q.uid] = (s.times[q.uid] || 0) + Math.max(0, end - activeSince);
    }
    activeSince = Date.now();
  }
  function reset() {
    document.removeEventListener?.('visibilitychange', visibilityChanged);
    clearInterval(interval); interval = null; generation++; owner = ''; state = null; selectedWord = ''; activeSince = 0;
    lastSnapshot = null;
    starting = false; pendingGrades.clear(); cancelAudio(); setExamMode(false); selectedParagraph = {}; examNotice = null;
    homeFamily='practice'; mockPage=0; libraryView=null; reviewView={id:null,filter:'all',type:'all',context:false};
    if (host) host.replaceChildren();
  }
  function setExamMode(enabled) {
    const active = enabled && !host?.hidden;
    host?.classList?.toggle('reading-exam-active',active);
    document.body?.classList?.toggle('reading-exam-open',active);
  }
  function leave() { startGeneration++; starting=false; recordTime(); cancelAudio(); viewingQuestion = false; setExamMode(false); examNotice=null; persist(); }
  async function open() {
    const nextOwner = identity();
    if (!nextOwner) return;
    if (owner === nextOwner && state && bank) { if (typeof resumeAccountSync === 'function') await resumeAccountSync(); if (owner !== nextOwner || nextOwner !== identity() || !state) return; activeSince = Date.now(); tick(); render(); return; }
    reset(); owner = nextOwner; host = document.getElementById('readingPane');
    const requestGeneration = generation;
    host.innerHTML = '<div class="reading-card" role="status">Preparing your reading practice…</div>';
    try {
      if (!bank) {
        const response = await fetch('reading-bank.json?v=7', { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw Error('Unable to load question bank');
        bank = await response.json();
      }
      if (requestGeneration !== generation || nextOwner !== identity()) return;
      state = initialState();
      try {
        const raw = JSON.parse(localStorage.getItem(storageKey(owner)) || 'null');
        const saved = progressSync() ? progressSync().unpackReading(raw) : raw;
        if (saved && Array.isArray(saved.history)) {
          state.history = saved.history;
          state.drafts = saved.drafts || [];
          state.sessionSelectedAt = saved.sessionSelectedAt || saved.session?.startedAt || 0;
          state.practiceResults = saved.practiceResults && typeof saved.practiceResults==='object' && !Array.isArray(saved.practiceResults) ? saved.practiceResults : {};
          if (saved.session && Array.isArray(saved.session.questions) && saved.session.questions.length && Number.isInteger(saved.session.index) && saved.session.index >= 0 && saved.session.index < saved.session.questions.length && saved.session.answers && saved.session.times) state.session = saved.session;
        }
        lastSnapshot = progressSync() ? progressSync().packReading(state) : JSON.parse(JSON.stringify(state));
        saveNotice = cloudStatus?.text || 'Progress is saved on this device';
      } catch (_) { saveNotice = 'Saved progress could not be restored on this device'; }
      if (state.session) repairSession(state.session);
      host.onclick = click; host.onchange = change; host.oninput = input;
      speaker ||= mock.createSpeaker(globalThis, audioState);
      document.addEventListener?.('visibilitychange', visibilityChanged);
      host.ondragstart = dragStart; host.ondragover = dragOver; host.ondrop = drop;
      render(); resumeSwtAssessments(); interval = setInterval(tick, 1000); activeSince = Date.now(); tick();
      if (typeof queueSync === 'function' && (state.session || state.history.length || Object.keys(state.practiceResults).length)) queueSync();
      if (typeof resumeAccountSync === 'function') resumeAccountSync();
    } catch (_) {
      if (requestGeneration !== generation) return;
      host.innerHTML = '<div class="reading-card" role="alert"><h2>Reading could not load</h2><p>Your writing workspace is still available.</p><button class="portal-button" data-action="reload">Try again</button></div>';
      host.onclick = () => { reset(); open(); };
    }
  }
  function repairSession(s) {
    s.assessments ||= {}; s.audioStates ||= {};
    s.flags = Array.isArray(s.flags) ? s.flags : [];
    s.checked = Array.isArray(s.checked) ? s.checked : [];
    for (const [uid,item] of Object.entries(s.assessments)) if (item.status === 'working' && !pendingGrades.has(s.id+':'+uid)) { item.status = 'error'; item.interrupted = true; item.message = 'The previous grading request was interrupted. Retry your saved response.'; }
    for (const item of Object.values(s.audioStates)) if (['countdown','loading','playing'].includes(item.status)) { item.status = 'error'; item.message = 'Audio was interrupted. Select Play audio when you are ready.'; }
  }
  function questionList(set) { return set.questions.map(q => ({ ...q, uid: set.id + ':' + q.id, reasoning: set.reasoning[q.id] || {} })); }
  async function start(mode, practiceUid) {
    if (starting || !owner || identity() !== owner) return;
    const preset = bank.mockCatalogue?.find(item => item.id === mode);
    const set = bank.sets.find(s => s.id === (preset?.setId || host.querySelector('#readingSet')?.value)) || bank.sets[0];
    const type = host.querySelector('#readingType')?.value || 'all';
    const timed = practiceUid ? false : preset ? preset.timed : mode !== 'practice' || host.querySelector('#readingTimed')?.checked;
    const ticket = generation, startedOwner = owner, token = authToken();
    const startTicket = ++startGeneration;
    starting = true;
    const status = host.querySelector('[data-start-status]');
    if (status) status.textContent = mode === 'full' || preset ? 'Preparing your mock test…' : 'Preparing your question…';
    try {
      let swtPassages;
      if (mode === 'full' || preset && preset.kind!=='reading-blanks') {
        const valid = p => p && p.id != null && typeof p.text === 'string' && p.text.length > 100 && p.keyElements && Object.values(p.keyElements).some(value => typeof value === 'string' && value.trim());
        const unique = items => { const ids = new Set(), texts = new Set(); return items.filter(valid).filter(p => { const id=String(p.id), text=p.text.trim().replace(/\s+/g,' ').toLowerCase(); if(ids.has(id)||texts.has(text))return false;ids.add(id);texts.add(text);return true; }); };
        let available = unique(typeof passages !== 'undefined' && Array.isArray(passages) ? passages : []);
        if (available.length < 2) {
          const response = await fetch((typeof API_URL !== 'undefined' ? API_URL : '') + '/api/passages', { signal: AbortSignal.timeout(15000) });
          if (!response.ok) throw Error('The SWT passage could not load. Please try again.');
          const data = await response.json();
          available = unique([...available, ...(Array.isArray(data) ? data : data.passages || [])]);
        }
        if (available.length < 2) throw Error('Two different SWT passages are required. Please try again.');
        available.sort((a,b)=>String(a.id).localeCompare(String(b.id),undefined,{numeric:true}));
        const first = preset ? preset.swtOffset % available.length : Date.now() % available.length;
        swtPassages = [available[first], available[(first + 1) % available.length]];
      }
      if (ticket !== generation || startTicket !== startGeneration || startedOwner !== identity() || token !== authToken()) return;
      let plan = mock.compose(bank, mode, set.id, swtPassages);
      if (mode === 'diagnostic') plan = { questions: diagnostic(bank.sets), minutes: 15, name: 'Reading diagnostic' };
      if (mode === 'practice') {
        const questions = questionList(set).filter(q => type === 'all' || q.type === type);
        plan = { questions, minutes: questions.length * 2, name: labels[type] || 'Mixed reading practice' };
        if(practiceUid){
          const q=bank.practiceLibraries.flatMap(l=>l.questions).find(item=>item.uid===practiceUid);
          if(!q)throw Error('This practice question is unavailable.');
          plan={questions:[{...q}],minutes:0,name:q.title};
        }
      }
      const startedAt = Date.now();
      cancelAudio();
      const preparedQuestions = mock.prepareQuestions(plan.questions, startedAt + ':' + mode);
      const session = { id: startedAt.toString(36) + '-' + Math.random().toString(36).slice(2,8), mode, name: plan.name, formatVersion: bank.version, questions: preparedQuestions, index: 0, answers: {}, assessments: {}, audioStates: {}, times: {}, flags: [], startedAt, deadline: timed ? startedAt + plan.minutes * 60000 : null, done: false, checked: [] };
      timing.initialise(session, plan.stages, startedAt);
      if (state.session && !state.session.done) state.drafts = [state.session, ...(state.drafts || []).filter(s => s.id !== state.session.id)];
      state.session = session;
      if(practiceUid)session.practiceUid=practiceUid;
      libraryView=null;
      selectedWord = ''; selectedParagraph = {}; examNotice = null; activeSince = Date.now(); persist(); render();
    } catch (error) {
      if (ticket === generation && startTicket === startGeneration && startedOwner === identity() && status) status.textContent = error.message || 'This mock could not start. Please try again.';
    } finally { if (ticket === generation && startTicket === startGeneration) starting = false; }
  }
  function home() {
    if (starting && !viewingQuestion) return;
    leave(); libraryView=null;
    const recent=state.history;
    const panels=['practice','sectional'].map(family=>{
      const items=bank.mockCatalogue.filter(m=>m.family===family),page=family===homeFamily?mockPage:0,pages=Math.ceil(items.length/3);
      const cards=items.map((m,i)=>`<article class="reading-card reading-mock-card" ${Math.floor(i/3)===page?'':'hidden'}><span class="reading-mock-index" aria-hidden="true">${String(i+1).padStart(2,'0')}</span><h3>${escape(m.name)}</h3><div class="reading-mock-meta"><span>${m.minutes||55} minutes</span></div><button class="portal-button primary" data-start="${m.id}" aria-label="Start ${escape(m.name)}">Start <span aria-hidden="true">→</span></button></article>`).join('');
      return `<section id="reading-${family}-mocks" class="reading-mock-panel" aria-labelledby="reading-${family}-tab" ${homeFamily===family?'':'hidden'}><div class="reading-mock-grid">${cards}</div>${pages>1?`<div class="reading-catalogue-pages"><button class="portal-button" data-mock-page="${page-1}" ${page===0?'disabled':''}>Previous</button><span role="status">${page+1} / ${pages}</span><button class="portal-button" data-mock-page="${page+1}" ${page===pages-1?'disabled':''}>Next</button></div>`:''}</section>`;
    }).join('');
    host.innerHTML=`<div class="reading-home-heading"><div><h2>Reading</h2></div><div class="reading-sound-inline"><button class="portal-button" data-action="soundcheck"><span aria-hidden="true">♫</span> Check sound</button><span data-sound-status role="status"></span></div></div>
      ${state.session?`<div class="portal-resume reading-resume"><div><strong>${escape(state.session.name)}</strong><p>${state.session.done?'Your answers and feedback are ready.':state.session.practiceUid?'Your practice answer is saved.':state.session.deadline==null?'Saved with the previous untimed format. Start a new practice mock for the 25-minute timer.':'Your answers are saved. The timer keeps running while you are away.'}</p></div><button class="portal-button" data-action="resume">${state.session.done?'Review result':'Continue session'} <span aria-hidden="true">→</span></button></div>`:''}
      <div class="reading-mode-switch" role="group" aria-label="Choose mock format">${['practice','sectional'].map(family=>`<button type="button" id="reading-${family}-tab" data-mock-family="${family}" aria-pressed="${homeFamily===family}" aria-controls="reading-${family}-mocks">${family==='practice'?'Practice':'Sectional'} mock test</button>`).join('')}</div>
      ${panels}<p data-start-status role="status" aria-live="polite"></p>
      <div class="reading-library-shortcuts"><h3>Question practice</h3><div>${bank.practiceLibraries.map(l=>`<button class="portal-button" data-browse-library="${l.id}">${escape(l.name)} <span aria-hidden="true">→</span></button>`).join('')}</div></div>
      <div class="reading-home-details"><details class="reading-home-help"><summary>Before you start</summary><p>Next saves your answer and moves on immediately. The timer keeps running if you leave; expiry submits your saved responses. Check your sound before starting. Answers and feedback appear together after you finish.</p><p>Progress syncs across devices when you sign in to the same account. Offline changes are saved on this device and sync when you reconnect. Completed answers and feedback remain in Recent results.</p></details>
      ${(state.drafts||[]).length?`<details class="reading-home-help"><summary>Other saved sessions <span>${state.drafts.length}</span></summary><ul class="reading-history">${state.drafts.map((r,i)=>`<li><div><strong>${escape(r.name)}</strong><span>Question ${r.index+1}</span></div><button class="portal-button" data-draft="${i}">Continue</button></li>`).join('')}</ul></details>`:''}
      <details class="reading-home-help"><summary>Recent results <span>${recent.length}</span></summary>${recent.length?`<ul class="reading-history">${recent.map((r,i)=>`<li><div><strong>${escape(r.name)}</strong><span>${escape(new Date(r.finishedAt).toLocaleDateString())} · ${r.earned}/${r.possible} graded points${r.pending?' · SWT awaiting assessment':''}</span></div><button class="portal-button" data-history="${i}">Review</button></li>`).join('')}</ul>`:'<p>Finish a mock to see your results here.</p>'}</details></div>`;
  }
  function libraryQuestions() {
    const library=bank.practiceLibraries.find(l=>l.id===libraryView?.id),query=(libraryView?.query||'').trim().toLowerCase();
    return (library?.questions||[]).filter(q=>!query||[q.title,q.topic,q.id].join(' ').toLowerCase().includes(query));
  }
  function libraryList() {
    const questions=libraryQuestions(),page=libraryView.page,pages=Math.max(1,Math.ceil(questions.length/10));
    return `<p class="reading-note" role="status">${questions.length} questions${libraryView.id==='hiw'?' · C2':''}</p><ul class="reading-library-list">${questions.slice(page*10,page*10+10).map(q=>{
      const result=state.practiceResults[q.uid];
      return `<li><div><strong>${escape(q.title)}</strong>${result?`<span>${escape(result.earned)}/${escape(result.possible)} points · Completed</span>`:''}</div><button class="portal-button" data-practice-uid="${escape(q.uid)}" aria-label="Practise ${escape(q.title)}">Practise <span aria-hidden="true">→</span></button></li>`;
    }).join('')}</ul>${questions.length?'':'<p>No questions match your search.</p>'}${pages>1?`<div class="reading-catalogue-pages"><button class="portal-button" data-library-page="${page-1}" ${page===0?'disabled':''}>Previous</button><span>${page+1} / ${pages}</span><button class="portal-button" data-library-page="${page+1}" ${page===pages-1?'disabled':''}>Next</button></div>`:''}`;
  }
  function browseLibrary(id, query='', page=0) {
    const library=bank.practiceLibraries.find(l=>l.id===id);if(!library)return;
    leave();libraryView={id,query,page};
    host.innerHTML=`<div class="reading-session-toolbar"><button class="portal-button" data-action="home">← Reading</button></div><div class="reading-home-heading"><h2>${escape(library.name)}</h2></div><label class="reading-library-search">Find a question<input type="search" data-library-search value="${escape(query)}" placeholder="Search titles or topics"></label><p data-start-status role="status" aria-live="polite"></p><div data-library-list>${libraryList()}</div>`;
  }
  function refreshLibraryList() { const node=host.querySelector('[data-library-list]');if(node)node.innerHTML=libraryList(); }
  function renderHomeView() { if(starting)return;if(libraryView)browseLibrary(libraryView.id,libraryView.query,libraryView.page);else home(); }
  function render() { if (!state.session) return home(); renderSession(); }
  function renderSession() {
    if (state.session && !state.session.done && state.session.questions.some(q => q.optionOrderVersion !== 1)) {
      state.session.questions = mock.prepareQuestions(state.session.questions, state.session.id || state.session.startedAt);
      persist();
    }
    viewingQuestion = true; activeSince = Date.now();
    if (expireSession()) return;
    const s=state.session, q=s.questions[s.index], a=s.answers[q.uid]||[];
    if (s.done) return renderReview();
    const testing=exam.isExam(s)&&!s.done;
    setExamMode(testing);
    if(mock.isAudio(q))prepareAudio(q);
    if(testing) {
      prepareAudio(q);
      host.innerHTML=exam.render({session:s,question:q,content:questionHTML(q,a),audio:mock.isAudio(q)?audioHTML(q):'',timer:timerText(),saved:saveNotice,notice:examNotice});
      updateAutoplay();
      return;
    }
    const review=s.done || s.checked.includes(q.uid);
    host.innerHTML = `<div class="reading-session-toolbar"><button class="portal-button" data-action="home">← Reading home</button><strong>${escape(s.name)}</strong><span class="reading-timer" data-timer>${timerText()}</span><span data-save-status role="status">${escape(saveNotice)}</span></div>
      ${s.done ? summary() : ''}
      <div class="reading-layout"><aside class="reading-card reading-nav" aria-label="Reading questions"><h3>${s.done ? 'Review answers' : 'Your questions'}</h3><div class="reading-question-grid">${s.questions.map((item,i)=>`<button class="portal-button ${i===s.index?'primary':''}" data-question="${i}" ${i===s.index?'aria-current="step"':''} aria-label="Question ${i+1}${s.flags.includes(item.uid)?', flagged':''}${s.answers[item.uid]?.some(x=>x!==''&&x!=null)?', answered':''}">${i+1}${s.flags.includes(item.uid)?' ⚑':''}${s.answers[item.uid]?.some(x=>x!==''&&x!=null)?' •':''}</button>`).join('')}</div><p class="reading-note">• Answered · ⚑ Flagged</p></aside>
      <article class="reading-card reading-question"><div class="reading-question-heading"><span class="portal-eyebrow">Question ${s.index+1} of ${s.questions.length} · ${taskLabels[q.type]}</span><button class="portal-button" data-action="flag" aria-pressed="${s.flags.includes(q.uid)}">${s.flags.includes(q.uid)?'Unflag':'Flag for review'}</button></div><h2>${taskLabels[q.type]}${q.type !== 'hiw' && q.cefrTarget?' · '+escape(q.cefrTarget):''}</h2><p>${escape(q.instructions)}</p>
      ${mock.isAudio(q)?audioHTML(q):''}
      <fieldset ${review?'disabled':''}><legend class="sr-only">Your answer</legend>${questionHTML(q,a)}</fieldset>
      ${review?explanation(q,a):''}
      <div class="reading-actions"><button class="portal-button" data-move="-1" ${s.index===0?'disabled':''}>Previous</button>${!s.done&&s.mode==='practice'&&!review?'<button class="portal-button primary" data-action="check">Check answer</button>':''}${!s.done?'<button class="portal-button primary" data-action="submit">Finish and review</button>':''}<button class="portal-button reading-next-action" data-move="1" ${s.index===s.questions.length-1?'disabled':''}>Next question <span aria-hidden="true">→</span></button></div></article></div>`;
  }
  function playback(q) { return mock.audioPlayback(q); }
  function audioHTML(q) {
    const s = state.session, item = s.audioStates?.[q.uid], locked = !s.done && ['countdown','loading','playing','complete'].includes(item?.status);
    const profile = playback(q);
    return `<div class="reading-audio"><button class="portal-button primary" data-action="play" ${locked?'disabled':''}>${s.done?'Replay for review':item?.status==='complete'?'Audio played':item?.status==='countdown'?'Starting soon':item?.status==='loading'?'Starting audio…':item?.status==='playing'?'Playing…':'Play audio'}</button><span data-audio-status role="status">${escape(item?.message || (profile.variant === 'single' ? 'Listen once, then answer. Check that your sound is on.' : profile.label+'. Listen and select the incorrect words.'))}</span></div>`;
  }
  function prepareAudio(q) {
    const s=state?.session;
    if (!s || s.done || !mock.isAudio(q) || !viewingQuestion || host.hidden || document.hidden || s.audioStates[q.uid]) return;
    const seconds=bank.mixedMock.audioPreparationSeconds;
    s.audioStates[q.uid]={status:'countdown',readyAt:Date.now()+seconds*1000,message:'Audio starts automatically in '+seconds+' seconds. Get ready to listen.'};
    persist();
  }
  function updateAutoplay() {
    const s=state?.session;
    if(!owner||identity()!==owner||!s||s.done||!viewingQuestion||host.hidden||document.hidden)return;
    const q=s.questions[s.index]; if(!mock.isAudio(q))return;
    prepareAudio(q);
    const item=s.audioStates[q.uid]; if(item?.status!=='countdown')return;
    const seconds=Math.max(0,Math.ceil((item.readyAt-Date.now())/1000));
    if(seconds===0){if(!expireSession())speaker.play(q.uid,q.audioText,playback(q));return;}
    item.message='Audio starts automatically in '+seconds+' second'+(seconds===1?'':'s')+'. Get ready to listen.';
    const label=host.querySelector('[data-audio-status]');if(label)label.textContent=item.message;
  }
  function cancelAudio() {
    const s=state?.session, q=s?.questions[s.index];
    if(s&&!s.done&&q&&s.audioStates?.[q.uid]?.status==='countdown'){
      s.audioStates[q.uid]={status:'error',message:'The audio countdown was interrupted. Select Play audio when you are ready.'};
      persist();
    }
    speaker?.cancel();
  }
  function visibilityChanged() {
    if(document.hidden){recordTime();cancelAudio();}
    else if(owner&&identity()===owner&&state?.session&&viewingQuestion&&!host.hidden){if(!expireSession())renderSession();}
  }
  function audioState(key, status, message) {
    if (!owner || identity() !== owner) return;
    if (key === 'soundcheck') {
      const el = host?.querySelector('[data-sound-status]');
      if (el) el.textContent = status === 'complete' ? 'Sound check complete. If you heard the sentence, you are ready.' : message;
      return;
    }
    const s = state?.session;
    if (!s || !s.questions.some(q=>q.uid===key)) return;
    if (s.done) {
      const label=host.querySelector('[data-review-audio-status="'+encodeURIComponent(key)+'"]');
      if(label)label.textContent=message;
      return;
    }
    if(!s.done&&['playing','complete'].includes(status)&&remaining(s)===0){expireSession();return;}
    if (!s.done) { s.audioStates[key] = { status, message }; persist(); }
    if (viewingQuestion && s.questions[s.index].uid === key) {
      const el = host.querySelector('[data-audio-status]'); if (el) el.textContent = message;
      const button = host.querySelector('[data-action="play"]');
      if (button) { button.disabled = ['loading','playing'].includes(status) || (!s.done && status==='complete'); button.textContent = s.done ? 'Replay for review' : status==='complete' ? 'Audio played' : status==='error' ? 'Play audio' : status==='loading' ? 'Starting audio…' : 'Playing…'; }
    }
  }
  function questionHTML(q,a) {
    if (q.type === 'swt') return `<p class="reading-passage">${escape(q.passage)}</p><label class="reading-response-label" for="readingSwtResponse">Your one-sentence summary</label><textarea id="readingSwtResponse" data-swt-response rows="5" maxlength="4000" spellcheck="false">${escape(a[0]||'')}</textarea><p class="reading-note" data-word-count>${wordCount(a[0])} words · 5–75 words</p>`;
    if (q.type === 'hiw') return `<div class="reading-hiw" aria-label="Transcript: select incorrect words">${q.passage.split(/\s+/).map((word,i)=>`<button type="button" data-hiw-word="${i}" aria-label="Word ${i+1}: ${escape(word)}" aria-pressed="${a.includes(i)}">${escape(word)}</button>`).join(' ')}</div>`;
    if(q.type==='dropdown'||q.type==='wordbank') {
      const passage=escape(q.passage).replace(/\[\[(\d+)\]\]/g, (_,n)=>{
        const i=Number(n)-1;
        if(q.type==='dropdown') return `<select data-answer="${i}" aria-label="Blank ${n}"><option value="">Choose…</option>${q.options[i].map(x=>`<option ${a[i]===x?'selected':''} value="${escape(x)}">${escape(x)}</option>`).join('')}</select>`;
        return `<button type="button" class="reading-blank" data-blank="${i}" ${a[i]?`draggable="true" data-filled-word="${escape(a[i])}"`:''} aria-label="Blank ${n}: ${escape(a[i]||'empty')}">${escape(a[i]||'Blank '+n)}</button>${a[i]?`<button type="button" class="reading-clear" data-clear="${i}" aria-label="Clear blank ${n}">×</button>`:''}`;
      });
      return `<p class="reading-passage">${passage}</p>${q.type==='wordbank'?`<div class="reading-wordbank" data-word-return>${q.bank.map(w=>`<button type="button" draggable="true" data-word="${escape(w)}" class="portal-button" aria-pressed="${selectedWord===w}" ${a.includes(w)?'disabled':''}>${escape(w)}</button>`).join('')}</div><p class="reading-note">Drag words into or between blanks, or select a word and then a blank. Drag a filled word back here or select × to return it.</p>`:''}`;
    }
    if(q.type==='reorder') {
      if(exam.isExam(state.session)&&!state.session.done)return exam.reorderHTML(q,a,selectedParagraph);
      const order=a.length?a:q.items.map(x=>x.key);
      return `<ol class="reading-reorder">${order.map((key,i)=>`<li><p>${escape(q.items.find(x=>x.key===key).text)}</p><div><button class="portal-button" data-reorder="${i}" data-direction="-1" ${i===0?'disabled':''} aria-label="Move paragraph ${i+1} up">↑</button><button class="portal-button" data-reorder="${i}" data-direction="1" ${i===order.length-1?'disabled':''} aria-label="Move paragraph ${i+1} down">↓</button></div></li>`).join('')}</ol><p class="reading-note">Use the arrows to order the paragraphs. ${!a.length?'Move a paragraph to record your answer.':''}</p>`;
    }
    return `<div class="reading-multiple-choice ${q.passage?'reading-has-passage':''}">${q.passage?`<p class="reading-passage">${escape(q.passage)}</p>`:''}<div class="reading-choice-options">${q.prompt?`<h3>${escape(q.prompt)}</h3>`:''}${q.choices.map((choice,i)=>`<label class="reading-choice"><input type="${q.type==='mcma'?'checkbox':'radio'}" name="readingChoice" data-choice="${q.choiceIndices?.[i] ?? i}" ${a.includes(q.choiceIndices?.[i] ?? i)?'checked':''}>${escape(choice)}</label>`).join('')}</div></div>`;
  }
  function wordCount(text) { return String(text||'').trim().split(/\s+/).filter(Boolean).length; }
  function explanation(q,a) {
    const assessment=state.session.assessments?.[q.uid], p=score(q,a,assessment), info=q.reasoning||{};
    if (q.type === 'swt') {
      const traits = assessment?.result?.trait_scores;
      return `<section class="reading-explanation"><h3>${p.pending?'SWT grade pending':p.earned+'/'+p.possible+' SWT points'}</h3>${p.pending?`<p>${escape(assessment?.message || 'Your response is saved for assessment by IPT Brisbane’s AI scoring engine.')}</p><button class="portal-button" data-action="retry-swt" ${assessment?.status==='working'?'disabled':''}>${assessment?.status==='working'?'IPT Brisbane AI is analysing…':'Retry SWT grading'}</button>`:traits?`<p>Content ${traits.content} · Form ${traits.form} · Grammar ${traits.grammar} · Vocabulary ${traits.vocabulary}</p>`:'<p>No summary was submitted.</p>'}${q.sampleResponse?`<details><summary>Example summary</summary><p>${escape(q.sampleResponse)}</p></details>`:''}</section>`;
    }
    const excluded=mock.isAudio(q) && state.session.audioStates?.[q.uid]?.status!=='complete';
    const actual=['mcsa','hcs'].includes(q.type)?[q.answer]:q.answers;
    const display=value=>['mcma','mcsa','hcs'].includes(q.type)?mock.choiceText(q,value):q.type==='reorder'?q.items.find(i=>i.key===value)?.text:q.type==='hiw'?`Word ${value+1}: ${q.corrections.find(c=>c.index===value).written} → ${q.corrections.find(c=>c.index===value).spoken}`:value;
    return `<section class="reading-explanation"><h3>${excluded?'Audio item excluded':(p.earned===p.possible?'Well done':'Review this answer')+' · '+p.earned+'/'+p.possible}</h3>${excluded?'<p>Audio did not complete before submission. This item is excluded from your graded total. You can replay it for review.</p>':''}<ol>${actual.map((correct,i)=>`<li><strong>${q.type==='dropdown'||q.type==='wordbank'?'Blank '+(i+1)+': ':''}${escape(display(correct))}</strong></li>`).join('')}</ol><p>${escape(info.correct||'Compare your response with the answer above, then reread the surrounding passage for the supporting meaning.')}</p>${info.options?`<details><summary>Why other options do not fit</summary><ul>${Object.entries(info.options).map(([option,reason])=>`<li><strong>${escape(option)}:</strong> ${escape(reason)}</li>`).join('')}</ul></details>`:''}${review.blankFeedback(q)}${q.audioText?`<details><summary>Audio transcript</summary><p>${escape(q.audioText)}</p></details>`:''}</section>`;
  }
  function summary(model = review.models(state.session,score)) {
    return review.overview(state.session,totals(state.session),taskLabels,model,reviewView);
  }
  function applyReviewFilters(model = review.models(state.session,score)) {
    if(!state.session?.done)return;
    let visible=0;
    for(const item of model){
      const shown=review.matches(item,reviewView);if(shown)visible++;
      const node=host.querySelector('[data-review-question="'+encodeURIComponent(item.q.uid)+'"]');
      if(node)node.hidden=!shown;
    }
    host.querySelectorAll('[data-review-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.reviewFilter===reviewView.filter)));
    host.querySelectorAll('[data-review-type]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.reviewType===reviewView.type)));
    host.querySelectorAll('[data-review-context-content]').forEach(node=>{node.hidden=!reviewView.context;});
    const context=host.querySelector('[data-review-context]');if(context){context.setAttribute('aria-pressed',String(reviewView.context));context.textContent=reviewView.context?'Hide passages':'Show passages';}
    const task=host.querySelector('[data-review-task]');if(task)task.value=reviewView.type;
    const reset=host.querySelector('[data-review-reset]');if(reset)reset.hidden=reviewView.filter==='all'&&reviewView.type==='all';
    const count=host.querySelector('[data-review-count]');if(count)count.textContent='Showing '+visible+' of '+model.length+' answers';
    const empty=host.querySelector('[data-review-empty]');if(empty)empty.hidden=visible>0;
    host.querySelectorAll('[data-filter-count]').forEach(node=>{node.textContent=String(model.filter(item=>review.matches(item,{filter:node.dataset.filterCount,type:reviewView.type})).length);});
  }
  function renderReview() {
    const s=state.session;
    setExamMode(false);
    if(reviewView.id!==s.id)reviewView={id:s.id,filter:'all',type:'all',context:false};
    const model=review.models(s,score),pending=model.filter(item=>item.points.pending);
    const retryable=pending.some(item=>s.assessments[item.q.uid]?.status!=='working');
    const retry=pending.length?'<button class="portal-button" data-action="retry-all-swt" '+(retryable?'':'disabled')+'>'+(retryable?'Retry pending SWT assessments':'Assessing SWT responses…')+'</button>':'';
    const question=item=>review.question(item.q,s.answers[item.q.uid],s.assessments[item.q.uid],s.audioStates[item.q.uid],item.points,item.index,s.questions.length,taskLabels[item.q.type],reviewView);
    const existing=host.querySelector('[data-review-session="'+encodeURIComponent(s.id)+'"]');
    if(existing){
      // Keep filters, scroll and audio controls in place as SWT assessments arrive.
      host.querySelector('[data-review-overview]').innerHTML=summary(model);
      host.querySelector('[data-review-retry]').innerHTML=retry;
      for(const item of model.filter(item=>item.q.type==='swt')){
        const node=host.querySelector('[data-review-question="'+encodeURIComponent(item.q.uid)+'"]');
        if(node)node.outerHTML=question(item);
      }
    }else{
      host.innerHTML='<section data-review-session="'+encodeURIComponent(s.id)+'"><div class="reading-session-toolbar"><button class="portal-button" data-action="home">← Reading mocks</button><strong>'+escape(s.name)+'</strong><span data-save-status role="status">'+escape(saveNotice)+'</span></div>'
        + '<div data-review-overview>'+summary(model)+'</div><div class="reading-review-intro"><div><h2>All answers &amp; feedback</h2><p>Explore your results. Your responses and explanations stay together.</p></div><div data-review-retry>'+retry+'</div></div>'
        + review.controls(model,taskLabels,reviewView)
        + '<div class="reading-review-empty reading-card" data-review-empty hidden><h3>No answers match these filters.</h3><p>Choose another task or reset your filters to see every answer.</p><button class="portal-button" data-review-reset>Show all answers</button></div>'
        + '<div class="reading-complete-review">'+model.map(question).join('')+'</div></section>';
    }
    applyReviewFilters(model);
  }
  function timerText() { const left=remaining(state.session, state.session.done ? state.session.finishedAt : Date.now()); return left===null?'Untimed practice':`${String(Math.floor(left/60)).padStart(2,'0')}:${String(left%60).padStart(2,'0')}${state.session.done?' · Finished':''}`; }
  function tick() {
    if (!owner || identity()!==owner) return reset();
    if (!state?.session || state.session.done) return;
    recordTime();
    if(expireSession()) return;
    const timer=host.querySelector('[data-timer]'); if(timer)timer.textContent=timerText();
    const left=remaining(state.session);
    if(timer)timer.dataset.urgent=String(left!==null&&left<=300);
    if (Date.now() - lastPersisted >= 10000) persist();
    updateAutoplay();
  }
  function renderTimerUpdate() {
    // Keep background deadlines current without reopening an exited or hidden test.
    if (host.hidden || starting) return;
    if (viewingQuestion) renderSession();
    else renderHomeView();
  }
  function finish() {
    const s=state.session; if(!s||s.done)return;
    recordTime(); cancelAudio(); s.done=true;
    s.finishedAt=s.deadline==null?Date.now():Math.min(Date.now(),s.deadline);
    s.completionReason=s.deadline!=null&&Date.now()>=s.deadline?'timeout':'submitted';
    timing.complete(s,s.finishedAt,s.completionReason);
    selectedWord=''; examNotice=null; selectedParagraph={};
    syncHistory(s); persist(); renderTimerUpdate();
    s.questions.filter(q=>q.type==='swt'&&String(s.answers[q.uid]?.[0]||'').trim()).forEach(q=>gradeSwt(q));
  }
  function syncHistory(s) {
    if(!s.done)return;
    const { earned, possible, percent, pending, excluded }=totals(s);
    const entry={...JSON.parse(JSON.stringify(s)),earned,possible,percent,pending,excluded};
    state.history=[entry,...state.history.filter(r=>r.id!==s.id)].sort((a,b)=>b.finishedAt-a.finishedAt);
    state.drafts=(state.drafts||[]).filter(r=>r.id!==s.id);
    if(s.practiceUid)state.practiceResults[s.practiceUid]={earned,possible,percent,finishedAt:s.finishedAt};
  }
  function resumeSwtAssessments() {
    const s=state?.session;
    if(!s||s.done||!exam.isExam(s))return;
    s.questions.slice(0,s.index).filter(q=>q.type==='swt'&&(!s.assessments[q.uid]||s.assessments[q.uid].interrupted)).forEach(q=>gradeSwt(q));
  }
  async function gradeSwt(q) {
    const s=state.session;
    const jobKey=s?.id+':'+q.uid;
    const index=s?.questions.findIndex(item=>item.uid===q.uid);
    const submitted=s&&(s.done||exam.isExam(s)&&index>=0&&index<s.index);
    if (!submitted || pendingGrades.has(jobKey) || !String(s.answers[q.uid]?.[0]||'').trim() || !mock.scoreExtra(q,s.answers[q.uid],s.assessments[q.uid]).pending) return;
    const ticket=generation, gradingOwner=owner, token=authToken();
    const job={}; pendingGrades.set(jobKey,job);
    s.assessments[q.uid]={status:'working',message:'IPT Brisbane’s AI scoring engine is analysing your response…'};
    syncHistory(s); persist(); if(s.done&&viewingQuestion)renderSession();
    try {
      if (typeof requestSwtGrade !== 'function') throw Error('SWT grading is unavailable. Your response is saved; please retry.');
      const result=await requestSwtGrade({type:'swt',passageId:q.passageId,prompt:q.passage,keyPoints:q.keyPoints,text:s.answers[q.uid][0],userId:gradingOwner});
      if (ticket!==generation || gradingOwner!==identity() || token!==authToken()) return;
      const pending=mock.scoreExtra(q,s.answers[q.uid],{result}).pending;
      s.assessments[q.uid]={status:pending?'error':'complete',result,message:pending?'Your summary is saved. A complete assessment is not available yet; the other answers are ready to review.':'Assessment by IPT Brisbane’s AI scoring engine is complete.'};
    } catch (error) {
      if (ticket!==generation || gradingOwner!==identity() || token!==authToken()) return;
      s.assessments[q.uid]={status:'error',message:error.message||'SWT grading could not finish. Your response is saved; please retry.'};
    } finally {
      if (pendingGrades.get(jobKey)===job) pendingGrades.delete(jobKey);
    }
    // An assessment belongs to its submitted response, never to a replacement draft.
    if(!s.done&&state.session?.id!==s.id)return;
    if (state.session?.id===s.id) state.session.assessments=s.assessments;
    syncHistory(s); persist();
    if (s.done && viewingQuestion && state.session?.id===s.id) renderSession();
    else if (s.done && !viewingQuestion && !host.hidden) renderHomeView();
  }
  function expireSession() {
    const s=state?.session;
    let changed=false;
    while(s&&!s.done&&remaining(s)===0){
      const stage=timing.current(s);
      if(!stage){finish();return true;}
      recordTime();cancelAudio();
      if(!timing.advance(s,Date.now(),'timeout')){finish();return true;}
      changed=true;selectedWord='';selectedParagraph={};examNotice=null;
      s.stageNotice=stage.name+' time is up. Your saved answers are locked. '+timing.current(s).name+' has started.';
    }
    if(changed){persist();renderTimerUpdate();resumeSwtAssessments();}
    return changed;
  }
  function editable() { if(expireSession())return false; const s=state?.session; return s&&!s.done&&!s.checked.includes(s.questions[s.index].uid); }
  function change(e) {
    if(!owner||identity()!==owner)return;
    if(state.session?.done&&e.target.dataset.reviewTask!==undefined){
      reviewView.type=Object.hasOwn(taskLabels,e.target.value)?e.target.value:'all';applyReviewFilters();return;
    }
    if(!editable())return;
    const q=state.session.questions[state.session.index];
    if(e.target.dataset.answer!==undefined) {
      const a=state.session.answers[q.uid]||[];a[Number(e.target.dataset.answer)]=e.target.value;state.session.answers[q.uid]=a;
    } else if(e.target.dataset.choice!==undefined) state.session.answers[q.uid]=[...host.querySelectorAll('[data-choice]:checked')].map(x=>Number(x.dataset.choice));
    persist();
  }
  function input(e) {
    if(owner&&identity()===owner&&libraryView&&e.target.dataset.librarySearch!==undefined){libraryView.query=e.target.value;libraryView.page=0;refreshLibraryList();return;}
    if (!owner || identity()!==owner || !editable() || e.target.dataset.swtResponse===undefined) return;
    const q=state.session.questions[state.session.index]; if(q.type!=='swt')return;
    state.session.answers[q.uid]=[e.target.value]; persist();
    const count=host.querySelector('[data-word-count]'); if(count)count.textContent=wordCount(e.target.value)+' words · 5–75 words';
  }
  function place(index,word) {
    if(!editable())return;
    const q=state.session.questions[state.session.index];
    if(q.type!=='wordbank'||!q.bank.includes(word)||index<0||index>=q.answers.length)return;
    const a=state.session.answers[q.uid]||[];
    const previous=a.indexOf(word); if(previous>=0)a[previous]=''; a[index]=word;
    state.session.answers[q.uid]=a;selectedWord='';persist();renderSession();
  }
  function dragStart(e) {
    if(!owner||identity()!==owner||!editable())return;
    const paragraph=e.target.closest('[data-paragraph]');
    if(paragraph){selectedParagraph={key:paragraph.dataset.paragraph,panel:paragraph.dataset.panel};e.dataTransfer.setData('application/x-ipt-paragraph',selectedParagraph.key);return;}
    const word=e.target.closest('[data-word], [data-filled-word]');
    if(word){selectedWord=word.dataset.word||word.dataset.filledWord;e.dataTransfer.setData('text/plain',selectedWord);}
  }
  function dragOver(e) { if(editable()&&e.target.closest('[data-blank], [data-word-return], [data-reorder-zone]'))e.preventDefault(); }
  function drop(e) {
    if(!owner||identity()!==owner||!editable())return;
    const zone=e.target.closest('[data-reorder-zone]');
    if(zone){
      e.preventDefault();const item=e.target.closest('[data-paragraph]'),s=state.session,q=s.questions[s.index];
      const position=item&&item.dataset.panel==='target'?(s.answers[q.uid]||[]).indexOf(item.dataset.paragraph):undefined;
      return transferParagraph(zone.dataset.reorderZone,position,e.dataTransfer.getData('application/x-ipt-paragraph'));
    }
    const blank=e.target.closest('[data-blank]'),word=e.dataTransfer.getData('text/plain');
    if(blank){e.preventDefault();return place(Number(blank.dataset.blank),word);}
    if(e.target.closest('[data-word-return]')){
      e.preventDefault();const s=state.session,q=s.questions[s.index];
      if(q.type==='wordbank'&&q.bank.includes(word)){s.answers[q.uid]=(s.answers[q.uid]||[]).map(value=>value===word?'':value);selectedWord='';persist();renderSession();}
    }
  }
  function focusParagraph() {
    const target=[...host.querySelectorAll('[data-paragraph]')].find(el=>el.dataset.paragraph===selectedParagraph.key&&el.dataset.panel===selectedParagraph.panel);
    target?.focus();
  }
  function transferParagraph(destination,position,key=selectedParagraph.key) {
    if(!editable()||!exam.isExam(state.session))return;
    const s=state.session,q=s.questions[s.index];if(q.type!=='reorder'||!q.items.some(item=>item.key===key))return;
    s.answers[q.uid]=exam.moveParagraph(q,s.answers[q.uid]||[],key,destination,position);
    selectedParagraph={key,panel:destination};persist();renderSession();focusParagraph();
  }
  function advanceExam() {
    const s=state.session;
    if(!s||s.done||!exam.isExam(s))return;
    examNotice=null;
    if(expireSession())return;
    if(s.index===s.questions.length-1)return finish();
    const submittedQuestion=s.questions[s.index];
    recordTime();cancelAudio();
    const stage=timing.current(s);
    if(stage&&s.index===stage.last)timing.advance(s,Date.now());else s.index++;
    s.stageNotice='';selectedWord='';selectedParagraph={};persist();renderSession();
    host.querySelector('[data-exam-title]')?.focus();
    if(submittedQuestion.type==='swt')gradeSwt(submittedQuestion);
  }
  function examAction(action) {
    const s=state.session;
    if(action==='exam-stay'){examNotice=null;renderSession();host.querySelector('[data-action="exam-next"]')?.focus();return;}
    if(action==='exam-confirm'){
      const pending=examNotice?.action;if(!pending)return;examNotice=null;
      if(pending==='exit')return home();
      if(pending==='submit')return finish();
      return advanceExam();
    }
    if(action==='exam-exit'){
      persist();examNotice={action:'exit',message:'Leave the test screen? '+(s.deadline==null?'Your progress will be saved.':'The timer will keep running.')+' Resume this question from Reading home. '+saveNotice+'.'};
    }else if(action==='exam-next')return advanceExam();
    renderSession();host.querySelector('[data-action="exam-stay"]')?.focus();
  }
  function click(e) {
    if(!owner||identity()!==owner||!state)return;
    if(expireSession() && viewingQuestion)return;
    // Pearson allows a selected single answer to be clicked again to clear it.
    if(e.target.matches?.('input[type="radio"][data-choice]')&&editable()){
      const q=state.session.questions[state.session.index],index=Number(e.target.dataset.choice);
      if(['mcsa','hcs'].includes(q.type)&&(state.session.answers[q.uid]||[]).includes(index)){
        e.preventDefault();state.session.answers[q.uid]=[];persist();renderSession();return;
      }
    }
    const b=e.target.closest('button');if(!b||b.disabled)return;
    const d=b.dataset,s=state.session;
    // Unlock Web Audio while a real click is active, before any async load or countdown.
    if(d.start||d.practiceUid||d.draft!==undefined||d.history!==undefined||d.question!==undefined||d.move!==undefined||['play','soundcheck','resume','exam-next','exam-confirm'].includes(d.action))speaker?.unlock();
    if(d.browseLibrary)return browseLibrary(d.browseLibrary);
    if(d.libraryPage!==undefined&&libraryView){
      const page=Number(d.libraryPage),max=Math.ceil(libraryQuestions().length/10);
      if(Number.isInteger(page)&&page>=0&&page<max){const next=page+(page>libraryView.page?1:-1);libraryView.page=page;refreshLibraryList();(host.querySelector('[data-library-page="'+next+'"]:not([disabled])')||host.querySelector('[data-library-page]:not([disabled])'))?.focus();}return;
    }
    if(d.practiceUid){if(s&&!s.done&&!confirm('Start this practice question? This replaces your current draft.'))return;return start('practice',d.practiceUid);}
    if(d.mockPage!==undefined&&!viewingQuestion){
      const page=Number(d.mockPage),max=Math.ceil(bank.mockCatalogue.filter(m=>m.family===homeFamily).length/3);
      if(Number.isInteger(page)&&page>=0&&page<max){const next=page+(page>mockPage?1:-1);mockPage=page;home();(host.querySelector('[data-mock-page="'+next+'"]:not([disabled])')||host.querySelector('[data-mock-page]:not([disabled])'))?.focus();}return;
    }
    if(d.mockFamily&&!viewingQuestion&&['practice','sectional'].includes(d.mockFamily)){
      homeFamily=d.mockFamily;mockPage=0;home();host.querySelector('[data-mock-family="'+homeFamily+'"]')?.focus();return;
    }
    if(d.start){if(s&&!s.done&&!confirm('Start a new reading session? Your current draft will remain in Other saved sessions.'))return;return start(d.start);}
    if(d.action==='soundcheck')return speaker.play('soundcheck','Welcome to IPT Brisbane. If you can hear this sentence, your audio is ready for the mixed reading mock.');
    if(d.draft!==undefined){const draft=state.drafts[Number(d.draft)];if(!draft)return;cancelAudio();state.drafts=state.drafts.filter(r=>r.id!==draft.id);if(s&&!s.done)state.drafts.push(s);state.session=draft;repairSession(draft);persist();return render();}
    if(d.history!==undefined){if(s&&!s.done&&!confirm('Review this result? Your current draft will remain in Other saved sessions.'))return;cancelAudio();if(s&&!s.done)state.drafts=[s,...state.drafts.filter(r=>r.id!==s.id)];state.session=JSON.parse(JSON.stringify(state.history[Number(d.history)]));repairSession(state.session);persist();return render();}
    if(d.action==='home')return home();
    if(d.action==='resume')return render();
    if(!s)return;
    if(s.done){
      if(d.reviewFilter!==undefined&&Object.hasOwn(review.filters,d.reviewFilter)){reviewView.filter=d.reviewFilter;applyReviewFilters();return;}
      if(d.reviewType!==undefined&&Object.hasOwn(taskLabels,d.reviewType)){reviewView.type=reviewView.type===d.reviewType?'all':d.reviewType;applyReviewFilters();return;}
      if(d.reviewContext!==undefined){reviewView.context=!reviewView.context;applyReviewFilters();return;}
      if(d.reviewReset!==undefined){reviewView.filter='all';reviewView.type='all';applyReviewFilters();return;}
    }
    if(s.done && d.action==='retry-all-swt')return Promise.all(s.questions.filter(q=>q.type==='swt'&&mock.scoreExtra(q,s.answers[q.uid],s.assessments[q.uid]).pending).map(q=>gradeSwt(q)));
    if(s.done && d.reviewUid){
      const item=s.questions.find(q=>q.uid===d.reviewUid);if(!item)return;
      if(d.action==='retry-swt'&&item.type==='swt')return gradeSwt(item);
      if(d.action==='play'&&mock.isAudio(item))return speaker.play(item.uid,item.audioText,playback(item));
      return;
    }
    recordTime();const q=s.questions[s.index];
    const testing=exam.isExam(s)&&!s.done;
    if(testing&&d.action?.startsWith('exam-'))return examAction(d.action);
    // Exam questions can only advance through Next; review unlocks after submission.
    if(testing&&(d.question!==undefined||d.move!==undefined||d.action==='flag'||d.action==='check'))return;
    if(d.action==='play'&&mock.isAudio(q)){if(!s.done&&['countdown','loading','playing','complete'].includes(s.audioStates[q.uid]?.status))return;return speaker.play(q.uid,q.audioText,playback(q));}
    if(d.action==='retry-swt'&&q.type==='swt')return gradeSwt(q);
    if(d.question!==undefined||d.move!==undefined){cancelAudio();s.index=Math.max(0,Math.min(s.questions.length-1,d.question!==undefined?Number(d.question):s.index+Number(d.move)));selectedWord='';persist();return renderSession();}
    if(d.action==='flag'){s.flags=s.flags.includes(q.uid)?s.flags.filter(x=>x!==q.uid):[...s.flags,q.uid];persist();return renderSession();}
    if(d.action==='submit'){
      const unfinished=s.questions.filter(item=>mock.isAudio(item)&&s.audioStates[item.uid]?.status!=='complete').length;
      const message=unfinished ? unfinished+' recording'+(unfinished===1?' has':'s have')+' not finished. Those answers will be unassessed if you finish now. Keep listening or replay the audio to include them in your score. Finish anyway?' : 'Finish this reading session and show the answers?';
      if(confirm(message))finish();return;
    }
    if(!editable())return;
    if(testing&&q.type==='reorder'){
      if(d.paragraph!==undefined){selectedParagraph={key:d.paragraph,panel:d.panel};renderSession();focusParagraph();return;}
      if(d.transfer!==undefined)return transferParagraph(d.transfer);
      if(d.orderStep!==undefined&&selectedParagraph.panel==='target'){
        const a=s.answers[q.uid]||[],i=a.indexOf(selectedParagraph.key),j=i+Number(d.orderStep);
        if(i<0||j<0||j>=a.length)return;[a[i],a[j]]=[a[j],a[i]];s.answers[q.uid]=a;persist();renderSession();focusParagraph();return;
      }
    }
    if(d.hiwWord!==undefined&&q.type==='hiw'){const index=Number(d.hiwWord),a=s.answers[q.uid]||[];s.answers[q.uid]=a.includes(index)?a.filter(x=>x!==index):[...a,index];b.setAttribute('aria-pressed',String(s.answers[q.uid].includes(index)));persist();return;}
    if(d.action==='check'){s.checked.push(q.uid);persist();return renderSession();}
    if(d.word!==undefined){selectedWord=d.word;host.querySelectorAll('[data-word]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.word===selectedWord)));return;}
    if(d.blank!==undefined)return place(Number(d.blank),selectedWord);
    if(d.clear!==undefined){(s.answers[q.uid]||[])[Number(d.clear)]='';persist();return renderSession();}
    if(d.reorder!==undefined){const a=s.answers[q.uid]||q.items.map(x=>x.key),i=Number(d.reorder),j=i+Number(d.direction);[a[i],a[j]]=[a[j],a[i]];s.answers[q.uid]=a;persist();return renderSession();}
  }
  return { open, leave, reset, score, diagnostic, report, remaining, storageKey, totals, receiveProgress, setSyncStatus };
});
