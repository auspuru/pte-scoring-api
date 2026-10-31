'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const express = require('express');
const { parseHTML } = require('linkedom');
const { loadPaper, digest } = require('../full-mock/paper');
const session = require('../full-mock/session');
const assessment = require('../full-mock/assessment');
const { inputHash } = require('../full-mock/aggregation');
const adapters = require('../full-mock/adapters');
const reports = require('../full-mock/report');
const renderer = require('../public/full-mock-report');
const { installFullMock } = require('../full-mock/api');
const { createController } = require('../public/full-mock-client');
const paper = loadPaper();
function full(q) { return adapters.result(q, adapters.maxima(q)); }
function complete(snapshot = assessment.snapshot()) {
  const state = session.create(randomUUID(), paper, 1000000, { preview:true, assessmentSnapshot:snapshot });
  session.end(state, paper, 1060000); state.assessment.status = 'complete';
  paper.questions.forEach((candidate, index) => { state.assessment.items[candidate.id] = { status:'assessed', inputHash:inputHash(state.responses[index + 1]), snapshotHash:state.assessment.snapshotHash, result:full(candidate.question), stages:{} }; });
  return state;
}
const containsKey = (value, key) => value && typeof value === 'object' && (Object.hasOwn(value, key) || Object.values(value).some(child => containsKey(child, key)));

