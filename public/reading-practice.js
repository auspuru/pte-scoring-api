/* Reading is a native portal pane; it does not contact the former mock service. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./reading-mock-tools') : root.ReadingMockTools,
    typeof module === 'object' && module.exports ? require('./reading-exam-player') : root.ReadingExamPlayer);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReadingPractice = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (mock, exam) {
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
  function remaining(session, now = Date.now()) { return session.deadline ? Math.max(0, Math.ceil((session.deadline - now) / 1000)) : null; }
  let host, bank, owner = '', state, generation = 0, interval, selectedWord = '', saveNotice = '';
  let activeSince = 0, viewingQuestion = false, lastPersisted = 0, starting = false, speaker;
  let selectedParagraph = {}, examNotice = null;
  const pendingGrades = new Map();
  const initialState = () => ({ session: null, history: [] });
  function identity() { return typeof currentUserId !== 'undefined' ? String(currentUserId).trim().toLowerCase() : ''; }
  function authToken() { return typeof sessionToken !== 'undefined' ? sessionToken : null; }
  function persist() {
    if (!owner || identity() !== owner) return;
    try { localStorage.setItem(storageKey(owner), JSON.stringify(state)); saveNotice = 'Saved on this device'; lastPersisted = Date.now(); }
    catch (_) { saveNotice = 'Could not save on this device. Keep this page open.'; }
    const el = host?.querySelector('[data-save-status]'); if (el) el.textContent = saveNotice;
  }
  function recordTime() {
    const s = state?.session;
    if (s && !s.done && activeSince && viewingQuestion && !host.hidden && !document.hidden) {
      const q = s.questions[s.index];
      s.times[q.uid] = (s.times[q.uid] || 0) + Math.max(0, Date.now() - activeSince);
    }
    activeSince = Date.now();
  }
  function reset() {
    clearInterval(interval); interval = null; generation++; owner = ''; state = null; selectedWord = ''; activeSince = 0;
    starting = false; pendingGrades.clear(); speaker?.cancel(); setExamMode(false); selectedParagraph = {}; examNotice = null;
    if (host) host.replaceChildren();
  }
  function setExamMode(enabled) {
    const active = enabled && !host?.hidden;
    host?.classList?.toggle('reading-exam-active',active);
    document.body?.classList?.toggle('reading-exam-open',active);
  }
  function leave() { recordTime(); speaker?.cancel(); viewingQuestion = false; setExamMode(false); examNotice=null; persist(); }
  async function open() {
    const nextOwner = identity();
    if (!nextOwner) return;
    if (owner === nextOwner && state && bank) { activeSince = Date.now(); tick(); render(); return; }
    reset(); owner = nextOwner; host = document.getElementById('readingPane');
    const requestGeneration = generation;
    host.innerHTML = '<div class="reading-card" role="status">Preparing your reading practice…</div>';
    try {
      if (!bank) {
        const response = await fetch('reading-bank.json?v=2', { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw Error('Unable to load question bank');
        bank = await response.json();
      }
      if (requestGeneration !== generation || nextOwner !== identity()) return;
      state = initialState();
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey(owner)) || 'null');
        if (saved && Array.isArray(saved.history)) {
          state.history = saved.history.slice(0, 30);
          if (saved.session && Array.isArray(saved.session.questions) && saved.session.questions.length && Number.isInteger(saved.session.index) && saved.session.index >= 0 && saved.session.index < saved.session.questions.length && saved.session.answers && saved.session.times) state.session = saved.session;
        }
        saveNotice = 'Progress is saved on this device';
      } catch (_) { saveNotice = 'Saved progress could not be restored on this device'; }
      if (state.session) repairSession(state.session);
      host.onclick = click; host.onchange = change; host.oninput = input;
      speaker ||= mock.createSpeaker(globalThis, audioState);
      host.ondragstart = dragStart; host.ondragover = dragOver; host.ondrop = drop;
      render(); interval = setInterval(tick, 1000); activeSince = Date.now(); tick();
    } catch (_) {
      if (requestGeneration !== generation) return;
      host.innerHTML = '<div class="reading-card" role="alert"><h2>Reading could not load</h2><p>Your writing workspace is still available.</p><button class="portal-button" data-action="reload">Try again</button></div>';
      host.onclick = () => { reset(); open(); };
    }
  }
  function repairSession(s) {
    s.assessments ||= {}; s.audioStates ||= {};
    for (const [uid,item] of Object.entries(s.assessments)) if (item.status === 'working' && !pendingGrades.has(s.id+':'+uid)) { item.status = 'error'; item.message = 'The previous grading request was interrupted. Retry your saved response.'; }
    for (const item of Object.values(s.audioStates)) if (['loading','playing'].includes(item.status)) { item.status = 'error'; item.message = 'Playback was interrupted. Replay this question before submitting.'; }
  }
  function questionList(set) { return set.questions.map(q => ({ ...q, uid: set.id + ':' + q.id, reasoning: set.reasoning[q.id] || {} })); }
  async function start(mode) {
    if (starting || !owner || identity() !== owner) return;
    const set = bank.sets.find(s => s.id === host.querySelector('#readingSet')?.value) || bank.sets[0];
    const type = host.querySelector('#readingType')?.value || 'all';
    const timed = mode !== 'practice' || host.querySelector('#readingTimed')?.checked;
    const ticket = generation, startedOwner = owner, token = authToken();
    starting = true;
    const status = host.querySelector('[data-start-status]');
    if (status) status.textContent = mode === 'full' ? 'Preparing your mixed mock and SWT passage…' : 'Preparing your questions…';
    try {
      let passage;
      if (mode === 'full') {
        const valid = p => p.id != null && typeof p.text === 'string' && p.text.length > 100 && p.keyElements && Object.values(p.keyElements).some(value => typeof value === 'string' && value.trim());
        let available = typeof passages !== 'undefined' && Array.isArray(passages) ? passages.filter(valid) : [];
        if (!available.length) {
          const response = await fetch((typeof API_URL !== 'undefined' ? API_URL : '') + '/api/passages', { signal: AbortSignal.timeout(15000) });
          if (!response.ok) throw Error('The SWT passage could not load. Please try again.');
          const data = await response.json();
          available = (Array.isArray(data) ? data : data.passages || []).filter(valid);
        }
        if (!available.length) throw Error('The SWT passage could not load. Please try again.');
        passage = available[Date.now() % available.length];
      }
      if (ticket !== generation || startedOwner !== identity() || token !== authToken()) return;
      let plan = mock.compose(bank, mode, set.id, passage);
      if (mode === 'diagnostic') plan = { questions: diagnostic(bank.sets), minutes: 15, name: 'Reading diagnostic' };
      if (mode === 'practice') {
        const questions = questionList(set).filter(q => type === 'all' || q.type === type);
        plan = { questions, minutes: questions.length * 2, name: labels[type] || 'Mixed reading practice' };
      }
      speaker?.cancel();
      state.session = { id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,8), mode, name: plan.name, questions: plan.questions, index: 0, answers: {}, assessments: {}, audioStates: {}, times: {}, flags: [], startedAt: Date.now(), deadline: timed ? Date.now() + plan.minutes * 60000 : null, done: false, checked: [] };
      selectedWord = ''; selectedParagraph = {}; examNotice = null; activeSince = Date.now(); persist(); render();
    } catch (error) {
      if (ticket === generation && startedOwner === identity() && status) status.textContent = error.message || 'This mock could not start. Please try again.';
    } finally { if (ticket === generation) starting = false; }
  }
  function home() {
    leave();
    const recent = state.history;
    host.innerHTML = `<div class="reading-intro"><p class="portal-eyebrow">IPT Brisbane · Reading</p><h2>Find your focus. Build your confidence.</h2><p>Practise a task, check your starting point, or rehearse with a timed mock.</p><p class="reading-note">Mocks and diagnostics use an exam screen: one question at a time, forward-only navigation, and explanations after submission. Your timer keeps running if you exit and return.</p></div>
      ${state.session ? `<div class="portal-resume"><div><strong>${escape(state.session.name)}</strong><p>${state.session.done ? 'Your answers and explanations are ready to review.' : 'Continue your saved session. Timed sessions keep counting while you are away.'}</p></div><button class="portal-button primary" data-action="resume">${state.session.done ? 'Review result' : 'Continue session'}</button></div>` : ''}
      <div class="reading-setup reading-card"><label>Question set<select id="readingSet">${bank.sets.map(s=>`<option value="${s.id}">${escape(s.name)} · ${s.questions.length} questions</option>`).join('')}</select></label><label>Practice task<select id="readingType"><option value="all">All reading tasks</option>${Object.entries(labels).map(([type,label])=>`<option value="${type}">${label}</option>`).join('')}</select></label><label class="reading-check"><input type="checkbox" id="readingTimed"> Timer for practice (2 minutes per question)</label></div>
      <div class="reading-modes">
        <article class="reading-card"><span class="reading-number">01 / PRACTISE</span><h3>Reading practice</h3><p>Dropdown blanks, drag-and-drop blanks, paragraphs and multiple choice. Check explanations as you go.</p><button class="portal-button primary" data-start="practice">Start practice</button></article>
        <article class="reading-card"><span class="reading-number">02 / DISCOVER</span><h3>Diagnostic test</h3><p>10 questions across all five tasks · 15 minutes. See strengths, missed answers and a focused next step.</p><button class="portal-button primary" data-start="diagnostic">Find my starting point</button></article>
        <article class="reading-card reading-mixed-card"><span class="reading-number">03 / CONNECT</span><h3>Full mixed reading mock</h3><p>45 minutes · Your selected reading set + 1 SWT + 2 Highlight Correct Summary + 2 C2-targeted Highlight Incorrect Words questions.</p><p class="reading-note">An IPT mixed mock. The highlight tasks add listening practice and up to 14 extra practice points. Marks are earned from your answers.</p><button class="portal-button primary" data-start="full">Start full mixed mock</button></article>
      </div>
      <div class="reading-section-heading"><h3>Sectional reading mocks</h3><p>Two complete reading sets. Audio highlight tasks appear only in the full mixed mock.</p></div>
      <div class="reading-sectionals">${bank.sectionalMocks.map((m,i)=>`<article class="reading-card"><span class="reading-number">MOCK 0${i+1}</span><h3>${escape(m.name)}</h3><p>${bank.sets.find(s=>s.id===m.setId).questions.length} questions · ${m.minutes} minutes · All five reading tasks</p><button class="portal-button" data-start="${m.id}">Start sectional ${i+1}</button></article>`).join('')}</div>
      <div class="reading-card reading-sound-check"><div><h3>Check your sound before the full mock</h3><p>Audio uses your device’s English speech voice. Each question plays once; interrupted playback can be retried. C2 is the intended difficulty of the HIW text, not a certified level.</p></div><button class="portal-button" data-action="soundcheck">Test audio</button><p data-sound-status role="status"></p></div>
      <p data-start-status role="status"></p><p class="reading-note">Starting a new session replaces your current draft. Completed results stay in your history. Progress is saved for this account on this browser; it does not sync between devices.</p>
      <div class="reading-card"><h3>Recent reading progress</h3>${recent.length ? `<ul class="reading-history">${recent.map((r,i)=>`<li><div><strong>${escape(r.name)}</strong><span>${escape(new Date(r.finishedAt).toLocaleDateString())} · ${r.earned}/${r.possible} graded points${r.percent==null?'':' · '+r.percent+'%'}${r.pending?' · SWT awaiting grade':''}${r.excluded?' · '+r.excluded+' audio items excluded':''}</span></div><button class="portal-button" data-history="${i}">Review</button></li>`).join('')}</ul>` : '<p>Your completed practice, diagnostics and mocks will appear here.</p>'}</div>`;
  }
  function render() { if (!state.session) return home(); renderSession(); }
  function renderSession() {
    viewingQuestion = true; activeSince = Date.now();
    const s=state.session, q=s.questions[s.index], a=s.answers[q.uid]||[];
    const testing=exam.isExam(s)&&!s.done;
    setExamMode(testing);
    if(testing) {
      host.innerHTML=exam.render({session:s,question:q,content:questionHTML(q,a),audio:mock.isAudio(q)?audioHTML(q):'',timer:timerText(),saved:saveNotice,notice:examNotice});
      return;
    }
    const review=s.done || s.checked.includes(q.uid);
    host.innerHTML = `<div class="reading-session-toolbar"><button class="portal-button" data-action="home">← Reading home</button><strong>${escape(s.name)}</strong><span class="reading-timer" data-timer>${timerText()}</span><span data-save-status role="status">${escape(saveNotice)}</span></div>
      ${s.done ? summary() : ''}
      <div class="reading-layout"><aside class="reading-card reading-nav" aria-label="Reading questions"><h3>${s.done ? 'Review answers' : 'Your questions'}</h3><div class="reading-question-grid">${s.questions.map((item,i)=>`<button class="portal-button ${i===s.index?'primary':''}" data-question="${i}" ${i===s.index?'aria-current="step"':''} aria-label="Question ${i+1}${s.flags.includes(item.uid)?', flagged':''}${s.answers[item.uid]?.some(x=>x!==''&&x!=null)?', answered':''}">${i+1}${s.flags.includes(item.uid)?' ⚑':''}${s.answers[item.uid]?.some(x=>x!==''&&x!=null)?' •':''}</button>`).join('')}</div><p class="reading-note">• Answered · ⚑ Flagged</p></aside>
      <article class="reading-card reading-question"><div class="reading-question-heading"><span class="portal-eyebrow">Question ${s.index+1} of ${s.questions.length} · ${taskLabels[q.type]}</span><button class="portal-button" data-action="flag" aria-pressed="${s.flags.includes(q.uid)}">${s.flags.includes(q.uid)?'Unflag':'Flag for review'}</button></div><h2>${taskLabels[q.type]}${q.cefrTarget?' · '+escape(q.cefrTarget):''}</h2><p>${escape(q.instructions)}</p>
      ${mock.isAudio(q)?audioHTML(q):''}
      <fieldset ${review?'disabled':''}><legend class="sr-only">Your answer</legend>${questionHTML(q,a)}</fieldset>
      ${review?explanation(q,a):''}
      <div class="reading-actions"><button class="portal-button" data-move="-1" ${s.index===0?'disabled':''}>Previous</button><button class="portal-button" data-move="1" ${s.index===s.questions.length-1?'disabled':''}>Next question</button>${!s.done&&s.mode==='practice'&&!review?'<button class="portal-button primary" data-action="check">Check answer</button>':''}${!s.done?'<button class="portal-button primary" data-action="submit">Finish and review</button>':''}</div></article></div>`;
  }
  function audioHTML(q) {
    const s = state.session, item = s.audioStates?.[q.uid], locked = !s.done && ['loading','playing','complete'].includes(item?.status);
    return `<div class="reading-audio"><button class="portal-button primary" data-action="play" ${locked?'disabled':''}>${s.done?'Replay for review':item?.status==='complete'?'Audio played':item?.status==='error'?'Retry audio':'Play audio'}</button><span data-audio-status role="status">${escape(item?.message || 'Listen once, then answer. Check that your sound is on.')}</span></div>`;
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
    if (!s.done) { s.audioStates[key] = { status, message }; persist(); }
    if (viewingQuestion && s.questions[s.index].uid === key) {
      const el = host.querySelector('[data-audio-status]'); if (el) el.textContent = message;
      const button = host.querySelector('[data-action="play"]');
      if (button) { button.disabled = ['loading','playing'].includes(status) || (!s.done && status==='complete'); button.textContent = s.done ? 'Replay for review' : status==='complete' ? 'Audio played' : status==='error' ? 'Retry audio' : 'Playing…'; }
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
    return `<div class="reading-multiple-choice ${q.passage?'reading-has-passage':''}">${q.passage?`<p class="reading-passage">${escape(q.passage)}</p>`:''}<div class="reading-choice-options">${q.prompt?`<h3>${escape(q.prompt)}</h3>`:''}${q.choices.map((choice,i)=>`<label class="reading-choice"><input type="${q.type==='mcma'?'checkbox':'radio'}" name="readingChoice" data-choice="${i}" ${a.includes(i)?'checked':''}>${escape(choice)}</label>`).join('')}</div></div>`;
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
    const display=value=>['mcma','mcsa','hcs'].includes(q.type)?q.choices[value]:q.type==='reorder'?q.items.find(i=>i.key===value)?.text:q.type==='hiw'?`Word ${value+1}: ${q.corrections.find(c=>c.index===value).written} → ${q.corrections.find(c=>c.index===value).spoken}`:value;
    return `<section class="reading-explanation"><h3>${excluded?'Audio item excluded':(p.earned===p.possible?'Well done':'Review this answer')+' · '+p.earned+'/'+p.possible}</h3>${excluded?'<p>Audio did not complete before submission. This item is excluded from your graded total. You can replay it for review.</p>':''}<ol>${actual.map((correct,i)=>`<li><strong>${q.type==='dropdown'||q.type==='wordbank'?'Blank '+(i+1)+': ':''}${escape(display(correct))}</strong></li>`).join('')}</ol><p>${escape(info.correct||'Compare your response with the answer above, then reread the surrounding passage for the supporting meaning.')}</p>${info.options?`<details><summary>Why other options do not fit</summary><ul>${Object.entries(info.options).map(([option,reason])=>`<li><strong>${escape(option)}:</strong> ${escape(reason)}</li>`).join('')}</ul></details>`:''}${q.audioText?`<details><summary>Audio transcript</summary><p>${escape(q.audioText)}</p></details>`:''}</section>`;
  }
  function summary() {
    const s=state.session, { rows, earned, possible, percent, pending, excluded }=totals(s);
    const weakest=rows.filter(r=>r.gradedPossible).sort((a,b)=>a.earned/a.gradedPossible-b.earned/b.gradedPossible)[0];
    const unanswered=s.questions.filter(q=>!s.answers[q.uid]?.some(x=>x!==''&&x!=null)).length;
    const grading=s.questions.some(q=>q.type==='swt'&&s.assessments?.[q.uid]?.status==='working');
    return `<section class="reading-card reading-report"><p class="portal-eyebrow">IPT Brisbane · ${s.mode==='diagnostic'?'Your diagnostic snapshot':'Session complete'}</p><h2>${percent==null?'Awaiting results':percent+'% accuracy · '+earned+'/'+possible+' graded points'}</h2>${grading?`<div class="ipt-assessment-status" role="status" aria-live="polite"><img class="ipt-assessment-logo" src="assets/ipt-brisbane-logo.png" alt="IPT Brisbane — IELTS and PTE Tutorial" width="112" height="68"><p>IPT Brisbane’s AI scoring engine is analysing your response…</p></div>`:''}<p>${unanswered} unanswered questions · ${Math.max(1,Math.round((s.finishedAt-s.startedAt)/60000))} minutes elapsed</p>${pending||excluded?`<p role="status">${pending?pending+' SWT response awaiting grade. ':''}${excluded?excluded+' audio items excluded because playback did not complete. ':''}These items are outside the graded total.</p>`:''}<p class="reading-note">IPT Brisbane practice points, not an official PTE score or a full language-level assessment. Previously practised questions can make this result less representative.${s.mode==='full'?' This custom mixed mock includes SWT and listening tasks that also exercise reading.':''}</p><div class="reading-table-wrap"><table><thead><tr><th>Task</th><th>Graded points</th><th>Accuracy</th><th>Active time</th></tr></thead><tbody>${rows.map(r=>`<tr><th>${r.label}</th><td>${r.gradedPossible?r.earned+'/'+r.gradedPossible:'—'}${r.pending?' · Pending':''}${r.excluded?' · '+r.excluded+' excluded':''}</td><td>${r.gradedPossible?Math.round(r.earned/r.gradedPossible*100)+'%':'—'}</td><td>${Math.round(s.questions.filter(q=>q.type===r.type).reduce((n,q)=>n+(s.times[q.uid]||0),0)/1000)}s</td></tr>`).join('')}</tbody></table></div><div class="reading-next"><strong>${!weakest?'Review the available feedback':earned===possible?'Keep building consistency':'Your next practice focus: '+weakest.label}</strong><p>${weakest&&earned===possible?'Try another question set and keep checking the evidence for every choice.':'Review the missed answers below, then practise without a timer before trying another timed session.'}</p></div></section>`;
  }
  function timerText() { const left=remaining(state.session, state.session.done ? state.session.finishedAt : Date.now()); return left===null?'Untimed practice':`${String(Math.floor(left/60)).padStart(2,'0')}:${String(left%60).padStart(2,'0')}${state.session.done?' · Finished':''}`; }
  function tick() {
    if (!owner || identity()!==owner) return reset();
    if (!state?.session || state.session.done) return;
    recordTime();
    if(remaining(state.session)===0) return finish();
    const timer=host.querySelector('[data-timer]'); if(timer)timer.textContent=timerText();
    if(timer)timer.dataset.urgent=String(remaining(state.session)<=300);
    if (Date.now() - lastPersisted >= 10000) persist();
  }
  function finish() {
    const s=state.session; if(!s||s.done)return;
    recordTime(); speaker?.cancel(); s.done=true; s.finishedAt=Date.now(); selectedWord=''; examNotice=null; selectedParagraph={};
    syncHistory(s); persist(); render();
    s.questions.filter(q=>q.type==='swt'&&String(s.answers[q.uid]?.[0]||'').trim()).forEach(q=>gradeSwt(q));
  }
  function syncHistory(s) {
    const { earned, possible, percent, pending, excluded }=totals(s);
    const entry={...JSON.parse(JSON.stringify(s)),earned,possible,percent,pending,excluded};
    state.history=[entry,...state.history.filter(r=>r.id!==s.id)].sort((a,b)=>b.finishedAt-a.finishedAt).slice(0,30);
  }
  async function gradeSwt(q) {
    const s=state.session;
    const jobKey=s?.id+':'+q.uid;
    if (!s?.done || pendingGrades.has(jobKey) || !String(s.answers[q.uid]?.[0]||'').trim()) return;
    const ticket=generation, gradingOwner=owner, token=authToken();
    const job={}; pendingGrades.set(jobKey,job);
    s.assessments[q.uid]={status:'working',message:'IPT Brisbane’s AI scoring engine is analysing your response…'};
    syncHistory(s); persist(); if(viewingQuestion)renderSession();
    try {
      if (typeof requestSwtGrade !== 'function') throw Error('SWT grading is unavailable. Your response is saved; please retry.');
      const result=await requestSwtGrade({type:'swt',passageId:q.passageId,prompt:q.passage,keyPoints:q.keyPoints,text:s.answers[q.uid][0],userId:gradingOwner});
      if (ticket!==generation || gradingOwner!==identity() || token!==authToken()) return;
      const pending=mock.scoreExtra(q,s.answers[q.uid],{result}).pending;
      s.assessments[q.uid]={status:pending?'error':'complete',result,message:pending?'The grader returned a provisional result. Retry to obtain a confirmed SWT grade.':'Assessment by IPT Brisbane’s AI scoring engine is complete.'};
    } catch (error) {
      if (ticket!==generation || gradingOwner!==identity() || token!==authToken()) return;
      s.assessments[q.uid]={status:'error',message:error.message||'SWT grading could not finish. Your response is saved; please retry.'};
    } finally {
      if (pendingGrades.get(jobKey)===job) pendingGrades.delete(jobKey);
    }
    // An in-flight grade belongs to this completed attempt, even after a new mock starts.
    if (state.session?.id===s.id) state.session.assessments=s.assessments;
    syncHistory(s); persist();
    if (viewingQuestion && state.session?.id===s.id) renderSession();
    else if (!viewingQuestion && !host.hidden) home();
  }
  function editable() { const s=state?.session; return s&&!s.done&&!s.checked.includes(s.questions[s.index].uid); }
  function change(e) {
    if(!owner||identity()!==owner||!editable())return;
    const q=state.session.questions[state.session.index];
    if(e.target.dataset.answer!==undefined) {
      const a=state.session.answers[q.uid]||[];a[Number(e.target.dataset.answer)]=e.target.value;state.session.answers[q.uid]=a;
    } else if(e.target.dataset.choice!==undefined) state.session.answers[q.uid]=[...host.querySelectorAll('[data-choice]:checked')].map(x=>Number(x.dataset.choice));
    persist();
  }
  function input(e) {
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
    if(remaining(s)===0||s.index===s.questions.length-1)return finish();
    recordTime();speaker?.cancel();s.index++;selectedWord='';selectedParagraph={};persist();renderSession();
    host.querySelector('[data-exam-title]')?.focus();
  }
  function examAction(action) {
    const s=state.session,q=s.questions[s.index];
    if(action==='exam-stay'){examNotice=null;renderSession();host.querySelector('[data-action="exam-next"]')?.focus();return;}
    if(action==='exam-confirm'){
      const pending=examNotice?.action;if(!pending)return;examNotice=null;
      if(pending==='exit')return home();
      if(pending==='submit')return finish();
      return advanceExam();
    }
    if(action==='exam-exit'){
      persist();examNotice={action:'exit',message:'Leave the test screen? The timer will keep running. Resume this question from Reading home. '+saveNotice+'.'};
    }else if(action==='exam-next'){
      const message=exam.needsAttention(q,s.answers[q.uid]||[],s.audioStates[q.uid]);
      if(s.index===s.questions.length-1)examNotice={action:'submit',message:(message?message+' ':'')+'This is the final question. Submit your test to view the results?'};
      else if(message)examNotice={action:'next',message};
      else return advanceExam();
    }
    renderSession();host.querySelector('[data-action="exam-stay"]')?.focus();
  }
  function click(e) {
    if(!owner||identity()!==owner||!state)return;
    const b=e.target.closest('button');if(!b||b.disabled)return;
    const d=b.dataset,s=state.session;
    if(d.start){if(s&&!s.done&&!confirm('Start a new reading session? This replaces your current reading draft.'))return;return start(d.start);}
    if(d.action==='soundcheck')return speaker.play('soundcheck','Welcome to IPT Brisbane. If you can hear this sentence, your audio is ready for the mixed reading mock.');
    if(d.history!==undefined){if(s&&!s.done&&!confirm('Review this result? Your current reading draft will be replaced.'))return;speaker?.cancel();state.session=JSON.parse(JSON.stringify(state.history[Number(d.history)]));repairSession(state.session);persist();return render();}
    if(d.action==='home')return home();
    if(d.action==='resume')return render();
    if(!s)return;
    recordTime();const q=s.questions[s.index];
    const testing=exam.isExam(s)&&!s.done;
    if(testing&&d.action?.startsWith('exam-'))return examAction(d.action);
    // Exam questions can only advance through Next; review unlocks after submission.
    if(testing&&(d.question!==undefined||d.move!==undefined||d.action==='flag'||d.action==='check'))return;
    if(d.action==='play'&&mock.isAudio(q)){if(!s.done&&['loading','playing','complete'].includes(s.audioStates[q.uid]?.status))return;return speaker.play(q.uid,q.audioText);}
    if(d.action==='retry-swt'&&q.type==='swt')return gradeSwt(q);
    if(d.question!==undefined||d.move!==undefined){speaker?.cancel();s.index=Math.max(0,Math.min(s.questions.length-1,d.question!==undefined?Number(d.question):s.index+Number(d.move)));selectedWord='';persist();return renderSession();}
    if(d.action==='flag'){s.flags=s.flags.includes(q.uid)?s.flags.filter(x=>x!==q.uid):[...s.flags,q.uid];persist();return renderSession();}
    if(d.action==='submit'){if(confirm('Finish this reading session and show the answers?'))finish();return;}
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
  return { open, leave, reset, score, diagnostic, report, remaining, storageKey, totals };
});
