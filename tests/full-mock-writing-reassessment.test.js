'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), { randomUUID } = require('node:crypto');
const review = require('../full-mock/writing-reassessment');
const { loadPaper } = require('../full-mock/paper'), session = require('../full-mock/session'), assessment = require('../full-mock/assessment');
const adapters = require('../full-mock/adapters'), { inputHash, aggregate } = require('../full-mock/aggregation');
const types = new Set(['swt', 'essay', 'sst']);

function reviewed(q, answer) {
  const scores = { ...adapters.maxima(q), content: adapters.maxima(q).content - 1, grammar: 1 };
  const quote = answer.split('.')[0];
  return { scores, feedback: Object.fromEntries(Object.keys(scores).map(key => [key, 'Review of ' + key + '.'])),
    overallVerdict: 'Relevant ideas need clearer connections.', strengths: ['Relevant main ideas.'], improvements: ['Complete the affected clauses.'],
    evidence: ['content', 'grammar'].map(trait => ({ trait, source: 'response', quote, explanation: 'The connection is unclear.' })), errors: [] };
}
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'writing-reassessment-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = require('../full-mock/store').createStore({ directory }), paper = loadPaper(), attemptId = randomUUID();
  const snap = assessment.snapshot();
  await store.create('sukhpal', attemptId, paper, (id, at) => session.create(id, paper, at, { preview: true, assessmentSnapshot: snap }), 1000);
  await store.update('sukhpal', attemptId, state => {
    session.end(state, paper, 1000); state.assessment.status = 'complete';
    for (let i = 0; i < paper.questions.length; i++) {
      const candidate = paper.questions[i], q = candidate.question, response = state.responses[i + 1];
      if (types.has(q.type)) response.answer = [q.type === 'swt'
        ? 'Teams build models to test ideas and revise assumptions, although several details remain unclear.'
        : 'Students gain useful experience through practical projects, although universities must accommodate different needs. '.repeat(q.type === 'essay' ? 18 : 4).trim()];
      const result = adapters.result(q, adapters.maxima(q));
      state.assessment.items[candidate.id] = { status: 'assessed', inputHash: inputHash(response), snapshotHash: state.assessment.snapshotHash,
        result, stages: types.has(q.type) ? { writing: { status: 'complete', value: result } } : { retained: { status: 'complete', value: 'Saved evidence' } } };
    }
    return state;
  });
  return { store, paper, attemptId, username: 'sukhpal', operation: 'writing-review-test', review: reviewed, logger: { info() {} } };
}

test('One writing review atomically changes four writing items and recalculates integrated skills while preserving all other evidence', async t => {
  const f = await fixture(t), before = (await f.store.get(f.username, f.attemptId)).state;
  const report = await review.reassess(f);
  assert.equal(report.status, 'complete'); assert.equal(report.updated, 4); assert.equal(report.reviewed, 4);
  const after = (await f.store.get(f.username, f.attemptId)).state;
  assert.deepEqual(after.responses, before.responses);
  assert.deepEqual(after.assessment.snapshot, before.assessment.snapshot);
  assert.equal(after.contentReassessment, before.contentReassessment);
  assert(aggregate(f.paper, after).ready);
  for (const candidate of f.paper.questions) {
    const old = before.assessment.items[candidate.id], next = after.assessment.items[candidate.id];
    if (types.has(candidate.question.type)) {
      assert.equal(next.result.scoringModel, 'gpt-6.1-sol');
      assert.equal(next.result.native.reassessmentPolicy, review.VERSION);
      assert.deepEqual(next.writingReassessmentHistory[0].result, old.result);
      assert.deepEqual(next.writingReassessmentHistory[0].writing, old.stages.writing);
      assert.equal(next.result.scores.grammar, 1);
      assert.equal(next.stages.writing.value.total, next.result.total);
    } else assert.deepEqual(next, old);
  }
  assert.deepEqual(report.before.speaking, report.after.speaking);
  for (const key of ['reading', 'listening', 'writing']) assert(report.after[key].score < report.before[key].score);
  assert(report.after.overall.range.high < report.before.overall.range.high);
  const studentReport = require('../full-mock/report').buildReport(f.paper, after);
  assert(studentReport.ready); assert.equal(studentReport.assessedCount, 65);
  assert(studentReport.items.find(row => row.type === 'essay').feedback.criteria.find(row => row.key === 'grammar').feedback.includes('Review'));
});

