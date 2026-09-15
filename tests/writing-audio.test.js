'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createNarration, installNarration } = require('../writing-lab-audio');
const { validateWritingAudio } = require('../scripts/validate-writing-audio');
const bank = require('../content/writing-lab.json');
const directory = path.join(__dirname, '..', 'content', 'writing-audio');
const questions = [...bank.spoken, ...bank.mocks.flatMap(m => m.questions)].filter(q => ['sst', 'wfd'].includes(q.type));

test('Every current lecture and dictation has a verified recording with the correct content and duration', () => {
  assert.equal(validateWritingAudio(), 23);
});

test('A cold cache and failed narration provider cannot prevent bundled audio playback', async t => {
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'bundled-audio-'));
  t.after(() => fs.rm(cache, { recursive: true, force: true }));
  const narration = createNarration(cache, () => { throw Error('Provider quota exhausted'); }, { bundledDirectory: directory });
  for (const q of questions) assert.equal(await narration.get(q.id), path.join(directory, q.id + '.mp3'));
  assert.deepEqual(await fs.readdir(cache), []);
  await assert.rejects(narration.get('../../private'), { status: 404 });
});

test('The student audio endpoint serves real MP3 data and byte ranges for loading and resuming', async t => {
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-http-'));
  const app = express();
  installNarration(app, cache);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(cache, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  for (const q of questions) {
    const bytes = await fs.readFile(path.join(directory, q.id + '.mp3'));
    const url = base + '/writing-audio/' + q.id + '.mp3?v=' + bank.version;
    const full = await fetch(url);
    assert.equal(full.status, 200);
    assert.match(full.headers.get('content-type'), /audio\/mpeg/);
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);
    const partial = await fetch(url, { headers: { Range: 'bytes=1000-1999' } });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('content-range'), 'bytes 1000-1999/' + bytes.length);
    assert.deepEqual(Buffer.from(await partial.arrayBuffer()), bytes.subarray(1000, 2000));
  }
  // Loading media and seeking can exceed 30 requests from a shared classroom IP.
  for (let i=0; i<8; i++) {
    const head = await fetch(base + '/writing-audio/' + questions[0].id + '.mp3', { method:'HEAD' });
    assert.equal(head.status, 200);
  }
  const missing = await fetch(base + '/writing-audio/missing.mp3');
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('cache-control'), 'no-store');
});
