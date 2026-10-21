'use strict';
const { isDeepStrictEqual } = require('node:util');
const revisions = require('./content/swt-audit-revisions.json');

// Match complete audited source versions and each old field independently.
// A teacher's replacement source, sample or explanation remains authoritative.
function applySwtAuditRevision(passage, patches = revisions) {
  const patch = patches.find(p => Number(p.id) === Number(passage.id)
    && p.title === passage.title && [p.sourceText, p.fields.text?.after].includes(passage.text));
  if (!patch) return null;
  const changes = {};
  for (const [field, values] of Object.entries(patch.fields)) {
    if (!isDeepStrictEqual(values.before, values.after)
      && isDeepStrictEqual(passage[field], values.before)) changes[field] = values.after;
  }
  return Object.keys(changes).length ? { ...passage, ...changes } : null;
}
module.exports = { applySwtAuditRevision };
