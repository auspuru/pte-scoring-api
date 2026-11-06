'use strict';
const { digest } = require('./paper');
const { fail } = require('./store');
const VERSION = 'full-mock-audio-exclusion-2026-11-01.1';
const DELIVERY_VERSION = 'full-mock-instructor-delivery-exclusion-2026-11-02.1';
const AUTOMATIC_VERSION = 'full-mock-final-question-release-2026-11-02.1';
const UNCLEAR_AUDIO_VERSION = 'full-mock-unclear-audio-release-2026-11-04.1';
const TRANSCRIPTION_VERSION = 'full-mock-instructor-transcription-exclusion-2026-11-04.1';
const AVAILABLE_VERSION = 'full-mock-available-marks-exclusion-2026-11-06.1';
const automaticRetries = require('../mock-recovery-policy').DELAYS.length;
const spoken = new Set(['ra','rs','di','rl','asq','sgd','rts']);
const failedStage = {'transcription-unavailable':'transcription','content-unavailable':'content','delivery-unavailable':'delivery','writing-unavailable':'writing'};
const inputHash = response => require('./aggregation').inputHash(response);
const automaticOperation = (state,candidate,response,job) => 'automatic-final:'+digest({attempt:state.id,question:candidate.id,input:inputHash(response),snapshot:state.assessment.snapshotHash,job:digest(job)}).slice(0,40);
const unclearOperation = (state,candidate,response,job) => 'unclear-audio:'+digest({attempt:state.id,question:candidate.id,input:inputHash(response),snapshot:state.assessment.snapshotHash,job:digest(job)}).slice(0,40);
const responseIdentity = response => digest({token:response.token,sealed:response.sealed,reason:response.reason,answer:response.answer});
function validExclusion(state, candidate, response, job) {
  const value = state.assessment?.exclusions?.[candidate.id];
  if (value?.version === AVAILABLE_VERSION) return !!(require('./aggregation').availableMarks(state)
    && response?.sealed && job && value.responseIdentity === responseIdentity(response) && value.snapshotHash === state.assessment.snapshotHash
    && value.previousJobHash === digest(job) && typeof value.inputHash === 'string' && typeof value.note === 'string'
    && value.note.length >= 10 && Number.isFinite(value.at) && value.operation === 'available-marks:'+digest({attempt:state.id,question:candidate.id,input:value.inputHash,snapshot:value.snapshotHash,job:value.previousJobHash}).slice(0,40));
  if(value?.reason==='instructor-review-unavailable')return require('../mock-result-review').fullExclusion(state,candidate,response,job,value);
  const supported = value && response && job && (value.version === VERSION && value.reason === 'unusable-audio' && candidate.question.type === 'asq'
    || value.version === DELIVERY_VERSION && value.reason === 'instructor-delivery-exclusion' && candidate.question.type === 'rs'
    || value.version === TRANSCRIPTION_VERSION && value.reason === 'instructor-transcription-exclusion' && candidate.question.type === 'asq'
    || value.version === UNCLEAR_AUDIO_VERSION && value.reason === 'automatic-unusable-audio'
      && value.operation === unclearOperation(state,candidate,response,job)
    || value.version === AUTOMATIC_VERSION && value.reason === 'automatic-recovery-exhausted' && value.retries === automaticRetries
      && value.operation === automaticOperation(state,candidate,response,job));
  return !!supported
    && response?.sealed && job?.status === 'failed' && value.inputHash === inputHash(response)
    && value.snapshotHash === state.assessment.snapshotHash && value.previousJobHash === digest(job)
    && typeof value.note === 'string' && value.note.length >= 10 && !!value.operation && Number.isFinite(value.at);
}
function retryableUnavailable(state, candidate, response, job) {
  const excluded=state.assessment?.exclusions?.[candidate.id];
  if (excluded?.version!==AVAILABLE_VERSION || excluded.reason!=='assessment-unavailable'
    || !validExclusion(state,candidate,response,job) || job?.status!=='failed'
    || job.inputHash!==inputHash(response) || job.snapshotHash!==state.assessment.snapshotHash) return false;
  const stages=Object.values(job.stages||{});
  // Older SWT/SST adapters converted provider errors into a provisional local
  // grade. Full Mock rejected that grade, so the persisted stage has the
  // generic code "provider" even when the underlying request was a 429.
  // An instructor may retry only that exact unscored, certain writing stage.
  const writingFallback=['swt','sst'].includes(candidate.question.type)
    &&(job.result?.reason||job.reason)==='writing-unavailable'
    &&stages.length===1 &&job.stages?.writing?.status==='failed'
    &&job.stages.writing.failureCode==='provider' &&job.stages.writing.uncertain===false
    &&!job.stages.writing.recoveryBlocked;
  return (stages.some(stage=>stage?.status==='failed' && String(stage.failureCode)==='429')||writingFallback)
    && stages.every(stage=>stage && stage.status!=='running' && !stage.uncertain && !stage.recoveryBlocked);
}
// Record the exact assessment and input at publication. Later audio uploads are
// retained but cannot silently change this report; an explicit reassessment can.
function releaseAvailable(state,paper,at,{leaseId}={}) {
  const a=state.assessment;
  if (!require('./aggregation').availableMarks(state) || state.status!=='submitted'
    || a.lease?.expiresAt>at && a.lease.id!==leaseId) return false;
  const result=require('./aggregation').aggregate(paper,state), pending=result.items.filter(row=>!['assessed','excluded'].includes(row.status));
  if (!pending.length) return false;
  for (const row of pending) {
    const index=paper.questions.findIndex(q=>q.id===row.id),candidate=paper.questions[index],response=state.responses[index+1],job=a.items[row.id];
    if (!response?.sealed || !job || job.status==='processing' || job.snapshotHash!==a.snapshotHash || job.inputHash!==inputHash(response)) return false;
  }
  a.exclusions||={};a.exclusionOperations||={};
  for (const row of pending) {
    const index=paper.questions.findIndex(q=>q.id===row.id),candidate=paper.questions[index],response=state.responses[index+1],job=a.items[row.id];
    const segments=(response.segments||[]).filter(s=>!s.cancelled&&s.chunkCount!==0);
    const empty=['unintelligible_audio','quiet_audio'].includes(job.stages?.transcription?.failureCode) && job.stages.transcription.uncertain===false;
    const quiet=job.stages?.transcription?.failureCode==='quiet_audio';
    const missing=spoken.has(candidate.question.type)&&!segments.length;
    const incomplete=spoken.has(candidate.question.type)&&segments.some(s=>!s.finished||!s.chunkCount||Object.keys(s.chunks||{}).length!==s.chunkCount);
    const reason=missing?'recording-missing':empty?'unintelligible-audio':incomplete?'recording-incomplete':'assessment-unavailable';
    const note=missing?'No recording was available when this report was prepared. The question does not contribute to the score.':quiet?'This recording was too quiet to assess. The question does not contribute to the score.':empty?'No intelligible speech was recognised in this recording. The question does not contribute to the score.':incomplete?'The recording was incomplete when this report was prepared. The question does not contribute to the score.':'The assessment was unavailable when this report was prepared. The saved response is retained and the question does not contribute to the score.';
    const savedInput=inputHash(response),previousJobHash=digest(job),operation='available-marks:'+digest({attempt:state.id,question:row.id,input:savedInput,snapshot:a.snapshotHash,job:previousJobHash}).slice(0,40);
    a.exclusions[row.id]={version:AVAILABLE_VERSION,reason,note,operation,at,inputHash:savedInput,responseIdentity:responseIdentity(response),snapshotHash:a.snapshotHash,previousJobHash};
    a.exclusionOperations[operation]={at,questionIds:[row.id],automatic:true,inputHash:savedInput,previousJobHash};
  }
  return true;
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
// One confirmed unusable recording must not hold an otherwise assessed paper.
// No timeout, unknown provider error, unfinished upload or absent result is
// classified as unclear speech. Keep all original jobs and successful stages.
function releaseUnclearAudio(state,paper,at,{leaseId}={}) {
  const a=state.assessment;
  if(state.status!=='submitted'||a?.status!=='needs-attention'||a.lease?.expiresAt>at&&a.lease.id!==leaseId)return false;
  const result=require('./aggregation').aggregate(paper,state);
  if(paper.questions.length!==65||result.assessedCount!==64||result.excludedCount!==0)return false;
  const row=result.items.find(item=>item.status!=='assessed'),candidate=paper.questions.find(item=>item.id===row?.id);
  if(!candidate||!spoken.has(candidate.question.type))return false;
  const response=state.responses[paper.questions.indexOf(candidate)+1],job=a.items[candidate.id];
  if(!response?.sealed||job?.status!=='failed'||job.inputHash!==inputHash(response)||job.snapshotHash!==a.snapshotHash)return false;
  const reason=job.result?.reason||job.reason,stages=job.stages||{};
  const empty=reason==='transcription-unavailable'&&stages.transcription?.status==='failed'
    &&stages.transcription.failureCode==='unintelligible_audio'&&stages.transcription.uncertain===false;
  const insufficient=reason==='delivery-unavailable'&&stages.transcription?.status==='complete'
    &&stages.content?.status==='complete'&&stages.delivery?.status==='partial'
    &&stages.delivery.audioQuality==='insufficient-speech'&&stages.delivery.uncertain===false;
  if(!empty&&!insufficient||Object.values(stages).some(s=>!s||s.status==='running'||s.uncertain||s.recoveryBlocked
    ||s.failureCode!=null&&require('../mock-recovery-policy').failure({status:s.failureCode}).blocked))return false;
  const segments=(response.segments||[]).filter(s=>!s.cancelled&&s.chunkCount!==0);
  if(!segments.length||!segments.every(s=>s.finished&&s.chunkCount>0&&Object.keys(s.chunks||{}).length===s.chunkCount&&Object.values(s.chunks||{}).every(c=>c?.stored)))return false;
  if(!result.items.some(item=>item.type===candidate.question.type&&item.status==='assessed'))return false;
  const before=evidenceHash(state),operation=unclearOperation(state,candidate,response,job);
  a.exclusions||={};a.exclusions[candidate.id]={version:UNCLEAR_AUDIO_VERSION,reason:'automatic-unusable-audio',operation,at,
    note:empty?'This recording was excluded automatically because speech recognition returned no intelligible words. The original recording is retained; this question contributes no marks or penalty.':'This recording was excluded automatically because there was insufficient usable speech for delivery assessment. The original recording and completed stages are retained; this question contributes no marks or penalty.',
    inputHash:inputHash(response),snapshotHash:a.snapshotHash,previousJobHash:digest(job)};
  a.exclusionOperations||={};a.exclusionOperations[operation]={requestHash:digest({version:UNCLEAR_AUDIO_VERSION,question:candidate.id,evidence:before}),at,beforeEvidenceHash:before,afterEvidenceHash:evidenceHash(state),questionIds:[candidate.id],automatic:true};
  a.status='complete';a.finishedAt=at;a.recovery={...a.recovery,status:'complete'};delete a.recovery.nextAt;
  return true;
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
function transcriptionEligible(state,paper,candidate,response,job) {
  const stage=job?.stages?.transcription;
  if(!eligible(state,candidate,response,job)||stage?.uncertain!==false||stage.recoveryBlocked
    ||stage.failureCode==null||require('../mock-recovery-policy').failure({status:stage.failureCode}).blocked
    ||Object.values(job.stages||{}).some(s=>!s||s.status==='running'||s.uncertain||s.recoveryBlocked))return false;
  const result=require('./aggregation').aggregate(paper,state);
  return paper.questions.length===65&&result.assessedCount===64&&result.excludedCount===0;
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
      review:require('../mock-result-review').fullPlan(state,paper,now()),
      recovery:structuredClone(state.assessment.recovery || {}), busy:state.assessment.status === 'processing' || state.assessment.lease?.expiresAt > now(),
      questions:paper.questions.map((candidate, index) => {
        const job = state.assessment.items[candidate.id], response = state.responses[index + 1], row = result.items[index];
        return { id:candidate.id, number:index + 1, type:candidate.question.type, status:row.status,
          inputHash:inputHash(response), eligible:eligible(state, candidate, response, job),
          deliveryEligible:deliveryEligible(state, paper, candidate, response, job),
          transcriptionEligible:transcriptionEligible(state,paper,candidate,response,job),
          reason:job?.result?.reason || job?.reason || null, exclusion:row.exclusion || null,
          retryableUnavailable:retryableUnavailable(state,candidate,response,job),
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
    const check=await read(owner,id);if(require('../mock-result-review').held(check.state))throw fail('Use Publish results to finish the instructor review.');
    const delivery = kind === 'delivery';
    const transcription = !delivery && body.mode === 'failed-transcription';
    const { operation, questionIds, note, evidenceHash:expected, confirmUnusableAudio, confirmInstructorExclusion } = body;
    if (!/^[a-zA-Z0-9:_-]{8,100}$/.test(operation || '') || !/^[a-f0-9]{64}$/.test(expected || '')
      || !Array.isArray(questionIds) || !questionIds.length || questionIds.length > 4 || new Set(questionIds).size !== questionIds.length
      || questionIds.some(value => typeof value !== 'string') || typeof note !== 'string' || note.trim().length < 10 || note.length > 600
      || (delivery || transcription ? questionIds.length !== 1 || confirmInstructorExclusion !== true : confirmUnusableAudio !== true)) throw fail(delivery || transcription ? 'Confirm the one failed question and an instructor exclusion note.' : 'Confirm the exact questions, reviewed unusable audio and an explanatory note.', 400);
    const record = await read(owner, id), requestHash = digest({ questionIds:[...questionIds].sort(), note:note.trim(), expected,
      ...(delivery || transcription ? {kind:transcription?'failed-transcription':kind,confirmInstructorExclusion} : {confirmUnusableAudio}) });
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
      if (selected.some(candidate => !candidate || !(delivery ? deliveryEligible(state, record.paper, candidate, state.responses[record.paper.questions.indexOf(candidate) + 1], state.assessment.items[candidate.id]) : transcription ? transcriptionEligible(state,record.paper,candidate,state.responses[record.paper.questions.indexOf(candidate)+1],state.assessment.items[candidate.id]) : eligible(state, candidate, state.responses[record.paper.questions.indexOf(candidate) + 1], state.assessment.items[candidate.id])))) throw fail(delivery || transcription ? 'Only the final confirmed failed question can be excluded; all other 64 questions must be assessed.' : 'Only missing Answer Short Question assessments with retained audio can be excluded.', 409);
      // Keep a genuine scored sample for this task type. Never invent a fraction
      // or silently remove an entire task's published contribution.
      if (!record.paper.questions.some(candidate => candidate.question.type === (delivery ? 'rs' : 'asq') && !questionIds.includes(candidate.id)
        && require('./aggregation').aggregate(record.paper, state).items.find(row => row.id === candidate.id)?.status === 'assessed')) throw fail('A verified assessment for this task must remain.', 409);
      const at = now(), before = evidenceHash(state);
      state.assessment.exclusions ||= {};
      for (const candidate of selected) {
        const response = state.responses[record.paper.questions.indexOf(candidate) + 1], job = state.assessment.items[candidate.id];
        state.assessment.exclusions[candidate.id] = { version:delivery ? DELIVERY_VERSION : transcription ? TRANSCRIPTION_VERSION : VERSION, reason:delivery ? 'instructor-delivery-exclusion' : transcription ? 'instructor-transcription-exclusion' : 'unusable-audio', operation, at, note:note.trim(),
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
module.exports = { VERSION, DELIVERY_VERSION, AUTOMATIC_VERSION, UNCLEAR_AUDIO_VERSION, TRANSCRIPTION_VERSION, AVAILABLE_VERSION, validExclusion, retryableUnavailable, evidenceHash, releaseAvailable, releaseUnclearAudio, releaseExhausted, eligible, deliveryEligible, transcriptionEligible, createSupport };
