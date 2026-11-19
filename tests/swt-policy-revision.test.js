'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../swt-scoring-policy');
const form = require('../swt-form-policy');
const { materialiseEvidence, createJudgmentService } = require('../swt-judgment-service');
const standalone = require('../public/swt-feedback');
const report = require('../public/writing-lab-report');
const { gradeUnifiedSwt } = require('../writing-lab-scoring');
const adapters = require('../full-mock/adapters');
const { aggregate, inputHash } = require('../full-mock/aggregation');
const { loadPaper, digest } = require('../full-mock/paper');
const comparative = require('./fixtures/swt-attempt-comparison.json');
const legacyBank = require('../content/swt-legacy.json');
const bundled = require('../passages.json');
const web = legacyBank.find(q => q.id === 9);
const forecast = legacyBank.find(q => q.id === 10);
const ipcc = bundled.find(q => q.id === 7);
const tourism = legacyBank.find(q => q.id === 8);
const expanded = bundled.find(q => q.id === 8);
const webRewrite = 'Frustrated that he could not find all the information he wanted in one place, Sir Tim Berners-Lee invented the World Wide Web, which transformed how people shop, listen to music and communicate.';
const forecastRewrite = 'Corporate economists use statistical data, but differing assumptions limit forecast precision and the track record is poor for volatile measures such as interest rates.';
const forecastAtLimit = 'Forecasting is a key function for economists in the corporate sector, who draw on a wide range of statistical data; however, it falls far short of being a precise science, and William Sherden notes that its record is especially poor for volatile measures such as interest rates, although it can do better when predicting stable measures such as government spending, and these different results are discussed by William Sherden in his book on economic forecasting.';
const precisionClause = 'however, it falls far short of being a precise science,';
const assumptionsEvidence = 'their assumptions about how an economy works can vary widely';
const tourismRewrite = 'By generating a large share of GDP and many jobs, travel and tourism supports the global economy and can also help protect the environment and local culture, while low start-up and running costs can give it an advantage over other industries.';
const ipccRewrite = 'The passage contrasts Gore’s alarming climate claims with the IPCC’s more modest estimates and argues that fewer cold-related deaths could outweigh additional deaths from heat.';
const exactAssembly = 'Sir Tim Berners-Lee may be a mild-mannered academic, but as the inventor of the World Wide Web he is also a revolutionary; moreover, the way we shop, listen to music and communicate has been transformed, and he invented the Web because he was frustrated that he could not find all the information he wanted in one place.';
const cases = [
  {name:'Web clause assembly', source:web, answer:exactAssembly, quality:'assembly', mark:3, before:4, repair:webRewrite, quote:'he was frustrated'},
  {name:'Web synonym substitutions', source:web, answer:exactAssembly.replace('revolutionary','pioneer').replace('transformed','changed').replace('frustrated','dissatisfied'), quality:'assembly', mark:3, before:4, repair:webRewrite, quote:'he was frustrated'},
  {name:'Web useful clause rewrite', source:web, answer:webRewrite, quality:'effective', mark:4, before:4},
  {name:'Web concise paraphrase', source:web, answer:comparative.attempts[1].responses.web, quality:'effective', mark:4, before:4},
  {name:'Forecasting optional concession omitted', source:forecast, answer:forecastRewrite, quality:'effective', mark:4, before:4},
  {name:'Forecasting concession accurately included', source:forecast, answer:forecastRewrite.replace(/\.$/, ', although some stable figures such as government spending are forecast more accurately.'), quality:'effective', mark:4, before:4},
  {name:'Forecasting accurately synthesised at 75 words', source:forecast, answer:'Economists in the corporate sector draw on a wide range of statistical data, but forecasts remain imprecise because different economists make different assumptions about how the economy works, and that disagreement is so substantial that William Sherden jokes that economists can win prizes for opposing views; Sherden also notes that forecasting performs poorly overall, especially for volatile measures such as interest rates, even though some stable measures such as government spending are easier to predict.', quality:'effective', mark:4, before:4, words:75},
  {name:'Forecasting unsupported grouping', source:forecast, answer:forecastRewrite.replace(/\.$/, ', while forecasts are more accurate for stable measures such as real GNP growth and inflation.'), quality:'effective', mark:2, before:2, change:true, repair:forecastRewrite, quote:'such as government spending'},
  {name:'Forecasting supported connector', source:forecast, answer:'Economic forecasting is a long way from a precise science because forecasters’ assumptions about how an economy works can vary widely, and the record is rather poor especially for volatile statistics such as interest rates.', quality:'effective', mark:4, before:4},
  {name:'IPCC offset comparison', source:ipcc, answer:ipccRewrite, quality:'effective', mark:4, before:4},
  {name:'IPCC essential offset omitted', source:ipcc, answer:ipccRewrite.replace('fewer cold-related deaths could outweigh additional deaths from heat','warming could save lives overall'), quality:'partial', mark:3, before:3, dependency:true, repair:ipccRewrite, quote:'1.8 million fewer will die because of cold'},
  {name:'Tourism correct clauses assembled', source:tourism, answer:'Travel and tourism generates, directly and indirectly, a large percentage of GDP and a huge number of jobs in the world-wide economy; moreover, there are numerous good examples of tourism acting as a catalyst for conservation and maintenance of local diversity and culture; furthermore, its start-up and running costs can be low compared to many other forms of industry development.', quality:'assembly', mark:3, before:4, repair:tourismRewrite, quote:'maintenance of local diversity and culture'},
  {name:'Short Tourism restructured', source:tourism, answer:tourismRewrite, quality:'effective', mark:4, before:4},
  {name:'Expanded Tourism missing durability', source:expanded, answer:tourismRewrite, quality:'partial', mark:3, before:3, conclusion:'missing', repair:'Tourism supports growth, jobs and conservation, while local ownership and careful protection of housing, infrastructure and natural areas help visitor spending produce lasting benefits for communities.', quote:'rather than short-lived revenue'},
  {name:'Grammatical topic only', source:forecast, answer:'Corporate economists often make economic forecasts.', quality:'limited', mark:1, before:1, weak:true, repair:forecastRewrite, quote:'their assumptions about how an economy works can vary widely'},
  {name:'Disconnected fragments', source:forecast, answer:'Interest rates, government spending, real growth, and economic statistics.', quality:'fragments', mark:1, before:1, weak:true, conclusion:'missing', repair:forecastRewrite, quote:assumptionsEvidence},
  {name:'Form gate', source:forecast, answer:'Corporate economists use data. Different assumptions limit precision.', mark:0, before:0}
];

