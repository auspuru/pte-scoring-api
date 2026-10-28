'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const blueprint = require('../full-mock/blueprint');
const { RUBRICS } = require('../full-mock/rubrics');
const { inventory } = require('../full-mock/inventory');
const { readAsset, scoringSnapshot, candidateFingerprint, keyIssues, auditCandidate, validateSelection, auditInventory } = require('../full-mock/audit');
const lock = require('../content/full-mock/scoring-lock.json');
const root = path.resolve(__dirname, '..');
const candidates = inventory();
const codes = result => result.issues.map(issue => issue.code);
const clone = structuredClone;
const stamp = { reviewer: 'Fixture reviewer', date: '2026-10-28', evidence: 'Fixture review record' };
function reviewed(candidate) {
  return { fingerprint: candidateFingerprint(candidate), rights: { ...stamp, status: 'original' },
    answerKey: { ...stamp }, difficulty: { ...stamp, band: 'medium', basis: 'editorial' },
    instructions: { ...stamp }, audio: { ...stamp }, visual: { ...stamp } };
}
const evaluate = (candidate, review = reviewed(candidate)) => auditCandidate(candidate, { root, review });

test('The immutable baseline has 65 scored items, all 22 tasks and the eight integrated-skill routes', () => {
  const { TASKS, SECTIONS, INTRODUCTION } = blueprint;
  assert.equal(TASKS.length, 22);
  assert.equal(TASKS.reduce((n, task) => n + task.count, 0), 65);
  assert.deepEqual(SECTIONS.map(section => TASKS.filter(task => task.section === section.id).reduce((n, task) => n + task.count, 0)), [35, 15, 15]);
  assert.equal(INTRODUCTION.scored, false);
  assert.deepEqual(Object.fromEntries(TASKS.filter(task => task.skills.length === 2).map(task => [task.type, task.skills])), {
    rs: ['listening', 'speaking'], rl: ['listening', 'speaking'], sgd: ['listening', 'speaking'],
    swt: ['reading', 'writing'], sst: ['listening', 'writing'], hcs: ['listening', 'reading'],
    hiw: ['listening', 'reading'], wfd: ['listening', 'writing']
  });
  for (const [type, skills] of Object.entries({ ra: ['speaking'], asq: ['listening'], dropdown: ['reading'], lfi: ['listening'] })) assert.deepEqual(TASKS.find(task => task.type === type).skills, skills);
  assert.throws(() => TASKS[0].skills.push('reading'), TypeError);
  assert.equal(TASKS.find(task => task.type === 'sst').timing.includesPromptPlayback, true);
  assert.equal(TASKS.find(task => task.type === 'ra').timing.responseSeconds, null);
});

test('Every task has an audited rubric and sources are pinned; ASQ is explicitly missing', () => {
  assert.deepEqual(Object.keys(RUBRICS), blueprint.TASKS.map(task => task.type));
  assert.equal(RUBRICS.asq.implementation, 'missing');
  const writing = require('../writing-lab-scoring'), essay = require('../public/essay-scoring');
  for (const type of ['swt', 'sst']) assert.deepEqual(RUBRICS[type].traits, writing.MAXIMA[type]);
  assert.deepEqual(RUBRICS.essay.traits, essay.MAXIMA);
  for (const type of ['swt', 'essay', 'sst']) assert.deepEqual(RUBRICS[type].gates, ['content', 'form']);
  assert.deepEqual(scoringSnapshot(root), lock.snapshot);
  const dynamic = lock.snapshot.files['gpt-speaking-delivery.js'];
  assert.equal(dynamic.version, null);
  assert.match(dynamic.versionExpression, /MODEL/); // Do not pretend a version prefix pins the deployed model.
});

test('Changed, removed and unexpected scorer pins block the audit', () => {
  for (const change of ['hash', 'missing', 'extra']) {
    const next = clone(lock);
    if (change === 'hash') next.snapshot.files['speaking-scoring.js'].sha256 = '0'.repeat(64);
    if (change === 'missing') delete next.snapshot.files['speaking-scoring.js'];
    if (change === 'extra') next.snapshot.files['obsolete-scorer.js'] = { sha256: '0'.repeat(64), version: null };
    const report = auditInventory({ root, candidates: [], lock: next });
    assert.equal(report.scoringDependenciesPinned, false, change);
    assert(report.scoringDrift.length, change);
  }
});

