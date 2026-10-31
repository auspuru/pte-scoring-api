'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { loadPaper, digest, questionForPlayer, validatePaper } = require('../full-mock/paper');
const { duplicates, hash } = require('../full-mock/audit');
const adapters = require('../full-mock/adapters');
const assessment = require('../full-mock/assessment');
const session = require('../full-mock/session');
const { createStore } = require('../full-mock/store');
const { inputHash } = require('../full-mock/aggregation');
const writing = require('../content/writing-predictions-sep-2026');
const reading = require('../public/reading-predictions-sep-2026');
const speaking = require('../content/speaking-bank');
const previous = loadPaper('full-mock-1', 1), paper = loadPaper();
const root = path.resolve(__dirname, '..');
const changedTypes = new Set(['ra', 'rs', 'di', 'swt', 'essay', 'dropdown', 'wordbank', 'sst', 'wfd']);

test('Question selection leaves every native grader, model, weight, timing, API and report source unchanged', () => {
  const before = require('../content/full-mock/question-content-compatible-sources.json');
  const after = require('../full-mock/audit').scoringSnapshot(root);
  assert.equal(digest(before), '97cebe2ecb2d51a2da15d0aea1004dbd33d7ab1c79ded0174afbc38893fbb458');
  assert.deepEqual(Object.keys(before.files), Object.keys(after.files));
  for (const file of Object.keys(before.files)) {
    if (!['full-mock/paper.js', 'full-mock/assessment.js'].includes(file)) assert.deepEqual(after.files[file], before.files[file], file);
  }
});

test('New Full Mocks select predictions while the original paper and exam flow remain intact', () => {
  assert.equal(paper.version, 2);
  assert.equal(digest(previous), 'f1dfe1045d4c657ed3a03c428ca3953f91dc706ff53281598b697a7ce84de173');
  assert.equal(paper.questions.length, 65);
  assert.deepEqual(paper.clockPolicy, previous.clockPolicy);
  assert.deepEqual(paper.introduction, previous.introduction);
  assert.equal(paper.title, previous.title);
  assert.equal(paper.status, previous.status);
  assert.equal(paper.editorial.studentReleaseApproved, previous.editorial.studentReleaseApproved);
  let replaced = 0;
  for (let i = 0; i < paper.questions.length; i++) {
    const candidate = paper.questions[i], before = previous.questions[i], q = candidate.question;
    assert.equal(candidate.id, before.id);
    for (const key of ['id', 'type', 'instruction', 'preparation', 'seconds', 'minutes', 'timeGroup', 'playbackDelaySeconds', 'playOnce', 'startCueMs', 'silenceTimeoutSeconds']) {
      assert.deepEqual(q[key], before.question[key], candidate.id + ': ' + key);
    }
    if (changedTypes.has(q.type)) { replaced++; assert.equal(q.contentOrigin.kind, 'prediction'); }
    else assert.deepEqual(candidate, before);
  }
  assert.equal(replaced, 37);
  assert.deepEqual(validatePaper(paper), []);
  assert.deepEqual(duplicates(paper.questions), []);
});

test('All Writing stimuli and references come from the existing prediction bank', () => {
  const expected = ['pred26-user-swt-15', 'pred26-user-swt-16', 'writing-prediction-essay-1', 'pred26-sst-01', 'pred26-wfd-12', 'pred26-wfd-13', 'pred26-wfd-14'];
  const candidates = paper.questions.filter(c => ['swt', 'essay', 'sst', 'wfd'].includes(c.question.type));
  assert.deepEqual(candidates.map(c => c.question.sourceId), expected);
  for (const { question: q } of candidates) {
    const source = q.type === 'essay' ? require('../content/writing-lab.json').predictionEssays[0] : writing[q.type].find(s => s.id === q.sourceId);
    for (const key of ['title', 'text', 'keyPoints']) if (source[key] !== undefined) assert.deepEqual(q[key], source[key]);
    assert.equal(q.sample, q.type === 'wfd' ? source.text : source.sample);
    assert.equal(q.contentOrigin.sourceFingerprint, digest(source));
    if (q.type === 'swt') assert(q.text.trim().split(/\s+/u).length <= 300);
  }
});

