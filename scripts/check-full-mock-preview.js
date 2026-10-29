'use strict';
// Explicit, bounded paid checks for the isolated review deployment only.
// No credentials, recordings, transcripts or provider bodies go to stdout.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const ORIGIN = 'https://pte-full-mock-review-production.up.railway.app';
const EXPECTED_COMMIT = '290f037068514229de2efa7497f689f5db79f4e5';
const ROOT = path.resolve(__dirname, '..');
const SESSION = path.join(ROOT, '.cache/full-mock-preview-session.json');
const EVIDENCE = path.join(ROOT, '.cache/full-mock-preview-live.json');
const paper = require('../full-mock/paper').loadPaper();
const adapters = require('../full-mock/adapters');
const speech = require('../speaking-scoring');
const speechFormat = require('../speaking-judge-format');
const essayPolicy = require('../public/essay-scoring');
let requests = 0;
async function http(route, body, { token, method, bytes, expected = 200 } = {}) {
  assert(route.startsWith('/api/'), 'Only preview API routes are allowed.');
  assert(++requests <= 55, 'Preview request budget exhausted.');
  const headers = { ...(body || bytes ? { 'Content-Type': bytes ? 'audio/mpeg' : 'application/json' } : {}),
    ...(token ? { 'x-session-token': token } : {}), 'x-essay-scoring-version': essayPolicy.VERSION };
  const data = await new Promise((resolve, reject) => {
    const child = spawn('curl', ['--silent', '--show-error', '--max-time', '180', '-X', method || (body || bytes ? 'POST' : 'GET'),
      '-w', '\n%{http_code}', ...Object.entries(headers).flatMap(([k,v]) => ['-H', k + ': ' + v]),
      ...(body || bytes ? ['--data-binary', '@-'] : []), ORIGIN + route]);
    let output = ''; child.stdout.setEncoding('utf8'); child.stdout.on('data', value => { output += value; });
    child.stderr.resume(); child.on('error', () => reject(Error('Preview connection failed.')));
    child.on('close', code => {
      if (code) return reject(Error('Preview request did not finish.'));
      const end = output.lastIndexOf('\n'), status = Number(output.slice(end + 1));
      if (status !== expected) return reject(Error('Preview HTTP ' + status + ' for ' + route.replace(/\/attempts\/.*/, '/attempts/[redacted]')));
      try { resolve(JSON.parse(output.slice(0,end))); } catch { reject(Error('Preview returned an invalid response.')); }
    });
    child.stdin.on('error', () => {}); child.stdin.end(bytes || (body ? JSON.stringify(body) : undefined));
  });
  return data;
}
async function proxy(request) { return http('/api/claude', request); }
async function contentModel(prompt, context) {
  const model = context?.validationDiagnostic ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';
  return speechFormat.response(await proxy(speechFormat.request(prompt, model, context)), context);
}
async function main() {
  const mode = process.argv[2];
  if (!['--run-paid', '--verify-saved', '--dry-run'].includes(mode)) throw Error('Choose --dry-run, --run-paid or --verify-saved.');
  if (mode === '--dry-run') {
    for (const type of ['swt', 'essay', 'sst', 'di']) assert(paper.questions.find(c => c.question.type === type)?.question.sample);
    console.log('Preview scope and original fixtures verified; no requests made.'); return;
  }
  const checks = [], evidence = { schemaVersion:1, origin:ORIGIN, expectedSourceCommit:EXPECTED_COMMIT,
    localRuntimeContext:require('../full-mock/validation').runtimeContext(), paperHash:require('../full-mock/paper').digest(paper),
    scope:'Provider contract smoke; not a complete timed live-provider Full Mock or independent manual review.',
    startedAt:new Date().toISOString(), status:'incomplete', synthetic:true, calibrated:false, studentReleaseEnabled:false, checks };
  await fs.mkdir(path.dirname(SESSION), {recursive:true});
  if (mode === '--run-paid') await fs.writeFile(EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
  async function check(name, run) {
    const started = Date.now();
    try { const detail = await run(); checks.push({name,status:'passed',milliseconds:Date.now()-started,...detail}); }
    catch (error) { checks.push({name,status:'failed',milliseconds:Date.now()-started,error:error.message}); }
    console.log(JSON.stringify(checks.at(-1)));
    if (mode === '--run-paid') await fs.writeFile(EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
  }
  await check('readiness-and-authentication', async () => {
    const ready = await http('/api/ready'); assert.equal(ready.ready, true);
    await http('/api/full-mocks/catalog', null, {expected:401});
    await http('/api/admin/users', null, {expected:403});
    return {};
  });
  if (mode === '--verify-saved') {
    const saved = JSON.parse(await fs.readFile(SESSION, 'utf8'));
    assert.equal(saved.origin, ORIGIN);
    await check('postgres-persistence-after-app-restart', async () => {
      const login = await http('/api/auth/login', {username:saved.username,password:saved.password});
      assert.equal(login.success, true); assert(login.token);
      const state = await http('/api/sync/' + saved.username, null, {token:login.token});
      assert.equal(state.data?.scratch?.fullMockReviewMarker, saved.marker);
      const catalog = await http('/api/full-mocks/catalog', null, {token:login.token});
      assert.equal(catalog.available, false); assert.deepEqual(catalog.papers, []);
      if (saved.spoken) {
        const spokenLogin = await http('/api/auth/login', {username:'pppp',password:saved.spoken.password});
        assert.equal(spokenLogin.success,true);
        const attempt = await http('/api/speaking/attempts/' + saved.spoken.id,null,{token:spokenLogin.token});
        assert.equal(attempt.status,'submitted'); assert.equal(attempt.transcribed,true);
        assert.equal(attempt.recording.bytes,saved.spoken.bytes);
        assert.deepEqual(attempt.result.pronunciation,saved.spoken.pronunciation);
        assert.deepEqual(attempt.result.fluency,saved.spoken.fluency);
      }
      return {studentAccess:false};
    });
    const previous = JSON.parse(await fs.readFile(EVIDENCE, 'utf8'));
    previous.checks.push(...checks); previous.status = previous.checks.every(c => c.status === 'passed') ? 'passed' : 'needs-attention';
    previous.verificationRequests = requests;
    previous.finishedAt = new Date().toISOString(); await fs.writeFile(EVIDENCE, JSON.stringify(previous,null,2) + '\n');
    process.exitCode = checks.some(c => c.status !== 'passed') ? 1 : 0; return;
  }
  let session;
  await check('student-gate-and-persistence-write', async () => {
    session = {origin:ORIGIN,username:'fullmock-review-' + randomUUID().slice(0,8),password:randomBytes(32).toString('base64url'),marker:randomUUID()};
    const registered = await http('/api/auth/register', {username:session.username,password:session.password});
    assert.equal(registered.success, true); assert(registered.token); session.token = registered.token;
    await fs.writeFile(SESSION, JSON.stringify(session), {mode:0o600});
    const catalog = await http('/api/full-mocks/catalog', null, {token:session.token});
    assert.equal(catalog.available,false); assert.deepEqual(catalog.papers,[]);
    await http('/api/full-mocks/attempts', {id:randomUUID(),paperId:paper.id,checks:{microphone:true,playback:true}}, {token:session.token,expected:403});
    await http('/api/sync/' + session.username, {scratch:{fullMockReviewMarker:session.marker}}, {token:session.token});
    const saved = await http('/api/sync/' + session.username, null, {token:session.token});
    assert.equal(saved.data?.scratch?.fullMockReviewMarker,session.marker); return {studentAccess:false};
  });
  const { createJudgmentService } = require('../swt-judgment-service');
  const swt = require('../swt-scoring-policy'), format = require('../swt-judge-format');
  const judge = createJudgmentService({policyVersion:swt.POLICY_VERSION,buildPrompt:swt.buildJudgingPrompt,
    isComplete:(j,text,passage) => !swt.applyScoringPolicy(j,text,passage).needs_semantic_review,
    validationIssues:(j,text,passage) => swt.applyScoringPolicy(j,text,passage).assessment_issues,
    call:async (prompt, timeout, options) => format.response(await proxy(format.request(prompt,format.scoringModel(),options))) });
  const native = adapters.createAdapters({
    swtGrader:(q,text) => judge.judge(text,q.text,''),
    writingContentModel:async prompt => {
      const raw = await proxy({model:'claude-haiku-4-5-20251001',temperature:0,max_tokens:3000,messages:[{role:'user',content:prompt}]});
      assert.notEqual(raw.stop_reason,'max_tokens');
      return JSON.parse(raw.content.filter(c => c.type === 'text').map(c => c.text).join('\n').match(/\{[\s\S]*\}/)?.[0] || 'null');
    },
    essayGrader:{grade:(question,essay) => http('/api/essay/grade', {question,essay,sampleBand:'9',includeSample:false}, {token:session?.token})}
  });
  for (const type of ['swt','sst','essay']) await check('native-' + type + '-live-contract', async () => {
    const q = paper.questions.find(c => c.question.type === type).question;
    const result = await native.assess(q,{sealed:true,answer:[q.sample],segments:[]});
    assert.equal(result.status,'assessed',result.reason || 'Native assessment incomplete'); assert.equal(result.version,adapters.VERSION);
    assert.equal(result.gated,undefined); assert.equal(result.stages.writing.status,'complete');
    assert.equal(result.maximum,Object.values(adapters.maxima(q)).reduce((a,b) => a+b,0));
    return {version:result.version,scores:result.scores,maximum:result.maximum};
  });
  await check('describe-image-live-content-contract', async () => {
    const q = paper.questions.find(c => c.question.type === 'di').question;
    const result = await speech.grade(q,q.sample,contentModel,{academyDescribeImage:true});
    assert.equal(result.scoringMode,'ai'); assert.equal(result.contentStatus,'assessed');
    assert.equal(result.score_provisional,false); assert.equal(result.maximum,6);
    return {version:result.version,content:result.total,maximum:result.maximum};
  });
  await check('transcription-and-azure-native-speaking', async () => {
    // pppp is the existing native-speaking test identity, created only in this
    // new empty preview DB. Never reset or impersonate a pre-existing account.
    const password = randomBytes(32).toString('base64url');
    const registration = await http('/api/auth/register',{username:'pppp',password});
    assert.equal(registration.success,true); const token = registration.token;
    const catalog = await http('/api/full-mocks/catalog',null,{token}); assert.equal(catalog.available,false);
    const bank = require('../content/speaking-bank'), q = bank.questions.find(q => q.id === 'rs-1');
    const id = randomUUID(), route = '/api/speaking/attempts/' + id;
    await http('/api/speaking/attempts',{id,questionId:q.id},{token});
    const bytes = await fs.readFile(path.join(ROOT,'content/speaking-audio/rs-1.mp3'));
    await http(route + '/recording',null,{token,bytes});
    let transcription, delivery;
    const spoken = adapters.createAdapters({
      transcribe:async () => (transcription = await http(route + '/transcribe',{}, {token})).transcript,
      assessDelivery:async () => (delivery = await http(route + '/submit',{}, {token})).result
    });
    const result = await spoken.assess(q,{sealed:true,segments:[{chunkCount:1}]},{recording:{mime:'audio/mpeg',data:bytes.toString('base64')}});
    assert.equal(transcription.transcribed,true); assert.equal(result.status,'assessed');
    assert.equal(result.stages.transcription.status,'complete'); assert.equal(result.stages.delivery.status,'complete');
    assert.equal(delivery.result.deliveryProvider,'azure-speech-pronunciation');
    const reopened = await http(route,null,{token}); assert.equal(reopened.status,'submitted');
    assert.equal(reopened.recording.bytes,bytes.length);
    if (session) {
      session.spoken = {password,id,bytes:bytes.length,pronunciation:reopened.result.pronunciation,fluency:reopened.result.fluency};
      await fs.writeFile(SESSION,JSON.stringify(session),{mode:0o600});
    }
    return {fixture:'existing native RS original audio',version:result.version,scores:result.scores,deliveryProvider:delivery.result.deliveryProvider};
  });
  evidence.finishedAt = new Date().toISOString(); evidence.requests = requests;
  evidence.status = checks.every(c => c.status === 'passed') ? 'passed' : 'needs-attention';
  await fs.writeFile(EVIDENCE, JSON.stringify(evidence,null,2) + '\n');
  process.exitCode = evidence.status === 'passed' ? 0 : 1;
}
if(require.main === module) main().catch(() => {console.error('Preview validation could not finish; saved evidence remains incomplete.');process.exitCode=1;});
module.exports = { ORIGIN };
