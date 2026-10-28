'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../public/essay-scoring');
const feedback = require('../public/essay-feedback');
const format = require('../essay-judge-format');
const { assessEssay, needsSupportReview } = require('../essay-assessment-service');
const { createEssayGrader } = require('../essay-grading');

const question = 'Television serves many useful functions. It helps people to relax. Besides, it can also be seen as a companion for the lonely. To what extent do you agree with this? Explain why with your own experience.';
const essay = `It has long been a subject of discussion whether television serves many useful functions and it helps people to relax or not. Moreover, it can also be seen as a companion for the loneliness. I opine that the former notion has several elements that deserve attention, and I will explain why using pertinent arguments. I partially agree with the statement because television can help people to relax but, its companionship has limits.

To commence with, television serves some enjoyable programmes which helps to get a break from the mental stress and anxiety, because family and comedy shows help the viewer to get relief from the daily pressures. Moreover, in family and regular programmes, some familiar voices make a quiet home feel less empty which helps to reduce the loneliness and create a sense of connection. For example, I personally opine that I feel loneliness in my house due to away from the family, so television programmes really helps me to stay connected and positive because I also enjoys following the same presenter each evening, so it create a sense of connection in my life which reduce my stress and loneliness.

Moving on further, television has less companionship because moderate entertainment can reduce daily tension, but a sense of company is not a complete answer to loneliness. People still need some good relationships and connection with family and friends in which they can speak and meet with them, also get support in hardship. For instance, a programmes can fills a few hours, while regular calls, meet and greet provide personal connection which reduce the loneliness.

From what has been discussed above, it can be concluded that television serves useful functions and companionship, but I opine that television can help, but its companionship has limits.`;
const claim = 'a sense of company is not a complete answer to loneliness';
const support = 'they can speak and meet with them, also get support in hardship';
const examples = ['I partially agree with the statement', support];
function auditResult(prompt, accurate = false) {
  return {findings:JSON.parse(prompt.split('DATA:\n')[1]).claims.map(claim=>({id:claim.id,claimAccurate:accurate,
    existingSupport:support,explanation:accurate?'A material gap remains after this support.':'The essay already contrasts real interaction and support with television.'}))};
}
function candidate({ corrected = false, retainGap = false } = {}) {
  const content = corrected ? 5 : 4, coherence = corrected ? 5 : 4;
  const rationale = {
    content: corrected ? `The explanation already includes "${support}"; the broad argument could be more concise.` : 'The limitation is asserted without explaining why television cannot meet the need.',
    linguistic: 'Repeated extended clause chains restrict expression.',
    coherence: corrected ? 'The progression from benefits to limitations is logical, with some repetition.' : 'The limitation paragraph needs more development.'
  };
  return {
    scores:{...policy.MAXIMA, content, coherence, linguistic:4, vocabulary:1},
    feedback:{...Object.fromEntries(Object.keys(policy.MAXIMA).map(key=>[key,'Meaning is clear.'])),...rationale},
    rationale, errors:[], optionalRefinements:[],
    taskRelevance:{status:'relevant', evidence:examples[0], reason:'The essay discusses both television benefits and companionship limits.'},
    promptCoverage:feedback.requirements(question).map(req=>({requirementId:req.id,requirement:req.label,status:'addressed',evidence:examples[0],nextStep:''})),
    scoringEvidence:{linguisticExamples:examples,developmentEvidence:examples,vocabularyExamples:['mental stress and anxiety']},
    feedbackIssues:corrected ? [] : [{code:'development_gap',category:'reasoning',priority:'major',requirementId:'',trait:'content',affectsScore:true,
      evidence:{essayQuote:claim,promptQuote:''},explanation:retainGap ? 'The existing comparison still leaves a material limitation insufficiently explained.' : rationale.content,
      suggestedChange:'Explain what human relationships provide.',scoreRationale:'Support for one argument is materially thin.'}],
    revisionDecisions:[], strengths:['A relevant personal experience and clear position.'],improvements:[],
    overallVerdict:corrected ? 'The existing comparison explains the limit; improve concision.' : rationale.content,
    templateDetector:'ok',templateEvidence:[],templateNote:''
  };
}

