'use strict';

// Saving is acknowledged separately from the potentially long assessment.
// The saved snapshot also lets polling/playback read while the grader works.
function createPracticeAssessment({ store, assess, now = Date.now }) {
  const jobs = new Map();
  const key = (uid, id) => uid + ':' + id;
  const missing = () => Object.assign(Error('Attempt not found.'), { status: 404 });
  function request(uid, id, options = {}) {
    const name = key(uid, id), existing = jobs.get(name);
    if (existing) return existing;
    const pending = store.update(uid, id, a => {
      if (!a) throw missing();
      a.assessment = { status: 'pending', startedAt: now() };
      return a;
    });
    const job = { pending, work: null };
    jobs.set(name, job);
    job.work = pending.then(() => assess(uid, id, options)).then(() => store.update(uid, id, a => {
      if (!a) throw missing();
      a.assessment = { ...a.assessment, status: 'complete', finishedAt: now() };
      return a;
    })).catch(async error => {
      await store.update(uid, id, a => {
        if (!a) return a;
        a.assessment = { ...a.assessment, status: 'error', finishedAt: now(),
          error: error.status ? error.message : 'Assessment could not finish. Your response is saved; retry assessment.' };
        return a;
      }).catch(() => {});
      throw error;
    }).finally(() => { if (jobs.get(name) === job) jobs.delete(name); });
    // A background caller receives pending immediately; keep failures handled
    // while their durable error state remains available through GET.
    job.work.catch(() => {});
    return job;
  }
  async function get(uid, id) {
    const running = jobs.get(key(uid, id));
    if (running) return running.pending;
    return store.update(uid, id, a => {
      if (!a) throw missing();
      if (a.assessment?.status === 'pending' && now() - a.assessment.startedAt > 10 * 60 * 1000) a.assessment = { ...a.assessment, status:'error',
        error:'Assessment was interrupted. Your response is saved; retry assessment.' };
      return a;
    });
  }
  return { request, get, wait: () => Promise.allSettled([...jobs.values()].map(job => job.work)) };
}
module.exports = { createPracticeAssessment };
