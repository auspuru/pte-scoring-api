'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { loadPaper, digest } = require('../full-mock/paper');
const session = require('../full-mock/session');
const { createStore, hash } = require('../full-mock/store');
const { createEngine, configuration } = require('../full-mock/assessment');
const adapters = require('../full-mock/adapters');
const media = require('../full-mock/recording');
const { installFullMock } = require('../full-mock/api');
const paper = loadPaper();
const accessBase = require('../content/full-mock/access-compatible-sources.json');
const full = q => adapters.result(q, adapters.maxima(q));
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'full-mock-assessment-')), store = createStore({ directory });
  const id = randomUUID(), engines = [];
  await store.create('alice', id, paper, (key, at) => session.create(key, paper, at, { preview:true }), 1000);
  await store.update('alice', id, state => { session.end(state, paper, 1000); return state; });
  const engine = createEngine({ store, adapters:{ assess:async q => full(q) }, ...options }); engines.push(engine);
  t.after(async () => { for (const item of engines) { item.stop(); await item.drain(); } await fs.rm(directory, { recursive:true, force:true, maxRetries:3, retryDelay:10 }); });
  return { id, store, engine, engines, directory, state:async () => (await store.get('alice', id)).state };
}

test('Two independent workers claim one durable assessment and process 65 questions, excluding the introduction', async t => {
  const counts = new Map();
  const implementation = { assess:async q => { const key = q.type + q.id; counts.set(key, (counts.get(key) || 0) + 1); await new Promise(resolve => setImmediate(resolve)); return full(q); } };
  const f = await fixture(t, { adapters:implementation });
  const other = createEngine({ store:createStore({ directory:f.directory }), adapters:implementation }); f.engines.push(other);
  await Promise.all([f.engine.request('alice', f.id), other.request('alice', f.id)]); await Promise.all([f.engine.drain(), other.drain()]);
  const results = await f.engine.results('alice', f.id);
  assert.equal(results.ready, true); assert.equal(results.assessedCount, 65); assert.equal(counts.size, 65); assert([...counts.values()].every(count => count === 1));
  assert.equal(results.profiles.speaking.practiceIndex, 90); assert.equal(results.profiles.overall.practiceIndex, null);
  assert.deepEqual(results.profiles.overall.practiceIndexRange, { low:90, high:90 });
  assert.equal((await f.state()).assessment.status, 'complete');
});
test('Explicit retry processes failures only and preserves every successful native assessment', async t => {
  const calls = new Map(); let failing = true;
  const f = await fixture(t, { adapters:{ assess:async q => { const key = q.type + q.id; calls.set(key, (calls.get(key) || 0) + 1); return q.type === 'asq' && failing ? { status:'failed', reason:'transcription-unavailable' } : full(q); } } });
  await f.engine.request('alice', f.id); await f.engine.drain();
  const first = await f.engine.results('alice', f.id); assert.equal(first.assessedCount, 60); assert.equal(first.profiles.listening.status, 'pending'); assert.equal(first.profiles.speaking.status, 'complete');
  await f.engine.request('alice', f.id); await f.engine.drain(); assert([...calls.values()].every(count => count === 1));
  failing = false; await f.engine.request('alice', f.id, { retry:true }); await f.engine.drain();
  assert.equal((await f.engine.results('alice', f.id)).ready, true);
  for (const [key, count] of calls) assert.equal(count, key.startsWith('asq') ? 2 : 1);
  await f.engine.request('alice', f.id, { retry:true }); await f.engine.drain(); assert.equal((await f.state()).assessment.run, 2);
});
test('The audited access-only upgrade finishes old attempts without changing their snapshot or rescoring successful items', async t => {
  const calls=new Map();let retry=false;
  const target=paper.questions[0].question.id;
  const f=await fixture(t,{adapters:{assess:async q=>{calls.set(q.id,(calls.get(q.id)||0)+1);return q.id===target&&!retry?{status:'failed',reason:'provider-unavailable'}:full(q);}}});
  const original={...structuredClone(f.engine.snapshot),scoringSources:structuredClone(accessBase)};
  await f.store.update('alice',f.id,state=>{state.assessment=require('../full-mock/assessment').stateFor(original);return state;});
  const originalHash=digest(original);await f.engine.request('alice',f.id);await f.engine.drain();
  assert.equal((await f.engine.results('alice',f.id)).assessedCount,64);
  retry=true;await f.engine.request('alice',f.id,{retry:true});await f.engine.drain();
  assert.equal((await f.engine.results('alice',f.id)).ready,true);
  const saved=await f.state();assert.equal(saved.assessment.snapshotHash,originalHash);assert.deepEqual(saved.assessment.snapshot,original);
  for(const [id,count] of calls)assert.equal(count,id===target?2:1);
  assert(Object.values(saved.assessment.items).every(item=>item.snapshotHash===originalHash));
});
for(const change of ['model','native-source'])test('Access upgrade compatibility cannot accept a changed '+change,async t=>{
  const f=await fixture(t),original={...structuredClone(f.engine.snapshot),scoringSources:structuredClone(accessBase)};
  if(change==='model')original.configuration.transcription.model='different-model';
  else original.scoringSources.files['speaking-scoring.js'].sha256='0'.repeat(64);
  await f.store.update('alice',f.id,state=>{state.assessment=require('../full-mock/assessment').stateFor(original);return state;});
  await assert.rejects(f.engine.request('alice',f.id),/different assessment version/);
});
test('A lost recording remains pending, then durable media wakes that question without repeating paid failures', async t => {
  let transcriptions = 0;
  const service = adapters.createAdapters({ transcribe:async () => { transcriptions++; return paper.questions.find(value => value.question.type === 'asq').question.acceptedAnswers[0]; } });
  const f = await fixture(t, { adapters:service, assemble:async () => ({ status:'ready', recording:{} }) });
  const index = paper.questions.findIndex(value => value.question.type === 'asq') + 1;
  await f.store.update('alice', f.id, state => { state.responses[index].reason = 'time-expired'; return state; });
  await f.engine.request('alice', f.id); await f.engine.drain();
  const first = await f.engine.results('alice', f.id); assert.equal(first.assessedCount, 64); assert.equal(first.profiles.listening.status, 'pending'); assert.equal(transcriptions, 0);
  await f.store.update('alice', f.id, state => { state.responses[index].segments.push({ id:randomUUID(), mime:'audio/wav', finished:true, chunkCount:1, chunks:{ 0:{ sha256:'saved', bytes:10, stored:true } } }); return state; });
  await f.engine.wakeMedia('alice', f.id); await f.engine.drain();
  assert.equal((await f.engine.results('alice', f.id)).ready, true); assert.equal(transcriptions, 1); assert.equal((await f.state()).assessment.run, 1);
});
test('A production attempt blocked only by late uploads recovers automatically without rescoring completed questions', async t => {
  const calls = new Map(), target = paper.questions[0].id;
  const f = await fixture(t, { adapters:{ assess:async q => { calls.set(q.id, (calls.get(q.id) || 0) + 1); return full(q); } } });
  const original = { ...structuredClone(f.engine.snapshot), scoringSources:require('../content/full-mock/media-compatible-sources.json') };
  const bytes = media.wav(Buffer.alloc(32000, 1)), segment = { id:randomUUID(), mime:'audio/wav', finished:true, chunkCount:1, chunks:{ 0:{ sha256:hash(bytes), bytes:bytes.length, stored:true, late:true } } };
  await f.store.putChunk('alice', f.id, segment.id, 0, segment.mime, bytes);
  await f.store.update('alice', f.id, state => {
    state.assessment = require('../full-mock/assessment').stateFor(original);
    state.responses[1].segments = [segment]; state.responses[1].reason = 'time-expired';
    return state;
  });
  await f.engine.request('alice', f.id); await f.engine.drain();
  assert.equal((await f.engine.results('alice', f.id)).ready, true);
  await f.store.update('alice', f.id, state => {
    state.assessment.status = 'needs-attention';
    const job = state.assessment.items[target]; job.status = 'pending'; job.reason = 'late-recording'; delete job.result;
    return state;
  });
  assert((await f.store.assessmentQueue()).some(row => row.id === f.id && row.status === 'needs-attention'));
  await f.engine.recover(); await f.engine.drain();
  const result = await f.engine.results('alice', f.id), state = await f.state();
  assert.equal(result.ready, true); assert.equal(state.assessment.snapshotHash, digest(original));
  for (const [id, count] of calls) assert.equal(count, id === paper.questions[0].question.id ? 2 : 1);
  await f.engine.recover(); await f.engine.drain();
  assert.equal(calls.get(paper.questions[0].question.id), 2, 'Recovery does not keep regrading the repaired response');
});
test('Recovery resumes a persisted processing attempt after lease expiry and never overwrites a different version', async t => {
  const f = await fixture(t); await f.engine.request('alice', f.id); await f.engine.drain();
  await f.store.update('alice', f.id, state => { state.assessment.status = 'processing'; state.assessment.lease = { id:randomUUID(), expiresAt:0 }; delete state.assessment.items[paper.questions[0].id]; return state; });
  const other = createEngine({ store:createStore({ directory:f.directory }), adapters:{ assess:async q => full(q) } }); f.engines.push(other);
  await other.recover(); await other.drain(); assert.equal((await other.results('alice', f.id)).ready, true);
  const changed = configuration(); changed.essay.model = 'different-assessment-model';
  const future = createEngine({ store:f.store, providerConfiguration:changed }); f.engines.push(future);
  await assert.rejects(future.request('alice', f.id, { retry:true }), /different assessment version/);
  assert.equal((await future.results('alice', f.id)).ready, true, 'A saved completed report remains readable without regrading');
  await f.store.update('alice', f.id, state => { state.assessment.snapshot.weighting.profiles.writing.weights.essay = 100; return state; });
  await assert.rejects(other.results('alice', f.id), /integrity/);
});
test('Shutdown finishes in-flight checkpoints and a replacement resumes remaining items without duplicate grades', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; }), counts = new Map(); let started = 0;
  const implementation = { assess:async q => { const key = q.type + q.id; counts.set(key, (counts.get(key) || 0) + 1); started++; await gate; return full(q); } };
  const f = await fixture(t, { adapters:implementation }); await f.engine.request('alice', f.id);
  const deadline = Date.now() + 5000; while (started < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(started, 2);
  const stopped = f.engine.stop(); release(); await stopped;
  assert.equal((await f.state()).assessment.status, 'processing');
  const replacement = createEngine({ store:f.store, adapters:implementation }); f.engines.push(replacement); await replacement.recover(); await replacement.drain();
  assert.equal((await replacement.results('alice', f.id)).ready, true); assert.equal(counts.size, 65); assert([...counts.values()].every(count => count === 1));
});
test('Malformed adapter output and changed sealed data cannot be published as a complete score', async t => {
  const f = await fixture(t, { adapters:{ assess:async q => { const result = full(q); if (q.type === 'essay') result.maxima.form = 999; return result; } } });
  await f.engine.request('alice', f.id); await f.engine.drain(); const report = await f.engine.results('alice', f.id);
  assert.equal(report.ready, false); assert.equal(report.assessedCount, 64); assert.equal(report.profiles.writing.practiceIndex, null);
  await f.store.update('alice', f.id, state => { state.responses[1].answer = ['unexpected changed input']; return state; });
  assert.equal((await f.engine.results('alice', f.id)).assessedCount, 63);
});
test('Recording reconstruction checks every immutable byte, decodes containers and isolates ownership', async t => {
  const f = await fixture(t), q = paper.questions.find(value => value.question.type === 'asq').question;
  const pcm = Buffer.alloc(32000); for (let i = 0; i < 16000; i++) pcm.writeInt16LE(Math.round(Math.sin(i * Math.PI / 20) * 10000), i * 2);
  const bytes = media.wav(pcm), segment = { id:randomUUID(), mime:'audio/wav', finished:true, chunkCount:2, chunks:{} }, pieces = [bytes.subarray(0, 9000), bytes.subarray(9000)];
  for (let sequence = 0; sequence < pieces.length; sequence++) { const chunk = pieces[sequence]; await f.store.putChunk('alice', f.id, segment.id, sequence, segment.mime, chunk); segment.chunks[sequence] = { sha256:hash(chunk), bytes:chunk.length, stored:true }; }
  const response = { segments:[segment] }, opts = { getChunk:f.store.getChunk };
  const ready = await media.assemble('alice', f.id, q, response, opts); assert.equal(ready.status, 'ready'); assert(Math.abs(ready.recording.seconds - 1) < 0.01);
  assert.equal((await media.assemble('bob', f.id, q, response, opts)).status, 'needs-review');
  const bad = structuredClone(response); bad.segments[0].chunks[0].sha256 = '0'.repeat(64); assert.equal((await media.assemble('alice', f.id, q, bad, opts)).reason, 'recording-integrity');
  const late = structuredClone(response); late.segments[0].chunks[0].late = true; assert.equal((await media.assemble('alice', f.id, q, late, opts)).status, 'ready', 'Delayed transport must not turn valid audio into permanent pending');
  late.segments[0].lateActivation = true; assert.equal((await media.assemble('alice', f.id, q, late, opts)).reason, 'late-recording', 'An undeclared late recording still requires review');
  const pending = structuredClone(response); pending.segments[0].chunks[1].stored = false; assert.equal((await media.assemble('alice', f.id, q, pending, opts)).status, 'pending');
  const decoded = await media.convert([{ mime:'audio/wav', bytes }, { mime:'audio/wav', bytes }], 10); assert(Math.abs(decoded.seconds - 2) < 0.01);
  await assert.rejects(media.convert([{ mime:'audio/wav', bytes }], 0.1), /duration/);
  assert.equal(digest((await f.store.get('alice', f.id)).paper), digest(paper));
});
test('The media decoder accepts browser containers and rejects playlists before making network requests', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'full-mock-codecs-'));
  t.after(() => fs.rm(directory, { recursive:true, force:true }));
  const source = path.join(directory, 'voice.wav'); await fs.writeFile(source, media.wav(Buffer.alloc(32000, 1)));
  const run = require('node:util').promisify(require('node:child_process').execFile);
  for (const [extension, codec, mime] of [['webm','libopus','audio/webm'],['mp4','aac','audio/mp4'],['ogg','libopus','audio/ogg'],['mp3','libmp3lame','audio/mpeg']]) {
    const target = path.join(directory, 'voice.' + extension);
    await run('ffmpeg', ['-hide_banner','-loglevel','error','-nostdin','-y','-i',source,'-c:a',codec,target]);
    const decoded = await media.convert([{ mime, bytes:await fs.readFile(target) }], 10); assert(decoded.seconds >= 0.9 && decoded.seconds < 1.2, mime);
  }
  let requested = 0;
  const server = require('node:http').createServer((req, res) => { requested++; res.end(); }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const playlist = Buffer.from('#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://127.0.0.1:' + server.address().port + '/private.wav\n#EXT-X-ENDLIST\n');
  await assert.rejects(media.convert([{ mime:'audio/wav', bytes:playlist }], 10)); assert.equal(requested, 0);
});
test('Assessment HTTP endpoints require ownership and submission, ignore injected scores, and redact the saved paper', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'full-mock-scoring-api-')), app = express(); app.use(express.json());
  const roles = { alice:'admin', bob:'admin' };
  const service = installFullMock(app, { directory, verifyToken:token => roles[token] ? token : null, getAccount:async uid => ({ role:roles[uid] }), assessment:{ adapters:{ assess:async q => full(q) } } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { service.stop(); await service.assessor.drain(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive:true, force:true, maxRetries:3, retryDelay:10 }); });
  const base = 'http://127.0.0.1:' + server.address().port + '/api/full-mocks';
  let control;
  async function request(route, body, user = 'alice') { const reply = await fetch(base + route, { method:body === undefined ? 'GET' : 'POST', headers:{ 'x-session-token':user, 'Content-Type':'application/json', ...(control ? { 'x-full-mock-control':control.controlToken } : {}) }, body:body === undefined ? undefined : JSON.stringify(body) }); return { status:reply.status, data:await reply.json(), headers:reply.headers }; }
  const start = await request('/attempts', { id:randomUUID(), paperId:paper.id, checks:{ microphone:true, playback:true } }); const id = start.data.id;
  assert.equal(start.data.assessmentStatus, 'not-requested'); assert.equal(start.data.assessment, undefined);
  assert.equal((await request('/attempts/' + id + '/results')).status, 409);
  assert.equal((await request('/attempts/' + id + '/assessment', {})).status, 409);
  assert.equal((await request('/attempts/' + id + '/results', undefined, 'bob')).status, 404);
  control = { pageId:randomUUID(), controlToken:randomUUID(), recoveryToken:randomUUID() }; await request('/attempts/' + id + '/claim', control);
  await request('/attempts/' + id + '/end', { confirm:true, overall:90, assessment:{ status:'complete' } }); await service.assessor.drain();
  const results = await request('/attempts/' + id + '/results'); assert.equal(results.status, 200); assert.equal(results.data.ready, true); assert.equal(results.data.items.length, 65);
  assert.equal(results.data.profiles.overall.practiceIndex, null); assert.equal(results.headers.get('cache-control'), 'no-store');
  for (const key of ['paper','responses','snapshot','stages','transcript','answer','acceptedAnswers']) assert.equal(results.data[key], undefined);
  assert(results.data.items.every(item => !item.native && !item.stages && !item.transcript));
  assert.equal((await request('/attempts/' + id + '/assessment', { retry:true })).status, 202);
  roles.alice = 'user'; assert.equal((await request('/attempts/' + id + '/results')).status, 403);
});


