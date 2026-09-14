'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const format = require('../swt-judge-format');
const { materialiseEvidence, createJudgmentService } = require('../swt-judgment-service');
const { applyScoringPolicy } = require('../swt-scoring-policy');
const fixture = require('./swt-meaning-fixtures.json')[1];
const complete = () => ({ content_score: 4, grammar_score: 2, vocabulary_score: 2, cohesion: 'strong',
  summary_assessment: structuredClone(fixture.assessment), grammar_annotations: [], vocabulary_annotations: [],
  per_idea_scores: {}, feedback_note: 'The main idea and supporting relationships are clear.' });
const envelope = input => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: format.tool.name, input }] });

test('The SWT contract puts both required annotation arrays before the final feedback field', () => {
  const request = format.request('Assess the supplied summary.', 'claude-haiku-4-5-20251001');
  assert.equal(request.tools.length, 1);
  const tool = request.tools[0];
  assert.deepEqual(request.tool_choice, { type: 'tool', name: tool.name });
  for (const field of ['content_score', 'grammar_score', 'vocabulary_score', 'summary_assessment', 'grammar_annotations', 'vocabulary_annotations']) {
    assert(tool.input_schema.required.includes(field));
  }
  assert.equal(tool.input_schema.properties.grammar_annotations.type, 'array');
  assert.equal(tool.input_schema.properties.vocabulary_annotations.type, 'array');
  assert.equal(Object.keys(tool.input_schema.properties).at(-1), 'feedback_note');
  assert.match(request.messages[0].content, /separate top-level arrays/);
  assert.equal(request.max_tokens, 4000);
});

test('The exact live failure recovers already-provided arrays from escaped feedback JSON', () => {
  // Reproduced from the live Web-passage calibration: the non-strict provider
  // put escaped JSON inside feedback_note instead of returning the two arrays.
  const malformed = complete();
  delete malformed.grammar_annotations;
  delete malformed.vocabulary_annotations;
  malformed.feedback_note += '\\",\\n \\"grammar_annotations\\": [],\\n \\"vocabulary_annotations\\": []';
  assert.deepEqual(applyScoringPolicy(malformed, fixture.summary).assessment_issues, ['grammar_annotations', 'vocabulary_annotations']);
  const recovered = format.response(envelope(malformed));
  assert.deepEqual(recovered.grammar_annotations, []);
  assert.deepEqual(recovered.vocabulary_annotations, []);
  assert.equal(recovered.feedback_note, complete().feedback_note);
  assert.equal(recovered.annotation_format_recovered, true);
  const result = applyScoringPolicy(recovered, fixture.summary);
  assert.equal(result.needs_semantic_review, false);
  assert.equal(result.content_score, 4);
});

test('A complete structured response preserves exact corrections and confirms the assessment', () => {
  const input = complete();
  input.grammar_annotations = [{ phrase_span: [1, 3], fix: 'An optional wording refinement',
    severity: 'minor', type: 'style', meaning_impact: 'none', meaning_effect: '', rationale: 'Meaning is unchanged.' }];
  const result = applyScoringPolicy(materialiseEvidence(format.response(envelope(input)), fixture.summary), fixture.summary);
  assert.equal(result.needs_semantic_review, false);
  assert.equal(result.content_score, 4);
  assert.equal(result.grammar_score, 2);
  assert.equal(result.grammar_annotations.length, 1);
  assert(fixture.summary.includes(result.grammar_annotations[0].phrase));
  assert.equal(result.grammar_annotations[0].affects_score, false);
});

test('Response formatting does not waive evidence checks or legitimate language deductions', () => {
  const input = complete();
  input.vocabulary_score = 1;
  input.vocabulary_annotations = [{ phrase_span: [1, 3], fix: 'Corrected source meaning',
    severity: 'major', type: 'word_choice', meaning_impact: 'changed', meaning_effect: 'The quoted wording changes the described mechanism.', rationale: 'A genuine meaning correction.' }];
  const valid = applyScoringPolicy(materialiseEvidence(format.response(envelope(input)), fixture.summary), fixture.summary);
  assert.equal(valid.needs_semantic_review, false);
  assert.equal(valid.vocabulary_score, 1);
  assert.equal(valid.vocabulary_annotations[0].affects_score, true);
  for (const phrase_span of [[0, 3], [3, 1], [1, 999], ['1', 3], [1]]) {
    input.vocabulary_annotations[0].phrase_span = phrase_span;
    const invalid = applyScoringPolicy(materialiseEvidence(format.response(envelope(input)), fixture.summary), fixture.summary);
    assert.equal(invalid.needs_semantic_review, true);
    assert(invalid.assessment_issues.includes('vocabulary_annotations'));
  }
});

