'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const continuous = require('../azure-continuous-delivery');
const { pcmWav, wavSeconds } = require('../speaking-delivery');
const wav = seconds => pcmWav(Buffer.alloc(32000 * seconds));

test('the comparison sends a long response once as a whole WAV', async () => {
  let calls = 0;
  const result = await continuous.assessRecording({}, {
    prepare: async () => [wav(28), wav(20)],
    assess: async (recording, options) => {
      calls++;
      assert.equal(wavSeconds(recording), 48);
      assert.deepEqual(options, { seconds: 48 });
      return [{ accuracy: 89, fluency: 75, weight: 23 }, { accuracy: 89, fluency: 75, weight: 24 }];
    }
  });
  assert.equal(calls, 1);
  assert.equal(result.pronunciation.score, 4);
  assert.equal(result.fluency.score, 3);
  assert.equal(result.recognizedSeconds, 47);
});

function fakeSdk(run) {
  return {
    SpeechConfig: { fromSubscription: () => ({}) }, OutputFormat: {},
    AudioConfig: { fromWavFileInput: () => ({}) },
    PronunciationAssessmentGradingSystem: {}, PronunciationAssessmentGranularity: {},
    PronunciationAssessmentConfig: class {
      constructor(reference) { assert.equal(reference, ''); }
      applyTo() {}
    },
    ResultReason: { RecognizedSpeech: 1 },
    CancellationReason: { EndOfStream: 1 },
    PropertyId: {},
    SpeechRecognizer: class {
      startContinuousRecognitionAsync() { queueMicrotask(() => run(this)); }
      close() { assert.equal(this.closed, undefined); this.closed = true; }
    }
  };
}

function emitSpeech(recognizer) {
  recognizer.recognized(null, {
    result: {
      reason: 1,
      properties: {
        getProperty: () => JSON.stringify({
          Duration: 20_000_000, NBest: [{ PronunciationAssessment: { AccuracyScore: 90, FluencyScore: 80 } }]
        })
      }
    }
  });
}

test('continuous Speech waits for session completion and rejects partial output on cancellation', async () => {
  const options = { key: 'test', region: 'test', endpoint: '', timeoutMs: 1000 };
  const segments = await continuous.assessWav(wav(40), { ...options, sdk: fakeSdk(recognizer => {
    emitSpeech(recognizer);
    emitSpeech(recognizer);
    recognizer.canceled(null, { reason: 1 });
    recognizer.sessionStopped();
  }) });
  assert.deepEqual(segments.map(segment => segment.weight), [2, 2]);
  await assert.rejects(continuous.assessWav(wav(40), { ...options, sdk: fakeSdk(recognizer => {
    emitSpeech(recognizer);
    recognizer.canceled(null, { reason: 2 });
    recognizer.sessionStopped();
  }) }), { uncertain: true });
});

test('continuous Speech supports the portal endpoint configuration without a region', async()=>{
 const sdk=fakeSdk(recognizer=>{emitSpeech(recognizer);recognizer.sessionStopped();});let endpoint;
 sdk.SpeechConfig.fromSubscription=()=>{throw Error('Region must not be required');};
 sdk.SpeechConfig.fromEndpoint=url=>{endpoint=url.toString();return {};};
 await continuous.assessWav(wav(2),{sdk,key:'synthetic-key',region:'',endpoint:'https://synthetic.cognitiveservices.azure.com/stt/speech/recognition/conversation/cognitiveservices/v1',timeoutMs:1000});
 assert.equal(endpoint,'wss://synthetic.cognitiveservices.azure.com/stt/speech/recognition/conversation/cognitiveservices/v1');
 assert.equal(continuous.configuration({AZURE_SPEECH_KEY:'synthetic-key',AZURE_SPEECH_RESOURCE:'synthetic'}).ready,true);
 assert.equal(continuous.configuration({AZURE_SPEECH_KEY:'synthetic-key',AZURE_SPEECH_ENDPOINT:'invalid'}).ready,false);
 assert.throws(()=>continuous.assessWav(wav(2),{sdk,key:'',region:'',endpoint:''}),{providerStarted:false,code:'AZURE_CONFIGURATION'});
});