test('Practice navigation upgrade preserves current production mock snapshots and the exact native transcription function',async t=>{
 const f=await fixture(t),original={...structuredClone(f.engine.snapshot),scoringSources:require('../content/full-mock/navigation-compatible-sources.json')};
 const source=require('../speaking-lab').transcribeRecording.toString();
 assert.equal(require('node:crypto').createHash('sha256').update(source).digest('hex'),'6779768323a86f2488ac0621c8dd7f0949ca1348bdf0c23a98d10f64eaa84f4a');
 await f.store.update('alice',f.id,state=>{state.assessment=require('../full-mock/assessment').stateFor(original);return state;});
 await f.engine.request('alice',f.id);await f.engine.drain();assert.equal((await f.engine.results('alice',f.id)).ready,true);
 assert.deepEqual((await f.state()).assessment.snapshot,original);
});


test('Completion recovery retains every previously assessed item and the submitted snapshot',async t=>{
 let allow=false,calls=new Map();const target=paper.questions.find(c=>c.question.type==='essay').question.id;
 const f=await fixture(t,{adapters:{assess:async q=>{calls.set(q.id,(calls.get(q.id)||0)+1);return q.id===target&&!allow?{status:'failed',reason:'writing-unavailable'}:full(q);}}});
 const original={...structuredClone(f.engine.snapshot),scoringSources:require('../content/full-mock/assessment-completion-compatible-sources.json')};
 await f.store.update('alice',f.id,state=>{state.assessment=require('../full-mock/assessment').stateFor(original);return state;});
 await f.engine.request('alice',f.id);await f.engine.drain();assert.equal((await f.engine.results('alice',f.id)).assessedCount,64);
 allow=true;await f.engine.request('alice',f.id,{retry:true});await f.engine.drain();assert.equal((await f.engine.results('alice',f.id)).ready,true);
 assert.deepEqual((await f.state()).assessment.snapshot,original);for(const [id,count]of calls)assert.equal(count,id===target?2:1);
});
