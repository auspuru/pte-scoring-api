'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../content/writing-lab.json');

const samples = [];
(function walk(value) {
  if (Array.isArray(value)) return value.forEach(walk);
  if (!value || typeof value !== 'object') return;
  if (Number.isInteger(value.predictionNumber)
      && value.predictionNumber >= 9
      && value.predictionNumber <= 33
      && typeof value.sample === 'string') samples.push(value);
  Object.values(value).forEach(walk);
})(data);

test('prediction essay samples 09-33 use four paragraphs and remain 200-300 words', () => {
  assert.equal(samples.length, 25);
  for (const item of samples) {
    const paragraphs = item.sample.trim().split(/\n\s*\n/);
    const words = item.sample.trim().split(/\s+/).filter(Boolean).length;
    assert.equal(paragraphs.length, 4, item.title);
    assert(words >= 200 && words <= 300, item.title + ': ' + words + ' words');
    assert(paragraphs.every(paragraph => paragraph.trim().length > 0), item.title);
  }
});
