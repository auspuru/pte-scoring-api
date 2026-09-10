'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const policy = require('../swt-scoring-policy');
const fixtures = require('./swt-meaning-fixtures.json');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// These are deterministic policy/integration checks using human-labelled
// semantic assessments. They do not claim to test a live model's judgments.
function judgment(fixture = fixtures[1], changes = {}) {
  return {
    content_score: 4, summary_assessment: structuredClone(fixture.assessment),
    per_idea_scores: { what: 1, why: 1, how: 1, result: 1 },
    grammar_score: 2, vocabulary_score: 2, grammar_annotations: [],
    vocabulary_annotations: [], cohesion: 'strong', source: 'claude', ...changes
  };
}

function annotation(phrase, fix, impact = 'none', effect = '') {
  return { phrase, fix, meaning_impact: impact, meaning_effect: effect,
    severity: 'major', type: 'grammar', rationale: 'Suggested light correction.' };
}

test('Smart quotes and pasted whitespace preserve the score and retain exact original citations', () => {
  const normal = "Caffeine improves bees' memory of flower scents, supporting pollination and plant survival.";
  const original = normal.replace(/ /g, '\u00a0 ').replace("bees'", 'bees’');
  const raw = judgment();
  Object.assign(raw.summary_assessment, { main_idea_evidence: "Caffeine improves bees' memory of flower scents",
    supporting_evidence: ['supporting pollination and plant survival'] });
  raw.grammar_annotations = [annotation("bees' memory", 'the memory of bees')];
  const result = policy.applyScoringPolicy(raw, original);
  assert.equal(result.needs_semantic_review, false);
  assert.equal(result.content_score, 4);
  assert.equal(result.grammar_score, 2);
  assert(original.includes(result.grammar_annotations[0].phrase));
  assert(original.includes(result.summary_assessment.main_idea_evidence));
  raw.summary_assessment.main_idea_evidence = 'Caffeine damages memory and prevents pollination';
  const fabricated = policy.applyScoringPolicy(raw, original);
  assert.equal(fabricated.needs_semantic_review, true);
  assert(fabricated.assessment_issues.includes('main_idea_evidence'));
});

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\n}', start) + 2;
  assert(start >= 0 && end > start, `Missing server function ${name}`);
  return source.slice(start, end);
}

async function grade(fixture, semanticJudgment) {
  let route;
  const context = {
    ...policy, SWT_SCORING_CRITERIA: policy.SCORING_CRITERIA,
    SWT_CONTENT_MAX: 4, SWT_MAX_RAW: 9, DEBUG: false,
    EXTERNAL_SPELLCHECK_ENABLED: false,
    console, setTimeout, clearTimeout,
    app: { post: (_, handler) => { route = handler; } },
    detectVerbatim: () => ({ verbatimRate: 0, isVerbatim: false, longestRun: 0 }),
    analyzeSwaps: () => ({ safeSwaps: [], structuralChanges: [], dangerousSwaps: [],
      safeSwapCount: 0, structuralCount: 0, dangerousSwapCount: 0,
      totalParaphraseCredit: 0, academicWordsUsed: [], novelWords: [], novelWordRate: 0 }),
    detectFirstPerson: () => ({ detected: false, isProblematic: false, hasPerspectiveShift: false, issues: [] }),
    checkSpelling: () => ({ count: 1, errors: ['recieved'],
      suggestions: [{ misspelled: 'recieved', suggestion: 'received' }] }),
    judgeContentWithClaude: async () => semanticJudgment && structuredClone(semanticJudgment),
    stripHtml: text => text,
    checkKeyPoint: () => ({ present: true }),
    estimateSkillContributions: () => ({}),
    buildFeedbackCard: () => ({ summary_line: '', improvements: [] }),
    generateVocabSuggestions: () => []
  };
  vm.createContext(context);
  const functions = ['clampNumber', 'roundToTenth', 'countKeyElements', 'coverageToContentScore',
    'validateForm', 'checkGrammar', 'grammarScoreFromJudgment', 'scoreVocabulary',
    'rawToPTEDynamic', 'rawToBandDynamic', 'pteToRaw', 'buildPenaltiesList',
    'detectStrongLocalContradiction', 'judgeContentLocal'];
  vm.runInContext(functions.map(functionSource).join('\n'), context);
  const start = source.indexOf("app.post('/api/grade',");
  const end = source.indexOf('\n});', start) + 4;
  vm.runInContext(source.slice(start, end), context);
  let response;
  let status = 200;
  await route({ body: { text: fixture.summary, type: 'swt', prompt: fixture.passage,
    keyPoints: { what: 'Main message', why: 'Reason', how: 'Mechanism', result: 'Conclusion' } } },
  { status(code) { status = code; return this; }, json(body) { response = body; return this; } });
  assert.equal(status, 200, JSON.stringify(response));
  return response;
}