test('Replaying an operation, including an unfinished claim, never repeats paid calls', async t => {
  const f = await fixture(t); let calls = 0;
  const options = { ...f, review: async (...args) => { calls++; return reviewed(...args); } };
  await review.reassess(options); await review.reassess(options); assert.equal(calls, 4);
  await f.store.update(f.username, f.attemptId, state => { state.writingReassessment.status = 'processing'; return state; });
  await review.reassess(options); assert.equal(calls, 4);
});

test('A failed or unsupported assessment preserves every old mark and the complete report', async t => {
  const f = await fixture(t), before = (await f.store.get(f.username, f.attemptId)).state;
  const report = await review.reassess({ ...f, review: async (q, answer) => {
    if (q.type === 'essay') throw Error('Provider unavailable');
    return reviewed(q, answer);
  } });
  assert.equal(report.status, 'needs-review'); assert.equal(report.updated, 0); assert.equal(report.issues.length, 1);
  const after = (await f.store.get(f.username, f.attemptId)).state;
  assert.deepEqual(after.assessment.items, before.assessment.items); assert(aggregate(f.paper, after).ready);
  assert.deepEqual(report.before, report.after);
});

test('Concurrent changes cannot be overwritten by the review', async t => {
  const f = await fixture(t), before = (await f.store.get(f.username, f.attemptId)).state; let first = true;
  const target = f.paper.questions.find(row => row.question.type === 'swt').id;
  await assert.rejects(review.reassess({ ...f, review: async (q, answer) => {
    if (first) { first = false; await f.store.update(f.username, f.attemptId, state => { state.assessment.items[target].operatorNote = 'Concurrent review'; return state; }); }
    return reviewed(q, answer);
  } }));
  const after = (await f.store.get(f.username, f.attemptId)).state;
  for (const candidate of f.paper.questions) assert.deepEqual(after.assessment.items[candidate.id].result, before.assessment.items[candidate.id].result);
});

test('Review rejects invented evidence, fractional marks, Form overrides, missing deduction evidence and unrelated accounts', async t => {
  const f = await fixture(t), q = f.paper.questions.find(row => row.question.type === 'swt').question;
  const answer = (await f.store.get(f.username, f.attemptId)).state.responses[33].answer[0];
  for (const change of [
    raw => { raw.evidence[0].quote = 'Invented student quotation'; },
    raw => { raw.scores.grammar = 1.5; },
    raw => { raw.scores.form = 0; },
    raw => { raw.evidence = raw.evidence.filter(row => row.trait !== 'grammar'); }
  ]) { const raw = reviewed(q, answer); change(raw); assert.throws(() => review.normalise(q, answer, raw)); }
  await assert.rejects(review.reassess({ ...f, username: 'mahabir1' }));
  await assert.rejects(review.reassess({ ...f, attemptId: randomUUID() }));
  await f.store.update(f.username, f.attemptId, state => { state.assessment.status = 'processing'; return state; });
  await assert.rejects(review.reassess(f));
});

test('The independent prompt uses integer published descriptors without the meaning-only Grammar override', () => {
  const q = { type: 'essay', text: 'Discuss a benefit and a difficulty, and state your position.' }, answer = 'A saved essay.';
  const prompt = review.prompt(q, answer), schema = review.schema(q);
  assert(prompt.includes('No previous mark is supplied'));
  assert(prompt.includes('Do not automatically award full Grammar'));
  assert(prompt.includes('all quoted') || prompt.includes('All quoted'));
  assert(prompt.includes(q.text)); assert(prompt.includes(answer));
  assert.equal(schema.properties.scores.properties.grammar.type, 'integer');
});