test('Submitted report projects all 65 answers and 22 rubrics, retains native feedback and never mutates or grades', () => {
  const state = complete(), first = paper.questions[0], job = state.assessment.items[first.id];
  job.stages = { transcription:{ status:'complete', value:'Exact saved words' }, content:{ status:'complete', value:{ overview:'Saved content feedback', strengths:['Accurate wording'], coverage:[{ point:'A fact', status:'covered', evidence:'saved words', feedback:'Supported' }], apiKey:'SECRET-CONTENT' } }, delivery:{ status:'complete', traits:{ pronunciation:{ score:5, provider:'SECRET-PROVIDER' } } } };
  job.result.native = { feedback:{ content:'Saved criterion feedback' }, feedbackIssues:[{ trait:'content', priority:'minor', affectsScore:false, evidence:{ essayQuote:'Exact saved words' }, explanation:'A saved explanation', suggestedChange:'A saved change' }], errors:[{ phrase:'saved', correction:'original', explanation:'Saved correction' }], prompt:'SECRET-PROMPT' };
  const original = JSON.stringify(state), report = reports.buildReport(paper, state);
  assert.equal(report.ready, true); assert.equal(report.items.length, 65); assert.equal(new Set(report.items.map(row => row.type)).size, 22);
  assert.equal(report.items[0].transcript, 'Exact saved words'); assert.equal(report.items[0].feedback.criteria[0].feedback, 'Saved criterion feedback');
  assert.equal(report.items[0].feedback.coverage[0].evidence, 'saved words'); assert.equal(report.items[0].feedback.issues[0].suggestedChange, 'A saved change');
  for (let index = 0; index < 65; index++) { assert.equal(report.items[index].id, paper.questions[index].id); assert.deepEqual(report.items[index].answer, state.responses[index + 1].answer); assert.deepEqual(report.items[index].maxima, adapters.maxima(paper.questions[index].question)); }
  assert.equal(report.official, false); assert.equal(report.calibrated, false); assert.equal(report.profiles.overall.practiceIndex, null);
  assert.match(report.interpretation.calibration, /Not yet calibrated/); assert.equal(report.items.some(item => item.type === 'intro'), false);
  assert.equal(report.priorities.length, 0); assert(!JSON.stringify(report).includes('SECRET-')); assert.equal(containsKey(report, 'stages'), false); assert.equal(containsKey(report, 'snapshot'), false);
  assert.equal(JSON.stringify(state), original);
});
test('Incomplete, stale and review-only assessments keep affected indices pending and cannot become weaknesses', () => {
  const state = complete(), essay = paper.questions.find(row => row.question.type === 'essay'), job = state.assessment.items[essay.id];
  job.status = 'failed'; job.reason = 'provider key SECRET'; state.assessment.status = 'needs-attention';
  let report = reports.buildReport(paper, state); assert.equal(report.ready, false); assert.equal(report.profiles.writing.practiceIndex, null); assert.equal(report.profiles.speaking.practiceIndex, 90);
  assert.equal(report.priorities.length, 0); assert.equal(report.retryAvailable, true); assert.equal(report.items.find(row => row.id === essay.id).total, undefined); assert(!JSON.stringify(report).includes('SECRET'));
  const first = state.assessment.items[paper.questions[0].id]; first.inputHash = 'stale'; first.stages = { transcription:{ status:'complete', value:'Stale transcript' } };
  report = reports.buildReport(paper, state); assert.equal(report.items[0].transcript, ''); assert.equal(report.items[0].feedback.criteria.length, 0);
  first.inputHash = inputHash(state.responses[1]); first.status = 'pending'; first.reason = 'late-recording'; delete first.result;
  job.status = 'assessed'; delete job.reason;
  report = reports.buildReport(paper, state); assert.equal(report.items[0].assessment.label, 'Recording needs recovery'); assert.equal(report.retryAvailable, false);
});
test('Practice priorities use verified native fractions, and late recovered text remains separate from the scored answer', () => {
  const state = complete(), candidate = paper.questions.find(row => row.question.type === 'essay'), index = paper.questions.indexOf(candidate) + 1, response = state.responses[index];
  response.answer = ['Timed answer']; state.assessment.items[candidate.id].inputHash = inputHash(response);
  state.assessment.items[candidate.id].result = adapters.zero(candidate.question, 'Native Form gate');
  state.recoveries.push({ itemToken:response.token, answer:['Late recovered answer'], receivedAt:1061000, status:'needs-review' });
  const report = reports.buildReport(paper, state), item = report.items[index - 1];
  assert.deepEqual(item.answer, ['Timed answer']); assert.deepEqual(item.recovered[0].answer, ['Late recovered answer']);
  assert.equal(report.priorities[0].type, 'essay'); assert.equal(report.priorities[0].path, '#/essays'); assert.equal(item.feedback.gated, true);
  assert(item.feedback.criteria.every(row => row.earned === 0 && /gate/.test(row.feedback)));
  const { document } = parseHTML(renderer.review(item)); assert.match(document.querySelector('.fm-recovery').textContent, /has not replaced your timed answer/);
});
test('Speaking delivery retains existing acoustic coaching and projects it without changing native marks', async () => {
  const state = complete(), candidate = paper.questions.find(row => row.question.type === 'rs'), position = paper.questions.indexOf(candidate) + 1;
  state.responses[position].reason = 'submitted';
  const service = adapters.createAdapters({ transcribe:async () => candidate.question.text, assessDelivery:async () => ({ deliveryVersion:'saved-delivery-version', deliveryProvider:'private-provider', pronunciation:{ score:4, descriptor:'Generally clear sounds.', coaching:'Practise the final consonant.', words:[{ word:'entrance', errorType:'Mispronunciation', private:'SECRET' }] }, fluency:{ score:5, descriptor:'Connected speech.', coaching:'Keep a steady pace.' } }) });
  const marked = await service.assess(candidate.question, state.responses[position], { recording:{} }), { stages, ...result } = marked;
  state.assessment.items[candidate.id] = { status:'assessed', result, stages, inputHash:inputHash(state.responses[position]), snapshotHash:state.assessment.snapshotHash };
  const item = reports.buildReport(paper, state).items[position - 1];
  assert.equal(item.scores.pronunciation, 4); assert.match(item.feedback.criteria.find(row => row.key === 'pronunciation').feedback, /Practise the final consonant/);
  assert.deepEqual(item.feedback.criteria.find(row => row.key === 'pronunciation').practiceWords, ['entrance']);
  assert(!JSON.stringify(item).includes('private-provider')); assert(!JSON.stringify(item).includes('SECRET'));
});
test('Reports reject active or corrupt records; historical reports preserve their saved profile versions', () => {
  const state = complete(), old = structuredClone(state);
  state.status = 'active'; assert.throws(() => reports.buildReport(paper, state), { status:409 });
  old.assessment.snapshot.weighting.profiles.writing.version = 'historical-writing-profile'; old.assessment.snapshotHash = digest(old.assessment.snapshot);
  old.assessment.snapshot.scoringSources.files['full-mock/adapters.js'].version = 'full-mock-adapters-2026-10-29.1';
  old.assessment.snapshotHash = digest(old.assessment.snapshot);
  Object.values(old.assessment.items).forEach(job => { job.result.version = 'full-mock-adapters-2026-10-29.1'; });
  Object.values(old.assessment.items).forEach(job => { job.snapshotHash = old.assessment.snapshotHash; });
  assert.equal(reports.buildReport(paper, old).profiles.writing.version, 'historical-writing-profile');
  old.paperHash = 'wrong'; assert.throws(() => reports.buildReport(paper, old), /integrity/);
  const tampered = complete(); tampered.assessment.snapshot.weighting.profiles.writing.weights.essay++;
  assert.throws(() => reports.buildReport(paper, tampered), /integrity/);
});
test('Every task review is readable and escaped, with no form controls that can change a sealed answer', () => {
  const report = reports.buildReport(paper, complete());
  report.title = '<script>attack()</script>'; report.items[0].reference.sample = '<img onerror=attack() src=x>';
  report.items[0].feedback.overview = '<svg onload=attack()>';
  const { document } = parseHTML(renderer.page(report, report.items[0].id));
  assert.equal(document.querySelector('script,svg,img:not(.ipr-logo)'), null); assert.match(document.querySelector('h1').textContent, /<script>/);
  assert.equal(document.querySelectorAll('.ipr-overall,.ipr-skill').length, 5); assert.match(document.querySelector('.ipr-overall').textContent, /90/);
  assert.equal(document.querySelectorAll('#fm-review-select option').length, 65);
  for (const item of report.items) {
    const { document:doc } = parseHTML(renderer.review(item)); assert(doc.querySelector('h3,h4')); assert.equal(doc.querySelector('textarea,input,select'), null); assert(doc.querySelector('details.fm-reference'));
    assert.match(doc.querySelector('article').textContent, /marks/);
  }
});
test('Student reports show results and coaching without exposing calculation details', () => {
  const report = reports.buildReport(paper, complete()), marker = 'PRIVATE_CALCULATION_DETAILS';
  for (const key of Object.keys(report.interpretation)) report.interpretation[key] = marker;
  report.weightingVersion = marker; report.practiceIndexPolicy.version = marker;
  for (const profile of Object.values(report.profiles)) profile.version = marker;
  for (const item of report.items) {
    for (const issue of item.feedback.issues) issue.scoreRationale = marker;
    if (item.feedback.gated) {
      item.feedback.overview = marker;
      for (const criterion of item.feedback.criteria) criterion.feedback = marker;
    }
  }
  const { document } = parseHTML(renderer.page(report, report.items[0].id));
  assert.equal(document.querySelectorAll('.ipr-overall,.ipr-skill').length, 5);
  assert.equal(document.querySelector('.fm-method,.fm-interpretation'), null);
  assert.equal(document.querySelector('.fm-task-summary').hasAttribute('open'), false);
  assert(document.querySelector('[data-fm="retry"]').hasAttribute('hidden'));
  for (const markup of [renderer.page(report), renderer.history([reports.summary(paper, complete())]), ...report.items.map(renderer.review)]) {
    assert(!markup.includes(marker));
    // A prediction passage may use "holistic" as ordinary subject vocabulary.
    assert(!/How to read this report|native marks|Index policy|Overall uses|mark fractions|holistic (?:score|scoring|estimate|assessment|mark)|separate point deductions/i.test(markup));
  }
});

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'full-mock-report-')), app = express(); app.use(express.json());
  const roles = { alice:'admin', bob:'admin', student:'user' }; let calls = 0;
  const service = installFullMock(app, { directory, now:() => 1060000, verifyToken:token => roles[token] ? token : null, getAccount:async uid => ({ role:roles[uid] }), assessment:{ adapters:{ assess:async q => { calls++; return full(q); } } } });
  const state = complete(service.assessor.snapshot), id = state.id;
  await service.store.create('alice', id, paper, () => state, 1000000);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await service.stop(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive:true, force:true, maxRetries:3, retryDelay:10 }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  async function request(route, user = 'alice') { const reply = await fetch(base + '/api/full-mocks' + route, { headers:{ 'x-session-token':user } }); return { status:reply.status, headers:reply.headers, data:reply.headers.get('content-type')?.includes('json') ? await reply.json() : Buffer.from(await reply.arrayBuffer()) }; }
  return { service, roles, state, id, base, request, calls:() => calls };
}
test('Report/history APIs enforce ownership, preview access and submission, and return no secrets or paid reads', async t => {
  const f = await fixture(t), route = '/attempts/' + f.id;
  assert.equal((await f.request(route + '/report', '')).status, 401); assert.equal((await f.request(route + '/report', 'bob')).status, 404);
  f.roles.alice = 'user'; assert.equal((await f.request(route + '/report')).status, 403); assert.deepEqual((await f.request('/attempts')).data, []); f.roles.alice = 'admin';
  const report = await f.request(route + '/report'); assert.equal(report.status, 200); assert.equal(report.headers.get('cache-control'), 'no-store'); assert.equal(report.data.ready, true);
  const history = (await f.request('/attempts')).data; assert.equal(history.length, 1); assert.equal(history[0].completedCount, 65); assert.equal(history[0].durationSeconds, 60);
  for (const key of ['answer','answers','reference','responses','paper','transcript','snapshot','stages']) assert.equal(containsKey(history, key), false, key);
  const activeId = randomUUID(); await f.service.store.create('alice', activeId, paper, (id, at) => session.create(id, paper, at, { preview:true, assessmentSnapshot:f.service.assessor.snapshot }), 1060000);
  assert.equal((await f.request('/attempts/' + activeId + '/report')).status, 409);
  const audioItem = paper.questions.find(row => row.audio), asset = audioItem.audio.entry.audioSha256;
  assert.equal((await f.request('/attempts/' + activeId + '/review/' + audioItem.question.id + '/media/' + asset)).status, 409);
  assert.equal((await f.request(route + '/media/' + asset)).status, 404, 'Active-player route must remain closed after submission');
  assert.equal(f.calls(), 0);
});
test('Submitted prompt and recording playback verify task association and every saved byte', async t => {
  const f = await fixture(t), audioItem = paper.questions.find(row => row.audio), route = '/attempts/' + f.id + '/review/' + audioItem.question.id;
  const asset = audioItem.audio.entry.audioSha256, audio = await f.request(route + '/media/' + asset);
  assert.equal(audio.status, 200); assert.equal(audio.headers.get('cache-control'), 'no-store'); assert.equal(createHash('sha256').update(audio.data).digest('hex'), asset);
  assert.equal((await f.request(route + '/media/' + asset, 'bob')).status, 404);
  assert.equal((await f.request('/attempts/' + f.id + '/review/' + paper.questions[0].question.id + '/media/' + asset)).status, 404);
  const segment = { id:randomUUID(), mime:'audio/wav', finished:true, chunkCount:2, chunks:{}, lateActivation:true }, pieces = [Buffer.from('first'), Buffer.from('second')];
  for (let n = 0; n < pieces.length; n++) segment.chunks[n] = { ...await f.service.store.putChunk('alice', f.id, segment.id, n, segment.mime, pieces[n]), stored:true };
  const position = paper.questions.indexOf(audioItem) + 1;
  await f.service.store.update('alice', f.id, state => { state.responses[position].segments = [segment]; state.assessment.items[audioItem.id].inputHash = inputHash(state.responses[position]); return state; });
  const recording = await f.request(route + '/recordings/' + segment.id); assert.equal(recording.status, 200); assert.deepEqual(recording.data, Buffer.concat(pieces));
  const item = (await f.request('/attempts/' + f.id + '/report')).data.items[position - 1]; assert.equal(item.recordings[0].reviewRequired, true);
  assert.equal((await f.request('/attempts/' + f.id + '/review/' + paper.questions[0].question.id + '/recordings/' + segment.id)).status, 404);
  await f.service.store.update('alice', f.id, state => { state.responses[position].segments[0].chunks[0].sha256 = 'bad'; return state; });
  assert.equal((await f.request(route + '/recordings/' + segment.id)).status, 503);
  await f.service.store.update('alice', f.id, state => { state.responses[position].segments[0].finished = false; return state; });
  assert.equal((await f.request(route + '/recordings/' + segment.id)).status, 409);
});

