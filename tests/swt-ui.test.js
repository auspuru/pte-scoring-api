'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../public/index.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/swt-ui.css'), 'utf8');
const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function functionSource(name, async = false) {
  const start = source.indexOf((async ? 'async ' : '') + 'function ' + name + '(');
  assert(start >= 0);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

test('The headline shows an estimate; raw traits live in a collapsed breakdown', () => {
  const hero = html.slice(html.indexOf('id="heroScore"'), html.indexOf('id="swtGuidanceBody"'));
  assert.match(hero, /PTE estimate/);
  assert(!hero.includes('Content score'));
  assert(!hero.includes('Trait total'));
  assert.match(html, /<details[^>]*aria-labelledby="swtTraitsHeading"/);
  assert(!html.includes('Highlights are a reading aid'));
  assert(!html.includes('id="coverageTable"'));
  assert(!source.includes('Band-9 sample loaded'));
  assert.match(html, /id="sampleAnswerNotes" role="status" aria-live="polite"/);
});

test('Passage and response rendering preserves plain text without line highlights or HTML injection', () => {
  const target = { textContent: '', innerHTML: '' };
  const context = { document: { getElementById: id => id === 'annotatedFeedback' ? null : target }, escapeHtml };
  vm.createContext(context);
  vm.runInContext(functionSource('renderAnnotatedPassage') + '\n' + functionSource('renderAnnotatedSubmission'), context);
  const text = 'Important phrase <img onerror="bad()">\nSecond paragraph.';
  context.renderAnnotatedPassage({ text });
  assert.equal(target.textContent, text);
  assert.equal(target.innerHTML, '');
  context.renderAnnotatedSubmission({}, {}, {}, text);
  assert.equal(target.textContent, text);
  assert.equal(target.innerHTML, '');
});

test('Key idea cards separate quoted phrases from their explanation and escape all content', () => {
  const target = { innerHTML: '' };
  const context = { document: { getElementById: () => target }, escapeHtml };
  vm.createContext(context);
  vm.runInContext(functionSource('renderSwtKeyPhrases'), context);
  context.renderSwtKeyPhrases({ studyGuide: { overview: '<script>bad</script>',
    items: [{ label: 'Main idea', phrases: ['a large percentage of GDP'], idea: '<img src=x onerror=bad()>' }],
    connection: 'Benefits are related, not all causal.' } });
  assert.match(target.innerHTML, /<q>a large percentage of GDP<\/q>/);
  assert.match(target.innerHTML, /How the ideas connect:/);
  assert(!target.innerHTML.includes('<script>'));
  assert(!target.innerHTML.includes('<img'));
  assert(!target.innerHTML.includes('Not selected'));
});

test('Async sample checks cannot replace the next passage’s sample after navigation', async () => {
  const old = { id: 8 }, current = { id: 9 };
  const note = { textContent: '', dataset: {}, setAttribute() {} };
  const sample = { textContent: 'Current passage sample' };
  let finishSample;
  const context = { swtResultPassage: old,
    document: { getElementById: id => id === 'sampleAnswerNotes' ? note : sample },
    fetchSwtSampleText: () => new Promise(resolve => { finishSample = resolve; }),
    checkSwtSample: async () => ({ status: 'verified', sample: 'Old checked sample', note: 'Old note' }) };
  vm.createContext(context);
  vm.runInContext(functionSource('refreshSwtSample', true), context);
  const pending = context.refreshSwtSample(old);
  context.swtResultPassage = current;
  note.textContent = 'Current passage note';
  finishSample('Old sample');
  await pending;
  assert.equal(sample.textContent, 'Current passage sample');
  assert.equal(note.textContent, 'Current passage note');
});

test('Sample tab actually reveals its panel instead of leaving the static display-none class active', () => {
  const toggle = functionSource('switchSbsView');
  assert.match(toggle, /vSum\.hidden = isSample/);
  assert.match(toggle, /vSam\.hidden = !isSample/);
  assert.doesNotMatch(toggle, /style\.display/);
  const panel = html.match(/<div id="sbsViewSample"[^>]*>/)?.[0] || '';
  assert.match(panel, /\bhidden\b/);
  assert.doesNotMatch(panel, /u-inline-005/);
});

test('Sample display is independent of verification availability', () => {
  const check = functionSource('checkSwtSample', true);
  const refresh = functionSource('refreshSwtSample', true);
  assert.match(check, /sample:\s*result\.sample \|\| passage\.sampleResponse/);
  assert.match(check, /sample:\s*passage\.sampleResponse/);
  assert.match(refresh, /await fetchSwtSampleText\(passage\)/);
  assert.match(refresh, /sample\.textContent = sampleText/);
});

test('The plain sample loads immediately and a saved attempt with a different passage version stays separate', async () => {
  const note = { textContent:'', dataset:{}, setAttribute() {} };
  const sample = { textContent:'' };
  const current = { id:38, teachingSample:'Useful results can come as a surprise.' };
  const context = { swtResultPassage:current, document:{getElementById:id => id === 'sampleAnswerNotes' ? note : sample},
    fetch() { assert.fail('The plain sample is available with the passage.'); },
    checkSwtSample:async passage => ({ sample:passage.sampleResponse, note:'Checked', status:'verified' }) };
  vm.createContext(context);
  vm.runInContext(functionSource('fetchSwtSampleText',true) + '\n' + functionSource('refreshSwtSample',true),context);
  await context.refreshSwtSample(current);
  assert.equal(sample.textContent,current.teachingSample);
  assert.equal(note.dataset.status,'verified');
  const earlier = { ...current, sampleVersionMismatch:true };
  context.swtResultPassage = earlier;
  sample.textContent = '';
  await context.refreshSwtSample(earlier);
  assert.equal(sample.textContent,'');
  assert.match(note.textContent,/earlier version/);
});

test('A saved result hides mismatched passage evidence and restores it for a matching attempt', () => {
  const { document } = require('linkedom').parseHTML(html);
  const get = id => document.getElementById(id);
  const answer = 'Trees shade streets and cool nearby homes.';
  const passage = { id: 21, title: 'Tree shade', text: 'Trees reduce temperatures by shading streets.', passageHash: 'new',
    sampleResponse: answer, keyElements: { what: 'Trees reduce temperatures.' } };
  const context = { document, escapeHtml, currentPassageId: 1, currentUserId: 'student', sessionToken: 'token',
    canonicalClientUserId: String, countWords: text => text.split(/\s+/).length,
    SwtStudentFeedback: require('../public/swt-feedback'), SwtFeedbackReview: require('../public/swt-feedback-review'),
    window: { PteEstimateDisplay: { render: () => '' } }, renderTraitBreakdown() {}, renderAboutPassage() {}, updateResultsNav() {},
    refreshSwtSample() { assert.fail('A result without matching source evidence cannot check a sample.'); } };
  vm.createContext(context);
  vm.runInContext(['showResults','showSwtRetryStatus','renderSwtSourceEvidence','renderAnnotatedPassage','renderSwtKeyPhrases',
    'renderAnnotatedSubmission','renderSwtFeedbackReview','renderOriginality','computeCopyMetrics','switchSbsView','fmtNum','buildResultSummary']
    .map(name => functionSource(name)).join('\n'), context);
  const data = { trait_scores: { content: 3, form: 1, grammar: 2, vocabulary: 2 }, item_score_90: 79 };

  context.showResults({ ...data, source_identity: { passage_sha256: 'new' } }, passage, null, answer);
  assert.equal(get('annotatedPassage').textContent, passage.text);
  assert.ok(get('swtGuidanceBody').querySelector('[data-review-source]'));

  context.showResults({ ...data, source_identity: { passage_sha256: 'old' } }, passage, null, answer);
  assert.equal(get('annotatedSubmission').textContent, answer);
  assert.equal(get('heroScore').textContent, '79');
  assert.equal(get('annotatedPassage').textContent, '');
  assert.equal(get('annotatedPassage').closest('.sbs-col').hidden, true);
  assert.equal(get('swtKeyPhrases').closest('details').hidden, true);
  assert.equal(get('originalityChecks').closest('details').hidden, true);
  assert.equal(get('sbsTabSample').hidden, true);
  assert.equal(get('swtGuidanceBody').querySelector('[data-review-source]'), null);
  assert.equal(get('swtReviewRevision'), null);
  assert.match(get('swtRubricNotice').textContent, /Your saved summary/);
  context.switchSbsView('sample');
  assert.equal(get('sbsViewSummary').hidden, false);

  context.showResults({ ...data, score_provisional: true, source_identity: { passage_sha256: 'old' } }, passage, null, answer);
  assert.equal(get('swtRetryAssessmentBtn').hidden, true);
  context.showResults({ ...data, score_provisional: true, source_identity: { passage_sha256: 'new' } }, passage, null, answer);
  assert.equal(get('swtRetryAssessmentBtn').hidden, false);
  assert.equal(get('swtKeyPhrases').closest('details').hidden, false);
  assert.equal(get('sbsTabSample').hidden, false);
  assert.equal(get('swtRubricNotice').hidden, true);
});

test('Retry rejects a passage that changed after the saved result was opened', async () => {
  const button = { style: {} }, notice = { style: {} };
  const submission = { passageId: 21, text: 'Trees shade streets and cool nearby homes.',
    passageText: 'The earlier source.', passageHash: 'old', retryAllowed: true, ownerId: 'student', token: 'token' };
  const context = { swtResultSubmission: submission, currentUserId: 'student', sessionToken: 'token', swtGradingPending: false,
    passages: [{ id: 21, text: 'The changed source.', passageHash: 'new' }], swtPassageStorageId: () => 21, canonicalClientUserId: String,
    document: { getElementById: id => ({ swtRetryAssessmentBtn: button, aiDegradedNotice: notice })[id] || null },
    requestSwtGrade() { assert.fail('The saved summary must stay linked to the earlier source.'); } };
  vm.createContext(context);
  vm.runInContext(functionSource('retrySwtAssessment') + '\n' + functionSource('scoreSummary', true)
    + '\n' + functionSource('showSwtRetryStatus'), context);
  await context.retrySwtAssessment();
  assert.equal(submission.retryAllowed, false);
  assert.equal(button.hidden, true);
  assert.match(notice.textContent, /saved summary is still here/);
});

test('Score cards size independently and phrase cards stack on narrow screens', () => {
  assert.match(css, /\.trait-breakdown[^}]*align-items: start/);
  assert.match(css, /\.trait-note[^}]*font-style: normal/);
  const mobile = css.slice(css.indexOf('@media (max-width: 560px)'));
  assert.match(mobile, /\.swt-key-grid[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /focus-visible[^}]*outline:/);
});
