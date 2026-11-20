'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const seeds = require('../passages.json');
const legacy = require('../content/swt-legacy.json');
const predictions = require('../content/user-swt-predictions').passages;
const publicationReferences = require('../content/swt-publication-references.json');
const { hash } = require('../scoring-jobs');
const { studentPassage, buildStudyGuide, phraseFromIdea, fallbackSample } = require('../swt-reference');
const { POLICY_VERSION, applyScoringPolicy } = require('../swt-scoring-policy');
const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const functionSource = name => {
  const start = server.indexOf('function ' + name + '(');
  return server.slice(start, server.indexOf('\n}', start) + 2);
};
const validateForm = vm.runInNewContext(functionSource('validateForm') + '\nvalidateForm;', { SwtForm: require('../swt-form-policy') });

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

test('Publication revisions match audited sources and old references in the bundled standalone banks', () => {
  const bank = [...seeds, ...legacy, ...predictions];
  for (const [sourceHash, revision] of Object.entries(publicationReferences)) {
    const sources = bank.filter(p => Number(p.id) === revision.id
      && p.title === revision.title && hash(p.text) === sourceHash);
    assert(sources.length, revision.title);
    let matched = false;
    for (const source of sources) {
      const projected = studentPassage(source);
      for (const [field, { before, after }] of Object.entries(revision.fields)) {
        if (field === 'sampleNotes' || source[field] === undefined || !before.includes(hash(source[field]))) continue;
        assert.deepEqual(projected[field], after, revision.title + ' ' + field);
        matched = true;
      }
      if (projected.sampleResponse !== source.sampleResponse) {
        assert(validateForm(projected.sampleResponse).valid, revision.title);
      }
    }
    assert(matched, revision.title);
  }
});

test('Standalone coaching uses the correct version of Tourism, Forecasting, and the Web', () => {
  const result = (bank, id) => studentPassage(bank.find(p => p.id === id));
  assert.doesNotMatch(result(legacy, 8).sampleResponse, /depend on communities|therefore/);
  assert.match(result(legacy, 8).sampleResponse, /potentially low.*additional advantage/);
  assert.match(result(seeds, 8).sampleResponse, /lasting benefits depend on communities/);
  assert.match(result(legacy, 10).sampleResponse, /assumptions.*limit forecasting precision.*although.*government spending/);
  assert.doesNotMatch(result(legacy, 10).sampleResponse, /scenarios|range|GNP/);
  assert.match(result(seeds, 10).sampleResponse, /unexpected events.*ranges.*decisions/);
  assert.doesNotMatch(result(legacy, 9).sampleResponse, /open standards|central publisher/);
  assert.match(result(seeds, 9).sampleResponse, /open standards.*central publisher/);
});

test('Publication revisions preserve teacher-authored fields and exact source identity', () => {
  const original = structuredClone(legacy.find(p => p.id === 10));
  const sameFields = { keyElements: original.keyElements, sampleResponse: original.sampleResponse };
  for (const version of [{ id: 666 }, { title: original.title + ' (class version)' }, { text: original.text + '\n' }]) {
    const projected = studentPassage({ ...original, ...version });
    assert.deepEqual(projected.keyElements, sameFields.keyElements);
    assert.equal(projected.sampleResponse, sameFields.sampleResponse);
  }
  const keyElements = { topic: 'Teacher-authored key explanation' };
  const sampleResponse = 'This is the teacher’s own model answer.';
  const sampleNotes = 'This sample shows how the teacher would approach the passage.';
  const customKey = studentPassage({ ...original, keyElements });
  assert.deepEqual(customKey.keyElements, keyElements);
  assert.equal(customKey.studyGuide.items[0].idea, keyElements.topic);
  assert.notEqual(customKey.sampleResponse, original.sampleResponse);
  const customSample = studentPassage({ ...original, sampleResponse, sampleNotes });
  assert.equal(customSample.sampleResponse, sampleResponse);
  assert.equal(customSample.sampleNotes, sampleNotes);
  assert.notDeepEqual(customSample.keyElements, original.keyElements);
});

test('Blank SWT samples are restored from reviewed bundled references', () => {
  const standard = structuredClone(seeds.find(p => p.id === 1));
  standard.sampleResponse = '';
  standard.sampleNotes = '';
  const standardResult = studentPassage(standard);
  assert.equal(standardResult.sampleResponse, seeds.find(p => p.id === 1).sampleResponse);

  const legacy = { id: 22, title: 'Esports', text: 'Legacy production passage text.', keyElements: { what: 'Esports can support student engagement.' }, sampleResponse: '' };
  const legacyResult = studentPassage(legacy);
  assert.match(legacyResult.sampleResponse, /esports programmes/i);
  assert.equal(legacyResult.sampleRevision, POLICY_VERSION);

  const advanced = require('../content/swt-advanced.json')[0];
  const advancedResult = studentPassage({ ...advanced, id: 44, sampleResponse: '' });
  assert.equal(advancedResult.sampleResponse, advanced.sampleResponse);
});

test('Runtime fallback never overwrites authored samples or mismatched passages', () => {
  const authored = { id: 22, title: 'Esports', text: 'Teacher-edited text.', keyElements: {}, sampleResponse: 'Teacher-authored sample answer.' };
  assert.equal(studentPassage(authored).sampleResponse, authored.sampleResponse);
  assert.equal(fallbackSample({ ...authored, sampleResponse: '' , title: 'Different title' }), null);

  const standard = structuredClone(seeds.find(p => p.id === 1));
  standard.sampleResponse = '';
  standard.text += ' Teacher-edited source.';
  assert.equal(fallbackSample(standard), null);
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
      synthesis: { quality: 'effective', evidence: '', explanation: 'The reference combines the essential ideas.' }, main_idea_accurate: true, main_idea_evidence: text.slice(0, 45), supporting_evidence: [text.slice(50, 110)],
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
  assert.deepEqual(input.ideas, studentPassage(p).keyElements);
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

test('The sample assessment uses the corrected IPCC offset and Human Remains policy scope', async () => {
  const cases = [
    [seeds.find(p => p.id === 7), /rising temperatures reduce cold spells.*decrease in cold-related deaths could outweigh the increase in heat-related deaths/],
    [legacy.find(p => p.id === 30), /removing them from curation and preventing further study/]
  ];
  for (const [p, expected] of cases) {
    let input;
    await checkReference(p, async (text, passage, ideas) => {
      input = { text, passage, ideas }; return semantic(text);
    });
    assert.equal(input.passage, p.text);
    assert.match(Object.values(input.ideas).join(' '), expected);
  }
});
