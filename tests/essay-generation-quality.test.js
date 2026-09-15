'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const policy = require('../public/essay-generation-policy');
const { createEssayGenerationReviewer, readReview } = require('../essay-generation-review');
const { plan, reported, coherent } = require('./essay-generation-quality-fixtures');
const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '../public/index.js'), 'utf8');
function fn(source, name) {
  let start = source.indexOf('async function ' + name + '(');
  if (start < 0) start = source.indexOf('function ' + name + '(');
  assert(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function api({ drafts = [coherent], planIssues = [], reviews = [{ issues: [] }] } = {}) {
  let handler, writing = 0, checking = 0;
  const requests = [];
  const ctx = { EssayGenerationPolicy: policy, createEssayGenerationReviewer,
    console: { error() {}, warn() {} },
    app: { post: (url, fn) => { handler = fn; } },
    VOCAB_LEVELS: Array.from({ length: 5 }, () => ({ label: 'Clear English', desc: 'Clear and natural' })),
    detectUnsupportedClaims: () => [], splitSentences: text => text.split(/(?<=[.!?])\s+/),
    anthropic: { messages: { create: async options => {
      requests.push(options);
      const prompt = options.messages[0].content;
      let result;
      if (prompt.startsWith('Check whether this approved essay plan')) result = JSON.stringify({ issues: planIssues });
      else if (prompt.startsWith('Review this generated essay')) {
        const review = reviews[Math.min(checking++, reviews.length - 1)];
        result = typeof review === 'string' ? review : JSON.stringify(review);
      } else result = drafts[Math.min(writing++, drafts.length - 1)];
      return { content: [{ text: result }] };
    } } } };
  vm.createContext(ctx);
  vm.runInContext(['getEffectiveTemplate', 'generateEssayPrompt', 'validateGeneratedEssayText'].map(name => fn(server, name)).join('\n'), ctx);
  const start = server.indexOf("app.post('/api/generate-essay',");
  vm.runInContext(server.slice(start, server.indexOf('\n});', start) + 4), ctx);
  return { requests, async run(input = plan) {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ body: { plan: structuredClone(input), template: {} } }, res);
    return { status: res.statusCode, body: res.body, writing, checking };
  } };
}

test('The reported outline is rejected as Band 9 even with a stale or explicitly requested guide mode', () => {
  for (const output_mode of [undefined, 'idea_guide', 'full_essay']) {
    assert.equal(policy.outputMode({ ...plan, output_mode }), 'full_essay');
    const result = policy.validateFormat({ ...plan, output_mode }, reported);
    assert.equal(result.ok, false);
    assert(result.errors.some(error => error.includes('planning notes')));
  }
  assert.equal(policy.validateFormat({ ...plan, target_band_level: 'band6', output_mode: 'idea_guide' }, reported).ok, true);
  assert.equal(policy.validateFormat({ ...plan, target_band_level: 'band6', output_mode: 'full_essay' }, reported).ok, false);
  assert.equal(policy.validateFormat(plan, coherent).ok, true);
});

test('Duplicate, reordered or empty sections cannot pass as a finished essay', () => {
  assert.equal(policy.validateFormat(plan, coherent + '\n===CONCL===\nExtra conclusion').ok, false);
  assert.equal(policy.validateFormat(plan, coherent.replace('===INTRO===', '===BP1===').replace('===BP2===', '===INTRO===')).ok, false);
  assert.equal(policy.validateFormat(plan, coherent.replace(/===BP1===[\s\S]*?===BP2===/, '===BP1===\n\n===BP2===')).ok, false);
});

test('A conflicting approved plan stops before writing and asks the user to review their choices', async () => {
  const result = await api({ planIssues: [{ code: 'plan_stance_conflict',
    reason: 'Your position supports deductions, but your reasons explain why deductions are unfair. Review the position or choose supporting reasons.',
    quotes: ['largely agree', 'hurts students who are already struggling'] }] }).run({ ...plan, stance: 'largely agree' });
  assert.equal(result.status, 422); assert.equal(result.body.code, 'PLAN_STANCE_CONFLICT');
  assert.equal(result.writing, 0); assert.equal(result.body.text, undefined);
});

test('Repeated planning notes fail after retries instead of being returned as a successful model essay', async () => {
  const result = await api({ drafts: [reported] }).run();
  assert.equal(result.status, 422); assert.equal(result.body.code, 'ESSAY_QUALITY_FAILED');
  assert.equal(result.writing, 3); assert.equal(result.checking, 0);
  assert.equal(result.body.text, undefined); assert.notEqual(result.body.success, true);
});

