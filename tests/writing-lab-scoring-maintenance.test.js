'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const scoring = require('../writing-lab-scoring');
const essayPolicy = require('../public/essay-scoring');

test('SWT calibrations are injected by task type, not embedded per prompt branch', () => {
  const swt = scoring.buildPrompt(
    { type: 'swt', text: 'Summarise the passage.', keyPoints: [] },
    'This is a concise one-sentence summary.'
  );
  const sst = scoring.buildPrompt(
    { type: 'sst', text: 'Summarise the lecture.', keyPoints: [] },
    'This is a concise lecture summary with enough words for practice.'
  );
  assert.match(swt, /OVERFISHING CALIBRATION/);
  assert.match(swt, /LEADERSHIP CALIBRATION/);
  assert.doesNotMatch(sst, /OVERFISHING CALIBRATION|LEADERSHIP CALIBRATION/);
});

test('legacy local essay fallback remains disabled', () => {
  assert.throws(
    () => scoring.localGrade({ type: 'essay', keyPoints: [] }, 'A local essay response.'),
    /unified essay engine/
  );
});

test('unified essay maximum is derived from the published maxima', () => {
  const expected = Object.values(essayPolicy.MAXIMA).reduce((sum, value) => sum + value, 0);
  assert.equal(essayPolicy.MAXIMUM, expected);
});
