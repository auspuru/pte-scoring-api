'use strict';

const assert = require('node:assert/strict');
const { digest } = require('../../full-mock/paper');
const pins = require('../../content/full-mock/sst-coaching-compatible-pins.json');
const swtReviewPins = require('../../content/full-mock/swt-review-compatible-pins.json');
const sstTranscriptReviewPins = require('../../content/full-mock/sst-transcript-review-compatible-pins.json');
const sstVocabularyPins = require('../../content/full-mock/sst-vocabulary-compatible-pins.json');

function restoreSnapshot(current, snapshotPins) {
  const snapshot = structuredClone(current);
  for (const [file, previous] of Object.entries(snapshotPins.previousFiles)) {
    if (previous) snapshot.scoringSources.files[file] = structuredClone(previous);
    else delete snapshot.scoringSources.files[file];
  }
  assert.equal(digest(snapshot.scoringSources), snapshotPins.previousDigest);
  return snapshot;
}

const sstVocabularyBaseline = current => restoreSnapshot(current, sstVocabularyPins);
const sstTranscriptReviewBaseline = current => restoreSnapshot(sstVocabularyBaseline(current), sstTranscriptReviewPins);
const swtReviewBaseline = current => restoreSnapshot(sstTranscriptReviewBaseline(current), swtReviewPins);
const sstCoachingBaseline = current => restoreSnapshot(swtReviewBaseline(current), pins);
module.exports = { sstCoachingBaseline, swtReviewBaseline, sstTranscriptReviewBaseline, sstVocabularyBaseline };
