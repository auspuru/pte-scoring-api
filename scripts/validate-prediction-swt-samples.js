'use strict';
const predictions = require('../content/writing-predictions-sep-2026');
const policy = require('../writing-lab-scoring');

function tokens(text) {
  return String(text || '').toLowerCase().replace(/[’‘]/g, "'").match(/[a-z0-9]+(?:'[a-z0-9]+)*/g) || [];
}

function longestCopiedRun(source, sample) {
  const a = tokens(source), b = tokens(sample);
  let previous = new Uint16Array(b.length + 1), best = 0;
  for (const token of a) {
    const current = new Uint16Array(b.length + 1);
    for (let j = 1; j <= b.length; j++) {
      if (token === b[j - 1]) {
        current[j] = previous[j - 1] + 1;
        if (current[j] > best) best = current[j];
      }
    }
    previous = current;
  }
  return best;
}

function validatePredictionSwtSamples(bank = predictions.swt) {
  if (!Array.isArray(bank) || bank.length !== 32) throw new Error('Expected 14 user SWT predictions and 18 September prediction items.');
  const user = bank.filter(q => q.predictionSource?.provider === 'User supplied SWT prediction screenshots');
  const september = bank.filter(q => q.predictionSource?.provider === 'PTE Nepal');
  if (user.length !== 14 || september.length !== 18) throw new Error('SWT prediction cohorts have unexpected sizes.');
  const seen = new Set();

  for (const q of bank) {
    if (!q?.id || seen.has(q.id)) throw new Error('Missing or duplicate SWT prediction ID: ' + q?.id);
    seen.add(q.id);
    if (q.type !== 'swt' || !q.sample) throw new Error(q.id + ' is missing an SWT sample.');

    const form = policy.formFor('swt', q.sample);
    if (form.score !== 1 || policy.sentenceCount(q.sample) !== 1) {
      throw new Error(q.id + ' sample must be one complete SWT sentence of 5–75 words.');
    }

    // The newly supplied screenshots are preserved verbatim and their drafted
    // reference answers await teacher review; local keyword matching cannot
    // be used as an automatic semantic/full-credit claim for this cohort.
    if (q.predictionSource.provider === 'PTE Nepal') {
      const local = policy.localGrade(q, q.sample, { reason: 'published sample validation' });
      if (local.scores.content !== 3 || local.scores.form !== 1 || local.scores.grammar !== 2
        || local.scores.vocabulary !== 2 || local.score_provisional !== true || local.full_content_eligible !== false) {
        throw new Error(q.id + ' sample failed the provisional coverage/form checks: ' + JSON.stringify(local.scores));
      }
    }

    // Source overlap is diagnostic only: retained wording can be accurate and
    // well connected. Form and semantic review determine sample suitability.

    if (!q.sampleReview?.teacherEditable || q.sampleReview.automatedValidation !== 'required') {
      throw new Error(q.id + ' sample review metadata is incomplete.');
    }
  }

  return { count: bank.length, userScreenshots: user.length, provisionalCoverage: september.length, maxCopiedRun: Math.max(...bank.map(q => longestCopiedRun(q.text, q.sample))) };
}

if (require.main === module) {
  const result = validatePredictionSwtSamples();
  console.log('Validated ' + result.count + ' SWT samples (' + result.userScreenshots + ' user screenshots); provisional coverage checks for the 18 September samples only (semantic review still required); longest copied run: ' + result.maxCopiedRun + ' words.');
}

module.exports = { validatePredictionSwtSamples, longestCopiedRun };
