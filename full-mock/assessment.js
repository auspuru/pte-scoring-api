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
function legacyConfiguration(env = process.env) {
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
function configuration(env = process.env) {
  const previous = legacyConfiguration(env);
  const content = require('../mock-content-provider').configuration();
  return { ...previous,
    speakingContent:{...previous.speakingContent,...content,reviewModel:content.model},
    swt:{...previous.swt,...content,reviewModel:content.model},
    essay:{...previous.essay,...content,reviewModel:content.model,reasoningEffort:require('../mock-content-provider').REASONING_EFFORT},
    sst:{...content}
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
  [require('../content/full-mock/unattended-recovery-compatible-sources.json'), '3206f5b41431719469205fab45e5ac5447b3b4ddcc4a470e437b1af6cdfb46c2'],
  [require('../content/full-mock/practice-queue-compatible-sources.json'), 'a5f44654e3b334187b9a39b6ad87d34d8372a045c55c74e635cca1bd1c035771'],
  [require('../content/full-mock/tester-guide-compatible-sources.json'), '8fe1413d7881be3a14a0835747cc8bd86c4c09ed2e97c0d6bcd358f4109367e3'],
  [require('../content/full-mock/content-provider-compatible-sources.json'), '9b13a955f7ab351a65742fe33c14b8a33f6b53bcfa6d16547c62cd478f359b11'],
  [require('../content/full-mock/automatic-recovery-compatible-sources.json'), 'f49a6e3c4385918f9e83820c330518e13fb0e3eb202fb1ae1dbe9e847108a4ef'],
  [require('../content/full-mock/assessment-completion-compatible-sources.json'), 'ddaf791fda201c7b3424f6dc298472fd646d623a8b4bd8b104d8eea998b712d0'],
  [require('../content/full-mock/navigation-compatible-sources.json'), '348f9fb6beac5e43e1cc1d58ff4125414a44864799bd53354d6c194a375e6749'],
  [require('../content/full-mock/access-compatible-sources.json'), '275016a6cdf793dbd6ef7a0750bc10294a601d87ab8e4e0faa74418ea2419556'],
  [require('../content/full-mock/media-compatible-sources.json'), '50f715d2da0f112e96756269018adcbb9b642701f361d31958f2fa990947d88b'],
  [require('../content/full-mock/account-compatible-sources.json'), 'c79dfc773e68390d473d08bf4e37544cb549bbf5d4e383b2245fc35dc7532e41'],
  [require('../content/full-mock/alerts-compatible-sources.json'), '7fe217fe37f2b2e2803d911b1de3db15ccb8170f57523502508f2e0b46e2d42d'],
  [require('../content/full-mock/practice-mode-compatible-sources.json'), 'f4e704c74e86c0e43d31c4c4167c3bc637540737ba08de68ba0fa79fd46baaf4'],
  [require('../content/full-mock/question-content-compatible-sources.json'), '97cebe2ecb2d51a2da15d0aea1004dbd33d7ab1c79ded0174afbc38893fbb458'],
  [require('../content/full-mock/feedback-compatible-sources.json'), '85e89a7ca24556fc4b2d579d179492d67c66d995e5bc6c7e2f8635b18121e20e']
];
// This projection is used only to finish frozen attempts with their OLD
// adapters/configuration. It cannot turn a Claude grade into a GPT grade.
// Exact hashes prevent future source drift from inheriting this exception.
const CONTENT_WIRING_HASHES = {
  'server.js':'937a9f1e0cf80786c104e3d73302ca93d9dd31a0fa39698193ae3f887ea25491',
  'full-mock/audit.js':'d85b73b2572bff1ef78354a49daf0521fff84bdf14b5d0ff25ef5503d231c5ba',
  'mock-content-provider.js':'3efa737c0e2a8ae047bd24b0c140f6cc2c67e2329cb3184950ef38bb1f5e8492',
  'mock-content-assessment.js':'f418438dd65ac47a81ee93faf62dbae5e5c7d7aa92c0ee4e30cb0d8eaa984253'
};
function practiceModeSources(current) {
  const baseline=require('../content/full-mock/practice-mode-compatible-sources.json');
  if(digest(baseline)!=='f4e704c74e86c0e43d31c4c4167c3bc637540737ba08de68ba0fa79fd46baaf4'||current.files['speaking-lab.js']?.sha256!=='973a90665f61eb44041e8132cc825c9a42d39be971701b3cbe3867c1d8c41308')return current;
  const projected=structuredClone(current);projected.files['speaking-lab.js']=structuredClone(baseline.files['speaking-lab.js']);return projected;
}
function accountSources(current) {
  const [baseline,expected]=COMPATIBLE_BASES.find(([value])=>value===require('../content/full-mock/account-compatible-sources.json'));
  if(digest(baseline)!==expected||current.files['server.js']?.sha256!=='6343f2feba3d4ec580508e43771d9c0acbc74837aae84ec5dd1dff4dfd24a222')return current;
  const projected=structuredClone(current);projected.files['server.js']=structuredClone(baseline.files['server.js']);return projected;
}
function transportSources(current) {
  const files = current.files, [baseline,baselineHash] = COMPATIBLE_BASES.find(([value])=>value===require('../content/full-mock/content-provider-compatible-sources.json'));
  if (digest(baseline) !== baselineHash
    || Object.entries(CONTENT_WIRING_HASHES).some(([name,sha]) => files[name]?.sha256 !== sha)) return current;
  const projected = structuredClone(current);
  for (const name of Object.keys(CONTENT_WIRING_HASHES)) {
    if (baseline.files[name]) projected.files[name] = structuredClone(baseline.files[name]);
    else delete projected.files[name];
  }
  // Practice-only changes share source files with the frozen mock dependency
  // manifest. The native Reading scorer and transcription function are unchanged.
  // Only this reviewed pair of exact source revisions may project to the old pins.
  const [practice,practiceHash]=COMPATIBLE_BASES.find(([value])=>value===require('../content/full-mock/tester-guide-compatible-sources.json'));
  if(digest(practice)===practiceHash &&
    files['public/reading-practice.js']?.sha256==='b3dab5bb17ec4028c6ea80e447fb0cf316fd7582badcfbc466279eeb9913d862' &&
    files['speaking-lab.js']?.sha256==='15e7b543c49ab8e290b5f430a6e9ebd5e7c46da3b147311a62d562ce10a13150') {
    for(const name of ['public/reading-practice.js','speaking-lab.js'])projected.files[name]=structuredClone(practice.files[name]);
  }
  return projected;
}
function compatibleTransportUpgrade(saved, current) {
  // Explicit instructor audio exclusions are additive metadata. These exact
  // revisions preserve every native grader, model, weight and original result.
  const exclusionBaseline=require('../content/full-mock/audio-exclusion-compatible-sources.json');
  const exclusionPins={"full-mock/audit.js":"cb14bda7e8a6a1a5ab12a56058ab044dc670f3c42da1084041d5d28c9f79b494","full-mock/aggregation.js":"f4b7a071e74520288d799a7a0477c01be1b603f3d72477ce3434353c356f1863","full-mock/exclusions.js":"28e5e0f7b6ac5897efa49cdc2be05c418dee7034ad5eaef021f38f80d705fafe","full-mock/api.js":"043f78fd660ae2f96c19b42f7d491203555d17904c2a025ba2111f4ac9c6634d","full-mock/report.js":"a85fda2fe0d90a75b044837fcf06f045edba283b0c210fc20827de2234eaaee1","server.js":"f7a1a04a570e13bcac8e158ca6744fb71e14b7986080e1229038c69b6530b742"};
  if(digest(exclusionBaseline)==='2a399fe767a214a45ca3584fad8b9e7fd03c4dbcb4d53d6f15e66e9b9e446ce1' && Object.entries(exclusionPins).every(([file,sha])=>current.scoringSources.files[file]?.sha256===sha)) {
    const sources=structuredClone(current.scoringSources);
    for(const file of Object.keys(exclusionPins)) {
      if(exclusionBaseline.files[file])sources.files[file]=structuredClone(exclusionBaseline.files[file]);
      else delete sources.files[file];
    }
    // Assessment orchestration already permits reviewed transport revisions.
    sources.files['full-mock/assessment.js']=structuredClone(exclusionBaseline.files['full-mock/assessment.js']);
    current={...current,scoringSources:sources};
    if(digest(saved)===digest(current))return true;
  }
  // Reviewed DI practice catalogue/snapshot changes do not affect a frozen
  // Full Mock grader or its transcription function. Normalize only this exact
  // source pair before the existing historical compatibility projections.
  const diBaseline=require('../content/full-mock/di-reference-compatible-sources.json');
  if(digest(diBaseline)==='c305c6a6c5289f2416157300be3bc8620f21e7b5676c9d6b1924a31bb18ef65e' && current.scoringSources.files['speaking-lab.js']?.sha256==='e145fd88f91c38823251827571279c0762a76ce0bed6ddc8f9d020dfbf745de5') {
    const sources=structuredClone(current.scoringSources);
    sources.files['speaking-lab.js']=structuredClone(diBaseline.files['speaking-lab.js']);
    current={...current,scoringSources:sources};
    if(digest(saved.scoringSources)==='c305c6a6c5289f2416157300be3bc8620f21e7b5676c9d6b1924a31bb18ef65e') {
      const before=diBaseline.files,after=sources.files;
      if(Object.keys(before).sort().join()!==Object.keys(after).sort().join()
        ||Object.keys(before).some(name=>name!=='full-mock/assessment.js'&&digest(before[name])!==digest(after[name])))return false;
      return digest({...saved,scoringSources:sources})===digest(current);
    }
  }
  // Reviewed recovery scheduling/failure metadata only. Project these exact
  // transport revisions before comparing frozen native scoring dependencies.
  const recoveryBaseline=require('../content/full-mock/unattended-recovery-compatible-sources.json');
  const recoveryPins={'server.js':'aaefe394b205162a28edac3a6d2de2aaa2effe771dea9e79ed7e933b49269684','full-mock/adapters.js':'03c75d443499754f79bb413d7259a5e3d1256bb2662e96a1251876a040767ed7','public/writing-lab-report.js':'a7af66b3c6a2ea981ad765989d1515ca6253d701de70a880d7be6967405a7236'};
  if(digest(recoveryBaseline)==='3206f5b41431719469205fab45e5ac5447b3b4ddcc4a470e437b1af6cdfb46c2'&&Object.entries(recoveryPins).every(([file,sha])=>current.scoringSources.files[file]?.sha256===sha)){
    const sources=structuredClone(current.scoringSources);
    for(const file of Object.keys(recoveryPins))sources.files[file]=structuredClone(recoveryBaseline.files[file]);
    current={...current,scoringSources:sources};
  }

  // Reviewed queue/UI changes only; native Reading scoring and clocks are
  // unchanged. Project this exact source revision before legacy comparisons.
  if(digest(saved.scoringSources)!==digest(recoveryBaseline)&&current.scoringSources.files['public/reading-practice.js']?.sha256==='002b102f1b879cc979538f85b3cdffcecb05bcf6097206ea9bfb74873f8b357b') {
    const sources=structuredClone(current.scoringSources);
    sources.files['public/reading-practice.js'].sha256='b3dab5bb17ec4028c6ea80e447fb0cf316fd7582badcfbc466279eeb9913d862';
    current={...current,scoringSources:sources};
  }
  const feedbackOnly=['3206f5b41431719469205fab45e5ac5447b3b4ddcc4a470e437b1af6cdfb46c2','85e89a7ca24556fc4b2d579d179492d67c66d995e5bc6c7e2f8635b18121e20e','a5f44654e3b334187b9a39b6ad87d34d8372a045c55c74e635cca1bd1c035771'].includes(digest(saved.scoringSources));
  if(!feedbackOnly)current={...current,scoringSources:practiceModeSources(current.scoringSources)};
  const practiceModeOnly=digest(saved.scoringSources)==='f4e704c74e86c0e43d31c4c4167c3bc637540737ba08de68ba0fa79fd46baaf4';
  // This baseline already contains the latest account transport. Older baselines
  // still use the exact account projection below; no scorer or model is relaxed.
  const questionContentBase = COMPATIBLE_BASES.find(([value])=>value===require('../content/full-mock/question-content-compatible-sources.json'));
  const contentOnly = feedbackOnly || digest(questionContentBase[0]) === questionContentBase[1] && digest(saved.scoringSources) === questionContentBase[1];
  if (!contentOnly && !practiceModeOnly) current={...current,scoringSources:accountSources(current.scoringSources)};
  const accountBase=COMPATIBLE_BASES.find(([value])=>value===require('../content/full-mock/account-compatible-sources.json'));
  const [practice,practiceHash]=COMPATIBLE_BASES.find(([value])=>value===require('../content/full-mock/tester-guide-compatible-sources.json'));
  if(contentOnly||practiceModeOnly){
    // Only the frozen paper loader and the worker's paper lookup changed.
  }else if(digest(accountBase[0])===accountBase[1]&&digest(saved.scoringSources)===accountBase[1]){
    // This exact account-only upgrade keeps all native sources and saved marks.
  }else if(digest(practice)===practiceHash&&digest(saved.scoringSources)===practiceHash){
    const sources=structuredClone(current.scoringSources);
    if(sources.files['public/reading-practice.js']?.sha256==='b3dab5bb17ec4028c6ea80e447fb0cf316fd7582badcfbc466279eeb9913d862'&&
      sources.files['speaking-lab.js']?.sha256==='15e7b543c49ab8e290b5f430a6e9ebd5e7c46da3b147311a62d562ce10a13150'){
      for(const name of ['public/reading-practice.js','speaking-lab.js'])sources.files[name]=structuredClone(practice.files[name]);
    }
    current={...current,scoringSources:sources};
  }else current = {...current,scoringSources:transportSources(current.scoringSources)};
  const baseline = COMPATIBLE_BASES.find(([value, hash]) => digest(value) === hash && digest(saved.scoringSources) === hash)?.[0];
  if (!baseline) return false;
  const allowed = new Set(['full-mock/access.js','full-mock/api.js','full-mock/assessment.js','full-mock/recording.js','full-mock/store.js','full-mock/report.js']);
  // Alert wiring does not change a grader. Permit only the reviewed before/after
  // server pair, rather than allowing arbitrary future changes to server.js.
  if(baseline.files['server.js'].sha256==='14980c74f5a99b1ef65b656550a790b2469c5ed86cd0c4c2e1eff3c590768d8e'
    && current.scoringSources.files['server.js'].sha256===ALERT_SERVER_SHA256)allowed.add('server.js');
  const before = baseline.files, after = current.scoringSources.files;
  // Allow exactly the versioned content-loader revision. Native graders, the
  // saved paper hash, its maxima, configuration and successful marks stay pinned.
  if (before['full-mock/paper.js']?.sha256 === '042f2b4cc8c48b359f8514804c22f9717d81c9c381429a8645df53fb659a0ce7'
    && after['full-mock/paper.js']?.sha256 === 'b2d7c30ef08994db7e01aa71a644243ebe66a1b0d10a0590099d03c8f72de8e6') allowed.add('full-mock/paper.js');
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
const RECOVERY_DELAYS = require('../mock-recovery-policy').DELAYS;
const RECOVERY_REASONS = new Set(['transcription-unavailable','content-unavailable','delivery-unavailable','writing-unavailable']);
function canRecover(job) {
  return job?.status === 'failed' && RECOVERY_REASONS.has(job.result?.reason || job.reason)
    && !Object.values(job.stages || {}).some(stage => stage.uncertain || stage.recoveryBlocked);
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
function createEngine({ store, adapters = createAdapters(), providerConfiguration = configuration(), legacyAdapters, legacyProviderConfiguration,
  now = Date.now, assemble = media.assemble, concurrency = 2, paper = loadPaper() } = {}) {
  const currentSnapshot = snapshot(providerConfiguration, undefined, paper), jobs = new Map(); let sweep, closing = false, recovering = false; const recoveryErrors = new Set();
  // New attempts use the active paper. In-flight attempts continue against the
  // explicitly retained frozen paper, rather than adopting replacement questions.
  const trustedPapers = new Map([paper, loadPaper('full-mock-1', 1)].map(value => [digest(value), value]));
  const trustedSnapshots = new Map([...trustedPapers].map(([paperHash, value]) => {
    const current = paperHash === currentSnapshot.paperHash ? currentSnapshot : snapshot(providerConfiguration, undefined, value);
    return [paperHash, { current, hash: digest(current),
      legacy: legacyAdapters && legacyProviderConfiguration ? snapshot(legacyProviderConfiguration, undefined, value) : null }];
  }));
  function validate(state) {
    const saved = state.assessment, trusted = trustedSnapshots.get(state.paperHash);
    if (trusted && saved && digest(saved.snapshot) === saved.snapshotHash && saved.version === VERSION && saved.snapshot.paperHash === state.paperHash) {
      if (saved.snapshotHash === trusted.hash || compatibleTransportUpgrade(saved.snapshot,trusted.current)) return adapters;
      if (trusted.legacy && compatibleTransportUpgrade(saved.snapshot,trusted.legacy)) return legacyAdapters;
    }
    throw fail('This attempt uses a different assessment version. Its saved answers and results are retained.', 409);
  }
  async function request(uid, id, { retry = false } = {}) {
    const saved = await store.get(uid, id); if (!saved) throw fail('Attempt not found.', 404);
    const state = await store.update(uid, id, state => {
      if (state.status !== 'submitted') throw fail('Submit the test before requesting assessment.');
      const trusted = trustedSnapshots.get(state.paperHash);
      if (!state.assessment && trusted) state.assessment = stateFor(trusted.current);
      validate(state);
      if (state.assessment.status === 'processing' || state.assessment.status === 'complete' && aggregate(saved.paper, state).ready) return state;
      if(retry&&Object.values(state.assessment.items).some(job=>job.status!=='assessed'&&Object.values(job.stages||{}).some(stage=>stage.uncertain)))throw fail('An earlier assessment request must be confirmed before it can be repeated. Your saved responses are retained.',409);
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
    const activeAdapters = validate(state);
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
        if (require('./exclusions').validExclusion(saved.state, candidate, response, previous)) continue;
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
          const value = await activeAdapters.assess(q, response, { recording, previous: stages, run: state.assessment.run,
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
          if (row.status === 'not-requested') await request(row.uid,row.id);
          else if (row.status === 'needs-attention') { if (!await resumeAutomatically(row.uid, row.id)) await wakeMedia(row.uid, row.id); }
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
  return { snapshot: currentSnapshot, request, wakeMedia, results, recover, start, stop, drain, jobs, validate };
}
module.exports = { VERSION, configuration, legacyConfiguration, snapshot, stateFor, createEngine };
