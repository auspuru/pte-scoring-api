'use strict';

const VERSION = 'functional-situation-content-2026-10-24.1';
const applies = question => question.type === 'rts';

function prompt(question) {
  if (!applies(question)) return '';
  return `FUNCTIONAL COMMUNICATION POLICY (${VERSION}):
Assess Respond to a Situation content /6 using the institute's flexible practice calibration. The central question is whether the listener can understand the student's relevant message and what they want to communicate in this situation. A basic, understandable response that achieves the purpose deserves a GOOD score (5–6), even with simple language, minor slips or different ideas from a teaching sample. This is not a claim about Pearson's proprietary scores or a conversion to an overall /90.
There is no single preferred solution or fixed idea list. Assess the ORIGINAL SITUATION and the STUDENT response; do not invent a reference answer. Accept alternative requests, explanations, arrangements, reasons or practical solutions that work in the situation. For example, requesting a refund can work instead of requesting a replacement, and proposing another meeting time can work instead of offering remote participation. Do not demand agreement with a preferred idea, extra supporting points, persuasive development, elaborate vocabulary, a particular template, a separate greeting, an apology, a closing, an exact word count or the full recording time.
Judge functional meaning rather than formality for its own sake. A short direct request or a clear conventional indirect request can communicate successfully; stating the relevant problem can itself be an effective indirect request when the intended listener would naturally understand the help needed. The student need not repeat every contextual detail the intended listener already knows. Minor grammar errors, informal but suitable wording and small incidental inaccuracies do not reduce an otherwise effective response below 6 when the intended message remains clear. Tone matters only when it materially obstructs the communication goal. Optional politeness or richer development can be suggested as OPTIONAL refinements, not requirements for high marks.
Relevant words alone, generic filler such as "please help me" with no situational message, an unrelated answer or merely retelling the scenario without communicating a usable purpose do not qualify for good marks. Do not infer pronunciation or oral fluency from text. Distinguish a harmless omitted detail from a material problem that prevents the recipient understanding or acting on the main message. Do not treat a valid alternative solution as a factual error.
Score the holistic communicative outcome:
6 / effective: a relevant, understandable basic response successfully communicates the intended purpose. Simple and concise is enough; no further development or sample ideas are required.
5 / mostly_effective: the relevant purpose and basic message are understood and useful, but a small ACTUAL communication gap remains. State that gap; missing optional niceties, examples or sample points alone do not justify lowering 6 to 5.
4 / partial: the situation is recognisable, but an important part of the communicative purpose remains unclear or unresolved.
1–3 / limited: only fragments, a bare topic, generic requests or a scenario summary are supplied; the listener must make substantial guesses about the student's actual message. Use the amount of usable communication to distinguish these levels.
0 / none: no meaningful relevant communication.
Return JSON only: {"total":integer 0..6,"overview":"one short student-friendly sentence about communication success","strengths":["specific success"],"improvements":["one useful action, or clearly optional refinement for 6/6"],"communicationAssessment":{"level":"effective|mostly_effective|partial|limited|none","materialProblem":boolean,"evidence":"one short exact contiguous quote from STUDENT","reason":"briefly explain success or the actual communication barrier"}}.
Use at most 2 strengths and 2 improvements. Do not return coverage, missing reference ideas or an idea checklist. Set materialProblem=true only for a problem that blocks the basic intended communication, not minor errors or alternative ideas. Scores of 5–6 require materialProblem=false. The numeric score must agree with the communicative level. Evidence must be exact student wording, not a correction or an invented quote. Keep the overview, feedback and judgment consistent and avoid repeating the same advice.`;
}

function normalize(text, raw, locateEvidence) {
  const assessment = raw.communicationAssessment;
  if (!assessment || !['effective', 'mostly_effective', 'partial', 'limited', 'none'].includes(assessment.level)
      || typeof assessment.materialProblem !== 'boolean'
      || typeof assessment.evidence !== 'string' || !assessment.evidence.trim() || assessment.evidence.length > 500
      || typeof assessment.reason !== 'string' || !assessment.reason.trim() || assessment.reason.length > 1000) {
    throw Error('Incomplete functional-communication assessment. Please retry.');
  }
  const evidence = locateEvidence(text, assessment.evidence);
  if (!evidence) throw Error('Unsupported assessment evidence. Please retry.');
  const [minimum, maximum] = {effective:[6,6], mostly_effective:[5,5], partial:[4,4], limited:[1,3], none:[0,0]}[assessment.level];
  if (raw.total < minimum || raw.total > maximum || (raw.total >= 5 && assessment.materialProblem)) {
    throw Error('Content score contradicts the functional-communication assessment. Please retry.');
  }
  return {level:assessment.level, materialProblem:assessment.materialProblem, evidence, reason:assessment.reason.trim()};
}

module.exports = {VERSION, applies, prompt, normalize};
