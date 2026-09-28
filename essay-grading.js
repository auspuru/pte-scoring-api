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
    const saved = hit && hit.expires > Date.now() ? structuredClone(hit.result) : null;
    if (saved && (saved.sampleStatus !== 'unavailable' || saved.scoreGate?.status === 'zero_form')) return saved;
    if (!saved) cache.delete(key);

    if (!pending.has(key)) {
      const task = (async () => {
        let assessment, primaryRaw;
        if (saved) {
          assessment = saved;
          primaryRaw = null;
        } else {
          const assessed = await assessEssay(question, essay, call, { onAttemptError });
          assessment = assessed.assessment;
          primaryRaw = assessed.primaryRaw;
        }
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

function essayResultForClient(result, clientVersion) {
  if (!result || result.scoreGate?.status !== 'zero_content' || clientVersion === policy.VERSION) {
    return result;
  }
  // Compatibility for an already-open browser running the pre-zero-content
  // validator. That validator needs diagnostic trait values as its input, then
  // applies the Content=0 hard gate itself. Current clients receive the
  // canonical already-zeroed result.
  if (!result.diagnosticScores || Number(result.diagnosticScores.content) !== 0) return result;
  return {
    ...structuredClone(result),
    scores: { ...result.diagnosticScores, total: 0 },
    compatibility: 'legacy-zero-content-input'
  };
}

module.exports = { createEssayGrader, essayResultForClient };
