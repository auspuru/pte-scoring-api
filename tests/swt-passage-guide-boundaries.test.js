'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildJudgingPrompt } = require('../swt-scoring-policy');
const seedPassages = require('../passages.json');
const legacyPassages = require('../content/swt-legacy.json');
const userPredictions = require('../content/user-swt-predictions').passages;
const writingPredictions = require('../content/writing-predictions-sep-2026').swt;

function guideFor(passage) {
  const prompt = buildJudgingPrompt('The learner wrote a single sentence.', passage.text, []);
  const dataMarker = '\nDATA:\n';
  const data = JSON.parse(prompt.slice(prompt.lastIndexOf(dataMarker) + dataMarker.length));
  assert.equal(data.passage, passage.text);
  return data.passage_guide;
}

test('the exact AI healthcare guide treats savings as a separate, optional claim', () => {
  const passage = seedPassages.find(({ id }) => id === 2);
  const guide = guideFor(passage);
  assert.match(guide.essential, /improve diagnosis and complement human judgement/);
  assert.match(guide.essential, /errors, privacy or who benefits/);
  assert.match(guide.essential, /If mentioning savings, present them as a separate potential benefit/);
  assert.match(guide.optional, /potential cost savings/i);
});

test('the exact Microloan guide keeps repayment risk and qualifies the value of extra support', () => {
  const passage = userPredictions.find(({ id }) => id === 910505);
  const guide = guideFor(passage);
  assert.match(guide.main, /repayment pressure can strain borrowers and complementary support can help/);
  assert.match(guide.essential, /role complementary support can play/);
});

test('short Tourism allows a cost omission and expanded Tourism requires durable local benefits', () => {
  const short = legacyPassages.find(({ id }) => id === 8);
  const expanded = seedPassages.find(({ id }) => id === 8);
  const shortGuide = guideFor(short);
  const expandedGuide = guideFor(expanded);
  assert.match(shortGuide.essential, /economic and employment benefits with environmental or cultural benefits/);
  assert.match(shortGuide.essential, /costs, describe them as a possible separate advantage/);
  assert.match(shortGuide.optional, /possible cost advantage when the broader benefits are clear/i);
  assert.match(expandedGuide.essential, /local retention, planning and environmental protection make them durable/);
  assert.equal(guideFor({ ...short, text: short.text + '\n' }), null);
});

test('expanded Forecasting keeps uncertainty useful and conditions the stable-measures example on selection', () => {
  const short = legacyPassages.find(({ id }) => id === 10);
  const expanded = seedPassages.find(({ id }) => id === 10);
  const shortGuide = guideFor(short);
  const expandedGuide = guideFor(expanded);
  assert.match(shortGuide.optional, /stable-measures concession/);
  assert.match(expandedGuide.optional, /stable-measures concession when poor performance remains scoped to volatile measures/);
  assert.match(expandedGuide.essential, /ranges or scenarios make uncertainty explicit and help people make decisions/);
  assert.match(expandedGuide.essential, /If discussing better results, some stable measures such as government spending/);
  assert.match(expandedGuide.essential, /real GNP growth and inflation separately as about the same/);
});

test('Compulsory Reburial uses a qualified limit on study and preserves possible exceptions', () => {
  const passage = writingPredictions.find(({ id }) => id === 'pred26-swt-01');
  const guide = guideFor(passage);
  assert.match(guide.main, /case-by-case decisions/i);
  assert.match(guide.essential, /can respect cultural and ethical interests but also limit what improved methods could discover/);
  assert.match(guide.essential, /If describing the rules for research access, do not rule out exceptions/);
});

test('Academic Research allows unexpected usefulness to be implied and keeps accountability optional', () => {
  const passage = legacyPassages.find(({ id }) => id === 21);
  const guide = guideFor(passage);
  assert.match(passage.text,/I have no problem with accountability/);
  assert.match(passage.text,/I have no idea/);
  assert.match(guide.essential,/An accurate contrast and example can make this link clear without a separate conclusion/);
  assert.match(guide.essential,/eliminate chance discoveries as an unsupported overstatement/);
  assert.match(guide.optional,/writer's acceptance of accountability/);
  assert.equal(guideFor({...passage,text:passage.text + '\n'}),null);
});
