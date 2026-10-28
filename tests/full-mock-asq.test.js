'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { items } = require('../content/full-mock/original-items');
const { VERSION, scoreTranscript, assess } = require('../full-mock/asq-scoring');
const questions = items.filter(question => question.type === 'asq');

test('Five original ASQ items accept their explicit variants and affect Listening only', () => {
  assert.equal(questions.length, 5);
  for (const question of questions) for (const answer of question.acceptedAnswers) {
    const result = scoreTranscript(question, answer);
    assert.equal(result.version, VERSION);
    assert.equal(result.status, 'assessed');
    assert.equal(result.total, 1, answer);
    assert.equal(result.maximum, 1);
    assert.deepEqual(result.skills, ['listening']);
    assert.deepEqual(Object.keys(result.scores), ['content']);
    assert.equal(result.pronunciation, undefined);
    assert.equal(result.fluency, undefined);
  }
});
test('ASQ supports case, punctuation and short carrier phrases without crediting contradictory lists', () => {
  const thermometer = questions[1];
  for (const answer of ['Thermometer.', 'A THERMOMETER!', 'It is a thermometer.', 'The answer is a thermometer.', 'I think it is a thermometer.']) assert.equal(scoreTranscript(thermometer, answer).total, 1, answer);
  for (const answer of ['not a thermometer', 'thermometer or a compass', 'a compass, no, a thermometer', 'a thermometer is not the answer', 'thermometers', 'wrong']) assert.equal(scoreTranscript(thermometer, answer).total, 0, answer);
  assert.equal(scoreTranscript(questions[3], '4').total, 1);
  assert.equal(scoreTranscript(questions[2], '12:00').total, 1);
  assert.equal(scoreTranscript(questions[2], '12 am').total, 0);
});
test('Missing or failed ASQ transcription remains unassessed rather than becoming a zero', async () => {
  const recording = { mime: 'audio/webm', data: 'fixture' };
  for (const transcribe of [undefined, async () => { throw Error('Provider unavailable'); }, async () => undefined, async () => '']) {
    const result = await assess(questions[0], { recording }, { transcribe });
    assert.equal(result.status, 'unassessed');
    assert.equal(result.total, null);
    assert.equal(result.scores.content, null);
    assert.equal(result.maximum, 1);
    assert.equal(result.needsReview, true);
  }
  assert.equal((await assess(questions[0], {})).total, null);
  assert.equal(scoreTranscript(questions[0], null).status, 'unassessed');
});
test('An explicit skip is assessed as unanswered; conflicting recording state remains pending', async () => {
  let calls = 0;
  const result = await assess(questions[0], { skipped: true }, { transcribe: async () => { calls++; return 'author'; } });
  assert.equal(result.status, 'assessed'); assert.equal(result.total, 0); assert.equal(calls, 0);
  const conflict = await assess(questions[0], { skipped: true, recording: { data: 'saved-audio' } });
  assert.equal(conflict.status, 'unassessed');
});
test('ASQ uses the recorded response, ignores a submitted transcript and never gives its transcriber the key', async () => {
  const recording = { mime: 'audio/webm', data: 'saved-student-audio' };
  let received;
  const result = await assess(questions[0], { recording, transcript: 'author' }, { transcribe: async (...args) => { received = args; return 'reader'; } });
  assert.deepEqual(received, [recording]);
  assert.equal(result.total, 0);
  assert.equal(result.transcript, 'reader');
  assert.equal((await assess(questions[0], { recording }, { transcribe: async () => 'an author' })).total, 1);
});
test('ASQ refuses malformed keys and questions from another task', async () => {
  assert.throws(() => scoreTranscript({ type: 'rs', acceptedAnswers: ['author'] }, 'author'));
  assert.throws(() => scoreTranscript({ type: 'asq', acceptedAnswers: [''] }, 'author'));
  await assert.rejects(assess({ type: 'asq' }, { skipped: true }));
});
