'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { loadPaper } = require('../full-mock/paper');
const { installFullMock } = require('../full-mock/api');
const { createStore } = require('../full-mock/store');
const speech = type => ['intro', 'ra', 'rs', 'di', 'rl', 'asq', 'sgd', 'rts'].includes(type);
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'full-mock-api-')), app = express(); app.use(express.json());
  let now = 1000000;
  const roles = { alice: 'admin', bob: 'admin', student: 'user', mahabir1:'user' };
  const service = installFullMock(app, { directory, verifyToken: token => roles[token] ? token : null, getAccount: async uid => ({ role: roles[uid] }), now: () => now, ...options });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { service.stop(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port + '/api/full-mocks';
  let control;
  async function request(route, body, { user = 'alice', method, raw = false, headers = {} } = {}) {
    const response = await fetch(base + route, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { 'x-session-token': user,
      ...(control ? { 'x-full-mock-control': control.controlToken } : {}), ...(body === undefined ? {} : { 'Content-Type': raw ? 'audio/webm' : 'application/json' }), ...headers }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  async function start() {
    const result = await request('/attempts', { id: randomUUID(), paperId: 'full-mock-1', checks: { microphone: true, playback: true } });
    assert.equal(result.status, 200);
    control = { pageId: randomUUID(), controlToken: randomUUID(), recoveryToken: randomUUID() };
    const claimed = await request('/attempts/' + result.body.id + '/claim', control); assert.equal(claimed.status, 200); return claimed.body;
  }
  async function until(a, type) { while (a.question?.type !== type) { const r = await request('/attempts/' + a.id + '/next', { itemToken: a.current.token, skip: true }); assert.equal(r.status, 200); a = r.body; } return a; }
  return { directory, roles, service, request, start, until, time: value => { now = value; }, now: () => now };
}
test('Only authorised previews start; accounts, draft media and future questions remain isolated', async t => {
  const f = await fixture(t), a = await f.start();
  assert.equal((await f.request('/catalog', undefined, { user: 'student' })).body.available, false);
  assert.equal((await f.request('/attempts', { id: randomUUID(), paperId: 'full-mock-1', checks: { microphone: true, playback: true } }, { user: 'student' })).status, 403);
  assert.equal((await f.request('/attempts/' + a.id, undefined, { user: 'bob' })).status, 404);
  assert.equal((await f.request('/attempts/' + a.id, undefined, { user: '' })).status, 401);
  assert.equal(a.responses, undefined); assert.equal(a.paper, undefined); assert.equal(a.question.acceptedAnswers, undefined);
  const future = loadPaper().questions.find(candidate => candidate.audio).audio.entry.audioSha256;
  assert.equal((await f.request('/attempts/' + a.id + '/media/' + future)).status, 404);
  f.roles.alice = 'user'; assert.equal((await f.request('/attempts/' + a.id)).status, 403);
  assert.deepEqual((await f.request('/attempts')).body, []);
});
test('A configured ordinary account starts an owned preview while other students stay blocked', async t => {
  const f = await fixture(t,{canPreview:require('../full-mock/access').createPreviewAccess({users:'mahabir1'})});
  const catalog = await f.request('/catalog',undefined,{user:'mahabir1'});
  assert.equal(catalog.body.available,true); assert.equal(catalog.body.preview,true); assert.equal(catalog.body.papers[0].questionCount,65);
  const body = {id:randomUUID(),paperId:'full-mock-1',checks:{microphone:true,playback:true}};
  const started = await f.request('/attempts',body,{user:'mahabir1'}); assert.equal(started.status,200);
  assert.equal((await f.service.store.get('mahabir1',started.body.id)).state.preview,true);
  assert.equal((await f.request('/attempts/'+started.body.id,undefined,{user:'student'})).status,404);
  assert.equal((await f.request('/attempts',body,{user:'student'})).status,403);
  assert.equal((await f.request('/catalog',undefined,{user:'student'})).body.available,false);
  assert.equal(f.roles.mahabir1,'user');
});
test('Everyone mode exposes Full Mock to signed-in students and keeps accounts and recordings private', async t => {
  const f = await fixture(t,{canPreview:require('../full-mock/access').createPreviewAccess({all:true}),
    getAccount:async uid => ({username:uid,role:'user',blocked:uid === 'student'})});
  for (const user of ['mahabir1','alice']) {
    assert.equal((await f.request('/catalog',undefined,{user})).body.available,true);
    const started = await f.request('/attempts',{id:randomUUID(),paperId:'full-mock-1',checks:{microphone:true,playback:true}},{user});
    assert.equal(started.status,200);
    assert.equal((await f.request('/attempts/'+started.body.id,undefined,{user:user === 'alice' ? 'mahabir1' : 'alice'})).status,404);
  }
  assert.equal((await f.request('/catalog',undefined,{user:'student'})).status,401);
  assert.equal((await f.request('/catalog',undefined,{user:''})).status,401);
});
test('Concurrent starts resume one attempt; handoff rejects a stale page and restart preserves clocks', async t => {
  const f = await fixture(t), a = await f.start(), deadline = a.current.endsAt;
  const starts = await Promise.all([1, 2, 3].map(() => f.request('/attempts', { id: randomUUID(), paperId: 'full-mock-1', checks: { microphone: true, playback: true } })));
  assert(starts.every(result => result.status === 200 && result.body.id === a.id));
  const old = await f.service.store.get('alice', a.id), storedControl = old.state.control;
  const conflict = await f.request('/attempts/' + a.id + '/claim', { pageId: randomUUID(), controlToken: randomUUID(), recoveryToken: randomUUID() }); assert.equal(conflict.status, 409);
  const restarted = createStore({ directory: f.directory });
  assert.equal((await restarted.get('alice', a.id)).state.current.endsAt, deadline);
  assert.equal((await restarted.get('alice', a.id)).state.control.hash, storedControl.hash);
});
test('Draft revisions are ordered and a submitted answer cannot be overwritten by retries or recovered text', async t => {
  const f = await fixture(t); let a = await f.until(await f.start(), 'swt'); const token = a.current.token, index = a.index;
  assert.equal((await f.request('/attempts/' + a.id + '/draft', { itemToken: token, sequence: 3, answer: ['Newest answer.'] })).status, 200);
  const older = await f.request('/attempts/' + a.id + '/draft', { itemToken: token, sequence: 1, answer: ['Old answer.'] }); assert.deepEqual(older.body.draft, ['Newest answer.']);
  a = (await f.request('/attempts/' + a.id + '/next', { itemToken: token })).body;
  assert.equal((await f.request('/attempts/' + a.id + '/next', { itemToken: token })).body.index, a.index);
  assert.equal((await f.request('/attempts/' + a.id + '/draft', { itemToken: token, sequence: 4, answer: ['Late answer.'] })).status, 409);
  assert.equal((await f.request('/attempts/' + a.id + '/recover', { itemToken: token, sequence: 4, answer: ['Late answer.'] })).status, 200);
  const saved = (await f.service.store.get('alice', a.id)).state;
  assert.deepEqual(saved.responses[index].answer, ['Newest answer.']); assert.deepEqual(saved.recoveries[0].answer, ['Late answer.']);
});
test('Chunk uploads survive duplicates and finalisation, while changed bytes and early uploads are rejected', async t => {
  const f = await fixture(t); let a = await f.start(); const token = a.current.token, permit = a.recordingPermit;
  const segment = { itemToken: token, segmentId: permit.id, segmentToken: permit.token, mime: 'audio/webm' };
  assert.equal((await f.request('/attempts/' + a.id + '/segments', segment)).status, 200);
  const headers = { 'x-full-mock-item': token, 'x-full-mock-segment': permit.token }, route = '/attempts/' + a.id + '/segments/' + permit.id;
  assert.equal((await f.request(route + '/0', Buffer.alloc(100, 1), { method: 'PUT', raw: true, headers })).status, 409);
  const oversized = await f.request(route + '/0', Buffer.alloc(513 * 1024), { method: 'PUT', raw: true, headers });
  assert.equal(oversized.status, 413); assert.match(oversized.body.error, /too large/);
  f.time(a.current.responseAt + 100);
  for (let attempt = 0; attempt < 2; attempt++) assert.equal((await f.request(route + '/0', Buffer.alloc(100, 1), { method: 'PUT', raw: true, headers })).status, 200);
  assert.equal((await f.request(route + '/0', Buffer.alloc(100, 2), { method: 'PUT', raw: true, headers })).status, 409);
  assert.equal((await f.request(route + '/finish', { itemToken: token, segmentToken: permit.token, chunks: 2 })).status, 409);
  assert.equal((await f.request(route + '/finish', { itemToken: token, segmentToken: permit.token, chunks: 1 })).status, 200);
  a = (await f.request('/attempts/' + a.id + '/next', { itemToken: token })).body;
  assert.equal((await f.service.store.get('alice', a.id)).state.responses[0].status, 'saved');
  assert.equal((await f.request(route + '/finish', { itemToken: token, segmentToken: permit.token, chunks: 1 })).status, 200);
});
test('All 66 items submit forward-only, with every task form saved and no invented scores', async t => {
  const f = await fixture(t); let a = await f.start(); const paper = loadPaper();
  const seen = new Set();
  while (a.status === 'active') {
    const token = a.current.token, q = a.index ? paper.questions[a.index - 1].question : { type: 'intro' }; seen.add(q.type);
    if (!speech(q.type)) {
      const answer = ['swt', 'essay', 'sst', 'wfd'].includes(q.type) ? [q.sample] : q.answers || [q.answer];
      const saved = await f.request('/attempts/' + a.id + '/draft', { itemToken: token, sequence: 0, answer }); assert.equal(saved.status, 200, q.type);
    }
    const result = await f.request('/attempts/' + a.id + '/next', { itemToken: token, skip: speech(q.type) }); assert.equal(result.status, 200); a = result.body;
  }
  assert.equal(seen.size, 23); assert.equal(a.completedCount, 66); assert.equal(a.assessmentStatus, 'not-enabled'); assert.equal(a.overall, undefined);
  assert.equal(a.question, undefined);
  const saved = await f.service.store.get('alice', a.id); assert(saved.state.responses.every(response => response.sealed));
  assert.equal((await f.request('/attempts/' + a.id + '/draft', { itemToken: saved.state.responses[1].token, sequence: 999, answer: ['changed'] })).status, 409);
});
test('A background reconciliation submits an expired closed-browser attempt without a client clock', async t => {
  const f = await fixture(t), a = await f.start(); f.time(f.now() + 8 * 60 * 60 * 1000);
  await f.service.reconcileAll();
  const saved = await f.service.store.get('alice', a.id); assert.equal(saved.state.status, 'submitted'); assert.equal(saved.state.responses.length, 66);
});
test('Independent filesystem store instances use atomic revisions without losing concurrent writes', async t => {
  const f = await fixture(t), a = await f.start(), other = createStore({ directory: f.directory });
  await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? other : f.service.store).update('alice', a.id, async state => { await new Promise(resolve => setImmediate(resolve)); state.counter = (state.counter || 0) + 1; return state; })));
  assert.equal((await other.get('alice', a.id)).state.counter, 12);
});
