'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { repairMissingSwtSamples } = require('../swt-sample-backfill');

const reference = {
  id: 1,
  title: 'Shared resources',
  text: 'Clear responsibilities and fair access help communities sustain shared resources.',
  sampleResponse: 'Clear responsibilities and fair access help communities sustain shared resources over time.',
  sampleNotes: 'Reference note.'
};

test('restores a missing SWT sample when title and passage text match the bundled reference', () => {
  const stored = [{ ...reference, sampleResponse: '', sampleNotes: '' }];
  const result = repairMissingSwtSamples(stored, [reference]);
  assert.equal(result.updates.length, 1);
  assert.equal(result.passages[0].sampleResponse, reference.sampleResponse);
  assert.equal(result.passages[0].sampleNotes, reference.sampleNotes);
});

test('preserves a non-empty teacher-authored SWT sample', () => {
  const stored = [{ ...reference, sampleResponse: 'Teacher custom sample.', sampleNotes: 'Teacher note.' }];
  const result = repairMissingSwtSamples(stored, [reference]);
  assert.equal(result.updates.length, 0);
  assert.equal(result.passages[0].sampleResponse, 'Teacher custom sample.');
  assert.equal(result.passages[0].sampleNotes, 'Teacher note.');
});

test('does not restore a sample when the passage text has been edited', () => {
  const stored = [{ ...reference, text: reference.text + ' New teacher material.', sampleResponse: '' }];
  const result = repairMissingSwtSamples(stored, [reference]);
  assert.equal(result.updates.length, 0);
  assert.equal(result.passages[0].sampleResponse, '');
});

test('can match seeded advanced passages even when their database id differs', () => {
  const stored = [{ ...reference, id: 42, sampleResponse: '' }];
  const result = repairMissingSwtSamples(stored, [reference]);
  assert.equal(result.updates.length, 1);
  assert.equal(result.passages[0].id, 42);
  assert.equal(result.passages[0].sampleResponse, reference.sampleResponse);
});
