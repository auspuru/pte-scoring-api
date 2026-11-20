'use strict';

const { createHash } = require('node:crypto');
const examples = require('./content/swt-plain-samples.json');

// A current teaching example can accompany an earlier result only when the
// exact passage matches. The example is separate from the saved reference.
function plainSwtSample(text) {
  if (typeof text !== 'string' || !text) return null;
  return examples[createHash('sha256').update(text).digest('hex')] ?? null;
}

module.exports = { plainSwtSample };
