'use strict';

const policy = require('./situation-content-policy-developed');

function comparableQuote(value) {
  return value.replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"').replace(/\s+/gu, ' ').trim();
}

function repairNote(raw, transcript) {
  const assessment = raw?.communicationAssessment;
  const issues = [];
  if (!assessment) issues.push('Return the complete communicationAssessment with all required fields.');
  else {
    const { total } = raw;
    if (policy.levels[total] !== assessment.level) {
      issues.push('Match level to the justified total: 6 developed, 5 effective, 4 partial, 1–3 limited, 0 none.');
    }
    if (total >= 5) {
      if (assessment.form !== 'substantive') issues.push('Scores 5–6 require substantive communication. A minimal message has a ceiling of 4.');
      for (const field of ['goalEvidence', 'contextEvidence']) {
        if (!assessment[field]) issues.push('Supply a student quote for ' + field + ' or reassess the proposed score.');
      }
    }
    if (total === 6) {
      issues.push('Verify developmentEvidence and ownWordingEvidence against the student words. Each needs a valid span and ownWordingEvidence must show independently formulated substance.');
      if (assessment.deductionEvidence) issues.push('Leave deductionEvidence empty at 6, or reassess the score if there is a meaningful deduction.');
      if (raw.improvements?.length > 1) issues.push('At 6 return at most one explicitly optional improvement.');
    }
    if (total < 6) {
      if (!assessment.deductionEvidence) issues.push('Fill deductionEvidence with what the student actually said. Describe any omission in reason.');
      if (raw.improvements?.length !== 1) issues.push('Return exactly one specific improvement below 6.');
    }
    const studentWords = comparableQuote(transcript);
    for (const field of policy.fields) {
      const quote = assessment[field];
      if (typeof quote !== 'string' || quote.length > 500 ||
          (quote && (!comparableQuote(quote) || !studentWords.includes(comparableQuote(quote))))) {
        issues.push('Correct ' + field + '. Use a short exact student quote or leave it empty where allowed.');
      }
    }
  }
  return '\nRTS VALIDATION REPAIR: ' + issues.join(' ') +
    ' Use short contiguous spans from the numbered student words for all evidence. Never cite the situation or sample. Keep the score and coaching consistent with the evidence.';
}

function withRtsPracticeRepair(callModel) {
  let previousReview;
  let requested = false;
  return async (prompt, context) => {
    if (requested) {
      prompt = prompt.replace('\nDATA=', repairNote(previousReview, context.transcript) + '\nDATA=');
    }
    requested = true;
    previousReview = await callModel(prompt, context);
    return previousReview;
  };
}

module.exports = { withRtsPracticeRepair };