test('agreeing development deductions receive a Sonnet whole-essay check before publication', async()=>{
  const stages=[];
  const {assessment}=await assessEssay(question,essay,async(prompt,options)=>{
    stages.push(options.stage);
    if(options.stage==='support-audit')return auditResult(prompt);
    if(options.stage!=='subjective-resolver')return candidate();
    assert.equal(options.supportReview,true);
    assert.equal(format.request(prompt,'claude-haiku-4-5-20251001',options).model,'claude-sonnet-4-6');
    assert.match(prompt,/WHOLE-ESSAY SUPPORT CHECK/);
    assert(prompt.includes(claim) && prompt.includes(support));
    assert.match(prompt,/existing but incomplete reasoning/);
    assert.match(prompt,/Review Organisation separately/);
    assert.match(prompt,/VERIFIED SUPPORT FINDINGS/);
    const primaryReview=JSON.parse(prompt.split('PRIMARY REVIEW:\n')[1].split('\n\nINDEPENDENT REVIEW:')[0]);
    const independentReview=JSON.parse(prompt.split('INDEPENDENT REVIEW:\n')[1].split('\n\nReturn:')[0]);
    for(const previous of [primaryReview,independentReview]){
      assert.equal(previous.scores,undefined);
      assert.equal(previous.rationale,undefined);
      assert.equal(previous.feedbackIssues[0].scoreRationale,undefined);
    }
    return candidate({corrected:true});
  },{feedbackV3:true});
  assert.deepEqual(stages,['assessment','subjective-review','support-audit','subjective-resolver']);
  assert.equal(assessment.subjectiveReview.trigger,'support-check');
  assert.equal(assessment.scores.total,21);
  assert.equal(assessment.scores.grammar,2);
  assert.equal(assessment.scores.vocabulary,1);
  assert.equal(assessment.scores.form,2);
  assert.match(assessment.feedback.content,/already includes/);
  assert(!JSON.stringify({feedback:assessment.feedback,rationale:assessment.rationale,issues:assessment.feedbackIssues,verdict:assessment.overallVerdict}).includes('asserted without explaining'));
  assert.equal(assessment.subjectiveReview.supportAudit[0].claimAccurate,false);
  assert.deepEqual(assessment.feedbackIssues,[]);
});

test('the support check can retain a genuine deduction without automatically increasing marks',async()=>{
  const paragraphs=essay.split('\n\n');
  const disordered=[paragraphs[3],paragraphs[1],paragraphs[2],paragraphs[0]].join('\n\n');
  const {assessment}=await assessEssay(question,disordered,async(prompt,options)=>{
    if(options.stage==='support-audit')return auditResult(prompt,true);
    const result=candidate({retainGap:options.stage==='subjective-resolver'});
    result.feedbackIssues.push({code:'organisation_gap',category:'organisation',priority:'major',requirementId:'',trait:'coherence',affectsScore:true,
      evidence:{essayQuote:'From what has been discussed above',promptQuote:''},explanation:'The conclusion is placed before the supporting arguments and the introduction follows them.',
      suggestedChange:'Restore introduction, arguments and conclusion in a logical sequence.',scoreRationale:'The paragraph sequence materially disrupts the argument.'});
    return result;
  },{feedbackV3:true});
  assert.equal(assessment.scores.total,19);
  assert.equal(assessment.feedbackIssues.length,2);
  assert.equal(assessment.subjectiveReview.trigger,'support-check');
});

test('a failed support check never publishes or caches the agreeing but unverified assessment',async()=>{
  let fail=true, primaryCalls=0;
  const grader=createEssayGrader(async(prompt,options)=>{
    if(options.stage==='support-audit')return auditResult(prompt);
    if(options.stage==='assessment')primaryCalls++;
    if(options.stage==='subjective-resolver')return fail ? {} : candidate({corrected:true});
    return candidate();
  });
  await assert.rejects(grader.grade(question,essay,'8',{feedbackV3:true,includeSample:false}));
  fail=false;
  const result=await grader.grade(question,essay,'8',{feedbackV3:true,includeSample:false});
  assert.equal(primaryCalls,2);
  assert.equal(result.scores.total,21);
});

