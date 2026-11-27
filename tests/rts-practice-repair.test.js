'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { gradePracticeContent } = require('../speaking-lab');
const { resultForClient } = require('../speaking-scoring');
const format = require('../speaking-judge-format');

const question = { id: 'synthetic-rts', type: 'rts', text: 'Ask your lecturer for an extension on Friday’s assignment.', facts: [] };
const transcript = 'I have been ill this week. Could I turn in Friday’s assignment on Monday?';
const review = {
  total: 6, overview: 'You make a clear request with a workable next step.', strengths: [], improvements: [],
  communicationAssessment: {
    level: 'developed', form: 'substantive', goalEvidence: 'Could I turn in Friday’s assignment on Monday?',
    contextEvidence: 'Friday’s assignment', developmentEvidence: 'on Monday',
    ownWordingEvidence: 'Could I turn in Friday’s assignment on Monday?', deductionEvidence: '',
    reason: 'The lecturer can act on the request and proposed date.'
  }
};
const invalid = { ...review, communicationAssessment: { ...review.communicationAssessment, developmentEvidence: '', ownWordingEvidence: '' } };

test('RTS practice sends targeted repair instructions through the provider request', async () => {
  let calls = 0;
  const result = await gradePracticeContent(question, transcript, (prompt, context) => {
    calls++;
    if (calls === 1) {
      assert.doesNotMatch(prompt, /RTS VALIDATION REPAIR/);
      return invalid;
    }
    const request = format.request(prompt, 'fake-model', context);
    assert.match(request.messages[0].content, /RTS VALIDATION REPAIR: Verify developmentEvidence and ownWordingEvidence/);
    assert.equal(context.transcript, transcript);
    return review;
  });
  assert.equal(calls, 2);
  assert.equal(result.total, 6);
  assert.equal(result.contentStatus, 'assessed');
});

test('RTS practice leaves a second invalid review pending', async () => {
  let calls = 0;
  const result = await gradePracticeContent(question, transcript, () => {
    calls++;
    return invalid;
  });
  assert.equal(calls, 2);
  assert.equal(resultForClient(result, transcript).total, null);
});

test('Full Mock can resume the exact prior source snapshot and rejects scorer drift', () => {
  const assessment = require('../full-mock/assessment');
  const { digest } = require('../full-mock/paper');
  const pins = require('../content/full-mock/rts-practice-repair-compatible-pins.json');
  const adapters = {};
  const engine = assessment.createEngine({ store: {}, adapters });
  const frozen = require('./helpers/sst-coaching-baseline').sstCoachingBaseline(engine.snapshot);
  const vocabularyPins = require('../content/full-mock/swt-vocabulary-upgrade-pins.json');
  for (const [file, entry] of Object.entries(vocabularyPins.previousFiles)) {
    frozen.scoringSources.files[file] = structuredClone(entry);
  }
  assert.equal(digest(frozen.scoringSources), vocabularyPins.previousDigest);
  assert.equal(engine.validate({ paperHash: frozen.paperHash, assessment: assessment.stateFor(frozen) }), adapters);
  const submittedHistoryPins = require('../content/full-mock/submitted-answer-history-compatible-pins.json');
  const sstRecoveryPins = require('../content/full-mock/sst-practice-recovery-compatible-pins.json');
  const practiceProviderPins = require('../content/full-mock/practice-provider-compatible-pins.json');
  for (const release of [practiceProviderPins, sstRecoveryPins, submittedHistoryPins, pins]) {
    for (const [file, hash] of Object.entries(release.previousFiles)) frozen.scoringSources.files[file].sha256 = hash;
    assert.equal(digest(frozen.scoringSources), release.previousDigest);
    assert.equal(engine.validate({ paperHash: frozen.paperHash, assessment: assessment.stateFor(frozen) }), adapters);
  }
  frozen.scoringSources.files['speaking-scoring.js'].sha256 = '0'.repeat(64);
  assert.throws(() => engine.validate({ paperHash: frozen.paperHash, assessment: assessment.stateFor(frozen) }), /different assessment version/);
});

test('Retry on a saved RTS attempt restores content and keeps confirmed delivery', async t => {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const os = require('node:os');
  const { randomUUID } = require('node:crypto');
  const express = require('express');
  const { installSpeakingLab } = require('../speaking-lab');
  const policy = require('../situation-content-policy-developed');
  const bankQuestion = require('../content/speaking-bank').questions.find(q => q.type === 'rts');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rts-practice-repair-'));
  const app = express();
  app.use(express.json());
  let calls = 0;
  const service = installSpeakingLab(app, {
    directory, verifyToken: token => token === 'synthetic-session' ? 'alice' : null, getAccount: async () => ({}),
    deliveryAssessmentAvailable: true, azureComparisonAvailable: false,
    transcribe: () => assert.fail('The saved transcript must be reused.'),
    assessDelivery: () => assert.fail('Confirmed delivery must be reused.'),
    callModel: async (prompt, context) => {
      assert.equal(context.transcript, transcript);
      if (++calls === 1) return invalid;
      assert.match(prompt, /RTS VALIDATION REPAIR/);
      return review;
    }
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await service.waitForAssessments();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });

  const id = randomUUID();
  const recording = { hash: 'saved-audio', mime: 'audio/wav', data: Buffer.alloc(200, 2).toString('base64') };
  const pronunciation = { score: 4, maximum: 5, raw: 88 };
  const fluency = { score: 5, maximum: 5, raw: 95 };
  await service.store.update('alice', id, () => ({
    id, questionId: bankQuestion.id, status: 'submitted', transcript, recording,
    rtsContentPolicyVersion: policy.VERSION,
    result: {
      total: null, maximum: 6, scoringMode: 'local', contentPolicyVersion: policy.VERSION, pronunciation, fluency,
      deliveryVersion: require('../speaking-delivery').VERSION
    }
  }));
  const url = 'http://127.0.0.1:' + server.address().port + '/api/speaking/attempts/' + id + '/submit';
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': 'synthetic-session' },
    body: JSON.stringify({ background: true })
  });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).assessment.status, 'pending');
  await service.waitForAssessments();
  const saved = await service.store.get('alice', id);
  assert.equal(saved.assessment.status, 'complete');
  assert.equal(saved.result.total, 6);
  assert.equal(calls, 2);
  assert.equal(saved.transcript, transcript);
  assert.deepEqual(saved.recording, recording);
  assert.deepEqual(saved.result.pronunciation, pronunciation);
  assert.deepEqual(saved.result.fluency, fluency);
});
