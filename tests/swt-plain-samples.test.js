'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const samples = require('../content/swt-plain-samples.json');
const guides = require('../content/swt-passage-guides.json');
const { formFor } = require('../swt-form-policy');
const { plainSwtSample } = require('../swt-plain-samples');
const { studentPassage } = require('../swt-reference');
const { predictionMocks, present } = require('../writing-lab');
const { mocks: writingMocks } = require('../content/writing-lab.json');
const { papers } = require('../content/full-mock/papers/catalogue.json');

const books = [require('../passages.json'), require('../content/swt-legacy.json'),
  require('../content/swt-advanced.json'), require('../content/swt-advanced-revisions.json'),
  require('../content/user-swt-predictions').passages];

test('Every audited exact SWT passage has a short one-sentence teaching sample', () => {
  assert.equal(Object.keys(guides).length, 95);
  assert.equal(Object.keys(samples).length, 107);
  for (const hash of Object.keys(guides)) assert.ok(samples[hash], hash);
  for (const sample of Object.values(samples)) {
    const { score, count } = formFor(sample);
    assert.equal(score, 1, sample);
    assert.ok(count >= 25 && count <= 50, sample);
  }
  for (const question of books.flat()) assert.ok(studentPassage(question).teachingSample, question.title);
  for (const mock of [...writingMocks, ...predictionMocks]) {
    for (const question of mock.questions.filter(q => q.type === 'swt')) assert.ok(plainSwtSample(question.text), question.title);
  }
  for (const paper of papers) {
    for (const {question} of require('../' + paper.file).questions.filter(entry => entry.question.type === 'swt')) {
      assert.ok(plainSwtSample(question.text), paper.file + ' · ' + question.title);
    }
  }
});

test('Academic Research offers a plain example alongside the teacher reference for the same source', () => {
  const question = books.flat().find(q => /Academic Research/i.test(q.title));
  const teacherSample = 'A teacher’s own reference sentence.';
  const projected = studentPassage({ ...question, sampleResponse:teacherSample });
  assert.equal(projected.sampleResponse, teacherSample);
  assert.match(projected.teachingSample, /accepts accountability/);
  assert.match(projected.teachingSample, /prove useful even when its value is unclear at first/);
  assert.ok(plainSwtSample(question.text));
  assert.equal(plainSwtSample(question.text + ' Another version.'), null);
});

test('Writing Lab reveals the example after submission alongside the stored sample and marks', () => {
  const question = structuredClone(writingMocks[0].questions.find(q => q.type === 'swt'));
  const result = { total:8, maximum:9, itemScore90:79, scores:{content:3,form:1,grammar:2,vocabulary:2} };
  const state = { kind:'mock', status:'active', index:0, questions:[question], results:[result], answers:['My saved answer.'] };
  assert.equal(present(state).questions[0].teachingSample, undefined);
  state.status = 'submitted';
  const before = structuredClone(state), report = present(state);
  assert.equal(report.questions[0].teachingSample, plainSwtSample(question.text));
  assert.equal(report.questions[0].sample, question.sample);
  assert.deepEqual(report.results[0], result);
  assert.deepEqual(state, before);
});