const makeJudgment = (c, legacy = false) => {
  const words = c.answer.trim().split(/\s+/).length;
  const assessment = {
    synthesis_quality: legacy ? ({assembly:'effective',fragments:'limited'}[c.quality] || c.quality) : c.quality,
    synthesis_span: [1,words],
    main_idea_accurate: !c.weak, main_idea_span: c.weak ? [] : [1, Math.min(words, 9)],
    supporting_spans: c.weak ? [] : [[Math.min(words,10),words]],
    conclusion_status: c.conclusion || 'captured',
    relationships_clear: !c.dependency && !c.weak, material_meaning_change: !!c.change,
    missing_dependencies: c.dependency ? [{effect:'warming could save lives overall',missing_context:'Fewer cold deaths outweigh additional heat deaths.',explanation:'The claim needs the comparison behind the overall drop.'}] : [],
    relationship_explanation: c.dependency ? 'The net mortality claim needs both parts of the comparison.'
      : c.quality === 'assembly' ? 'The clauses give the right ideas but are joined without a useful change.'
        : c.change ? 'The passage identifies government spending as a stable measure with better forecasts.'
          : c.weak ? 'The answer gives the topic and leaves out why precision is limited.'
            : 'The response combines the ideas in a way supported by the passage.',
    content_edit_operation: c.repair ? 'replace' : 'none',
    content_edit_span: c.repair ? [1,words] : [],
    content_source_quote: c.quote || '',
    repair: c.repair || ''
  };
  return { content_score: c.mark <= 2 ? c.mark : 4, grammar_score:2, vocabulary_score:2,
    cohesion:c.weak ? 'weak' : 'strong', summary_assessment:assessment,
    grammar_annotations:[], vocabulary_annotations:[], consistency_reviewed:true,
    ...(legacy ? {} : {scoring_protocol: policy.POLICY_VERSION}) };
};

