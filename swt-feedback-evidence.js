'use strict';

function comparable(phrase) {
  return phrase.trim().replace(/\s+/g, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').toLowerCase();
}

function annotationEvidence(text, annotation) {
  const phrase = annotation?.phrase;
  if (typeof phrase !== 'string' || !phrase.trim()) return null;
  const span = annotation.phrase_span;
  if (span == null) return text.includes(phrase) ? { phrase } : null;
  if (!Array.isArray(span) || span.length !== 2 || !span.every(Number.isInteger)) return null;
  const words = [...text.matchAll(/\S+/g)];
  const [first, last] = span;
  if (first < 1 || last < first || last > words.length) return null;
  const submitted = text.slice(words[first - 1].index, words[last - 1].index + words[last - 1][0].length);
  // Legacy scoring can normalise a citation to the first matching occurrence.
  // Use the numbered occurrence when its wording matches that citation.
  return comparable(submitted) === comparable(phrase) ? { phrase: submitted, phraseSpan: span } : null;
}

module.exports = { annotationEvidence };
