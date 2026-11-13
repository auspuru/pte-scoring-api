'use strict';
const { TASKS } = require('./blueprint');
const { digest } = require('./paper');
const defaults = require('./profiles');
const { validExclusion } = require('./exclusions');
const VERSION = 'full-mock-aggregation-2026-10-29.1';
const COMPLETION_POLICY = 'full-mock-available-marks-2026-11-06.1';
function availableMarks(state) {
  return state.assessment?.completionPolicy?.version === COMPLETION_POLICY
    && state.assessment.completionPolicy.snapshotHash === state.assessment.snapshotHash;
}
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
function partialValid(result, expected, stages, type) {
  if (result?.partialDelivery !== COMPLETION_POLICY || !expected || !['ra','rs','di','rl','sgd','rts'].includes(type)
    || result.status !== 'assessed' || !result.version || !result.scores || !result.maxima
    || Object.keys(expected).sort().join() !== 'content,fluency,pronunciation'
    || Object.keys(result.maxima).sort().join() !== Object.keys(expected).sort().join()
    || Object.keys(expected).some(key => result.maxima[key] !== expected[key])) return false;
  const missing = ['pronunciation','fluency'].filter(key => result.scores[key] == null);
  const content = stages?.content?.value;
  if (!missing.length || JSON.stringify(result.unavailableTraits) !== JSON.stringify(missing)
    || stages?.transcription?.status !== 'complete' || typeof stages.transcription.value !== 'string' || !stages.transcription.value.trim()
    || stages?.content?.status !== 'complete' || !content || content.total !== result.scores.content
    || !Number.isInteger(content.total) || content.total <= 0 || content.total > expected.content || content.maximum !== expected.content
    || content.score_provisional || content.needs_semantic_review
    || !['ra','rs'].includes(type) && (content.scoringMode !== 'ai' || content.contentStatus !== 'assessed')) return false;
  const keys = Object.keys(expected).filter(key => !missing.includes(key));
  return keys.every(key => Number.isFinite(result.scores[key]) && result.scores[key] >= 0 && result.scores[key] <= expected[key]
      && (key === 'content' || stages?.delivery?.traits?.[key]?.score === result.scores[key]))
    && result.maximum === keys.reduce((sum,key) => sum + expected[key],0)
    && Math.abs(result.total - keys.reduce((sum,key) => sum + result.scores[key],0)) < 1e-8;
}
function bounds(profile, fractions) {
  const known = Object.entries(profile.weights).filter(([type, weight]) => Number.isFinite(fractions[type]) && weight !== '<1');
  const uncertain = Object.entries(profile.weights).filter(([type, weight]) => Number.isFinite(fractions[type]) && weight === '<1');
  const numerator = known.reduce((sum, [type, weight]) => sum + fractions[type] * weight, 0), denominator = known.reduce((sum, [, weight]) => sum + weight, 0);
  let low = Infinity, high = -Infinity;
  // A positive linear-fractional function attains its extrema at box vertices.
  // Endpoints enclose the strict 0<w<1 values without selecting one of them.
  for (let vertex = 0; vertex < 2 ** uncertain.length; vertex++) {
    let n = numerator, d = denominator;
    uncertain.forEach(([type], index) => { if (vertex & 2 ** index) { n += fractions[type]; d++; } });
    if (d > 0) { low = Math.min(low, n / d); high = Math.max(high, n / d); }
  }
  return { low, high, unresolvedWeights: uncertain.map(([type]) => type), publishedNumericWeightSum: denominator };
}
function aggregate(paper, state, {ignorePublication=false}={}) {
  if (state.status !== 'submitted') throw Object.assign(Error('Submit the test before viewing assessment results.'), { status: 409 });
  const snapshot = state.assessment?.snapshot, configured = snapshot?.weighting || defaults.SNAPSHOT;
  if (digest(paper) !== state.paperHash || snapshot && (digest(snapshot) !== state.assessment.snapshotHash || snapshot.paperHash !== state.paperHash)) throw Object.assign(Error('Saved assessment integrity failed.'), { status:503 });
  const { maxima, VERSION: adapterVersion } = require('./adapters');
  const expectedVersion = snapshot?.scoringSources?.files?.['full-mock/adapters.js']?.version || adapterVersion;
  defaults.validate(configured.profiles);
  const rows = paper.questions.map((candidate, index) => {
    const response = state.responses[index + 1], job = state.assessment?.items?.[candidate.id];
    const expectedMaxima = snapshot?.nativeMaxima?.[candidate.id] || maxima(candidate.question);
    const valid = response?.sealed && job?.status === 'assessed' && job.inputHash === inputHash(response) && job.snapshotHash === state.assessment?.snapshotHash && job.result?.version === expectedVersion && (nativeValid(job.result, expectedMaxima) || availableMarks(state) && partialValid(job.result, expectedMaxima, job.stages, candidate.question.type));
    const excluded = !valid && validExclusion(state, candidate, response, job);
    return { id: candidate.id, type: candidate.question.type, valid: !!valid, excluded, result: valid ? job.result : null,
      ...(excluded ? { exclusion:{ reason:state.assessment.exclusions[candidate.id].reason, note:state.assessment.exclusions[candidate.id].note, at:state.assessment.exclusions[candidate.id].at } } : {}),
      status: valid ? 'assessed' : excluded ? 'excluded' : job?.status === 'failed' ? 'failed' : 'pending' };
  });
  const groups = Object.fromEntries(TASKS.map(task => {
    const questions = rows.filter(row => row.type === task.type), scored = questions.filter(row => !row.excluded), omitted = availableMarks(state) && questions.length === task.count && !scored.length;
    const complete = questions.length === task.count && (scored.length > 0 || omitted) && scored.every(row => row.valid);
    return [task.type, { count: questions.length, expected: task.count, excludedCount:questions.length - scored.length, complete, ...(omitted ? {omitted:true} : {}), earned: complete && !omitted ? scored.reduce((sum, row) => sum + row.result.total, 0) : null, possible: complete && !omitted ? scored.reduce((sum, row) => sum + row.result.maximum, 0) : null }];
  }));
  const profiles = Object.fromEntries(Object.entries(configured.profiles).map(([name, profile]) => {
    const types = Object.keys(profile.weights), missing = rows.filter(row => types.includes(row.type) && !row.valid && !row.excluded).map(row => ({ id: row.id, type: row.type, status: row.status }));
    const complete = types.every(type => groups[type].complete);
    const common = { version: profile.version, status: complete ? 'complete' : 'pending', calibrated: false, official: false, practiceIndex: null, practiceIndexRange: null, missing };
    if (!complete) return [name, common];
    const fractions = Object.fromEntries(types.filter(type => !groups[type].omitted).map(type => [type, groups[type].earned / groups[type].possible]));
    if (!Object.keys(fractions).length) return [name,{...common,status:'unavailable'}];
    const interval = bounds(profile, fractions);
    const index = fraction => configured.practiceIndex.minimum + (configured.practiceIndex.maximum - configured.practiceIndex.minimum) * fraction;
    return [name, { ...common, ...interval, weightedFraction: interval.unresolvedWeights.length ? null : interval.low,
      weightedFractionRange: { low: interval.low, high: interval.high },
      practiceIndex: interval.unresolvedWeights.length ? null : Math.round(index(interval.low)),
      practiceIndexRange: { low: Math.floor(index(interval.low) + 1e-9), high: Math.ceil(index(interval.high) - 1e-9) } }];
  }));
  const publicationHeld=!ignorePublication&&require('../mock-result-review').held(state);
  if(publicationHeld)for(const profile of Object.values(profiles))Object.assign(profile,{status:'pending',practiceIndex:null,practiceIndexRange:null});
  return { version: VERSION, assessmentVersion: state.assessment?.version || null, snapshotHash: state.assessment?.snapshotHash || null,
    paperHash: state.paperHash, assessmentType: 'Provisional IPT practice assessment', calibrated: false, official: false,
    ready: !publicationHeld && rows.length === 65 && rows.every(row => row.valid || row.excluded) && Object.values(groups).every(group => group.complete),
    assessedCount: rows.filter(row => row.valid).length, excludedCount:rows.filter(row => row.excluded).length, partialCount:rows.filter(row => row.valid && row.result.partialDelivery === COMPLETION_POLICY).length,
    accountedCount:rows.filter(row => row.valid || row.excluded).length, expectedCount: 65,
    weightingVersion: configured.version, practiceIndexPolicy: configured.practiceIndex, groups, profiles,
    items: rows.map(({ id, type, valid, status, result, exclusion }) => ({ id, type, status, ...(exclusion ? { exclusion } : {}), ...(valid ? { total: result.total, maximum: result.maximum, scores: result.scores, maxima: result.maxima, version: result.version, ...(result.unavailableTraits ? {unavailableTraits:result.unavailableTraits} : {}) } : {}) })) };
}
function aggregateByPaper(paper,state,options){
  return paper.module==='listening'?require('../listening-mock/aggregation').aggregate(paper,state,options):aggregate(paper,state,options);
}
module.exports = { VERSION, COMPLETION_POLICY, availableMarks, inputHash, nativeValid, partialValid, bounds, aggregate:aggregateByPaper };
