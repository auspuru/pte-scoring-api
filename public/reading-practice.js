/* Reading is a native portal pane; it does not contact the former mock service. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReadingPractice = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const labels = { dropdown: 'Dropdown blanks', wordbank: 'Drag-and-drop blanks', reorder: 'Reorder paragraphs', mcsa: 'Single answer', mcma: 'Multiple answers' };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function score(q, answer = []) {
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
  function report(questions, answers) {
    return Object.entries(labels).map(([type, label]) => {
      const items = questions.filter(q => q.type === type);
      const points = items.map(q => score(q, answers[q.uid]));
      return { type, label, count: items.length, earned: points.reduce((n,p)=>n+p.earned,0), possible: points.reduce((n,p)=>n+p.possible,0) };
    }).filter(row => row.count);
  }
  function storageKey(owner) { return 'ipt_reading_v1:' + encodeURIComponent(String(owner).trim().toLowerCase()); }
  function remaining(session, now = Date.now()) { return session.deadline ? Math.max(0, Math.ceil((session.deadline - now) / 1000)) : null; }
  let host, bank, owner = '', state, generation = 0, interval, selectedWord = '', saveNotice = '';
  let activeSince = 0, viewingQuestion = false, lastPersisted = 0;
  const initialState = () => ({ session: null, history: [] });
  function identity() { return typeof currentUserId !== 'undefined' ? String(currentUserId).trim().toLowerCase() : ''; }
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
    if (host) host.replaceChildren();
  }
  async function open() {
    const nextOwner = identity();
    if (!nextOwner) return;
    if (owner === nextOwner && state && bank) { activeSince = Date.now(); tick(); return; }
    reset(); owner = nextOwner; host = document.getElementById('readingPane');
    const requestGeneration = generation;
    host.innerHTML = '<div class="reading-card" role="status">Preparing your reading practice…</div>';
    try {
      if (!bank) {
        const response = await fetch('reading-bank.json?v=1', { signal: AbortSignal.timeout(15000) });
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
      host.onclick = click; host.onchange = change;
      host.ondragstart = e => { const word=e.target.closest('[data-word]'); if(word) { selectedWord=word.dataset.word; e.dataTransfer.setData('text/plain', selectedWord); } };
      host.ondragover = e => { if(e.target.closest('[data-blank]'))e.preventDefault(); };
      host.ondrop = e => { const blank=e.target.closest('[data-blank]'); if(blank){e.preventDefault(); place(Number(blank.dataset.blank),e.dataTransfer.getData('text/plain'));} };
      render(); interval = setInterval(tick, 1000); activeSince = Date.now(); tick();
    } catch (_) {
      if (requestGeneration !== generation) return;
      host.innerHTML = '<div class="reading-card" role="alert"><h2>Reading could not load</h2><p>Your writing workspace is still available.</p><button class="portal-button" data-action="reload">Try again</button></div>';
      host.onclick = () => { reset(); open(); };
    }
  }
  function questionList(set) { return set.questions.map(q => ({ ...q, uid: set.id + ':' + q.id, reasoning: set.reasoning[q.id] || {} })); }
  function start(mode) {
    const set = bank.sets.find(s => s.id === host.querySelector('#readingSet').value) || bank.sets[0];
    const type = host.querySelector('#readingType').value;
    let questions = mode === 'diagnostic' ? diagnostic(bank.sets) : questionList(set);
    if (mode === 'practice') questions = questions.filter(q => type === 'all' || q.type === type);
    const timed = mode !== 'practice' || host.querySelector('#readingTimed').checked;
    const minutes = mode === 'mock' ? set.minutes : mode === 'diagnostic' ? 15 : questions.length * 2;
    state.session = { id: Date.now().toString(36), mode, name: mode === 'mock' ? set.name : mode === 'diagnostic' ? 'Reading diagnostic' : labels[type] || 'Mixed reading practice', questions, index: 0, answers: {}, times: {}, flags: [], startedAt: Date.now(), deadline: timed ? Date.now() + minutes * 60000 : null, done: false, checked: [] };
    selectedWord = ''; activeSince = Date.now(); persist(); render();
  }
  function home() {
    recordTime(); viewingQuestion = false; persist();
    const recent = state.history;
    host.innerHTML = `<div class="reading-intro"><p class="portal-eyebrow">IPT Brisbane · Reading</p><h2>Find your focus. Build your confidence.</h2><p>Practise a task, check your starting point, or complete a full reading mock.</p></div>
      ${state.session ? `<div class="portal-resume"><div><strong>${escape(state.session.name)}</strong><p>${state.session.done ? 'Your answers and explanations are ready to review.' : 'Continue your saved session. Timed sessions keep counting while you are away.'}</p></div><button class="portal-button primary" data-action="resume">${state.session.done ? 'Review result' : 'Continue session'}</button></div>` : ''}
      <div class="reading-setup reading-card"><label>Question set<select id="readingSet">${bank.sets.map(s=>`<option value="${s.id}">${escape(s.name)} · ${s.questions.length} questions</option>`).join('')}</select></label><label>Practice task<select id="readingType"><option value="all">All reading tasks</option>${Object.entries(labels).map(([type,label])=>`<option value="${type}">${label}</option>`).join('')}</select></label><label class="reading-check"><input type="checkbox" id="readingTimed"> Timer for practice (2 minutes per question)</label></div>
      <div class="reading-modes">
        <article class="reading-card"><span class="reading-number">01 / PRACTISE</span><h3>Reading practice</h3><p>Dropdown blanks, drag-and-drop blanks, paragraphs and multiple choice. Check explanations as you go.</p><button class="portal-button primary" data-start="practice">Start practice</button></article>
        <article class="reading-card"><span class="reading-number">02 / DISCOVER</span><h3>Diagnostic test</h3><p>10 questions across all five tasks · 15 minutes. See strengths, missed answers and a focused next step.</p><button class="portal-button primary" data-start="diagnostic">Find my starting point</button></article>
        <article class="reading-card"><span class="reading-number">03 / REHEARSE</span><h3>Full reading mock</h3><p>Complete your selected question set in 25 minutes. Review answers and explanations after submission.</p><button class="portal-button primary" data-start="mock">Start reading mock</button></article>
      </div><p class="reading-note">Starting a new session replaces your current draft. Completed results stay in your history. Progress is saved for this account on this browser; it does not sync between devices.</p>
      <div class="reading-card"><h3>Recent reading progress</h3>${recent.length ? `<ul class="reading-history">${recent.map((r,i)=>`<li><div><strong>${escape(r.name)}</strong><span>${escape(new Date(r.finishedAt).toLocaleDateString())} · ${r.earned}/${r.possible} points · ${r.percent}%</span></div><button class="portal-button" data-history="${i}">Review</button></li>`).join('')}</ul>` : '<p>Your completed practice, diagnostics and mocks will appear here.</p>'}</div>`;
  }
  function render() { if (!state.session) return home(); renderSession(); }
  function renderSession() {
    viewingQuestion = true; activeSince = Date.now();
    const s=state.session, q=s.questions[s.index], a=s.answers[q.uid]||[];
    const review=s.done || s.checked.includes(q.uid);
    host.innerHTML = `<div class="reading-session-toolbar"><button class="portal-button" data-action="home">← Reading home</button><strong>${escape(s.name)}</strong><span class="reading-timer" data-timer>${timerText()}</span><span data-save-status role="status">${escape(saveNotice)}</span></div>
      ${s.done ? summary() : ''}
      <div class="reading-layout"><aside class="reading-card reading-nav" aria-label="Reading questions"><h3>${s.done ? 'Review answers' : 'Your questions'}</h3><div class="reading-question-grid">${s.questions.map((item,i)=>`<button class="portal-button ${i===s.index?'primary':''}" data-question="${i}" ${i===s.index?'aria-current="step"':''} aria-label="Question ${i+1}${s.flags.includes(item.uid)?', flagged':''}${s.answers[item.uid]?.some(x=>x!==''&&x!=null)?', answered':''}">${i+1}${s.flags.includes(item.uid)?' ⚑':''}${s.answers[item.uid]?.some(x=>x!==''&&x!=null)?' •':''}</button>`).join('')}</div><p class="reading-note">• Answered · ⚑ Flagged</p></aside>
      <article class="reading-card reading-question"><div class="reading-question-heading"><span class="portal-eyebrow">Question ${s.index+1} of ${s.questions.length} · ${labels[q.type]}</span><button class="portal-button" data-action="flag" aria-pressed="${s.flags.includes(q.uid)}">${s.flags.includes(q.uid)?'Unflag':'Flag for review'}</button></div><h2>${labels[q.type]}</h2><p>${escape(q.instructions)}</p>
      <fieldset ${review?'disabled':''}><legend class="sr-only">Your answer</legend>${questionHTML(q,a)}</fieldset>
      ${review?explanation(q,a):''}
      <div class="reading-actions"><button class="portal-button" data-move="-1" ${s.index===0?'disabled':''}>Previous</button><button class="portal-button" data-move="1" ${s.index===s.questions.length-1?'disabled':''}>Next question</button>${!s.done&&s.mode==='practice'&&!review?'<button class="portal-button primary" data-action="check">Check answer</button>':''}${!s.done?'<button class="portal-button primary" data-action="submit">Finish and review</button>':''}</div></article></div>`;
  }
  function questionHTML(q,a) {
    if(q.type==='dropdown'||q.type==='wordbank') {
      const passage=escape(q.passage).replace(/\[\[(\d+)\]\]/g, (_,n)=>{
        const i=Number(n)-1;
        if(q.type==='dropdown') return `<select data-answer="${i}" aria-label="Blank ${n}"><option value="">Choose…</option>${q.options[i].map(x=>`<option ${a[i]===x?'selected':''} value="${escape(x)}">${escape(x)}</option>`).join('')}</select>`;
        return `<button type="button" class="reading-blank" data-blank="${i}" aria-label="Blank ${n}: ${escape(a[i]||'empty')}">${escape(a[i]||'Blank '+n)}</button>${a[i]?`<button type="button" class="reading-clear" data-clear="${i}" aria-label="Clear blank ${n}">×</button>`:''}`;
      });
      return `<p class="reading-passage">${passage}</p>${q.type==='wordbank'?`<p class="reading-note">Drag a word into a blank, or select a word and then select a blank. Select × to return a word.</p><div class="reading-wordbank">${q.bank.map(w=>`<button type="button" draggable="true" data-word="${escape(w)}" class="portal-button" aria-pressed="${selectedWord===w}" ${a.includes(w)?'disabled':''}>${escape(w)}</button>`).join('')}</div>`:''}`;
    }
    if(q.type==='reorder') {
      const order=a.length?a:q.items.map(x=>x.key);
      return `<ol class="reading-reorder">${order.map((key,i)=>`<li><p>${escape(q.items.find(x=>x.key===key).text)}</p><div><button class="portal-button" data-reorder="${i}" data-direction="-1" ${i===0?'disabled':''} aria-label="Move paragraph ${i+1} up">↑</button><button class="portal-button" data-reorder="${i}" data-direction="1" ${i===order.length-1?'disabled':''} aria-label="Move paragraph ${i+1} down">↓</button></div></li>`).join('')}</ol><p class="reading-note">Use the arrows to order the paragraphs. ${!a.length?'Move a paragraph to record your answer.':''}</p>`;
    }
    return `<p class="reading-passage">${escape(q.passage)}</p>${q.prompt?`<h3>${escape(q.prompt)}</h3>`:''}${q.choices.map((choice,i)=>`<label class="reading-choice"><input type="${q.type==='mcma'?'checkbox':'radio'}" name="readingChoice" data-choice="${i}" ${a.includes(i)?'checked':''}>${escape(choice)}</label>`).join('')}`;
  }
  function explanation(q,a) {
    const p=score(q,a), info=q.reasoning||{};
    const actual=q.type==='mcsa'?[q.answer]:q.answers;
    const display=value=>q.type==='mcma'||q.type==='mcsa'?q.choices[value]:q.type==='reorder'?q.items.find(i=>i.key===value)?.text:value;
    return `<section class="reading-explanation"><h3>${p.earned===p.possible?'Well done':'Review this answer'} · ${p.earned}/${p.possible}</h3><ol>${actual.map((correct,i)=>`<li><strong>${q.type==='dropdown'||q.type==='wordbank'?'Blank '+(i+1)+': ':''}${escape(display(correct))}</strong></li>`).join('')}</ol><p>${escape(info.correct||'Compare your response with the answer above, then reread the surrounding passage for the supporting meaning.')}</p>${info.options?`<details><summary>Why other options do not fit</summary><ul>${Object.entries(info.options).map(([option,reason])=>`<li><strong>${escape(option)}:</strong> ${escape(reason)}</li>`).join('')}</ul></details>`:''}</section>`;
  }
  function summary() {
    const s=state.session, rows=report(s.questions,s.answers), earned=rows.reduce((n,r)=>n+r.earned,0), possible=rows.reduce((n,r)=>n+r.possible,0);
    const weakest=[...rows].sort((a,b)=>a.earned/a.possible-b.earned/b.possible)[0];
    const unanswered=s.questions.filter(q=>!s.answers[q.uid]?.some(x=>x!==''&&x!=null)).length;
    return `<section class="reading-card reading-report"><p class="portal-eyebrow">${s.mode==='diagnostic'?'Your diagnostic snapshot':'Session complete'}</p><h2>${Math.round(earned/possible*100)}% accuracy · ${earned}/${possible} points</h2><p>${unanswered} unanswered questions · ${Math.max(1,Math.round((s.finishedAt-s.startedAt)/60000))} minutes elapsed</p><p class="reading-note">Practice feedback from this question set, not an official PTE score or a full language-level assessment. Previously practised questions can make this result less representative.</p><div class="reading-table-wrap"><table><thead><tr><th>Task</th><th>Points</th><th>Accuracy</th><th>Active time</th></tr></thead><tbody>${rows.map(r=>`<tr><th>${r.label}</th><td>${r.earned}/${r.possible}</td><td>${Math.round(r.earned/r.possible*100)}%</td><td>${Math.round(s.questions.filter(q=>q.type===r.type).reduce((n,q)=>n+(s.times[q.uid]||0),0)/1000)}s</td></tr>`).join('')}</tbody></table></div><div class="reading-next"><strong>${earned===possible?'Keep building consistency':'Your next practice focus: '+weakest.label}</strong><p>${earned===possible?'Try another question set and keep checking the evidence for every choice.':'Review the missed answers below, then practise this task without a timer before trying another timed session.'}</p></div></section>`;
  }
  function timerText() { const left=remaining(state.session, state.session.done ? state.session.finishedAt : Date.now()); return left===null?'Untimed practice':`${String(Math.floor(left/60)).padStart(2,'0')}:${String(left%60).padStart(2,'0')}${state.session.done?' · Finished':''}`; }
  function tick() {
    if (!owner || identity()!==owner) return reset();
    if (!state?.session || state.session.done) return;
    recordTime();
    if(remaining(state.session)===0) return finish();
    const timer=host.querySelector('[data-timer]'); if(timer)timer.textContent=timerText();
    if (Date.now() - lastPersisted >= 10000) persist();
  }
  function finish() {
    const s=state.session; if(!s||s.done)return;
    recordTime(); s.done=true; s.finishedAt=Date.now(); selectedWord='';
    const rows=report(s.questions,s.answers), earned=rows.reduce((n,r)=>n+r.earned,0),possible=rows.reduce((n,r)=>n+r.possible,0);
    state.history=[{...JSON.parse(JSON.stringify(s)),earned,possible,percent:Math.round(earned/possible*100)},...state.history.filter(r=>r.id!==s.id)].slice(0,30);
    persist(); render();
  }
  function editable() { const s=state?.session; return s&&!s.done&&!s.checked.includes(s.questions[s.index].uid); }
  function change(e) {
    if(!editable())return;
    const q=state.session.questions[state.session.index];
    if(e.target.dataset.answer!==undefined) {
      const a=state.session.answers[q.uid]||[];a[Number(e.target.dataset.answer)]=e.target.value;state.session.answers[q.uid]=a;
    } else if(e.target.dataset.choice!==undefined) state.session.answers[q.uid]=[...host.querySelectorAll('[data-choice]:checked')].map(x=>Number(x.dataset.choice));
    persist();
  }
  function place(index,word) {
    if(!editable())return;
    const q=state.session.questions[state.session.index];
    if(q.type!=='wordbank'||!q.bank.includes(word)||index<0||index>=q.answers.length)return;
    const a=state.session.answers[q.uid]||[];
    const previous=a.indexOf(word); if(previous>=0)a[previous]=''; a[index]=word;
    state.session.answers[q.uid]=a;selectedWord='';persist();renderSession();
  }
  function click(e) {
    const b=e.target.closest('button');if(!b||b.disabled)return;
    const d=b.dataset,s=state.session;
    if(d.start){if(s&&!s.done&&!confirm('Start a new reading session? This replaces your current reading draft.'))return;return start(d.start);}
    if(d.history!==undefined){if(s&&!s.done&&!confirm('Review this result? Your current reading draft will be replaced.'))return;state.session=JSON.parse(JSON.stringify(state.history[Number(d.history)]));persist();return render();}
    if(d.action==='home')return home();
    if(d.action==='resume')return render();
    if(!s)return;
    recordTime();const q=s.questions[s.index];
    if(d.question!==undefined||d.move!==undefined){s.index=Math.max(0,Math.min(s.questions.length-1,d.question!==undefined?Number(d.question):s.index+Number(d.move)));selectedWord='';persist();return renderSession();}
    if(d.action==='flag'){s.flags=s.flags.includes(q.uid)?s.flags.filter(x=>x!==q.uid):[...s.flags,q.uid];persist();return renderSession();}
    if(d.action==='submit'){if(confirm('Finish this reading session and show the answers?'))finish();return;}
    if(!editable())return;
    if(d.action==='check'){s.checked.push(q.uid);persist();return renderSession();}
    if(d.word!==undefined){selectedWord=d.word;host.querySelectorAll('[data-word]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.word===selectedWord)));return;}
    if(d.blank!==undefined)return place(Number(d.blank),selectedWord);
    if(d.clear!==undefined){(s.answers[q.uid]||[])[Number(d.clear)]='';persist();return renderSession();}
    if(d.reorder!==undefined){const a=s.answers[q.uid]||q.items.map(x=>x.key),i=Number(d.reorder),j=i+Number(d.direction);[a[i],a[j]]=[a[j],a[i]];s.answers[q.uid]=a;persist();return renderSession();}
  }
  return { open, reset, score, diagnostic, report, remaining, storageKey };
});
