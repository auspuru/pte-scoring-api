'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const policy = require('../public/essay-scoring');
const sync = require('../essay-attempt-sync');
const { createEssayGrader } = require('../essay-grading');
const { question, essay } = require('./essay-fixtures');
const uiSource = fs.readFileSync(path.join(__dirname, '../public/index.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
function good() {
  return { scores: { ...policy.MAXIMA },
    feedback: Object.fromEntries(Object.keys(policy.MAXIMA).map(key => [key, 'Your ideas are clear and relevant.'])),
    errors: [], optionalRefinements: [],
    promptCoverage: [{ requirement: 'Positive and negative effects', status: 'addressed', evidence: 'mass media supports learning', nextStep: '' }],
    templateDetector: 'good', templateNote: 'The structure is filled with relevant ideas.',
    strengths: ['Clear relevant examples.'], improvements: [],
    sampleStatus: 'ready', sampleResponse: essay,
    sampleSourceIdeas: ['mass media supports learning', 'unrealistic expectations'], sampleNote: '' };
}

test('Essay word-count boundaries are deterministic and independent of model counting', () => {
  for (const [count, expected] of [[119,0],[120,1],[199,1],[200,2],[280,2],[300,2],[301,1],[380,1],[381,0]]) {
    const result = policy.formFor(Array(count).fill('word').join(' '));
    assert.equal(result.count, count); assert.equal(result.score, expected);
    if (expected === 1) assert.match(result.feedback, /within the 120–380 allowed range/);
  }
  const raw = good(); raw.scores.form = 0; raw.feedback.form = 'Only 90 words, too short.';
  const result = policy.normalizeResult(raw, essay);
  assert.equal(result.scores.form, 2);
  assert.equal(result.wordCount, policy.words(essay));
  assert(!result.feedback.form.includes('90 words'));
});

test('Style refinements are separate from actual grammar and never disguised as errors', () => {
  const raw = good();
  raw.errors = [{ type: 'style', phrase: 'has become increasingly important', correction: 'has gained importance', explanation: 'A shorter option.' }];
  const result = policy.normalizeResult(raw, essay);
  assert.equal(result.errors.length, 0);
  assert.equal(result.optionalRefinements.length, 1);
  assert.equal(result.optionalRefinements[0].affects_score, false);
  assert.equal(result.scores.grammar, 2);
});

test('Missing traits, unexplained language deductions and fabricated quotations cannot become saved zeros', () => {
  const variants = [raw => delete raw.scores.content,
    raw => { raw.scores.grammar = 1; },
    raw => { raw.scores.spelling = 0; },
    raw => { raw.promptCoverage[0].evidence = 'The essay never says this'; },
    raw => { raw.scores.linguistic = 4.8; },
    raw => { raw.feedback.content = ''; }];
  for (const change of variants) {
    const raw = good(); change(raw);
    assert.throws(() => policy.normalizeResult(raw, essay), /incomplete/);
  }
});

test('A content deduction always has a next step, even if the model omitted improvements', () => {
  const raw = good(); raw.scores.content = 4;
  raw.promptCoverage[0] = { requirement: 'Positive and negative effects', status: 'partial',
    evidence: 'mass media supports learning', nextStep: 'Explain one negative effect on young people with an example.' };
  delete raw.improvements;
  const result = policy.normalizeResult(raw, essay);
  assert.match(result.improvements[0], /negative effect/);
  raw.scores.content = 6;
  assert.throws(() => policy.normalizeResult(raw, essay), /incomplete/);
});

test('Stitched coverage evidence is repaired to a real excerpt without admitting fabricated evidence', () => {
  const raw = good();
  raw.promptCoverage[0].evidence = 'Advertisements often connect expensive products with happiness or popularity, which may lead teenagers to compare themselves with carefully selected images. Schools can respond by teaching students to distinguish evidence from opinion and recognise commercial messages.';
  const result = policy.normalizeResult(raw, essay);
  assert(essay.includes(result.promptCoverage[0].evidence));
  assert(!result.promptCoverage[0].evidence.includes('Schools can respond'));
  assert.equal(result.scores.total, 26);
  raw.promptCoverage[0].evidence = 'Completely invented claims about rockets and submarines';
  assert.throws(() => policy.normalizeResult(raw, essay), { code: 'coverage_quote' });
  const spaced = essay.replace('mass media supports learning', 'mass media  supports\nlearning');
  assert.doesNotThrow(() => policy.normalizeResult(good(), spaced));
});

test('Quoted real misspellings support deductions without counting stylistic advice', () => {
  const text = essay.replace('information', 'infromation');
  const raw = good(); raw.scores.spelling = 1;
  raw.errors = [{ type: 'spelling', phrase: 'infromation', correction: 'information', impact: 'minor', explanation: 'Correct the letter order.' }];
  const result = policy.normalizeResult(raw, text);
  assert.equal(result.scores.spelling, 2);
  assert.equal(result.scores.grammar, 2);
  assert.deepEqual(result.spellingErrors, []);
  assert.equal(result.optionalRefinements[0].affects_score, false);
});

test('Meaning-changing language errors are the only grammar deductions', () => {
  const text = essay.replace('can educate', 'cannot educate');
  const raw = good(); raw.scores.grammar = 1;
  raw.errors = [{ type: 'grammar', phrase: 'cannot educate', correction: 'can educate', impact: 'meaning',
    explanation: 'The added negation reverses the claim about what media can do.' }];
  const result = policy.normalizeResult(raw, text);
  assert.equal(result.scores.grammar, 1);
  assert.deepEqual(result.grammarIssues, ['cannot educate']);
});

test('Minor learner grammar gets coherent feedback and survives server and browser validation', () => {
  const text = essay.replace('mass media supports learning', 'mass media support learning');
  const raw = good(); raw.scores.grammar = 1;
  raw.promptCoverage[0].evidence = 'mass media support learning';
  raw.sampleSourceIdeas[0] = 'mass media support learning';
  raw.errors = [{ type: 'grammar', phrase: 'mass media support learning', correction: 'mass media supports learning',
    impact: 'meaning', explanation: 'The singular subject requires the verb supports.' }];
  raw.feedback.grammar = 'One grammar error costs a mark.';
  const result = policy.normalizeResult(raw, text);
  assert.equal(result.scores.grammar, 2);
  assert.match(result.feedback.grammar, /Full Grammar marks/);
  assert.equal(result.optionalRefinements.length, 1);
  assert.deepEqual(policy.normalizeResult(result, text), result);
});

test('Prompt requires an opinion only when the question asks and avoids template-count rules', () => {
  const prompt = policy.buildPrompt(question, essay);
  assert.match(prompt, /personal opinion only if the question requests one/);
  assert.match(prompt, /not a one-sentence SWT summary/);
  assert.match(prompt, /Do not claim database matching/);
  assert.match(prompt, /optionalRefinements/);
});

test('The renderer allows change markers but escapes model-supplied HTML and scripts', () => {
  const result = policy.renderExcerpt('A <span class="diff-ins">clearer</span> idea <img src=x onerror="bad()"><script>bad()</script>');
  assert(result.includes('<span class="diff-ins">clearer</span>'));
  assert(!result.includes('<img')); assert(!result.includes('<script>'));
  assert(result.includes('&lt;img'));
});

test('Essay UI uses the validated grader and keeps the detailed rubric secondary', () => {
  assert.match(uiSource, /\/api\/essay\/grade/);
  assert.match(uiSource, /EssayScoring\.normalizeResult\(data, essay\)/);
  assert.match(uiSource, /<span class="pte-metric-label">Practice score<\/span>/);
  assert.match(uiSource, /<details class="essay-feedback-details"><summary>Score breakdown and feedback<\/summary>/);
  assert.match(htmlSource, /essay-scoring\.js\?v=20\.4\.6/);
});

test('Incomplete model output gets one retry; only validated assessments are cached', async () => {
  let calls = 0;
  const grader = createEssayGrader(async () => ++calls === 1 ? {} : good());
  const [a, b] = await Promise.all([grader.grade(question, essay), grader.grade(question, essay)]);
  assert.equal(calls, 2); assert.equal(a.scores.total, 26); assert.deepEqual(a, b);
  a.scores.content = 0;
  assert.equal((await grader.grade(question, essay)).scores.content, 6);
  assert.equal(calls, 2);
  let failures = 0;
  const broken = createEssayGrader(async () => { failures++; throw new Error('provider failed'); });
  await assert.rejects(broken.grade(question, essay), /could not be completed/);
  await assert.rejects(broken.grade(question, essay), /could not be completed/);
  assert.equal(failures, 4);
});

test('Full-score essays retain a complete sample and sample changes never alter original scores', () => {
  const raw = good();
  const result = policy.normalizeResult(raw, essay);
  assert.equal(result.scores.total, 26);
  assert.equal(result.sampleResponse, essay);
  assert.equal(result.sampleKind, 'full-essay');
  assert.equal(result.sampleWordCount, policy.words(essay));
  assert.deepEqual(policy.normalizeResult(result, essay), result, 'Server results remain valid in the browser');
  const lower = good(); lower.scores.vocabulary = 1;
  const a = policy.normalizeResult(lower, essay);
  lower.sampleResponse = essay.replace('in recent years', 'in modern society');
  const b = policy.normalizeResult(lower, essay);
  assert.deepEqual(a.scores, b.scores);
  assert.deepEqual(a.feedback, b.feedback);
  assert.equal(b.scores.total, 25);
});

test('Incomplete, excerpt-only, ungrounded or marked-up samples are retried instead of shown', async () => {
  for (const change of [
    raw => { raw.sampleResponse = ''; },
    raw => { raw.sampleResponse = 'Only a short excerpt.'; },
    raw => { raw.sampleResponse = essay.replace(/\n\n/g, ' '); },
    raw => { raw.sampleResponse = essay + ' additional'.repeat(301); },
    raw => { raw.sampleResponse = essay.replace('mass media', '<b>mass media</b>'); },
    raw => { raw.sampleSourceIdeas = ['A fabricated idea absent from the original']; },
    raw => { raw.sampleSourceIdeas = []; },
    raw => { delete raw.sampleStatus; }
  ]) {
    const raw = good(); change(raw);
    assert.throws(() => policy.normalizeResult(raw, essay), /incomplete/);
  }
  let calls = 0;
  const grader = createEssayGrader(async prompt => {
    const raw = good();
    if (++calls === 1) raw.sampleResponse = 'Too short.';
    else assert.match(prompt, /VALIDATION RETRY:[\s\S]*200–300 words/);
    return raw;
  });
  const result = await grader.grade(question, essay);
  assert.equal(calls, 2);
  assert.equal(result.sampleResponse, essay);
});

test('A failed sample preserves the grade and a sample-only retry cannot rescore it', async () => {
  let calls = 0;
  const failures = [];
  const grader = createEssayGrader(async prompt => {
    calls++;
    if (calls === 1) return { ...good(), sampleResponse: 'Too short.' };
    assert.match(prompt, /do not rescore or change the assessment/);
    if (calls === 2) {
      assert.match(prompt, /VALIDATION RETRY: The sample must contain 200–300 words/);
      throw new Error('Temporary provider failure');
    }
    return { ...good(), scores: { ...policy.MAXIMA, content: 0 } };
  }, { onAttemptError: detail => failures.push(detail) });
  const partial = await grader.grade(question, essay);
  assert.equal(partial.scores.total, 26);
  assert.equal(partial.sampleKind, 'unavailable');
  assert.equal(partial.sampleResponse, '');
  assert.equal(failures[0].code, 'sample_length');
  assert.deepEqual(policy.normalizeResult(partial, essay), partial);
  const ready = await grader.grade(question, essay);
  assert.equal(ready.sampleKind, 'full-essay');
  assert.equal(ready.sampleResponse, essay);
  assert.deepEqual(ready.scores, partial.scores);
  await grader.grade(question, essay);
  assert.equal(calls, 3, 'The completed sample should be cached');
});

test('Assessment validation retries explain the actual failure and never return a fabricated grade', async () => {
  let calls = 0;
  const grader = createEssayGrader(async prompt => {
    if (++calls > 1) assert.match(prompt, /VALIDATION RETRY: Return an integer score in range and feedback for content/);
    const raw = good(); delete raw.scores.content; return raw;
  });
  await assert.rejects(grader.grade(question, essay), error => error.cause?.code === 'trait_content');
});

test('Missing ideas produce an honest next step and cannot suppress a full-score sample', () => {
  const raw = good(); raw.scores.content = 1;
  raw.promptCoverage = [{ requirement: 'A position about railways versus roads', status: 'missing', evidence: '',
    nextStep: 'State which transport investment you support and give a reason.' }];
  raw.sampleStatus = 'needs-ideas'; raw.sampleResponse = ''; raw.sampleSourceIdeas = [];
  raw.sampleNote = 'Your essay discusses media. Add your position about railways versus roads and a supporting reason.';
  const result = policy.normalizeResult(raw, essay);
  assert.equal(result.sampleKind, 'needs-ideas');
  assert.equal(result.sampleResponse, '');
  assert.match(result.sampleNote, /railways versus roads/);
  assert.deepEqual(policy.normalizeResult(result, essay), result);
  delete raw.sampleNote;
  assert.throws(() => policy.normalizeResult(raw, essay), /incomplete/);
  const perfect = good(); perfect.sampleStatus = 'needs-ideas'; perfect.sampleResponse = ''; perfect.sampleNote = 'Already perfect.';
  assert.throws(() => policy.normalizeResult(perfect, essay), /incomplete/);
});

test('Sample instructions preserve student ideas and position independently of assessment', () => {
  const prompt = policy.buildPrompt(question, essay);
  for (const instruction of [/200–300 words in exactly four paragraphs/, /even when the original earns 26\/26/,
    /Do not replace their arguments/, /invent statistics/, /must never influence the original essay/,
    /Do not invent that position/, /sampleSourceIdeas/]) assert.match(prompt, instruction);
});

test('Samples reject introduced named examples and figures while retaining the student’s own evidence', () => {
  for (const phrase of ['News reports from Copenhagen', 'News reports from UNESCO', 'News reports about 85% of students']) {
    const raw = good(); raw.sampleResponse = essay.replace('News reports', phrase);
    assert.throws(() => policy.normalizeResult(raw, essay), /incomplete/);
  }
  const original = essay.replace('a local flood', 'a local flood in Sydney');
  const raw = good(); raw.sampleResponse = original;
  assert.equal(policy.normalizeResult(raw, original).sampleResponse, original);
});

function browserFunction(name) {
  const start = uiSource.indexOf('function ' + name + '(');
  assert(start >= 0, name);
  return uiSource.slice(start, uiSource.indexOf('\n}', start) + 2);
}

test('Saved samples keep their paragraphs and copy as plain text; legacy excerpts retain their label', () => {
  const result = policy.normalizeResult(good(), essay);
  const stored = JSON.parse(JSON.stringify({ ...result, id: 'sample-attempt', date: 1, essayText: essay }));
  const restored = sync.mergeHistory([], [stored], [])[0];
  const browser = { EssayScoring: policy, practiceSamplePendingId: null };
  vm.createContext(browser);
  vm.runInContext(['escapeHtml', 'renderPracticeSample', 'getCleanSampleResponse'].map(browserFunction).join('\n'), browser);
  const html = browser.renderPracticeSample(restored);
  assert.match(html, /Band 9 sample · Your ideas/);
  assert.match(html, /Copy sample essay/);
  assert(!html.includes('Copy revised excerpt'));
  assert(html.includes(browser.escapeHtml(essay)));
  assert.equal(browser.getCleanSampleResponse(restored.sampleResponse, restored.sampleKind), essay);
  const legacy = browser.renderPracticeSample({ sampleResponse: 'A <span class="diff-ins">clearer</span> idea.' });
  assert.match(legacy, /Example revision/);
  assert.match(legacy, /Copy revised excerpt/);
  assert(!legacy.includes('Band 9 sample'));
  assert(legacy.includes('<span class="diff-ins">clearer</span>'));
  const hostile = browser.renderPracticeSample({ sampleKind: 'full-essay', sampleResponse: '<img src=x onerror="bad()">' });
  assert(!hostile.includes('<img'));
  const missing = browser.renderPracticeSample({ sampleKind: 'needs-ideas', sampleNote: '<script>bad()</script> Add a position.' });
  assert(!missing.includes('<script>'));
  assert.match(missing, /Add a position/);
  assert(!missing.includes('Copy sample essay'));
  const unavailable = browser.renderPracticeSample({ id: 'retry', sampleKind: 'unavailable', sampleNote: 'Your score is ready.' });
  assert.match(unavailable, /Retry sample/);
  assert(!unavailable.includes('Copy sample essay'));
});
