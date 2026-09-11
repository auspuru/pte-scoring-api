/* Shared account merge rules. No grading or score calculations belong here. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AccountProgress = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const list = value => Array.isArray(value) ? value : [];
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const keys = (a, b) => [...new Set([...Object.keys(object(a)), ...Object.keys(object(b))])].filter(k => !['__proto__', 'constructor', 'prototype'].includes(k)).sort();
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function time(value) {
    if (value == null || value === '') return 0;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
    return Date.parse(value) || 0;
  }
  function newer(a, b, at, bt) {
    if (a == null) return copy(b);
    if (b == null) return copy(a);
    if (time(at) !== time(bt)) return copy(time(at) > time(bt) ? a : b);
    // Stable tie breaking makes concurrent merges converge in either order.
    return copy(JSON.stringify(a) >= JSON.stringify(b) ? a : b);
  }
  const maxMap = (a, b) => Object.fromEntries(keys(a, b).map(k => [k, Math.max(time(a?.[k]), time(b?.[k]))]));
  function timedMap(a, b, clock) {
    return Object.fromEntries(keys(a, b).map(k => [k, newer(a?.[k], b?.[k], clock(a?.[k], k, a), clock(b?.[k], k, b))]));
  }
  function mergeAttempts(a, b, key, clock) {
    const records = new Map();
    for (const item of [...list(a), ...list(b)]) {
      if (!item || typeof item !== 'object') continue;
      const id = key(item), old = records.get(id);
      records.set(id, newer(old, item, clock(old), clock(item)));
    }
    return [...records.values()].sort((x, y) => time(clock(y)) - time(clock(x)) || key(x).localeCompare(key(y)));
  }
  function mergeSwt(a = {}, b = {}) {
    const history = Object.fromEntries(keys(a.history, b.history).map(pid => [pid,
      mergeAttempts(a.history?.[pid], b.history?.[pid], x => x.timestamp + '|' + (x.text || ''), x => x?.timestamp).slice(0, 10)]));
    const scoreTime = (profile, pid) => profile.scores?.[pid]?.__timestamp || profile.history?.[pid]?.[0]?.timestamp || 0;
    return {
      attempted: [...new Set([...list(a.attempted), ...list(b.attempted)])], history,
      summaries: timedMap(a.summaries, b.summaries, x => x?.timestamp),
      scores: Object.fromEntries(keys(a.scores, b.scores).map(pid => [pid,
        newer(a.scores?.[pid], b.scores?.[pid], scoreTime(a, pid), scoreTime(b, pid))])),
      scratch: timedMap(a.scratch, b.scratch, x => x?.updatedAt)
    };
  }
  function stampLibrary(current, previous, deleted = {}, now = Date.now()) {
    const old = new Map(list(previous).map(e => [String(e.id), e]));
    const removed = { ...object(deleted) };
    const essays = list(current).map(raw => {
      const e = copy(raw), prior = old.get(String(e.id));
      e._syncFields = { ...object(prior?._syncFields), ...object(e._syncFields) };
      for (const field of keys(e, prior).filter(k => k !== '_syncFields')) {
        if (!equal(e[field], prior?.[field])) e._syncFields[field] = Math.max(now, time(e._syncFields[field]) + 1);
      }
      old.delete(String(e.id));
      return e;
    });
    for (const id of old.keys()) removed[id] = Math.max(now, time(removed[id]) + 1);
    return { essays, essayLibraryDeleted: removed };
  }
  function mergeLibrary(a, b, deleted) {
    const map = new Map();
    for (const incoming of [...list(a), ...list(b)]) {
      if (!incoming || incoming.id == null) continue;
      const id = String(incoming.id), old = map.get(id);
      const clocks = maxMap(old?._syncFields, incoming._syncFields), item = { id: incoming.id, _syncFields: clocks };
      for (const field of keys(old, incoming).filter(k => k !== '_syncFields')) {
        item[field] = newer(old?.[field], incoming[field], old?._syncFields?.[field], incoming._syncFields?.[field]);
      }
      map.set(id, item);
    }
    return [...map.values()].filter(e => !deleted?.[e.id] || Math.max(0, ...Object.values(e._syncFields).map(time)) > time(deleted[e.id]));
  }
  function vocab(value) {
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch (_) { value = {}; } }
    return { ...object(value), read: object(value?.read), attempts: object(value?.attempts), readUpdatedAt: object(value?.readUpdatedAt) };
  }
  function stampVocab(current, previous, now = Date.now()) {
    const next = copy(vocab(current)), old = vocab(previous);
    next.readUpdatedAt = { ...old.readUpdatedAt, ...next.readUpdatedAt };
    for (const k of keys(next.read, old.read)) {
      if (!equal(next.read[k], old.read[k])) next.readUpdatedAt[k] = Math.max(now, time(next.readUpdatedAt[k]) + 1);
    }
    return next;
  }
  function mergeVocab(a, b) {
    a = vocab(a); b = vocab(b);
    const read = {}, readUpdatedAt = {};
    for (const k of keys({ ...a.read, ...a.readUpdatedAt }, { ...b.read, ...b.readUpdatedAt })) {
      const at = time(a.readUpdatedAt[k] || a.read[k]), bt = time(b.readUpdatedAt[k] || b.read[k]);
      const value = newer(a.read[k] || false, b.read[k] || false, at, bt);
      if (value) read[k] = value;
      readUpdatedAt[k] = Math.max(at, bt);
    }
    const attempts = Object.fromEntries(keys(a.attempts, b.attempts).map(k => [k,
      mergeAttempts(a.attempts[k], b.attempts[k], x => x.ts + '|' + x.sentence, x => x?.ts).reverse()]));
    return { read, readUpdatedAt, attempts };
  }
  function mergeDraft(a, b) { return newer(a, b, a?.updatedAt, b?.updatedAt) || null; }

  function validSession(s) {
    return s && typeof s.id === 'string' && Array.isArray(s.questions) && s.questions.length &&
      s.questions.every(q => q && typeof q.uid === 'string') && Number.isInteger(s.index) && s.index >= 0 && s.index < s.questions.length && s.answers && s.times;
  }
  // Store each immutable question snapshot once, even after many attempts.
  // Snapshots, rather than references to the current bank, preserve old feedback.
  function packReading(raw) {
    const reading = unpackReading(raw), questionPool = [], pool = new Map();
    function pack(s) {
      if (!validSession(s)) return null;
      return { ...s, questions: s.questions.map(q => {
        const signature = JSON.stringify(q);
        if (!pool.has(signature)) { pool.set(signature, questionPool.length); questionPool.push(q); }
        return pool.get(signature);
      }) };
    }
    const session = pack(reading.session), history = reading.history.map(pack).filter(Boolean), drafts = reading.drafts.map(pack).filter(Boolean);
    return { ...reading, version: 2, session, history, drafts, questionPool };
  }
  function unpackReading(raw) {
    raw = object(raw);
    function unpack(s) {
      if (!s || typeof s !== 'object') return null;
      if (raw.version === 2) s = { ...s, questions: list(s.questions).map(i => raw.questionPool?.[i]) };
      return validSession(s) ? copy(s) : null;
    }
    return { session: unpack(raw.session), history: list(raw.history).map(unpack).filter(Boolean), drafts: list(raw.drafts).map(unpack).filter(Boolean),
      practiceResults: copy(object(raw.practiceResults)), sessionSelectedAt: time(raw.sessionSelectedAt || raw.session?.startedAt) };
  }
  function stampReading(raw, previous, now = Date.now()) {
    const next = unpackReading(raw), old = unpackReading(previous);
    const records = new Map([old.session, ...old.history, ...old.drafts].filter(Boolean).map(s => [s.id, s]));
    for (const s of [next.session, ...next.history, ...next.drafts].filter(Boolean)) {
      const before = records.get(s.id);
      s.answerUpdatedAt = { ...object(before?.answerUpdatedAt), ...object(s.answerUpdatedAt) };
      s.assessmentUpdatedAt = { ...object(before?.assessmentUpdatedAt), ...object(s.assessmentUpdatedAt) };
      for (const k of keys(before?.answers, s.answers)) if (!equal(before?.answers[k], s.answers[k])) s.answerUpdatedAt[k] = Math.max(now, time(s.answerUpdatedAt[k]) + 1);
      for (const k of keys(before?.assessments, s.assessments)) if (!equal(before?.assessments[k], s.assessments[k])) s.assessmentUpdatedAt[k] = Math.max(now, time(s.assessmentUpdatedAt[k]) + 1);
      if (!equal(s, before)) s.updatedAt = Math.max(now, time(s.updatedAt));
    }
    if (next.session?.id !== old.session?.id) next.sessionSelectedAt = Math.max(now, old.sessionSelectedAt + 1);
    return next;
  }
  function mergeSession(a, b) {
    if (!a || !b) return copy(a || b);
    const s = newer(a, b, a.updatedAt || a.startedAt, b.updatedAt || b.startedAt);
    const testing = s.mode !== 'practice' && s.mode !== 'diagnostic';
    s.done = !!(a.done || b.done);
    if (testing) s.index = Math.max(a.index, b.index);
    s.answerUpdatedAt = maxMap(a.answerUpdatedAt, b.answerUpdatedAt);
    s.assessmentUpdatedAt = maxMap(a.assessmentUpdatedAt, b.assessmentUpdatedAt);
    s.answers = {};
    for (const q of s.questions) {
      const i = s.questions.findIndex(item => item.uid === q.uid);
      const lockedA = a.done || testing && i < a.index, lockedB = b.done || testing && i < b.index;
      // Submission locks the answer, including an intentionally skipped blank.
      if (lockedA !== lockedB) s.answers[q.uid] = copy((lockedA ? a : b).answers[q.uid] || []);
      else s.answers[q.uid] = newer(a.answers[q.uid], b.answers[q.uid], a.answerUpdatedAt?.[q.uid] || a.updatedAt, b.answerUpdatedAt?.[q.uid] || b.updatedAt) || [];
    }
    s.assessments = {};
    for (const k of keys(a.assessments, b.assessments)) {
      const x = a.assessments?.[k], y = b.assessments?.[k];
      s.assessments[k] = x?.status === 'complete' && y?.status !== 'complete' ? copy(x) : y?.status === 'complete' && x?.status !== 'complete' ? copy(y) :
        newer(x, y, a.assessmentUpdatedAt?.[k] || a.updatedAt, b.assessmentUpdatedAt?.[k] || b.updatedAt);
    }
    s.audioStates = Object.fromEntries(keys(a.audioStates, b.audioStates).map(k => [k,
      a.audioStates?.[k]?.status === 'complete' ? copy(a.audioStates[k]) : b.audioStates?.[k]?.status === 'complete' ? copy(b.audioStates[k]) :
        newer(a.audioStates?.[k], b.audioStates?.[k], a.updatedAt, b.updatedAt)]));
    s.times = maxMap(a.times, b.times);
    s.checked = [...new Set([...list(a.checked), ...list(b.checked)])];
    s.stageIndex = Math.max(a.stageIndex || 0, b.stageIndex || 0);
    if (s.stages) {
      const advanced = (a.stageIndex || 0) > (b.stageIndex || 0) ? a : (b.stageIndex || 0) > (a.stageIndex || 0) ? b : null;
      if (advanced) { s.stages = copy(advanced.stages); s.deadline = advanced.deadline; }
      else {
        s.stages = s.stages.map((stage, i) => {
          const x = a.stages?.[i], y = b.stages?.[i];
          const value = newer(x, y, x?.finishedAt || x?.startedAt, y?.finishedAt || y?.startedAt) || stage;
          for (const field of ['startedAt', 'deadline', 'finishedAt']) {
            const values = [x?.[field], y?.[field]].filter(Number.isFinite);
            if (values.length) value[field] = Math.min(...values);
          }
          return value;
        });
        s.deadline = s.stages[s.stageIndex].deadline;
      }
    } else if (a.deadline != null && b.deadline != null) s.deadline = Math.min(a.deadline, b.deadline);
    if (s.done) s.finishedAt = Math.min(...[a.finishedAt, b.finishedAt].filter(Number.isFinite));
    s.updatedAt = Math.max(time(a.updatedAt), time(b.updatedAt));
    return s;
  }
  function mergeReading(left, right) {
    const a = unpackReading(left), b = right?.version === 3 ? expandReadingPatch(right, a) : unpackReading(right), sessions = new Map();
    for (const s of [...a.history, ...a.drafts, a.session, ...b.history, ...b.drafts, b.session].filter(Boolean)) sessions.set(s.id, mergeSession(sessions.get(s.id), s));
    const selected = newer(a.session, b.session, a.sessionSelectedAt, b.sessionSelectedAt);
    const session = selected ? sessions.get(selected.id) : null;
    const records = [...sessions.values()];
    return { session, sessionSelectedAt: Math.max(a.sessionSelectedAt, b.sessionSelectedAt),
      history: records.filter(s => s.done).sort((x, y) => y.finishedAt - x.finishedAt),
      drafts: records.filter(s => !s.done && s.id !== session?.id).sort((x, y) => y.startedAt - x.startedAt),
      practiceResults: timedMap(a.practiceResults, b.practiceResults, x => x?.finishedAt) };
  }
  function changedMap(before, after) {
    return Object.fromEntries(keys(before, after).filter(k => !equal(before?.[k], after?.[k]) && after?.[k] !== undefined).map(k => [k, copy(after[k])]));
  }
  function readingRecords(reading) {
    return new Map([...reading.history, ...reading.drafts, reading.session].filter(Boolean).map(s => [s.id, s]));
  }
  function readingPatch(before, after) {
    const a = unpackReading(before), b = unpackReading(after), old = readingRecords(a), patches = [];
    for (const [id, s] of readingRecords(b)) {
      const previous = old.get(id);
      if (equal(previous, s)) continue;
      const patch = { ...changedMap(previous, s), id };
      for (const field of ['answers', 'answerUpdatedAt', 'assessments', 'assessmentUpdatedAt', 'audioStates', 'times']) {
        if (patch[field]) patch[field] = changedMap(previous?.[field], s[field]);
      }
      patches.push(patch);
    }
    return { version: 3, patches, sessionId: b.session?.id || null, sessionSelectedAt: b.sessionSelectedAt,
      practiceResults: changedMap(a.practiceResults, b.practiceResults) };
  }
  function expandReadingPatch(patch, base) {
    const sessions = readingRecords(base);
    for (const incoming of list(patch.patches)) {
      if (!incoming || typeof incoming.id !== 'string') continue;
      const old = sessions.get(incoming.id), s = { ...old, ...incoming };
      for (const field of ['answers', 'answerUpdatedAt', 'assessments', 'assessmentUpdatedAt', 'audioStates', 'times']) s[field] = { ...object(old?.[field]), ...object(incoming[field]) };
      if (validSession(s)) sessions.set(s.id, s);
    }
    const session = sessions.get(patch.sessionId) || null;
    return { session, sessionSelectedAt: time(patch.sessionSelectedAt),
      history: [...sessions.values()].filter(s => s.done), drafts: [...sessions.values()].filter(s => !s.done && s.id !== session?.id),
      practiceResults: object(patch.practiceResults) };
  }
  // Send changes, not a growing copy of the student's full history. In
  // particular, ordinary answer saves fit the browser's keepalive budget.
  function progressDelta(before = {}, after = {}) {
    const out = {};
    for (const field of ['summaries', 'scores', 'history', 'scratch', 'essayLibraryDeleted']) {
      const changed = changedMap(before[field], after[field]);
      if (Object.keys(changed).length) out[field] = changed;
    }
    const attempted = list(after.attempted).filter(id => !list(before.attempted).includes(id));
    if (attempted.length) out.attempted = attempted;
    const oldEssays = new Map(list(before.essays).map(e => [String(e.id), e]));
    const essays = list(after.essays).filter(e => !equal(oldEssays.get(String(e.id)), e));
    if (essays.length) out.essays = essays;
    if (!equal(before.vocabProgress, after.vocabProgress)) {
      const a = vocab(before.vocabProgress), b = vocab(after.vocabProgress);
      out.vocabProgress = { read: changedMap(a.read, b.read), readUpdatedAt: changedMap(a.readUpdatedAt, b.readUpdatedAt), attempts: changedMap(a.attempts, b.attempts) };
    }
    if (!equal(before.essayDraft, after.essayDraft) && after.essayDraft) out.essayDraft = after.essayDraft;
    const reading = readingPatch(before.readingProgress, after.readingProgress);
    if (reading.patches.length || Object.keys(reading.practiceResults).length || reading.sessionSelectedAt !== unpackReading(before.readingProgress).sessionSelectedAt) out.readingProgress = reading;
    return out;
  }
  function mergeProgress(a = {}, b = {}) {
    const essayLibraryDeleted = maxMap(a.essayLibraryDeleted, b.essayLibraryDeleted);
    return { ...mergeSwt(a, b), essays: mergeLibrary(a.essays, b.essays, essayLibraryDeleted), essayLibraryDeleted,
      vocabProgress: mergeVocab(a.vocabProgress, b.vocabProgress), essayDraft: mergeDraft(a.essayDraft, b.essayDraft),
      readingProgress: packReading(mergeReading(a.readingProgress, b.readingProgress)) };
  }
  return { equal, time, mergeSwt, stampLibrary, mergeLibrary, stampVocab, mergeVocab, mergeDraft,
    validSession, packReading, unpackReading, stampReading, mergeSession, mergeReading, mergeProgress, progressDelta };
});
