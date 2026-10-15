'use strict';

// Shared, dependency-free helpers for merging scored essay attempts.  The
// browser uses these when reconciling its local queue with the cloud, while
// the server uses the same rules before persisting a user's history.
(function exposeEssayAttemptSync(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EssayAttemptSync = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  const MAX_HISTORY = 50;
  const MAX_TOMBSTONES = 200;

  function asArray(value) {
    return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
  }

  function canonicalUserId(value) {
    return String(value || '').trim().toLowerCase();
  }

  function attemptTime(attempt) {
    if (!attempt || typeof attempt !== 'object') return 0;
    const stamp = attempt.updatedAt ?? attempt.date ?? attempt.timestamp;
    const numeric = Number(stamp);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(String(stamp || ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function attemptKey(attempt) {
    const id = String(attempt?.id || '').trim();
    if (id) return 'id:' + id;
    // Older attempts may not have an id.  Keep those records stable and avoid
    // duplicating them when a legacy browser and a current browser sync.
    return [
      'legacy',
      String(attempt?.date || attempt?.timestamp || ''),
      String(attempt?.questionId || attempt?.questionTitle || attempt?.questionText || ''),
      String(attempt?.essayText || '')
    ].join('|');
  }

  function mergeDeleted(existing, incoming) {
    const values = [
      ...(Array.isArray(existing) ? existing : []),
      ...(Array.isArray(incoming) ? incoming : [])
    ];
    const ids = values
      .map(value => typeof value === 'string' ? value.trim() : String(value?.id || '').trim())
      .filter(Boolean);
    return [...new Set(ids)].slice(-MAX_TOMBSTONES);
  }

  function mergeHistory(existing, incoming, deletedIds) {
    const deleted = new Set((Array.isArray(deletedIds) ? deletedIds : []).map(id => String(id).trim()).filter(Boolean));
    const byKey = new Map();
    for (const raw of [...asArray(existing), ...asArray(incoming)]) {
      const id = String(raw.id || '').trim();
      if (id && deleted.has(id)) continue;
      const key = attemptKey(raw);
      const candidate = { ...raw };
      const previous = byKey.get(key);
      // Incoming records are allowed to replace an older copy of the same id;
      // when timestamps tie, the later record in the input wins.
      if (!previous || attemptTime(candidate) >= attemptTime(previous)) byKey.set(key, candidate);
    }
    const sorted=[...byKey.values()].sort((a,b)=>attemptTime(b)-attemptTime(a));
    if(sorted.length<=MAX_HISTORY)return sorted;
    const chosen=new Map();
    // Keep each retained revision's original alongside its latest/final draft.
    // Whole older groups age out together; intermediate drafts use spare space.
    const groups=new Map();
    for(const a of sorted){const key=a.attemptGroupId || attemptKey(a);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(a);}
    for(const group of groups.values()) {
      const latest=[...group].sort((a,b)=>(Number(b.revisionNumber)||0)-(Number(a.revisionNumber)||0) || attemptTime(b)-attemptTime(a))[0];
      const original=group.find(a=>a.id===(latest.originalAttemptId || latest.attemptGroupId)) || group.find(a=>!a.parentAttemptId);
      const required=[...new Set([latest,original,...group.filter(a=>a.isFinalDraft)].filter(Boolean))];
      if(chosen.size+required.length>MAX_HISTORY)continue;
      for(const a of required)chosen.set(attemptKey(a),a);
    }
    for(const a of sorted){if(chosen.size>=MAX_HISTORY)break;if(!a.attemptGroupId || chosen.has('id:'+a.originalAttemptId))chosen.set(attemptKey(a),a);}
    return [...chosen.values()].sort((a,b)=>attemptTime(b)-attemptTime(a));
  }

  function historyFingerprint(history) {
    return asArray(history).map(item => [attemptKey(item), attemptTime(item)].join('@')).sort().join('||');
  }

  function sameHistory(a, b) {
    return historyFingerprint(a) === historyFingerprint(b);
  }

  return {
    MAX_HISTORY,
    MAX_TOMBSTONES,
    asArray,
    canonicalUserId,
    attemptTime,
    attemptKey,
    mergeDeleted,
    mergeHistory,
    historyFingerprint,
    sameHistory
  };
});
