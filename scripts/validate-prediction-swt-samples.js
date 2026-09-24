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
  if (!Array.isArray(bank) || bank.length !== 18) throw new Error('Expected exactly 18 September SWT prediction items.');
  const seen = new Set();

  for (const q of bank) {
    if (!q?.id || seen.has(q.id)) throw new Error('Missing or duplicate SWT prediction ID: ' + q?.id);
    seen.add(q.id);
    if (q.type !== 'swt' || !q.sample) throw new Error(q.id + ' is missing an SWT sample.');

    const form = policy.formFor('swt', q.sample);
    if (form.score !== 1 || policy.sentenceCount(q.sample) !== 1) {
      throw new Error(q.id + ' sample must be one complete SWT sentence of 5–75 words.');
    }
    if (form.count < 25 || form.count > 65) {
      throw new Error(q.id + ' sample should remain concise (25–65 words); found ' + form.count + '.');
    }

    const local = policy.localGrade(q, q.sample, { reason: 'published sample validation' });
    if (local.scores.content !== 4 || local.scores.form !== 1 || local.total !== 9) {
      throw new Error(q.id + ' sample failed the existing local SWT benchmark: ' + JSON.stringify(local.scores));
    }

    const copied = longestCopiedRun(q.text, q.sample);
    if (copied >= 12) throw new Error(q.id + ' sample contains a copied run of ' + copied + ' source words.');

    if (!q.sampleReview?.teacherEditable || q.sampleReview.automatedValidation !== 'required') {
      throw new Error(q.id + ' sample review metadata is incomplete.');
    }
  }

  return { count: bank.length, fullLocalBenchmark: bank.length, maxCopiedRun: Math.max(...bank.map(q => longestCopiedRun(q.text, q.sample))) };
}

if (require.main === module) {
  const result = validatePredictionSwtSamples();
  console.log('Validated ' + result.count + ' September SWT samples; all meet the local 9/9 benchmark; longest copied run: ' + result.maxCopiedRun + ' words.');
}

module.exports = { validatePredictionSwtSamples, longestCopiedRun };
