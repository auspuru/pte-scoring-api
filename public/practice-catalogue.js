(function (root, factory) {
  const fibQuality = root.ReadingFibQuality || (typeof require === 'function' ? require('./reading-fib-quality') : null);
  const patternBank = root.ReadingFibPatternBank || (typeof require === 'function' ? require('./reading-fib-pattern-bank') : null);
  const api = factory(fibQuality, patternBank);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PracticeCatalogue = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (fibQuality, patternBank) {
  'use strict';
  const groups = [
    { id: 'writing', title: 'Writing Practice', tasks: [
      { route: 'swt', label: 'Summarise Written Text' }, { route: 'practice', label: 'Write Essay' }
    ] },
    { id: 'reading', title: 'Reading Practice', tasks: [
      { route: 'reading-dropdown', type: 'dropdown', label: 'Reading Blanks (Dropdown)' },
      { route: 'reading-mcma', type: 'mcma', label: 'Reading Multiple Answers' },
      { route: 'reading-reorder', type: 'reorder', label: 'Reorder Paragraphs' },
      { route: 'reading-wordbank', type: 'wordbank', label: 'Reading Blanks (Drag & Drop)' },
      { route: 'reading-mcsa', type: 'mcsa', label: 'Reading Single Answer' }
    ] },
    { id: 'listening', title: 'Listening Practice', tasks: [
      { route: 'spoken-text', label: 'Summarise Spoken Text' },
      { route: 'listening-hcs', type: 'hcs', label: 'Highlight Correct Summary' },
      { route: 'listening-hiw', type: 'hiw', label: 'Highlight Incorrect Words' },
      { route: 'dictation', label: 'Write From Dictation' }
    ] }
  ];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const FIB_EXCLUDE = Object.freeze({
    dropdown: new Set(['RFIB_002','RFIB_005','RFIB_006','RFIB_007','RFIB_010','RFIB_014','RFIB_018','RFIB_019','RFIB_047','RFIB_049']),
    wordbank: new Set(['RDWD_001','RDWD_002','RDWD_004','RDWD_005','RDWD_006','RDWD_007','RDWD_008','RDWD_010','RDWD_013','RDWD_016','RDWD_030','RDWD_037','RDWD_047'])
  });
  const TECHNICAL_FIB_TERMS = /\b(?:polygenic|deadweight|allele|genotype|phenotype|immunoglobulin|subduction|quantitative easing|bond yield|fiscal multiplier|mitochondri|pathogen resistance)\b/i;
  function languageFirstFib(q) {
    if (!q || !['dropdown','wordbank'].includes(q.type)) return true;
    if (FIB_EXCLUDE[q.type]?.has(String(q.id))) return false;
    return !TECHNICAL_FIB_TERMS.test([q.title,q.passage,q.answers,q.answer,q.options,q.wordBank].flat(Infinity).join(' '));
  }

  // Reuse question identities and answer keys; never edit the source bank.
  function readingLibraries(bank) {
    const libraries = (bank.practiceLibraries || []).map(l => {
      const extras = ['dropdown','wordbank'].includes(l.id) ? (patternBank?.[l.id] || []) : [];
      return {
        ...l,
        questions: [...l.questions, ...extras]
          .filter(q => !['dropdown','wordbank'].includes(l.id) || languageFirstFib(q))
          .map(q => ['dropdown','wordbank'].includes(l.id) && fibQuality ? fibQuality.strengthen(q, 'library:'+q.id) : q)
      };
    });
    for (const task of groups.flatMap(g => g.tasks).filter(t => t.type)) {
      if (libraries.some(l => l.id === task.type)) continue;
      const questions = ['hcs','hiw'].includes(task.type)
        ? [...(bank.audioQuestionBank || []), ...(bank.mixedMock?.audioQuestions || [])]
          .filter(q => q.type === task.type).map(q => ({ ...q, uid: 'audio:' + q.id }))
        : (bank.sets || []).flatMap(set => set.questions.filter(q => q.type === task.type)
          .map(q => ({ ...q, uid: set.id + ':' + q.id, reasoning: set.reasoning?.[q.id] || {} })));
      const seen = new Set();
      libraries.push({ id: task.type, name: task.label, questions: questions.filter(q => {
        if (seen.has(q.uid)) return false;
        seen.add(q.uid); return true;
      }) });
    }
    return libraries;
  }
  function readingMocks(bank) {
    let sectional = 0, practice = 0;
    return (bank.mockCatalogue || []).map(m => {
      // Only the dedicated FIB-only prediction papers are Practice Mocks.
      // Integrated practice-mock-1..3 still contain SWT + Reading + audio and
      // belong with the sectional/integrated catalogue.
      const focused = m.kind === 'reading-blanks';
      const number = focused ? ++practice : ++sectional;
      return { id: m.id, engine: 'reading', module: 'reading', mode: focused ? 'practice' : 'sectional',
        title: 'Reading ' + (focused ? 'Practice Mock ' : 'Sectional Mock ') + number,
        description: focused ? 'Reading practice mock' : 'SWT + all Reading tasks + HIW + HCS',
        minutes: m.minutes || 55, number };
    });
  }
  function mockItems(reading, writing) {
    return [...readingMocks(reading), ...(writing.mocks || []).map((m, i) => ({
      ...m, engine: 'writing', module: 'writing', mode: 'sectional', number: m.predictionNumber || 100 + i,
      title: 'Writing Sectional ' + (m.predictionNumber ? 'Mock ' + String(m.predictionNumber).padStart(2,'0') : 'Special ' + String(i + 1).padStart(2,'0')),
      scope: 'SWT + Essay + SST + WFD'
    }))];
  }
  function filterMocks(items, { mode = 'sectional', module = 'all', search = '' } = {}) {
    const query = search.trim().toLowerCase();
    return items.filter(m => m.mode === mode && (module === 'all' || module === m.module)
      && (!query || (m.title + ' ' + m.description).toLowerCase().includes(query)))
      .sort((a,b) => a.module.localeCompare(b.module) || a.number - b.number);
  }
  function createController({ document: doc, navigate, launchReading, launchWriting, fetch: get = fetch }) {
    let data, loading, page = 0;
    const filters = { mode: 'sectional', module: 'all', search: '' };
    let pageSize = 12;
    async function load() {
      if (data) return data;
      if (!loading) loading = Promise.all(['reading-bank.json?v=8', '/api/writing-lab/catalog'].map(async url => {
        const r = await get(url, { signal: AbortSignal.timeout(15000) });
        if (!r.ok) throw Error('The catalogue could not load. Please retry.');
        return r.json();
      })).then(([reading, writing]) => (data = { reading, writing, mocks: mockItems(reading, writing) }))
        .finally(() => { loading = null; });
      return loading;
    }
    function openPractice() {
      const host = doc.getElementById('practiceHubPane');
      if (host.dataset.ready) return;
      host.innerHTML = '<div class="catalogue-heading"><h2>Practice</h2></div>'
        + '<div class="practice-banners">' + groups.map(g => '<section class="practice-banner ' + g.id + '" aria-labelledby="practice-' + g.id + '"><h3 id="practice-' + g.id + '">' + g.title + '</h3><div>'
          + g.tasks.map(t => '<button type="button" data-practice-route="' + t.route + '"><span>' + esc(t.label) + '</span><span aria-hidden="true">→</span></button>').join('') + '</div></section>').join('') + '</div>';
      host.onclick = e => { const b = e.target.closest('[data-practice-route]'); if (b) navigate(b.dataset.practiceRoute); };
      host.dataset.ready = 'true';
    }
    function renderList() {
      const board = doc.getElementById('catalogue-board');
      if (!board || !data) return;
      const items = filterMocks(data.mocks, filters), pages = Math.max(1, Math.ceil(items.length / pageSize));
      page = Math.min(page, pages - 1);
      const shown = items.slice(page * pageSize, (page + 1) * pageSize);
      board.innerHTML = shown.map(m => '<article class="mock-catalogue-card ' + m.module + '"><span class="mock-module">' + (m.module === 'reading' ? 'Reading' : 'Writing') + '</span><h3>' + esc(m.title) + '</h3>'
        + ''
        + '<footer><span>' + m.minutes + ' minutes</span><button type="button" class="portal-button primary" data-mock-id="' + esc(m.id) + '">Start Exam <span aria-hidden="true">→</span></button></footer></article>').join('');
      doc.getElementById('catalogue-count').textContent = items.length ? 'Showing ' + (page * pageSize + 1) + '–' + (page * pageSize + shown.length) + ' of ' + items.length + ' tests' : 'No tests available';
      const empty = doc.getElementById('catalogue-empty'); empty.hidden = !!items.length;
      empty.textContent = filters.mode === 'full' ? 'No tests available yet.' : 'No mocks match these filters.';
      doc.getElementById('catalogue-page').textContent = (page + 1) + ' / ' + pages;
      doc.getElementById('catalogue-prev').disabled = page === 0;
      doc.getElementById('catalogue-next').disabled = page >= pages - 1;
      doc.getElementById('catalogue-pagination').hidden = pages <= 1;
      doc.querySelectorAll('[data-catalogue-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.catalogueMode === filters.mode)));
      doc.getElementById('catalogue-description').hidden = true;
    }
    async function openMocks(options = {}) {
      const host = doc.getElementById('mockTestsPane');
      if (options.module) { filters.module = options.module; filters.mode = 'sectional'; page = 0; }
      if (!data) host.innerHTML = '<p role="status">Loading mock tests…</p>';
      try { await load(); } catch (error) {
        host.innerHTML = '<p role="alert">' + esc(error.message) + '</p><button type="button" class="portal-button" data-retry-catalogue>Retry</button>';
        host.onclick = e => { if (e.target.closest('[data-retry-catalogue]')) openMocks(options); }; return;
      }
      host.innerHTML = '<div class="catalogue-heading"><h2>Mock Tests</h2></div>'
        + '<div class="catalogue-modes" role="group" aria-label="Mock type">' + [['full','Full Mock'],['practice','Practice Mock'],['sectional','Sectional Mock']].map(([id,label]) => '<button type="button" data-catalogue-mode="' + id + '" aria-pressed="' + (filters.mode === id) + '">' + label + '</button>').join('') + '</div>'
        + '<p class="catalogue-description" id="catalogue-description"></p><div class="catalogue-toolbar"><label>Find a test<input id="catalogue-search" type="search" placeholder="Search tests" value="' + esc(filters.search) + '"></label><label>Module<select id="catalogue-module"><option value="all">All modules</option><option value="reading">Reading</option><option value="writing">Writing</option></select></label><label>Tests per page<select id="catalogue-size"><option value="12">12</option><option value="24">24</option><option value="1000">All</option></select></label></div>'
        + '<div class="catalogue-saved"><span>Saved mock attempts</span><button type="button" data-mock-history="reading">Reading</button><button type="button" data-mock-history="writing">Writing</button></div>'
        + '<p id="catalogue-count" role="status"></p><div class="mock-catalogue-grid" id="catalogue-board"></div><p id="catalogue-empty" class="catalogue-empty" hidden></p><div class="catalogue-pagination" id="catalogue-pagination"><button type="button" class="portal-button" id="catalogue-prev" data-catalogue-page="-1">Previous</button><span id="catalogue-page"></span><button type="button" class="portal-button" id="catalogue-next" data-catalogue-page="1">Next</button></div>';
      doc.getElementById('catalogue-module').value = filters.module;
      doc.getElementById('catalogue-size').value = String(pageSize);
      host.onclick = e => {
        const b = e.target.closest('button'); if (!b || b.disabled) return;
        if (b.dataset.catalogueMode) { filters.mode = b.dataset.catalogueMode; page = 0; renderList(); }
        if (b.dataset.cataloguePage) { page += Number(b.dataset.cataloguePage); renderList(); }
        if (b.dataset.mockHistory) navigate(b.dataset.mockHistory === 'reading' ? 'reading' : 'writing-history', { readingRequest: { history: true } });
        if (b.dataset.mockId) {
          const m = data.mocks.find(m => m.id === b.dataset.mockId); if (!m) return;
          if (m.engine === 'reading') launchReading(m.id); else launchWriting(m.id);
        }
      };
      host.oninput = e => { if (e.target.id === 'catalogue-search') { filters.search = e.target.value; page = 0; renderList(); } };
      host.onchange = e => {
        if (e.target.id === 'catalogue-module') filters.module = e.target.value;
        if (e.target.id === 'catalogue-size') pageSize = Number(e.target.value);
        page = 0; renderList();
      };
      renderList();
    }
    return { openPractice, openMocks };
  }
  return { groups, readingLibraries, readingMocks, mockItems, filterMocks, createController };
});
