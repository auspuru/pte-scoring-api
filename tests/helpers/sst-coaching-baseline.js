'use strict';

const assert = require('node:assert/strict');
const { digest } = require('../../full-mock/paper');
const pins = require('../../content/full-mock/sst-coaching-compatible-pins.json');
const swtReviewPins = require('../../content/full-mock/swt-review-compatible-pins.json');

function restoreSnapshot(current, snapshotPins) {
  const snapshot = structuredClone(current);
  for (const [file, previous] of Object.entries(snapshotPins.previousFiles)) {
    if (previous) snapshot.scoringSources.files[file] = structuredClone(previous);
    else delete snapshot.scoringSources.files[file];
  }
  assert.equal(digest(snapshot.scoringSources), snapshotPins.previousDigest);
  return snapshot;
}

const swtReviewBaseline = current => restoreSnapshot(current, swtReviewPins);
const sstCoachingBaseline = current => restoreSnapshot(swtReviewBaseline(current), pins);
module.exports = { sstCoachingBaseline, swtReviewBaseline };
