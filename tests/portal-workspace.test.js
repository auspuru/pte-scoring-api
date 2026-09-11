'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { routes, routeFromHash, createController, createDraftStore } = require('../public/portal-workspace');

// Lightweight state doubles exercise navigation without a browser or a layout engine.
function harness(hash = '') {
  const nodes = new Map(), events = {}, docEvents = {}, visited = [];
  function node(id) {
    const classes = new Set(), attrs = {}, handlers = {};
    const value = { id, hidden: false, children: [], style: {}, dataset: {}, attrs, handlers, textContent: '',
      classList: {
        add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)),
        contains: name => classes.has(name),
        toggle(name, force) { const on = force ?? !classes.has(name); if (on) classes.add(name); else classes.delete(name); return on; }
      },
      setAttribute: (key, val) => { attrs[key] = val; }, removeAttribute: key => delete attrs[key],
      addEventListener: (key, fn) => { handlers[key] = fn; },
      focus: () => { doc.activeElement = value; },
      appendChild(child) { child.parentElement = value; value.children.push(child); },
      querySelector: () => nodes.get('nav-dashboard'), contains: target => value.children.includes(target)
    };
    nodes.set(id, value); return value;
  }
  const doc = { getElementById: id => nodes.get(id), querySelector: () => nodes.get('container'),
    addEventListener: (key, fn) => { docEvents[key] = fn; } };
  doc.body = node('body'); node('container');
  Object.entries(routes).forEach(([key, route]) => { node(route.pane); node('nav-' + key); });
  ['pageTitle', 'pageEyebrow', 'pageContext', 'portalMenuToggle', 'portalMenuBackdrop', 'portalSidebar', 'essayTemplateBtn', 'exportBtn'].forEach(node);
  const win = { location: { hash }, addEventListener: (key, fn) => { events[key] = fn; }, setTimeout: fn => fn(),
    history: { pushState: (_, __, url) => { win.location.hash = url; visited.push(url); },
      replaceState: (_, __, url) => { win.location.hash = url; visited.splice(-1, 1, url); } } };
  let controller;
  controller = createController({ document: doc, window: win,
    onNavigate: (section, options) => controller.activate(section, options) });
  return { controller, nodes, doc, win, events, docEvents, visited };
}

test('A section URL opens the requested task after authentication, including on refresh', () => {
  const h = harness('#/essays');
  h.controller.activate('dashboard', { history: 'none' });
  assert.equal(h.win.location.hash, '#/essays');
  h.controller.start();
  assert.equal(h.controller.current(), 'practice');
  assert.equal(h.nodes.get('practiceScreen').hidden, false);
  assert.equal(h.nodes.get('practiceScreen').parentElement, h.nodes.get('container'));
  assert.equal(h.nodes.get('nav-practice').attrs['aria-current'], 'page');
  assert.equal(h.nodes.get('pageTitle').textContent, 'Essay practice');
  assert.equal(h.nodes.get('pageEyebrow').textContent, 'Practice · Essays');
  assert.equal(h.nodes.get('pageContext').textContent, 'Choose a question, develop your ideas, and write with purpose.');
});

test('Each workspace route provides a clear section context for the current task', () => {
  const h = harness(); h.controller.start();
  h.controller.activate('swt');
  assert.equal(h.nodes.get('pageEyebrow').textContent, 'Practice · SWT');
  assert.equal(h.nodes.get('pageContext').textContent, 'Read, connect the ideas, and review one useful improvement.');
  h.controller.activate('library');
  assert.equal(h.nodes.get('pageEyebrow').textContent, 'Review · Saved writing');
  assert.equal(h.nodes.get('pageContext').textContent, 'Return to a draft, refine a response, or prepare an export.');
});

test('Switching sections preserves draft nodes, cursor position and scroll, with only one active pane', () => {
  const h = harness(); h.controller.start();
  const editor = { value: 'My unfinished essay', selectionStart: 12 };
  h.nodes.get('practiceScreen').appendChild(editor);
  h.nodes.get('practiceScreen').scrollTop = 140;
  h.controller.activate('practice'); h.controller.activate('vocab'); h.controller.activate('swt'); h.controller.activate('practice');
  assert.equal(h.nodes.get('practiceScreen').children[0], editor);
  assert.equal(editor.selectionStart, 12);
  assert.equal(h.nodes.get('practiceScreen').scrollTop, 140);
  assert.deepEqual(Object.values(routes).filter(route => !h.nodes.get(route.pane).hidden).map(route => route.pane), ['practiceScreen']);
  assert(h.doc.body.classList.contains('has-active-practice'));
  h.controller.activate('dashboard');
  assert(!h.doc.body.classList.contains('has-active-practice'));
});

test('Back and Forward restore the section without adding history entries or routing after sign-out', () => {
  const h = harness(); h.controller.start();
  h.controller.activate('swt'); h.controller.activate('practice');
  const historySize = h.visited.length;
  h.win.location.hash = '#/swt'; h.events.popstate(); h.events.hashchange();
  assert.equal(h.controller.current(), 'swt'); assert.equal(h.visited.length, historySize);
  h.win.location.hash = '#/essays'; h.events.popstate();
  assert.equal(h.controller.current(), 'practice');
  h.controller.reset(); h.win.location.hash = '#/vocabulary'; h.events.hashchange();
  assert.equal(h.controller.current(), null);
  assert.equal(routeFromHash('#/unexpected-route'), 'dashboard');
});