for (const fixture of fixtures) {
  test(`${fixture.topic}: supplied full-score assessment reaches 9/9 through the grading route`, async () => {
    const result = await grade(fixture, judgment(fixture));
    assert.equal(result.trait_scores.content, 4);
    assert.equal(result.trait_scores.grammar, 2);
    assert.equal(result.trait_scores.vocabulary, 2);
    assert.equal(result.raw_score, 9);
    assert.equal(result.band, 'Band 9');
    assert.equal(result.score_provisional, false);
  });
}

test('Article, agreement and spelling feedback never deduct marks without meaning impact', async () => {
  const fixture = fixtures[3];
  const result = await grade(fixture, judgment(fixture, {
    grammar_score: 1,
    grammar_annotations: [annotation('Brain clears', 'The brain clears'),
      annotation('an significant aspect', 'a significant aspect')]
  }));
  assert.equal(result.trait_scores.grammar, 2);
  assert.equal(result.raw_score, 9);
  assert(result.grammar_details.grammar_annotations.every(a => a.affects_score === false));
  assert(result.grammar_details.grammar_annotations.every(a => /no score deduction/.test(a.rationale)));
});

test('Caffeine wording is optional feedback when the causal message remains intact', async () => {
  const fixture = fixtures[1];
  const result = await grade(fixture, judgment(fixture, {
    vocabulary_score: 1.5, synonym_appropriateness: 'some_inappropriate',
    vocabulary_annotations: [annotation('the smell of caffeine', 'caffeine in nectar')]
  }));
  assert.equal(result.trait_scores.vocabulary, 2);
  assert.equal(result.raw_score, 9);
});

test('One relevant support is sufficient; checklist counts cannot block a connected summary', async () => {
  const fixture = fixtures[1];
  const j = judgment(fixture, { content_score: 3, per_idea_scores: { what: 1, why: 0, how: 0, result: 0 } });
  j.summary_assessment.supporting_evidence = [fixture.assessment.supporting_evidence[0]];
  const result = await grade(fixture, j);
  assert.equal(result.trait_scores.content, 4);
  assert.equal(result.raw_score, 9);
});

test('Missing cause lowers content even when every diagnostic idea is marked present', async () => {
  const fixture = { ...fixtures[1], summary: 'Caffeine is useful for bees and certain plants, and researchers are excited; therefore, this improves pollination and plant survival.' };
  const j = judgment(fixture);
  j.summary_assessment.main_idea_evidence = 'Caffeine is useful for bees and certain plants';
  j.summary_assessment.supporting_evidence = ['this improves pollination and plant survival'];
  j.summary_assessment.missing_dependencies = [{ effect: 'this improves pollination',
    missing_context: 'Caffeine improves flower-scent memory and subsequent flower visits.',
    explanation: 'The summary does not explain what changes in bees or how pollination follows.' }];
  j.summary_assessment.relationships_clear = false;
  j.summary_assessment.relationship_explanation = j.summary_assessment.missing_dependencies[0].explanation;
  const result = await grade(fixture, j);
  assert(result.trait_scores.content < 4);
  assert.equal(result.trait_scores.grammar, 2);
  assert.equal(result.raw_score, Object.values({ content: result.trait_scores.content,
    form: result.trait_scores.form, grammar: result.trait_scores.grammar,
    vocabulary: result.trait_scores.vocabulary }).reduce((a, b) => a + b, 0));
  assert.notEqual(result.band, 'Band 9');
});

