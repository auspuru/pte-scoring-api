'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const catalogue = require('../public/practice-catalogue');
const { routes } = require('../public/portal-workspace');
const bank = require('../public/reading-bank.json');
const fibQuality = require('../public/reading-fib-quality');
const patternBank = require('../public/reading-fib-pattern-bank');
const writing = {
  spoken: Array.from({ length: 17 }, (_, i) => ({ id:'sst-'+i })),
  dictation: Array.from({ length: 36 }, (_, i) => ({ id:'wfd-'+i })),
  mocks: Array.from({ length: 33 }, (_, i) => ({ id: 'writing-' + (i + 1), predictionNumber: i + 1, description: 'Essay topic ' + (i + 1), minutes: 54 }))
};

test('Each available individual task has exactly one primary home and a working portal route', () => {
  const all = catalogue.groups.flatMap(g => g.tasks);
  assert.equal(new Set(all.map(t => t.route)).size, all.length);
  all.forEach(t => assert(routes[t.route], t.route));
  assert.deepEqual(catalogue.groups.find(g => g.id === 'writing').tasks.map(t => t.route), ['swt', 'practice']);
  assert.deepEqual(catalogue.groups.find(g => g.id === 'listening').tasks.map(t => t.route), ['spoken-text', 'listening-hcs', 'listening-hiw', 'dictation']);
  assert(!all.some(t => /mock/.test(t.route)));
});

test('Reading and Listening individual libraries reuse complete keys and stable identities without modifying banks', () => {
  const before = JSON.stringify(bank), libraries = catalogue.readingLibraries(bank);
  assert.equal(libraries.length, 7);
  for (const lib of libraries) {
    assert(lib.questions.length > 0, lib.id);
    assert.equal(new Set(lib.questions.map(q => q.uid)).size, lib.questions.length);
    for (const q of lib.questions) {
      assert.equal(q.type, lib.id);
      assert(q.answer !== undefined || q.answers?.length, q.uid);
    }
  }
  for (const original of bank.practiceLibraries) {
    const derived = libraries.find(l => l.id === original.id);
    assert(derived, original.id);
    for (const q of derived.questions) {
      const source = original.questions.find(item => item.id === q.id)
        || (patternBank[original.id] || []).find(item => item.id === q.id);
      assert(source, q.id);
      assert.deepEqual(q.answers, source.answers);
      if (['dropdown','wordbank'].includes(original.id)) {
        assert.equal(q.fibQuality?.focus, 'grammar-vocabulary');
        assert.equal(fibQuality.audit(q), true, q.id);
      }
    }
  }
  assert.equal(JSON.stringify(bank), before, 'The source bank stays immutable while the practice view receives stronger distractors.');
});

test('The single catalogue classifies integrated Reading sets as sectional and focused sets as practice', () => {
  const items = catalogue.mockItems(bank, writing);
  const sectionals = catalogue.filterMocks(items, { module: 'reading' });
  const focused = catalogue.filterMocks(items, { mode: 'practice', module: 'reading' });
  assert.deepEqual(sectionals.map(m => m.id), ['practice-mock-1', 'practice-mock-2', 'practice-mock-3', 'sectional-mock-1', 'sectional-mock-2', 'sectional-mock-3']);
  assert.deepEqual(focused.map(m => m.id), ['practice-mock-4', 'practice-mock-5', 'practice-mock-6', 'practice-mock-7', 'practice-mock-8', 'practice-mock-9']);
  assert(sectionals.every(m => /Summarise Written Text.*Reading.*Highlight Incorrect Words.*Highlight Correct Summary/.test(m.scope)));
  assert.deepEqual(catalogue.filterMocks(items, { mode: 'full' }), []);
  assert.equal(catalogue.filterMocks(items, { module: 'writing' }).length, 33);
  assert.equal(catalogue.filterMocks(items, { search: 'essay topic 33' })[0].id, 'writing-33');
});

