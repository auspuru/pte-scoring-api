'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyScoringPolicy, buildJudgingPrompt, POLICY_VERSION, SYNTHESIS_GUIDANCE } = require('../swt-scoring-policy');
const { materialiseEvidence, createJudgmentService } = require('../swt-judgment-service');
const { build, presentation } = require('../public/swt-feedback');
const format = require('../swt-judge-format');

const summary = 'Economic forecasting is a key function for corporate economists, but varying assumptions make it imprecise, and predictions of volatile statistics have a poor track record.';
function judgment(quality = 'effective') {
  return { content_score: 4, grammar_score: 2, vocabulary_score: 2, cohesion: 'strong',
    grammar_annotations: [], vocabulary_annotations: [], summary_assessment: {
      main_idea_accurate: true, main_idea_evidence: 'Economic forecasting is a key function for corporate economists',
      supporting_evidence: ['varying assumptions make it imprecise'], conclusion_status: 'captured',
      relationships_clear: true, material_meaning_change: false, missing_dependencies: [],
      relationship_explanation: 'The response preserves the function, uncertainty and poor volatile-statistics performance.',
      synthesis: { quality, evidence: quality === 'effective' ? '' : 'Economic forecasting is a key function for corporate economists',
        explanation: quality === 'effective' ? 'The response combines the key role, source of uncertainty and scoped performance into a concise synthesis.'
          : 'The quoted opening is unnecessarily retained as a separate excerpt rather than efficiently integrated with the uncertainty claim.' },
      next_step: 'Combine the role and uncertainty into one short clause; keep the volatile-statistics qualification.',
      repair: 'Corporate economic forecasts rely on differing assumptions, making them imprecise and particularly unreliable for volatile statistics.'
    } };
}
function resultData(result) {
  return { trait_scores: { content: result.content_score, content_max: 4, form: 1, grammar: result.grammar_score, vocabulary: result.vocabulary_score },
    content_details: { full_content_eligible: result.full_content_eligible, summary_assessment: result.summary_assessment,
      notes: result.content_reason }, grammar_details: { grammar_annotations: [] }, vocabulary_details: { vocabulary_annotations: [] } };
}

test('Complete idea coverage cannot override an evidenced synthesis limitation', () => {
  for (const [quality, content] of [['effective', 4], ['partial', 3], ['limited', 2]]) {
    const result = applyScoringPolicy(judgment(quality), summary);
    assert.equal(result.needs_semantic_review, false);
    assert.equal(result.content_score, content);
    assert.equal(result.full_content_eligible, quality === 'effective');
    assert.equal(result.grammar_score, 2);
    assert.equal(result.vocabulary_score, 2);
    if (quality !== 'effective') assert(result.content_reason.includes(result.summary_assessment.synthesis.explanation));
  }
});

test('Missing or invented synthesis evidence requires review rather than a certified score', () => {
  const variants = [undefined, {}, { quality: 'effective', evidence: '', explanation: '' },
    { quality: 'partial', evidence: '', explanation: 'A claimed weakness.' },
    { quality: 'partial', evidence: 'The student never wrote this.', explanation: 'A claimed weakness.' }];
  for (const synthesis of variants) {
    const raw = judgment(); raw.summary_assessment.synthesis = synthesis;
    const result = applyScoringPolicy(raw, summary);
    assert.equal(result.needs_semantic_review, true);
    assert(result.assessment_issues.includes('synthesis'));
    assert.equal(result.full_content_eligible, false);
  }
});

test('Word-span synthesis citations preserve exact whitespace and reject malformed spans', () => {
  const text = 'Trees  cool\ncities and protect residents.';
  const raw = judgment('partial');
  raw.summary_assessment.synthesis.evidence_span = [1, 3];
  assert.equal(materialiseEvidence(raw, text).summary_assessment.synthesis.evidence, 'Trees  cool\ncities');
  for (const span of [null, [0, 3], [3, 2], [1, 999], ['1', 3], [1]]) {
    for (const quality of ['effective', 'partial']) {
      const j = judgment(quality); j.summary_assessment.synthesis.evidence_span = span;
      assert(applyScoringPolicy(materialiseEvidence(j, summary), summary).assessment_issues.includes('synthesis'));
    }
  }
});

