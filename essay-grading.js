'use strict';
const { createHash } = require('node:crypto');
const policy = require('./public/essay-scoring');
const localEngine = require('./local-scoring-engine');
function createEssayGrader(call, { onAttemptError = () => {} } = {}) {
  const cache = new Map(), pending = new Map();
  async function grade(question, essay) {
    question = question.trim(); essay = essay.trim();
    const key = createHash('sha256').update(JSON.stringify([policy.VERSION, question, essay])).digest('hex');
    const hit = cache.get(key);
    const savedAssessment = hit && hit.expires > Date.now() ? hit.result : null;
    if (savedAssessment && savedAssessment.sampleStatus !== 'unavailable') return structuredClone(savedAssessment);
    // A local fallback is not a validated AI assessment. On a later retry,
    // start the full AI assessment again rather than asking only for a sample.
    const savedLocal = savedAssessment?.scoringMode === 'local' ? savedAssessment : null;
    cache.delete(key);
    if (!pending.has(key)) {
      const task = (async () => {
        let assessment = savedLocal ? null : savedAssessment;
        let lastError;
        const remember = result => {
          cache.set(key, { result: structuredClone(result), expires: Date.now() + 20 * 60 * 1000 });
          while (cache.size > 100) cache.delete(cache.keys().next().value);
          return result;
        };
        for (let attempt = 0; attempt < 2; attempt++) {
          const stage = assessment ? 'sample' : 'assessment';
          try {
            const prompt = assessment ? policy.buildSamplePrompt(question, essay, assessment) : policy.buildPrompt(question, essay);
            const retry = lastError ? '\nVALIDATION RETRY: ' + (lastError.validationHint || 'Return complete valid JSON, all required fields and exact short original-essay quotations. Keep language scores consistent with meaning-changing error evidence.') : '';
            const raw = await call(prompt + retry);
            if (!assessment) assessment = policy.normalizeAssessment(raw, essay);
            const sample = policy.normalizeSample(raw, essay, assessment, { allowUnavailable: false });
            return remember({ ...assessment, ...sample });
          } catch (error) {
            lastError = error;
            onAttemptError({ attempt: attempt + 1, stage: assessment ? 'sample' : stage,
              code: error.code || error.name || 'unknown', status: error.status });
          }
        }
        // A failed learning sample must not erase an already validated grade.
        // Keep that assessment so a sample retry cannot change the student's score.
        if (assessment) return remember({ ...assessment, sampleStatus: 'unavailable', sampleKind: 'unavailable',
          sampleResponse: '', sampleWordCount: 0, sampleSourceIdeas: [],
          sampleNote: 'Your score and feedback are ready. Your Band 9 sample could not be prepared yet. Retry the sample below.' });
        if (savedLocal) return remember(savedLocal);
        const local = localEngine.essay(question, essay, { formScore: policy.formFor(essay).score });
        local.scoring_version = policy.VERSION + '+' + localEngine.VERSION;
        local.fallbackReason = lastError?.message || 'External essay reviewer unavailable';
        return remember(local);
      })();
      pending.set(key, task);
      task.finally(() => pending.delete(key)).catch(() => {});
    }
    return structuredClone(await pending.get(key));
  }
  return { grade };
}
module.exports = { createEssayGrader };
