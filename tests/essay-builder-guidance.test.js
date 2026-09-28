'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.js'), 'utf8');

test('audited essay prompts use question types that match their literal requirements', () => {
  assert.match(source, /title: "Parental Legal Responsibility"[\s\S]{0,500}?type: "opinion"/);
  assert.match(source, /title: "Maximum Wage for High-Paying Jobs"[\s\S]{0,500}?type: "opinion"/);
  assert.match(source, /title: "Laws and Human Behaviour"[\s\S]{0,500}?type: "opinion"/);
  assert.match(source, /title: "The Value of Humanities"[\s\S]{0,500}?type: "opinion"/);
  assert.match(source, /title: "Communication Methods in Modern Society"[\s\S]{0,500}?type: "advantages_disadvantages"/);
  assert.match(source, /title: "Youth Unemployment and Shorter Working Week"[\s\S]{0,600}?type: "advantages_disadvantages_scope"/);
});

test('advantages/disadvantages opinion guidance permits a balanced answer when the prompt permits it', () => {
  assert.doesNotMatch(source, /The conclusion must pick a winner/);
  assert.match(source, /A balanced conclusion is valid when the prompt allows it/);
});

test('Age Restrictions guidance requires one developed activity, minimum age and experience', () => {
  assert.match(source, /Choose ONE activity affected by an age restriction/);
  assert.match(source, /One well-developed example is enough/);
});

test('climate-study guidance does not invent a solutions requirement', () => {
  assert.doesNotMatch(source, /Give concrete examples and practical solutions for YOUR area only/);
  assert.match(source, /Do not invent a requirement to propose solutions/);
});