test('Five synonyms cannot automatically upgrade the same weak synthesis assessment', () => {
  const swaps = [['key', 'major'], ['corporate', 'business'], ['varying', 'differing'], ['imprecise', 'inexact'], ['volatile', 'unstable']];
  const change = text => swaps.reduce((s, [a, b]) => s.replaceAll(a, b), text);
  const original = judgment('partial'), revised = JSON.parse(change(JSON.stringify(original)));
  assert.equal(applyScoringPolicy(original, summary).content_score, 3);
  assert.equal(applyScoringPolicy(revised, change(summary)).content_score, 3);
});

test('Simple effective reformulation and retained technical terms can earn full Content', () => {
  const result = applyScoringPolicy(judgment(), summary);
  assert.equal(result.content_score, 4);
  assert.equal(result.vocabulary_score, 2);
  assert.equal(result.full_content_eligible, true);
});

test('Synthesis feedback gives a small actionable revision without alleging missing content', () => {
  const data = resultData(applyScoringPolicy(judgment('partial'), summary));
  const feedback = build(data);
  assert.equal(feedback.full, false);
  assert.equal(feedback.priorities.length, 1);
  assert.equal(feedback.priorities[0].title, 'Combine and briefly rephrase the main ideas');
  assert.match(feedback.priorities[0].detail, /one short clause/);
  assert.equal(feedback.priorities[0].repair, judgment().summary_assessment.repair);
  assert.match(presentation(data).headline, /combine and rephrase/);
  assert.equal(presentation(data).estimate, 79);
});

test('Genuine missing context remains higher priority than synthesis advice', () => {
  const j = judgment('partial');
  j.summary_assessment.missing_dependencies = [{ effect: 'predictions', missing_context: 'The actual necessary mechanism.', explanation: 'Restore that mechanism.' }];
  j.summary_assessment.relationships_clear = false;
  const feedback = build(resultData(applyScoringPolicy(j, summary)));
  assert.equal(feedback.priorities[0].title, 'Connect the idea to its missing context');
});

test('The independent review assesses synthesis without being anchored to the first score', async () => {
  let calls = 0;
  const service = createJudgmentService({ policyVersion: POLICY_VERSION, buildPrompt: buildJudgingPrompt,
    isComplete: (j, text) => !applyScoringPolicy(j, text).needs_semantic_review,
    call: async prompt => {
      if (++calls === 2) {
        assert.match(prompt, /Coverage and faithful relationships do not alone establish effective synthesis/);
        return judgment('partial');
      }
      return judgment();
    } });
  const result = applyScoringPolicy(await service.judge(summary, 'A source passage for the labelled assessment.', {}), summary);
  assert.equal(calls, 2);
  assert.equal(result.content_score, 3);
  assert.equal(result.summary_assessment.material_meaning_change, false);
});

test('Structured output requires synthesis and the rubric never turns section reports into item scores', () => {
  const schema = format.tool.input_schema.properties.summary_assessment;
  assert(schema.required.includes('synthesis_quality'));
  assert(schema.required.includes('synthesis_span'));
  assert.equal(schema.properties.synthesis_span.$ref, '#/$defs/span');
  const prompt = buildJudgingPrompt(summary, 'Source.', {});
  assert.match(prompt, /section totals cannot establish individual SWT trait scores/);
  assert.match(prompt, /Small|SMALL/);
  assert(!prompt.includes('Writing 88'));
  assert(!prompt.includes('Reading 31'));
});

