'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { TASKS } = require('../full-mock/blueprint');
const { definition, candidates } = require('../full-mock/authoring');
const { duplicates, auditCandidate, keyIssues } = require('../full-mock/audit');
const { digest, putImmutable, validatePaper, catalogue, loadPaper, assertReleased, snapshotForAttempt, questionForPlayer } = require('../full-mock/paper');
const root = path.resolve(__dirname, '..');
// This suite retains the original paper's authoring and media regression checks.
const paper = loadPaper('full-mock-1', 1);

test('Frozen Full Mock 1 has all 65 questions and 22 types in exam order, plus an unscored introduction', () => {
  assert.equal(paper.questions.length, 65);
  assert.equal(new Set(paper.questions.map(candidate => candidate.id)).size, 65);
  assert.deepEqual([...new Set(paper.questions.map(candidate => candidate.question.type))], TASKS.map(task => task.type));
  for (const task of TASKS) assert.equal(paper.questions.filter(candidate => candidate.question.type === task.type).length, task.count, task.type);
  assert.equal(paper.introduction.scored, false);
  assert.equal(paper.introduction.responseSeconds, 30);
  assert.deepEqual(duplicates(paper.questions), []);
  assert.deepEqual(validatePaper(paper), []);
  assert(paper.questions.every(candidate => auditCandidate(candidate, { root }).structurallyValid));
  assert.equal(paper.questions.filter(candidate => candidate.question.contentOrigin.kind === 'original').length, 49);
  assert.equal(paper.questions.filter(candidate => candidate.question.contentOrigin.kind === 'repository-original').length, 16);
});

test('All 36 recordings and five visual files are private, pinned and task-compatible', () => {
  assert.equal(paper.questions.filter(candidate => candidate.audio).length, 36);
  assert.equal(paper.questions.filter(candidate => candidate.image).length, 5);
  assert.equal(paper.assets.length, 41);
  for (const candidate of paper.questions) {
    assert.deepEqual(keyIssues(candidate.question), [], candidate.id);
    for (const descriptor of [candidate.audio, candidate.image].filter(Boolean)) assert.match(descriptor.path, /^content\/full-mock\/assets\/[a-f0-9]{64}\.(mp3|svg)$/);
    if (candidate.audio) {
      assert.notEqual(candidate.question.audioMode, 'runtime-neural');
      assert.equal(candidate.question.playOnce, true);
    }
  }
  const discussions = paper.questions.filter(candidate => candidate.question.type === 'sgd');
  assert(discussions.every(candidate => new Set(candidate.audio.entry.voices).size === 3));
  const visual = paper.questions.filter(candidate => candidate.image);
  assert.deepEqual(visual.map(candidate => candidate.question.visual.kind), ['bar', 'pie', 'line', 'table', 'process']);
  for (const candidate of visual) assert.match(fs.readFileSync(path.join(root, candidate.image.path), 'utf8'), /width="730" height="500"/);
});

test('Each newly authored audio file was generated locally with a pinned voice model', () => {
  const generated = paper.questions.filter(candidate => candidate.audio && candidate.question.contentOrigin.kind === 'original');
  assert.equal(generated.length, 30);
  const model = require('../content/full-mock/voice-model-source.json');
  for (const candidate of generated) {
    assert.match(candidate.audio.entry.generator, /^piper-tts .+ \(local\)$/);
    assert.equal(candidate.audio.entry.voiceModelRevision, model.revision);
    assert.equal(candidate.audio.entry.voiceModelSha256, model.files['en_US-ljspeech-high.onnx'].sha256);
    assert.equal(candidate.audio.entry.humanListeningReview, 'pending');
  }
});

test('Options are frozen in varied positions and reorder keys do not reveal the correct alphabetic order', () => {
  const dropdowns = paper.questions.filter(candidate => candidate.question.type === 'dropdown').map(candidate => candidate.question);
  assert(new Set(dropdowns.flatMap(q => q.answers.map((answer, index) => q.options[index].indexOf(answer)))).size > 1);
  for (const q of paper.questions.filter(candidate => candidate.question.type === 'reorder').map(candidate => candidate.question)) {
    assert(q.items.every(item => /^[a-f0-9]{16}$/.test(item.key)));
    assert.notDeepEqual(q.items.map(item => item.key), q.answers);
  }
});

test('Player projections hide answer keys, references, transcripts, provenance and filesystem paths', () => {
  const forbidden = new Set(['answer', 'answers', 'acceptedAnswers', 'sample', 'facts', 'keyPoints', 'contentOrigin', 'sourceId', 'audioSource', 'path', 'entry', 'explanation', 'difficulty']);
  function inspect(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) { assert(!forbidden.has(key), key); inspect(nested); }
  }
  for (const candidate of paper.questions) {
    const q = candidate.question, view = questionForPlayer(candidate); inspect(view);
    if (!['ra', 'rts', 'swt', 'essay'].includes(q.type)) assert.equal(view.text, undefined, q.type);
    if (['ra', 'rts', 'swt', 'essay'].includes(q.type)) assert.equal(view.text, q.text);
    assert.equal(view.name, TASKS.find(task => task.type === q.type).label);
    assert.equal(view.title, undefined);
    if (q.type === 'asq') { assert.equal(view.seconds, 10); assert.equal(view.startCueMs, 0); assert.equal(view.preparation, 0); }
  }
  assert.equal(catalogue()[0].available, false);
  assert.equal(catalogue()[0].questions, undefined);
  assert.equal(catalogue()[0].file, undefined);
});

