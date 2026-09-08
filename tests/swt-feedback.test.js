'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { build } = require('../public/swt-feedback');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/index.js'), 'utf8');
const full = () => ({
  trait_scores: { content: 4, content_max: 4, form: 1, grammar: 2, vocabulary: 2 },
  content_details: { key_ideas_missing: ['why'], summary_assessment: { relationships_clear: true, missing_dependencies: [] } },
  grammar_details: { grammar_annotations: [] }, vocabulary_details: { vocabulary_annotations: [] }
});
test('Full scores keep harmless corrections optional despite omitted diagnostic ideas', () => {
  const data = full();
  data.grammar_details.grammar_annotations = [{ phrase: 'music have', fix: 'music has',
    affects_score: false, rationale: 'Optional refinement — no score deduction. Use has with music.' }];
  const result = build(data);
  assert.equal(result.full, true);
  assert.equal(result.priorities.length, 1);
  assert.equal(result.priorities[0].title, 'Keep this approach');
  assert.equal(result.optional[0].reason, 'Use has with music.');
  assert(!result.summary.includes('missing'));
});
test('A missing cause is the first actionable priority without an invented grammar deduction', () => {
  const data = full();
  data.trait_scores.content = 3;
  data.content_details.summary_assessment.missing_dependencies = [{
    effect: 'this improves pollination', missing_context: 'Caffeine improves bees’ memory of flower scents.',
    explanation: 'Explain what helps bees return to the flowers.'
  }];
  const result = build(data);
  assert.equal(result.priorities.length, 1);
  assert.match(result.priorities[0].detail, /Caffeine improves/);
  assert.match(result.priorities[0].detail, /this improves pollination/);
  assert.equal(result.full, false);
});
test('Grammar affecting meaning includes the exact correction and its effect', () => {
  const data = full();
  data.trait_scores.grammar = 1;
  data.grammar_details.grammar_annotations = [{
    phrase: 'plants remember bees', fix: 'bees remember flowers', affects_score: true,
    meaning_effect: 'This assigns memory to plants instead of bees.'
  }];
  const result = build(data);
  assert.match(result.priorities[0].detail, /assigns memory to plants/);
  assert.match(result.priorities[0].detail, /plants remember bees/);
  assert.equal(result.optional.length, 0);
});
test('Provisional assessments do not present full marks or language corrections as confirmed', () => {
  const data = full();
  data.score_provisional = true;
  data.grammar_details.grammar_annotations = [{ phrase: 'a', fix: 'the', affects_score: false }];
  const result = build(data);
  assert.equal(result.full, false);
  assert.match(result.summary, /provisional/);
  assert.equal(result.priorities[0].title, 'Request a complete assessment');
  assert.equal(result.optional.length, 0);
});
test('Invalid form does not produce spurious grammar and vocabulary revision priorities', () => {
  const data = full();
  data.trait_scores = { content: 0, form: 0, grammar: 0, vocabulary: 0 };
  const result = build(data);
  assert.equal(result.priorities.length, 1);
  assert.match(result.priorities[0].title, /one sentence/);
});
test('User/model text is escaped at the guidance rendering boundary', () => {
  const start = source.indexOf('function renderSwtGuidance(');
  const end = source.indexOf('\n}', start) + 2;
  const target = { innerHTML: '' };
  const context = {
    document: { getElementById: () => target },
    escapeHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    SwtStudentFeedback: { build: () => ({
      priorities: [{ title: '<img src=x onerror=alert(1)>', detail: '<script>bad()</script>' }],
      optional: [{ phrase: '<svg onload=bad()>', fix: '<b>', reason: '<iframe>' }]
    }) }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + '\nrenderSwtGuidance({});', context);
  assert(!target.innerHTML.includes('<img'));
  assert(!target.innerHTML.includes('<script'));
  assert(!target.innerHTML.includes('<svg'));
  assert(target.innerHTML.includes('&lt;script&gt;'));
});

