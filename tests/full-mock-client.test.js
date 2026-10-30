'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createHash } = require('node:crypto');
const express = require('express');
const { parseHTML } = require('linkedom');
const { IDBFactory } = require('fake-indexeddb');
const { loadPaper, questionForPlayer } = require('../full-mock/paper');
const session = require('../full-mock/session');
const { installFullMock } = require('../full-mock/api');
const { createController, createPendingStore, renderQuestion } = require('../public/full-mock-client');
const paper = loadPaper();
const settle = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(check) { const deadline = Date.now() + 5000; do { if (await check()) return; await settle(); } while (Date.now() < deadline); assert.fail('Timed out waiting for the player'); }
const storage = () => { const values = new Map(); return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };

// A real DOM, IndexedDB transactions and authenticated HTTP routes; only browser
// hardware and scheduling are substituted. Hardware/mobile QA remains Phase 6.
async function fixture(t, type = 'intro') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'full-mock-client-')), app = express(); app.use(express.json());
  let now = 1000000, owner = 'alice', offline = false, closing = false, interceptor, deferStop = false, metadataReady = true;
  const service = installFullMock(app, { directory, verifyToken: token => ['alice', 'bob'].includes(token) ? token : null,
    getAccount: async () => ({ role: 'admin' }), now: () => now });
  const id = randomUUID();
  await service.store.create('alice', id, paper, (key, at) => session.create(key, paper, at, { preview: true }), now);
  if (type !== 'intro') await service.store.update('alice', id, state => { while (session.item(paper, state.index).question.type !== type) session.next(state, paper, { itemToken: state.current.token, skip: true }, now); return state; });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const { document } = parseHTML('<html><body><section id="fullMockPane"></section></body></html>');
  const intervals = new Map(), timeouts = new Map(), recorders = [], tracks = [], audio = [], requests = [], flights = new Set();
  let timerId = 0;
  class Recorder {
    static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
    constructor(stream, options) { this.stream = stream; this.mimeType = options?.mimeType || 'audio/webm'; this.state = 'inactive'; recorders.push(this); }
    start() { this.state = 'recording'; }
    emit(size = 100) { this.ondataavailable?.({ data: new Blob([Buffer.alloc(size, 1)], { type: this.mimeType }) }); }
    deliver(size = 100) { this.emit(size); this.onstop?.(); }
    stop() { this.state = 'inactive'; if (!deferStop) queueMicrotask(() => this.deliver()); }
  }
  class Audio {
    constructor() { this.readyState = metadataReady ? 1 : 0; this.currentTime = 0; this.plays = []; audio.push(this); }
    async play() { this.plays.push({ src: this.src, time: this.currentTime }); }
    pause() {} load() {} removeAttribute() { this.src = ''; }
  }
  class AudioContext {
    async resume() {} async close() {}
    createAnalyser() { return { fftSize: 512, getByteTimeDomainData: values => values.fill(140) }; }
    createMediaStreamSource() { return { connect() {} }; }
    createOscillator() { return { frequency: {}, connect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: {}, connect() {} }; }
  }
  const env = { document, indexedDB: new IDBFactory(), sessionStorage: storage(), localStorage: storage(), crypto: { randomUUID }, Blob, URL,
    MediaRecorder: Recorder, Audio, AudioContext, performance: { now: () => now }, confirm: () => true,
    navigator: { mediaDevices: { getUserMedia: async () => { const track = { readyState: 'live', stop() { this.readyState = 'ended'; } }; tracks.push(track); return { getTracks: () => [track], getAudioTracks: () => [track] }; } } },
    setInterval: fn => { const key = ++timerId; intervals.set(key, fn); return key; }, clearInterval: key => intervals.delete(key),
    setTimeout: (fn, delay) => { const key = ++timerId; timeouts.set(key, { fn, at: now + delay }); return key; }, clearTimeout: key => timeouts.delete(key),
    addEventListener() {}, PortalExamMode: { set() {}, prepare:async () => true },
    fetch: async (route, init = {}) => {
      requests.push({ route, init, owner }); if (offline || closing) throw Error('Offline');
      const send = async () => { const task = fetch(base + route, init); flights.add(task); try { return await task; } finally { flights.delete(task); } };
      return interceptor ? interceptor(route, init, send) : send();
    } };
  env.sessionStorage.setItem('pte_session_token', owner);
  const pending = createPendingStore(env), client = createController(env, { pending, getUserId: () => owner });
  t.after(async () => { closing = true; client.reset(); await Promise.allSettled([...flights]); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 10 }); });
  const click = async selector => { const target = document.querySelector(selector); assert(target, 'Missing ' + selector); await document.getElementById('fullMockPane').onclick({ target }); };
  async function step(ms) { now += ms; for (const fn of [...intervals.values()]) fn(); for (const [key, value] of [...timeouts]) if (value.at <= now) { timeouts.delete(key); value.fn(); } await settle(); }
  async function resume() { await client.open({ attemptId: id }); await click('[data-fm="resume"]'); }
  return { id, env, document, client, pending, click, step, resume, recorders, tracks, audio, requests, service,
    playSample: () => { const sample = document.querySelector('#fm-sample audio'); assert(sample); sample.onplay(); sample.onended(); },
    state: async () => (await service.store.get('alice', id)).state,
    input: text => { const target = document.getElementById('fm-text'); target.value = text; document.getElementById('fullMockPane').oninput({ target }); },
    offline: value => { offline = value; }, intercept: value => { interceptor = value; }, defer: value => { deferStop = value; },
    metadata: value => { metadataReady = value; }, account: value => { owner = value; env.sessionStorage.setItem('pte_session_token', value); }, now: () => now };
}

