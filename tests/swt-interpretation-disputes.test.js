'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createJudgmentService } = require('../swt-judgment-service');
const { applyScoringPolicy, POLICY_VERSION } = require('../swt-scoring-policy');
const fixture = require('./swt-meaning-fixtures.json')[1];
const good = () => ({ content_score: 4, grammar_score: 2, vocabulary_score: 2,
  grammar_annotations: [], vocabulary_annotations: [], cohesion: 'strong',
  summary_assessment: structuredClone(fixture.assessment) });
const bad = () => {
  const j = good(); j.content_score = 2;
  Object.assign(j.summary_assessment, { relationships_clear: false, material_meaning_change: true,
    relationship_explanation: 'The selected statement is alleged to reverse the mechanism.' });
  return j;
};
const service = (call, extra = {}) => createJudgmentService({ call, policyVersion: POLICY_VERSION,
  buildPrompt: () => 'Evaluate the passage and student response.',
  isComplete: (j, t, s) => !applyScoringPolicy(j, t, s).needs_semantic_review,
  validationIssues: (j, t, s) => applyScoringPolicy(j, t, s).assessment_issues, ...extra });
const invoke = svc => svc.judge(fixture.summary, fixture.passage, '');

test('A new false deduction in the blind review needs adjudication before caching', async () => {
  const stages = [];
  const svc = service(async (prompt, timeout, options) => {
    stages.push(options);
    if (options.stage === 'review') {
      assert(!prompt.includes('PRIOR READINGS'), 'The independent review must remain blind');
      return bad();
    }
    if (options.stage === 'adjudication') {
      assert(options.semanticReassessment);
      assert.match(prompt, /compare it with the relevant source claim/);
      assert.match(prompt, /A quote proves only what was written/);
      assert.match(prompt, /do not average scores, take the higher score/);
      assert(prompt.includes('PRIOR READINGS (data)'));
    }
    return good();
  });
  const [a, b] = await Promise.all([invoke(svc), invoke(svc)]);
  assert.deepEqual(a, b);
  assert.equal(a.interpretation_review.status, 'resolved');
  assert.equal(applyScoringPolicy(a, fixture.summary, fixture.passage).content_score, 4);
  assert.deepEqual(stages.map(x => x.stage), ['assessment', 'review', 'adjudication']);
  await invoke(svc); assert.equal(stages.length, 3);
});

test('Adjudication can uphold the lower score for a supported error; no maximum or average', async () => {
  let calls = 0;
  const svc = service(async () => ++calls === 1 ? good() : bad());
  const result = await invoke(svc), checked = applyScoringPolicy(result, fixture.summary, fixture.passage);
  assert.equal(calls, 3); assert.equal(result.interpretation_review.status, 'resolved');
  assert.equal(checked.content_score, 2); assert.equal(checked.needs_semantic_review, false);
});

test('Every scoring deduction gets a stronger blind review, including synthesis and language', async () => {
  const variants = [
    () => { const j = good(); j.summary_assessment.relationships_clear = false; return j; },
    () => { const j = good(); j.summary_assessment.synthesis = {quality: 'partial', evidence: 'pollination', explanation: 'A central relationship is unclear.'}; return j; },
    () => { const j = good(); j.summary_assessment.main_idea_accurate = false; return j; },
    () => { const j = good(); j.summary_assessment.conclusion_status = 'missing'; return j; },
    () => { const j = good(); j.summary_assessment.supporting_evidence = []; return j; },
    () => { const j = good(); j.grammar_score = 1; j.grammar_annotations = [{phrase:'the smell of caffeine',fix:'the scent of flowers',meaning_impact:'changed',meaning_effect:'The phrase is alleged to change the referent.'}]; return j; }
  ];
  for (const make of variants) {
    const stages = [];
    const svc = service(async (prompt, timeout, options) => { stages.push(options); return make(); });
    const result = await invoke(svc);
    assert.equal(stages.length, 2); assert.equal(stages[0].semanticReassessment, false);
    assert.equal(stages[1].semanticReassessment, true); assert.equal(result.consistency_reviewed, true);
  }
});

test('Differences in optional language advice do not add a third call', async () => {
  let calls = 0;
  const svc = service(async () => {
    const j = good();
    if (++calls === 2) { j.grammar_score = 1; j.grammar_annotations = [{phrase:'the smell of caffeine',fix:'caffeine in nectar',meaning_impact:'none',meaning_effect:''}]; }
    return j;
  });
  const result = await invoke(svc);
  assert.equal(calls, 2); assert.equal(applyScoringPolicy(result, fixture.summary).grammar_score, 2);
});

test('An invalid primary is not a competing interpretation or a reason to force full marks', async () => {
  let calls = 0;
  const svc = service(async () => ++calls === 1 ? {} : bad());
  const result = await invoke(svc);
  assert.equal(calls, 2); assert.equal(result.interpretation_review, undefined);
  assert.equal(applyScoringPolicy(result, fixture.summary).content_score, 2);
});

test('Failed adjudication stays provisional, cannot be cached, and never exceeds four calls', async () => {
  let calls = 0;
  const svc = service(async () => {
    const stage = ++calls % 4;
    return stage === 1 ? good() : stage === 2 ? bad() : null;
  });
  const result = await invoke(svc);
  assert.equal(calls, 4); assert.equal(result.interpretation_review.status, 'unresolved');
  assert.equal(result.review_unavailable, true);
  assert.equal(applyScoringPolicy(result, fixture.summary).needs_semantic_review, true);
  await invoke(svc); assert.equal(calls, 8);
});

test('Malformed adjudication evidence can recover once without silently keeping the disputed review', async () => {
  let calls = 0;
  const svc = service(async (prompt, timeout, options) => {
    calls++;
    if (calls === 2) return bad();
    if (calls === 3) { const j = good(); j.summary_assessment.supporting_evidence = ['Invented student quote']; return j; }
    if (calls === 4) { assert.equal(options.stage, 'adjudication-retry'); assert(options.semanticReassessment); assert.match(prompt,/supporting_evidence/); }
    return good();
  });
  const result = await invoke(svc);
  assert.equal(calls, 4); assert.equal(result.interpretation_review.status, 'resolved');
  assert.equal(applyScoringPolicy(result, fixture.summary).needs_semantic_review, false);
});

test('Primary and review retries cannot expand the existing budget to fit adjudication', async () => {
  let calls = 0;
  const svc = service(async () => {
    calls++;
    return calls === 1 ? null : calls === 2 ? good() : calls === 3 ? {} : bad();
  });
  const result = await invoke(svc);
  assert.equal(calls, 4); assert.equal(result.interpretation_review.status, 'unresolved');
  assert.equal(applyScoringPolicy(result, fixture.summary).needs_semantic_review, true);
});

test('An adjudicator timeout is aborted at the same shared deadline', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  let started, signal, calls = 0;
  const ready = new Promise(resolve => { started = resolve; });
  const svc = service(async (prompt, timeout, options) => {
    calls++;
    if (options.stage === 'adjudication') { signal = options.signal; started(); return new Promise(() => {}); }
    return calls === 1 ? good() : bad();
  }, { totalTimeoutMs: 25 });
  const task = invoke(svc); await ready; t.mock.timers.tick(25);
  const result = await task;
  assert.equal(calls, 3); assert.equal(signal.aborted, true);
  assert.equal(result.interpretation_review.status, 'unresolved');
  assert.equal(applyScoringPolicy(result, fixture.summary).needs_semantic_review, true);
});