test('Contradiction and missing conclusion cannot be rescued by idea counts', () => {
  for (const change of [{ material_meaning_change: true }, { main_idea_accurate: false },
    { conclusion_status: 'missing' }, { conclusion_status: 'incorrect' }]) {
    const j = judgment();
    Object.assign(j.summary_assessment, change);
    assert(policy.applyScoringPolicy(j, fixtures[1].summary).content_score < 4);
  }
});

test('An opening-only response stays at most Content 1 even with an optimistic proposed score', () => {
  for (const mainAccurate of [true, false]) {
    const j = judgment();
    j.summary_assessment.main_idea_accurate = mainAccurate;
    j.summary_assessment.supporting_evidence = [];
    const result = policy.applyScoringPolicy(j, fixtures[1].summary);
    assert(result.content_score <= 1);
    assert.equal(result.grammar_score, 2);
    assert.equal(result.full_content_eligible, false);
  }
});

test('A connector-only edit cannot become a duplicate Grammar deduction', () => {
  const j = judgment(fixtures[1], { grammar_score: 1,
    grammar_annotations: [annotation('therefore, it is beneficial', 'additionally, it is beneficial', 'changed',
      'The preliminary judge alleged a causal meaning issue.')] });
  const result = policy.applyScoringPolicy(j, fixtures[1].summary);
  assert.equal(result.grammar_score, 2);
  assert.equal(result.grammar_annotations[0].affects_score, false);
});

test('A miscopied pronoun in a long evidence citation cannot lower an otherwise accurate London summary', () => {
  const summary = 'Although London faced historical setbacks and continues to struggle with high living costs and overloaded infrastructure, deregulation and regulatory advantages have allowed its financial center to surpass global rivals in fund management, foreign exchange trading, and secondary bonds.';
  const j = judgment();
  Object.assign(j.summary_assessment, {
    main_idea_evidence: "London's financial center to surpass global rivals in fund management, foreign exchange trading, and secondary bonds",
    supporting_evidence: ['deregulation and regulatory advantages have allowed its financial center to surpass global rivals']
  });
  const result = policy.applyScoringPolicy(j, summary);
  assert.equal(result.content_score, 4);
  assert.equal(result.needs_semantic_review, false);
  assert(summary.includes(result.summary_assessment.main_idea_evidence));
  j.summary_assessment.main_idea_evidence = 'Invented evidence that has no faithful equivalent anywhere in this student summary';
  const invented = policy.applyScoringPolicy(j, summary);
  assert.equal(invented.needs_semantic_review, true);
  assert.equal(invented.full_content_eligible, false);
});

test('Grammar meaning changes deduct independently of content omissions', async () => {
  const fixture = { ...fixtures[1], summary: 'Caffeine helps plants remember the bees, which improves pollination and survival.' };
  const j = judgment(fixture, { grammar_score: 1,
    grammar_annotations: [annotation('plants remember the bees', 'bees remember flower scents', 'changed',
      'The construction assigns remembering to plants instead of bees.')] });
  j.summary_assessment.main_idea_accurate = false;
  j.summary_assessment.material_meaning_change = true;
  const result = await grade(fixture, j);
  assert.equal(result.trait_scores.grammar, 1);
  assert(result.trait_scores.content < 4);
  assert.notEqual(result.band, 'Band 9');
});