const storage = () => { const values = new Map(); return { getItem:key => values.get(key) || null, setItem:(key, value) => values.set(key, value), removeItem:key => values.delete(key) }; };
async function clientFixture(t) {
  const f = await fixture(t), { document } = parseHTML('<html><body><section id="fullMockPane"></section></body></html>');
  let owner = 'alice', offline = false, intercept; const requests = [], intervals = new Map(), revoked = []; let timer = 0;
  const env = { document, sessionStorage:storage(), localStorage:storage(), Blob, crypto:{ randomUUID },
    URL:{ createObjectURL:URL.createObjectURL, revokeObjectURL:url => { revoked.push(url); URL.revokeObjectURL(url); } }, performance:{ now:() => 1060000 },
    setInterval:fn => { intervals.set(++timer, fn); return timer; }, clearInterval:key => intervals.delete(key), setTimeout, clearTimeout, addEventListener() {}, PortalExamMode:{ set() {} },
    fetch:async (route, init) => { requests.push({ route, init }); if (offline) throw Error('Offline'); const send = () => fetch(f.base + route, init); return intercept ? intercept(route, init, send) : send(); } };
  env.sessionStorage.setItem('pte_session_token', owner);
  const client = createController(env, { getUserId:() => owner, pending:{ put:async () => {}, delete:async () => {}, list:async () => [] } });
  t.after(() => client.reset());
  const click = async selector => { const target = document.querySelector(selector); assert(target, 'Missing ' + selector); await document.getElementById('fullMockPane').onclick({ target }); };
  const until = async fn => { const end = Date.now() + 6000; while (!await fn() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 5)); assert(await fn(), 'Client did not settle'); };
  return { ...f, env, document, client, click, requests, revoked, until, poll:async () => { for (const fn of intervals.values()) fn(); }, offline:value => { offline = value; }, intercept:value => { intercept = value; }, owner:value => { owner = value; env.sessionStorage.setItem('pte_session_token', value); } };
}
test('History opens a complete report without microphone/audio hardware; task navigation and media cleanup work', async t => {
  const f = await clientFixture(t); await f.client.open(); assert.match(f.document.getElementById('fullMockPane').textContent, /Score report/);
  await f.click('[data-fm="resume"]'); await f.until(() => f.document.querySelector('#fm-review-select'));
  assert.equal(f.document.querySelectorAll('.ipr-overall,.ipr-skill').length, 5); assert.equal(f.requests.some(row => row.route.endsWith('/claim')), false);
  await f.click('[data-fm="review-type"][data-type="rs"]'); const select = f.document.getElementById('fm-review-select'); assert.match(select.value, /fm1-rs-01/);
  await f.click('[data-fm="review-media"][data-kind="prompt"]'); assert(f.document.querySelector('#fm-review-prompt audio'));
  const request = f.requests.find(row => row.route.includes('/review/')); assert.equal(request.init.headers['x-session-token'], 'alice'); assert(!request.route.includes('alice'));
  await f.click('[data-fm="review-next"]'); assert.equal(f.document.querySelector('#fm-review-prompt audio'), null); assert.equal(f.revoked.length, 1);
  f.client.reset(); assert.equal(f.document.getElementById('fullMockPane').textContent, ''); assert.equal(f.calls(), 0);
});
test('A pending report recovers offline, explicitly retries incomplete work, and polls to a complete report', async t => {
  const f = await clientFixture(t), essay = paper.questions.find(row => row.question.type === 'essay');
  await f.service.store.update('alice', f.id, state => { state.assessment.items[essay.id].status = 'failed'; state.assessment.status = 'needs-attention'; return state; });
  await f.client.open({ attemptId:f.id }); await f.until(() => f.document.querySelector('.ipr-overall,.ipr-skill'));
  assert.match(f.document.querySelector('.ipr-overall').textContent, /Pending/); assert.equal(f.document.querySelector('[data-fm="assessment-retry"]').hidden, false);
  f.offline(true); await f.click('[data-fm="retry"]'); assert.match(f.document.getElementById('fm-notice').textContent, /Connection interrupted/);
  f.offline(false); await f.click('[data-fm="assessment-retry"]'); await f.service.assessor.drain();
  await f.poll(); await f.until(() => /All 65/.test(f.document.querySelector('.fm-report-status').textContent));
  assert.equal(f.calls(), 1); assert.equal(f.document.querySelector('[data-fm="assessment-retry"]').hidden, true);
  assert.equal(f.requests.filter(row => row.route.endsWith('/assessment') && row.init.method === 'POST').length, 1);
});
test('Delayed review media cannot attach after switching questions, leaving the report or changing accounts', async t => {
  const f = await clientFixture(t); await f.client.open({ attemptId:f.id }); await f.until(() => f.document.querySelector('#fm-review-select'));
  await f.click('[data-fm="review-type"][data-type="rs"]'); let release;
  f.intercept(async (route, init, send) => { if (route.includes('/review/')) { const reply = await send(); await new Promise(resolve => { release = resolve; }); return reply; } return send(); });
  const loading = f.click('[data-fm="review-media"][data-kind="prompt"]'); await f.until(() => release);
  await f.click('[data-fm="review-next"]'); release(); await loading; assert.equal(f.document.querySelector('#fm-review-prompt audio'), null);
  release = null; const second = f.click('[data-fm="review-media"][data-kind="prompt"]'); await f.until(() => release);
  f.client.reset(); f.owner('bob'); release(); await second; assert.equal(f.document.querySelector('audio[src]'), null);
});

test('Scheduled recovery displays pending feedback without asking the student to submit again',()=>{
 const state=complete(),id=paper.questions[0].id;state.assessment.status='needs-attention';state.assessment.recovery={status:'scheduled',retries:0,nextAt:30000};
 Object.assign(state.assessment.items[id],{status:'failed',result:{status:'failed',reason:'content-unavailable'}});
 const report=reports.buildReport(paper,state);assert.equal(report.ready,false);assert.equal(report.retryAvailable,false);assert.equal(report.assessmentStatus,'processing');
 assert.equal(report.items[0].assessment.label,'Assessment pending');assert.match(report.items[0].feedback.overview,/automatically/);
 state.assessment.recovery.status='exhausted';assert.equal(reports.buildReport(paper,state).retryAvailable,true);
});