test('Choice, blank and reorder keys reject invalid coordinates and missing answer options', () => {
  for (const type of ['mcsa', 'lmcsa', 'hcs', 'smw']) {
    assert.deepEqual(keyIssues({ type, choices: ['First', 'Second'], answer: 1 }), []);
    assert(keyIssues({ type, choices: ['First', 'Second'], answer: 2 }).length);
  }
  for (const type of ['mcma', 'lmcma']) {
    assert.deepEqual(keyIssues({ type, choices: ['First', 'Second'], answers: [0, 1] }), []);
    for (const answers of [[0, 0], [-1], [2], []]) assert(keyIssues({ type, choices: ['First', 'Second'], answers }).length);
  }
  const dropdown = { type: 'dropdown', passage: 'A [[1]] and [[2]].', answers: ['bird', 'cat'], options: [['bird', 'dog'], ['cat', 'fish']] };
  assert.deepEqual(keyIssues(dropdown), []);
  assert(keyIssues({ ...dropdown, passage: 'A [[2]] and [[1]].' }).length);
  assert(keyIssues({ ...dropdown, options: [['dog'], ['cat']] }).length);
  assert(keyIssues({ ...dropdown, type: 'wordbank', answers: ['bird', 'bird'], bank: ['bird', 'cat'] }).length);
  const reorder = { type: 'reorder', items: [{ key: 'B', text: 'Second.' }, { key: 'A', text: 'First.' }], answers: ['A', 'B'] };
  assert.deepEqual(keyIssues(reorder), []);
  assert(keyIssues({ ...reorder, answers: ['A', 'A'] }).length);
  assert(keyIssues({ ...reorder, answers: ['A', 'C'] }).length);
  assert(keyIssues({ ...reorder, items: [null, { key: 'B', text: 'Second.' }] }).length);
  assert(keyIssues({ type: 'asq', text: 'A question.' }).length);
  assert.deepEqual(keyIssues({ type: 'asq', acceptedAnswers: ['an answer', 'answer'] }), []);
});

test('Listening blanks and highlighted keys must reconstruct the exact recording transcript', () => {
  const fill = { type: 'lfi', text: 'The library opens early.', passage: 'The [[1]] opens early.', answers: ['library'] };
  assert.deepEqual(keyIssues(fill), []);
  assert(keyIssues({ ...fill, answers: ['laboratory'] }).length);
  const hiw = { type: 'hiw', text: 'The library opens early.', passage: 'The library closes early.', answers: [2] };
  assert.deepEqual(keyIssues(hiw), []);
  assert(keyIssues({ ...hiw, answers: [1] }).length);
  assert(keyIssues({ ...hiw, passage: 'The new library closes early.' }).length);
});

test('Reviews require current content and evidence; supplied prediction status does not prove reuse rights', () => {
  const candidate = { id: 'fixture/mcsa', question: { id: 'mcsa', type: 'mcsa', instructions: 'Choose one response.', passage: 'A short original passage.', choices: ['First', 'Second'], answer: 0 } };
  assert.equal(evaluate(candidate).eligible, true);
  assert.equal(evaluate(candidate, undefined).structurallyValid, true);
  const missing = auditCandidate(candidate, { root });
  assert.equal(missing.eligible, false);
  assert(codes(missing).includes('rights-review'));
  const review = reviewed(candidate), changed = clone(candidate);
  changed.question.answer = 1;
  assert(codes(evaluate(changed, review)).includes('review-stale-or-missing'));
  assert(codes(evaluate(candidate, { ...review, rights: { ...stamp, status: 'verbatim-user-provided' } })).includes('rights-review'));
  assert(codes(evaluate(candidate, { ...review, answerKey: { ...stamp, date: '2026-02-30' } })).includes('answer-key-review'));
  assert(codes(evaluate(candidate, { ...review, difficulty: { ...stamp, band: 'hard', basis: 'guessed' } })).includes('difficulty-review'));
  const noInstruction = clone(candidate); delete noInstruction.question.instructions;
  assert(codes(evaluate(noInstruction)).includes('instruction-missing'));
});

test('Real audio is verified without synthesis; altered transcripts, hashes, duration and runtime audio fail', () => {
  const candidate = clone(candidates.find(candidate => candidate.question.type === 'rs'));
  assert.equal(evaluate(candidate).eligible, true);
  for (const [mutate, code] of [
    [q => { q.question.text += ' Changed.'; }, 'audio-integrity'],
    [q => { q.audio.entry.audioSha256 = '0'.repeat(64); }, 'audio-integrity'],
    [q => { q.audio.entry.seconds = 20; }, 'audio-duration'],
    [q => { q.question.audioMode = 'runtime-neural'; }, 'audio-unfrozen'],
    [q => { q.audio.path = 'content/missing-fixture.mp3'; }, 'audio-missing']
  ]) { const next = clone(candidate); mutate(next); assert(codes(evaluate(next)).includes(code), code); }
  const smw = candidates.find(candidate => candidate.question.type === 'smw');
  assert(codes(evaluate(smw)).includes('audio-unfrozen'));
});

