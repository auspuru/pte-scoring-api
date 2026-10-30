'use strict';
const { randomUUID } = require('node:crypto');
const { scoringSnapshot } = require('./audit');
const { digest, deepFreeze, loadPaper } = require('./paper');
const { aggregate, inputHash, nativeValid } = require('./aggregation');
const { SPOKEN, createAdapters, maxima, VERSION: adapterVersion } = require('./adapters');
const { fail } = require('./store');
const media = require('./recording');
const weighting = require('./profiles');
const VERSION = 'full-mock-assessment-2026-10-29.1';
function configuration(env = process.env) {
  const content = env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
  const essay = require('../essay-provider').configuration(env);
  return {
    transcription: { provider: 'openai', model: env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe' },
    speakingContent: { provider: 'anthropic', model: content, reviewModel: 'claude-sonnet-4-6', describeImagePolicy: require('../describe-image-academy').VERSION },
    delivery: { provider: 'azure-speech-pronunciation', model: 'provider-managed', locale: env.AZURE_SPEECH_LOCALE || 'en-AU', version: require('../speaking-delivery').VERSION },
    swt: { provider: 'anthropic', model: env.SWT_CLAUDE_MODEL || 'claude-sonnet-4-6', reviewModel: env.SWT_REVIEW_MODEL || env.SWT_CLAUDE_MODEL || 'claude-sonnet-4-6' },
    essay: { ...essay, reviewModel: essay.provider === 'openai' ? essay.model : env.CLAUDE_REASSESSMENT_MODEL || 'claude-sonnet-4-6', reasoningEffort: env.ESSAY_OPENAI_REASONING_EFFORT || 'medium' },
    sst: { provider: 'anthropic', model: content }
  };
}
function snapshot(config = configuration(), root = require('node:path').resolve(__dirname, '..'), paper = loadPaper()) {
  const allowed = configuration({});
  if (!config || Object.keys(config).sort().join() !== Object.keys(allowed).sort().join()) throw Error('Concrete provider configuration is required.');
  for (const [name, fields] of Object.entries(allowed)) {
    if (!config[name] || Object.keys(config[name]).sort().join() !== Object.keys(fields).sort().join()
      || Object.values(config[name]).some(value => typeof value !== 'string' || !value.trim() || value.length > 200 || /sk-|Bearer\s|https?:/i.test(value))) throw Error('Only provider/model metadata belongs in an assessment snapshot.');
  }
  return deepFreeze({ schemaVersion: 1, version: VERSION, configuration: structuredClone(config), scoringSources: scoringSnapshot(root),
    paperHash: digest(paper), nativeMaxima: Object.fromEntries(paper.questions.map(candidate => [candidate.id, maxima(candidate.question)])),
    weighting: structuredClone(weighting.SNAPSHOT), calibration: 'uncalibrated', official: false });
}
function stateFor(value) { return { version: VERSION, snapshot: structuredClone(value), snapshotHash: digest(value), status: 'not-requested', run: 0, items: {} }; }
// Exact production baselines may adopt these audited transport/recovery fixes.
// Native graders, models, weights, paper and saved successful grades stay pinned.
const COMPATIBLE_BASES = [
  [require('../content/full-mock/automatic-recovery-compatible-sources.json'), 'f49a6e3c4385918f9e83820c330518e13fb0e3eb202fb1ae1dbe9e847108a4ef'],
  [require('../content/full-mock/assessment-completion-compatible-sources.json'), 'ddaf791fda201c7b3424f6dc298472fd646d623a8b4bd8b104d8eea998b712d0'],
  [require('../content/full-mock/navigation-compatible-sources.json'), '348f9fb6beac5e43e1cc1d58ff4125414a44864799bd53354d6c194a375e6749'],
  [require('../content/full-mock/access-compatible-sources.json'), '275016a6cdf793dbd6ef7a0750bc10294a601d87ab8e4e0faa74418ea2419556'],
  [require('../content/full-mock/media-compatible-sources.json'), '50f715d2da0f112e96756269018adcbb9b642701f361d31958f2fa990947d88b'],
  [require('../content/full-mock/alerts-compatible-sources.json'), '7fe217fe37f2b2e2803d911b1de3db15ccb8170f57523502508f2e0b46e2d42d']
];
function compatibleTransportUpgrade(saved, current) {
  const baseline = COMPATIBLE_BASES.find(([value, hash]) => digest(value) === hash && digest(saved.scoringSources) === hash)?.[0];
  if (!baseline) return false;
  const allowed = new Set(['full-mock/access.js','full-mock/api.js','full-mock/assessment.js','full-mock/recording.js','full-mock/store.js','full-mock/report.js']);
  // Alert wiring does not change a grader. Permit only the reviewed before/after
  // server pair, rather than allowing arbitrary future changes to server.js.
  if(baseline.files['server.js'].sha256==='14980c74f5a99b1ef65b656550a790b2469c5ed86cd0c4c2e1eff3c590768d8e'
    && current.scoringSources.files['server.js'].sha256===ALERT_SERVER_SHA256)allowed.add('server.js');
  const before = baseline.files, after = current.scoringSources.files;
  // Only the audited practice-navigation revision may change this shared file.
  // Its exported transcription function is byte-for-byte unchanged.
  if (before['speaking-lab.js']?.sha256 === '76cd004fe38a26819d0621a985a12c439daaeaebaeda6f58b92e4120c40a7cb1'
    && after['speaking-lab.js']?.sha256 === '759f6aa54529eb5979aae0bb87b4663fabcf9ea0da3b3c61ecbf7972fadaf479') allowed.add('speaking-lab.js');
  // This exact revision changes only assessment completion options: independent
  // delivery evidence, explicit DI review and the Essay time budget. Retain marks.
  if (before['full-mock/adapters.js']?.sha256 === '940e500ccad7169994e3637557b3511c37e64489e626bdb803b13056559326f2'
    && after['full-mock/adapters.js']?.sha256 === '41132b2eee6c0fd9402b6f6ee3831118f951fc48547037f8f2412f63fe280e76') allowed.add('full-mock/adapters.js');
  if (Object.keys(before).sort().join() !== Object.keys(after).sort().join()
    || Object.keys(before).some(name => !allowed.has(name) && digest(before[name]) !== digest(after[name]))) return false;
  return digest({ ...saved, scoringSources:current.scoringSources }) === digest(current);
}
const ALERT_SERVER_SHA256='a952f788eb10c493a3614796bf5b5d8f9af985a51f23e6ffb681e6cd22886459';
function recoverableUploadDelay(job, response) {
  const segments = response?.segments.filter(value => !value.cancelled && value.chunkCount !== 0) || [];
  return job?.status === 'pending' && job.reason === 'late-recording' && segments.length === 1
    && !segments[0].lateActivation && segments[0].finished && segments[0].chunkCount > 0;
}
const RECOVERY_DELAYS = [30000, 120000];
const RECOVERY_REASONS = new Set(['transcription-unavailable','content-unavailable','delivery-unavailable','writing-unavailable']);
function canRecover(job) {
  return job?.status === 'failed' && RECOVERY_REASONS.has(job.result?.reason || job.reason)
    && !Object.values(job.stages || {}).some(stage => stage.uncertain);
}
function scheduleRecovery(assessment, at) {
  const recovery = assessment.recovery;
  if (!recovery) return; // Older held attempts require an explicit request to arm recovery.
  delete recovery.nextAt;
  if (assessment.status === 'complete') { recovery.status = 'complete'; return; }
  if (assessment.status === 'processing') return;
  if (!Object.values(assessment.items).some(canRecover)) { recovery.status = 'held'; return; }
  if (recovery.retries >= RECOVERY_DELAYS.length) { recovery.status = 'exhausted'; return; }
  recovery.status = 'scheduled'; recovery.nextAt = at + RECOVERY_DELAYS[recovery.retries];
}
function createEngine({ store, adapters = createAdapters(), providerConfiguration = configuration(), now = Date.now, assemble = media.assemble, concurrency = 2, paper = loadPaper() } = {}) {
  const currentSnapshot = snapshot(providerConfiguration, undefined, paper), currentHash = digest(currentSnapshot), jobs = new Map(); let sweep, closing = false, recovering = false; const recoveryErrors = new Set();
  function validate(state) {
    const saved = state.assessment;
    if (!saved || digest(saved.snapshot) !== saved.snapshotHash || saved.version !== VERSION || saved.snapshot.paperHash !== state.paperHash
      || saved.snapshotHash !== currentHash && !compatibleTransportUpgrade(saved.snapshot, currentSnapshot)) throw fail('This attempt uses a different assessment version. Its saved answers and results are retained.', 409);
  }
  async function request(uid, id, { retry = false } = {}) {
    const saved = await store.get(uid, id); if (!saved) throw fail('Attempt not found.', 404);
    const state = await store.update(uid, id, state => {
      if (state.status !== 'submitted') throw fail('Submit the test before requesting assessment.');
      state.assessment ||= stateFor(currentSnapshot); validate(state);
      if (state.assessment.status === 'processing' || state.assessment.status === 'complete' && aggregate(saved.paper, state).ready) return state;
      if (state.assessment.run && !retry) return state;
      state.assessment.recovery ||= { version:1, retries:0 };
      state.assessment.recovery.status = 'armed'; delete state.assessment.recovery.nextAt; delete state.assessment.recovery.automaticRun;
      state.assessment.status = 'processing'; state.assessment.run++; state.assessment.requestedAt = now(); return state;
    });
    if (state.assessment.status === 'processing') queue(uid, id);
    return state;
  }
  async function wakeMedia(uid, id) {
    const record = await store.get(uid, id); if (!record?.state.assessment) return;
    const changed = record.paper.questions.some((candidate, index) => {
      const job = record.state.assessment.items[candidate.id]; return SPOKEN.has(candidate.question.type) && ['pending','assessed'].includes(job?.status) && (job.inputHash !== inputHash(record.state.responses[index + 1]) || recoverableUploadDelay(job, record.state.responses[index + 1]));
    });
    if (!changed) return record.state;
    const state = await store.update(uid, id, state => { validate(state); if (state.assessment.status !== 'processing') state.assessment.status = 'processing'; return state; });
    queue(uid, id); return state;
  }
  function queue(uid, id) {
    const key = uid + ':' + id; if (closing || jobs.has(key) || jobs.size >= concurrency) return jobs.get(key);
    const task = work(uid, id); jobs.set(key, task); task.catch(() => {}).finally(() => jobs.delete(key)); return task;
  }
  async function work(uid, id) {
    const lease = randomUUID(); let claimed = false;
    let state = await store.update(uid, id, state => {
      claimed = false; validate(state);
      if (state.status !== 'submitted' || state.assessment.status !== 'processing' || state.assessment.lease?.expiresAt > now()) return state;
      state.assessment.recovery ||= { version:1, retries:0, status:'armed' };
      state.assessment.lease = { id: lease, expiresAt: now() + 180000 }; claimed = true; return state;
    });
    if (!claimed) return;
    const record = await store.get(uid, id), savedPaper = record.paper, attemptHash = state.assessment.snapshotHash;
    if (digest(savedPaper) !== state.paperHash) throw fail('Saved paper integrity failed.', 503);
    async function save(update) {
      return store.update(uid, id, current => {
        validate(current); if (current.assessment.lease?.id !== lease) throw fail('The assessment worker was replaced.');
        update(current); current.assessment.lease.expiresAt = now() + 180000; return current;
      });
    }
    const heartbeat = setInterval(() => save(() => {}).catch(() => {}), 15000); heartbeat.unref?.();
    let index = 0;
    async function itemWorker() {
      while (!closing && index < savedPaper.questions.length) {
        const position = index++, candidate = savedPaper.questions[position], q = candidate.question;
        const saved = await store.get(uid, id), response = saved.state.responses[position + 1];
        if (!response?.sealed) continue;
        const fingerprint = inputHash(response), previous = saved.state.assessment.items[candidate.id];
        if (previous?.inputHash === fingerprint && previous.snapshotHash === attemptHash && previous.status === 'assessed') continue;
        if (state.assessment.recovery?.automaticRun === state.assessment.run && previous?.inputHash === fingerprint
          && previous.snapshotHash === attemptHash && previous.status === 'failed' && !canRecover(previous)) continue;
        const stages = previous?.inputHash === fingerprint && previous.snapshotHash === attemptHash ? previous.stages : {};
        const persist = async patch => save(current => {
          if (inputHash(current.responses[position + 1]) !== fingerprint) throw fail('Saved media changed while assessment was running.');
          const prior = current.assessment.items[candidate.id];
          current.assessment.items[candidate.id] = { ...(prior?.inputHash === fingerprint && prior.snapshotHash === attemptHash ? prior : {}), inputHash: fingerprint, snapshotHash: attemptHash, ...patch };
        });
        try {
          await persist({ status: 'processing', stages });
          let recording;
          if (SPOKEN.has(q.type) && response.segments.some(value => !value.cancelled && value.chunkCount !== 0)) {
            const audio = await assemble(uid, id, q, response, { getChunk: store.getChunk });
            if (audio.status !== 'ready') { await persist({ status: 'pending', reason: audio.reason || 'recording-not-ready' }); continue; }
            recording = audio.recording;
          }
          const value = await adapters.assess(q, response, { recording, previous: stages, run: state.assessment.run,
            checkpoint: value => persist({ status: 'processing', stages: value }) });
          const { stages: evidence = stages, ...result } = value;
          if (!['assessed','pending','failed'].includes(result.status) || result.status === 'assessed' && (result.version !== adapterVersion || !nativeValid(result, maxima(q)))) throw Error('Invalid native assessment result.');
          await persist({ status: result.status, result, stages: evidence, assessedAt: now() });
        } catch { try { await persist({ status: 'failed', reason: 'assessment-unavailable' }); } catch { /* Stale workers never overwrite replacements. */ } }
      }
    }
    try {
      await Promise.all([itemWorker(), itemWorker()]);
      state = await save(current => { current.assessment.status = aggregate(savedPaper, current).ready ? 'complete' : closing ? 'processing' : 'needs-attention'; if (!closing) { current.assessment.finishedAt = now(); scheduleRecovery(current.assessment, now()); } });
      await store.update(uid, id, current => { if (current.assessment.lease?.id === lease) delete current.assessment.lease; return current; });
      const result = aggregate(savedPaper, state);
      console.info('[full-mock-assessment]', JSON.stringify({ uid, id, status:state.assessment.status, assessedCount:result.assessedCount, pendingReasons:[...new Set(Object.values(state.assessment.items).filter(item => item.status !== 'assessed').map(item => item.result?.reason || item.reason || item.status))] }));
    } finally { clearInterval(heartbeat); }
  }
  async function results(uid, id) {
    const record = await store.get(uid, id); if (!record) throw fail('Attempt not found.', 404);
    if (record.state.assessment && digest(record.state.assessment.snapshot) !== record.state.assessment.snapshotHash) throw fail('Saved assessment integrity failed.', 503);
    return aggregate(record.paper, record.state);
  }
  async function resumeAutomatically(uid, id) {
    const state = await store.update(uid, id, state => {
      const a = state.assessment, r = a?.recovery;
      if (state.status !== 'submitted' || a?.status !== 'needs-attention' || r?.status !== 'scheduled'
        || !Number.isFinite(r.nextAt) || r.nextAt > now() || r.retries >= RECOVERY_DELAYS.length) return state;
      validate(state);
      if (!Object.values(a.items).some(canRecover)) { r.status = 'held'; delete r.nextAt; return state; }
      a.status = 'processing'; a.run++; a.requestedAt = now();
      r.retries++; r.status = 'running'; r.automaticRun = a.run; delete r.nextAt;
      return state;
    });
    if (state.assessment?.status === 'processing') queue(uid, id);
    return state.assessment?.status === 'processing';
  }
  async function recover() {
    if (closing || recovering) return; recovering = true;
    try {
      for (const row of await store.assessmentQueue(now())) {
        if (jobs.size >= concurrency) break;
        try {
          if (row.status === 'needs-attention') { if (!await resumeAutomatically(row.uid, row.id)) await wakeMedia(row.uid, row.id); }
          else queue(row.uid, row.id);
        } catch (error) {
          if (!recoveryErrors.has(row.id)) {
            recoveryErrors.add(row.id); if (recoveryErrors.size > 1000) recoveryErrors.delete(recoveryErrors.values().next().value);
            console.warn('[full-mock-recovery]', JSON.stringify({id:row.id, code:error.status || 'unavailable'}));
          }
        }
      }
    } finally { recovering = false; }
  }
  function start() { closing = false; if (!sweep) {
    sweep = setInterval(() => recover().catch(() => {}), 10000); sweep.unref?.(); recover().catch(() => {});
    console.info('[full-mock-recovery]', JSON.stringify({event:'monitor_ready',maxAutomaticRetries:RECOVERY_DELAYS.length,backoffMs:RECOVERY_DELAYS}));
  } }
  function stop() { closing = true; clearInterval(sweep); sweep = null; return drain(); }
  async function drain() { await Promise.allSettled([...jobs.values()]); }
  return { snapshot: currentSnapshot, request, wakeMedia, results, recover, start, stop, drain, jobs };
}
module.exports = { VERSION, configuration, snapshot, stateFor, createEngine };
