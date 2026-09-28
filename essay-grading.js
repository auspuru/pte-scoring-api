'use strict';
const { createHash } = require('node:crypto');
const policy = require('./public/essay-scoring');
const { assessEssay } = require('./essay-assessment-service');

function createEssayGrader(call, { onAttemptError = () => {} } = {}) {
  const cache = new Map(), pending = new Map();

  async function prepareSample(question, essay, assessment, primaryRaw) {
    if (assessment.scoreGate?.status === 'zero_form') {
      return {
        sampleStatus: 'unavailable',
        sampleKind: 'unavailable',
        sampleResponse: '',
        sampleWordCount: 0,
        sampleSourceIdeas: [],
        sampleNote: 'Revise the response into valid essay form first; then rescore it for a Band 9-style sample.'
      };
    }

    const primaryStillMatches = primaryRaw
      && (assessment.subjectiveReview?.source === 'agreement' || !assessment.subjectiveReview)
      && assessment.scoreGate?.status !== 'zero_content';

    if (primaryStillMatches) {
      try {
        return policy.normalizeSample(primaryRaw, essay, assessment, { allowUnavailable: false });
      } catch (error) {
        onAttemptError({ attempt: 1, stage: 'sample-from-primary', code: error.code || error.name || 'unknown' });
      }
    }

    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const retry = lastError
          ? '\nVALIDATION RETRY: ' + (lastError.validationHint || 'Return a complete sample result consistent with the already-final assessment.')
          : '';
        const raw = await call(policy.buildSamplePrompt(question, essay, assessment) + retry);
        return policy.normalizeSample(raw, essay, assessment, { allowUnavailable: false });
      } catch (error) {
        lastError = error;
        onAttemptError({ attempt: attempt + 1, stage: 'sample', code: error.code || error.name || 'unknown' });
      }
    }

    return {
      sampleStatus: 'unavailable',
      sampleKind: 'unavailable',
      sampleResponse: '',
      sampleWordCount: 0,
      sampleSourceIdeas: [],
      sampleNote: 'Your score and feedback are ready. The learning sample could not be prepared consistently; retry it later.'
    };
  }

  async function grade(question, essay) {
    question = String(question || '').trim();
    essay = String(essay || '').trim();
    const key = createHash('sha256').update(JSON.stringify([policy.VERSION, question, essay])).digest('hex');
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return structuredClone(hit.result);
    cache.delete(key);

    if (!pending.has(key)) {
      const task = (async () => {
        const { assessment, primaryRaw } = await assessEssay(question, essay, call, { onAttemptError });
        const sample = await prepareSample(question, essay, assessment, primaryRaw);
        const result = { ...assessment, ...sample };
        cache.set(key, { result: structuredClone(result), expires: Date.now() + 20 * 60 * 1000 });
        while (cache.size > 100) cache.delete(cache.keys().next().value);
        return result;
      })();
      pending.set(key, task);
      task.finally(() => pending.delete(key)).catch(() => {});
    }
    return structuredClone(await pending.get(key));
  }

  return { grade };
}

module.exports = { createEssayGrader };