test('A contradiction in finished prose also fails after retries', async () => {
  const contradictory = coherent.replace('I largely disagree', 'I largely agree');
  const result = await api({ drafts: [contradictory], reviews: [{ issues: [{ code: 'stance_conflict',
    reason: 'The introduction agrees with deductions while the body and conclusion oppose automatic deductions.', quotes: ['I largely agree'] }] }] }).run();
  assert.equal(result.status, 422); assert.equal(result.checking, 3);
  assert.equal(result.body.text, undefined);
});

test('A repaired draft is returned only after format and semantic checks pass', async () => {
  const contradictory = coherent.replace('I largely disagree', 'I largely agree');
  const app = api({ drafts: [contradictory, coherent], reviews: [
    { issues: [{ code: 'stance_conflict', reason: 'Keep the introduction opposed to automatic mark deductions.', quotes: ['I largely agree'] }] },
    { issues: [] } ] });
  const result = await app.run();
  assert.equal(result.status, 200); assert.equal(result.body.text, coherent);
  assert.equal(result.writing, 2); assert.equal(result.checking, 2);
  assert.equal(result.body.output_mode, 'full_essay'); assert.equal(result.body.quality_checked, true);
  assert(app.requests.some(request => request.messages[0].content.includes('Keep the introduction opposed to automatic mark deductions.')));
});

test('Malformed semantic reviews and invented evidence cannot approve or reject a draft silently', async () => {
  const result = await api({ reviews: ['not JSON'] }).run();
  assert.equal(result.status, 422); assert.equal(result.body.text, undefined);
  assert.throws(() => readReview({ issues: [{ code: 'stance_conflict', reason: 'Wrong stance', quotes: ['invented quotation'] }] },
    [coherent], ['stance_conflict']), /could not be verified/);
});

test('Legacy notes remain labelled as a planning guide after switching to a Band 9 target', () => {
  const ctx = { EssayGenerationPolicy: policy, getTemplateKeyForEssay: () => 'band9', templateTierLabel: () => 'Band 9',
    escapeHtml: text => String(text || ''), highlightParagraph: text => String(text || ''), console: { log() {} } };
  vm.createContext(ctx); vm.runInContext(fn(client, 'renderEssayPageHTML'), ctx);
  const html = ctx.renderEssayPageHTML({ title: plan.topic, question: plan.question, bp1: reported }, 1);
  assert(html.includes('Essay Planning Guide'));
  assert(!html.includes('COMPLETE MODEL ESSAY')); assert(!html.includes('Band 9'));
});

test('A pending response cannot overwrite the saved essay after its preferences change', async () => {
  const essay = { id: 'draft', title: plan.topic, question: plan.question, templateChoice: 'band9', intro: 'The saved introduction' };
  let reply, saves = 0;
  const ctx = { EssayGenerationPolicy: policy, API_URL: '', getCurrent: () => essay,
    hasApprovedEssayPlan: () => true, getActiveQuestionType: () => plan.question_type,
    validateEssayStateBeforeGeneration: () => ({ valid: true }), getTemplatesBag: () => ({ default: 'band9' }),
    getEssayOutputMode: () => 'full_essay', consumeQuota: async () => true, getTemplateForEssay: () => ({}),
    isStrongStance: () => false, buildStructuredEssayPlan: () => structuredClone(plan),
    generatePreviewSignature: e => e.templateChoice, saveAll: () => saves++, console: { error() {} },
    fetch: () => new Promise(resolve => { reply = body => resolve({ ok: true, json: async () => body }); }) };
  vm.createContext(ctx); vm.runInContext(fn(client, 'generateEssayFromApprovedPlan'), ctx);
  const pending = ctx.generateEssayFromApprovedPlan({ silent: true, skipConfirm: true });
  await new Promise(resolve => setImmediate(resolve));
  essay.templateChoice = 'band6';
  reply({ success: true, text: coherent });
  await assert.rejects(pending, /preferences changed/);
  assert.equal(essay.intro, 'The saved introduction'); assert.equal(saves, 0);
  essay.templateChoice = 'band9';
  const outline = ctx.generateEssayFromApprovedPlan({ silent: true, skipConfirm: true });
  await new Promise(resolve => setImmediate(resolve));
  reply({ success: true, text: reported });
  await assert.rejects(outline, /planning notes/);
  assert.equal(essay.intro, 'The saved introduction'); assert.equal(saves, 0);
});

test('Manual-idea review ignores stale AI selections left on the essay', async () => {
  let prompt;
  const reviewer = createEssayGenerationReviewer(async text => { prompt = text; return { issues: [] }; });
  const result = await reviewer.reviewPlan({ ...plan, idea_source: 'manual', manual_ideas: ['Support students facing family emergencies'],
    selected_ideas: { reasons: ['Reward punctual students with strict automatic deductions'] } });
  assert.equal(result.ok, true);
  assert(prompt.includes('Support students facing family emergencies'));
  assert(!prompt.includes('Reward punctual students with strict automatic deductions'));
});
