'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyScoringPolicy } = require('../swt-scoring-policy');

// Exact report responses; expectations implement the user's policy, not inferred
// Pearson item scores. These assess policy enforcement with labelled judgments.
const examples = [
  ['Report 1, Farm cottage', 'The author made a lifestyle choice to exchange a city terrace for a farm cottage; however, he was familiar with minor disadvantages of country living, and he believed there were many advantages.', 'The author made a lifestyle choice', 'he was familiar with minor disadvantages of country living', 'he believed there were many advantages'],
  ['Report 2, Tourism A', 'Travel and tourism generates a large percentage of GDP and a huge number of jobs, and it acts as a catalyst for conservation and improvement of the environment; moreover, tourism has a comparative advantage in that its start-up and running costs can be low.', 'Travel and tourism generates a large percentage of GDP', 'it acts as a catalyst for conservation and improvement of the environment', 'its start-up and running costs can be low'],
  ['Report 3, Web', "Sir Tim Berners-Lee is a revolutionary scientist who has significantly impacted the way people live, and the global expansion of the Web has transformed communication methods; moreover, he created this system because he was dissatisfied with the difficulty of accessing information in one place.", 'Sir Tim Berners-Lee is a revolutionary scientist', 'the global expansion of the Web has transformed communication methods', 'he was dissatisfied with the difficulty of accessing information in one place'],
  ['Report 3, Forecasting', 'Economic forecasting is a key function for corporate economists but is far from a precise science; consequently, the record of predicting volatile statistics is rather poor due to widely varying assumptions.', 'Economic forecasting is a key function', 'widely varying assumptions', 'the record of predicting volatile statistics is rather poor']
];
function assessment(summary, main, support, relationship, missing = []) {
  return { content_score: 3, grammar_score: 1, vocabulary_score: 1,
    cohesion: missing.length ? 'weak' : 'strong', grammar_annotations: [], vocabulary_annotations: [],
    summary_assessment: { main_idea_accurate: true, main_idea_evidence: main,
      supporting_evidence: [support], conclusion_status: 'captured',
      relationships_clear: !missing.length, material_meaning_change: false,
      missing_dependencies: missing, relationship_explanation: relationship } };
}
for (const [name, summary, main, support, relationship] of examples) {
  test(name + ': concise support without checklist or synonym requirements earns full traits', () => {
    const result = applyScoringPolicy(assessment(summary, main, support, relationship), summary);
    assert.equal(result.content_score, 4);
    assert.equal(result.grammar_score, 2);
    assert.equal(result.vocabulary_score, 2);
    assert.equal(result.needs_semantic_review, false);
  });
}
const nobel = "This year's Nobel peace prize rightfully acknowledges the scientists of the United Nations climate change panel; however, Al Gore has focused on telling us what to fear, and global warming will actually save lives.";
test('Report 2 Nobel: a polished conclusion without its cause loses Content, not Grammar', () => {
  const missing = [{ effect: 'global warming will actually save lives', missing_context: 'Reduced cold deaths outweigh increased heat deaths in the passage.', explanation: 'The award and fear contrast does not explain the lives-saved claim.' }];
  const j = assessment(nobel, "This year's Nobel peace prize", 'Al Gore has focused on telling us what to fear', missing[0].explanation, missing);
  const result = applyScoringPolicy(j, nobel);
  assert.equal(result.content_score, 3);
  assert.equal(result.grammar_score, 2);
  assert.equal(result.full_content_eligible, false);
});
test('Earlier Nobel benchmark: its explicit cold-death reason permits full content', () => {
  const p = require('../passages.json').find(p => p.title === 'Nobel Prize and Climate Science');
  const summary = p.officialCalibration.response;
  const j = assessment(summary, 'The scientists that were engaged in establishing what the world should expect from climate change', 'rising temperatures will reduce the number of cold spells, which are a much bigger killer than heat', 'The cold-versus-heat comparison explains the passage’s lives-saved conclusion.');
  j.grammar_annotations = [{ phrase: 'recieved', fix: 'received', meaning_impact: 'none' }];
  assert.equal(applyScoringPolicy(j, summary).content_score, 4);
  assert.equal(applyScoringPolicy(j, summary).grammar_score, 2);
});
test('Fluent or familiar wording cannot override a material false causal relationship', () => {
  const p = require('../passages.json').find(p => p.title === 'London Financial Hub');
  const summary = p.officialCalibration.response;
  const j = assessment(summary, 'London is one of the most expensive cities', 'the city dominates foreign exchange trading', 'A materially false causal link between separate markets needs correction.');
  j.summary_assessment.material_meaning_change = true;
  assert(applyScoringPolicy(j, summary).content_score < 4);
  assert.equal(applyScoringPolicy(j, summary).grammar_score, 2);
});

test('London category-level compression is strong partial content, not a severe two-point penalty', () => {
  const summary = 'Although London faced historical setbacks and continues to struggle with high living costs and overloaded infrastructure, deregulation and regulatory advantages have allowed its financial center to surpass global rivals in fund management, foreign exchange trading, and secondary bonds.';
  const j = assessment(summary, 'London faced historical setbacks', 'deregulation and regulatory advantages have allowed its financial center to surpass global rivals', 'The summary states the regulatory cause and financial effect clearly; it omits the passage’s final attraction to foreign investors.');
  j.content_score = 2;
  j.summary_assessment.conclusion_status = 'missing';
  const result = applyScoringPolicy(j, summary);
  assert.equal(result.content_score, 3);
  assert.equal(result.grammar_score, 2);
  assert.equal(result.vocabulary_score, 2);
});
