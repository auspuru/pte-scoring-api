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
  function libraryRows(rows,{empty='No questions match these filters.'}={}) {
    return rows.length?rows.map(row=>'<article class="practice-library-row" role="group" aria-label="Question '+esc(row.number)+': '+esc(row.title||row.id)+'" data-question-key="'+esc(row.id)+'"><div class="practice-library-row-copy"><small>Question '+esc(row.number)+' · '+esc(row.id)+'</small><h3>'+esc(row.title||'Question '+row.number)+'</h3><p>'+esc(row.status||'Not attempted')+'</p>'+(row.detail?'<p class="practice-library-detail">'+esc(row.detail)+'</p>':'')+'</div><div class="practice-library-row-actions">'+row.actions+'</div></article>').join(''):'<p class="practice-library-empty" role="status">'+esc(empty)+'</p>';
  }
  function questionLibrary({skill,title,description='Choose a question before entering your practice workspace.',total=0,searchId='',searchAttrs='',search='',filterId='',filterAttrs='',filter='all',filters=[['all','All questions'],['new','Not attempted'],['draft','In progress'],['done','Completed']],rowsId='',rowsAttrs='',rowsClass='',rows='',options='',extras='',className=''}={}) {
    return '<section class="practice-question-library '+esc(className)+'"><header class="practice-library-heading"><div><p class="practice-library-eyebrow">'+esc(skill)+' practice</p><h2>'+esc(title)+'</h2><p>'+esc(description)+'</p></div><span class="practice-library-count" role="status">'+esc(total)+' questions</span></header>'+(options?'<div class="practice-library-options">'+options+'</div>':'')+'<div class="practice-library-filters"><label>Find a question<input type="search" '+(searchId?'id="'+esc(searchId)+'" ':'')+searchAttrs+' value="'+esc(search)+'" placeholder="Number, title or question ID"></label><label>Show<select '+(filterId?'id="'+esc(filterId)+'" ':'')+filterAttrs+'>'+filters.map(([value,label])=>'<option value="'+esc(value)+'" '+(value===filter?'selected':'')+'>'+esc(label)+'</option>').join('')+'</select></label></div><div class="practice-library-rows '+esc(rowsClass)+'" '+(rowsId?'id="'+esc(rowsId)+'" ':'')+rowsAttrs+'>'+rows+'</div>'+(extras?'<div class="practice-library-extras">'+extras+'</div>':'')+'</section>';
  }
  function brisbaneDate(value) {
    const date=new Date(value);if(!Number.isFinite(date.getTime()))return 'Saved attempt';
    return date.toLocaleString('en-AU',{timeZone:'Australia/Brisbane',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
  }
  return { navigation, heading, wrap, install, focusQuestion, pinNavigation, selectedQueue, questionToolbar, attemptHistory, libraryRows, questionLibrary, brisbaneDate };
});
