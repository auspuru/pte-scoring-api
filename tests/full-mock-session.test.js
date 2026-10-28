'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { loadPaper } = require('../full-mock/paper');
const session = require('../full-mock/session');
const paper = loadPaper();
const make = (at = 1000000) => session.create(randomUUID(), paper, at, { preview: true });
function skipUntil(state, type) { while (session.item(paper, state.index).question.type !== type) session.next(state, paper, { itemToken: state.current.token, skip: true }, state.current.enteredAt); }

test('Draft start requires server-authorised preview; all question phases derive from server timestamps', () => {
  assert.throws(() => session.create(randomUUID(), paper, 1000), /not available/);
  const state = make(), start = state.createdAt;
  assert.equal(session.phase(state, start), 'preparing');
  assert.equal(state.current.responseAt, start + 25300);
  assert.equal(state.current.endsAt, start + 55300);
  const before = JSON.stringify(state);
  session.present(state, paper, start + 1000);
  assert.equal(JSON.stringify(state), before);
  assert.equal(session.phase(state, state.current.responseAt), 'recording');
  const now = state.current.endsAt + 100;
  session.reconcile(state, paper, now);
  assert.equal(state.index, 1);
  assert.equal(state.current.enteredAt, start + 55300);
  assert.equal(state.responses[0].reason, 'time-expired');
});
test('Reading and Listening clocks persist across questions; expiry does not restart the next section on reconnect', () => {
  const state = make(); skipUntil(state, 'dropdown');
  const first = state.current.endsAt;
  session.next(state, paper, { itemToken: state.current.token }, state.current.enteredAt + 30000);
  assert.equal(state.current.endsAt, first);
  session.reconcile(state, paper, first + 1000);
  assert.equal(session.item(paper, state.index).question.type, 'sst');
  assert.equal(state.current.enteredAt, first);
  assert.equal(state.current.endsAt, first + 600000);
  session.reconcile(state, paper, first + 600001);
  assert.equal(session.item(paper, state.index).question.type, 'lmcma');
  const listening = state.current.endsAt;
  session.next(state, paper, { itemToken: state.current.token }, state.current.enteredAt + 30000);
  assert.equal(state.current.endsAt, listening);
  session.reconcile(state, paper, listening + 1);
  assert.equal(state.status, 'submitted'); assert.equal(state.responses.length, 66);
  assert(state.responses.every(response => response.sealed));
});
test('ASQ has no start tone and begins its ten-second response immediately after the fixed recording', () => {
  const state = make(); skipUntil(state, 'asq');
  const view = session.present(state, paper, state.current.enteredAt);
  assert.equal(view.question.startCueMs, 0); assert.equal(view.question.seconds, 10);
  assert.equal(state.current.responseAt, state.current.promptEndsAt);
  assert.equal(state.current.endsAt - state.current.responseAt, 10000);
  assert.equal(session.phase(state, state.current.promptAt), 'listening');
});
test('Revision ordering, idempotent Next and separate recovered evidence prevent sealed-answer overwrites', () => {
  const state = make(); skipUntil(state, 'swt'); const token = state.current.token;
  session.saveDraft(state, paper, { itemToken: token, sequence: 4, answer: ['The latest saved response.'] });
  session.saveDraft(state, paper, { itemToken: token, sequence: 2, answer: ['An older request.'] });
  assert.deepEqual(state.responses[state.index].draft, ['The latest saved response.']);
  assert.throws(() => session.saveDraft(state, paper, { itemToken: token, sequence: 4, answer: ['Changed same revision.'] }), /cannot be replaced/);
  const index = state.index; session.next(state, paper, { itemToken: token }, state.current.enteredAt + 1);
  session.next(state, paper, { itemToken: token }, state.current.enteredAt + 2); assert.equal(state.index, index + 1);
  assert.throws(() => session.saveDraft(state, paper, { itemToken: token, sequence: 5, answer: ['Late draft.'] }), /already finished/);
  session.recover(state, paper, { itemToken: token, sequence: 5, answer: ['Late draft.'] }, state.current.enteredAt + 3);
  assert.deepEqual(state.responses[index].answer, ['The latest saved response.']);
  assert.deepEqual(state.recoveries[0].answer, ['Late draft.']); assert.equal(state.recoveries[0].status, 'needs-review');
});
test('Claim handoff revokes a stale page without resetting deadlines', () => {
  const state = make(), now = state.createdAt, deadline = state.current.endsAt;
  const first = { pageId: randomUUID(), controlToken: randomUUID(), recoveryToken: randomUUID() };
  session.claim(state, first, now);
  assert.throws(() => session.claim(state, { pageId: randomUUID(), controlToken: randomUUID(), recoveryToken: randomUUID() }, now + 1), /another tab/);
  const second = { pageId: randomUUID(), controlToken: randomUUID(), recoveryToken: randomUUID(), previousRecoveryToken: first.recoveryToken };
  session.claim(state, second, now + 2);
  assert.throws(() => session.control(state, first.controlToken, now + 3), /replaced/);
  session.control(state, second.controlToken, now + 3); assert.equal(state.current.endsAt, deadline);
});
test('Chunks are immutable, quota is reserved before storage, and finalisation waits for all bytes', () => {
  const state = make(), response = state.responses[0], permit = response.permit;
  const body = { itemToken: response.token, segmentId: permit.id, segmentToken: permit.token, mime: 'audio/webm' };
  session.openSegment(state, paper, body, state.createdAt);
  assert.throws(() => session.registerChunk(state, response.token, permit.id, permit.token, 0, { sha256: 'a', bytes: 100, stored: false }, state.createdAt), /not opened/);
  session.registerChunk(state, response.token, permit.id, permit.token, 0, { sha256: 'a', bytes: 100, stored: false }, state.current.responseAt);
  assert.throws(() => session.finishSegment(state, response.token, permit.id, permit.token, 1, state.current.responseAt), /still uploading/);
  response.segments[0].chunks[0].stored = true;
  session.finishSegment(state, response.token, permit.id, permit.token, 1, state.current.responseAt + 100);
  assert.throws(() => session.registerChunk(state, response.token, permit.id, permit.token, 0, { sha256: 'b', bytes: 100 }, state.current.responseAt + 100), /cannot be replaced/);
  session.next(state, paper, { itemToken: response.token }, state.current.responseAt + 101);
  assert.equal(response.status, 'saved');
});
test('Offline audio from a previously issued permit is preserved as review evidence without reopening its clock', () => {
  const state = make(), response = state.responses[0], permit = response.permit, deadline = state.current.endsAt;
  session.reconcile(state, paper, deadline + 1);
  session.openSegment(state, paper, { itemToken: response.token, segmentId: permit.id, segmentToken: permit.token, mime: 'audio/mp4' }, deadline + 1);
  assert.equal(response.segments[0].lateActivation, true); assert.equal(response.status, 'needs-review');
  assert.equal(state.current.enteredAt, deadline); assert.equal(state.index, 1);
  const view = session.present(state, paper, deadline + 1);
  assert.equal(view.responses, undefined); assert.equal(view.paper, undefined); assert.equal(view.control, undefined);
});