test('All 22 task forms render usable controls from the redacted player projection', () => {
  const seen = new Set();
  for (const candidate of paper.questions) {
    const q = questionForPlayer(candidate); if (seen.has(q.type)) continue; seen.add(q.type);
    const { document } = parseHTML('<div id="question">' + renderQuestion(q) + '</div>');
    assert(document.querySelector('input,textarea,select,button,meter'), q.type);
    assert.equal(document.querySelector('script'), null);
    assert.equal(q.answers, undefined); assert.equal(q.transcript, undefined); assert.equal(q.sample, undefined);
    if (q.type === 'reorder') assert.equal(document.querySelectorAll('[data-fm="down"]').length, q.items.length);
    if (q.type === 'lfi') assert(document.querySelector('[data-fm-answer]'));
    if (q.type === 'di') assert.equal(document.querySelector('img').getAttribute('width'), '730');
  }
  assert.equal(seen.size, 22);
  const { document } = parseHTML(renderQuestion({ type: 'swt', text: '<img src=x onerror=bad()>' }, ['</textarea><script>bad()</script>']));
  assert.equal(document.querySelector('script,img'), null);
});

test('Equipment check requires a recorded local sample and sound confirmation before starting', async t => {
  const f = await fixture(t); await f.client.open(); await f.click('[data-fm="setup"]');
  assert(f.document.getElementById('fm-begin').disabled);
  await f.click('[data-fm="sample"]'); await f.step(3000); await until(() => f.document.querySelector('#fm-sample audio'));
  assert(f.document.getElementById('fm-heard').disabled);
  const sample = f.document.querySelector('#fm-sample audio'); sample.onplay();
  assert(f.document.getElementById('fm-heard').disabled, 'Confirmation waits for the complete sample playback');
  sample.onended();
  const target = f.document.getElementById('fm-heard'); target.checked = true; f.document.getElementById('fullMockPane').onchange({ target });
  assert.equal(f.document.getElementById('fm-begin').disabled, false);
  await f.click('[data-fm="begin"]'); assert.match(f.document.querySelector('.fm-exam-header').textContent, /Not scored/);
  assert.equal(f.requests.filter(row => /\/attempts$/.test(row.route) && row.init.method === 'POST').length, 1);
  assert.equal(f.requests.filter(row => row.init.method === 'PUT').length, 0, 'Equipment sample must stay local');
});
test('Fullscreen is requested before an attempt starts, and cancelling it keeps the start button available', async t => {
  const f = await fixture(t); await f.client.open(); await f.click('[data-fm="setup"]');
  await f.click('[data-fm="sample"]'); await f.step(3000); await until(() => f.document.querySelector('#fm-sample audio'));
  f.playSample();
  const target=f.document.getElementById('fm-heard');target.checked=true;f.document.getElementById('fullMockPane').onchange({target});
  let calls=0;f.env.PortalExamMode.prepare=async (owner,pane,options)=>{calls++;assert.equal(owner,'full-mock');assert.equal(options.immediate,true);assert.equal(f.requests.filter(r=>r.route==='/api/full-mocks/attempts'&&r.init.method==='POST').length,0);return false;};
  await f.click('[data-fm="begin"]');assert.equal(calls,1);assert.equal(f.document.getElementById('fm-begin').disabled,false);
  assert.equal(f.requests.filter(r=>r.route==='/api/full-mocks/attempts'&&r.init.method==='POST').length,0);
});
test('Rerecording resets playback confirmation and requires sound in the new headset sample', async t => {
  const f = await fixture(t); await f.client.open(); await f.click('[data-fm="setup"]');
  await f.click('[data-fm="sample"]'); await f.step(3000); await until(() => f.document.querySelector('#fm-sample audio')); f.playSample();
  const target = f.document.getElementById('fm-heard'); target.checked = true; f.document.getElementById('fullMockPane').onchange({ target });
  assert.equal(f.document.getElementById('fm-begin').disabled, false);
  f.env.AudioContext.prototype.createAnalyser = () => ({ fftSize:512, getByteTimeDomainData: values => values.fill(128) });
  // The existing analyser belongs to the first microphone connection. Reconnect
  // to a silent device to ensure old microphone evidence cannot approve it.
  f.tracks[0].readyState = 'ended';
  await f.click('[data-fm="sample"]');
  assert.equal(target.checked, false); assert(target.disabled); assert(f.document.getElementById('fm-begin').disabled);
  await f.step(3000); await until(() => f.document.querySelector('#fm-sample audio')); f.playSample();
  target.checked = true; f.document.getElementById('fullMockPane').onchange({ target });
  assert(f.document.getElementById('fm-begin').disabled);
  assert.match(f.document.getElementById('fm-notice').textContent, /No clear sound/);
  await f.click('[data-fm="begin"]');
  assert.equal(f.requests.filter(r => r.route === '/api/full-mocks/attempts' && r.init.method === 'POST').length, 0);
});
test('A headset recording permission error can retry without starting the full mock', async t => {
  const f = await fixture(t); await f.client.open(); await f.click('[data-fm="setup"]');
  const access = f.env.navigator.mediaDevices.getUserMedia;
  f.env.navigator.mediaDevices.getUserMedia = async () => { throw Error('Microphone permission denied.'); };
  await f.click('[data-fm="sample"]'); assert.match(f.document.getElementById('fm-notice').textContent, /permission denied/);
  assert.equal(f.document.getElementById('fm-sample-button').disabled, false);
  assert(f.document.getElementById('fm-begin').disabled);
  f.env.navigator.mediaDevices.getUserMedia = access;
  await f.click('[data-fm="sample"]'); await f.step(3000); await until(() => f.document.querySelector('#fm-sample audio')); f.playSample();
  assert.equal(f.document.getElementById('fm-heard').disabled, false);
  assert.equal(f.requests.filter(r => r.init.method === 'PUT' || r.route === '/api/full-mocks/attempts' && r.init.method === 'POST').length, 0);
});
test('A failed headset sample playback cannot approve the equipment check', async t => {
  const f = await fixture(t); await f.client.open(); await f.click('[data-fm="setup"]');
  await f.click('[data-fm="sample"]'); await f.step(3000); await until(() => f.document.querySelector('#fm-sample audio'));
  const playback = f.document.querySelector('#fm-sample audio'); playback.onplay(); playback.onerror();
  assert(f.document.getElementById('fm-heard').disabled); assert(f.document.getElementById('fm-begin').disabled);
  assert.match(f.document.getElementById('fm-notice').textContent, /could not play/);
  await f.click('[data-fm="sample"]'); await f.step(3000); await until(() => f.document.querySelector('#fm-sample audio')); f.playSample();
  assert.equal(f.document.getElementById('fm-heard').disabled, false);
});
test('Back cancels a headset recording, releases the microphone and ignores late sample events', async t => {
  const f = await fixture(t); await f.client.open(); await f.click('[data-fm="setup"]');
  f.defer(true); await f.click('[data-fm="sample"]'); const sample = f.recorders[0];
  await f.click('[data-fm="reload"]'); sample.deliver(); await settle();
  assert.equal(sample.state, 'inactive'); assert.equal(f.tracks[0].readyState, 'ended');
  assert.equal(f.document.querySelector('#fm-sample audio'), null); assert(f.document.querySelector('[data-fm="setup"]'));
  assert.equal(f.requests.filter(r => r.route === '/api/full-mocks/attempts' && r.init.method === 'POST').length, 0);
});
test('Changing headset confirmation during a pending start cannot create duplicate attempts', async t => {
  const f = await fixture(t); await f.client.open(); await f.click('[data-fm="setup"]');
  await f.click('[data-fm="sample"]'); await f.step(3000); await until(() => f.document.querySelector('#fm-sample audio')); f.playSample();
  const target = f.document.getElementById('fm-heard'); target.checked = true; f.document.getElementById('fullMockPane').onchange({ target });
  let release, starts = 0;
  f.env.PortalExamMode.prepare = async () => { starts++; return new Promise(resolve => { release = () => resolve(false); }); };
  const starting = f.click('[data-fm="begin"]'); await until(() => release);
  assert(target.disabled); assert(f.document.getElementById('fm-check-back').disabled);
  target.checked = true; f.document.getElementById('fullMockPane').onchange({ target });
  await f.click('[data-fm="begin"]'); assert.equal(starts, 1);
  release(); await starting;
  assert.equal(f.document.getElementById('fm-begin').disabled, false);
  assert.equal(f.requests.filter(r => r.route === '/api/full-mocks/attempts' && r.init.method === 'POST').length, 0);
});
test('The full mock displays the prompt lead-in and the task preparation countdown separately from the start tone', async t => {
  const f = await fixture(t, 'rl'); await f.resume();
  const initial = await f.state();
  assert.match(f.document.getElementById('fm-audio-status').textContent, /Audio begins in 0:03/);
  assert.match(f.document.getElementById('fm-record-status').textContent, /Audio begins in 0:03/);
  await f.step(initial.current.promptEndsAt - f.now());
  assert.equal(f.document.getElementById('fm-record-status').textContent, 'Preparation time: 0:10');
  assert.equal(f.document.getElementById('fm-time').textContent, '0:10');
  assert.equal(f.recorders.some(r => r.state === 'recording'), false);
  await f.step(9000); assert.equal(f.document.getElementById('fm-record-status').textContent, 'Preparation time: 0:01');
  assert.equal(f.recorders.some(r => r.state === 'recording'), false);
  await f.step(1000); assert.equal(f.document.getElementById('fm-record-status').textContent, 'Get ready');
  await f.step(300); assert.equal(f.document.getElementById('fm-record-status').textContent, 'Recording');
});
test('Next and Skip advance directly without confirmation, and double clicks cannot skip a question', async t => {
  const f=await fixture(t);f.env.confirm=()=>{throw Error('Unexpected confirmation');};await f.resume();
  await f.step((await f.state()).current.responseAt-f.now());
  let release;f.intercept(async(route,init,send)=>{if(route.endsWith('/next')&&!release){await new Promise(resolve=>{release=resolve;});}return send();});
  const moving=f.click('[data-fm="next"]');await until(()=>release);await f.click('[data-fm="next"]');
  assert.equal(f.requests.filter(r=>r.route.endsWith('/next')).length,1);release();await moving;
  assert.equal((await f.state()).index,1);assert(!/preview/i.test(f.document.querySelector('.fm-exam-header').textContent));
  await f.click('[data-fm="skip"]');assert.equal((await f.state()).index,2);
});
test('The final Next submits the full mock without a confirmation popup', async t => {
  const f=await fixture(t,'wfd');await f.service.store.update('alice',f.id,state=>{while(state.index<65)session.next(state,paper,{itemToken:state.current.token,skip:true},f.now());return state;});
  f.env.confirm=()=>{throw Error('Unexpected confirmation');};await f.resume();f.input('A saved final response.');await settle();
  await f.click('[data-fm="next"]');assert.equal((await f.state()).status,'submitted');
  assert.deepEqual((await f.state()).responses[65].answer,['A saved final response.']);
});
test('Fullscreen interruption before recording preserves its prepared segment without creating an empty replacement', async t => {
  const f=await fixture(t);let locked=false,options;
  f.env.PortalExamMode.isLocked=()=>locked;
  f.env.PortalExamMode.set=(owner,enabled,pane,value)=>{if(enabled&&value)options=value;};
  await f.resume();await until(async()=>(await f.state()).responses[0].segments.length===1);await settle();
  const original=(await f.state()).responses[0].segments[0].id;
  locked=true;options.onLock();await f.step(100);locked=false;options.onResume();await f.step(100);
  await f.step((await f.state()).current.responseAt-f.now());await until(()=>f.recorders.some(r=>r.state==='recording'));
  const segments=(await f.state()).responses[0].segments;assert.equal(segments.length,1);assert.equal(segments[0].id,original);
});

