'use strict';
const {createHash} = require('node:crypto');
const feedback = require('./public/essay-feedback');
// Explicit kill switch, stable account cohorts, no trust in browser flags.
function enabledFor(userId, env = process.env) {
  if (!/^(1|true|on)$/i.test(env.ESSAY_FEEDBACK_V3 || '')) return false;
  const uid = String(userId || '').trim().toLowerCase();
  if (!uid) return false;
  const allow = String(env.ESSAY_FEEDBACK_V3_USERS || '').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
  if (allow.includes(uid)) return true;
  const percent = Math.max(0,Math.min(100,Number(env.ESSAY_FEEDBACK_V3_PERCENT) || 0));
  const bucket = createHash('sha256').update(feedback.VERSION + ':' + uid).digest().readUInt32BE(0) % 100;
  return bucket < percent;
}
module.exports = {enabledFor};
