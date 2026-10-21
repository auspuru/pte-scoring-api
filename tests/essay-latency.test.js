'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {setImmediate: nextTurn} = require('node:timers/promises');
const {assessEssay, buildResolverPrompt} = require('../essay-assessment-service');
const {createEssayCallBudget} = require('../essay-call-budget');
const {createEssayGrader} = require('../essay-grading');
const policy = require('../public/essay-scoring');
const feedback = require('../public/essay-feedback');
const {question, essay} = require('./essay-fixtures');

function candidate(content = 6) {
  const examples = ['mass media supports learning', 'Schools can respond by teaching students'];
  return {
    scores:{...policy.MAXIMA, content},
    feedback:Object.fromEntries(Object.keys(policy.MAXIMA).map(key => [key, 'Relevant, controlled and developed.'])),
    taskRelevance:{status:'relevant', evidence:examples[0], reason:'The response discusses media effects.'},
    promptCoverage:feedback.requirements(question).map(r => ({requirementId:r.id, requirement:r.label,
      status:'addressed', evidence:examples[0], nextStep:''})),
    scoringEvidence:{linguisticExamples:examples, developmentEvidence:examples, vocabularyExamples:['critical reading']},
    errors:[], optionalRefinements:[], feedbackIssues:[], revisionDecisions:[],
    strengths:['Explains both effects.'], improvements:[], templateDetector:'ok', templateEvidence:[], templateNote:'',
    overallVerdict:'Both effects are explained.',
    rationale:{content:'Both effects are explained.', linguistic:'Varied controlled expression.', coherence:'Clear progression.'}
  };
}
const review = content => {
  const result = candidate(content);
  result.scores = {content, linguistic:6, coherence:6};
  return result;
};
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return {promise, resolve};
}

test('both independent readers start together and a final score waits for both', async () => {
  const primaryGate=deferred(), reviewGate=deferred(), started=[];
  let published=false;
  const result=assessEssay(question, essay, async (prompt, options) => {
    started.push(options.stage);
    assert(options.signal instanceof AbortSignal);
    assert(options.timeoutMs>0 && options.timeoutMs<=85000);
    if(options.stage==='assessment') {await primaryGate.promise; return candidate();}
    assert.doesNotMatch(prompt,/PRIMARY REVIEW:/);
    await reviewGate.promise; return review(6);
  }, {feedbackV3:true}).then(r => {published=true; return r;});
  await nextTurn();
  assert.deepEqual(started,['assessment','subjective-review']);
  primaryGate.resolve(); await nextTurn();
  assert.equal(published,false);
  reviewGate.resolve();
  assert.equal((await result).assessment.scores.total,26);
  assert.equal(started.length,2);
});

test('a material disagreement still waits for a validated resolver after both readers', async () => {
  const stages=[];
  const {assessment}=await assessEssay(question,essay,async (_prompt,options) => {
    stages.push(options.stage);
    return options.stage==='assessment' ? candidate(6) : review(5);
  },{feedbackV3:true});
  assert.deepEqual(stages,['assessment','subjective-review','subjective-resolver']);
  assert.equal(assessment.scores.content,5);
  assert.equal(assessment.subjectiveReview.source,'resolver');
});

test('independent review does not regenerate a final verdict, while its rationale remains required', async () => {
  const stages=[];
  const {assessment}=await assessEssay(question,essay,async (_prompt,options) => {
    stages.push(options.stage);
    if(options.stage==='assessment')return candidate();
    const independent=review(6);delete independent.overallVerdict;delete independent.strengths;
    return independent;
  },{feedbackV3:true});
  assert.deepEqual(stages,['assessment','subjective-review']);
  assert.equal(assessment.overallVerdict,candidate().overallVerdict);
  assert.deepEqual(assessment.strengths,candidate().strengths);
  const {normalizeReview}=require('../essay-assessment-service');
  const missing=review(6);delete missing.rationale;
  assert.throws(()=>normalizeReview(missing,essay,{feedbackV3:true,question,requireVerdict:false}),{code:'feedback_contract'});
  const noFinal=review(6);delete noFinal.overallVerdict;
  assert.throws(()=>normalizeReview(noFinal,essay,{feedbackV3:true,question}),{code:'feedback_contract'});
});

