'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const policy = require('../public/essay-scoring');
const sync = require('../essay-attempt-sync');
const { question, essay } = require('./essay-fixtures');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/index.js'), 'utf8');
function fn(name) {
  const start = source.indexOf('async function ' + name + '(');
  assert(start >= 0);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function result() {
  return policy.normalizeResult({ scores: { ...policy.MAXIMA },
    feedback: Object.fromEntries(Object.keys(policy.MAXIMA).map(key => [key, 'Clear and relevant.'])),
    errors: [], promptCoverage: [{ requirement: 'Both effects', status: 'addressed', evidence: 'mass media supports learning', nextStep: '' }],
    scoringEvidence: {
      linguisticExamples: ['mass media supports learning', 'Schools can respond by teaching students'],
      developmentEvidence: ['News reports help students understand events', 'Advertisements often connect expensive products'],
      vocabularyExamples: ['critical reading']
    },
    sampleStatus: 'ready', sampleResponse: essay, sampleSourceIdeas: ['mass media supports learning'] }, essay);
}
function harness(scoring = policy) {
  const requests = [], saves = [], views = [], messages = [];
  let history = [], quota = 0; const drafts = {};
  const ctx = {
    EssayScoring: scoring, API_URL: '', currentUserId: 'student', sessionToken: 'session-a',
    practiceSubmissionPending: false, practiceSamplePendingId: null, practiceHistoryDeleted: [], practiceRevision: null,
    practiceState: { view: 'write', essayText: essay, questionText: question, selectedQuestionId: 'q', questionTitle: 'Media', sampleBand: '7' },
    document: { getElementById: () => null }, countWords: policy.words,
    practiceSampleBand: value => policy.normalizeSampleBand(value),
    practiceSampleBandLabel: value => 'Band ' + policy.normalizeSampleBand(value),
    getPracticeTemplateOverlap: () => ({ level:'low', percent:0, matchedWords:0, totalWords:policy.words(essay) }),
    canonicalClientUserId: sync.canonicalUserId, mergePracticeHistoryClient: sync.mergeHistory,
    getPteStorageKey: k => k, LocalStore:{get:k=>drafts[k]?JSON.parse(drafts[k]):null}, safeLSSet:(k,v)=>{drafts[k]=v;return true;},
    savePortalEssayDraft() { return true; }, stopPracticeTimer() {}, getPracticeElapsedMs: () => null,
    startLoadingMessages() {}, stopLoadingMessages() {}, renderPracticeHistory() {}, updatePracticeStats() {},
    renderPracticeMain: () => views.push(ctx.practiceState.view), toast: text => messages.push(text),
    portalDraftStore: { read: () => null }, consumeQuota: async () => { quota++; },
    getPracticeHistory: () => history,
    savePracticeHistory: next => { history = next; return new Promise(resolve => saves.push({ next, finish: resolve })); },
    fetch: (url, options) => new Promise(resolve => requests.push({ url, options,
      reply: body => resolve({ ok: true, json: async () => body }),
      fail: (retryable = false) => resolve({ ok: false, status: 503, json: async () => ({ retryable, error: 'Assessment unavailable. Your essay is safe.' }) }) }))
  };
  const recovery = require('../public/grading-request');
  ctx.GradingRequest = { request: (url, options, extra) => recovery.request(url, options,
    { ...extra, fetch: ctx.fetch, wait: async () => {} }) };
  vm.createContext(ctx);
  vm.runInContext(source.slice(source.indexOf('function saveEssayQuestionDraft('), source.indexOf('function essayQuestionNavigation()')) + '\n' + fn('submitPracticeEssay') + '\n' + fn('retryPracticeSample'), ctx);
  return { ctx, requests, saves, views, messages, quota: () => quota,
    setHistory: value => { history = value; }, history: () => history };
}
async function until(predicate) {
  for (let i = 0; i < 30 && !predicate(); i++) await new Promise(resolve => setImmediate(resolve));
  assert(predicate(), 'Expected async state change');
}

test('Essay score renders while cloud saving is still pending', async () => {
  const h = harness();
  const submitted = h.ctx.submitPracticeEssay();
  h.requests[0].reply(result());
  await until(() => h.saves.length === 1);
  assert.equal(h.ctx.practiceState.view, 'results');
  assert.equal(h.ctx.practiceState.currentAttempt.scores.total, 26);
  assert.equal(h.ctx.practiceState.currentAttempt.sampleBand, '7');
  assert.equal(JSON.parse(h.requests[0].options.body).sampleBand, '7');
  assert.equal(h.quota(), 1);
  h.saves[0].finish(); await submitted;
  assert.equal(h.ctx.practiceSubmissionPending, false);
});

test('An open tab with the cached pre-rollout validator displays its completed score without retrying',async()=>{
 const {essayResultForClient}=require('../essay-grading');
 const cached={...policy,SAMPLE_CONTRACT_VERSION:undefined,normalizeResult(raw,text){if(raw.sampleStatus==='not-requested')throw Object.assign(Error('Unsupported sample status'),{code:'sample_status'});return policy.normalizeResult(raw,text);}};
 const h=harness(cached),submitted=h.ctx.submitPracticeEssay();
 const headers=h.requests[0].options.headers;assert.equal(headers['X-Essay-Sample-Contract'],'');
 const a={...result(),feedbackVersion:require('../public/essay-feedback').VERSION,sampleStatus:'not-requested',sampleKind:'not-requested',sampleResponse:'',sampleSourceIdeas:[],sampleWordCount:0};
 h.requests[0].reply(essayResultForClient(a,headers['X-Essay-Scoring-Version'],headers['X-Essay-Sample-Contract']));
 await until(()=>h.saves.length===1);assert.equal(h.ctx.practiceState.view,'results');assert.equal(h.requests.length,1);assert.equal(h.ctx.practiceState.currentAttempt.scores.total,26);
 h.saves[0].finish();await submitted;assert.equal(h.quota(),1);assert.equal(h.history().length,1);
});

test('A temporary essay failure recovers from the same click and saves/charges only once', async () => {
  const h = harness(); const submitted = h.ctx.submitPracticeEssay();
  h.requests[0].fail(true);
  await until(() => h.requests.length === 2);
  assert.equal(h.ctx.practiceState.view, 'loading');
  assert.equal(h.requests[1].options.body, h.requests[0].options.body);
  await h.ctx.submitPracticeEssay(); assert.equal(h.requests.length, 2);
  h.requests[1].reply(result()); await until(() => h.saves.length === 1);
  assert.equal(h.ctx.practiceState.view, 'results');
  assert.equal(h.quota(), 1); assert.equal(h.history().length, 1);
  h.saves[0].finish(); await submitted;
});

test('An actual grading failure restores the unchanged essay without consuming quota', async () => {
  const h = harness(); const submitted = h.ctx.submitPracticeEssay();
  h.requests[0].fail(); await submitted;
  assert.equal(h.ctx.practiceState.view, 'write');
  assert.equal(h.ctx.practiceState.essayText, essay);
  assert.equal(h.quota(), 0); assert.equal(h.saves.length, 0);
  assert.match(h.messages[0], /Your essay is safe/);
});

test('Retrying a sample updates the same attempt without changing scores or quota', async () => {
  const h = harness();
  const attempt = { ...result(), id: 'attempt', date: 1, questionText: question, essayText: essay, sampleBand: '6',
    sampleKind: 'unavailable', sampleStatus: 'unavailable', sampleResponse: '' };
  h.setHistory([attempt]); h.ctx.practiceState.currentAttempt = attempt; h.ctx.practiceState.view = 'results';
  const retry = h.ctx.retryPracticeSample();
  assert.equal(JSON.parse(h.requests[0].options.body).sampleBand, '6');
  h.requests[0].reply({ ...result(), scores: { total: 0 }, sampleBand: '6' });
  await until(() => h.saves.length === 1);
  assert.equal(h.ctx.practiceState.currentAttempt.sampleKind, 'full-essay');
  assert.equal(h.ctx.practiceState.currentAttempt.sampleBand, '6');
  assert.equal(h.ctx.practiceState.currentAttempt.scores.total, 26);
  assert.equal(h.history().length, 1); assert.equal(h.history()[0].id, 'attempt');
  assert.equal(h.quota(), 0);
  h.saves[0].finish(); await retry;
  assert.equal(h.ctx.practiceSamplePendingId, null);
});

test('A sample arriving after an account switch cannot update the next account', async () => {
  const h = harness();
  const attempt = { ...result(), id: 'attempt', questionText: question, essayText: essay, sampleKind: 'unavailable' };
  h.setHistory([attempt]); h.ctx.practiceState.currentAttempt = attempt;
  const retry = h.ctx.retryPracticeSample();
  h.ctx.currentUserId = 'other'; h.ctx.sessionToken = 'session-b'; h.setHistory([]);
  h.ctx.practiceState.currentAttempt = null;
  h.requests[0].reply(result()); await retry;
  assert.equal(h.saves.length, 0); assert.equal(h.quota(), 0);
  assert.equal(h.ctx.practiceState.currentAttempt, null);
});


test('Two essays can finish out of order without replacing the question currently open',async()=>{
 const h=harness(),first=h.ctx.submitPracticeEssay(),firstId=h.ctx.practiceState.submissionId;
 h.ctx.practiceState={...h.ctx.practiceState,view:'write',selectedQuestionId:'q2',questionText:question+' Discuss.',submissionId:null};
 const second=h.ctx.submitPracticeEssay();assert.equal(h.requests.length,2);
 const secondId=h.ctx.practiceState.submissionId;
 h.requests[0].reply({...result(),attemptId:firstId});await until(()=>h.saves.length===1);
 assert.equal(h.ctx.practiceState.view,'loading');assert.equal(h.ctx.practiceState.submissionId,secondId);
 h.saves[0].finish();await first;assert.equal(h.ctx.practiceSubmissionPending,true);
 h.requests[1].reply({...result(),attemptId:secondId});await until(()=>h.saves.length===2);
 assert.equal(h.ctx.practiceState.currentAttempt.questionId,'q2');assert.equal(h.history().length,2);
 h.saves[1].finish();await second;assert.equal(h.ctx.practiceSubmissionPending,false);
});

test('A failed old review leaves the new essay and its loading state intact',async()=>{
 const h=harness(),first=h.ctx.submitPracticeEssay();
 h.ctx.practiceState={...h.ctx.practiceState,view:'write',selectedQuestionId:'q2',questionText:question+' Discuss.',submissionId:null};
 const second=h.ctx.submitPracticeEssay();h.requests[0].fail();await first;
 assert.equal(h.ctx.practiceState.view,'loading');assert.equal(h.ctx.practiceState.selectedQuestionId,'q2');
 h.requests[1].fail();await second;assert.equal(h.ctx.practiceState.view,'write');
});

test('Essay submission stays on the response if saving fails',async()=>{
 const h=harness();h.ctx.savePortalEssayDraft=()=>false;await h.ctx.submitPracticeEssay();
 assert.equal(h.requests.length,0);assert.equal(h.ctx.practiceState.view,'write');assert.equal(h.ctx.practiceState.essayText,essay);
});