test('Frozen data and explicit development-preview copies cannot be changed in memory', () => {
  const config = { transcriptionModel: 'test-transcriber-v1', contentModel: 'test-judge-v1', deliveryProvider: 'test-provider', deliveryModel: 'test-delivery-v1' };
  assert.throws(() => { paper.questions[0].question.text = 'Changed'; }, TypeError);
  assert.throws(() => snapshotForAttempt(paper, config), /not available/);
  const snapshot = snapshotForAttempt(paper, config, { draftPreview: true });
  assert.equal(snapshot.mode, 'development-preview');
  assert.equal(snapshot.paperHash, digest(paper));
  assert.notEqual(snapshot.paper, paper);
  assert.throws(() => { snapshot.configuration.contentModel = 'changed'; }, TypeError);
  assert.throws(() => snapshotForAttempt(paper, { ...config, apiKey: 'do-not-store' }, { draftPreview: true }), /credentials/);
  assert.throws(() => snapshotForAttempt(paper, {}, { draftPreview: true }), /model/);
  assert.throws(() => assertReleased(paper), /not available/);
  assert.equal(paper.editorial.studentReleaseApproved, false);
});

test('Frozen files are append-only and identical reruns preserve the existing bytes', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'full-mock-immutable-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  putImmutable(directory, 'paper.json', 'first');
  const before = fs.statSync(path.join(directory, 'paper.json')).mtimeMs;
  putImmutable(directory, 'paper.json', 'first');
  assert.equal(fs.statSync(path.join(directory, 'paper.json')).mtimeMs, before);
  assert.throws(() => putImmutable(directory, 'paper.json', 'second'), /new version/);
  assert.equal(fs.readFileSync(path.join(directory, 'paper.json'), 'utf8'), 'first');
});

test('Snapshot edits, missing media and altered recording bytes are detected', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'full-mock-tamper-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.cpSync(path.join(root, 'content/full-mock/papers'), path.join(directory, 'content/full-mock/papers'), { recursive: true });
  fs.cpSync(path.join(root, 'content/full-mock/assets'), path.join(directory, 'content/full-mock/assets'), { recursive: true });
  assert.equal(loadPaper('full-mock-1', 1, { root: directory }).questions.length, 65);
  const file = path.join(directory, 'content/full-mock/papers/full-mock-1.v1.json');
  const original = fs.readFileSync(file);
  const changed = JSON.parse(original); changed.questions[0].question.text += ' changed'; fs.writeFileSync(file, JSON.stringify(changed));
  assert.throws(() => loadPaper('full-mock-1', 1, { root: directory }), /digest mismatch/);
  fs.writeFileSync(file, original);
  const audio = paper.questions.find(candidate => candidate.audio).audio;
  const audioFile = path.join(directory, audio.path), bytes = fs.readFileSync(audioFile), altered = Buffer.from(bytes);
  altered[altered.length - 10] ^= 1; fs.writeFileSync(audioFile, altered);
  assert.throws(() => loadPaper('full-mock-1', 1, { root: directory }), /audio-integrity|Asset drift/);
  fs.rmSync(audioFile);
  assert.throws(() => loadPaper('full-mock-1', 1, { root: directory }), /audio-missing|Missing paper asset/);
});

test('Changing live authoring data cannot rewrite a saved paper', () => {
  const { items } = require('../content/full-mock/original-items');
  const old = items[0].text, expected = digest(paper);
  try { items[0].text = 'An edited live authoring question.'; assert.equal(digest(loadPaper('full-mock-1', 1)), expected); }
  finally { items[0].text = old; }
  assert.equal(definition().length, 65);
  assert.equal(candidates().length, 65);
});

test('Select Missing Word ends in a real 1 kHz cue rather than a spoken answer', () => {
  const candidate = paper.questions.find(candidate => candidate.question.type === 'smw');
  assert.equal(candidate.audio.entry.endCue, true);
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(root, candidate.audio.path), '-f', 's16le', '-ac', '1', '-ar', '24000', '-'], { maxBuffer: 8 * 1024 * 1024 });
  const sampleCount = 3600, start = Math.floor(pcm.length / 2) - 6000;
  let sine = 0, cosine = 0, energy = 0;
  for (let index = 0; index < sampleCount; index++) {
    const value = pcm.readInt16LE((start + index) * 2), phase = 2 * Math.PI * 1000 * index / 24000;
    sine += value * Math.sin(phase); cosine += value * Math.cos(phase); energy += value * value;
  }
  const tonalEnergyRatio = 2 * (sine * sine + cosine * cosine) / (sampleCount * energy);
  assert(tonalEnergyRatio > 0.7, 'Expected a measurable 1 kHz end cue, ratio=' + tonalEnergyRatio);
});
