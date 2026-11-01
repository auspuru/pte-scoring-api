'use strict';
const { digest } = require('./paper');
const { fail } = require('./store');
const VERSION = 'full-mock-audio-exclusion-2026-11-01.1';
const inputHash = response => require('./aggregation').inputHash(response);
function validExclusion(state, candidate, response, job) {
  const value = state.assessment?.exclusions?.[candidate.id];
  return !!value && value.version === VERSION && value.reason === 'unusable-audio' && candidate.question.type === 'asq'
    && response?.sealed && job?.status === 'failed' && value.inputHash === inputHash(response)
    && value.snapshotHash === state.assessment.snapshotHash && value.previousJobHash === digest(job)
    && typeof value.note === 'string' && value.note.length >= 10 && !!value.operation && Number.isFinite(value.at);
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
  async function exclude(owner, id, body = {}) {
    const { operation, questionIds, note, evidenceHash:expected, confirmUnusableAudio } = body;
    if (!/^[a-zA-Z0-9:_-]{8,100}$/.test(operation || '') || !/^[a-f0-9]{64}$/.test(expected || '')
      || !Array.isArray(questionIds) || !questionIds.length || questionIds.length > 4 || new Set(questionIds).size !== questionIds.length
      || questionIds.some(value => typeof value !== 'string') || typeof note !== 'string' || note.trim().length < 10 || note.length > 600
      || confirmUnusableAudio !== true) throw fail('Confirm the exact questions, reviewed unusable audio and an explanatory note.', 400);
    const record = await read(owner, id), requestHash = digest({ questionIds:[...questionIds].sort(), note:note.trim(), expected, confirmUnusableAudio });
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
      if (selected.some(candidate => !candidate || !eligible(state, candidate, state.responses[record.paper.questions.indexOf(candidate) + 1], state.assessment.items[candidate.id]))) throw fail('Only missing Answer Short Question assessments with retained audio can be excluded.', 409);
      // Keep a genuine scored sample for this task type. Never invent a fraction
      // or silently remove an entire task's published contribution.
      if (!record.paper.questions.some(candidate => candidate.question.type === 'asq' && !questionIds.includes(candidate.id)
        && require('./aggregation').aggregate(record.paper, state).items.find(row => row.id === candidate.id)?.status === 'assessed')) throw fail('A verified Answer Short Question assessment must remain.', 409);
      const at = now(), before = evidenceHash(state);
      state.assessment.exclusions ||= {};
      for (const candidate of selected) {
        const response = state.responses[record.paper.questions.indexOf(candidate) + 1], job = state.assessment.items[candidate.id];
        state.assessment.exclusions[candidate.id] = { version:VERSION, reason:'unusable-audio', operation, at, note:note.trim(),
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
  return { inspect, exclude };
}
module.exports = { VERSION, validExclusion, evidenceHash, eligible, createSupport };