test('Comparison evidence keeps aggregate results separate from unknown individual trait scores', () => {
  const comparison = require('./fixtures/swt-attempt-comparison.json');
  const { formFor } = require('../swt-form-policy');
  assert.deepEqual(comparison.attempts.map(a => a.sectionScores), [
    { writing: 79, reading: 23 }, { writing: 88, reading: 31 }, { writing: 83, reading: 27 }, { writing: 83, reading: 27 }, { writing: 86, reading: 29 }, { writing: 86, reading: 29 }
  ]);
  assert.equal(comparison.attempts[3].status, 'reported');
  assert.equal(comparison.attempts[4].status, 'reported');
  for (const a of comparison.attempts) {
    assert.equal(a.individualTraitScores, null);
    for (const text of Object.values(a.responses)) assert.equal(formFor(text).score, 1);
  }
  assert(comparison.passages[0].text.includes('working to make sure the Web stays one web'));
  assert(!comparison.passages[0].text.includes('That architecture encouraged rapid expansion'));
});

test('A synthesis-limited response is not misleadingly labelled as missing a connection', () => {
  const data = resultData(applyScoringPolicy(judgment('limited'), summary));
  assert.match(presentation(data).headline, /combine and rephrase/);
  assert.equal(build(data).priorities[0].title, 'Combine and briefly rephrase the main ideas');
});

test('Updated immutable feedback asset has its actual content hash', () => {
  const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const hash = createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../public/swt-feedback.js'))).digest('hex').slice(0, 12);
  assert(html.includes('swt-feedback.js?v=sha256-' + hash));
});

test('Writing Lab applies the same synthesis caps and exact-evidence gate', async () => {
  const scoring = require('../writing-lab-scoring');
  const q = { type: 'swt', text: 'Corporate economists perform forecasting as an important part of their work.', keyPoints: [] };
  for (const [quality, content] of [['effective', 4], ['partial', 3], ['limited', 2]]) {
    const raw = { scores: { content: 4, form: 1, grammar: 2, vocabulary: 2 }, formInvalid: false, formReason: '',
      feedback: { content: 'The meaning is preserved.', form: 'Valid.', grammar: 'Correct.', vocabulary: 'Appropriate.' },
      strengths: [], improvements: ['Combine the role and uncertainty into one clause.'], errors: [], synthesis: {...judgment(quality).summary_assessment.synthesis, operation:quality==='effective'?'clause_recast':'selection_only', sourceQuote:q.text, evidence:'Economic forecasting is a key function for corporate economists'} };
    const result = await scoring.grade(q, summary, async () => raw);
    assert.equal(result.scores.content, content);
    assert.equal(result.scores.grammar, 2);
    assert.equal(result.scores.vocabulary, 2);
    assert.equal(result.summary_assessment.synthesis.quality, quality);
    assert.equal(result.version, POLICY_VERSION);
    assert.equal(result.full_content_eligible, quality === 'effective');
    assert.throws(() => scoring.normalize(q, summary, { ...raw, synthesis: undefined }), /synthesis/);
    assert.throws(() => scoring.normalize(q, summary, { ...raw,
      synthesis: { ...raw.synthesis, quality: 'partial', evidence: 'Fabricated wording' } }), /synthesis/);
  }
});


test('Attempt 6 records the unchanged outcome after changing only the prepared essay', () => {
  const c = require('./fixtures/swt-attempt-comparison.json');
  const original = c.attempts.find(a=>a.attempt===5), revised = c.attempts.find(a=>a.attempt===6);
  assert.equal(revised.status,'reported');
  assert.deepEqual(original.responses,revised.responses);
  assert.deepEqual(original.sectionScores,revised.sectionScores);
  assert.notEqual(c.fixedResponses.essay,revised.essayResponse);
  assert.equal(revised.scoreReport.listening,35);
  const e = require('./fixtures/essay-hometown-calibration.json');
  assert.equal(e.latestRevisedEssayMock.status,'reported');
  assert.equal(e.latestRevisedEssayMock.comparisonToOriginal.writingDelta,0);
  assert.equal(revised.individualTraitScores,null);
});