function embedded(fields, depth = 1) {
  const input = complete();
  delete input.grammar_annotations; delete input.vocabulary_annotations;
  let note = input.feedback_note + '\",\n' + JSON.stringify(fields).slice(1, -1);
  for (let i = 0; i < depth; i++) note = JSON.stringify(note).slice(1, -1);
  input.feedback_note = note;
  return input;
}

test('Recovery preserves annotation corrections, citations and meaning deductions at every supported escape depth', () => {
  const fields = { grammar_annotations: [{ phrase_span: [1, 3], fix: 'Use "the correct mechanism"', severity: 'major',
    type: 'grammar', meaning_impact: 'changed', meaning_effect: 'The wording changes the mechanism.', rationale: 'Correct the mechanism.' }],
    vocabulary_annotations: [], recommended_swaps: [] };
  for (const depth of [0, 1, 2]) {
    const input = embedded(fields, depth); input.grammar_score = 1;
    const recovered = format.response(envelope(input));
    assert.deepEqual(recovered.grammar_annotations, fields.grammar_annotations);
    assert.equal(recovered.grammar_score, 1);
    const result = applyScoringPolicy(materialiseEvidence(recovered, fixture.summary), fixture.summary);
    assert.equal(result.needs_semantic_review, false);
    assert.equal(result.grammar_score, 1);
    assert.equal(result.grammar_annotations[0].affects_score, true);
  }
});

test('Recovery never fabricates arrays, overrides conflicting fields or accepts unrelated JSON', () => {
  const fields = { grammar_annotations: [], vocabulary_annotations: [] };
  const missing = complete(); delete missing.grammar_annotations;
  missing.feedback_note = 'Please add "grammar_annotations": [] to the response.';
  const conflicting = embedded(fields); conflicting.grammar_annotations = [{ phrase: 'A conflicting error' }];
  const truncated = embedded(fields); truncated.feedback_note = truncated.feedback_note.slice(0, -1);
  const candidates = [missing, conflicting, truncated,
    embedded({ grammar_annotations: [] }),
    embedded({ grammar_annotations: '[]', vocabulary_annotations: [] }),
    embedded({ ...fields, content_score: 4 }),
    embedded({ ...fields, summary_assessment: complete().summary_assessment })];
  for (const input of candidates) {
    const result = format.response(envelope(input));
    assert.equal(result.annotation_format_recovered, undefined);
    assert.deepEqual(result.grammar_annotations, input.grammar_annotations);
    assert.equal(applyScoringPolicy(result, fixture.summary).needs_semantic_review, true);
  }
});

test('A recovered complete model assessment needs no second call and can be cached normally', async () => {
  let calls = 0;
  const service = createJudgmentService({ policyVersion: 'format-regression', buildPrompt: () => 'Assess the fixture.',
    call: async () => { calls++; return format.response(envelope(embedded({ grammar_annotations: [], vocabulary_annotations: [] }))); },
    isComplete: (result, summary) => !applyScoringPolicy(result, summary).needs_semantic_review });
  for (let i = 0; i < 2; i++) {
    const result = await service.judge(fixture.summary, fixture.passage, 'Fixture ideas');
    assert.equal(applyScoringPolicy(result, fixture.summary).needs_semantic_review, false);
  }
  assert.equal(calls, 1);
});

test('Truncated and missing provider responses never become confirmed scores', () => {
  assert.throws(() => format.response({ ...envelope(complete()), stop_reason: 'max_tokens' }), { code: 'SWT_TRUNCATED' });
  assert.equal(format.response({ stop_reason: 'refusal', content: [] }), null);
  assert.equal(format.response(envelope(null)), null);
  assert.equal(format.response(envelope('not an assessment')), null);
});
