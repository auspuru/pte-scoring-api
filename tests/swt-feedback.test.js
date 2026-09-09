'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { build } = require('../public/swt-feedback');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/index.js'), 'utf8');
const full = () => ({
  trait_scores: { content: 4, content_max: 4, form: 1, grammar: 2, vocabulary: 2 },
  content_details: { full_content_eligible: true, key_ideas_missing: ['why'], summary_assessment: { relationships_clear: true, missing_dependencies: [], conclusion_status: 'captured' } },
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
  const display = require('../public/swt-feedback').presentation(data);
  assert.equal(display.label, 'PTE estimate');
  assert.equal(display.max, 90);
  assert.equal(display.score, null);
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


test('Saved one-line answer cannot display its stale high band or inflated total as the headline', () => {
  const data = full();
  data.trait_scores.content = 1;
  Object.assign(data, { raw_score: 6, overall_score: 90, band: 'Band 9' });
  const result = require('../public/swt-feedback').presentation(data);
  assert.equal(result.headline, 'Incomplete summary — limited content');
  assert.equal(result.score, 38);
  assert.equal(result.max, 90);
  assert.equal(result.label, 'PTE estimate');
  assert.equal(result.estimate, 38);
  assert(!result.secondary.includes('Trait total'));
  assert.match(result.secondary, /not an official PTE score/);
  assert(!result.headline.includes('Band'));
});
test('All incomplete content levels remain distinct from complete summaries despite perfect language', () => {
  for (let content = 0; content <= 4; content++) {
    const data = full(); data.trait_scores.content = content;
    Object.assign(data, { raw_score: 9, overall_score: 90, band: 'Band 9' });
    const result = require('../public/swt-feedback').presentation(data);
    assert.equal(result.raw, content + 5);
    assert.equal(result.max, 90);
    assert.equal(result.estimate, [15, 38, 65, 79, 90][content]);
    assert.equal(result.headline === 'Complete, well-connected summary', content === 4);
  }
});
test('Provisional and invalid results never promise a complete summary', () => {
  for (const extra of [{ score_provisional: true }, { ai_feedback_degraded: true }, { trait_scores: { content: 4, form: 0, grammar: 2, vocabulary: 2 } }]) {
    const result = require('../public/swt-feedback').presentation({ ...full(), ...extra });
    assert(!result.headline.includes('Complete, well-connected'));
    assert(!result.headline.includes('Band'));
  }
});

test('A saved Content 4 without semantic eligibility is reviewed instead of labelled complete', () => {
  const data = full();
  delete data.content_details.full_content_eligible;
  delete data.content_details.summary_assessment.conclusion_status;
  const result = require('../public/swt-feedback').presentation(data);
  assert.equal(result.headline, 'Review the missing content or connection');
  assert.equal(result.label, 'PTE estimate');
  assert.equal(result.max, 90);
});

test('Semantic evidence keeps coverage rows consistent with the written explanation', () => {
  const start = source.indexOf('function renderCoverage(');
  const end = source.indexOf('\n}\n\nfunction renderAboutPassage', start) + 2;
  assert(start >= 0 && end > start);
  const target = { innerHTML: '' };
  const context = {
    document: { getElementById: () => target },
    escapeHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + `\nrenderCoverage({
    content_details: {
      key_ideas_present: [], key_ideas_missing: ['what', 'why', 'how', 'result'],
      summary_assessment: {
        main_idea_accurate: true,
        supporting_evidence: ['the city dominates foreign exchange trading'],
        conclusion_status: 'clearly_implied'
      }
    }
  }, { keyElements: {
    what: 'London became the world money capital',
    why: 'Progress faced historical setbacks',
    how: 'London dominates foreign exchange trading',
    result: 'London remains the place to be for finance'
  }});`, context);
  assert.match(target.innerHTML, /Included/g);
  assert(!/^.*Not selected.*Not selected.*Not selected.*Not selected/s.test(target.innerHTML));
});

test('Long model explanations are compacted in the student priority card', () => {
  const data = full();
  data.trait_scores.content = 2;
  data.content_details.notes = Array(80).fill('The summary omits an optional named example.').join(' ');
  const result = build(data);
  assert(result.priorities[0].detail.length <= 421);
  assert(result.priorities[0].detail.endsWith('…'));
});
