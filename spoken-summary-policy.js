'use strict';

const VERSION = 'connected-spoken-summary-2026-10-24.1';
const applies = question => ['rl', 'sgd'].includes(question.type);

function prompt(question) {
  if (!applies(question)) return '';
  return `CONNECTED-MEANING CONTENT POLICY (${VERSION}):
This is the institute's practice calibration for ${question.type === 'rl' ? 'Retell Lecture' : 'Summarise Group Discussion'}, not a claim about Pearson's proprietary scoring or a guarantee of an overall score of 90. Assess content /6 independently of audio delivery.
Prioritise relevant, connected meaning over exhaustive coverage, keyword counts, elaborate vocabulary or complete paraphrasing. Source phrases and simple language are acceptable when they convey connected propositions. A familiar template is acceptable scaffolding, but generic filler alone earns no content credit. Adding "moreover" to disconnected keywords does not create a meaningful relationship; simple "and" can connect genuinely related ideas.
Rank response quality as follows: template-only filler < isolated relevant keywords < fragmented relevant phrases < connected ideas with substantive inaccuracies < connected, mostly accurate ideas. Connected responses with MINOR inaccuracies and connected responses with no inaccuracies belong in the SAME top category.
Full marks do not require 100% accuracy or every detail. Roughly 80–90% accuracy in the meaningful content can be sufficient for 6/6 when the main message and essential relationships remain accurate, with enough useful supporting substance. This is a holistic accuracy guide, NOT a keyword-match percentage, a coverage quota, an exact numerical threshold or an automatic score. One correct sentence with little support is not enough simply because it is 100% accurate. An omitted optional example is not an inaccuracy.
Minor inaccuracies are local slips or approximate secondary details that leave the main message, essential relationships and important speaker positions intact. They may receive optional feedback but do not reduce a top-quality connected response below 6. Material errors change the central claim, essential cause/effect, negation, conclusion or an important speaker's position; these cannot receive full marks even if many other words are correct. Do not invent causal relationships in an additive or descriptive source.
Retell Lecture: convey the lecture's main message and useful support as a connected explanation; a separate concluding sentence, all examples, all figures and novel synonyms are not required.
Summarise Group Discussion: connect the main positions of the speakers and the important agreement, disagreement or compromise where present. Names, every turn, every detail and a fixed number of points per speaker are not required. Clear attribution such as "the first speaker" is acceptable. A minor attribution slip about an incidental detail can be tolerated; swapping an important position, inventing agreement or omitting an essential opposing view is substantive. Do not demand agreement when the discussion leaves views unresolved.
Content scale:
0 = no meaningful relevant proposition, including template-only filler or an unrelated answer.
1 = isolated relevant keywords or labels without a developed proposition.
2 = relevant fragmented phrases or disconnected propositions without a connected summary.
3 = connected relevant ideas, but major inaccuracies, a reversed central message or substantial gaps undermine understanding.
4 = a connected account that preserves the broad topic but distorts useful support or leaves significant relationships unclear.
5 = connected, mostly accurate main ideas, but an important gap in supporting substance, an essential relationship or a speaker's main position prevents a sufficient summary. Optional omissions and minor inaccuracies alone do NOT justify 5 instead of 6.
6 = a connected, sufficiently developed, mostly accurate summary preserving the main message and essential relationships; minor inaccuracies and optional omissions receive the SAME mark as an otherwise equivalent fully accurate response.
Coverage is diagnostic coaching, not arithmetic deductions. Keep inaccurate details visible and distinguish their impact. For each inaccurate coverage item also return "errorImpact":"minor|material"; this describes the effect on the source meaning, not how many words differ. Do not label a point inaccurate merely because it is incomplete.
Also return "summaryAssessment":{"responseForm":"template_only|keywords|fragments|connected","mainMessageAccurate":boolean,"relationshipsClear":boolean,"sufficientSubstance":boolean,"mostlyAccurate":boolean,"materialMeaningChange":boolean,"speakerAttributionClear":boolean,"evidence":"one exact contiguous student quote demonstrating the response form","reason":"brief explanation of the holistic judgment"}. For RL set speakerAttributionClear=true. For SGD this flag concerns the MAIN positions; minor incidental attribution slips do not make it false. Quote a meaningful connected proposition, not a keyword, to support responseForm=connected. The flags must reflect the actual response, not a desired score.
Award 6 if and only if responseForm=connected, mainMessageAccurate, relationshipsClear, sufficientSubstance, mostlyAccurate and speakerAttributionClear are all true, materialMeaningChange is false, at least one fact is covered, and no coverage error is material. Otherwise apply the lower descriptors above. Explain the specific substantive limitation when awarding 5; do not deduct for minor inaccuracies, optional details, source wording or grammar slips that preserve meaning. For 6, present any suggested refinements as optional, never requirements for full marks.`;
}

function normalize(question, text, raw, coverage, locateEvidence) {
  const assessment = raw.summaryAssessment;
  const flags = ['mainMessageAccurate', 'relationshipsClear', 'sufficientSubstance', 'mostlyAccurate', 'materialMeaningChange', 'speakerAttributionClear'];
  if (!assessment || !['template_only', 'keywords', 'fragments', 'connected'].includes(assessment.responseForm)
      || flags.some(key => typeof assessment[key] !== 'boolean')
      || typeof assessment.evidence !== 'string' || !assessment.evidence.trim() || assessment.evidence.length > 500
      || typeof assessment.reason !== 'string' || !assessment.reason.trim() || assessment.reason.length > 1000) {
    throw Error('Incomplete connected-meaning assessment. Please retry.');
  }
  const evidence = locateEvidence(text, assessment.evidence);
  if (!evidence) throw Error('Unsupported assessment evidence. Please retry.');
  coverage.forEach((item, index) => {
    if (item.status !== 'inaccurate') return;
    const impact = raw.coverage[index].errorImpact;
    if (!['minor', 'material'].includes(impact)) throw Error('Incomplete connected-meaning assessment. Please retry.');
    item.errorImpact = impact;
  });
  const full = assessment.responseForm === 'connected' && assessment.mainMessageAccurate
    && assessment.relationshipsClear && assessment.sufficientSubstance && assessment.mostlyAccurate
    && !assessment.materialMeaningChange && (question.type !== 'sgd' || assessment.speakerAttributionClear)
    && coverage.some(item => item.status === 'covered')
    && !coverage.some(item => item.errorImpact === 'material');
  const cap = { template_only:0, keywords:1, fragments:2, connected:5 }[assessment.responseForm];
  if ((raw.total === 6) !== full || (!full && raw.total > cap)) {
    throw Error('Content score contradicts the connected-meaning assessment. Please retry.');
  }
  return { ...Object.fromEntries(['responseForm', ...flags].map(key => [key, assessment[key]])), evidence, reason:assessment.reason.trim() };
}

module.exports = { VERSION, applies, prompt, normalize };
