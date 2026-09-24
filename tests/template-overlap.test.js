'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const EssayScoring = require('../public/essay-scoring');

const root = path.join(__dirname, '..');

test('template overlap is advisory and detects memorised scaffold wording', () => {
  const template = 'The topic of education has become increasingly important in recent years. To begin with, one major benefit is improved access. On the other hand, one notable drawback is cost.';
  const copied = template;
  const topicSpecific = 'Education policy can improve access for rural learners by funding local teachers, flexible transport and digital resources, while governments must also manage costs and ensure that technology supports learning rather than replacing effective teaching.';

  const high = EssayScoring.templateOverlap(copied, [template]);
  const low = EssayScoring.templateOverlap(topicSpecific, [template]);

  assert.equal(high.percent, 100);
  assert.equal(high.level, 'high');
  assert.equal(high.thresholds.medium, 20);
  assert.equal(high.thresholds.high, 35);
  assert.equal(low.level, 'low');
  assert.equal(low.percent, 0);

  // This helper returns overlap information only; it has no score fields.
  assert.equal('scores' in high, false);
  assert.equal('total' in high, false);
});

test('essay practice exposes a live template-overlap warning without blocking scoring', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'public', 'index.js'), 'utf8');

  assert.doesNotMatch(html, /Exam Template Mode/);
  assert.doesNotMatch(js, /Exam Template Mode/);
  assert.match(html, /Structure Practice/);
  assert.match(js, /practiceTemplateOverlap/);
  assert.match(js, /High overlap:/);
  assert.match(js, /replace memorised wording with prompt-specific arguments/);
  assert.match(js, /templateOverlap\.level === 'high'/);

  // A high warning still continues into the existing assessment request.
  const warning = js.indexOf("templateOverlap.level === 'high'");
  const request = js.indexOf("fetch(API_URL + '/api/essay/grade'", warning);
  assert(warning >= 0 && request > warning);
});

test('Structure Practice is described as a scaffold rather than an exam-ready answer', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  assert.match(html, /Structure Practice is a learning scaffold/);
  assert.match(html, /not an exam-ready memorised answer/);
  assert.match(html, /make the wording specific to this question/);
});