test('a shared deadline aborts both readers even when a provider ignores cancellation', async () => {
  const signals=[], errors=[];
  await assert.rejects(assessEssay(question,essay,async (_prompt,options) => {
    signals.push(options.signal); return new Promise(()=>{});
  },{totalTimeoutMs:25,onAttemptError:e=>errors.push(e)}),{code:'ESSAY_ASSESSMENT_TIMEOUT',retryable:false});
  assert.equal(signals.length,2);
  assert(signals.every(signal=>signal.aborted));
  assert.equal(errors.filter(e=>e.code==='ESSAY_ASSESSMENT_TIMEOUT').length,2);
});

test('the shared call allowance includes repairs and cancels outstanding calls', async () => {
  let calls=0;
  const budget=createEssayCallBudget(async ()=>{calls++; return new Promise(()=>{});},{timeoutMs:1000,maxCalls:2});
  try {
    const first=budget.call('primary'), second=budget.call('review');
    await nextTurn();
    const results=await Promise.allSettled([first,second,budget.call('repair')]);
    assert.equal(calls,2);
    assert(results.every(r=>r.status==='rejected' && r.reason.code==='ESSAY_CALL_BUDGET'));
  } finally {budget.close();}
});

test('a failed required reader cancels its peer and cannot cache a primary-only result', async () => {
  let fail=true;
  const stages=[], signals=[];
  const grader=createEssayGrader(async (_prompt,options) => {
    stages.push(options.stage); signals.push(options.signal);
    if(fail && options.stage==='assessment')throw Object.assign(Error('Provider rejected request.'),{retryable:false});
    if(fail)return new Promise(()=>{});
    return options.stage==='assessment' ? candidate() : review(6);
  });
  const options={feedbackV3:true,includeSample:false};
  await assert.rejects(grader.grade(question,essay,'9',options),/Provider rejected/);
  assert(signals.every(s=>s.aborted));
  fail=false;
  assert.equal((await grader.grade(question,essay,'9',options)).scores.total,26);
  assert.deepEqual(stages,['assessment','subjective-review','assessment','subjective-review']);
});

test('invalid essay form still returns immediately without starting readers', async () => {
  const {assessment}=await assessEssay(question,'Too short.',async ()=>{throw Error('Must not call provider.');});
  assert.equal(assessment.scores.total,0);
  assert.equal(assessment.scoreGate.status,'zero_form');
});

test('assessment metrics include stage timings without student text or prompts', async () => {
  const metrics=[];
  const grader=createEssayGrader(async (_prompt,options)=>options.stage==='assessment'?candidate():review(6),{onAssessment:m=>metrics.push(m)});
  await grader.grade(question,essay,'9',{feedbackV3:true,includeSample:false});
  assert.equal(metrics.length,1);
  assert.equal(metrics[0].providerCalls,2);
  assert.deepEqual(metrics[0].stages.map(s=>s.stage),['assessment','subjective-review']);
  assert(metrics[0].stages.every(s=>s.startMs>=0 && s.durationMs>=0 && s.status==='complete'));
  assert(!JSON.stringify(metrics).includes(question));
  assert(!JSON.stringify(metrics).includes('mass media supports learning'));
});

test('the resolver receives judgement evidence without derived client payloads', () => {
  const primary=candidate(5), independent=review(6);
  independent.promptRequirements=[{label:'derived client requirement sentinel'}];
  independent.optionalRefinements=[{phrase:'irrelevant optional payload sentinel'}];
  independent.promptCoverage[0].evidence_span=[987,999];
  const prompt=buildResolverPrompt(question,essay,primary,independent,{feedbackV3:true});
  assert.doesNotMatch(prompt,/derived client requirement sentinel|irrelevant optional payload sentinel|987/);
  assert(prompt.includes('Both effects are explained.'));
  assert(prompt.includes('Schools can respond by teaching students'));
});