test('Paired SWT answers keep native traits and align item scores across portal paths', async () => {
  const results = [];
  for (const c of cases) {
    assert(c.source.text, c.name);
    const q = {...c.source, type:'swt'};
    const valid = form.formFor(c.answer).score;
    if(c.words) assert.equal(form.wordCount(c.answer),c.words,c.name);
    const candidate = valid && materialiseEvidence(makeJudgment(c),c.answer,q.text);
    const previous = valid && materialiseEvidence(makeJudgment(c,true),c.answer,q.text);
    const old = valid ? policy.legacyPolicy.applyScoringPolicy(previous,c.answer,q.text) : null;
    const checked = valid ? policy.applyScoringPolicy(candidate,c.answer,q.text) : null;
    assert.equal(old?.content_score || 0,c.before,c.name);
    assert.equal(checked?.content_score || 0,c.mark,c.name);
    assert.equal(checked?.needs_semantic_review || false,false,c.name);
    const judge = async () => { assert(valid); return candidate; };
    const writing = await gradeUnifiedSwt(q,c.answer,judge);
    const full = await adapters.createAdapters({swtGrader:judge}).assess(q,{sealed:true,answer:[c.answer],segments:[],reason:'submitted'});
    const item = policy.itemScore90(writing.scores.content,writing.total);
    assert.equal(report.itemEstimate(q,writing),item,c.name);
    assert.equal(standalone.presentation({trait_scores:writing.scores,item_score_90:item}).estimate,item,c.name);
    assert.deepEqual(full.scores,writing.scores,c.name);
    assert.equal(full.total,writing.total,c.name);
    assert.equal(full.nativeVersion,policy.POLICY_VERSION,c.name);
    assert.deepEqual(writing.scores,valid ? {content:c.mark,form:1,grammar:2,vocabulary:2} : {content:0,form:0,grammar:0,vocabulary:0},c.name);
    if(c.repair) assert.match(writing.improvements[0],/^Replace “/);
    if(c.mark===3) assert.equal(item,79,c.name);
    if(c.quality==='fragments') assert.equal(item,38,c.name);
    results.push({case:c.name,before:[c.before,valid,old?.grammar_score||0,old?.vocabulary_score||0],
      standaloneBefore:policy.itemScore90(c.before,valid ? c.before+5 : 0), writingLabBefore:report.score90(valid ? c.before+5 : 0,9),
      native:writing.scores,item,fullMockNative:full.total,repair:checked?.summary_assessment.repair || null});
  }
  if (process.env.SWT_AUDIT_RESULTS === '1') console.log(JSON.stringify(results));
});

test('The independent assessment caps assembly and invalid correction quotes cannot become confirmed feedback', async () => {
  const c = cases[0];
  const make = () => makeJudgment(c);
  const grade = call => createJudgmentService({policyVersion:policy.POLICY_VERSION,requireEditEvidence:true,
    buildPrompt:policy.buildJudgingPrompt,call,
    isComplete:(r,a,p)=>!policy.applyScoringPolicy(r,a,p).needs_semantic_review});
  const result = await grade(async prompt => {
    assert.match(prompt,/passage_guide/);
    assert.match(prompt,/a meaningful change/);
    return make();
  }).judge(c.answer,c.source.text,{});
  assert.equal(policy.applyScoringPolicy(result,c.answer,c.source.text).content_score,3);
  assert.equal(result.consistency_reviewed,true);

  const invalid = await grade(async () => {
    const raw = make();
    raw.summary_assessment.content_source_quote = 'A quotation that does not appear in the passage.';
    return raw;
  }).judge(c.answer,c.source.text,{});
  assert.equal(invalid.review_unavailable,true);
  assert.equal(policy.applyScoringPolicy(invalid,c.answer,c.source.text).summary_assessment.content_edit,null);
});

function forecastEditJudgment(fields) {
  const judgment = makeJudgment({answer:forecastAtLimit,quality:'partial',mark:3});
  Object.assign(judgment.summary_assessment, {
    content_edit_operation:'replace',
    content_edit_span:[21,30],
    content_source_quote:assumptionsEvidence,
    ...fields
  });
  return judgment;
}

function checkForecastEdit(fields) {
  const materialised = materialiseEvidence(forecastEditJudgment(fields),forecastAtLimit,forecast.text);
  return policy.applyScoringPolicy(materialised,forecastAtLimit,forecast.text);
}

test('A response at 75 words gets a targeted, shorter paraphrase with the source phrase to keep', () => {
  const paraphrase = 'however, differing assumptions limit its precision,';
  const checked = checkForecastEdit({repair:paraphrase});
  const edit = checked.summary_assessment.content_edit;
  assert.equal(checked.needs_semantic_review,false);
  assert.equal(edit.target,precisionClause);
  assert.equal(edit.text,paraphrase);
  assert.equal(edit.source_evidence,assumptionsEvidence);
  assert.equal(edit.original_word_count,75);
  assert.equal(edit.revised_word_count,71);
  assert.equal(edit.revised,forecastAtLimit.replace(precisionClause,paraphrase));
  assert.equal(form.formFor(edit.revised).score,1);
});

test('An addition over the word limit is withheld and a cut can make room for the missing connection', () => {
  const overBudget = checkForecastEdit({
    content_edit_operation:'add',
    content_edit_span:[37,37],
    repair:'for forecasting'
  });
  assert.equal(overBudget.needs_semantic_review,true);
  assert.equal(overBudget.summary_assessment.content_edit,null);
  assert.equal(overBudget.summary_assessment.repair,'');
  assert.equal(overBudget.summary_assessment.next_step,'');

  const expandedClause = 'however, it falls far short of being a precise science because assumptions differ,';
  const checked = checkForecastEdit({repair:expandedClause,content_cut_span:[32,35]});
  const edit = checked.summary_assessment.content_edit;
  assert.equal(checked.needs_semantic_review,false);
  assert.equal(edit.cut,'William Sherden notes that');
  assert.equal(edit.original_word_count,75);
  assert.equal(edit.revised_word_count,74);
  assert.equal(edit.revised,forecastAtLimit.replace(precisionClause,expandedClause).replace('William Sherden notes that ',''));
  assert.equal(form.formFor(edit.revised).score,1);
});