test('Typing offline survives refresh and Next seals the newest revision even with an older save in flight', async t => {
  const f = await fixture(t, 'swt'); await f.resume();
  f.offline(true); f.input('Recovered from this device.'); await until(async () => (await f.pending.list('alice:')).some(row => row.value.kind === 'draft'));
  f.client.reset(); f.offline(false); await f.resume();
  await until(() => f.document.getElementById('fm-text').value === 'Recovered from this device.');
  let release, blocked = false, oldDone = false;
  f.intercept(async (route, init, send) => { if (route.endsWith('/draft') && !blocked) { blocked = true; await new Promise(resolve => { release = resolve; }); const reply = await send(); oldDone = true; return reply; } return send(); });
  f.input('An intermediate answer.'); await settle(); const sending = f.client.flush(); await until(async () => { f.client.flush(); return blocked; });
  f.input('The exact final answer.'); await settle(); await f.click('[data-fm="next"]');
  release(); await sending; await until(() => oldDone);
  const state = await f.state(), response = state.responses.find(row => row.type === 'swt');
  assert.deepEqual(response.answer, ['The exact final answer.']); assert(response.sealed);
});

test('Next advances while queued recording uploads are stalled, then saves every original chunk', async t => {
  const f = await fixture(t); await f.resume();
  await until(async () => (await f.state()).responses[0].segments.length === 1);
  await f.step((await f.state()).current.responseAt - f.now());
  const recording = f.recorders.find(row => row.state === 'recording'); assert(recording);
  f.offline(true); recording.emit(600 * 1024); recording.stop();
  await until(async () => (await f.pending.list('alice:')).some(row => row.value.kind === 'finish'));
  await f.client.flush(); await settle();
  let release, blocked = false;
  f.intercept(async (route, init, send) => {
    if (init.method === 'PUT' && !blocked) { blocked = true; await new Promise(resolve => { release = resolve; }); }
    return send();
  });
  f.offline(false); const moving = f.click('[data-fm="next"]');
  try {
    await until(() => release);
    await until(async () => (await f.state()).index === 1);
    await moving;
    assert((await f.pending.list('alice:')).some(row => row.value.kind === 'chunk'));
    assert.equal((await f.state()).responses[0].status, 'media-pending');
  } finally { release?.(); }
  await moving;
  await until(async () => { await f.client.flush(); const token = (await f.state()).responses[0].token; return (await f.pending.list('alice:')).every(row => row.value.itemToken !== token); });
  const response = (await f.state()).responses[0];
  assert.equal(response.segments[0].chunkCount, 4); assert(response.segments[0].finished);
  assert.equal(response.status, 'saved');
});

