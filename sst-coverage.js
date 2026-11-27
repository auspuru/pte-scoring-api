'use strict';

const { sstIdeas } = require('./sst-idea-guide');

function coveragePrompt(ideas) {
  if (!ideas) return '';
  return '\nOptional SST coaching, separate from marks. The following are reviewed main ideas and optional supporting details. Assess the meaning communicated for every main idea in this order, regardless of Form. Accept accurate paraphrases and alternative wording. Missing optional details alone never make an idea partial. Use covered for accurate meaning, partial for meaningful but incomplete coverage, and missed when absent, unintelligible, contradicted, or mentioned only through disconnected keywords. If the response is entirely unintelligible, mark every idea missed. Return "sstCoverage":[{"status":"covered|partial|missed","evidence":"exact response substring for covered or partial, empty for missed"}]. This list is coaching and does not replace the holistic score rubric. Reviewed ideas: '
    + JSON.stringify(ideas);
}

function reviewCoverage(ideas, text, raw) {
  if (!ideas || !Array.isArray(raw) || raw.length !== ideas.length) return null;
  const assessed = [];
  for (const [index, idea] of ideas.entries()) {
    const { status, evidence } = raw[index] || {};
    if (status === 'missed' && evidence === '') assessed.push({ ...idea, status, evidence });
    else if (['covered', 'partial'].includes(status) && typeof evidence === 'string'
      && evidence.trim() && evidence.length <= 600 && text.includes(evidence)) {
      assessed.push({ ...idea, status, evidence });
    } else return null;
  }
  const gaps = assessed.filter(idea => idea.status !== 'covered');
  const nextStep = gaps.length === assessed.length && gaps.every(idea => idea.status === 'missed')
    ? 'Your response did not communicate the recording’s main ideas clearly. In your next attempt, cover these ideas in your own words. ' + gaps.map(idea => idea.main).join(' ')
    : gaps.length
      ? (gaps[0].status === 'partial' ? 'Make this idea clearer in your own words. ' : 'Add this idea in your own words. ') + gaps[0].main
      : 'You covered the main ideas. Check that each idea flows naturally into the next.';
  return { ideas: assessed, nextStep };
}

module.exports = { sstIdeas, coveragePrompt, reviewCoverage };
