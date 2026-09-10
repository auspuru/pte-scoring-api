(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReadingSessionTiming = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function current(session) { return session?.stages?.[session.stageIndex] || null; }
  function enter(session, index, now) {
    const stage = session.stages[index];
    session.stageIndex = index;
    session.index = stage.first;
    stage.startedAt = now;
    stage.deadline = now + stage.minutes * 60000;
    session.deadline = stage.deadline;
  }
  function initialise(session, stages, now) {
    if (!stages) return;
    let next = 0;
    for (const stage of stages) {
      if (!Number.isFinite(stage.minutes) || stage.minutes <= 0 || stage.first !== next || !Number.isInteger(stage.last) || stage.last < stage.first) throw Error('Invalid mixed-practice timing plan.');
      next = stage.last + 1;
    }
    if (next !== session.questions.length) throw Error('The timing plan does not cover every question.');
    session.stages = stages.map(stage => ({ ...stage }));
    enter(session, 0, now);
  }
  function complete(session, now, reason = 'submitted') {
    const stage = current(session);
    if (!stage || stage.finishedAt != null) return;
    stage.finishedAt = Math.min(now, stage.deadline);
    stage.completionReason = reason;
  }
  function advance(session, now, reason = 'submitted') {
    const stage = current(session);
    if (!stage) return false;
    // On expiry, later clocks start at the old deadline, even after time away.
    const at = reason === 'timeout' ? stage.deadline : Math.min(now, stage.deadline);
    complete(session, at, reason);
    if (session.stageIndex + 1 >= session.stages.length) return false;
    enter(session, session.stageIndex + 1, at);
    return true;
  }
  return { current, initialise, complete, advance };
});
