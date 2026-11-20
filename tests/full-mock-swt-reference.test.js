'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { loadPaper, digest } = require('../full-mock/paper');
const session = require('../full-mock/session');
const assessment = require('../full-mock/assessment');
const adapters = require('../full-mock/adapters');
const { inputHash, aggregate } = require('../full-mock/aggregation');
const { buildReport } = require('../full-mock/report');
const { review } = require('../public/full-mock-report');
const { POLICY_VERSION, legacyPolicy } = require('../swt-scoring-policy');
const { swtQuestionSourceIdentity } = require('../writing-lab-scoring');
const { formFor } = require('../swt-form-policy');
const { plainSwtSample } = require('../swt-plain-samples');

function submitted(paper, { snapshotVersion = POLICY_VERSION, itemVersion = POLICY_VERSION, recordIdentity = true } = {}) {
  const snapshot = structuredClone(assessment.snapshot(undefined, undefined, paper));
  snapshot.scoringSources.files['swt-scoring-policy.js'].version = snapshotVersion;
  const state = session.create(randomUUID(), paper, 1000, { preview:true, assessmentSnapshot:snapshot });
  session.end(state, paper, 2000);
  state.assessment.status = 'complete';
  paper.questions.forEach(({ id, question }, index) => {
    const result = question.type === 'swt'
      ? adapters.result(question, { ...adapters.maxima(question), content:3 }, {
        nativeVersion:itemVersion,
        native:{ version:itemVersion, ...(recordIdentity ? { source_identity:swtQuestionSourceIdentity(question) } : {}) }
      })
      : adapters.result(question, adapters.maxima(question));
    state.assessment.items[id] = { status:'assessed', result, snapshotHash:state.assessment.snapshotHash,
      inputHash:inputHash(state.responses[index + 1]), stages:{} };
  });
  return state;
}

function references(paper, state) {
  return buildReport(paper, state).items.filter(item => item.type === 'swt');
}

test('Current SWT Full Mock reports correct exact active and retained references without changing evidence or marks', () => {
  for (const paper of [loadPaper('full-mock-2'), loadPaper('full-mock-2', 1)]) {
    const state = submitted(paper), before = structuredClone(state), paperHash = digest(paper);
    const [darwin, independent] = references(paper, state);
    assert.match(darwin.reference.sample, /gathering evidence/);
    assert.doesNotMatch(darwin.reference.sample, /gathering support/);
    assert.match(independent.reference.sample, /by choice or necessity/);
    assert.match(independent.reference.facts[1], /poorly measure independent work/);
    assert.match(independent.reference.facts[3], /up to 162 million/);
    assert.match(review(independent), /Plain-English sample/);
    for (const item of [darwin, independent]) {
      assert.equal(formFor(item.reference.sample).score, 1);
      assert.equal(item.reference.teachingSample, plainSwtSample(item.reference.text));
      assert.equal(formFor(item.reference.teachingSample).score, 1);
      assert.deepEqual(item.scores, { content:3, form:1, grammar:2, vocabulary:2 });
      assert.equal(item.total, 8);
    }
    const report = buildReport(paper, state), aggregation = aggregate(paper, state);
    assert.deepEqual(report.profiles, aggregation.profiles);
    assert.equal(report.groups.find(group => group.type === 'swt').earned, 16);
    assert.equal(report.groups.find(group => group.type === 'swt').possible, 18);
    assert.deepEqual(state, before);
    assert.equal(digest(paper), paperHash);
  }
  const paper = loadPaper('full-mock-3'), [complaints, education] = references(paper, submitted(paper));
  assert.match(education.reference.facts[1], /benefits remained unproven and teachers and their unions were cautious/);
  assert.equal(education.reference.sample, paper.questions.find(row => row.id === education.id).question.sample);
  assert.deepEqual(complaints.reference.facts, paper.questions.find(row => row.id === complaints.id).question.keyPoints);
});

test('Prior snapshots, prior results, pending items and items without the exact saved identities retain the frozen reference', () => {
  const paper = loadPaper('full-mock-2'), candidate = paper.questions.find(row => row.question.type === 'swt');
  const original = candidate.question.sample, legacy = legacyPolicy.POLICY_VERSION;
  for (const options of [{ snapshotVersion:legacy }, { itemVersion:legacy }, { recordIdentity:false }]) {
    const [item] = references(paper, submitted(paper, options));
    assert.equal(item.reference.sample, original);
    assert.equal(item.reference.teachingSample, plainSwtSample(candidate.question.text));
  }
  const state = submitted(paper), job = state.assessment.items[candidate.id];
  const identity = job.result.native.source_identity;
  for (const key of ['passage_sha256', 'reference_sha256']) {
    job.result.native.source_identity = { ...identity, [key]:'different' };
    assert.equal(references(paper, state)[0].reference.sample, original);
  }
  job.result.native.source_identity = identity;
  job.status = 'pending';
  assert.equal(references(paper, state)[0].reference.sample, original);
});

test('Changing either the passage or the frozen reference prevents applying an old correction to a new version', () => {
  for (const field of ['text', 'sample', 'keyPoints']) {
    const paper = structuredClone(loadPaper('full-mock-2'));
    const { question } = paper.questions.find(row => row.question.type === 'swt');
    if (field === 'keyPoints') question.keyPoints[0] += ' Another teaching point.';
    else question[field] += ' Another version.';
    const [projected] = references(paper, submitted(paper));
    assert.equal(projected.reference.sample, question.sample, field);
    assert.deepEqual(projected.reference.facts, question.keyPoints, field);
    assert.equal(projected.reference.teachingSample, field === 'text' ? undefined : plainSwtSample(question.text), field);
  }
});
