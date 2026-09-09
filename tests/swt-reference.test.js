'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const seeds = require('../passages.json');
const { studentPassage, buildStudyGuide, phraseFromIdea } = require('../swt-reference');
const { POLICY_VERSION, applyScoringPolicy } = require('../swt-scoring-policy');
const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const functionSource = name => {
  const start = server.indexOf('function ' + name + '(');
  return server.slice(start, server.indexOf('\n}', start) + 2);
};
const validateForm = vm.runInNewContext(functionSource('validateForm') + '\nvalidateForm;');

test('Reported references are revised without mutating the stored passage or bypassing scoring', () => {
  for (const id of [8, 9]) {
    const stored = structuredClone(seeds.find(p => p.id === id));
    const original = structuredClone(stored);
    const result = studentPassage(stored);
    assert.notEqual(result.sampleResponse, original.sampleResponse);
    assert.equal(result.sampleRevision, POLICY_VERSION);
    assert.equal(validateForm(result.sampleResponse).valid, true);
    assert.deepEqual(stored, original);
    assert.equal(result.sampleVerified, undefined, 'Authored reference is not automatically verified');
  }
});

test('Admin changes to either the source or the sample are preserved', () => {
  const p = structuredClone(seeds.find(p => p.id === 8));
  const edited = { ...p, sampleResponse: 'An independently edited reference answer belongs to the teacher.' };
  assert.equal(studentPassage(edited).sampleResponse, edited.sampleResponse);
  const newSource = { ...p, text: 'A revised source passage that no longer matches the original.' };
  assert.equal(studentPassage(newSource).sampleResponse, p.sampleResponse);
  assert.equal(studentPassage(newSource).sampleRevision, undefined);
});

test('Key phrases are short exact source excerpts, not highlighted sentences or completeness checklists', () => {
  for (const p of seeds) {
    const guide = buildStudyGuide(p);
    const source = p.text.replace(/\s+/g, ' ').trim();
    for (const item of guide.items) {
      assert(item.idea.trim());
      for (const phrase of item.phrases) {
        assert(source.includes(phrase), p.title + ': ' + phrase);
        assert(phrase.split(/\s+/).length <= 12);
      }
    }
    assert(guide.connection);
  }
  assert.match(buildStudyGuide(seeds.find(p => p.id === 8)).connection, /related benefits/);
  assert.match(buildStudyGuide(seeds.find(p => p.id === 9)).connection, /motivated the invention/);
});

test('Generic guide labels do not depend on database object key order', () => {
  const p = { id: 500, text: 'An industry offers useful jobs while supporting cultural preservation.',
    keyElements: { how: 'supporting cultural preservation', what: 'An industry offers useful jobs', result: 'Extra related benefits' } };
  const guide = buildStudyGuide(p);
  assert.equal(guide.items[0].label, 'Central idea');
  assert.equal(guide.items[1].label, 'Supporting idea');
  assert.equal(phraseFromIdea('supporting cultural preservation', p.text), 'supporting cultural preservation');
});

async function checkReference(stored, judge) {
  let route, result, status = 200;
  const ctx = { studentPassage, POLICY_VERSION, applyScoringPolicy, validateForm,
    PassageAPI: { getById: async () => stored }, judgeContentWithClaude: judge,
    app: { post: (name, handler) => { route = handler; } } };
  vm.createContext(ctx);
  const start = server.indexOf("app.post('/api/swt/sample/:id'");
  assert(start >= 0);
  vm.runInContext(server.slice(start, server.indexOf('\n});', start) + 4), ctx);
  await route({ params: { id: '8' } }, {
    status(value) { status = value; return this; }, json(value) { result = value; return this; }
  });
  return { status, result };
}
function semantic(text) {
  return { content_score: 4, grammar_score: 2, vocabulary_score: 2, cohesion: 'strong',
    grammar_annotations: [], vocabulary_annotations: [], summary_assessment: {
      main_idea_accurate: true, main_idea_evidence: text.slice(0, 45), supporting_evidence: [text.slice(50, 110)],
      relationships_clear: true, material_meaning_change: false, conclusion_status: 'captured',
      missing_dependencies: [], relationship_explanation: 'The selected ideas are connected.'
    } };
}

test('Reference label is earned by the same form gate and semantic policy', async () => {
  const p = seeds.find(p => p.id === 8);
  let input;
  const response = await checkReference(p, async (text, source, ideas) => {
    input = { text, source, ideas }; return semantic(text);
  });
  assert.equal(response.result.status, 'verified');
  assert.equal(input.text, studentPassage(p).sampleResponse);
  assert.equal(input.source, p.text);
  assert.deepEqual(input.ideas, p.keyElements);
  for (const mode of ['false meaning', 'unavailable']) {
    const check = await checkReference(p, async text => {
      if (mode === 'unavailable') return null;
      const j = semantic(text); j.summary_assessment.material_meaning_change = true; return j;
    });
    assert.notEqual(check.result.status, 'verified');
  }
  const invalid = await checkReference({ ...p, sampleResponse: 'Too short.' }, () => { throw new Error('Should not judge invalid form'); });
  assert.equal(invalid.result.status, 'needs_revision');
});
