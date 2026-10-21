'use strict';

// The independent readers share one deadline and call allowance. A failed
// reader cancels its peer; neither a late response nor a client retry may
// publish a primary-only assessment.
function createEssayCallBudget(providerCall, { timeoutMs = 120000, maxCalls = 8 } = {}) {
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  let calls = 0;
  const failure = (code, message) => Object.assign(new Error(message), { code, retryable: false });
  const timer = setTimeout(() => controller.abort(failure('ESSAY_ASSESSMENT_TIMEOUT', 'Essay assessment deadline exceeded.')), timeoutMs);

  async function call(prompt, options = {}) {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (calls >= maxCalls) {
      controller.abort(failure('ESSAY_CALL_BUDGET', 'Essay assessment call allowance exhausted.'));
      throw controller.signal.reason;
    }
    calls++;
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      controller.abort(failure('ESSAY_ASSESSMENT_TIMEOUT', 'Essay assessment deadline exceeded.'));
      throw controller.signal.reason;
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw controller.signal.reason;
        return providerCall(prompt, { ...options, signal: controller.signal, timeoutMs: Math.min(85000, remaining) });
      }).then(resolve, error => {
        if ([400,401,403].includes(error.status)) error.retryable=false;
        reject(error);
      }).finally(() => controller.signal.removeEventListener('abort', onAbort));
    });
  }

  function close() {
    clearTimeout(timer);
    if (!controller.signal.aborted) controller.abort(failure('ESSAY_CANCELLED', 'Essay assessment finished or a required reader failed.'));
  }
  return { call, close };
}

module.exports = { createEssayCallBudget };