test('SGD requires three transcript speakers and three recorded voices', () => {
  const candidate = clone(candidates.find(candidate => candidate.question.type === 'sgd'));
  assert.equal(evaluate(candidate).eligible, true);
  candidate.audio.entry.voices = candidate.audio.entry.voices.slice(0, 2);
  assert(codes(evaluate(candidate)).includes('audio-speakers'));
  candidate.question.turns = candidate.question.turns.map(turn => ['One speaker', turn[1]]);
  assert(codes(evaluate(candidate)).includes('discussion-speakers'));
});

test('Source and displayed chart bytes both need to match their recorded hashes', () => {
  const candidate = clone(candidates.find(candidate => candidate.question.type === 'di'));
  const result = evaluate(candidate);
  assert.equal(result.eligible, true);
  assert(result.image.width > 0 && result.image.height > 0);
  assert(result.displayImage.sha256);
  candidate.displayImage.sha256 = '0'.repeat(64);
  assert(codes(evaluate(candidate)).includes('display-image-integrity'));
  candidate.image.sha256 = '0'.repeat(64);
  assert(codes(evaluate(candidate)).includes('image-integrity'));
});

test('Asset paths cannot escape the checkout through traversal, absolute paths or symlinks', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'full-mock-paths-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const inside = path.join(directory, 'inside'); fs.mkdirSync(inside);
  fs.writeFileSync(path.join(directory, 'fixture.txt'), 'outside fixture');
  fs.symlinkSync('../fixture.txt', path.join(inside, 'linked.txt'));
  assert.throws(() => readAsset(inside, '../fixture.txt'), /escapes/);
  assert.throws(() => readAsset(inside, path.join(directory, 'fixture.txt')), /Invalid/);
  assert.throws(() => readAsset(inside, 'linked.txt'), /escapes/);
});

function uniqueSelection() {
  return blueprint.TASKS.flatMap(task => Array.from({ length: task.count }, (_, index) => ({
    id: task.type + '/' + index, question: { type: task.type, text: task.type + ' unique stimulus ' + index }
  })));
}
test('The future freeze gate rejects incomplete papers, wrong order and duplicated content across aliases', () => {
  const valid = uniqueSelection();
  assert.deepEqual(validateSelection(valid), []);
  assert(validateSelection(valid.slice(1)).some(issue => issue.includes('65')));
  const wrongOrder = clone(valid); [wrongOrder[0], wrongOrder[6]] = [wrongOrder[6], wrongOrder[0]];
  assert(validateSelection(wrongOrder).includes('Invalid task order.'));
  const duplicateId = clone(valid); duplicateId[1].id = duplicateId[0].id;
  assert(validateSelection(duplicateId).includes('Duplicate candidate IDs.'));
  const repeated = clone(valid); repeated[6].question.text = repeated[0].question.text;
  assert(validateSelection(repeated).some(issue => issue.includes('Repeated passages')));
  const sameSource = clone(valid); sameSource[0].question.sourceId = sameSource[6].question.sourceId = 'shared-source';
  assert(validateSelection(sameSource).some(issue => issue.includes('Repeated passages')));
  const excerpt = clone(valid); excerpt[0].question.sourceId = excerpt[6].question.audioId = 'parent-lecture';
  assert(validateSelection(excerpt).some(issue => issue.includes('Repeated passages')));
});

test('Current inventory exposes gaps without inventing reviews, difficulty data or a final score', () => {
  const before = JSON.stringify(candidates), report = auditInventory({ root, candidates, lock });
  assert.equal(JSON.stringify(candidates), before);
  assert.equal(report.scoringDependenciesPinned, true);
  assert.equal(report.tasks.find(task => task.type === 'asq').available, 0);
  assert.equal(report.tasks.find(task => task.type === 'asq').scorer, 'missing');
  assert.equal(report.contentReady, false);
  assert.equal(report.fullMockReady, false);
  assert.equal(report.tasks.reduce((count, task) => count + task.reviewedEligible, 0), 0);
  assert(report.duplicateStimuli.length);
  const serial = JSON.stringify(report);
  assert(!serial.includes(candidates[0].question.text));
  assert(!Object.hasOwn(report, 'overall'));
});

test('The audit CLI succeeds as a report and its strict readiness check fails while content gaps remain', () => {
  const script = path.join(root, 'scripts/audit-full-mock.js');
  const report = spawnSync(process.execPath, [script, '--json'], { encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(report.status, 0, report.stderr);
  assert.equal(JSON.parse(report.stdout).contentReady, false);
  const strict = spawnSync(process.execPath, [script, '--strict'], { encoding: 'utf8' });
  assert.equal(strict.status, 1);
  assert.match(strict.stdout, /Content ready: false/);
});
