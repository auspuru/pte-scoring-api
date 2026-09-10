'use strict';
const { createHash } = require('node:crypto');

// Identical source + response + rubric use one assessment, whether submitted
// by a learner or checked as a reference. No sample-answer score overrides.
function createJudgmentService({ call, buildPrompt, policyVersion, isComplete, validationIssues = () => [],
  onAttemptError = () => {}, totalTimeoutMs = 55000, maxEntries = 200, ttlMs = 20 * 60 * 1000 }) {
  const cache = new Map();
  const pending = new Map();
  const keyFor = (summary, passage, ideas) => createHash('sha256')
    .update(JSON.stringify([policyVersion, summary.trim(), passage.trim(), ideas])).digest('hex');
  async function judge(summary, passage, ideas, timeoutMs = 30000) {
    const key = keyFor(summary, passage, ideas);
    const saved = cache.get(key);
    if (saved && saved.expires > Date.now()) return structuredClone(saved.value);
    cache.delete(key);
    if (!pending.has(key)) {
      const task = (async () => {
        const deadline = Date.now() + totalTimeoutMs;
        let attempts = 0;
        async function read(prompt, stage) {
          const remaining = Math.min(timeoutMs, deadline - Date.now());
          if (attempts >= 2 || remaining <= 0) return null;
          attempts++;
          const controller = new AbortController();
          let timer;
          try {
            const response = await Promise.race([
              Promise.resolve().then(() => call(prompt, remaining, { signal: controller.signal })),
              new Promise((_, reject) => { timer = setTimeout(() => {
                const error = new Error('SWT assessment timed out'); error.code = 'SWT_TIMEOUT';
                reject(error); controller.abort();
              }, remaining); })
            ]);
            if (!response || !isComplete(response, summary)) onAttemptError({ stage, attempt: attempts,
              code: response ? 'incomplete_assessment' : 'empty_response', issues: response ? validationIssues(response, summary) : [] });
            return response;
          } catch (error) {
            onAttemptError({ stage, attempt: attempts, code: error.code || error.name || 'unknown', status: error.status });
            return null;
          } finally { clearTimeout(timer); }
        }
        const prompt = buildPrompt(summary, passage, ideas);
        let result = await read(prompt, 'assessment');
        if (!result) result = await read(prompt + '\n\nThe previous request did not return a complete response. Return complete JSON with all required assessment and annotation fields.', 'retry');
        if (!result) return null;
        const a = result.summary_assessment || {};
        // Review relationship deductions where the judge already acknowledges
        // the main idea and useful support. The review may confirm OR correct
        // the score; it must not promote a genuinely incomplete answer.
        const disputed = a.main_idea_accurate === true && a.supporting_evidence?.length
          && (a.relationships_clear === false || a.material_meaning_change === true
            || a.missing_dependencies?.length || result.cohesion === 'weak'
            || [...(Array.isArray(result.grammar_annotations) ? result.grammar_annotations : []),
                ...(Array.isArray(result.vocabulary_annotations) ? result.vocabulary_annotations : [])]
              .some(item => ['changed', 'obscured'].includes(item.meaning_impact)));
        if (disputed || !isComplete(result, summary)) {
          // Do not include the preliminary score/flags: they can anchor the
          // reviewer even when its new explanation explicitly rejects them.
          const reviewPrompt = prompt + '\n\nSECOND-PASS CONSISTENCY CHECK:\n'
            + 'Independently reassess this response from the passage. Pay particular attention to category-level paraphrases, pronoun referents, locally stated reasons, and additive versus causal links. Confirm a deduction only for a genuinely missing necessary proposition or explicit material falsehood. A regulatory advantage can explain competitive dominance without naming individual laws; a named invention can be the referent of it despite an intervening clause about motivation. Keep stylistic refinements optional. Do not assume any benchmark guarantees a score. Return a fresh complete JSON assessment with mutually consistent numerical scores, semantic flags and short actionable feedback. If the relationships are faithful, set relationships_clear true and material_meaning_change false; do not retain a deduction whose explanation you reject. Copy main_idea_evidence and each supporting_evidence as a CONTIGUOUS EXACT substring of the student summary: no inserted brackets, ellipses, paraphrases or altered verb forms.';
          const issues = validationIssues(result, summary);
          const reviewed = await read(reviewPrompt + (issues.length ? '\nCorrect these invalid fields: ' + issues.join(', ') + '.' : ''), 'review');
          if (reviewed && isComplete(reviewed, summary)) result = { ...reviewed, consistency_reviewed: true };
          else result = { ...result, review_unavailable: true };
        }
        if (isComplete(result, summary) && !result.review_unavailable) {
          cache.set(key, { value: structuredClone(result), expires: Date.now() + ttlMs });
          while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
        }
        return result;
      })();
      pending.set(key, task);
      task.finally(() => pending.delete(key)).catch(() => {});
    }
    const result = await pending.get(key);
    return result && structuredClone(result);
  }
  return { judge, keyFor };
}
module.exports = { createJudgmentService };
