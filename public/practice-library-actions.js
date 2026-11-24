(function () {
  'use strict';

  const selector = '[data-practice-library-task]';
  const sessions = new Map();
  const mounted = new WeakSet();
  const pendingLibraries = new Set();
  let ownerToken = '', queued = false;

  function token() {
    if (typeof sessionToken === 'string') return sessionToken;
    try {
      const stored = sessionStorage.getItem('pte_session_token');
      if (stored) return stored;
    } catch {}
    try { return localStorage.getItem('pte_session_token') || ''; } catch { return ''; }
  }

  function state(task) {
    const current = token();
    if (current !== ownerToken) {
      ownerToken = current;
      sessions.clear();
    }
    if (!sessions.has(task)) sessions.set(task, {
      token: current, questions: new Map(), pending: new Set(), revision: false, sort: false,
      username: '', loaded: false, checkedAt: 0, error: '', loading: null
    });
    return sessions.get(task);
  }

  async function request(task, session, body) {
    const response = await fetch('/api/practice-library/' + encodeURIComponent(task) + '/flags', {
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
      method: body ? 'PUT' : 'GET',
      headers: { 'Content-Type': 'application/json', 'x-session-token': session.token },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (!response.ok) throw Error('Revision and exam reports are temporarily unavailable.');
    return response.json();
  }

  function load(task, session, force = false) {
    if (session.loading) return session.loading;
    if (!session.token || session.pending.size ||
        (!force && Date.now() - session.checkedAt < 30000)) return;
    session.checkedAt = Date.now();
    session.loading = request(task, session).then(data => {
      if (session.token !== token()) return;
      session.username = data.username || '';
      session.questions = new Map(Object.entries(data.questions || {}));
      session.loaded = true;
      session.error = '';
    }).catch(error => {
      session.error = error.message;
    }).finally(() => {
      session.loading = null;
      refresh(task);
    });
    return session.loading;
  }

  const listeningTask = task => task === 'spoken-text' || task === 'dictation' || /^listening-l|^listening-(hcs|hiw|smw)$/.test(task);
  function legacyBookmarks(username) {
    if (!username) return [];
    try {
      const ids = JSON.parse(localStorage.getItem('ipt-listening-bookmarks:' + username) || '[]');
      return Array.isArray(ids) ? ids : [];
    } catch {
      return [];
    }
  }
  function clearLegacy(username, id) {
    const ids = legacyBookmarks(username);
    if (!ids.includes(id)) return;
    try { localStorage.setItem('ipt-listening-bookmarks:' + username, JSON.stringify(ids.filter(value => value !== id))); } catch {}
  }
  async function setListeningBookmark(task, questionId, username, enabled) {
    const session = state(task);
    await session.loading;
    if (session.token !== token() || session.pending.has(questionId)) return false;
    session.pending.add(questionId);
    try {
      const updated = await request(task, session, { questionId, kind: 'bookmark', enabled });
      if (session.token !== token()) return false;
      session.questions.set(questionId, updated);
      clearLegacy(username, questionId);
      return true;
    } finally {
      session.pending.delete(questionId);
      refresh(task);
    }
  }
  window.PracticeLibraryActions = {
    setListeningBookmark,
    async loadListeningBookmarks(task, username) {
      const session = state(task);
      await load(task, session);
      return session.token === token() ? this.listeningBookmarks(task, username) : [];
    },
    listeningBookmarks(task, username) {
      const session = state(task);
      return [...new Set([...legacyBookmarks(username), ...[...session.questions].filter(([, info]) => info.bookmarked).map(([id]) => id)])];
    }
  };

  function refresh(task) {
    document.querySelectorAll(selector).forEach(library => {
      if (library.dataset.practiceLibraryTask === task) render(library);
    });
  }

  function mount(library) {
    if (mounted.has(library)) return;
    mounted.add(library);
    library.querySelector('.practice-library-heading').insertAdjacentHTML('afterend',
      '<div class="practice-library-community"><div role="group" aria-label="Question lists">' +
      '<button type="button" data-library-view="all">All questions</button>' +
      '<button type="button" data-library-view="revision">Revision</button></div>' +
      '<label>Sort <select data-library-sort><option value="default">Question order</option>' +
      '<option value="reported">Most reported</option></select></label>' +
      '<span data-library-feedback role="status"></span><button type="button" data-library-retry hidden>Retry</button></div>');
    library.addEventListener('change', event => {
      if (!event.target.matches('[data-library-sort]')) return;
      state(library.dataset.practiceLibraryTask).sort = event.target.value === 'reported';
      render(library);
    });
    library.addEventListener('click', async event => {
      const button = event.target.closest('button');
      if (!button || button.disabled) return;
      const task = library.dataset.practiceLibraryTask, session = state(task);
      if (button.hasAttribute('data-library-retry')) {
        load(task, session, true);
        return;
      }
      if (button.dataset.libraryView) {
        session.revision = button.dataset.libraryView === 'revision';
        render(library);
        return;
      }
      const kind = button.dataset.libraryFlag;
      if (!kind || !session.loaded || session.loading) return;
      const row = button.closest('[data-question-key]');
      const questionId = row?.dataset.questionKey;
      if (!questionId || session.pending.has(questionId)) return;
      const enabled = button.getAttribute('aria-pressed') !== 'true';
      session.pending.add(questionId);
      render(library);
      try {
        const updated = await request(task, session, { questionId, kind, enabled });
        if (session.token !== token()) return;
        session.questions.set(questionId, updated);
        if (kind === 'bookmark' && listeningTask(task)) clearLegacy(session.username, questionId);
        session.error = '';
      } catch {
        session.error = 'Could not save the update. Please retry.';
      } finally {
        session.pending.delete(questionId);
        refresh(task);
        if (row.hidden && library.isConnected) library.querySelector('[data-library-view="revision"]')?.focus();
      }
    });
  }

  function render(library) {
    if (!mounted.has(library)) mount(library);
    const task = library.dataset.practiceLibraryTask;
    const session = state(task);
    load(task, session);
    const list = library.querySelector('.practice-library-rows');
    if (!list) return;
    const rows = [...list.querySelectorAll(':scope > [data-question-key]')];
    const count = row => session.questions.get(row.dataset.questionKey)?.count || 0;
    const order = rows.slice().sort((a, b) =>
      (session.sort ? count(b) - count(a) : 0) || Number(a.dataset.questionNumber) - Number(b.dataset.questionNumber));
    if (order.some((row, index) => row !== rows[index])) {
      const focused = list.contains(document.activeElement) ? document.activeElement : null;
      list.append(...order);
      focused?.focus({ preventScroll: true });
    }
    const legacy = new Set(listeningTask(task) ? legacyBookmarks(session.username) : []);
    for (const row of order) {
      const questionId = row.dataset.questionKey;
      const info = session.questions.get(questionId) || {};
      const bookmarked = info.bookmarked === true || legacy.has(questionId);
      row.hidden = session.revision && !bookmarked;
      let actions = row.querySelector('.practice-library-flags');
      if (!actions) {
        const report = row.dataset.questionReportable !== 'false';
        row.querySelector('.practice-library-row-actions').insertAdjacentHTML('beforeend',
          '<div class="practice-library-flags">' +
          (report ? '<div class="practice-library-report"><button type="button" data-library-flag="report">Seen in exam</button><small data-library-report-count></small></div>' : '') +
          '<button type="button" class="practice-library-star" data-library-flag="bookmark" aria-label="Save for revision">☆</button></div>');
        actions = row.querySelector('.practice-library-flags');
      }
      const disabled = !session.loaded || !!session.loading || session.pending.has(questionId);
      const bookmark = actions.querySelector('[data-library-flag="bookmark"]');
      bookmark.disabled = disabled;
      bookmark.setAttribute('aria-pressed', String(bookmarked));
      bookmark.textContent = bookmarked ? '★' : '☆';
      const report = actions.querySelector('[data-library-flag="report"]');
      if (report) {
        report.disabled = disabled;
        report.setAttribute('aria-pressed', String(info.reported === true));
        report.textContent = info.reported ? 'Reported ✓' : 'Seen in exam';
        const total = count(row), text = session.loaded ? total + (total === 1 ? ' report' : ' reports') : '';
        const label = actions.querySelector('[data-library-report-count]');
        if (label.textContent !== text) label.textContent = text;
      }
    }
    const visible = rows.filter(row => !row.hidden).length;
    const counter = library.querySelector('.practice-library-count');
    const label = visible + (visible === 1 ? ' question' : ' questions');
    if (counter.textContent !== label) counter.textContent = label;
    for (const button of library.querySelectorAll('[data-library-view]')) {
      button.setAttribute('aria-pressed', String(session.revision === (button.dataset.libraryView === 'revision')));
      button.disabled = !session.loaded && button.dataset.libraryView === 'revision';
    }
    const sort = library.querySelector('[data-library-sort]');
    sort.value = session.sort ? 'reported' : 'default';
    sort.disabled = !session.loaded;
    const feedback = library.querySelector('[data-library-feedback]');
    const message = session.error || (session.revision && !visible ? 'No matching revision questions.' : '');
    if (feedback.textContent !== message) feedback.textContent = message;
    library.querySelector('[data-library-retry]').hidden = !session.error;
  }

  function schedule(library) {
    if (!library) return;
    pendingLibraries.add(library);
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      const libraries = [...pendingLibraries];
      pendingLibraries.clear();
      libraries.filter(node => node.isConnected).forEach(render);
    });
  }

  new MutationObserver(records => {
    for (const record of records) {
      const library = record.target.closest?.(selector);
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches(selector)) schedule(node);
        else if (library && (node.matches('[data-question-key]') || node.matches('.practice-library-empty'))) schedule(library);
        else if (!library) node.querySelectorAll(selector).forEach(schedule);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
  document.querySelectorAll(selector).forEach(schedule);
})();