test('Mobile navigation moves focus to the active item and Escape returns it to the menu button', () => {
  const h = harness(); h.controller.start();
  h.nodes.get('portalMenuToggle').handlers.click();
  assert(h.doc.body.classList.contains('portal-menu-open'));
  assert.equal(h.doc.activeElement, h.nodes.get('nav-dashboard'));
  h.docEvents.keydown({ key: 'Escape' });
  assert(!h.doc.body.classList.contains('portal-menu-open'));
  assert.equal(h.nodes.get('portalMenuToggle').attrs['aria-expanded'], 'false');
  assert.equal(h.doc.activeElement, h.nodes.get('portalMenuToggle'));
});

function storage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) || null, setItem: (key, val) => values.set(key, val), removeItem: key => values.delete(key) };
}
const draft = { view: 'write', writeStep: 2, essayText: 'A response with meaningful progress.', questionText: 'Discuss the benefits of public transport.', questionTitle: 'Transport', questionSource: 'custom', timerEnabled: true, timerStartedAt: 12345 };

test('Unsubmitted essays recover after a new session and never appear in another account', () => {
  const local = storage();
  assert(createDraftStore(local).write(' Student@Example.com ', draft));
  const nextSession = createDraftStore(local);
  assert.equal(nextSession.read('student@example.com').essayText, draft.essayText);
  assert.equal(nextSession.read('student@example.com').questionText, draft.questionText);
  assert.equal(nextSession.read('student@example.com').timerStartedAt, 12345);
  assert.equal(nextSession.read('another-student'), null);
  assert.equal(nextSession.write('', draft), false);
  assert.equal(nextSession.write('student@example.com', { ...draft, view: 'results' }), false);
  assert.equal(nextSession.read('student@example.com').essayText, draft.essayText);
  nextSession.remove('student@example.com');
  assert.equal(nextSession.read('student@example.com'), null);
});

test('Unavailable, malformed and older draft storage cannot crash the editor or claim a successful save', () => {
  const denied = createDraftStore({ getItem() { throw Error('Denied'); }, setItem() { throw Error('Full'); }, removeItem() { throw Error('Denied'); } });
  assert.equal(denied.read('student'), null); assert.equal(denied.write('student', draft), false);
  assert.doesNotThrow(() => denied.remove('student'));
  const local = storage(), store = createDraftStore(local);
  store.write('student', draft);
  const key = [...local.values.keys()][0];
  local.setItem(key, '{broken'); assert.equal(store.read('student'), null);
  local.setItem(key, JSON.stringify({ version: 0, essayText: 'old' })); assert.equal(store.read('student'), null);
  local.setItem(key, JSON.stringify({ version: 1, ...draft, writeStep: 500, timerStartedAt: 'bad', questionTitle: {} }));
  assert.equal(store.read('student').writeStep, 1);
  assert.equal(store.read('student').timerStartedAt, null);
  assert.equal(store.read('student').questionTitle, '');
});

const source = fs.readFileSync(path.join(__dirname, '../public/index.js'), 'utf8');
function fn(name) {
  const start = source.indexOf('function ' + name + '(');
  assert(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
test('Returning to a running assessment or an existing editor does not reset or render over it', () => {
  for (const view of ['write', 'loading', 'results']) {
    let rendered = 0;
    const state = { view, essayText: 'Do not erase this', timerStartedAt: 42 };
    const ctx = { practiceState: state, practiceSubmissionPending: view === 'loading',
      savePortalEssayDraft() {}, refreshPracticeHistory() {}, portalWorkspace: { activate() {} },
      renderPracticeHistory() {}, updatePracticeStats() {},
      renderPracticeMain() { rendered++; }, document: { getElementById: () => ({ children: [{}] }) } };
    vm.createContext(ctx); vm.runInContext(fn('openPractice'), ctx); ctx.openPractice();
    assert.equal(ctx.practiceState.view, view); assert.equal(ctx.practiceState.essayText, state.essayText);
    assert.equal(ctx.practiceState.timerStartedAt, 42); assert.equal(rendered, 0);
  }
});

test('A save scheduled by one account cannot write its draft under the next account', () => {
  const calls = [], status = { dataset: {} };
  const ctx = { currentUserId: 'first', practiceState: { ...draft }, portalDraftTimer: 1, portalDraftRevision: 0,
    portalDraftStore: { write: (...args) => { calls.push(args); return true; } },
    clearTimeout() {}, document: { getElementById: () => status } };
  vm.createContext(ctx); vm.runInContext(fn('savePortalEssayDraft'), ctx);
  ctx.savePortalEssayDraft();
  ctx.currentUserId = ''; ctx.savePortalEssayDraft();
  ctx.currentUserId = 'second'; ctx.practiceState = { view: 'welcome', essayText: '' }; ctx.savePortalEssayDraft();
  assert.equal(calls.length, 1); assert.equal(calls[0][0], 'first');
  assert.equal(status.textContent, 'Draft saved on this device');
});
