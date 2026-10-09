'use strict';

const wordCount = text => String(text || '').trim().split(/\s+/).filter(Boolean).length;

function sentenceCount(text) {
  const normal = String(text || '').trim()
    .replace(/\b(?:Dr|Mrs|Mr|Ms|Prof|Jr|Sr|St|etc|vs|approx|govt|Inc|Corp|Ltd|Vol|No|Fig)\./gi, '~')
    .replace(/\b(?:i\.e\.|e\.g\.|a\.m\.|p\.m\.|(?:[A-Z]\.){2,})/gi, x => x.replace(/\./g, '~'))
    .replace(/(\d)\.(?=\d)/g, '$1~');
  return normal.split(/[.!?]+(?:["'”’)]*)\s*|\n\s*\n/)
    .filter(x => /[\p{L}\p{N}]/u.test(x)).length;
}

// Structural checks shared by the legacy portal and Writing Lab. Whether a
// sentence is grammatically complete remains part of the semantic assessment.
function formFor(text) {
  const response = String(text || '').trim();
  const count = wordCount(response), reasons = [];
  if (count < 5 || count > 75) reasons.push('A written summary must contain 5–75 words.');
  const letters = response.replace(/[^\p{L}]/gu, '');
  if (letters && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) {
    reasons.push('The response is written entirely in capital letters.');
  }
  if (!/[.!?]["'”’)]*$/.test(response)) reasons.push('End the sentence with sentence punctuation.');
  if (sentenceCount(response) !== 1) reasons.push('Write exactly one complete sentence.');
  return { count, score: reasons.length ? 0 : 1, reasons };
}

module.exports = { wordCount, sentenceCount, formFor };
