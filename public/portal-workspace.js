(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PortalWorkspace = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const taskRoutes = {
    'reading-dropdown': ['Reading Blanks (Dropdown)', 'dropdown'],
    'reading-mcma': ['Reading Multiple Answers', 'mcma'],
    'reading-reorder': ['Reorder Paragraphs', 'reorder'],
    'reading-wordbank': ['Reading Blanks (Drag & Drop)', 'wordbank'],
    'reading-mcsa': ['Reading Single Answer', 'mcsa'],
    'listening-hcs-bank': ['Highlight Correct Summary · earlier bank', 'hcs'],
    'listening-hiw-bank': ['Highlight Incorrect Words · earlier bank', 'hiw']
  };
  const routes = Object.freeze({
    dashboard: { pane: 'dashboardPane', title: 'Home', path: 'home', eyebrow: 'Your practice workspace', context: '' },
    progress: { pane:'progressPane',nav:'nav-progress',title:'My Progress',path:'progress',eyebrow:'Your activity',context:'' },
    'practice-hub': { pane: 'practiceHubPane', nav: 'nav-practice-hub', title: 'Practice', path: 'practice', eyebrow: 'Individual questions', context: '' },
    'mock-tests': { pane: 'mockTestsPane', nav: 'nav-mock-tests', title: 'Mock Tests', path: 'mock-tests', eyebrow: 'Timed tests', context: '' },
    'speaking-mocks': {pane:'mockTestsPane',nav:'nav-mock-tests',catalogueModule:'speaking',title:'Speaking mocks',path:'speaking-mocks',eyebrow:'Mock Tests · Speaking',context:''},
    'speaking-run': {pane:'speakingMockPane',nav:'nav-mock-tests',speakingMock:true,title:'Speaking mock',path:'speaking-attempt',eyebrow:'Mock Tests · Speaking',context:''},
    'speaking-history': {pane:'speakingMockPane',nav:'nav-mock-tests',speakingMock:true,mockHistory:true,title:'Saved speaking mocks',path:'speaking-mock-attempts',eyebrow:'Mock Tests · Saved attempts',context:''},
    'full-mock': { pane:'fullMockPane',nav:'nav-mock-tests',fullMock:true,title:'Full mock',path:'full-mock',eyebrow:'Full Mock',context:'' },
    swt: { pane: 'swtPane', nav: 'nav-practice-hub', title: 'Summarise written text', path: 'swt', eyebrow: 'Practice · SWT', context: '' },
    practice: { pane: 'practiceScreen', nav: 'nav-practice-hub', title: 'Essay practice', path: 'essays', eyebrow: 'Practice · Essays', context: '' },
    'spoken-text': { pane: 'writingLabScreen', nav: 'nav-practice-hub', labTab: 'sst', title: 'Summarise spoken text', path: 'spoken-text', eyebrow: 'Listening Practice · SST', context: '' },
    dictation: { pane: 'writingLabScreen', nav: 'nav-practice-hub', labTab: 'wfd', title: 'Write From Dictation', path: 'dictation', eyebrow: 'Listening Practice · Dictation', context: '' },
    ...Object.fromEntries(Object.entries({lmcma:'Multiple Choice, Multiple Answers',lfi:'Fill in the Blanks',hcs:'Highlight Correct Summary',lmcsa:'Multiple Choice, Single Answer',smw:'Select Missing Word',hiw:'Highlight Incorrect Words'}).map(([type,title])=>['listening-'+type,{pane:'writingLabScreen',nav:'nav-practice-hub',labTab:type,title,path:'listening-'+type,eyebrow:'Listening Practice',context:''}])),
    'listening-mocks': { pane:'mockTestsPane',nav:'nav-mock-tests',catalogueModule:'listening',title:'Listening sectional mocks',path:'listening-mocks',eyebrow:'Mock Tests · Listening',context:'' },
    'listening-run': { pane:'writingLabScreen',nav:'nav-mock-tests',labTab:'mocks',title:'Listening sectional mock',path:'listening-attempt',eyebrow:'Mock Tests · Listening',context:'' },
    'listening-history': { pane:'writingLabScreen',nav:'nav-mock-tests',labTab:'history',title:'Listening mock attempts',path:'listening-mock-attempts',eyebrow:'Mock Tests · Saved attempts',context:'' },
    'writing-mocks': { pane: 'mockTestsPane', nav: 'nav-mock-tests', catalogueModule: 'writing', title: 'Writing sectional mocks', path: 'writing-mocks', eyebrow: 'Mock Tests · Writing', context: '' },
    'writing-run': { pane: 'writingLabScreen', nav: 'nav-mock-tests', labTab: 'mocks', title: 'Writing sectional mock', path: 'writing-attempt', eyebrow: 'Mock Tests · Writing', context: '' },
    'writing-history': { pane: 'writingLabScreen', nav: 'nav-mock-tests', labTab: 'history', title: 'Writing mock attempts', path: 'writing-mock-attempts', eyebrow: 'Mock Tests · Saved attempts', context: '' },
    library: { pane: 'libraryPane', title: 'Essay Library', path: 'library', eyebrow: 'Review · Saved writing', context: '' },
    reading: { pane: 'readingPane', nav: 'nav-mock-tests', title: 'Reading mock attempts', path: 'reading', eyebrow: 'Mock Tests · Reading', context: '' },
    ...Object.fromEntries(Object.entries(taskRoutes).map(([key,[title,type]]) => [key, { pane: 'readingPane', nav: 'nav-practice-hub', title, path: key, readingLibrary: type, eyebrow: (key.startsWith('reading-') ? 'Reading' : 'Listening') + ' Practice', context: '' }])),
    ...Object.fromEntries(Object.entries({ra:'Read Aloud',rs:'Repeat Sentence',di:'Describe Image',rl:'Retell Lecture',sgd:'Summarise Group Discussion',rts:'Respond to a Situation'}).map(([type,title])=>['speaking-'+type,{pane:'speakingPane',nav:'nav-practice-hub',speakingType:type,title,path:'speaking-'+type,eyebrow:'Speaking Practice',context: ''}])),
    vocab: { pane: 'vocabScreen', title: 'Vocabulary', path: 'vocabulary', eyebrow: 'Practice · Vocabulary', context: '' }
  });

  function routeFromHash(hash) {
    const path = String(hash || '').replace(/^#\/?/, '').split(/[?\/]/)[0];
    if (path === 'next-steps') return 'progress';
    if (path === 'test-centre') return 'mock-tests';
    return Object.keys(routes).find(key => routes[key].path === path) || (Object.hasOwn(routes, path) ? path : 'dashboard');
  }

  function questionHash(section, detail={}) {
    const values={question:detail.question,attempt:detail.attempt,mode:detail.mode,view:detail.library?'list':null};
    const query=Object.entries(values).filter(([,v])=>v!=null&&v!=='').map(([k,v])=>k+'='+encodeURIComponent(v)).join('&');
    return '#/'+routes[section].path+(query?'?'+query:'');
  }
  function requestFromHash(hash, state, owner) {
    const section=routeFromHash(hash),route=routes[section],params={};
    for(const part of String(hash).split('?').slice(1).join('?').split('&')){
      const i=part.indexOf('=');if(i<0)continue;
      try{params[part.slice(0,i)]=decodeURIComponent(part.slice(i+1));}catch{/* Invalid links open the task list. */}
    }
    const context=state?.practice?.hash===hash&&(owner===undefined||state.practice.owner===owner)?state.practice.context:undefined;
    const isPractice=route.readingLibrary||route.speakingType||(route.labTab&&!['mocks','history'].includes(route.labTab));
    const request={navigation:true,library:params.view==='list'||!!(isPractice&&!params.question&&!params.attempt),context,...(params.attempt?{attemptId:params.attempt}:{}),...(params.mode?{mode:params.mode==='practice'?'practice':'exam'}:{})};
    const retired = /^#\/?next-steps(?:[?\/]|$)/.test(String(hash));
    const options={routeHash:retired ? '#/'+routes.progress.path : hash};
    if(route.readingLibrary)options.readingRequest={...request,...(params.question?{practiceUid:params.question}:{})};
    if(route.speakingType)options.speakingRequest={...request,...(params.mode?{mode:params.mode==='untimed'?'untimed':'timed'}:{}),...(params.question?{questionId:params.question}:{})};
    if(route.labTab)options.labRequest={...request,...(params.question?{testId:params.question}:{})};
    if(section==='practice'&&params.attempt)options.essayRequest={attemptId:params.attempt};
    if(section==='swt'&&params.question)options.swtRequest={passageId:params.question,timestamp:params.attempt,draft:!params.attempt};
    return options;
  }

  // Keep the existing task nodes alive: switching sections must never rebuild
  // an editor, lose a selection, stop an assessment or reset a running timer.
  function createController({ document: doc, window: win, onNavigate, getUserId=()=>String(win.currentUserId||'').trim().toLowerCase() }) {
    let current = null;
    let ready = false;
    let lastRoutedHash = null;
    win.PortalQuestionNavigation={update(detail={}){
      if(!ready||!current||win.PortalExamMode?.isActive())return;
      const hash=questionHash(current,detail),state={practice:{hash,owner:getUserId(),context:detail.context||null}};
      win.history[hash===win.location.hash?'replaceState':'pushState'](state,'',hash);
      lastRoutedHash=hash;
    }};
    const container = doc.querySelector('.panes-container');
    ['practiceScreen', 'vocabScreen', 'writingLabScreen'].forEach(id => {
      const pane = doc.getElementById(id);
      if (pane && container && pane.parentElement !== container) container.appendChild(pane);
      if (pane) pane.classList.add('pane');
    });

    function closeMenu(restoreFocus = false) {
      const wasOpen = doc.body.classList.contains('portal-menu-open');
      doc.body.classList.remove('portal-menu-open');
      const button = doc.getElementById('portalMenuToggle');
      if (button) button.setAttribute('aria-expanded', 'false');
      if (restoreFocus && wasOpen && button) button.focus();
    }

    function activate(section, options = {}) {
      if (win.PortalExamMode?.isActive()) {
        if (current && ready) win.history.replaceState(null, '', '#/' + routes[current].path);
        return current;
      }
      if (section === 'next-steps') section = 'progress';
      if (!Object.hasOwn(routes, section)) section = 'dashboard';
      const changed = current !== section;
      if (changed && routes[current]?.pane === 'speakingPane') win.SpeakingPractice?.leave();
      if (changed && routes[current]?.pane === 'speakingMockPane') win.SpeakingMock?.leave();
      if (changed && routes[current]?.pane === 'fullMockPane') win.FullMock?.leave();
      if (changed && routes[current]?.pane === 'readingPane') win.ReadingPractice?.leave();
      if (changed && routes[current]?.pane === 'writingLabScreen' && routes[section]?.pane !== 'writingLabScreen') {
        win.WritingLab?.leave?.();
      }
      current = section;
      const activePaneId = routes[section].pane;
      Object.entries(routes).forEach(([key, route]) => {
        const pane = doc.getElementById(route.pane);
        if (pane) {
          const paneActive = route.pane === activePaneId;
          pane.classList.toggle('active', paneActive);
          pane.classList.toggle('show', paneActive && (key === 'practice' || key === 'vocab'));
          pane.hidden = !paneActive;
        }
      });
      const activeNav = routes[section].nav || 'nav-' + section;
      new Set(Object.entries(routes).map(([key, route]) => route.nav || 'nav-' + key)).forEach(id => {
        const nav = doc.getElementById(id);
        if (!nav) return;
        nav.classList.toggle('active', id === activeNav);
        if (id === activeNav) nav.setAttribute('aria-current', 'page');
        else nav.removeAttribute('aria-current');
      });
      doc.body.classList.toggle('has-active-practice', section === 'practice');
      doc.body.classList.toggle('has-active-writing-lab', activePaneId === 'writingLabScreen');
      doc.body.dataset.section = section;
      const heading = doc.getElementById('pageTitle');
      const route = routes[section];
      if (heading) heading.textContent = route.title;
      const eyebrow = doc.getElementById('pageEyebrow');
      if (eyebrow) eyebrow.textContent = route.eyebrow;
      const context = doc.getElementById('pageContext');
      if (context) { context.textContent = route.context; context.hidden = !route.context; }
      doc.title = routes[section].title + ' · IPT Brisbane';
      ['essayTemplateBtn', 'exportBtn'].forEach(id => {
        const button = doc.getElementById(id);
        if (button) button.style.display = section === 'library' ? '' : 'none';
      });
      if (ready && options.history !== 'none') {
        const hash = options.routeHash || '#/' + routes[section].path;
        if (win.location.hash !== hash) {
          win.history[options.history === 'replace' ? 'replaceState' : 'pushState'](null, '', hash);
        }
      }
      if (activePaneId === 'readingPane') win.ReadingPractice?.open({ mockOnly: section === 'reading', ...options.readingRequest, ...(route.readingLibrary ? { libraryId: route.readingLibrary } : {}) });
      if (route.speakingType) {
        const request=options.speakingRequest;
        if(request?.navigation)win.SpeakingPractice?.open(route.speakingType,request.questionId,request);
        else win.SpeakingPractice?.open(route.speakingType,request?.questionId);
      }
      closeMenu();
      lastRoutedHash=win.location.hash;
      if (changed && ready && options.focus !== false && heading) heading.focus({ preventScroll: true });
      return section;
    }

    function handleRoute() {
      if (!ready) return;
      const section = routeFromHash(win.location.hash);
      if (section !== current || lastRoutedHash!==win.location.hash) {
        lastRoutedHash=win.location.hash;
        onNavigate(section, { ...requestFromHash(win.location.hash,win.history.state,getUserId()), history: /^#\/?next-steps(?:[?\/]|$)/.test(win.location.hash) ? 'replace' : 'none' });
      }
    }
    win.addEventListener('popstate', handleRoute);
    win.addEventListener('hashchange', handleRoute);
    doc.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeMenu(true);
    });
    const menu = doc.getElementById('portalMenuToggle');
    if (menu) menu.addEventListener('click', () => {
      if (win.PortalExamMode?.isActive()) return;
      const open = !doc.body.classList.contains('portal-menu-open');
      doc.body.classList.toggle('portal-menu-open', open);
      menu.setAttribute('aria-expanded', String(open));
      if (open) doc.getElementById('portalSidebar')?.querySelector('[aria-current="page"]')?.focus();
    });
    const dismiss = doc.getElementById('portalMenuBackdrop');
    if (dismiss) dismiss.addEventListener('click', () => closeMenu(true));
    const sidebar = doc.getElementById('portalSidebar');
    if (sidebar) sidebar.addEventListener('focusout', () => {
      // Wait for the new focus target. Keyboard users can tab out naturally.
      win.setTimeout(() => {
        if (!sidebar.contains(doc.activeElement) && doc.activeElement !== menu) closeMenu();
      }, 0);
    });

    return {
      activate,
      current: () => current,
      start() {
        ready = true;
        onNavigate(routeFromHash(win.location.hash), { ...requestFromHash(win.location.hash,win.history.state,getUserId()), history: 'replace', focus: false });
      },
      reset() { win.PortalExamMode?.reset(); win.ReadingPractice?.reset(); win.SpeakingPractice?.reset(); win.SpeakingMock?.reset(); win.FullMock?.reset(); win.WritingLab?.reset?.(); ready = false; current = null; closeMenu(); },
      closeMenu
    };
  }

  function createDraftStore(storage) {
    const key = owner => 'ipt_essay_draft_v1:' + encodeURIComponent(String(owner || '').trim().toLowerCase());
    function read(owner) {
      if (!owner) return null;
      try {
        const value = JSON.parse(storage.getItem(key(owner)) || 'null');
        if (!value || value.version !== 1 || typeof value.essayText !== 'string' || typeof value.questionText !== 'string') return null;
        return {
          version: 1, essayText: value.essayText, questionText: value.questionText,
          revisionParentId: typeof value.revisionParentId==='string' ? value.revisionParentId : null,
          submissionId: typeof value.submissionId==='string' ? value.submissionId : null,
          submissionSignature: typeof value.submissionSignature==='string' ? value.submissionSignature : '',
          questionTitle: typeof value.questionTitle === 'string' ? value.questionTitle : '',
          selectedQuestionId: typeof value.selectedQuestionId === 'string' || typeof value.selectedQuestionId === 'number' ? value.selectedQuestionId : null,
          questionSource: value.questionSource === 'custom' ? 'custom' : 'library',
          writeStep: value.writeStep === 2 ? 2 : 1,
          sampleBand: ['6', '7', '8', '9'].includes(String(value.sampleBand)) ? String(value.sampleBand) : '9',
          timerEnabled: value.timerEnabled === true,
          timerStartedAt: Number.isFinite(value.timerStartedAt) && value.timerStartedAt > 0 ? value.timerStartedAt : null,
          updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0
        };
      } catch (_) { return null; }
    }
    function write(owner, state) {
      if (!owner || !state || state.view !== 'write') return false;
      try {
        const record = {
          version: 1, essayText: String(state.essayText || ''), questionText: String(state.questionText || ''),
          revisionParentId: typeof state.revisionParentId==='string' ? state.revisionParentId : null,
          submissionId: typeof state.submissionId==='string' ? state.submissionId : null,
          submissionSignature: typeof state.submissionSignature==='string' ? state.submissionSignature : '',
          questionTitle: String(state.questionTitle || ''), selectedQuestionId: state.selectedQuestionId || null,
          questionSource: state.questionSource === 'custom' ? 'custom' : 'library',
          writeStep: state.writeStep === 2 ? 2 : 1,
          sampleBand: ['6', '7', '8', '9'].includes(String(state.sampleBand)) ? String(state.sampleBand) : '9',
          timerEnabled: !!state.timerEnabled,
          timerStartedAt: Number.isFinite(state.timerStartedAt) ? state.timerStartedAt : null,
          updatedAt: Date.now()
        };
        const previous = read(owner);
        if (previous && JSON.stringify({ ...previous, updatedAt: 0 }) === JSON.stringify({ ...record, updatedAt: 0 })) return true;
        record.updatedAt = Math.max(record.updatedAt, (previous?.updatedAt || 0) + 1);
        storage.setItem(key(owner), JSON.stringify(record));
        return true;
      } catch (_) { return false; }
    }
    function remove(owner) {
      if (!owner) return;
      try { storage.setItem(key(owner), JSON.stringify({ version: 1, deleted: true, updatedAt: Math.max(Date.now(), (read(owner)?.updatedAt || 0) + 1) })); } catch (_) { /* Storage may be unavailable. */ }
    }
    return { read, write, remove };
  }

  return { routes, routeFromHash, questionHash, requestFromHash, createController, createDraftStore };
});
