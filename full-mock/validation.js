'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { digest, loadPaper } = require('./paper');
const { scoringSnapshot, hash } = require('./audit');
const profiles = require('./profiles');
const VERSION = 'full-mock-validation-2026-10-29.1';
const ROOT = path.resolve(__dirname, '..');
const PROFILES = ['overall','listening','reading','speaking','writing'];
const BANDS = [[10,30],[30,50],[50,65],[65,79],[79,91]];
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const score = value => Number.isInteger(value) && value >= 10 && value <= 90;
const mean = values => values.reduce((n, value) => n + value, 0) / values.length;
const exactKeys = (value, keys) => value && !Array.isArray(value) && typeof value === 'object' && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
function benchmarkContext(paper = loadPaper()) {
  return { paperHash:digest(paper), weightingVersion:profiles.VERSION, practiceIndexPolicyVersion:profiles.PRACTICE_INDEX.version,
    profileVersions:Object.fromEntries(PROFILES.map(name => [name, profiles.PROFILES[name].version])), assessmentSnapshotHash:null };
}
function runtimeContext(root = ROOT, paper = loadPaper()) {
  const source = scoringSnapshot(root), frontend = {};
  for (const file of ['public/full-mock-client.js','public/full-mock-report.js','public/full-mock.css','public/index.js','public/index.html','public/index.css','public/portal-workspace.css','public/portal-workspace.js','public/portal-exam-mode.js',
    'full-mock/validation.js','scripts/verify-release.js','scripts/verify-full-mock-systems.js','tests/full-mock-browser.system.js','tests/full-mock-postgres.system.js','tests/helpers/full-mock-systems.js']) frontend[file] = hash(fs.readFileSync(path.join(root, file)));
  return { paperHash:digest(paper), runtimeHash:digest({ source, frontend }) };
}
function compare(dataset, context = benchmarkContext()) {
  context = { ...context, assessmentSnapshotHash:dataset?.context?.assessmentSnapshotHash ?? null };
  if (!exactKeys(dataset, ['schemaVersion','context','records']) || dataset.schemaVersion !== 1 || digest(dataset.context) !== digest(context) || !Array.isArray(dataset.records) || dataset.records.length > 1000) throw Error('Invalid benchmark cohort or mixed scoring versions.');
  if (dataset.records.length && !isHash(context.assessmentSnapshotHash)) throw Error('A saved assessment snapshot is required for comparisons.');
  const participants = new Set(), attempts = new Set(), officialEvidence = new Set();
  for (const row of dataset.records) {
    if (!exactKeys(row, ['participantHash','consent','official','practice']) || !isHash(row.participantHash)
      || !exactKeys(row.consent, ['granted','scope','referenceHash']) || row.consent.granted !== true || row.consent.scope !== 'full-mock-validation' || !isHash(row.consent.referenceHash)
      || !exactKeys(row.official, ['source','evidenceHash','scores']) || row.official.source !== 'pearson-scored-practice' || !isHash(row.official.evidenceHash)
      || !exactKeys(row.official.scores, PROFILES) || PROFILES.some(name => !score(row.official.scores[name]))
      || !exactKeys(row.practice, ['attemptId','snapshotHash','ready','profiles']) || !require('./store').uuid(row.practice.attemptId) || row.practice.snapshotHash !== context.assessmentSnapshotHash || row.practice.ready !== true
      || !exactKeys(row.practice.profiles, PROFILES)) throw Error('Invalid or unconsented comparison record.');
    for (const name of PROFILES) {
      const saved = row.practice.profiles[name];
      if (!exactKeys(saved, ['version','status','practiceIndex','practiceIndexRange']) || saved.version !== context.profileVersions[name] || saved.status !== 'complete') throw Error('Incomplete or incompatible practice profile.');
      if (name === 'overall') {
        if (saved.practiceIndex !== null || !exactKeys(saved.practiceIndexRange, ['low','high']) || !score(saved.practiceIndexRange.low) || !score(saved.practiceIndexRange.high) || saved.practiceIndexRange.low > saved.practiceIndexRange.high) throw Error('Overall must retain its saved range without a midpoint.');
      } else if (!score(saved.practiceIndex) || saved.practiceIndexRange !== null) throw Error('Invalid practice index.');
    }
    if (participants.has(row.participantHash) || attempts.has(row.practice.attemptId) || officialEvidence.has(row.official.evidenceHash)) throw Error('Repeated participants, attempts or official evidence cannot count as independent comparisons.');
    participants.add(row.participantHash); attempts.add(row.practice.attemptId); officialEvidence.add(row.official.evidenceHash);
  }
  function stats(rows, name) {
    if (!rows.length) return { count:0, bias:null, mae:null, rmse:null, biasRange:null, maeRange:null, rmseRange:null, officialWithinPracticeRangeRate:null };
    if (name !== 'overall') {
      const errors = rows.map(row => row.practice.profiles[name].practiceIndex - row.official.scores[name]);
      return { count:rows.length, bias:mean(errors), mae:mean(errors.map(Math.abs)), rmse:Math.sqrt(mean(errors.map(value => value ** 2))) };
    }
    const intervals = rows.map(row => { const range = row.practice.profiles.overall.practiceIndexRange, actual = row.official.scores.overall; return { low:range.low - actual, high:range.high - actual }; });
    const absolute = intervals.map(({ low, high }) => ({ low:low <= 0 && high >= 0 ? 0 : Math.min(Math.abs(low), Math.abs(high)), high:Math.max(Math.abs(low), Math.abs(high)) }));
    return { count:rows.length, biasRange:{ low:mean(intervals.map(row => row.low)), high:mean(intervals.map(row => row.high)) },
      maeRange:{ low:mean(absolute.map(row => row.low)), high:mean(absolute.map(row => row.high)) },
      rmseRange:{ low:Math.sqrt(mean(absolute.map(row => row.low ** 2))), high:Math.sqrt(mean(absolute.map(row => row.high ** 2))) },
      officialWithinPracticeRangeRate:intervals.filter(row => row.low <= 0 && row.high >= 0).length / rows.length };
  }
  return { version:VERSION, status:dataset.records.length ? 'descriptive-only' : 'no-data', context, count:dataset.records.length,
    calibrated:false, conversionEnabled:false, independentlyVerifiedEvidence:false,
    interpretation:'Descriptive comparisons of separate practice forms. Evidence hashes and consent are declarations, not independent verification. No fitted conversion or exam-score confidence interval is produced. Repeated candidates are excluded; sparse bands cannot establish calibration.',
    profiles:Object.fromEntries(PROFILES.map(name => [name, { ...stats(dataset.records, name), bands:BANDS.map(([low, high]) => ({ band:low + '–' + (high - 1), ...stats(dataset.records.filter(row => row.official.scores[name] >= low && row.official.scores[name] < high), name) })) }])) };
}
const AUTOMATED = ['regression-and-build','postgres-persistence','chromium-desktop','chromium-mobile-emulation'];
const MANUAL = ['desktop-real-microphone','mobile-real-microphone','live-provider-contracts','independent-editorial-listening'];
function readiness({ automated = null, manual = null, context = runtimeContext(), paper = loadPaper() } = {}) {
  const check = (id, evidence) => {
    const row = (Array.isArray(evidence?.checks) ? evidence.checks : []).find(value => value?.id === id);
    const bound = evidence?.schemaVersion === 1 && digest(evidence.context) === digest(context) && context.paperHash === digest(paper) && (!AUTOMATED.includes(id) || evidence.status === 'passed');
    const passed = bound && row?.status === 'passed' && typeof row.evidenceRef === 'string' && !!row.evidenceRef.trim() && typeof row.checkedAt === 'string' && Number.isFinite(Date.parse(row.checkedAt)) && Date.parse(row.checkedAt) <= Date.now() + 300000
      && (!MANUAL.includes(id) || typeof row.reviewedBy === 'string' && !!row.reviewedBy.trim());
    return { id, status:passed ? 'passed' : row?.status === 'passed' ? 'stale-or-invalid' : 'pending', evidenceRef:passed ? row.evidenceRef : null };
  };
  const checks = [...AUTOMATED.map(id => check(id, automated)), ...MANUAL.map(id => check(id, manual))];
  const candidateReady = checks.every(row => row.status === 'passed');
  const studentReleaseEnabled = candidateReady && paper.status === 'released' && paper.editorial?.studentReleaseApproved === true;
  return { version:VERSION, context, checks, candidateReady, studentReleaseEnabled, calibrated:false, conversionEnabled:false,
    remaining:checks.filter(row => row.status !== 'passed').map(row => row.id),
    paperRelease:paper.status, message:studentReleaseEnabled ? 'Evidence-bound provisional practice release.' : 'Preview only. The immutable frozen draft is not a student release; human/device/provider checks and a separately authorised release paper remain required.' };
}
module.exports = { VERSION, PROFILES, AUTOMATED, MANUAL, benchmarkContext, runtimeContext, compare, readiness };
