'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const patches = require('../content/swt-audit-revisions.json');
const { applySwtAuditRevision } = require('../swt-audit-revisions');
const { applyScoringPolicy, buildJudgingPrompt } = require('../swt-scoring-policy');
const seeds = require('../passages.json');
const { fallbackSample } = require('../swt-reference');

test('audited corrections are idempotent and preserve teacher edits field by field', () => {
  for (const patch of patches) {
    const before = {id:patch.id,title:patch.title,text:patch.sourceText,sampleResponse:'Teacher sample',
      ...Object.fromEntries(Object.entries(patch.fields).map(([k,v])=>[k,structuredClone(v.before)]))};
    const after = applySwtAuditRevision(before);
    assert(after);
    for (const [field,v] of Object.entries(patch.fields)) assert.deepEqual(after[field],v.after);
    assert.equal(after.sampleResponse,'Teacher sample');
    assert.equal(applySwtAuditRevision(after),null);
    assert.equal(applySwtAuditRevision({...before,text:before.text+' Teacher source edit.'}),null);
    if (patch.fields.keyElementsRationale) {
      const edited = {...before,keyElementsRationale:{topic:'Teacher explanation'}};
      const updated = applySwtAuditRevision(edited);
      assert.deepEqual((updated||edited).keyElementsRationale,edited.keyElementsRationale);
    }
  }
});

test('published source fixes remove the false comparison and complete the missing phrase', () => {
  const climate=seeds.find(p=>p.id===1),woman=seeds.find(p=>p.id===12);
  assert(!climate.text.includes('5% of global military spending'));
  assert(!climate.sampleResponse.includes('military spending'));
  assert(woman.text.includes("wasn't fully realised at the time"));
});

test('legacy sample recovery requires the complete known source and preserves authored samples', () => {
  const legacy=require('../content/swt-legacy.json')[0];
  assert.equal(fallbackSample({...legacy,sampleResponse:''}).sampleResponse,legacy.sampleResponse);
  assert.equal(fallbackSample({...legacy,text:legacy.text+' Teacher edit.',sampleResponse:''}),null);
  assert.equal(fallbackSample({...legacy,sampleResponse:'Teacher answer.'}),null);
});

const summary='Producing energy locally reduces reliance on fossil fuels, although careful planning is required.';
function judgment() { return {content_score:2,grammar_score:1.5,vocabulary_score:2,cohesion:'adequate',
  grammar_annotations:[],vocabulary_annotations:[],summary_assessment:{
    main_idea_accurate:true,main_idea_evidence:'Producing energy locally reduces reliance on fossil fuels',
    supporting_evidence:['careful planning is required'],conclusion_status:'captured',relationships_clear:false,
    material_meaning_change:true,missing_dependencies:[],relationship_explanation:'Review a disputed connection.',
    synthesis:{quality:'partial',evidence:summary,explanation:'Review a disputed connection.'}}}; }

test('free-text connector labels cannot deduct Grammar again for a Content relationship', () => {
  for (const type of ['faulty causal connector','Incorrect connector creating false causality','Cohesion issue','discourse marker']) {
    const raw=judgment();raw.grammar_annotations=[{type,phrase:'although careful planning is required.',
      fix:'and careful planning is required.',meaning_impact:'changed',meaning_effect:'Alleged connection problem.'}];
    const scored=applyScoringPolicy(raw,summary);
    assert.equal(scored.grammar_score,2,type);
    assert.equal(scored.grammar_annotations[0].affects_score,false,type);
    assert.equal(scored.content_score,2,'Content is independently assessed, not promoted to full credit.');
  }
});

test('an invented dependency citation requires reassessment instead of a confirmed deduction', () => {
  const raw=judgment();raw.summary_assessment.missing_dependencies=[{effect:'inflation performs better',missing_context:'Different forecasts',explanation:'This grouping would be wrong.'}];
  const scored=applyScoringPolicy(raw,summary);
  assert.equal(scored.needs_semantic_review,true);
  assert(scored.assessment_issues.includes('missing_dependencies'));
  raw.summary_assessment.missing_dependencies[0].effect='careful planning is required';
  assert.equal(applyScoringPolicy(raw,summary).needs_semantic_review,false);
});

test('grading instructions assess actual selected examples without importing a memorised forecast error', () => {
  const prompt=buildJudgingPrompt(summary,'A supplied source.',{});
  assert(prompt.includes('Check only examples actually selected'));
  assert(!prompt.includes('real GNP growth AND inflation'));
});