function harness() {
  const nodes = new Map(), modes = [], calls = [], navigations = [], starts = [];
  class Element {
    constructor(id) { this.id = id; this.dataset = {}; this.attrs = {}; this.value = ''; this.hidden = false; nodes.set(id, this); }
    set innerHTML(html) {
      this.html = html;
      for (const match of html.matchAll(/id="([^"]+)"/g)) new Element(match[1]);
      if (this.id === 'mockTestsPane') {
        modes.length = 0;
        for (const match of html.matchAll(/data-catalogue-mode="([^"]+)"/g)) {
          const e = new Element('mode-' + match[1]); e.dataset.catalogueMode = match[1]; modes.push(e);
        }
      }
    }
    get innerHTML() { return this.html || ''; }
    setAttribute(key, value) { this.attrs[key] = value; }
  }
  const practice = new Element('practiceHubPane'), mocks = new Element('mockTestsPane');
  const document = { getElementById: id => nodes.get(id), querySelectorAll: () => modes };
  let fail = false;
  const controller = catalogue.createController({ document, navigate: (...args) => navigations.push(args),
    launchReading: id => starts.push(['reading', id]), launchWriting: id => starts.push(['writing', id]),
    getProgress: async () => ({ practice:{ swt:{count:18,lastAttempt:1000}, practice:{count:36}, dictation:{lastAttempt:2000} }, mocks:{'practice-mock-1':{status:'In progress',date:3000},'practice-mock-2':{status:'Done',date:4000},'writing-1':{status:'Done',date:4000}} }),
    fetch: async url => { calls.push(url); return { ok: !fail, json: async () => url.includes('reading-bank') ? bank : writing }; } });
  return { controller, nodes, practice, mocks, calls, navigations, starts, fail: value => fail = value,
    click: data => mocks.onclick({ target: { closest: () => ({ dataset: data }) } }),
    change: (id, value) => mocks.onchange({ target: { id, value } }) };
}

test('Practice shows task counts and last attempts while routes remain direct', async () => {
  const h = harness(); await h.controller.openPractice();
  assert.match(h.practice.innerHTML, /Writing Practice/); assert.match(h.practice.innerHTML, /Reading Practice/); assert.match(h.practice.innerHTML, /Listening Practice/);
  assert.match(h.practice.innerHTML, /18 questions/); assert.match(h.practice.innerHTML, /17 questions/); assert.match(h.practice.innerHTML, /36 questions/);
  assert.match(h.practice.innerHTML, /Last attempt/); assert.match(h.practice.innerHTML, /Not attempted yet/);
  assert.doesNotMatch(h.practice.innerHTML, /Start Exam|data-mock-id/);
  h.practice.onclick({ target: { closest: () => ({ dataset: { practiceRoute: 'dictation' } }) } });
  assert.deepEqual(h.navigations, [['dictation']]); assert.equal(h.calls.length, 2); assert.equal(h.starts.length, 0);
});

