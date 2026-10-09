'use strict';

function createReadiness({ probeStorage, timeoutMs = 2000, cacheMs = 2000 } = {}) {
  if (typeof probeStorage !== 'function') throw new Error('A storage probe is required.');
  let initialized = false, failed = false, stopping = false;
  let pendingProbe = null, cached = null, expiresAt = 0;
  const unavailable = status => ({ ready: false, status });
  function state() {
    if (stopping) return unavailable('stopping');
    if (failed) return unavailable('initialization_failed');
    if (!initialized) return unavailable('starting');
    return null;
  }
  async function check() {
    const blocked = state();
    if (blocked) return blocked;
    if (cached && Date.now() < expiresAt) return cached;
    // Keep one underlying probe until it actually settles. A timeout must not
    // launch another database connection for every concurrent health request.
    if (!pendingProbe) {
      const work = Promise.resolve().then(probeStorage)
        .then(() => ({ ready: true, status: 'ready' }), () => unavailable('storage_unavailable'));
      pendingProbe = work;
      work.then(() => { if (pendingProbe === work) pendingProbe = null; });
    }
    let timer;
    const result = await Promise.race([
      pendingProbe,
      new Promise(resolve => { timer = setTimeout(() => resolve(unavailable('storage_unavailable')), timeoutMs); })
    ]);
    clearTimeout(timer);
    const changed = state();
    if (changed) return changed;
    cached = result;
    expiresAt = Date.now() + cacheMs;
    return result;
  }
  return {
    markInitialized() { initialized = true; },
    markFailed() { failed = true; cached = null; },
    stop() { stopping = true; cached = null; },
    async handler(req, res) {
      const result = await check();
      res.set('Cache-Control', 'no-store');
      res.status(result.ready ? 200 : 503).json(result);
    },
    check
  };
}

module.exports = { createReadiness };
