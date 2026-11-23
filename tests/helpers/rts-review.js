'use strict';

// A simulated reviewer for integration fixtures with deliberately developed RTS
// transcripts. Behavioral tests provide case-specific quotes for each trait.
function developedReview(text) {
  const quote = text.slice(0, 500).trim();
  return {total:6, overview:'Your request gives the listener a clear way to act.',
    strengths:['You explain the situation and offer a practical response.'], improvements:[],
    communicationAssessment:{level:'developed', form:'substantive', goalEvidence:quote,
      contextEvidence:quote, developmentEvidence:quote, ownWordingEvidence:quote,
      deductionEvidence:'', reason:'Your phrasing connects the situation to the action you want the listener to take.'}};
}
module.exports = {developedReview};
