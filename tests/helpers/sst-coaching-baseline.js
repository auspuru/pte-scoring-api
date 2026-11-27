'use strict';

const assert = require('node:assert/strict');
const { digest } = require('../../full-mock/paper');
const pins = require('../../content/full-mock/sst-coaching-compatible-pins.json');

function sstCoachingBaseline(current) {
  const snapshot = structuredClone(current);
  for (const [file, previous] of Object.entries(pins.previousFiles)) {
    if (previous) snapshot.scoringSources.files[file] = structuredClone(previous);
    else delete snapshot.scoringSources.files[file];
  }
  assert.equal(digest(snapshot.scoringSources), pins.previousDigest);
  return snapshot;
}

module.exports = { sstCoachingBaseline };