test('Delayed recorder callbacks stay with the original owner and split large final blobs into bounded chunks', async t => {
  const f = await fixture(t); await f.resume(); await until(async () => (await f.state()).responses[0].segments.length === 1);
  await f.step((await f.state()).current.responseAt - f.now()); const recording = f.recorders.find(row => row.state === 'recording'); assert(recording);
  f.offline(true); f.defer(true); f.client.reset(); f.account('bob'); f.offline(false); await f.client.open();
  recording.deliver(600 * 1024);
  await until(async () => (await f.pending.list('alice:')).filter(row => row.value.kind === 'chunk').length === 3);
  assert.equal((await f.pending.list('bob:')).length, 0);
  await f.client.flush();
  assert.equal(f.requests.filter(row => row.owner === 'bob' && row.init.method === 'PUT').length, 0);
  f.client.reset(); f.account('alice'); await f.client.open(); await f.client.flush();
  await until(async () => (await f.pending.list('alice:')).length === 0);
  const segment = (await f.state()).responses[0].segments[0]; assert.equal(segment.chunkCount, 3); assert(segment.finished);
  assert(f.requests.filter(row => row.init.method === 'PUT').every(row => row.init.body.size <= 256 * 1024));
});

test('An offline first recording uploads as review evidence after its original deadline without resetting the timer', async t => {
  const f = await fixture(t); f.offline(false); await f.resume(); await until(async () => (await f.state()).responses[0].segments.length);
  const initial = await f.state(); f.offline(true);
  await f.step(initial.current.responseAt - f.now());
  const recorder = f.recorders.find(row => row.state === 'recording'); recorder.emit(); await settle();
  await f.step(initial.current.endsAt - f.now() + 1); await settle();
  f.offline(false); await f.client.flush();
  await until(async () => (await f.pending.list('alice:')).length === 0);
  const state = await f.state(); assert.equal(state.index, 1); assert.equal(state.current.enteredAt, initial.current.endsAt);
  assert(state.responses[0].segments[0].finished); assert.equal(state.responses[0].answer, null); assert.equal(state.responses[0].status, 'needs-review');
});

