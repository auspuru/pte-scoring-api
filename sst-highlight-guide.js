'use strict';

const { createHash } = require('node:crypto');
const highlights = require('./content/sst-highlight-guide.json');

// Rows follow the reviewed idea guide for the identical saved transcript.
// Each quote occurs once in that transcript and excludes supporting material
// where the passage makes the distinction explicit.
function sstHighlights(question) {
  if (question?.type !== 'sst' || typeof question.text !== 'string' || !question.text.trim()) return null;
  const identity = createHash('sha256').update(question.text).digest('hex');
  return highlights[identity]?.map(quotes => [...quotes]) ?? null;
}

module.exports = { sstHighlights };
