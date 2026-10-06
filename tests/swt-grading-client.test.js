'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../public/index.js'), 'utf8');
function fn(name) {
  let start = source.indexOf('async function ' + name + '(');
  if (start < 0) start = source.indexOf('function ' + name + '(');
  assert(start >= 0);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
const summary = 'Caffeine improves the memory of bees, which helps them remember flower scents and supports pollination and plant survival.';
const result = () => ({ trait_scores: { content: 4, form: 1, grammar: 2, vocabulary: 2 },
  overall_score: 90, raw_score: 9, word_count: 21, score_provisional: false,
  spelling_details: { errors: [], count: 0 } });
function harness() {
  const requests = [], saved = [], results = [], notices = [], loading = [], screens = [];
  const input = { value: summary }, button = {}, pane = { setAttribute() {}, removeAttribute() {} };
  const ctx = {
    AbortController, setTimeout, clearTimeout, API_URL: '', currentUserId: 'student', sessionToken: 'token',
    currentPassageId: 1, passages: [{ id: 1, title: 'Bees', text: 'The passage', keyElements: {} }, { id: 2, title: 'Next passage' }],
    swtGradingPending: false, swtResultSubmission: null, attempted: new Set(), lastSpellData: null,
    canonicalClientUserId: value => String(value).trim().toLowerCase(), countWords: text => text.trim().split(/\s+/).length,
    document: { getElementById: id => ({ summaryInput: input, scoreBtn: button, writeTabPane: pane })[id] || null },
    showLoading: value => loading.push(value), toast: text => notices.push(text),
    populatePassageDropdowns() {}, stopTimer() {},
    saveAttempt: async (...args) => saved.push(args), showResults: (...args) => results.push(args),
    showSwtScreen: screen => screens.push(screen),
    fetch: (url, options) => new Promise(resolve => requests.push({ url, options,
      reply: (data, status = 200) => resolve({ ok: status === 200, status, json: async () => data }),
      broken: () => resolve({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad JSON'); } }) }))
  };
  const recovery = require('../public/grading-request');
  ctx.GradingRequest = { request: (url, options, extra) => recovery.request(url, options,
    { ...extra, fetch: ctx.fetch, wait: async () => {} }) };
  vm.createContext(ctx);
  vm.runInContext(['requestSwtGrade', 'scoreSummary', 'retrySwtAssessment'].map(fn).join('\n'), ctx);
  return { ctx, requests, saved, results, notices, loading, screens, input, button };
}

test('SWT uses one request, prevents duplicate submissions and displays the returned score and spelling', async () => {
  const h = harness(); const pending = h.ctx.scoreSummary();
  await h.ctx.scoreSummary();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, '/api/grade');
  h.requests[0].reply(result()); await pending;
  assert.equal(h.results[0][0].overall_score, 90);
  assert.deepEqual(h.results[0][2], { errors: [], count: 0 });
  assert.equal(h.saved.length, 1);
  assert.equal(h.ctx.swtGradingPending, false);
  assert.equal(h.loading.at(-1), false);
  assert.equal(h.button.disabled, false);
});

test('Provisional SWT scoring recovers before one final attempt is displayed and saved', async () => {
  const h = harness(); const pending = h.ctx.scoreSummary();
  h.requests[0].reply({ ...result(), score_provisional: true });
  for (let i = 0; i < 20 && h.requests.length < 2; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.requests.length, 2); assert.equal(h.saved.length, 0); assert.equal(h.results.length, 0);
  assert.equal(h.requests[1].options.body, h.requests[0].options.body);
  assert.equal(h.button.disabled, true);
  h.requests[1].reply(result()); await pending;
  assert.equal(h.saved.length, 1); assert.equal(h.results.length, 1);
  assert.equal(h.results[0][0].score_provisional, false);
});

test('Rate limits stop promptly; repeated malformed JSON keeps the draft and restores submission', async () => {
  for (const broken of [false, true]) {
    const h = harness(); const pending = h.ctx.scoreSummary();
    if (broken) {
      h.requests[0].broken();
      for (let i = 0; i < 20 && h.requests.length < 2; i++) await new Promise(resolve => setImmediate(resolve));
      assert.equal(h.requests.length, 2); h.requests[1].broken();
    }
    else h.requests[0].reply({ error: 'Too many scoring requests. Please wait a minute.' }, 429);
    await pending;
    assert.equal(h.input.value, summary);
    assert.equal(h.saved.length, 0); assert.equal(h.results.length, 0);
    assert.equal(h.ctx.swtGradingPending, false); assert.equal(h.button.disabled, false);
    assert.match(h.notices[0], broken ? /response is safe/ : /wait a minute/);
  }
});

test('An explicitly limited grading request remains abortable', async () => {
  const h = harness();
  const pending = h.ctx.requestSwtGrade({ text: summary }, 15);
  await assert.rejects(pending, /took too long.*summary is safe/);
  assert.equal(h.requests[0].options.signal.aborted, true);
});

test('Normal submission keeps waiting for the reviewed result without scheduling a browser cutoff', async () => {
  const h = harness();
  let timers = 0;
  h.ctx.setTimeout = () => { timers++; throw Error('Unexpected assessment cutoff'); };
  const pending = h.ctx.scoreSummary();
  await Promise.resolve();
  assert.equal(timers, 0);
  assert.equal(h.ctx.swtGradingPending, true);
  assert.equal(h.button.disabled, true);
  assert.equal(h.results.length, 0);
  h.requests[0].reply(result());
  await pending;
  assert.equal(h.results.length, 1);
  assert.equal(h.ctx.swtGradingPending, false);
});

test('Late SWT results stay with their original passage and cannot appear under another account', async () => {
  for (const switchAccount of [false, true]) {
    const h = harness(); const pending = h.ctx.scoreSummary();
    h.ctx.currentPassageId = 2;
    if (switchAccount) { h.ctx.currentUserId = 'other'; h.ctx.sessionToken = 'other-token'; }
    h.requests[0].reply(result()); await pending;
    assert.equal(h.results.length, 0); assert.equal(h.screens.length, 0);
    assert.equal(h.saved.length, switchAccount ? 0 : 1);
    if (!switchAccount) assert.equal(h.saved[0][0], 1);
  }
});

test('A browser storage failure cannot discard a completed SWT assessment', async () => {
  const h = harness(); h.ctx.saveAttempt = async () => { throw new Error('Storage full'); };
  const pending = h.ctx.scoreSummary(); h.requests[0].reply(result()); await pending;
  assert.equal(h.results[0][0].raw_score, 9);
  assert.equal(h.input.value, summary);
  assert.match(h.notices[0], /could not save/);
});

test('Retry assessment resubmits the displayed response while preserving an edited draft', async () => {
  const h = harness(); h.ctx.swtResultSubmission = { passageId: 1, text: summary, ownerId: 'student', token: 'token' };
  h.input.value = 'A new unfinished draft.';
  const pending = h.ctx.retrySwtAssessment();
  assert.equal(JSON.parse(h.requests[0].options.body).text, summary);
  h.requests[0].reply(result()); await pending;
  assert.equal(h.input.value, 'A new unfinished draft.');
  h.ctx.currentUserId = 'another-student';
  await h.ctx.retrySwtAssessment();
  assert.equal(h.requests.length, 1, 'The previous account cannot be resubmitted as another student');
});

test('Saving a completed attempt does not overwrite a newer draft for that passage', async () => {
  const store = { summaries: { 1: { text: 'A newer draft' } } };
  const ctx = { attempted: new Set(), getPteStorageKey: suffix => suffix, queueSync() {},
    LocalStore: { get: key => store[key], set: (key, value) => { store[key] = value; } } };
  vm.createContext(ctx); vm.runInContext(fn('saveAttempt'), ctx);
  await ctx.saveAttempt(1, summary, result(), null);
  assert.equal(store.summaries[1].text, 'A newer draft');
  assert.equal(store.scores[1].__text, summary);
  assert.equal(store.history[1][0].text, summary);
});