test('Cross-task prediction excerpts and sentences retain honest source attribution', () => {
  for (const { question: q } of paper.questions.filter(c => ['ra', 'rs'].includes(c.question.type))) {
    const sourceType = q.type === 'ra' ? 'swt' : 'wfd';
    const source = writing[sourceType].find(s => s.id === q.sourceId);
    assert(source);
    assert.equal(q.predictionSource.task, sourceType);
    assert.equal(q.predictionSource.targetTask, q.type);
    assert.equal(q.predictionSource.sourceContentStatus, source.predictionSource.contentStatus);
    assert(q.contentOrigin.adaptation);
    if (q.type === 'ra') {
      assert(source.text.startsWith(q.text));
      assert(q.text.trim().split(/\s+/u).length <= 60);
      assert.match(q.text, /[.!?]["”’']?$/u);
    } else assert.equal(q.text, source.text);
    assert.equal(q.sample, q.text);
  }
});

test('Prediction keys, image mappings and recordings stay bound to their displayed stimuli', () => {
  for (const candidate of paper.questions.filter(c => changedTypes.has(c.question.type))) {
    const q = candidate.question;
    if (['dropdown', 'wordbank'].includes(q.type)) {
      const source = reading[q.type].find(s => s.id === q.sourceId);
      assert.equal(q.passage, source.passage);
      assert.deepEqual(q.answers, source.answers);
      if (q.type === 'dropdown') q.options.forEach((options, i) => assert.deepEqual([...options].sort(), [...source.options[i]].sort()));
      else assert.deepEqual([...q.bank].sort(), [...source.bank].sort());
      const grade = adapters.objective(q, q.answers);
      assert.equal(grade.total, grade.maximum);
    }
    if (candidate.audio) {
      const original = require('../content/writing-audio/manifest.json')[q.sourceId];
      assert.equal(candidate.audio.entry.audioSha256, original.audioSha256);
      assert.equal(candidate.audio.entry.textSha256, hash(q.text));
      assert.equal(hash(fs.readFileSync(path.join(root, candidate.audio.path))), original.audioSha256);
    }
    if (candidate.image) {
      const source = speaking.questions.find(s => s.id === q.sourceId);
      assert.deepEqual(q.imageReference, source.imageReference);
      assert.deepEqual(q.facts, source.facts);
      assert.equal(candidate.image.sha256, source.imageReference.source.sha256);
      assert(fs.readFileSync(path.join(root, candidate.image.path)).equals(fs.readFileSync(path.join(root, 'public', source.imageUrl))));
    }
    const view = questionForPlayer(candidate), json = JSON.stringify(view);
    for (const key of ['answers', 'sample', 'facts', 'keyPoints', 'sourceId', 'predictionSource', 'contentOrigin', 'imageReference', 'path']) assert(!Object.hasOwn(view, key), key);
    assert(!json.includes('content/full-mock/'));
  }
  const positions = paper.questions.filter(c => c.question.type === 'dropdown').flatMap(({ question: q }) => q.answers.map((a, i) => q.options[i].indexOf(a)));
  assert(new Set(positions).size > 1);
});

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'full-mock-prediction-rollover-'));
  const store = createStore({ directory }), calls = [], engine = assessment.createEngine({ store, adapters: { assess: async q => { calls.push(structuredClone(q)); return adapters.result(q, adapters.maxima(q)); } } });
  t.after(async () => { await engine.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { store, engine, calls };
}

test('A pending original-paper attempt finishes with its saved questions and marks after the content rollover', async t => {
  const { store, engine, calls } = await fixture(t), id = randomUUID();
  const original = { ...structuredClone(assessment.snapshot(assessment.configuration(), undefined, previous)), scoringSources: require('../content/full-mock/question-content-compatible-sources.json') };
  await store.create('alice', id, previous, (key, at) => session.create(key, previous, at, { preview: true, assessmentSnapshot: original }), 1000);
  const first = previous.questions[0]; let savedMark;
  await store.update('alice', id, state => {
    session.end(state, previous, 1000);
    savedMark = { status: 'assessed', inputHash: inputHash(state.responses[1]), snapshotHash: digest(original), result: adapters.result(first.question, adapters.maxima(first.question)), assessedAt: 900 };
    state.assessment.items[first.id] = savedMark;
    return state;
  });
  await engine.request('alice', id); await engine.drain();
  const record = await store.get('alice', id);
  assert.equal((await engine.results('alice', id)).ready, true);
  assert.equal(calls.length, 64);
  assert.deepEqual(record.paper, previous);
  assert.deepEqual(record.state.assessment.snapshot, original);
  assert.deepEqual(record.state.assessment.items[first.id], savedMark);
  for (const q of calls) assert.deepEqual(q, previous.questions.find(c => c.question.id === q.id).question);
  await engine.request('alice', id, { retry: true }); await engine.drain();
  assert.equal(calls.length, 64);
  const nextId = randomUUID();
  await store.create('alice', nextId, paper, (key, at) => session.create(key, paper, at, { preview: true, assessmentSnapshot: engine.snapshot }), 2000);
  await store.update('alice', nextId, state => { session.end(state, paper, 2000); return state; });
  await engine.request('alice', nextId); await engine.drain();
  assert.equal((await engine.results('alice', nextId)).ready, true);
  for (const q of calls.slice(64)) assert.deepEqual(q, paper.questions.find(c => c.question.id === q.id).question);
  assert.deepEqual(engine.snapshot.configuration, original.configuration);
  assert.deepEqual(engine.snapshot.weighting, original.weighting);
});

for (const field of ['native-source', 'model', 'maxima', 'paper']) test('Content rollover still rejects changed ' + field + ' pins', async t => {
  const { store, engine, calls } = await fixture(t), id = randomUUID();
  const saved = { ...structuredClone(assessment.snapshot(assessment.configuration(), undefined, previous)), scoringSources: structuredClone(require('../content/full-mock/question-content-compatible-sources.json')) };
  if (field === 'native-source') saved.scoringSources.files['speaking-scoring.js'].sha256 = '0'.repeat(64);
  if (field === 'model') saved.configuration.swt.model = 'different-model';
  if (field === 'maxima') saved.nativeMaxima[previous.questions[0].id].content++;
  if (field === 'paper') saved.paperHash = '0'.repeat(64);
  await store.create('alice', id, previous, (key, at) => session.create(key, previous, at, { preview: true }), 1000);
  await store.update('alice', id, state => { session.end(state, previous, 1000); state.assessment = assessment.stateFor(saved); return state; });
  await assert.rejects(engine.request('alice', id), /different assessment version/);
  assert.equal(calls.length, 0);
});
