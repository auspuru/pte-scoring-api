(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GradingRequest = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  // Only repeat grading calls: endpoints share pending work/cache or score an
  // immutable saved answer. Recovery is part of one student submission.
  async function request(url, options, { fetch: send = globalThis.fetch,
    wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
    validate = () => true, isFinal = () => true, canRetry = () => true,
    onRecover = () => {}, maxAttempts = 2 } = {}) {
    let lastError, provisional;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await send(url, options);
        let data;
        try { data = await response.json(); }
        catch (_) {
          const error = new Error('The assessment response was interrupted. Your response is safe.');
          error.retryable = response.ok || [500, 502, 503, 504].includes(response.status);
          throw error;
        }
        if (!response.ok) {
          const error = new Error(typeof data?.error === 'string' ? data.error : 'The assessment could not be completed. Your response is safe.');
          error.retryable = data?.retryable !== false && [500, 502, 503, 504].includes(response.status);
          throw error;
        }
        let valid;
        try { valid = validate(data); } catch (_) { valid = false; }
        if (!valid) {
          const error = new Error('The assessment response was incomplete. Your response is safe.');
          error.retryable = true; throw error;
        }
        if (isFinal(data)) return data;
        provisional = data;
      } catch (error) {
        if (options?.signal?.aborted || error.name === 'AbortError') throw error;
        if (error.retryable === false || (error.retryable !== true && error.name !== 'TypeError')) throw error;
        lastError = error;
      }
      if (attempt + 1 >= maxAttempts || !canRetry()) break;
      onRecover();
      await wait(1000 * (attempt + 1));
      if (options?.signal?.aborted) {
        const error = new Error('Assessment request cancelled.'); error.name = 'AbortError'; throw error;
      }
      if (!canRetry()) break;
    }
    // Preserve the explicitly provisional result if recovery cannot finish.
    if (provisional) return provisional;
    throw lastError || new Error('The assessment is unavailable. Your response is safe.');
  }
  return { request };
});
