'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createJudgmentService } = require('../swt-judgment-service');
const { applyScoringPolicy } = require('../swt-scoring-policy');
const fixture = require('./swt-meaning-fixtures.json')[1];
const good = () => ({ content_score: 4, summary_assessment: structuredClone(fixture.assessment),
  grammar_score: 2, vocabulary_score: 2, grammar_annotations: [], vocabulary_annotations: [], cohesion: 'strong' });
const service = (call, extra = {}) => createJudgmentService({ call,
  buildPrompt: (text, source, ideas) => JSON.stringify({ text, source, ideas }), policyVersion: 'test',
  isComplete: (j, text) => !applyScoringPolicy(j, text).needs_semantic_review, ...extra });
const invoke = svc => svc.judge(fixture.summary, fixture.passage, 'diagnostic ideas');

test('Student and sample requests for the same response share one complete assessment', async () => {
  let calls = 0;
  const svc = service(async () => { calls++; await Promise.resolve(); return good(); });
  const [student, reference] = await Promise.all([invoke(svc), invoke(svc)]);
  assert.deepEqual(student, reference);
  assert.equal(calls, 1);
  student.summary_assessment.relationships_clear = false;
  const repeat = await invoke(svc);
  assert.equal(repeat.summary_assessment.relationships_clear, true, 'Route mutations must not contaminate the cache');
  assert.equal(calls, 1);
});

test('Changed passage, diagnostics or rubric cannot reuse an old assessment', async () => {
  let calls = 0;
  const svc = service(async () => { calls++; return good(); });
  await invoke(svc);
  await svc.judge(fixture.summary, fixture.passage + ' New information.', 'diagnostic ideas');
  await svc.judge(fixture.summary, fixture.passage, 'updated ideas');
  assert.equal(calls, 3);
  const other = service(async () => good(), { policyVersion: 'new' });
  assert.notEqual(svc.keyFor('a', 'b', 'c'), other.keyFor('a', 'b', 'c'));
});

test('A disputed relationship gets an independent review, not an automatic full-score override', async () => {
  const disputed = good();
  Object.assign(disputed.summary_assessment, { relationships_clear: false, material_meaning_change: true });
  disputed.content_score = 2;
  let calls = 0;
  const svc = service(async prompt => {
    calls++;
    if (calls === 1) return disputed;
    assert.match(prompt, /SECOND-PASS CONSISTENCY CHECK/);
    return good();
  });
  const result = await invoke(svc);
  assert.equal(calls, 2);
  assert.equal(result.consistency_reviewed, true);
  assert.equal(applyScoringPolicy(result, fixture.summary).content_score, 4);
});

test('A genuine missing cause confirmed by the review stays below full content', async () => {
  const disputed = good();
  Object.assign(disputed.summary_assessment, { relationships_clear: false,
    missing_dependencies: [{ effect: 'pollination', missing_context: 'The necessary memory mechanism is missing.' }] });
  disputed.content_score = 3;
  let calls = 0;
  const svc = service(async () => { calls++; return disputed; });
  const result = applyScoringPolicy(await invoke(svc), fixture.summary);
  assert.equal(calls, 2);
  assert.equal(result.content_score, 3);
  assert.equal(result.grammar_score, 2);
  assert.equal(result.full_content_eligible, false);
});

test('Unavailable second review is provisional and is not cached as a confirmed deduction', async () => {
  const disputed = good(); disputed.summary_assessment.relationships_clear = false;
  let calls = 0;
  const svc = service(async () => { calls++; return calls % 2 ? disputed : null; });
  const result = applyScoringPolicy(await invoke(svc), fixture.summary);
  assert.equal(result.needs_semantic_review, true);
  assert.equal(result.full_content_eligible, false);
  await invoke(svc);
  assert.equal(calls, 4);
});

test('Failed or malformed assessments are retried rather than cached', async () => {
  let calls = 0;
  const svc = service(async () => { calls++; return calls === 1 ? null : calls === 2 ? {} : good(); });
  assert.equal(await invoke(svc), null);
  await invoke(svc);
  await invoke(svc);
  await invoke(svc);
  assert.equal(calls, 3);
});

test('Expired and evicted entries cause a fresh assessment', async () => {
  let calls = 0;
  const svc = service(async () => { calls++; return good(); }, { ttlMs: -1 });
  await invoke(svc); await invoke(svc);
  assert.equal(calls, 2);
  const bounded = service(async () => { calls++; return good(); }, { maxEntries: 1 });
  await invoke(bounded);
  await bounded.judge(fixture.summary, fixture.passage, 'different hints');
  await invoke(bounded);
  assert.equal(calls, 5);
});

test('Meaning-changing language allegations are reviewed even when content was marked complete', async () => {
  const j = good();
  j.grammar_annotations = [{ phrase: 'the smell of caffeine', fix: 'caffeine in nectar',
    meaning_impact: 'changed', meaning_effect: 'A preliminary alleged ambiguity.' }];
  let calls = 0;
  const svc = service(async () => ++calls === 1 ? j : good());
  const result = await invoke(svc);
  assert.equal(calls, 2);
  assert.equal(applyScoringPolicy(result, fixture.summary).grammar_score, 2);
});

test('Paraphrased evidence triggers a fresh exact-quote check instead of a false Content deduction', async () => {
  const malformed = good();
  malformed.summary_assessment.main_idea_evidence = 'The main idea [has been] paraphrased by the judge';
  assert.equal(applyScoringPolicy(malformed, fixture.summary).needs_semantic_review, true);
  let calls = 0;
  const svc = service(async () => ++calls === 1 ? malformed : good());
  const corrected = applyScoringPolicy(await invoke(svc), fixture.summary);
  assert.equal(calls, 2);
  assert.equal(corrected.needs_semantic_review, false);
  assert.equal(corrected.content_score, 4);
});
