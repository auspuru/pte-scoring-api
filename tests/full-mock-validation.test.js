'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const validation = require('../full-mock/validation');
const { testDatabaseUrl } = require('./helpers/full-mock-systems');
const { verify } = require('../scripts/verify-full-mock-systems');
const { main:releaseCLI } = require('../scripts/check-full-mock-release');
const sha = text => createHash('sha256').update(text).digest('hex');
function dataset(count = 2) {
  const context = { ...validation.benchmarkContext(), assessmentSnapshotHash:sha('saved-assessment-snapshot') };
  return { schemaVersion:1, context, records:Array.from({ length:count }, (_, index) => ({ participantHash:sha('participant-' + index),
    consent:{ granted:true, scope:'full-mock-validation', referenceHash:sha('consent-' + index) },
    official:{ source:'pearson-scored-practice', evidenceHash:sha('official-evidence-' + index), scores:Object.fromEntries(validation.PROFILES.map(name => [name, index ? 80 : 70])) },
    practice:{ attemptId:randomUUID(), snapshotHash:context.assessmentSnapshotHash, ready:true, profiles:Object.fromEntries(validation.PROFILES.map(name => [name, { version:context.profileVersions[name], status:'complete', practiceIndex:name === 'overall' ? null : index ? 60 : 70, practiceIndexRange:name === 'overall' ? index ? { low:55, high:60 } : { low:68, high:72 } : null }])) } })) };
}
test('Empty benchmark data means unavailable evidence, never zero error or a calibrated conversion', () => {
  const data = { schemaVersion:1, context:validation.benchmarkContext(), records:[] }, result = validation.compare(data);
  assert.equal(result.status, 'no-data'); assert.equal(result.count, 0); assert.equal(result.calibrated, false); assert.equal(result.conversionEnabled, false);
  for (const row of Object.values(result.profiles)) { assert.equal(row.mae, null); assert.equal(row.rmse, null); assert(row.bands.every(band => band.count === 0 && band.mae === null)); }
  assert.equal(require('../scripts/compare-full-mock-benchmarks').main().count, 0);
});
test('Consented comparisons report bias, MAE, RMSE and per-skill official score bands without emitting identities', () => {
  const data = dataset(), result = validation.compare(data), row = result.profiles.writing;
  assert.equal(row.count, 2); assert.equal(row.bias, -10); assert.equal(row.mae, 10); assert(Math.abs(row.rmse - Math.sqrt(200)) < 1e-10);
  assert.equal(row.bands.find(band => band.band === '65–78').count, 1); assert.equal(row.bands.find(band => band.band === '79–90').bias, -20);
  assert.equal(result.status, 'descriptive-only'); assert.equal(result.independentlyVerifiedEvidence, false); assert.equal(result.calibrated, false);
  const output = JSON.stringify(result); assert(!output.includes(data.records[0].participantHash)); assert(!output.includes(data.records[0].official.evidenceHash)); assert(!output.includes(data.records[0].practice.attemptId));
});
test('Overall comparison retains interval error bounds and never fabricates a midpoint', () => {
  const result = validation.compare(dataset()).profiles.overall;
  assert.deepEqual(result.biasRange, { low:-13.5, high:-9 }); assert.deepEqual(result.maeRange, { low:10, high:13.5 });
  assert.equal(result.officialWithinPracticeRangeRate, 0.5); assert(Math.abs(result.rmseRange.low - Math.sqrt(200)) < 1e-10);
  assert.equal(result.bias, undefined); assert.equal(result.mae, undefined); assert.equal(result.practiceIndex, undefined);
});
test('Missing consent, provisional results, fabricated sources, mixed snapshots and unexpected private fields are rejected', () => {
  for (const change of [data => { data.records[0].consent.granted = false; }, data => { data.records[0].practice.ready = false; }, data => { data.records[0].official.source = 'estimated'; },
    data => { data.records[0].practice.snapshotHash = sha('different-provider-contract'); }, data => { data.records[0].name = 'PRIVATE-NAME'; },
    data => { data.records[0].practice.profiles.overall.practiceIndex = 70; }, data => { data.records[0].practice.profiles.reading.version = 'different'; },
    data => { data.context.weightingVersion = 'different'; }, data => { data.records[0].official.scores.speaking = 100; }]) {
    const data = dataset(); change(data); assert.throws(() => validation.compare(data));
  }
});
test('Repeated candidates, practice attempts and official score evidence cannot inflate the comparison cohort', () => {
  for (const field of ['participant','attempt','evidence']) {
    const data = dataset(); if (field === 'participant') data.records[1].participantHash = data.records[0].participantHash;
    if (field === 'attempt') data.records[1].practice.attemptId = data.records[0].practice.attemptId;
    if (field === 'evidence') data.records[1].official.evidenceHash = data.records[0].official.evidenceHash;
    assert.throws(() => validation.compare(data), /independent/);
  }
});
const evidence = () => ({ schemaVersion:1, status:'passed', context:validation.runtimeContext(), checks:[...validation.AUTOMATED,...validation.MANUAL].map(id => ({ id, status:'passed', checkedAt:new Date().toISOString(), evidenceRef:'qa:isolated-test', reviewedBy:'Synthetic test reviewer' })) });
test('Release readiness distinguishes automated success from real hardware/provider/editorial clearance', () => {
  const data = evidence(), automatic = { ...data, checks:data.checks.filter(row => validation.AUTOMATED.includes(row.id)) };
  const result = validation.readiness({ automated:automatic }); assert.equal(result.candidateReady, false); assert.equal(result.studentReleaseEnabled, false);
  assert.deepEqual(result.remaining, validation.MANUAL);
  const complete = validation.readiness({ automated:data, manual:data }); assert.equal(complete.candidateReady, true); assert.equal(complete.studentReleaseEnabled, false, 'Frozen draft is never enabled by a checklist');
  assert.equal(complete.calibrated, false); assert.equal(releaseCLI(['--release']).code, 1);
});
test('Stale source hashes, missing reviewers, future timestamps and failed run evidence cannot pass a release check', () => {
  for (const change of [data => { data.context.runtimeHash = sha('stale'); }, data => { data.context.paperHash = sha('stale-paper'); },
    data => { data.checks[0].evidenceRef = ''; }, data => { data.checks[0].checkedAt = 'invalid'; }, data => { data.checks[0].checkedAt = '2099-01-01'; },
    data => { data.checks.find(row => validation.MANUAL.includes(row.id)).reviewedBy = ''; }, data => { data.status = 'incomplete'; }]) {
    const data = evidence(); change(data); assert.equal(validation.readiness({ automated:data, manual:data }).candidateReady, false);
  }
});
test('System tests refuse production and nonlocal database connections without printing supplied credentials', () => {
  for (const url of [undefined, 'postgres://private-secret@production.example/main', 'postgres://full_mock_test:private-secret@127.0.0.1/student', 'postgres://full_mock_test:private-secret@127.0.0.1/full_mock_test?options=unsafe', 'postgres://root:private-secret@127.0.0.1/full_mock_test']) {
    assert.throws(() => testDatabaseUrl(url), error => !error.message.includes('private-secret'));
  }
  assert(testDatabaseUrl('postgresql://full_mock_test:test@127.0.0.1:5432/full_mock_test'));
});
test('Failed system verification replaces stale passed evidence and cannot publish new success', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'full-mock-evidence-')); t.after(() => fs.rmSync(directory, { recursive:true, force:true }));
  const file = path.join(directory, 'evidence.json'); fs.writeFileSync(file, JSON.stringify(evidence())); let calls = 0;
  const code = verify({ env:{ FULL_MOCK_TEST_DATABASE_URL:'postgres://full_mock_test:test@127.0.0.1/full_mock_test', OPENAI_API_KEY:'PRIVATE' }, evidencePath:file,
    run:(command, args, options) => { assert.equal(options.env.OPENAI_API_KEY, ''); return { status:calls++ === 3 ? 1 : 0 }; } });
  assert.equal(code, 1); assert.equal(calls, 4); const saved = JSON.parse(fs.readFileSync(file)); assert.equal(saved.status, 'incomplete'); assert.equal(saved.checks.length, 0);
});
test('Only a complete unchanged verification run emits all four bounded automated checks', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'full-mock-evidence-')); t.after(() => fs.rmSync(directory, { recursive:true, force:true }));
  const file = path.join(directory, 'evidence.json'); let calls = 0;
  assert.equal(verify({ env:{ FULL_MOCK_TEST_DATABASE_URL:'postgres://full_mock_test:test@127.0.0.1/full_mock_test' }, evidencePath:file, run:() => { calls++; return { status:0 }; } }), 0);
  assert.equal(calls, 4); const data = JSON.parse(fs.readFileSync(file)); assert.equal(data.status, 'passed'); assert.equal(data.checks.length, 4);
  assert.equal(data.readiness.studentReleaseEnabled, false); assert.deepEqual(data.readiness.remaining, validation.MANUAL);
});
