'use strict';
const { digest } = require('./paper');
const { fail } = require('./store');
const VERSION = 'full-mock-audio-exclusion-2026-11-01.1';
const DELIVERY_VERSION = 'full-mock-instructor-delivery-exclusion-2026-11-02.1';
const inputHash = response => require('./aggregation').inputHash(response);
function validExclusion(state, candidate, response, job) {
  const value = state.assessment?.exclusions?.[candidate.id];
  const supported = value && (value.version === VERSION && value.reason === 'unusable-audio' && candidate.question.type === 'asq'
    || value.version === DELIVERY_VERSION && value.reason === 'instructor-delivery-exclusion' && candidate.question.type === 'rs');
  return !!supported
    && response?.sealed && job?.status === 'failed' && value.inputHash === inputHash(response)
    && value.snapshotHash === state.assessment.snapshotHash && value.previousJobHash === digest(job)
    && typeof value.note === 'string' && value.note.length >= 10 && !!value.operation && Number.isFinite(value.at);
}
function deliveryEligible(state, paper, candidate, response, job) {
  if (candidate.question.type !== 'rs' || !response?.sealed || job?.status !== 'failed'
    || job.inputHash !== inputHash(response) || job.snapshotHash !== state.assessment?.snapshotHash
    || (job.result?.reason || job.reason) !== 'delivery-unavailable'
    || job.stages?.transcription?.status !== 'complete' || job.stages?.content?.status !== 'complete'
    || job.stages?.delivery?.status !== 'partial' || job.stages.delivery.uncertain || job.stages.delivery.recoveryBlocked
    || !response.segments.some(segment => !segment.cancelled && segment.chunkCount > 0)
    || !response.segments.filter(segment => !segment.cancelled && segment.chunkCount !== 0).every(segment => segment.finished
      && Object.keys(segment.chunks).length === segment.chunkCount && Object.values(segment.chunks).every(chunk => chunk.stored))
    || validExclusion(state, candidate, response, job)) return false;
  const result = require('./aggregation').aggregate(paper, state);
  // An instructor can release the final held RS only. This cannot remove a
  // whole task, hide several missing items, or replace a confirmed result.
  return paper.questions.length === 65 && result.assessedCount === 64 && result.excludedCount === 0;
}
function evidenceHash(state) {
  return digest({ paperHash:state.paperHash, snapshotHash:state.assessment?.snapshotHash,
    responses:state.responses.map(inputHash), items:state.assessment?.items || {}, exclusions:state.assessment?.exclusions || {} });
}
function eligible(state, candidate, response, job) {
  return candidate.question.type === 'asq' && response?.sealed && job?.status === 'failed'
    && job.inputHash === inputHash(response) && job.snapshotHash === state.assessment?.snapshotHash
    && (job.result?.reason || job.reason) === 'transcription-unavailable'
    && job.stages?.transcription?.status === 'failed' && !job.stages.transcription.uncertain
    && response.segments.some(segment => !segment.cancelled && segment.chunkCount > 0)
    && response.segments.filter(segment => !segment.cancelled && segment.chunkCount !== 0).every(segment => segment.finished
      && Object.keys(segment.chunks).length === segment.chunkCount && Object.values(segment.chunks).every(chunk => chunk.stored))
    && !validExclusion(state, candidate, response, job);
}
function createSupport({ store, validate, now = Date.now }) {
  function inspectRecord(owner, record) {
    const { state, paper } = record;
    const result = require('./aggregation').aggregate(paper, state);
    return { owner, attemptId:state.id, title:state.title, submittedAt:state.submittedAt, paperHash:state.paperHash,
      snapshotHash:state.assessment.snapshotHash, evidenceHash:evidenceHash(state), ready:result.ready,
      responsesHash:digest(state.responses.map(inputHash)), confirmedHash:digest(Object.fromEntries(Object.entries(state.assessment.items).filter(([, job]) => job.status === 'assessed'))),
      status:state.assessment.status, assessedCount:result.assessedCount, excludedCount:result.excludedCount,
      accountedFor:result.accountedCount, total:paper.questions.length,
      recovery:structuredClone(state.assessment.recovery || {}), busy:state.assessment.status === 'processing' || state.assessment.lease?.expiresAt > now(),
      questions:paper.questions.map((candidate, index) => {
        const job = state.assessment.items[candidate.id], response = state.responses[index + 1], row = result.items[index];
        return { id:candidate.id, number:index + 1, type:candidate.question.type, status:row.status,
          inputHash:inputHash(response), eligible:eligible(state, candidate, response, job),
          deliveryEligible:deliveryEligible(state, paper, candidate, response, job),
          reason:job?.result?.reason || job?.reason || null, exclusion:row.exclusion || null,
          transcription:job?.stages?.transcription ? { status:job.stages.transcription.status, code:job.stages.transcription.failureCode || null, uncertain:!!job.stages.transcription.uncertain } : null };
      }).filter(row => row.status !== 'assessed') };
  }
  async function read(owner, id) {
    const record = await store.get(owner, id);
    if (!record) throw fail('Attempt not found.', 404);
    if (record.state.status !== 'submitted' || !record.state.assessment) throw fail('Only a submitted assessed attempt can be reviewed.', 409);
    validate(record.state);
    return record;
  }
  async function inspect(owner, id) { return inspectRecord(owner, await read(owner, id)); }
  async function exclude(owner, id, body = {}, kind = 'audio') {
    const delivery = kind === 'delivery';
    const { operation, questionIds, note, evidenceHash:expected, confirmUnusableAudio, confirmInstructorExclusion } = body;
    if (!/^[a-zA-Z0-9:_-]{8,100}$/.test(operation || '') || !/^[a-f0-9]{64}$/.test(expected || '')
      || !Array.isArray(questionIds) || !questionIds.length || questionIds.length > 4 || new Set(questionIds).size !== questionIds.length
      || questionIds.some(value => typeof value !== 'string') || typeof note !== 'string' || note.trim().length < 10 || note.length > 600
      || (delivery ? questionIds.length !== 1 || confirmInstructorExclusion !== true : confirmUnusableAudio !== true)) throw fail(delivery ? 'Confirm the one failed Repeat Sentence and an instructor exclusion note.' : 'Confirm the exact questions, reviewed unusable audio and an explanatory note.', 400);
    const record = await read(owner, id), requestHash = digest({ questionIds:[...questionIds].sort(), note:note.trim(), expected,
      ...(delivery ? {kind,confirmInstructorExclusion} : {confirmUnusableAudio}) });
    record.state = await store.update(owner, id, state => {
      validate(state);
      const previous = state.assessment.exclusionOperations?.[operation];
      if (previous) {
        if (previous.requestHash !== requestHash) throw fail('This operation belongs to a different review.', 409);
        return state;
      }
      if (state.assessment.status === 'processing' || state.assessment.lease?.expiresAt > now()) throw fail('Assessment work is active. Inspect again when it has settled.', 409);
      if (evidenceHash(state) !== expected) throw fail('Saved evidence changed. Inspect again before excluding a recording.', 409);
      const selected = questionIds.map(id => record.paper.questions.find(candidate => candidate.id === id));
      if (selected.some(candidate => !candidate || !(delivery ? deliveryEligible(state, record.paper, candidate, state.responses[record.paper.questions.indexOf(candidate) + 1], state.assessment.items[candidate.id]) : eligible(state, candidate, state.responses[record.paper.questions.indexOf(candidate) + 1], state.assessment.items[candidate.id])))) throw fail(delivery ? 'Only the final failed Repeat Sentence delivery assessment can be excluded; all other 64 questions must be assessed.' : 'Only missing Answer Short Question assessments with retained audio can be excluded.', 409);
      // Keep a genuine scored sample for this task type. Never invent a fraction
      // or silently remove an entire task's published contribution.
      if (!record.paper.questions.some(candidate => candidate.question.type === (delivery ? 'rs' : 'asq') && !questionIds.includes(candidate.id)
        && require('./aggregation').aggregate(record.paper, state).items.find(row => row.id === candidate.id)?.status === 'assessed')) throw fail('A verified assessment for this task must remain.', 409);
      const at = now(), before = evidenceHash(state);
      state.assessment.exclusions ||= {};
      for (const candidate of selected) {
        const response = state.responses[record.paper.questions.indexOf(candidate) + 1], job = state.assessment.items[candidate.id];
        state.assessment.exclusions[candidate.id] = { version:delivery ? DELIVERY_VERSION : VERSION, reason:delivery ? 'instructor-delivery-exclusion' : 'unusable-audio', operation, at, note:note.trim(),
          inputHash:inputHash(response), snapshotHash:state.assessment.snapshotHash, previousJobHash:digest(job) };
      }
      const result = require('./aggregation').aggregate(record.paper, state);
      state.assessment.exclusionOperations ||= {};
      state.assessment.exclusionOperations[operation] = { requestHash, at, beforeEvidenceHash:before, afterEvidenceHash:evidenceHash(state), questionIds:[...questionIds] };
      if (result.ready) {
        state.assessment.status = 'complete'; state.assessment.finishedAt = at;
        state.assessment.recovery = { ...state.assessment.recovery, status:'complete' };
        delete state.assessment.recovery.nextAt;
      }
      return state;
    });
    return inspectRecord(owner, record);
  }
  return { inspect, exclude:(owner,id,body)=>exclude(owner,id,body), excludeDelivery:(owner,id,body)=>exclude(owner,id,body,'delivery') };
}
module.exports = { VERSION, DELIVERY_VERSION, validExclusion, evidenceHash, eligible, deliveryEligible, createSupport };