test('Standalone SWT and Writing Lab use the same reformulation and fair-source-wording guidance', () => {
  const lab = require('../writing-lab-scoring');
  for (const prompt of [buildJudgingPrompt(summary,'A source.',{}),lab.buildPrompt({type:'swt',text:'A source.',keyPoints:[]},summary)]) {
    assert(prompt.includes(SYNTHESIS_GUIDANCE));
    assert.match(prompt,/actual useful compression, combination or change of construction/);
    assert.match(prompt,/Small, useful phrase or clause changes can be sufficient/);
    assert.match(prompt,/not automatically limited or wrong/);
    assert(!prompt.includes('Writing 88'));
    assert(!prompt.includes('Reading 31'));
  }
});

test('New full-synthesis proof requires a real source-to-summary change, not a repeated quotation', () => {
  const passage='Corporate economists perform forecasting as an important part of their work.';
  const raw=judgment();
  raw.summary_assessment.synthesis={quality:'effective',operation:'clause_recast',sourceQuote:passage,
    evidence:'Economic forecasting is a key function for corporate economists',explanation:'The corporate role is recast into a shorter clause.'};
  assert.equal(applyScoringPolicy(raw,summary,passage).content_score,4);
  assert.equal(applyScoringPolicy(raw,summary,passage).needs_semantic_review,false);
  for(const change of [
    {sourceQuote:'An invented source quotation.'},
    {sourceQuote:raw.summary_assessment.synthesis.evidence},
    {operation:'selection_only'},
    {operation:'word_substitution_only'},
    {operation:'none'},
    {evidence:''},
    {sourceQuote:undefined}
  ]) {
    const changed=structuredClone(raw);Object.assign(changed.summary_assessment.synthesis,change);
    const result=applyScoringPolicy(changed,summary,passage);
    assert.equal(result.full_content_eligible,false);
    assert.equal(result.needs_semantic_review,true);
  }
  raw.summary_assessment.synthesis.quality='partial';
  raw.summary_assessment.synthesis.operation='selection_only';
  assert.equal(applyScoringPolicy(raw,summary,passage).content_score,3);
});

test('An invalid source proof cannot be confirmed or cached by the independent review', async () => {
  let calls=0;
  const svc=createJudgmentService({policyVersion:POLICY_VERSION,buildPrompt:()=>'',
    isComplete:(j,text,source)=>!applyScoringPolicy(j,text,source).needs_semantic_review,
    validationIssues:(j,text,source)=>applyScoringPolicy(j,text,source).assessment_issues,
    call:async()=>{calls++;const j=judgment();j.summary_assessment.synthesis={...j.summary_assessment.synthesis,
      operation:'clause_recast',sourceQuote:'Invented source.',evidence:'Economic forecasting is a key function for corporate economists'};return j;}});
  const first=await svc.judge(summary,'Actual source text.','');
  assert.equal(first.review_unavailable,true);
  assert.equal(applyScoringPolicy(first,summary,'Actual source text.').full_content_eligible,false);
  await svc.judge(summary,'Actual source text.','');
  assert.equal(calls,6);
});

test('A contradictory synthesis review uses its existing retry for semantic reassessment', async () => {
  const bad=judgment();bad.summary_assessment.synthesis={...bad.summary_assessment.synthesis,
    operation:'selection_only',sourceQuote:'A source clause.',evidence:'Economic forecasting is a key function for corporate economists'};
  let calls=0;
  const svc=createJudgmentService({policyVersion:POLICY_VERSION,buildPrompt:()=>'',
    isComplete:(j,t,s)=>!applyScoringPolicy(j,t,s).needs_semantic_review,
    validationIssues:(j,t,s)=>applyScoringPolicy(j,t,s).assessment_issues,
    call:async(prompt,timeout,options)=>{
      calls++;
      if(calls===3){assert.equal(options.semanticReassessment,true);assert.match(prompt,/selection_only/);return judgment('partial');}
      assert.equal(options.semanticReassessment,false);return calls===1?judgment('partial'):bad;
    }});
  const result=await svc.judge(summary,'A source clause.','');
  assert.equal(calls,3);assert.equal(result.consistency_reviewed,true);
  assert.equal(applyScoringPolicy(result,summary).content_score,3);
});