test('Storage quota failure keeps in-memory drafts available until the server acknowledges them', async t => {
  const f = await fixture(t, 'swt'); await f.resume(); const put = f.pending.put;
  f.pending.put = async () => { throw Error('Quota exceeded'); }; f.offline(true); f.input('Survives a full device.'); await settle();
  assert.match(f.document.getElementById('fm-notice').textContent, /Keep this tab open/);
  f.offline(false); await f.client.flush(); await f.click('[data-fm="next"]');
  assert.deepEqual((await f.state()).responses.find(row => row.type === 'swt').answer, ['Survives a full device.']); f.pending.put = put;
});

test('Slow prompt metadata seeks the current server offset, and expired playback cannot restart', async t => {
  const f = await fixture(t, 'asq'); await f.resume();
  await until(() => f.audio[0]?.src?.startsWith('blob:'));
  f.audio[0].readyState = 0;
  const initial = await f.state(); await f.step(initial.current.promptAt - f.now());
  await until(() => typeof f.audio[0].onloadedmetadata === 'function');
  await f.step(1000); f.audio[0].onloadedmetadata(); await settle();
  const plays = f.audio[0].plays.filter(row => row.time > 0); assert.equal(plays.length, 1); assert(plays[0].time >= 1);
  await f.step(initial.current.promptEndsAt - f.now() + 1); const before = f.audio[0].plays.length;
  await f.click('[data-fm="audio"]'); assert.equal(f.audio[0].plays.length, before);
});

