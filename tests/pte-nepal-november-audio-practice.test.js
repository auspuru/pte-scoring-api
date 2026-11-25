'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { installWritingLab, predictionMocks } = require('../writing-lab');
const { inspectMp3 } = require('../scripts/validate-writing-audio');
const { formFor } = require('../writing-lab-scoring');
const studio = require('../public/listening-studio');

const batch = require('../content/additional-practice-questions.json')
  .filter(q => /^(sst|lfi|wfd)-pte-nepal-20261122-\d{3}$/.test(q.id));
const publicDirectory = path.join(__dirname, '..', 'public');
const hash = value => createHash('sha256').update(value).digest('hex');
const types = { lfi: ['listeningPractice', 33], wfd: ['dictation', 153] };

test('November listening additions have matching playable assets, transcripts and practice-only keys', async () => {
  assert.equal(new Set(batch.map(q => q.id)).size, Object.values(types).reduce((total, [, count]) => total + count, 0));
  for (const [type, [, count]] of Object.entries(types)) {
    assert.equal(batch.filter(q => q.type === type).length, count);
  }
  const mockIds = new Set(predictionMocks.flatMap(m => m.questions.map(q => q.id)));
  for (const q of batch) {
    assert(!mockIds.has(q.id), q.id);
    assert.equal(q.audio.textSha256, hash(q.text), q.id);
    if (q.narrationText) {
      assert.equal(q.audio.narrationTextSha256, hash(q.narrationText), q.id);
      assert.equal(q.narrationText.replace(/\s/g, ''), q.text.replace(/\s/g, ''), q.id);
    }
    assert.equal(q.audioUrl, '/assets/pte-nepal-writing-listening-20261122/' + q.id + '-' + q.audio.sha256.slice(0, 12) + '.mp3');
    const recording = await fs.readFile(path.join(publicDirectory, q.audioUrl));
    assert.equal(q.audio.bytes, recording.length, q.id);
    assert.equal(q.audio.sha256, hash(recording), q.id);
    assert(inspectMp3(recording).valid, q.id);
    const words = q.text.trim().split(/\s+/).length;
    const [minimum, maximum] = q.type === 'sst' ? [60, Math.max(90, words * 60 / 180 + 2)]
      : q.type === 'lfi' ? [20, Math.max(60, words * 60 / 165 + 1)] : [3, 8];
    assert(q.audio.seconds >= minimum && q.audio.seconds <= maximum,
      q.id + ' duration ' + q.audio.seconds + ' outside ' + minimum + '–' + maximum);
    if (q.type === 'sst') {
      assert.equal(formFor('sst', q.sample).score, 2, q.id);
      assert(q.keyPoints.length >= 3, q.id);
    }
    if (q.type === 'wfd') assert.equal(q.sample, q.text, q.id);
    if (q.type === 'lfi') {
      assert.deepEqual([...q.passage.matchAll(/\[\[(\d+)\]\]/g)].map(m => Number(m[1])),
        q.answers.map((_, i) => i + 1), q.id);
      assert.equal(q.passage.replace(/\[\[(\d+)\]\]/g, (_, n) => q.answers[n - 1]), q.text, q.id);
      assert(q.answers.every(answer => /^\S+$/.test(answer)), q.id);
    }
  }
});

test('November listening additions are labelled NEW and use their verified recordings in saved individual attempts', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'november-pte-listening-'));
  const app = express();
  app.use(express.json(), express.static(publicDirectory));
  const service = installWritingLab(app, {
    directory,
    verifyToken: key => key === 'november-tester' ? key : null,
    getAccount: async () => ({}),
    callModel: async () => { throw Error('External assessment disabled in test'); }
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await service.waitForJobs();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  async function request(route, body) {
    const response = await fetch(base + '/api/writing-lab' + route, {
      headers: { 'X-Session-Token': 'november-tester', 'Content-Type': 'application/json' },
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {})
    });
    assert.equal(response.status, 200, route);
    return response.json();
  }

  const catalog = await request('/catalog');
  for (const [type, [collection, count]] of Object.entries(types)) {
    const questions = batch.filter(q => q.type === type);
    const ids = new Set(questions.map(q => q.id));
    const items = catalog[collection].filter(q => ids.has(q.id));
    assert.deepEqual(items.map(q => q.id), questions.map(q => q.id));
    assert(items.every(q => q.newInCatalogue && !q.text && !q.sample && !q.answers));
    assert.equal((studio.rows({ items }).match(/aria-label="Question status: NEW"/g) || []).length, count);
    if (type !== 'lfi') assert.deepEqual(items.map(q => q.audioUrl), questions.map(q => q.audioUrl));

    const question = questions[0];
    const id = randomUUID();
    const ready = await request('/attempts', { id, testId: question.id });
    assert.equal(ready.kind, type);
    assert.equal(ready.questions[0].audioUrl, question.audioUrl);
    assert.equal(ready.questions[0].text, '');
    const audio = await fetch(base + ready.questions[0].audioUrl, { headers: { Range: 'bytes=0-127' } });
    assert.equal(audio.status, 206);
    assert.equal((await audio.arrayBuffer()).byteLength, 128);
    const active = await request('/attempts/' + id + '/begin', {});
    assert.equal(active.deadline - active.startedAt, question.minutes * 60_000);
    const answer = type === 'lfi' ? JSON.stringify(question.answers) : question.sample;
    const submitted = await request('/attempts/' + id + '/answer', {
      index: 0, text: answer, revision: 1, next: true, playback: { position: question.audio.seconds, finished: true }
    });
    assert.equal(submitted.status, 'submitted');
    assert.equal(submitted.questions[0].text, question.text);
    assert.equal((await request('/attempts/' + id)).answers[0], answer);
    if (type !== 'sst') {
      const scored = await request('/attempts/' + id + '/score/0', {});
      assert.equal(scored.total, scored.maximum);
    }
  }
});
