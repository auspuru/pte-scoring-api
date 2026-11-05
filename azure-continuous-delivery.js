'use strict';

const delivery = require('./speaking-delivery');
const VERSION = 'azure-continuous-delivery-2026-11-06.1';
const TICKS_PER_SECOND = 10_000_000;

function configuration(env = process.env) {
  const hasKey = !!String(env.AZURE_SPEECH_KEY || '').trim();
  const endpoint = delivery.endpointFromEnv(env);
  let validEndpoint=false;try{const url=new URL(endpoint);validEndpoint=['https:','wss:'].includes(url.protocol)&&!!url.hostname;}catch{}
  const hasLocation = validEndpoint || !!String(env.AZURE_SPEECH_REGION || '').trim();
  return { ready: hasKey && hasLocation, message: hasKey && hasLocation ? '' : 'Azure Speech is not configured for this service. Configure its key and endpoint or region before sending recordings.' };
}
function assessWav(wav, {
  sdk = require('microsoft-cognitiveservices-speech-sdk'),
  key = process.env.AZURE_SPEECH_KEY,
  region = process.env.AZURE_SPEECH_REGION,
  endpoint = delivery.endpointFromEnv(),
  locale = process.env.AZURE_SPEECH_LOCALE || 'en-AU',
  seconds = delivery.wavSeconds(wav),
  timeoutMs = Math.ceil((seconds + 60) * 1000)
} = {}) {
  if (!key || !endpoint && !region) throw Object.assign(Error('Azure Speech needs its configured key and endpoint or region.'), { code: 'AZURE_CONFIGURATION', uncertain: false, providerStarted: false });
  let config;
  try { if (endpoint) {
    const url = new URL(endpoint); url.protocol = 'wss:';
    config = sdk.SpeechConfig.fromEndpoint(url, key);
  } else config = sdk.SpeechConfig.fromSubscription(key, region);
  } catch {throw Object.assign(Error('Azure Speech configuration could not initialize.'), {code:'AZURE_CONFIGURATION',providerStarted:false,uncertain:false});}
  config.speechRecognitionLanguage = locale;
  config.outputFormat = sdk.OutputFormat.Detailed;
  const audio = sdk.AudioConfig.fromWavFileInput(wav);
  const recognizer = new sdk.SpeechRecognizer(config, audio);
  return new Promise((resolve, reject) => {
    const segments = [];
    let settled = false;
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      recognizer.close();
      if (error) reject(error);
      else if (segments.length) resolve(segments);
      else reject(Error('Azure continuous Speech returned no usable delivery scores.'));
    }
    const timer = setTimeout(() => finish(Object.assign(
      Error('Azure continuous assessment timed out.'), { uncertain: true, code: 'AZURE_TIMEOUT' }
    )), timeoutMs);
    try {
      // Free responses use Azure's unscripted assessment. The content transcript
      // is separate and is never sent as an acoustic reference.
      new sdk.PronunciationAssessmentConfig(
        '', sdk.PronunciationAssessmentGradingSystem.HundredMark,
        sdk.PronunciationAssessmentGranularity.Word, false
      ).applyTo(recognizer);
      recognizer.recognized = (_, event) => {
        if (settled || event.result.reason !== sdk.ResultReason.RecognizedSpeech) return;
        try {
          const detail = JSON.parse(event.result.properties.getProperty(sdk.PropertyId.SpeechServiceResponse_JsonResult));
          const segment = delivery.extractAssessment(detail);
          const weight = segment.duration / TICKS_PER_SECOND;
          if (!Number.isFinite(segment.accuracy) || !Number.isFinite(segment.fluency) || weight <= 0) {
            return finish(Error('Azure continuous Speech returned an incomplete segment.'));
          }
          segments.push({ ...segment, weight });
        } catch {
          finish(Error('Azure continuous Speech returned an unreadable segment.'));
        }
      };
      recognizer.canceled = (_, event) => {
        if (event.reason === sdk.CancellationReason.EndOfStream) return;
        finish(Object.assign(Error('Azure continuous Speech canceled the assessment.'), { uncertain: true }));
      };
      recognizer.sessionStopped = () => finish();
      recognizer.startContinuousRecognitionAsync(() => {}, () => finish(Object.assign(
        Error('Azure continuous Speech could not start.'), { uncertain: true }
      )));
    } catch {
      finish(Error('Azure continuous Speech could not initialize.'));
    }
  });
}

async function assessRecording(recording, { assess = assessWav, prepare = delivery.splitToWav } = {}) {
  const chunks = await prepare(recording);
  const wav = delivery.pcmWav(Buffer.concat(chunks.map(delivery.pcmData)));
  const seconds = delivery.wavSeconds(wav);
  if (!seconds) throw Error('A nonempty saved recording is required.');
  const segments = await assess(wav, { seconds });
  const assessed = delivery.aggregate(segments);
  return {
    version: VERSION, seconds, segments: segments.length,
    recognizedSeconds: Math.round(segments.reduce((total, segment) => total + segment.weight, 0) * 10) / 10,
    pronunciation: { raw: assessed.pronunciation.raw, score: assessed.pronunciation.score },
    fluency: { raw: assessed.fluency.raw, score: assessed.fluency.score }
  };
}

module.exports = { assessWav, assessRecording, configuration };
