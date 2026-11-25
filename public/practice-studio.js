(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./practice-catalogue') : root.PracticeCatalogue);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.PracticeStudio = api; api.install(root); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (catalogue) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const routes = new Set(['practice-hub', ...catalogue.groups.flatMap(g => g.tasks.map(t => t.route))]);
  function navigation(skill, active, { disabled = false } = {}) {
    const group = catalogue.groups.find(g => g.id === skill);
    if (!group) return '';
    return '<nav class="practice-studio-taskbar" aria-label="'+esc(group.title)+' tasks">'
      + '<button type="button" class="practice-studio-home" data-studio-route="practice-hub" '+(disabled?'disabled':'')+'>← All practice</button>'
      + '<details class="practice-studio-switcher"><summary>Change task</summary><div class="practice-studio-tasklinks">'+group.tasks.map(task => '<button type="button" data-studio-route="'+esc(task.route)+'" '+(active===task.route?'aria-current="page" ':'')+(disabled?'disabled':'')+'>'+esc(task.label)+'</button>').join('')+'</div></details></nav>';
  }
  function heading(skill, title, description, badge = '') {
    return '<header class="practice-studio-heading"><div><p class="practice-studio-eyebrow">'+esc(skill)+' practice</p><h2>'+esc(title)+'</h2>'+(description?'<p class="practice-studio-description">'+esc(description)+'</p>':'')+'</div>'+(badge?'<span class="practice-studio-badge">'+esc(badge)+'</span>':'')+'</header>';
  }
  function wrap(skill, active, content) {
    return '<div class="practice-studio">'+navigation(skill, active)+'<div class="practice-studio-content">'+content+'</div></div>';
  }
  function install(env) {
    const doc = env.document;
    if (!doc || doc.__practiceStudioInstalled) return;
    doc.__practiceStudioInstalled = true;
    (doc.querySelectorAll?.('[data-studio-navigation]') || []).forEach(node => {
      node.innerHTML = navigation(node.dataset.studioNavigation, node.dataset.studioActive);
    });
    doc.addEventListener?.('click', event => {
      const button = event.target.closest?.('button[data-studio-route]');
      if (!button || button.disabled || !routes.has(button.dataset.studioRoute)) return;
      const switcher = button.closest?.('.practice-studio-switcher');
      if (switcher) switcher.open = false;
      env.switchSection?.(button.dataset.studioRoute);
    });
    doc.addEventListener?.('keydown', event => {
      if (event.key !== 'Escape') return;
      const switcher = event.target.closest?.('.practice-studio-switcher[open]');
      if (!switcher) return;
      switcher.open = false;
      switcher.querySelector?.('summary')?.focus();
    });
    doc.addEventListener?.('paste', event => {
      const field = event.target;
      if (event.defaultPrevented || !field.matches?.('.practice-question-library input[type="search"]')) return;
      const text = event.clipboardData?.getData('text/plain');
      if (!text || !/[\r\n\t]/.test(text)) return;
      event.preventDefault();
      field.setRangeText(text.replace(/\s+/g, ' '), field.selectionStart, field.selectionEnd, 'end');
      field.dispatchEvent(new env.Event('input', { bubbles: true }));
    });
  }
  function focusQuestion(host, selector='[data-question-heading], h2, h1') {
    const heading=host?.querySelector?.(selector);
    if(!heading)return;
    heading.setAttribute('tabindex','-1');
    heading.focus({preventScroll:true});
    heading.scrollIntoView?.({block:'start',behavior:'instant'});
  }
  function pinNavigation(host, selector) {
    const dock=host?.querySelector?.(selector);
    const content=host?.querySelector?.('.studio-center, .practice-studio-content')||host;
    if(!dock||!content?.insertBefore)return;
    dock.classList.add('practice-question-dock');
    content.insertBefore(dock,content.firstChild);
  }
  // An absent or stale selection must never turn a saved response into a new
  // whole-bank session. Preserve explicit empty selections and stable ordering.
  function selectedQueue(items, ids, selectedId, key = 'id') {
    if (!Array.isArray(ids) || !ids.includes(selectedId)) return [];
    const byId = new Map(items.map(item => [item[key], item]));
    return [...new Set(ids)].map(id => byId.get(id)).filter(Boolean);
  }
  function questionToolbar({title='',position='',mode='',status='',attempt='',actions='',className='',label='Practice questions'}={}) {
    return '<nav class="practice-question-toolbar '+esc(className)+'" aria-label="'+esc(label)+'"><div class="practice-question-context"><strong>'+esc(title)+'</strong><div><span>'+esc(position)+'</span>'+(attempt?'<span>'+esc(attempt)+'</span>':'')+(mode?'<span>'+esc(mode)+'</span>':'')+(status?'<span class="practice-attempt-status">'+esc(status)+'</span>':'')+'</div></div><div class="practice-question-actions">'+actions+'</div></nav>';
  }
  function attemptHistory(rows,{empty='No earlier attempts for this question.',label='Previous attempts'}={}) {
    return '<section class="practice-attempt-history" aria-label="'+esc(label)+'"><header><h3>'+esc(label)+' <span>'+rows.length+'</span></h3><p>For this question · Newest first · Your saved responses and feedback remain separate.</p></header>'+(rows.length?'<div class="practice-attempt-table-scroll"><table><thead><tr><th>Attempt</th><th>Saved · Brisbane</th><th>Mode</th><th>Status</th><th><span class="sr-only">Open result</span></th></tr></thead><tbody>'+rows.map(row=>'<tr data-practice-attempt="'+esc(row.id)+'"><td>'+esc(row.label)+'</td><td>'+esc(row.date)+'</td><td>'+esc(row.mode)+'</td><td>'+esc(row.status)+'</td><td>'+row.actions+'</td></tr>').join('')+'</tbody></table></div>':'<p class="practice-attempt-empty">'+esc(empty)+'</p>')+'</section>';
  }
  function essayAttempts(question,attempts=[]) {
    const text=value=>String(value??'').normalize('NFC').replace(/\s+/g,' ').trim();
    const prompt=text(question.question);
    return attempts.filter(a=>{
      const saved=text(a.questionText);
      return saved?!!prompt&&saved===prompt:a.questionId!=null&&String(a.questionId)===String(question.id);
    });
  }
  function latestWritingScore(attempts,kind) {
    if(!attempts?.length)return '';
    const when=a=>a.date??a.timestamp??a.updatedAt;
    const stamp=a=>{const value=when(a),n=typeof value==='number'?value:Date.parse(value);return Number.isFinite(n)?n:-Infinity;};
    const latest=attempts.reduce((best,a)=>stamp(a)>stamp(best)?a:best),traits=latest.trait_scores;
    const parts=['content','form','grammar','vocabulary'].map(k=>traits?.[k]);
    const native=kind==='swt'&&parts.every(Number.isFinite);
    const total=kind==='essay'?latest.scores?.total:native?parts.reduce((n,x)=>n+x,0):latest.overall_score;
    const maximum=kind==='essay'?26:native?9:90;
    const pending=latest.score_provisional||latest.ai_feedback_degraded;
    const label=pending?'Latest attempt: Score pending':Number.isFinite(total)&&total>=0&&total<=maximum?'Latest score: '+total+' / '+maximum+(kind==='swt'&&!native?' estimate':''):'Latest score unavailable';
    return label+(Number.isFinite(stamp(latest))?' · '+brisbaneDate(when(latest)):'');
  }
  function matchesQuestionNumber(query, number) {
    return /^#\d+$/.test(query) ? Number(query.slice(1)) === number : null;
  }
  function normalizeSearchText(value) {
    return String(value ?? '').normalize('NFKC').toLowerCase()
      .replace(/\[\[\d+\]\]/g, ' ').replace(/['’]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }
  function createTextMatcher(value) {
    const query = String(value ?? '').trim();
    const normalized = normalizeSearchText(query);
    const words = normalized.split(' ');
    function rank(text, keywords = true) {
      if (!normalized) return query ? 0 : 1;
      const source = normalizeSearchText(text);
      if (source === normalized) return 3;
      if (source.includes(normalized)) return 2;
      return keywords && words.length > 1 && words.every(word => source.includes(word)) ? 1 : 0;
    }
    return { query, rank };
  }
  function passagePreview(text, query, label) {
    if (typeof text !== 'string' || !text.trim() || !query) return null;
    const line = text.trim().replace(/\s+/g, ' ');
    const lower = line.toLowerCase();
    const phraseAt = lower.indexOf(query.toLowerCase().replace(/\s+/g, ' '));
    const keywords = normalizeSearchText(query).split(' ').sort((a,b) => b.length - a.length);
    const word = keywords.find(term => lower.includes(term));
    const matchAt = phraseAt >= 0 ? phraseAt : lower.indexOf(word || query);
    const before = Math.max(0, matchAt - 48);
    const start = before ? line.lastIndexOf(' ', before) + 1 : 0;
    const end = line.indexOf(' ', start + 180);
    const excerpt = (start ? '…' : '') + line.slice(start, end < 0 ? line.length : end) + (end < 0 ? '' : '…');
    return { text, excerpt, label };
  }
  const maskPassageBlanks = text => String(text ?? '').replace(/\[\[\d+\]\]/g, '_____');
  function libraryQueue(container, fallback) {
    const rows=container?.querySelectorAll?.('.practice-library-rows > [data-question-key]');
    if (!rows?.length) return fallback;
    const keys=new Map(fallback.map(id=>[String(id),id]));
    return [...rows].filter(row=>!row.hidden&&keys.has(row.dataset.questionKey)).map(row=>keys.get(row.dataset.questionKey));
  }
  const datedReleaseId = /^(?:ra|rs|di|rl|sgd|rts|sst|wfd|reading-dropdown|reading-wordbank|reading-reorder)-(?:user|upload|original|adapted|ipt-di)-(\d{4})(\d{2})(\d{2})(?:[-\d]|$)/;
  // These images entered the bank on 17 November with source IDs that omit the release date.
  const novemberImageReleaseIds = new Set([
    3000114, 3000139, 3000141, 3000145, 3000148, 3000154, 3000161, 3000172,
    3000185, 3000199, 3000202, 3000208, 3000213, 3000216, 3000217, 3000222,
    3000224, 3000229, 3000233, 3000234, 3000241, 3000243, 3000250, 3000251,
    3000268, 3000295, 3000307, 3000311, 3000324, 3000339, 3000500, 3000508,
    3000517, 3000532, 3000537, 3000616, 3000636, 3000645, 3000662, 3000674,
    3000683, 3000690, 3000693, 3000703, 3000709, 3000714, 3000715, 3000717,
    3000834, 3000835, 3000845, 3001354, 3001357, 3001358, 3001371, 3001379,
    3001383, 3001385, 3001408, 3001410, 3001411, 3001414, 3001415, 3001417,
    3001420, 3001426, 3001428, 3001431, 3001433, 3001436, 3001437, 3001439,
    3001445, 3001446,
  ].map(sourceId => 'di-pred-' + sourceId).concat([
    '01', '02', '03', '04', '05', '06', '08', '10', '11', '12', '13', '14', '17',
  ].map(sourceId => 'di-ipt-di-20261106-' + sourceId)));
  const dayMs = 24 * 60 * 60 * 1000;
  const brisbaneOffsetMs = 10 * 60 * 60 * 1000;

  function isNewQuestion(row, now = Date.now()) {
    if (row.badge === 'NEW') return true;
    const id = String(row.id);
    let date = row.addedOn;
    if (!date) {
      if (novemberImageReleaseIds.has(id)) date = '2026-11-17';
      // This Retell Lecture batch was published the day after its source date.
      else if (id.startsWith('rl-user-20261123-')) date = '2026-11-24';
      else date = datedReleaseId.exec(id)?.slice(1).join('-');
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const published = Date.parse(date + 'T00:00:00Z');
    if (!Number.isFinite(published) || new Date(published).toISOString().slice(0, 10) !== date) return false;
    const age = Math.floor((now + brisbaneOffsetMs) / dayMs) - published / dayMs;
    return age >= 0 && age < 14;
  }

  function libraryRows(rows,{empty='No questions match these filters.'}={}) {
    if (!rows.length) return '<p class="practice-library-empty" role="status">'+esc(empty)+'</p>';
    const now=Date.now();
    return rows.map(row=>{
      const isNew=isNewQuestion(row,now),badge=isNew?'NEW':row.badge;
      const number='#'+esc(row.number);
      const heading=row.numberOnly?'<h3 class="practice-library-number">'+number+'</h3>':
        '<small class="practice-library-number">'+number+'</small><h3>'+esc(row.title||'Question '+row.number)+'</h3>';
      const label='Question '+esc(row.number)+(row.numberOnly?'':': '+esc(row.title||row.id));
      const passage=row.passage?'<div class="practice-library-passage"><p>'+esc(row.passage.excerpt)+'</p><details><summary>'+esc(row.passage.label||'Read full passage')+'</summary><p class="practice-library-passage-text">'+esc(row.passage.text)+'</p></details></div>':'';
      return '<article class="practice-library-row" role="group" aria-label="'+label+'" data-question-key="'+esc(row.key ?? row.id)+'" data-question-number="'+esc(row.number)+'" data-question-new="'+isNew+'" data-question-reportable="'+(row.reportable!==false)+'"><div class="practice-library-row-copy">'+heading+(badge?'<span class="practice-library-label" aria-label="Question status: '+esc(badge)+'">'+esc(badge)+'</span>':'')+'<p>'+esc(row.status||'Not attempted')+'</p>'+(row.latestScore?'<p class="practice-library-detail practice-library-score">'+esc(row.latestScore)+'</p>':'')+(row.detail?'<p class="practice-library-detail">'+esc(row.detail)+'</p>':'')+passage+'</div><div class="practice-library-row-actions">'+row.actions+'</div></article>';
    }).join('');
  }
  function createTranscriptSearch(env, token, refresh) {
    let scope, timer;
    return (task, value) => {
      const query = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const session = token();
      if (scope?.task === task && scope.query === query && scope.session === session) return scope.matches;
      env.clearTimeout(timer);
      const request = scope = {task, query, session, matches: null};
      if (!task || !session || !query || query.length > 12000 || /^#?\d+$/.test(query)) return null;
      timer = env.setTimeout(async () => {
        try {
          const response = await env.fetch('/api/practice-library/' + task + '/transcript-search', {
            method: 'POST', headers: {'Content-Type':'application/json','x-session-token':session},
            body:JSON.stringify({q:query}), cache:'no-store', signal:AbortSignal.timeout(10000)
          });
          if (!response.ok) return;
          const {matches, previews} = await response.json();
          if (scope !== request || token() !== session || !Array.isArray(matches)) return;
          request.matches = {ids:new Set(matches),previews:new Map(Object.entries(previews || {}))};
          refresh();
        } catch {
          // Title and question number results remain available.
        }
      }, 200);
      return null;
    };
  }
  function questionLibrary({skill,title,task,description='Choose a question before entering your practice workspace.',total=0,searchId='',searchAttrs='',search='',transcriptSearch=false,searchPlaceholder=transcriptSearch?'Title, transcript or #number':'Title or #number',filterId='',filterAttrs='',filter='all',filters=[['all','All questions'],['new','Not attempted'],['draft','In progress'],['done','Completed']],rowsId='',rowsAttrs='',rowsClass='',rows='',options='',extras='',className=''}={}) {
    const newControl = task ? '<button type="button" class="practice-timed-switch" role="switch" aria-checked="false" data-library-new-only>New only</button>' : '';
    return '<section class="practice-question-library '+esc(className)+'"'+(task?' data-practice-library-task="'+esc(task)+'"':'')+'><header class="practice-library-heading"><div><p class="practice-library-eyebrow">'+esc(skill)+' practice</p><h2>'+esc(title)+'</h2><p>'+esc(description)+'</p></div><span class="practice-library-count" role="status">'+esc(total)+' questions</span></header>'+(options||newControl?'<div class="practice-library-options">'+options+newControl+'</div>':'')+'<div class="practice-library-filters"><label>Find a question<input type="search" '+(searchId?'id="'+esc(searchId)+'" ':'')+searchAttrs+' value="'+esc(search)+'" placeholder="'+esc(searchPlaceholder)+'"></label><label>Show<select '+(filterId?'id="'+esc(filterId)+'" ':'')+filterAttrs+'>'+filters.map(([value,label])=>'<option value="'+esc(value)+'" '+(value===filter?'selected':'')+'>'+esc(label)+'</option>').join('')+'</select></label></div><div class="practice-library-rows '+esc(rowsClass)+'" '+(rowsId?'id="'+esc(rowsId)+'" ':'')+rowsAttrs+'>'+rows+'</div>'+(extras?'<div class="practice-library-extras">'+extras+'</div>':'')+'</section>';
  }
  function brisbaneDate(value) {
    const date=new Date(value);if(!Number.isFinite(date.getTime()))return 'Saved attempt';
    return date.toLocaleString('en-AU',{timeZone:'Australia/Brisbane',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
  }
  return { navigation, heading, wrap, install, focusQuestion, pinNavigation, selectedQueue, questionToolbar, attemptHistory, matchesQuestionNumber, createTextMatcher, passagePreview, maskPassageBlanks, libraryQueue, isNewQuestion, libraryRows, createTranscriptSearch, questionLibrary, brisbaneDate, essayAttempts, latestWritingScore };
});
