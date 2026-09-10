'use strict';
const { createHash } = require('node:crypto');
const policy = require('./public/essay-scoring');
function createEssayGrader(call) {
  const cache = new Map(), pending = new Map();
  async function grade(question, essay) {
    question = question.trim(); essay = essay.trim();
    const key = createHash('sha256').update(JSON.stringify([policy.VERSION, question, essay])).digest('hex');
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return structuredClone(hit.result);
    cache.delete(key);
    if (!pending.has(key)) {
      const task = (async () => {
        const prompt = policy.buildPrompt(question, essay);
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const raw = await call(prompt + (attempt ? '\nVALIDATION RETRY: Return all required fields, exact short essay quotations and mutually consistent scores, error evidence and feedback. Use the supplied ORIGINAL essay word count. A ready sample must be 200–300 words in exactly four plain-text paragraphs, including at 26/26, with sampleSourceIdeas quoted from the original. Remove all names, statistics and factual examples absent from the original; develop the student\'s existing reasons instead. Use needs-ideas only for a specific missing idea or required position; never silently omit or shorten the sample.' : ''));
            const result = policy.normalizeResult(raw, essay);
            cache.set(key, { result: structuredClone(result), expires: Date.now() + 20 * 60 * 1000 });
            while (cache.size > 100) cache.delete(cache.keys().next().value);
            return result;
          } catch (error) {
            if (attempt === 1) throw new Error('The essay assessment could not be completed. Please try again.');
          }
        }
      })();
      pending.set(key, task);
      task.finally(() => pending.delete(key)).catch(() => {});
    }
    return structuredClone(await pending.get(key));
  }
  return { grade };
}
module.exports = { createEssayGrader };
