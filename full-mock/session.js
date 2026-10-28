'use strict';
const { randomUUID } = require('node:crypto');
const { TASKS } = require('./blueprint');
const { questionForPlayer, digest, assertReleased } = require('./paper');
const { hash, uuid, fail } = require('./store');
const VERSION = 'full-mock-session-2026-10-29.2';
const SPEECH = new Set(['intro', 'ra', 'rs', 'di', 'rl', 'asq', 'sgd', 'rts']);
function item(paper, index) {
  return index === 0 ? { id: 'introduction', question: { ...paper.introduction, preparation: 25, seconds: 30, startCueMs: 300 } } : paper.questions[index - 1];
}
function section(candidate) { return candidate.question.type === 'intro' ? 'speaking-writing' : TASKS.find(task => task.type === candidate.question.type).section; }
function enter(state, paper, at) {
  if (state.index > paper.questions.length) { state.status = 'submitted'; state.submittedAt = at; state.current = null; return; }
  const candidate = item(paper, state.index), q = candidate.question, part = section(candidate);
  if (part === 'reading' && !state.clocks.reading) state.clocks.reading = at + paper.clockPolicy.readingSeconds * 1000;
  if (part === 'listening' && q.type !== 'sst' && !state.clocks.listening) state.clocks.listening = at + paper.clockPolicy.listeningAfterSstSeconds * 1000;
  const promptAt = candidate.audio ? at + (q.playbackDelaySeconds || 0) * 1000 : null;
  const promptEndsAt = promptAt == null ? at : promptAt + candidate.audio.entry.seconds * 1000;
  const responseAt = SPEECH.has(q.type) ? promptEndsAt + (q.preparation || 0) * 1000 + (q.startCueMs || 0) : at;
  const endsAt = part === 'reading' ? state.clocks.reading : part === 'listening' && q.type !== 'sst' ? state.clocks.listening : responseAt + q.seconds * 1000;
  state.current = { token: randomUUID(), enteredAt: at, promptAt, promptEndsAt, responseAt, endsAt, section: part };
  state.responses[state.index] = { token: state.current.token, type: q.type, draft: SPEECH.has(q.type) ? null : [], draftSequence: -1, segments: [], sealed: false,
    ...(SPEECH.has(q.type) ? { permit: { id: randomUUID(), token: randomUUID(), responseAt, deadline: endsAt } } : {}) };
}
function create(id, paper, at, { preview = false, assessmentSnapshot } = {}) {
  if (!preview) assertReleased(paper);
  const state = { id, version: VERSION, paperId: paper.id, paperVersion: paper.version, paperHash: digest(paper), preview,
    title: paper.title, createdAt: at, status: 'active', index: 0, clocks: {}, responses: [], events: [], recoveries: [] };
  if (assessmentSnapshot) state.assessment = require('./assessment').stateFor(assessmentSnapshot);
  enter(state, paper, at); return state;
}
function responseStatus(response) {
  const segments = response.segments.filter(segment => !segment.cancelled && segment.chunkCount !== 0);
  if (segments.some(segment => !segment.finished)) return 'media-pending';
  if (segments.some(segment => segment.lateActivation || Object.values(segment.chunks).some(chunk => chunk.late))) return 'needs-review';
  return segments.length || response.draft?.length ? 'saved' : 'unanswered';
}
function seal(state, at, reason) {
  const response = state.responses[state.index];
  response.sealed = true; response.sealedAt = at; response.reason = reason;
  response.answer = structuredClone(response.draft); response.status = responseStatus(response);
}
function reconcile(state, paper, now) {
  for (let count = 0; state.status === 'active' && now >= state.current.endsAt && count < 70; count++) {
    const deadline = state.current.endsAt;
    seal(state, deadline, 'time-expired'); state.index++; enter(state, paper, deadline);
  }
  return state;
}
function phase(state, now) {
  if (state.status !== 'active') return 'submitted';
  const current = state.current;
  if (current.promptAt != null && now < current.promptAt) return 'instructions';
  if (current.promptAt != null && now < current.promptEndsAt) return 'listening';
  if (now < current.responseAt) return 'preparing';
  return SPEECH.has(state.responses[state.index].type) ? 'recording' : 'answering';
}
function claim(state, body, now) {
  for (const field of ['pageId', 'controlToken', 'recoveryToken']) if (!uuid(body[field])) throw fail('Invalid player claim.', 400);
  const lease = state.control;
  if (lease?.pageId === body.pageId) { if (lease.hash !== hash(body.controlToken)) throw fail('This player connection was replaced.'); lease.expiresAt = now + 20000; return; }
  if (lease?.expiresAt > now && lease.recoveryHash !== hash(String(body.previousRecoveryToken || ''))) throw fail('This test is open in another tab. Return to that tab or reconnect after its connection closes.');
  state.control = { pageId: body.pageId, hash: hash(body.controlToken), recoveryHash: hash(body.recoveryToken), expiresAt: now + 20000 };
}
function control(state, token, now) {
  if (!state.control || state.control.hash !== hash(String(token || ''))) throw fail('This player connection was replaced. Reconnect to this attempt.');
  state.control.expiresAt = now + 20000;
}
function current(state, token) { if (state.status !== 'active' || state.current.token !== token) throw fail('This question has already finished.'); return state.responses[state.index]; }
function validateAnswer(q, answer) {
  if (!Array.isArray(answer) || answer.length > 500 || JSON.stringify(answer).length > 16000) throw fail('Invalid answer.', 400);
  if (['swt', 'essay', 'sst', 'wfd'].includes(q.type)) { if (answer.length > 1 || answer.some(value => typeof value !== 'string' || value.length > 12000)) throw fail('Invalid written answer.', 400); }
  else if (['dropdown', 'wordbank', 'lfi', 'reorder'].includes(q.type)) { if (answer.some(value => typeof value !== 'string' || value.length > 500)) throw fail('Invalid answer values.', 400); }
  else if (answer.some(value => !Number.isInteger(value) || value < 0 || value > 5000)) throw fail('Invalid choice values.', 400);
  return structuredClone(answer);
}
function saveDraft(state, paper, body) {
  const response = current(state, body.itemToken), q = item(paper, state.index).question;
  if (SPEECH.has(q.type) || !Number.isSafeInteger(body.sequence) || body.sequence < 0 || body.sequence > 100000) throw fail('Invalid answer sequence.', 400);
  const answer = validateAnswer(q, body.answer);
  if (body.sequence < response.draftSequence) return;
  if (body.sequence === response.draftSequence) { if (JSON.stringify(answer) !== JSON.stringify(response.draft)) throw fail('An answer revision cannot be replaced.'); return; }
  response.draft = answer; response.draftSequence = body.sequence;
}
function next(state, paper, body, now) {
  if (state.responses.some(response => response.token === body.itemToken && response.sealed)) return;
  const response = current(state, body.itemToken), q = item(paper, state.index).question;
  if (SPEECH.has(q.type) && now < state.current.responseAt && body.skip !== true) throw fail('Wait for the response window, or explicitly skip this question.');
  if (body.skip === true && response.segments.some(segment => Object.keys(segment.chunks).length)) throw fail('A recorded response cannot be replaced with a skip.');
  if (body.skip === true) for (const segment of response.segments) { segment.cancelled = true; segment.finished = true; segment.chunkCount = 0; }
  seal(state, now, body.skip ? 'skipped' : 'submitted'); state.index++; enter(state, paper, now);
}
function openSegment(state, paper, body, now) {
  const index = state.responses.findIndex(value => value.token === body.itemToken), response = state.responses[index];
  if (!response || !SPEECH.has(response.type)) throw fail('Recording item not found.', 404);
  const live = state.status === 'active' && state.current.token === body.itemToken && now < state.current.endsAt;
  const reserved = response.permit?.id === body.segmentId && response.permit.token === body.segmentToken;
  // A delayed, unused declaration is harmless after an explicit skip. Its
  // corresponding zero-chunk finalisation is also idempotent below.
  if (reserved && response.reason === 'skipped') return;
  if (!live && (!reserved || response.reason === 'skipped' || now > response.permit.deadline + 86400000)) throw fail('The recording window is not open.');
  if (!uuid(body.segmentId) || !uuid(body.segmentToken) || !['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/mpeg'].includes(body.mime)) throw fail('Unsupported recording.', 400);
  const existing = response.segments.find(segment => segment.id === body.segmentId);
  if (existing) { if (existing.hash !== hash(body.segmentToken) || existing.mime !== body.mime) throw fail('This recording segment is already saved.'); return; }
  if (response.segments.length >= 5) throw fail('Too many recording interruptions. Your saved audio is retained for review.');
  response.segments.push({ id: body.segmentId, hash: hash(body.segmentToken), mime: body.mime,
    startedAt: response.permit.responseAt, deadline: response.permit.deadline, chunks: {}, finished: false, lateActivation: !live });
  if (!live) response.status = 'needs-review';
}
function findSegment(state, token, segmentId, secret, now) {
  const response = state.responses.find(response => response.token === token), segment = response?.segments.find(segment => segment.id === segmentId);
  if (!segment || segment.cancelled || segment.hash !== hash(String(secret || ''))) throw fail('Recording segment not found.', 404);
  if (now > segment.deadline + 86400000) throw fail('This recording recovery window has closed; retain the local recording for support.', 409);
  return { response, segment };
}
function registerChunk(state, token, segmentId, secret, sequence, metadata, now) {
  const { segment } = findSegment(state, token, segmentId, secret, now);
  if (now < segment.startedAt) throw fail('The recording window has not opened yet.');
  const existing = segment.chunks[sequence];
  if (existing) { if (existing.sha256 !== metadata.sha256 || existing.bytes !== metadata.bytes) throw fail('A saved recording chunk cannot be replaced.'); return; }
  const total = state.responses.flatMap(value => value.segments).reduce((sum, value) => sum + Object.values(value.chunks).reduce((n, chunk) => n + chunk.bytes, 0), 0);
  if (segment.finished || total + metadata.bytes > 96 * 1024 * 1024 || Object.values(segment.chunks).reduce((sum, chunk) => sum + chunk.bytes, 0) + metadata.bytes > 12 * 1024 * 1024) throw fail('This recording segment is closed or too large.', 413);
  segment.chunks[sequence] = { ...metadata, receivedAt: now, late: now > segment.deadline };
}
function finishSegment(state, token, segmentId, secret, count, now) {
  const skipped = state.responses.find(value => value.token === token);
  if (count === 0 && skipped?.reason === 'skipped' && (skipped.permit?.id === segmentId && skipped.permit.token === secret || skipped.segments.some(value => value.id === segmentId && value.hash === hash(String(secret || '')) && value.chunkCount === 0))) return;
  const { response, segment } = findSegment(state, token, segmentId, secret, now);
  if (!Number.isInteger(count) || count < 0 || count > 256) throw fail('Invalid recording length.', 400);
  if (segment.finished) { if (segment.chunkCount !== count) throw fail('This recording is already finalised.'); return; }
  if (Object.keys(segment.chunks).length !== count || Array.from({ length: count }, (_, index) => !segment.chunks[index]?.stored).some(Boolean)) throw fail('Some recording chunks are still uploading. Retry after they are saved.');
  segment.finished = true; segment.chunkCount = count; segment.finishedAt = now; segment.late = now > segment.deadline;
  if (response.sealed) response.status = responseStatus(response);
}
function recover(state, paper, body, now) {
  const index = state.responses.findIndex(response => response.token === body.itemToken), response = state.responses[index];
  if (!response?.sealed) throw fail('Recovery is only for a finished question.');
  const q = item(paper, index).question; if (SPEECH.has(q.type)) throw fail('Use the recording recovery queue for this item.', 400);
  const answer = validateAnswer(q, body.answer);
  if (!Number.isSafeInteger(body.sequence) || body.sequence <= response.draftSequence) return;
  const records = state.recoveries.filter(value => value.itemToken === body.itemToken), existing = records.find(value => value.sequence === body.sequence);
  if (existing) { if (JSON.stringify(existing.answer) !== JSON.stringify(answer)) throw fail('Recovered evidence cannot be replaced.'); return; }
  if (records.some(value => value.sequence > body.sequence)) return;
  if (records.length >= 5) throw fail('Recovery evidence is already saved; retain any further local changes for support.');
  state.recoveries.push({ itemToken: body.itemToken, sequence: body.sequence, answer, receivedAt: now, status: 'needs-review' });
}
function present(state, paper, now) {
  const response = state.status === 'active' ? state.responses[state.index] : null;
  const assessed = state.assessment && state.status === 'submitted' ? require('./aggregation').aggregate(paper, state) : null;
  const assessmentStatus = state.assessment?.displayStatus || (state.assessment?.status === 'complete' && assessed && !assessed.ready ? 'needs-attention' : state.assessment?.status) || 'not-enabled';
  const output = { id: state.id, paperId: state.paperId, paperVersion: state.paperVersion, paperHash: state.paperHash, title: state.title,
    status: state.status, preview: state.preview, createdAt: state.createdAt, submittedAt: state.submittedAt || null,
    index: state.index, totalItems: 66, scoredQuestionCount: 65, completedCount: state.responses.filter(value => value.sealed).length,
    serverNow: now, mediaPending: state.responses.reduce((sum, value) => sum + value.segments.filter(segment => !segment.finished).length, 0),
    recoveredEvidenceCount: state.recoveries.length, assessmentStatus,
    ...(state.assessment ? { assessmentProgress: { assessed: assessed?.assessedCount || 0, expected: 65 } } : {}) };
  if (response) Object.assign(output, { question: state.index === 0 ? { ...paper.introduction, preparation: 25, seconds: 30, startCueMs: 300 } : questionForPlayer(item(paper, state.index)),
    current: { ...state.current, phase: phase(state, now) }, draft: response.draft, draftSequence: response.draftSequence,
    ...(response.permit ? { recordingPermit: { id: response.permit.id, token: response.permit.token } } : {}),
    recordingSegments: response.segments.map(segment => ({ id: segment.id, mime: segment.mime, finished: segment.finished, sequences: Object.keys(segment.chunks).map(Number) })) });
  return output;
}
function end(state, paper, now) { while (state.status === 'active') { seal(state, now, 'finished-early'); state.index++; enter(state, paper, now); } }
module.exports = { VERSION, SPEECH, item, create, reconcile, phase, claim, control, saveDraft, next, openSegment, findSegment, registerChunk, finishSegment, recover, present, end };
