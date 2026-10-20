'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const policy=require('../public/essay-scoring'),F=require('../public/essay-feedback'),service=require('../essay-assessment-service');
const fixture=require('./fixtures/essay-hometown-calibration.json');
const format=require('../essay-judge-format');
const quote='he remained consistent and worked really hard';
function candidate(){
 return {scores:{content:4,linguistic:6,coherence:6},
  promptCoverage:F.requirements(fixture.question).map(r=>({requirementId:r.id,requirement:r.label,status:'partial',evidence:quote,nextStep:'Explain how the early circumstances relate to the later achievement.'})),
  scoringEvidence:{linguisticExamples:[quote,'Even though he comes from a modest background'],developmentEvidence:[quote,'As the people of the country had already seen his work as Chief Minister']},
  feedback:{content:'A relevant position is present, but the link could be developed more clearly.',linguistic:'Varied controlled expression.',coherence:'The chronological argument is clear and connected.'},
  feedbackIssues:[{code:'development_gap',category:'reasoning',priority:'minor',requirementId:'req_1',trait:'content',affectsScore:true,
   evidence:{essayQuote:quote,promptQuote:''},explanation:'The link from early circumstances to achievement could be clearer.',suggestedChange:'Add one sentence connecting the circumstances and achievement.',scoreRationale:'One Content link is underdeveloped.'}],revisionDecisions:[]};
}
test('Hometown prompt keeps the actual choice instruction and permits non-influence',()=>{
 const r=F.requirements(fixture.question);assert.equal(r.length,1);
 assert.equal(r[0].label,"Choose a successful person and discuss how that person's accomplishments were or were not influenced by the place where they lived when they were young.");
 assert.equal(r[0].promptSpan.quote,r[0].label);
 assert.match(policy.HOLISTIC_TRAIT_GUIDANCE,/permits influence OR non-influence/);
 assert.match(policy.HOLISTIC_TRAIT_GUIDANCE,/distinct from birthplace/);
});
test('Primary, independent review and resolver share proportional trait guidance',()=>{
 const a=candidate(),b={...a,scores:{content:5,linguistic:6,coherence:6}};
 for(const prompt of [policy.buildAssessmentPrompt(fixture.question,fixture.essay),service.buildReviewPrompt(fixture.question,fixture.essay,{feedbackV3:true}),service.buildResolverPrompt(fixture.question,fixture.essay,a,b,{feedbackV3:true})]){
  assert(prompt.includes(policy.HOLISTIC_TRAIT_GUIDANCE));
  assert(!prompt.includes('Writing 86'));assert(!prompt.includes('20/26'));
 }
});
test('A genuine Content development gap can coexist with full range and organisation',()=>{
 const a=candidate(),r=F.normalize(a,fixture.essay,fixture.question,a.scores,{subjectiveOnly:true});
 assert.deepEqual(r.feedbackIssues.map(i=>i.trait),['content']);
 assert.deepEqual(a.scores,{content:4,linguistic:6,coherence:6});
});
test('A reasoning deduction cannot be relabelled as restricted language',()=>{
 const a=candidate();a.scores.linguistic=4;a.feedbackIssues[0].trait='linguistic';
 assert.throws(()=>F.normalize(a,fixture.essay,fixture.question,a.scores,{subjectiveOnly:true}),e=>e.feedbackSemanticConflict===true&&/Language Range/.test(e.validationHint));
});
test('Repeating the same deduction under another trait requires reassessment',()=>{
 const a=candidate();a.scores.coherence=4;a.feedbackIssues.push({...a.feedbackIssues[0],trait:'coherence'});
 assert.throws(()=>F.normalize(a,fixture.essay,fixture.question,a.scores,{subjectiveOnly:true}),e=>e.feedbackSemanticConflict===true&&/repeated deduction/.test(e.validationHint));
});
test('Distinct evidenced Content and organisation concerns remain scoreable',()=>{
 const a=candidate();a.scores.coherence=4;a.feedbackIssues.push({...a.feedbackIssues[0],trait:'coherence',category:'organisation',code:'organisation_gap',explanation:'This transition changes the subject without explaining the connection.',scoreRationale:'The missing transition makes the reasoning difficult to follow.'});
 assert.equal(F.normalize(a,fixture.essay,fixture.question,a.scores,{subjectiveOnly:true}).feedbackIssues.length,2);
});
test('Fresh assessments cannot invent revision comparisons in any judging or repair stage',()=>{
 for(const stage of ['assessment','subjective-review','subjective-resolver','feedback-repair']){
  const field=format.toolFor(stage,{feedbackV3:true,previousIssueIds:[]}).input_schema.properties.revisionDecisions;
  assert.match(field.description,/Return \[\] exactly/);
  assert.match(field.description,/Current assessment issues are not previous issues/);
  const previous=format.toolFor(stage,{feedbackV3:true,previousIssueIds:['prior_full_id']}).input_schema.properties.revisionDecisions;
  assert.match(previous.description,/one decision per id/);
  assert.deepEqual(previous.items.properties.priorIssueId.enum,['prior_full_id']);
 }
});
test('Essay assets use content hashes and the UI names the full language trait',()=>{
 const base=path.join(__dirname,'../public'),html=fs.readFileSync(path.join(base,'index.html'),'utf8');
 for(const name of ['essay-scoring.js','essay-feedback.js']){
  const hash=createHash('sha256').update(fs.readFileSync(path.join(base,name))).digest('hex').slice(0,12);
  assert(html.includes(name+'?v=sha256-'+hash));
 }
 const ui=fs.readFileSync(path.join(base,'index.js'),'utf8');
 assert.match(ui,/key: 'linguistic',\s+label: 'Language range'/);
});
