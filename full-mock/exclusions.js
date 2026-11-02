'use strict';
const { digest } = require('./paper');
const { fail } = require('./store');
const VERSION = 'full-mock-audio-exclusion-2026-11-01.1';
const DELIVERY_VERSION = 'full-mock-instructor-delivery-exclusion-2026-11-02.1';
const AUTOMATIC_VERSION = 'full-mock-final-question-release-2026-11-02.1';
const automaticRetries = require('../mock-recovery-policy').DELAYS.length;
const spoken = new Set(['ra','rs','di','rl','asq','sgd','rts']);
const failedStage = {'transcription-unavailable':'transcription','content-unavailable':'content','delivery-unavailable':'delivery','writing-unavailable':'writing'};
const inputHash = response => require('./aggregation').inputHash(response);
const automaticOperation = (state,candidate,response,job) => 'automatic-final:'+digest({attempt:state.id,question:candidate.id,input:inputHash(response),snapshot:state.assessment.snapshotHash,job:digest(job)}).slice(0,40);
function validExclusion(state, candidate, response, job) {
  const value = state.assessment?.exclusions?.[candidate.id];
  const supported = value && response && job && (value.version === VERSION && value.reason === 'unusable-audio' && candidate.question.type === 'asq'
    || value.version === DELIVERY_VERSION && value.reason === 'instructor-delivery-exclusion' && candidate.question.type === 'rs'
    || value.version === AUTOMATIC_VERSION && value.reason === 'automatic-recovery-exhausted' && value.retries === automaticRetries
      && value.operation === automaticOperation(state,candidate,response,job));
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
      && Object.keys(segment.chunks||{}).length === segment.chunkCount && Object.values(segment.chunks).every(chunk => chunk.stored))
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
// Called only inside a validated, owner-bound store transaction. The worker may
// finish its own lease; a scanner must never release another worker's lease.
function releaseExhausted(state,paper,at,{leaseId}={}) {
  const a=state.assessment,r=a?.recovery;
  if(state.status!=='submitted'||a?.status!=='needs-attention'||r?.status!=='exhausted'
    ||a.lease?.expiresAt>at&&a.lease.id!==leaseId)return false;
  const before=evidenceHash(state);
  if(r.finalQuestionReview?.version===AUTOMATIC_VERSION&&r.finalQuestionReview.evidenceHash===before)return false;
  const hold=code=>{r.finalQuestionReview={version:AUTOMATIC_VERSION,status:'held',code,evidenceHash:before,at};return false;};
  if(r.version!==1||r.retries!==automaticRetries)return hold('budget-not-verified');
  const result=require('./aggregation').aggregate(paper,state);
  if(paper.questions.length!==65||result.assessedCount!==64||result.excludedCount!==0)return hold('multiple-or-incomplete-items');
  const row=result.items.find(item=>item.status!=='assessed'),candidate=paper.questions.find(item=>item.id===row?.id);
  const index=paper.questions.indexOf(candidate),response=state.responses[index+1],job=a.items[candidate?.id];
  if(!candidate||!response?.sealed||job?.status!=='failed'||job.inputHash!==inputHash(response)||job.snapshotHash!==a.snapshotHash)return hold('unverified-input');
  const type=candidate.question.type,reason=job.result?.reason||job.reason,stageName=failedStage[reason],stage=job.stages?.[stageName];
  if(!stageName||!(spoken.has(type)?stageName!=='writing'&&(type!=='asq'||stageName==='transcription'):['swt','essay','sst'].includes(type)&&stageName==='writing'))return hold('unsupported-failure');
  if(!['failed','partial'].includes(stage?.status)||stage.uncertain!==false||stage.status==='failed'&&stage.failureCode==null
    ||Object.values(job.stages||{}).some(value=>!value||value.status==='running'||value.uncertain||value.recoveryBlocked
      ||value.failureCode!=null&&require('../mock-recovery-policy').failure({status:value.failureCode}).blocked))return hold('uncertain-or-blocked-stage');
  if(spoken.has(type)){
    const segments=(Array.isArray(response.segments)?response.segments:[]).filter(value=>!value.cancelled&&value.chunkCount!==0);
    if(!segments.length||!segments.every(segment=>segment.finished&&segment.chunkCount>0&&Object.keys(segment.chunks||{}).length===segment.chunkCount
      &&Object.values(segment.chunks||{}).every(chunk=>chunk?.stored)))return hold('incomplete-recording');
  }
  if(!result.items.some(item=>item.type===type&&item.status==='assessed'))return hold('whole-task-exclusion');
  const operation=automaticOperation(state,candidate,response,job);
  a.exclusions||={};a.exclusions[candidate.id]={version:AUTOMATIC_VERSION,reason:'automatic-recovery-exhausted',operation,at,retries:r.retries,
    note:'This question was excluded automatically because its assessment could not be completed after automatic recovery was exhausted. The saved response and completed assessment stages are retained.',
    inputHash:inputHash(response),snapshotHash:a.snapshotHash,previousJobHash:digest(job)};
  a.exclusionOperations||={};a.exclusionOperations[operation]={requestHash:digest({version:AUTOMATIC_VERSION,question:candidate.id,evidence:before}),at,beforeEvidenceHash:before,afterEvidenceHash:evidenceHash(state),questionIds:[candidate.id],automatic:true};
  a.status='complete';a.finishedAt=at;r.status='complete';delete r.nextAt;
  r.finalQuestionReview={version:AUTOMATIC_VERSION,status:'released',operation,questionId:candidate.id,evidenceHash:evidenceHash(state),at};
  return true;
}
function eligible(state, candidate, response, job) {
  return candidate.question.type === 'asq' && response?.sealed && job?.status === 'failed'
    && job.inputHash === inputHash(response) && job.snapshotHash === state.assessment?.snapshotHash
    && (job.result?.reason || job.reason) === 'transcription-unavailable'
    && job.stages?.transcription?.status === 'failed' && !job.stages.transcription.uncertain
    && response.segments.some(segment => !segment.cancelled && segment.chunkCount > 0)
    && response.segments.filter(segment => !segment.cancelled && segment.chunkCount !== 0).every(segment => segment.finished
      && Object.keys(segment.chunks||{}).length === segment.chunkCount && Object.values(segment.chunks).every(chunk => chunk.stored))
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
module.exports = { VERSION, DELIVERY_VERSION, AUTOMATIC_VERSION, validExclusion, evidenceHash, releaseExhausted, eligible, deliveryEligible, createSupport };