test('A microphone interruption exposes a user-gesture reconnect and records into a separate segment', async t => {
  const f = await fixture(t); await f.resume(); await until(async () => (await f.state()).responses[0].segments.length);
  await f.step((await f.state()).current.responseAt - f.now());
  const first = f.recorders.find(row => row.state === 'recording'); first.emit(); await settle();
  const track = f.tracks[0]; track.readyState = 'ended'; track.onended();
  assert.equal(f.document.getElementById('fm-mic-resume').hidden, false);
  await f.click('[data-fm="mic"]'); await f.step(100); await f.step(100);
  await until(async () => { await f.client.flush(); return (await f.state()).responses[0].segments.length === 2; });
  await f.step(100); assert.equal(f.tracks.length, 2); assert(f.recorders.some(row => row !== first && row.state === 'recording'));
});

test('Skipping during preparation leaves no abandoned recording or permanently blocked save queue', async t => {
  const f = await fixture(t); await f.resume(); await f.click('[data-fm="skip"]');
  const token = (await f.state()).responses[0].token;
  await until(async () => { await f.client.flush(); return (await f.pending.list('alice:')).every(row => row.value.itemToken !== token); });
  const first = (await f.state()).responses[0]; assert.equal(first.reason, 'skipped'); assert.equal(first.status, 'unanswered');
});

