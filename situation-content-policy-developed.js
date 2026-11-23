'use strict';

const legacy = require('./situation-content-policy');
const VERSION = 'developed-situation-content-2026-11-23.1';
const LEGACY_VERSION = legacy.VERSION;
const levels = ['none', 'limited', 'limited', 'limited', 'partial', 'effective', 'developed'];
const fields = ['goalEvidence', 'contextEvidence', 'developmentEvidence', 'ownWordingEvidence', 'deductionEvidence'];

function prompt() {
  return `IPT RESPOND TO A SITUATION CONTENT POLICY (${VERSION}), /6:
Judge what this speaker communicates to the intended listener in the original situation. Accept simple English, valid alternative solutions and clear indirect requests. Judge tone against the relationship. Minor slips that leave meaning and tone intact can receive full credit. Names, numbers, dates and ordinary task vocabulary can be repeated.
6 / developed: fully achieves the goal, uses important context and develops the message with an appropriate reason, consequence, arrangement or next step as the situation calls for. The wording is precise and suitable for the recipient. The speaker independently formulates at least part of the substantive message, for example by turning the situation into a request to this listener or proposing a workable arrangement. Identify the actual phrase that shows this.
5 / effective: clearly achieves the goal and gives the listener enough context to act. A small omission, less developed explanation or slight lack of precision keeps it below 6. An otherwise strong, actionable response that simply repeats the supplied wording can earn up to 5. Retelling the prompt without delivering a usable message may earn much less.
4 / partial: a useful response partly achieves the goal, but the listener needs important clarification. A minimal choice that fully settles a simple task may also earn 4. Bare few-word choices, acknowledgments and requests cannot earn 5 or 6. Lower marks apply when they leave the goal or context unsupported.
3 / limited: shows some understanding and makes a basic attempt at the goal. 2 / limited: mainly mentions relevant details without making the intended message usable. 1 / limited: an isolated relevant fragment or bare response with virtually no situational support, even when it technically makes the request. 0 / none: no usable relevant communication.
Assess the substantive message. Disregard padding, repetition, greetings, apologies and closings as automatic credit. Do not impose a word count or a compulsory template. A concise, developed response can earn 6. Repeating the supplied substantive message with generic courtesies adds no independent formulation.
IPT calibration, lecturer/illness/Friday assignment: "Can I have an extension?" earns 1; "I’ve been sick this week. Could I get an extension on the assignment due Friday?" earns 5; "I’ve been ill and can’t finish Friday’s assignment in time. Could I submit it on Monday?" earns 6. A new deadline is one workable development for this prompt, never a universal requirement. For a choice of Tuesday or Thursday, "Thursday, please" is a minimal 4; "Tuesday’s out for me. Could you book me in for Thursday?" can earn 6.
Return JSON with total (0–6), overview (one student-friendly sentence), strengths (up to two), improvements (one specific useful action below 6; none or one explicitly optional refinement at 6), and communicationAssessment. Include level, form ("minimal" for a bare message, otherwise "substantive"), goalEvidence, contextEvidence, developmentEvidence, ownWordingEvidence, deductionEvidence, and reason. Each evidence field is an exact contiguous quote from STUDENT of at most 500 characters, or "" when absent. Quote the student's actual goal and use of situation; for 6 also quote useful development and the independently phrased substantive message. For any deduction quote what was actually said, identify the gap in reason, and explain its effect on this listener. An omission itself cannot be quoted. Use empty deductionEvidence for 6. Do not return coverage or a reference idea checklist.`;
}

const retry = 'Apply this version’s bands again. Check the recipient, purpose, context, and the effect of any gap. A minimal answer has a ceiling of 4. A 6 needs supported development and independently worded substantive communication; borrowed task terms are fine. Check the lecturer anchors, exact evidence and one specific improvement below 6.';

function forQuestion(q) {
  if (q?.type !== 'rts') return null;
  if (q.rtsContentPolicyVersion === undefined || q.rtsContentPolicyVersion === VERSION) return module.exports;
  if (q.rtsContentPolicyVersion === LEGACY_VERSION) return legacy;
  throw Error('Unrecognised RTS content policy version.');
}

function forSavedQuestion(q, version) {
  if (q?.type !== 'rts') return q;
  return {...q, rtsContentPolicyVersion: version ?? q.rtsContentPolicyVersion ?? LEGACY_VERSION};
}

function comparableWords(value) {
  return (value.toLowerCase().replace(/[’‘]/gu, "'").match(/[\p{L}\p{N}]+(?:'[\p{L}]+)*/gu) || []).join(' ');
}

// A literal extract from the situation cannot validate a claim of independent
// wording. Semantic relevance and suitable paraphrases are judged in context.
function independentQuote(quote, situation) {
  if (!quote || typeof situation !== 'string' || !situation.trim()) return false;
  const words = comparableWords(quote)
    .replace(/(?:(?:^|\s)(?:please|(?:thank you|thanks)(?: so much| very much| again)?(?: for (?:your|the) help)?|have a (?:nice|good|great) day))+$/u, '')
    .replace(/^(?:(?:hi|hello|hey|please|thank you(?: very much)?|thanks)\b\s*)+/u, '')
    .trim();
  return words && !(' ' + comparableWords(situation) + ' ').includes(' ' + words + ' ');
}

function normalize(text, raw, locateEvidence, q) {
  const a = raw.communicationAssessment;
  if (!a || !levels.includes(a.level) || !['minimal', 'substantive'].includes(a.form) ||
      typeof a.reason !== 'string' || !a.reason.trim() || a.reason.length > 1000) {
    throw Error('Incomplete functional-communication assessment. Please retry.');
  }
  const evidence = {};
  for (const field of fields) {
    const quote = a[field];
    if (typeof quote !== 'string' || quote.length > 500 || (quote && !quote.trim())) {
      throw Error('Incomplete functional-communication evidence. Please retry.');
    }
    evidence[field] = locateEvidence(text, quote);
    if (evidence[field] === null) throw Error('Unsupported assessment evidence. Please retry.');
  }
  const {total} = raw;
  if (a.level !== levels[total] ||
      (total >= 5 && (a.form !== 'substantive' || !evidence.goalEvidence || !evidence.contextEvidence)) ||
      (total === 6 && (!evidence.developmentEvidence || !independentQuote(evidence.ownWordingEvidence, q.text) ||
        evidence.deductionEvidence || raw.improvements.length > 1)) ||
      (total < 6 && (!evidence.deductionEvidence || raw.improvements.length !== 1))) {
    throw Error('Content score contradicts the functional-communication assessment. Please retry.');
  }
  return {level:a.level, form:a.form, ...evidence, reason:a.reason.trim()};
}

module.exports = {VERSION, LEGACY_VERSION, forQuestion, forSavedQuestion, fields, levels, prompt, normalize, retry};