const duplicatedComma = {
  content_edit_span:[61,75],
  repair:", as forecasters' assumptions about how economies work can vary widely."
};
const punctuationRepair = {
  content_edit_span:[60,75],
  repair:'spending; different assumptions about the economy, however, make forecasts less precise.'
};

test('A word-count-safe edit cannot duplicate a neighbouring comma or semicolon', () => {
  const doubled = [
    duplicatedComma,
    {repair:'; however, differing assumptions limit its precision,'}
  ];
  for (const fields of doubled) {
    const checked = checkForecastEdit(fields);
    assert.equal(checked.needs_semantic_review,true);
    assert(checked.assessment_issues.includes('content_edit'));
    assert.equal(checked.summary_assessment.content_edit,null);
    assert.equal(checked.summary_assessment.repair,'');
    assert.equal(checked.summary_assessment.next_step,'');
  }
  const checked = checkForecastEdit(punctuationRepair);
  assert.equal(checked.needs_semantic_review,false);
  const edit = checked.summary_assessment.content_edit;
  assert.equal(edit.target,'spending, and these different results are discussed by William Sherden in his book on economic forecasting.');
  assert(edit.revised.endsWith('government '+punctuationRepair.repair));
  assert.equal(form.formFor(edit.revised).score,1);
});

test('Independent review can recover from an edit that duplicates the retained comma', async () => {
  const stages = [];
  const checked = (raw,answer,passage) => policy.applyScoringPolicy(raw,answer,passage);
  const service = createJudgmentService({
    policyVersion:policy.POLICY_VERSION,
    requireEditEvidence:true,
    buildPrompt:policy.buildJudgingPrompt,
    isComplete:(...args)=>!checked(...args).needs_semantic_review,
    validationIssues:(...args)=>checked(...args).assessment_issues,
    call:async (prompt,timeout,{stage})=>{
      stages.push(stage);
      if (stage==='assessment') return forecastEditJudgment(duplicatedComma);
      assert.match(prompt,/Correct these invalid fields: content_edit/);
      assert.match(prompt,/(?:duplicate|double|repeat)[^\n]{0,60}(?:punctuation|comma|semicolon)/i);
      return forecastEditJudgment(punctuationRepair);
    }
  });
  const reviewed = await service.judge(forecastAtLimit,forecast.text,{});
  assert.deepEqual(stages,['assessment','review']);
  assert.equal(reviewed.consistency_reviewed,true);
  assert.equal(checked(reviewed,forecastAtLimit,forecast.text).summary_assessment.content_edit.text,punctuationRepair.repair);
});

test('Disconnected phrases get very low Content and contradictory evidence requires review', () => {
  const c = cases.find(c => c.quality === 'fragments');
  const raw = makeJudgment(c);
  raw.content_score = 4;
  const check = assessment => policy.applyScoringPolicy(materialiseEvidence(assessment,c.answer,c.source.text),c.answer,c.source.text);
  const fragments = check(raw);
  assert.equal(fragments.content_score,1);
  assert.equal(fragments.full_content_eligible,false);
  assert.equal(fragments.needs_semantic_review,false);
  assert.equal(form.formFor(c.answer).score,1);

  const inconsistent = structuredClone(raw);
  Object.assign(inconsistent.summary_assessment,{main_idea_accurate:true,main_idea_span:[1,2],supporting_spans:[[3,4]],relationships_clear:true});
  assert.equal(check(inconsistent).needs_semantic_review,true);
});

test('Full Mock counts native SWT marks in both skill profiles and keeps other task weights', () => {
  const paper = loadPaper();
  const snapshotHash = 'fixture';
  const responses = [null], items = {};
  for (const {id,question} of paper.questions) {
    const response = {sealed:true,answer:[],segments:[],reason:'submitted'};
    responses.push(response);
    const traits = adapters.maxima(question);
    const marks = question.type === 'swt' ? {...traits,content:3} : traits;
    items[id] = {status:'assessed',snapshotHash,inputHash:inputHash(response),result:adapters.result(question,marks)};
  }
  const grades = aggregate(paper,{status:'submitted',paperHash:digest(paper),responses,assessment:{snapshotHash,items}});
  assert.equal(grades.ready,true);
  assert.equal(grades.groups.swt.earned,16);
  assert.equal(grades.groups.swt.possible,18);
  assert.equal(grades.profiles.reading.practiceIndex,88);
  assert.equal(grades.profiles.writing.practiceIndex,88);
  assert.equal(report.itemEstimate({type:'swt'},{total:8,maximum:9}),81);
});
