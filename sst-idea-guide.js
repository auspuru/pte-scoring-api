'use strict';

const { createHash } = require('node:crypto');
const guide = require('./content/sst-idea-guide.json');

// Exact transcript matching lets renamed mock questions reuse the reviewed ideas
// while keeping unclear or subsequently edited source material unclassified.
function sstIdeas(question) {
  if (question?.type !== 'sst' || typeof question.text !== 'string' || !question.text.trim()) return null;
  const identity = createHash('sha256').update(question.text).digest('hex');
  const reviewed = guide[identity];
  if (!reviewed) return null;
  return reviewed.ideas.map(({ main, supporting }) => ({ main, supporting: [...supporting] }));
}

module.exports = { sstIdeas };
