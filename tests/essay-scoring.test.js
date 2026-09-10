'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const policy = require('../public/essay-scoring');
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
    strengths: ['Clear relevant examples.'], improvements: [], sampleResponse: '' };
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

test('Quoted real misspellings support deductions without counting stylistic advice', () => {
  const text = essay.replace('information', 'infromation');
  const raw = good(); raw.scores.spelling = 2;
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
  assert.match(htmlSource, /essay-scoring\.js\?v=20\.3\.6/);
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
