'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const client = fs.readFileSync(path.join(__dirname, '../public/index.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
function fn(source, name) {
  let start = source.indexOf('async function ' + name + '(');
  if (start < 0) start = source.indexOf('function ' + name + '(');
  assert(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function harness() {
  const essay = { id: 'draft', title: 'Public transport', question: 'What are the advantages and disadvantages of public transport?',
    questionType: 'advantages_disadvantages', seedIdeas: '', intro: '', selectedReasonIds: [], selectedExampleIds: [] };
  const nodes = new Map(), notices = [], calls = { setup: 0, review: 0, generation: 0 };
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', classList: { add() {}, remove() {} }, style: {} });
    return nodes.get(id);
  };
  const ctx = { ESSAY_GENERATION_PREFERENCES_VERSION: 1, essayGenerationSetupId: essay.id,
    essayGenerationSetupStance: '', essays: [essay], getCurrent: () => essay,
    QUESTION_TYPES: { advantages_disadvantages: { stanceRequired: false } },
    getActiveQuestionType: e => e.questionType, getTemplateKeyForEssay: () => 'band9', getTemplatesBag: () => ({}),
    FIELDS: ['title', 'question', 'intro'], libraryRenderedId: essay.id,
    libraryRenderedValues: { title: essay.title, question: essay.question, intro: '', seedIdeas: '' },
    document: { getElementById: node, querySelector: () => ({ value: ctx.source }), activeElement: null },
    source: 'manual', saveAll() {}, closeEssayGenerationSetup() {}, updateEssayTplPills() {}, setVocab() {},
    updateGenerationModeUI() {}, renderIdeasPicker() {}, renderList() {}, updateTopicBanner() {},
    essayStatus: () => 'empty', staticClassifyQuestion: () => 'advantages_disadvantages',
    toast: message => notices.push(message), aiSuggestIdeas: async () => false,
    openEssayGenerationSetup: () => calls.setup++, openEssayPlanReview: () => calls.review++,
    generateEssayFromApprovedPlan: async () => { calls.generation++; return true; } };
  for (const field of [...ctx.FIELDS, 'seedIdeas']) node('f_' + field).value = essay[field];
  node('genSetupBand').value = 'band9'; node('genSetupVocab').value = '3';
  node('genSetupExam').value = 'pte'; node('genSetupStyle').value = 'natural';
  node('genSetupExamplePreference').value = 'topic_everyday';
  vm.createContext(ctx);
  vm.runInContext(['parseManualIdeas', 'normalizeGenerationIdeaSource', 'getStudentManualIdeas',
    'getEssayGenerationPreferences', 'generatePreviewSignature', 'hasApprovedEssayPlan', 'aiWriteFullEssay',
    'continueEssayGenerationSetup', 'confirmEssayPlanAndGenerate', 'validateEssayStateBeforeGeneration',
    'setGenerationSeedIdeas', 'syncSelectedIdeasToSeed', 'saveCurrent'].map(name => fn(client, name)).join('\n'), ctx);
  return { ctx, essay, node, calls, notices };
}

test('Writing opens preferences and neither confirmed nor bulk calls can bypass an unapproved plan', async () => {
  const { ctx, calls } = harness();
  assert.equal(await ctx.aiWriteFullEssay(), false);
  assert.equal(calls.setup, 1);
  assert.equal(await ctx.aiWriteFullEssay({ confirmedSetup: true }), false);
  assert.equal(await ctx.aiWriteFullEssay({ silent: true }), false);
  assert.equal(calls.generation, 0);
});

test('Manual setup reaches review without generating; explicit approval starts writing', async () => {
  const { ctx, essay, node, calls } = harness();
  node('genSetupManualIdeas').value = 'Buses lower commuting costs\nCrowded trains can delay journeys';
  await ctx.continueEssayGenerationSetup();
  assert.equal(calls.review, 1); assert.equal(calls.generation, 0);
  assert.equal(essay.generationPreferences.ideaSource, 'manual');
  assert.equal(essay.generationMode, 'natural');
  assert.equal(node('f_seedIdeas').value, essay.seedIdeas);
  ctx.confirmEssayPlanAndGenerate();
  assert.equal(calls.generation, 1);
  assert.equal(ctx.hasApprovedEssayPlan(essay), true);
  essay.vocab = 5;
  assert.equal(await ctx.aiWriteFullEssay({ silent: true }), false);
  assert.equal(calls.generation, 1);
});

test('AI selection and later saves preserve manual ideas in mixed mode', async () => {
  const { ctx, essay, node, notices } = harness();
  ctx.source = 'mixed';
  const manual = 'Late buses make workers miss their shifts';
  node('genSetupManualIdeas').value = manual;
  await ctx.continueEssayGenerationSetup();
  assert(!notices.some(message => message.startsWith('Ideas are ready')), 'Failed suggestions must not report success');
  essay.selectedReasonIds = ['Cheaper fares', 'Less traffic'];
  essay.selectedExampleIds = ['Rush hour delays', 'Overcrowded trains'];
  ctx.syncSelectedIdeasToSeed(essay);
  node('f_intro').value = 'A saved introduction';
  ctx.saveCurrent();
  assert.equal(essay.seedIdeas, manual);
  assert.deepEqual(Array.from(essay.generationPreferences.manualIdeas), [manual]);
  node('f_seedIdeas').value = 'Frequent buses help shift workers arrive on time';
  ctx.saveCurrent();
  assert.deepEqual(Array.from(essay.generationPreferences.manualIdeas), [node('f_seedIdeas').value]);
  assert.equal(essay.generationPreferences.planApproved, false);
});

test('Changing the question clears stale suggestions while an unchanged editor preserves newer saved content', async () => {
  const { ctx, essay, node } = harness();
  essay.intro = 'A newer cloud-saved introduction';
  ctx.saveCurrent();
  assert.equal(essay.intro, 'A newer cloud-saved introduction');
  essay.suggestedIdeas = [{ text: 'Cheaper fares' }]; essay.selectedReasonIds = ['Cheaper fares'];
  essay.generationPreferences = { setupComplete: true, planApproved: true };
  node('f_question').value = 'What are the advantages and disadvantages of working from home?';
  ctx.saveCurrent();
  assert.equal(essay.suggestedIdeas.length, 0); assert.equal(essay.selectedReasonIds.length, 0);
  assert.equal(essay.generationPreferences.planApproved, false);
});

test('The server prompt carries the exact topic, learner examples, exam length, mixed ideas and chosen stance', () => {
  const ctx = { VOCAB_LEVELS: Array.from({ length: 5 }, () => ({ label: 'Clear English', desc: 'Simple, direct language' })) };
  vm.createContext(ctx);
  vm.runInContext(['getEffectiveTemplate', 'generateEssayPrompt'].map(name => fn(server, name)).join('\n'), ctx);
  const plan = { topic: 'Public transport', question: 'Should cities subsidise public transport?',
    question_type: 'opinion', stance: 'strongly agree', target_band_level: 'band9', generation_mode: 'natural',
    idea_source: 'mixed', student_ideas: ['Late buses make workers miss their shifts'],
    selected_ideas: { reasons: ['Affordable commutes', 'Fewer private cars'] },
    topic_keywords: ['public transport', 'subsidies'], paragraph_roles: { bp1: 'Support', bp2: 'Support' },
    user_preferences: { target_exam: 'ielts', idea_source: 'mixed', writing_style: 'natural', example_preference: 'student_experience' } };
  const prompt = ctx.generateEssayPrompt(plan, {});
  for (const expected of [plan.question, plan.student_ideas[0], 'Affordable commutes', 'Fewer private cars',
    'IELTS Writing Task 2', '250-330', 'Do not invent personal history', 'public transport, subsidies', 'strongly agree']) {
    assert(prompt.includes(expected), expected);
  }
  assert(!prompt.includes('automatically generate ONE simple, common negative aspect'));
  const manualPrompt = ctx.generateEssayPrompt({ ...plan, idea_source: 'manual',
    manual_ideas: ['Accessible buses help wheelchair users'], student_ideas: [] }, {});
  assert(manualPrompt.includes('Accessible buses help wheelchair users'));
  assert(!manualPrompt.includes('Affordable commutes'));
});
