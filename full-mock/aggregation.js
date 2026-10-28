'use strict';
const { TASKS } = require('./blueprint');
const { digest } = require('./paper');
const defaults = require('./profiles');
const VERSION = 'full-mock-aggregation-2026-10-29.1';
function inputHash(response) {
  return digest({ token: response.token, sealed: response.sealed, reason: response.reason, answer: response.answer,
    segments: response.segments.map(({ id, mime, chunks, finished, chunkCount, cancelled, lateActivation }) => ({ id, mime, chunks, finished, chunkCount, cancelled, lateActivation })) });
}
function nativeValid(result, expected) {
  if (result?.status !== 'assessed' || !result.version || !result.maxima || !result.scores) return false;
  const keys = Object.keys(result.maxima);
  if (expected && (keys.length !== Object.keys(expected).length || keys.some(key => result.maxima[key] !== expected[key]))) return false;
  return keys.length > 0 && keys.every(key => Number.isFinite(result.maxima[key]) && result.maxima[key] > 0 && Number.isFinite(result.scores[key]) && result.scores[key] >= 0 && result.scores[key] <= result.maxima[key])
    && result.maximum === keys.reduce((sum, key) => sum + result.maxima[key], 0)
    && Math.abs(result.total - keys.reduce((sum, key) => sum + result.scores[key], 0)) < 1e-8;
}
function bounds(profile, fractions) {
  const known = Object.entries(profile.weights).filter(([, weight]) => weight !== '<1');
  const uncertain = Object.entries(profile.weights).filter(([, weight]) => weight === '<1');
  const numerator = known.reduce((sum, [type, weight]) => sum + fractions[type] * weight, 0), denominator = known.reduce((sum, [, weight]) => sum + weight, 0);
  let low = Infinity, high = -Infinity;
  // A positive linear-fractional function attains its extrema at box vertices.
  // Endpoints enclose the strict 0<w<1 values without selecting one of them.
  for (let vertex = 0; vertex < 2 ** uncertain.length; vertex++) {
    let n = numerator, d = denominator;
    uncertain.forEach(([type], index) => { if (vertex & 2 ** index) { n += fractions[type]; d++; } });
    low = Math.min(low, n / d); high = Math.max(high, n / d);
  }
  return { low, high, unresolvedWeights: uncertain.map(([type]) => type), publishedNumericWeightSum: denominator };
}
function aggregate(paper, state) {
  if (state.status !== 'submitted') throw Object.assign(Error('Submit the test before viewing assessment results.'), { status: 409 });
  const snapshot = state.assessment?.snapshot, configured = snapshot?.weighting || defaults.SNAPSHOT;
  if (digest(paper) !== state.paperHash || snapshot && (digest(snapshot) !== state.assessment.snapshotHash || snapshot.paperHash !== state.paperHash)) throw Object.assign(Error('Saved assessment integrity failed.'), { status:503 });
  const { maxima, VERSION: adapterVersion } = require('./adapters');
  const expectedVersion = snapshot?.scoringSources?.files?.['full-mock/adapters.js']?.version || adapterVersion;
  defaults.validate(configured.profiles);
  const rows = paper.questions.map((candidate, index) => {
    const response = state.responses[index + 1], job = state.assessment?.items?.[candidate.id];
    const expectedMaxima = snapshot?.nativeMaxima?.[candidate.id] || maxima(candidate.question);
    const valid = response?.sealed && job?.status === 'assessed' && job.inputHash === inputHash(response) && job.snapshotHash === state.assessment?.snapshotHash && job.result?.version === expectedVersion && nativeValid(job.result, expectedMaxima);
    return { id: candidate.id, type: candidate.question.type, valid: !!valid, result: valid ? job.result : null, status: valid ? 'assessed' : job?.status === 'failed' ? 'failed' : 'pending' };
  });
  const groups = Object.fromEntries(TASKS.map(task => {
    const questions = rows.filter(row => row.type === task.type), complete = questions.length === task.count && questions.every(row => row.valid);
    return [task.type, { count: questions.length, expected: task.count, complete, earned: complete ? questions.reduce((sum, row) => sum + row.result.total, 0) : null, possible: complete ? questions.reduce((sum, row) => sum + row.result.maximum, 0) : null }];
  }));
  const profiles = Object.fromEntries(Object.entries(configured.profiles).map(([name, profile]) => {
    const types = Object.keys(profile.weights), missing = rows.filter(row => types.includes(row.type) && !row.valid).map(row => ({ id: row.id, type: row.type, status: row.status }));
    const complete = types.every(type => groups[type].complete);
    const common = { version: profile.version, status: complete ? 'complete' : 'pending', calibrated: false, official: false, practiceIndex: null, practiceIndexRange: null, missing };
    if (!complete) return [name, common];
    const fractions = Object.fromEntries(types.map(type => [type, groups[type].earned / groups[type].possible])), interval = bounds(profile, fractions);
    const index = fraction => configured.practiceIndex.minimum + (configured.practiceIndex.maximum - configured.practiceIndex.minimum) * fraction;
    return [name, { ...common, ...interval, weightedFraction: interval.unresolvedWeights.length ? null : interval.low,
      weightedFractionRange: { low: interval.low, high: interval.high },
      practiceIndex: interval.unresolvedWeights.length ? null : Math.round(index(interval.low)),
      practiceIndexRange: { low: Math.floor(index(interval.low) + 1e-9), high: Math.ceil(index(interval.high) - 1e-9) } }];
  }));
  return { version: VERSION, assessmentVersion: state.assessment?.version || null, snapshotHash: state.assessment?.snapshotHash || null,
    paperHash: state.paperHash, assessmentType: 'Provisional IPT practice assessment', calibrated: false, official: false,
    ready: rows.length === 65 && rows.every(row => row.valid), assessedCount: rows.filter(row => row.valid).length, expectedCount: 65,
    weightingVersion: configured.version, practiceIndexPolicy: configured.practiceIndex, groups, profiles,
    items: rows.map(({ id, type, valid, status, result }) => ({ id, type, status, ...(valid ? { total: result.total, maximum: result.maximum, scores: result.scores, maxima: result.maxima, version: result.version } : {}) })) };
}
module.exports = { VERSION, inputHash, nativeValid, bounds, aggregate };