test('Mock tabs, module filtering, pagination, topic search and launch keep one catalogue', async () => {
  const h = harness(); await h.controller.openMocks();
  const board = () => h.nodes.get('catalogue-board').innerHTML;
  assert.match(board(),/Integrated Writing sectional practice|Integrated Reading sectional practice/);
  assert.match(board(),/Includes:/); assert.match(board(),/In progress/); assert.match(board(),/Done/); assert.match(board(),/New/);
  assert.equal(h.nodes.get('catalogue-description').hidden,false);
  assert.equal((board().match(/data-mock-id=/g) || []).length, 12);
  assert.equal(h.nodes.get('catalogue-count').textContent, 'Showing 1–12 of 39 tests');
  h.click({ cataloguePage: '1' }); assert.equal(h.nodes.get('catalogue-page').textContent, '2 / 4');
  h.change('catalogue-module', 'reading'); assert.equal((board().match(/data-mock-id=/g) || []).length, 6);
  h.click({ catalogueMode: 'practice' }); assert.match(board(), /practice-mock-4/); assert.match(board(), /Focused FIB practice only/); assert.match(board(), /10 Fill in the Blanks questions/); assert.doesNotMatch(board(), /SWT \+ all Reading/);
  h.click({ mockId: 'practice-mock-4' }); assert.deepEqual(h.starts, [['reading', 'practice-mock-4']]);
  h.click({ catalogueMode: 'sectional' }); h.change('catalogue-module', 'writing');
  h.mocks.oninput({ target: { id: 'catalogue-search', value: 'essay topic 33' } });
  assert.match(board(), /writing-33/); assert.equal((board().match(/data-mock-id=/g) || []).length, 1);
  h.click({ mockId: 'writing-33' }); assert.deepEqual(h.starts[1], ['writing', 'writing-33']);
  assert.doesNotMatch(h.mocks.innerHTML, /data-catalogue-mode="full"/);
  assert.match(h.mocks.innerHTML, /Full Mock · Coming later/);
  assert.equal(h.starts.length, 2, 'Filtering never starts or replaces an attempt');
  await h.controller.openMocks(); assert.equal(h.calls.length, 2, 'Loaded banks are reused');
  assert.equal(h.nodes.get('catalogue-module').value, 'writing');
  assert.match(h.mocks.innerHTML, /value="essay topic 33"/); assert.doesNotMatch(h.mocks.innerHTML,/Tests per page/);
  h.click({ mockHistory: 'reading' }); h.click({ mockHistory: 'writing' });
  assert.deepEqual(h.navigations.map(n => n[0]), ['reading', 'writing-history']);
  assert.equal(h.navigations[0][1].readingRequest.history, true);
});

test('Catalogue load failures have a retry, without creating an empty successful catalogue', async () => {
  const h = harness(); h.fail(true); await h.controller.openMocks();
  assert.match(h.mocks.innerHTML, /role="alert"/); assert.match(h.mocks.innerHTML, /data-retry-catalogue/);
  h.fail(false); await h.controller.openMocks(); assert.match(h.nodes.get('catalogue-board').innerHTML, /Start timed test|Continue timed test|Try again/);
});

test('Portal markup removes redundant navigation and embedded catalogues', () => {
  const html = fs.readFileSync(require.resolve('../public/index.html'), 'utf8');
  assert.equal((html.match(/id="nav-practice-hub"/g) || []).length, 1);
  assert.equal((html.match(/id="nav-mock-tests"/g) || []).length, 1);
  assert.doesNotMatch(html, /id="(?:testCentrePane|nav-test-centre|nav-writing-mocks|nav-sst|nav-reading|nav-swt|nav-practice)"/);
  assert.match(html, /practice-catalogue\.js/);
  assert.doesNotMatch(html, /<script[^>]+reading-practice\.js/);
  const portalClient = fs.readFileSync(require.resolve('../public/index.js'), 'utf8');
  assert.match(portalClient, /ensureReadingRuntimeLoaded/);
  assert.match(portalClient, /reading-practice\.js\?v=20260924-pattern/);
  const lab = fs.readFileSync(require.resolve('../public/writing-lab-client.js'), 'utf8');
  assert.doesNotMatch(lab, /renderMockBoard|assignment-board|data-board-mode/);
});


test('Original prediction-pattern FIB questions are exposed without copying the external prediction bank', () => {
  const libraries=catalogue.readingLibraries(bank);
  for(const type of ['dropdown','wordbank']){
    const questions=libraries.find(l=>l.id===type).questions;
    const originals=questions.filter(q=>q.patternBased);
    assert.equal(originals.length,12,type);
    assert.equal(new Set(originals.map(q=>q.id)).size,12,type);
    originals.forEach(q=>{
      assert.equal(q.patternSource.kind,'original-pattern-derived');
      assert.equal(fibQuality.audit(q),true,q.id);
      assert.match(q.reasoning.correct,/grammar|collocation|vocabulary/i);
    });
  }
});


test('Leaving Reading parks timed sessions instead of letting clocks run away', () => {
  const source=fs.readFileSync(require.resolve('../public/reading-practice'),'utf8');
  assert.match(source,/function parkSession/);
  assert.match(source,/pausedRemainingSeconds/);
  assert.match(source,/function resumeParkedSession/);
  assert.match(source,/function leave\(\).*parkSession\(\)/);
  assert.doesNotMatch(source,/timer continues/i);
});
