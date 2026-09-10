(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PortalWorkspace = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const routes = Object.freeze({
    dashboard: { pane: 'dashboardPane', title: 'Home', path: 'home' },
    swt: { pane: 'swtPane', title: 'Summarise written text', path: 'swt' },
    practice: { pane: 'practiceScreen', title: 'Essay practice', path: 'essays' },
    library: { pane: 'libraryPane', title: 'Essay library', path: 'library' },
    vocab: { pane: 'vocabScreen', title: 'Vocabulary', path: 'vocabulary' }
  });

  function routeFromHash(hash) {
    const path = String(hash || '').replace(/^#\/?/, '').split(/[?\/]/)[0];
    return Object.keys(routes).find(key => routes[key].path === path || key === path) || 'dashboard';
  }

  // Keep the existing task nodes alive: switching sections must never rebuild
  // an editor, lose a selection, stop an assessment or reset a running timer.
  function createController({ document: doc, window: win, onNavigate }) {
    let current = null;
    let ready = false;
    const container = doc.querySelector('.panes-container');
    ['practiceScreen', 'vocabScreen'].forEach(id => {
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
      if (!Object.hasOwn(routes, section)) section = 'dashboard';
      const changed = current !== section;
      current = section;
      Object.entries(routes).forEach(([key, route]) => {
        const pane = doc.getElementById(route.pane);
        if (pane) {
          pane.classList.toggle('active', key === section);
          pane.classList.toggle('show', key === section && (key === 'practice' || key === 'vocab'));
          pane.hidden = key !== section;
        }
        const nav = doc.getElementById('nav-' + key);
        if (nav) {
          nav.classList.toggle('active', key === section);
          if (key === section) nav.setAttribute('aria-current', 'page');
          else nav.removeAttribute('aria-current');
        }
      });
      doc.body.classList.toggle('has-active-practice', section === 'practice');
      doc.body.dataset.section = section;
      const heading = doc.getElementById('pageTitle');
      if (heading) heading.textContent = routes[section].title;
      doc.title = routes[section].title + ' · IPT Brisbane';
      ['essayTemplateBtn', 'exportBtn'].forEach(id => {
        const button = doc.getElementById(id);
        if (button) button.style.display = section === 'library' ? '' : 'none';
      });
      closeMenu();
      if (ready && options.history !== 'none') {
        const hash = '#/' + routes[section].path;
        if (win.location.hash !== hash) {
          win.history[options.history === 'replace' ? 'replaceState' : 'pushState'](null, '', hash);
        }
      }
      if (changed && ready && options.focus !== false && heading) heading.focus({ preventScroll: true });
      return section;
    }

    function handleRoute() {
      if (!ready) return;
      const section = routeFromHash(win.location.hash);
      if (section !== current) onNavigate(section, { history: 'none' });
    }
    win.addEventListener('popstate', handleRoute);
    win.addEventListener('hashchange', handleRoute);
    doc.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeMenu(true);
    });
    const menu = doc.getElementById('portalMenuToggle');
    if (menu) menu.addEventListener('click', () => {
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
        onNavigate(routeFromHash(win.location.hash), { history: 'replace', focus: false });
      },
      reset() { ready = false; current = null; closeMenu(); },
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
          questionTitle: typeof value.questionTitle === 'string' ? value.questionTitle : '',
          selectedQuestionId: typeof value.selectedQuestionId === 'string' || typeof value.selectedQuestionId === 'number' ? value.selectedQuestionId : null,
          questionSource: value.questionSource === 'custom' ? 'custom' : 'library',
          writeStep: value.writeStep === 2 ? 2 : 1, timerEnabled: value.timerEnabled === true,
          timerStartedAt: Number.isFinite(value.timerStartedAt) && value.timerStartedAt > 0 ? value.timerStartedAt : null,
          updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0
        };
      } catch (_) { return null; }
    }
    function write(owner, state) {
      if (!owner || !state || state.view !== 'write') return false;
      try {
        storage.setItem(key(owner), JSON.stringify({
          version: 1, essayText: String(state.essayText || ''), questionText: String(state.questionText || ''),
          questionTitle: String(state.questionTitle || ''), selectedQuestionId: state.selectedQuestionId || null,
          questionSource: state.questionSource === 'custom' ? 'custom' : 'library',
          writeStep: state.writeStep === 2 ? 2 : 1, timerEnabled: !!state.timerEnabled,
          timerStartedAt: Number.isFinite(state.timerStartedAt) ? state.timerStartedAt : null,
          updatedAt: Date.now()
        }));
        return true;
      } catch (_) { return false; }
    }
    function remove(owner) {
      if (!owner) return;
      try { storage.removeItem(key(owner)); } catch (_) { /* Storage may be unavailable. */ }
    }
    return { read, write, remove };
  }

  return { routes, routeFromHash, createController, createDraftStore };
});