test('A material word-choice error keeps its graded deduction rather than being forced to zero', async () => {
  const fixture = { ...fixtures[1], summary: fixtures[1].summary.replace('useful', 'harmful') };
  const j = judgment(fixture, { vocabulary_score: 1,
    vocabulary_annotations: [annotation('harmful', 'useful', 'changed', 'Harmful reverses the stated benefit to bees and plants.')] });
  j.summary_assessment.main_idea_accurate = false;
  j.summary_assessment.material_meaning_change = true;
  const result = await grade(fixture, j);
  assert.equal(result.trait_scores.vocabulary, 1);
  assert(result.trait_scores.content < 4);
});

test('Invented error quotations and severity labels cannot deduct grammar', () => {
  const j = judgment(fixtures[1], { grammar_score: 0,
    grammar_annotations: [annotation('words the student never wrote', 'correction', 'changed', 'Claimed meaning change.')] });
  assert.equal(policy.applyScoringPolicy(j, fixtures[1].summary).grammar_score, 2);
});

test('Missing semantic assessment is provisional and cannot earn full content', async () => {
  const j = judgment();
  delete j.summary_assessment;
  const result = await grade(fixtures[1], j);
  assert(result.trait_scores.content < 4);
  assert.equal(result.score_provisional, true);
  assert.notEqual(result.band, 'Band 9');
});

test('Unexplained claims of grammar meaning change require review rather than a certified top score', () => {
  const j = judgment(fixtures[3], { grammar_score: 0,
    grammar_annotations: [annotation('an significant aspect', 'a significant aspect', 'changed')] });
  const result = policy.applyScoringPolicy(j, fixtures[3].summary);
  assert.equal(result.grammar_score, 2);
  assert.equal(result.needs_semantic_review, true);
  assert.equal(result.full_content_eligible, false);
});

test('Offline fallback cannot certify meaning or full content from word overlap', async () => {
  const result = await grade(fixtures[1], null);
  assert.equal(result.score_provisional, true);
  assert.equal(result.trait_scores.grammar, 2);
  assert(result.trait_scores.content < 4);
  assert.notEqual(result.band, 'Band 9');
});

test('Existing one-sentence and word-limit form gates still apply', async () => {
  for (const summary of ['Caffeine helps bees. It improves memory.', 'Caffeine helps bees',
    Array(76).fill('word').join(' ') + '.']) {
    const result = await grade({ ...fixtures[1], summary }, judgment());
    assert.equal(result.form_gate_triggered, true);
    assert.equal(result.raw_score, 0);
  }
});

test('Existing user benchmarks receive full local grammar for meaning-preserving slips', () => {
  const context = { roundToTenth: n => Math.round(n * 10) / 10,
    detectFirstPerson: () => ({}) };
  vm.createContext(context);
  vm.runInContext(functionSource('checkGrammar'), context);
  const existing = require('../passages.json').filter(p => p.officialCalibration);
  for (const passage of existing) {
    assert.equal(context.checkGrammar(passage.officialCalibration.response, passage.text).score, 2, passage.title);
  }
});

test('Content caps apply equally to PTE estimates and bands while raw totals stay honest', async () => {
  for (let content = 0; content <= 3; content++) {
    const j = judgment();
    j.content_score = content;
    j.summary_assessment.conclusion_status = 'missing';
    j.summary_assessment.relationships_clear = false;
    j.summary_assessment.missing_dependencies = [{ effect: 'the effect', missing_context: 'the necessary cause', explanation: 'The selected effect is disconnected.' }];
    const result = await grade(fixtures[1], j);
    assert.equal(result.trait_scores.content, content);
    assert.equal(result.raw_score, content + 5);
    assert.equal(result.overall_score, [15, 38, 65, 79][content]);
    assert.equal(result.band, ['Band 5', 'Band 6', 'Band 7', 'Band 8'][content]);
  }
});