test('A replaced page stops recording, retains its queued audio and leaves the original deadline intact', async t => {
  const f = await fixture(t); await f.resume(); await until(async () => (await f.state()).responses[0].segments.length);
  const initial = await f.state(); await f.step(initial.current.responseAt - f.now());
  assert(f.recorders.some(row => row.state === 'recording'));
  const key = 'alice:full-mock:' + f.id + ':control', previous = JSON.parse(f.env.sessionStorage.getItem(key));
  const response = await f.env.fetch('/api/full-mocks/attempts/' + f.id + '/claim', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-token': 'alice' },
    body: JSON.stringify({ pageId: randomUUID(), controlToken: randomUUID(), recoveryToken: randomUUID(), previousRecoveryToken: previous.recoveryToken }) });
  assert.equal(response.status, 200); await f.step(100);
  await until(() => /connection was replaced/.test(f.document.getElementById('fullMockPane').textContent));
  assert(f.recorders.every(row => row.state !== 'recording')); assert.equal((await f.state()).current.endsAt, initial.current.endsAt);
});

test('A lost claim acknowledgement can reconnect immediately using its persisted recovery secret', async t => {
  const f = await fixture(t); let lost = false;
  f.intercept(async (route, init, send) => { const reply = await send(); if (route.endsWith('/claim') && !lost) { lost = true; await reply.json(); throw Error('Lost reply'); } return reply; });
  const deadline = (await f.state()).current.endsAt; await f.resume();
  assert.match(f.document.getElementById('fm-notice').textContent, /Connection interrupted/);
  await f.click('[data-fm="resume"]');
  assert(f.document.querySelector('.fm-exam-header')); assert.equal((await f.state()).current.endsAt, deadline);
});

test('Delayed heartbeat acknowledgements cannot rewind the visible exam countdown', async t => {
  const f = await fixture(t, 'swt'); await f.resume(); let release, blocked = false, done = false;
  f.intercept(async (route, init, send) => {
    if (route.endsWith('/pulse') && !blocked) {
      blocked = true; const reply = await send(), data = await reply.json();
      await new Promise(resolve => { release = resolve; }); done = true;
      return new Response(JSON.stringify(data), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
    }
    return send();
  });
  await f.step(1000); await until(() => release); await f.step(10000);
  const before = f.document.getElementById('fm-time').textContent;
  release(); await until(() => done); await settle(); await f.step(0);
  assert.equal(f.document.getElementById('fm-time').textContent, before);
});

for (const action of ['skip','end']) test('Ticks during in-flight ' + action + ' cannot create another recording for the sealed question', async t => {
  const f = await fixture(t); await f.resume(); await until(async () => (await f.state()).responses[0].segments.length === 1);
  const original = (await f.state()).responses[0]; let release, held = false;
  f.intercept(async (route, init, send) => {
    if (route.endsWith(action === 'end' ? '/end' : '/next') && !held) { held = true; const reply = await send(); await new Promise(resolve => { release = resolve; }); return reply; }
    return send();
  });
  assert.equal(f.document.querySelector('.fm-exam-footer [data-fm="end"]'), null);
  const moving = f.click('[data-fm="' + action + '"]'); await until(() => release); await f.step(500); release(); await moving;
  await f.step(100); await f.client.flush();
  const declarations = f.requests.filter(row => row.route.endsWith('/segments')).map(row => JSON.parse(row.init.body)).filter(row => row.itemToken === original.token);
  assert(declarations.length); assert(declarations.every(row => row.segmentId === original.permit.id), 'A navigation tick created an undeclared late segment');
  assert.equal((await f.state()).index, action === 'end' ? 66 : 1);
  await until(async () => { await f.client.flush(); return (await f.pending.list('alice:')).filter(row => row.value.itemToken === original.token).length === 0; });
});

test('The portal route and lazy loader include the player with fresh immutable cache keys', async () => {
  const read = name => fs.readFile(path.join(__dirname, '..', name), 'utf8');
  const html = await read('public/index.html'), source = await read('public/index.js');
  const hash = text => createHash('sha256').update(text).digest('hex').slice(0, 12);
  const client = await read('public/full-mock-client.js'), report = await read('public/full-mock-report.js'), css = await read('public/full-mock.css');
  assert(source.includes('full-mock-client.js?v=sha256-' + hash(client)));
  assert(source.includes('full-mock-report.js?v=sha256-' + hash(report)));
  assert(source.indexOf("loadDeferredScript('/full-mock-report.js") < source.indexOf("loadDeferredScript('/full-mock-client.js"));
  assert(html.includes('full-mock.css?v=sha256-' + hash(css)));
  assert(html.includes('id="fullMockPane"'));
  assert.equal(require('../public/portal-workspace').routeFromHash('#/full-mock'), 'full-mock');
});