test('legacy low Content judgements also receive the stronger support check',async()=>{
  const {assessment}=await assessEssay(question,essay,async(prompt,options)=>{
    if(options.stage==='subjective-resolver'){
      assert.equal(options.feedbackV3,false);
      assert.equal(format.request(prompt,'claude-haiku-4-5-20251001',options).model,'claude-sonnet-4-6');
      return candidate({corrected:true});
    }
    return candidate();
  });
  assert.equal(assessment.scores.total,21);
  assert.equal(assessment.subjectiveReview.trigger,'support-check');
});

test('optional advice, full marks and language-only issues do not add a support-review call',()=>{
  const value={feedbackVersion:feedback.VERSION,scores:{content:5,coherence:5,linguistic:4},feedbackIssues:[]};
  assert.equal(needsSupportReview(value,value),false);
  assert.equal(needsSupportReview({...value,scores:{...value.scores,coherence:4}},value),true);
  for(const issue of [
    {trait:'content',category:'reasoning',priority:'optional',affectsScore:false},
    {trait:'linguistic',category:'language',priority:'major',affectsScore:true},
    {trait:'vocabulary',category:'language',priority:'major',affectsScore:true}
  ])assert.equal(needsSupportReview({...value,feedbackIssues:[issue]},value),false);
  const organisation={trait:'coherence',category:'organisation',priority:'minor',affectsScore:true};
  assert.equal(needsSupportReview({...value,feedbackIssues:[organisation]},value),true);
  assert.equal(needsSupportReview({scores:{content:6,coherence:6}},{scores:{content:6,coherence:6}}),false);
});

test('the factual audit rejects invented support, duplicate ids and omitted findings within two calls',async()=>{
  const {auditSupport}=require('../essay-support-audit');
  const input={...candidate(),feedbackVersion:feedback.VERSION};
  for(const defect of ['invented quotation','missing id','duplicate id']){
    let calls=0;
    await assert.rejects(auditSupport(question,essay,input,input,async(prompt,options)=>{
      calls++;assert.equal(options.stage,'support-audit');
      const result=auditResult(prompt);
      if(defect==='invented quotation')result.findings[0].existingSupport='An invented personal interaction.';
      if(defect==='missing id')result.findings=[];
      if(defect==='duplicate id')result.findings.push({...result.findings[0]});
      return result;
    }),{code:'ESSAY_SUPPORT_AUDIT_INVALID',retryable:false});
    assert.equal(calls,2);
  }
});

test('the audit is a separate concise factual check and never assigns essay marks',()=>{
  const {prompt,concerns}=require('../essay-support-audit');
  const input={...candidate(),feedbackVersion:feedback.VERSION};
  const text=prompt(question,essay,concerns(input,input));
  assert.match(text,/NOT essay grading/);
  const request=format.request(text,'normal-model',{stage:'support-audit',supportReview:true});
  assert.equal(request.model,'claude-sonnet-4-6');
  assert.equal(request.max_tokens,2400);
  assert.equal(request.tools[0].strict,true);
  assert(!request.tools[0].input_schema.properties.scores);
});

test('a low Organisation mark without a material Organisation issue is reassessed rather than published',async()=>{
  const {callAndNormalizeResolver}=require('../essay-assessment-service');
  let calls=0;
  const decision=await callAndNormalizeResolver(question,essay,candidate(),candidate(),async(prompt,options)=>{
    calls++;
    if(calls===1)return candidate();
    assert.equal(options.semanticReassessment,true);
    assert.equal(options.stage,'organisation-review');
    assert.match(prompt,/material development or connection problem/);
    return candidate({corrected:true});
  },()=>{},{feedbackV3:true,supportReview:true});
  assert.equal(calls,2);
  assert.equal(decision.scores.coherence,5);
  assert.equal(decision.scores.content,4);
  assert(decision.feedbackIssues.some(issue=>issue.trait==='content'));
  await assert.rejects(callAndNormalizeResolver(question,essay,candidate(),candidate(),async()=>candidate(),()=>{},
    {feedbackV3:true,supportReview:true}),{code:'feedback_contract',feedbackSemanticConflict:true});
});
