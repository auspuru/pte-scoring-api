'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const F=require('../public/essay-feedback'), policy=require('../public/essay-scoring');
const {assessEssay,needsResolver,applySubjectiveDecision}=require('../essay-assessment-service');
const {createEssayGrader}=require('../essay-grading');
const evidence=require('../essay-evidence'), format=require('../essay-judge-format');
const rollout=require('../essay-feedback-rollout'),sync=require('../essay-attempt-sync');
const {question,essay}=require('./essay-fixtures');
function raw(q=question,text=essay) {
 const phrases=['mass media supports learning','Schools can respond by teaching students'];
 return {scores:{...policy.MAXIMA},feedback:Object.fromEntries(Object.keys(policy.MAXIMA).map(k=>[k,'Clear and relevant.'])),
  errors:[],optionalRefinements:[],promptCoverage:F.requirements(q).map(r=>({requirementId:r.id,requirement:r.label,status:'addressed',evidence:phrases[0],nextStep:''})),
  scoringEvidence:{linguisticExamples:phrases,developmentEvidence:phrases,vocabularyExamples:['critical reading']},
  taskRelevance:{status:'relevant',evidence:phrases[0],reason:'The essay explains benefits and risks of media.'},
  strengths:['Explains both useful and harmful media effects.'],improvements:[],feedbackIssues:[],revisionDecisions:[],
  overallVerdict:'Your answer addresses both effects with relevant explanations.',templateDetector:'ok',templateEvidence:[],templateNote:''};
}
function issue(overrides={}) {
 return {code:'unsupported_inference',category:'reasoning',priority:'major',requirementId:'',trait:'content',affectsScore:true,
  evidence:{essayQuote:'Advertisements often connect expensive products with happiness or popularity',promptQuote:''},
  explanation:'The claim needs a condition explaining who is affected.',suggestedChange:'Explain which young viewers may be affected and why.',scoreRationale:'This reasoning gap limits development of one argument.',...overrides};
}
function reviewFrom(a) { return {...a,scores:{content:a.scores.content,linguistic:a.scores.linguistic,coherence:a.scores.coherence},rationale:{content:a.feedback.content,linguistic:a.feedback.linguistic,coherence:a.feedback.coherence}}; }

test('Prompt requirements retain exact spans, OR choice, personal requirement and separate paired parts',()=>{
 const cases=[['Do you agree? Give reasons or your own experience.',2,'OR'],['Do you agree? Explain why with your own experience.',3,'AND'],[question,2,'AND'],['Discuss the advantages and disadvantages of automation.',2,'AND']];
 for(const [q,count,operator] of cases){const reqs=F.requirements(q);assert.equal(reqs.length,count,q);assert(reqs.some(r=>r.operator===operator));for(const r of reqs)assert.equal(q.slice(r.promptSpan.start,r.promptSpan.end),r.label);}
 assert.equal(F.requirements('Give reasons or your own experience.').some(r=>r.kind==='own_experience'),false);
 assert.equal(F.requirements('Are the disadvantages as great as the advantages?').some(r=>r.kind==='comparison'),true);
});

test('Every assessment stage shares the feedback policy and requirements, treating prose as data',async()=>{
 const prompts=[];
 const result=await assessEssay(question,essay,async(p,o)=>{prompts.push([p,o]);return o.stage==='assessment'?raw():reviewFrom(raw());},{feedbackV3:true});
 assert.equal(prompts.length,2);for(const [p,o] of prompts){assert(p.includes(F.GUIDANCE));assert(p.includes(JSON.stringify(F.requirements(question))));assert.equal(o.feedbackV3,true);}
 assert.equal(result.assessment.feedbackVersion,F.VERSION);assert.deepEqual(result.assessment.feedbackIssues,[]);
 assert.deepEqual(result.assessment.improvements,[]);
});

test('Sufficient answers can have no corrections; reduced content still needs a real, evidenced weakness',()=>{
 const a=raw();assert.deepEqual(F.normalize(a,essay,question,a.scores).feedbackIssues,[]);
 a.scores.content=5;assert.throws(()=>F.normalize(a,essay,question,a.scores),{code:'feedback_contract'});
 a.feedbackIssues=[issue()];const result=F.normalize(a,essay,question,a.scores);assert.equal(result.feedbackIssues.length,1);
 assert.equal(essay.slice(result.feedbackIssues[0].evidence.start,result.feedbackIssues[0].evidence.end),a.feedbackIssues[0].evidence.essayQuote);
});

test('Missing coverage needs exact prompt evidence and cannot survive an addressed final requirement',()=>{
 const a=raw();a.scores.content=5;const r=F.requirements(question)[0];
 a.promptCoverage[0]={...a.promptCoverage[0],status:'missing',evidence:'',nextStep:'Explain the useful effect.'};
 a.feedbackIssues=[issue({code:'missing_requirement',category:'coverage',requirementId:r.id,evidence:{essayQuote:'',promptQuote:r.label}})];
 assert.equal(F.normalize(a,essay,question,a.scores).feedbackIssues[0].evidence.start,null);
 a.promptCoverage[0].status='addressed';assert.throws(()=>F.normalize(a,essay,question,a.scores),{code:'feedback_contract'});
});

test('A quotation existing does not establish semantic correctness: policy requires whole-essay judgement',()=>{
 for(const rule of ['explanations already present elsewhere','Supported one-sided agreement','negative personal experience','NET increase in employment','as great as','design features from location','plausible clearly hypothetical'])assert(F.GUIDANCE.includes(rule));
 const a=raw();a.feedbackIssues=[issue({affectsScore:false,priority:'optional'})];assert.equal(F.normalize(a,essay,question,a.scores).feedbackIssues[0].affectsScore,false);
});

test('Optional polish cannot support a deduction or be presented as a main correction',()=>{
 const a=raw();a.feedbackIssues=[issue({priority:'optional'})];assert.throws(()=>F.normalize(a,essay,question,a.scores),{code:'feedback_contract'});
 a.feedbackIssues[0].affectsScore=false;const contract=F.normalize(a,essay,question,a.scores);const final=F.apply({...a,essayText:essay},contract);
 assert.deepEqual(final.improvements,[]);assert.equal(final.optionalRefinements[0].affects_score,false);
 assert(F.render(final).includes('No substantial argument correction'));assert(!F.render(final,{includeOptional:false}).includes('Explain which young'));
 assert.match(F.render(final),/Optional polish/);
});

test('Unrelated, previous-draft and fabricated issue quotations are rejected without partial quote salvage',()=>{
 const a=raw();a.scores.content=5;a.feedbackIssues=[issue({evidence:{essayQuote:'This was in the previous draft.',promptQuote:''}})];
 assert.throws(()=>F.normalize(a,essay,question,a.scores),{code:'feedback_contract'});
 a.feedbackIssues[0].evidence.essayQuote='mass media supports learning with a fabricated ending';
 assert.throws(()=>F.normalize(a,essay,question,a.scores),{code:'feedback_contract'});
});

test('Duplicate issues collapse, while all distinct material issues remain available beyond the top three',()=>{
 const a=raw();a.scores.content=5;a.feedbackIssues=[issue(),issue(),...['development_gap','comparison_missing','category_mismatch'].map(code=>issue({code}))];
 const contract=F.normalize(a,essay,question,a.scores);assert.equal(contract.feedbackIssues.length,4);
 const result=F.apply({...a,essayText:essay},contract);assert(result.improvements.length<=3);assert.match(F.render(result),/More corrections \(1\)/);
});

test('Final resolver removes prior subjective criticism, optional polish and stale verdict/strengths',async()=>{
 const a=raw();a.scores.content=5;a.feedbackIssues=[issue()];a.improvements=['OLD CRITICISM'];a.strengths=['OLD STRENGTH'];
 const b=raw();let stages=[];
 const {assessment}=await assessEssay(question,essay,async(_p,o)=>{stages.push(o.stage);return o.stage==='assessment'?a:reviewFrom(b);},{feedbackV3:true});
 assert.deepEqual(stages,['assessment','subjective-review','subjective-resolver']);assert.equal(assessment.scores.content,6);
 assert.deepEqual(assessment.feedbackIssues,[]);assert.deepEqual(assessment.improvements,[]);assert(!JSON.stringify(assessment).includes('OLD CRITICISM'));
 assert.equal(assessment.overallVerdict,b.overallVerdict);assert.deepEqual(assessment.strengths,b.strengths);
});

test('Feedback disagreement triggers adjudication even with equal numerical scores',()=>{
 const a=raw(),b=raw();a.scores.content=b.scores.content=5;a.feedbackIssues=[issue()];b.feedbackIssues=[issue({code:'development_gap'})];
 const pa={...a,...F.normalize(a,essay,question,a.scores)},pb={...b,...F.normalize(b,essay,question,b.scores)};
 assert.equal(needsResolver(pa,pb),true);
});

test('Legacy final reconciliation no longer merges superseded improvements',()=>{
 const a=raw();a.improvements=['OLD FALSE MISSING REQUIREMENT'];a.scores.content=4;
 const b=reviewFrom(raw());const final=applySubjectiveDecision(a,b,'resolver');
 assert(!final.improvements.includes('OLD FALSE MISSING REQUIREMENT'));assert.equal(final.scores.content,6);
});

test('Minor grammar corrections remain accessible with full grammar marks and distinct from optional polish',async()=>{
 const a=raw();a.errors=[{type:'grammar',impact:'minor',phrase:'young people encounter news',correction:'young people encounter the news',explanation:'The article can make the reference clearer without changing meaning.'}];
 const {assessment}=await assessEssay(question,essay,async(_p,o)=>o.stage==='assessment'?a:reviewFrom(raw()),{feedbackV3:true});
 assert.equal(assessment.scores.grammar,2);assert.equal(assessment.languageCorrections.length,1);assert.equal(assessment.optionalRefinements.length,0);
 assert.equal(assessment.feedbackIssues[0].trait,'grammar');assert.equal(assessment.feedbackIssues[0].affectsScore,false);
});

test('Revision resolution requires current evidence and cannot follow from deletion or a missing requirement',()=>{
 const old=issue({id:'original:issue1'}),a=raw(),previous={issues:[old]};
 a.revisionDecisions=[{priorIssueId:old.id,status:'resolved',currentIssueCode:'',evidence:'mass media supports learning',reason:'The revised explanation supplies the condition.'}];
 assert.equal(F.normalize(a,essay,question,a.scores,{previous}).revisionDecisions[0].status,'resolved');
 a.revisionDecisions[0].evidence='';assert.equal(F.normalize(a,essay,question,a.scores,{previous}).revisionDecisions[0].status,'needs_clarification');
 const r=F.requirements(question)[0];old.requirementId=r.id;a.revisionDecisions[0].evidence='mass media supports learning';a.promptCoverage[0].status='missing';
 assert.equal(F.normalize(a,essay,question,a.scores,{previous}).revisionDecisions[0].status,'needs_clarification');
});

test('A retained primary grammar error cannot be marked resolved by a subjective reviewer',()=>{
 const old={...issue(),id:'old',code:'grammar_correction',trait:'grammar'};
 const result={feedbackVersion:F.VERSION,feedbackIssues:[{...old,id:'new'}],revisionDecisions:[{priorIssueId:'old',status:'resolved',evidence:'other text',reason:'Done.'}]};
 assert.equal(F.reconcileRevisions(result,{issues:[old]}).revisionDecisions[0].status,'open');
});

test('Attempt scoping keeps stable issue category and distinct attempt ids, with original and parent links',()=>{
 const a=raw();a.scores.content=5;a.feedbackIssues=[issue()];const result={...a,...F.normalize(a,essay,question,a.scores)};
 const original=F.scope(result,{attemptId:'a'});original.id='a';const revision=F.scope(result,{attemptId:'b',parent:original});
 assert.equal(revision.attemptGroupId,'a');assert.equal(revision.originalAttemptId,'a');assert.equal(revision.parentAttemptId,'a');assert.equal(revision.revisionNumber,1);
 assert.notEqual(original.feedbackIssues[0].id,revision.feedbackIssues[0].id);assert.equal(original.feedbackIssues[0].code,revision.feedbackIssues[0].code);
});

test('New feedback caches deduplicate concurrent calls, isolate policy/revision context and keep samples optional',async()=>{
 const calls=[],metrics=[];
 const grader=createEssayGrader(async(_p,o)=>{calls.push(o?.stage || 'sample');return o?.stage==='assessment'?raw():o?.stage==='subjective-review'?reviewFrom(raw()):{sampleStatus:'ready',sampleResponse:essay,sampleSourceIdeas:['mass media supports learning']};},{onAssessment:m=>metrics.push(m)});
 const opts={feedbackV3:true,includeSample:false};const [a,b]=await Promise.all([grader.grade(question,essay,'9',opts),grader.grade(question,essay,'7',opts)]);
 assert.deepEqual(calls,['assessment','subjective-review']);assert.equal(a.sampleStatus,'not-requested');assert.equal(b.sampleBand,'7');
 await grader.grade(question,essay,'9',{feedbackV3:true,includeSample:true});assert.deepEqual(calls,['assessment','subjective-review','sample']);
 await grader.grade(question,essay,'9',{feedbackV3:false,includeSample:false});assert.equal(calls.filter(c=>c==='assessment').length,2);
 assert.equal(metrics[0].providerCalls,2);assert(!JSON.stringify(metrics).includes(essay));
 assert.equal(policy.normalizeResult(a,essay).sampleStatus,'not-requested');
});

test('Failed feedback formatting retries only the affected stage and never fabricates a successful score',async()=>{
 let count=0;const grader=createEssayGrader(async()=>{count++;return {...raw(),feedbackIssues:undefined};});
 await assert.rejects(grader.grade(question,essay,'9',{feedbackV3:true,includeSample:false}),{code:'feedback_contract'});assert.equal(count,2);
});

test('New tool schemas carry grouped ids, issues and revision decisions, with numbered-word citations',()=>{
 for(const stage of ['assessment','subjective-review','subjective-resolver']){
  const t=format.toolFor(stage,{feedbackV3:true});assert(t.input_schema.required.includes('feedbackIssues'));assert(t.input_schema.required.includes('revisionDecisions'));
  assert(t.input_schema.$defs.coverage.required.includes('requirementId'));assert(t.input_schema.properties.feedbackIssues.items.properties.evidence.properties.essay_span);
 }
 const a=raw();a.feedbackIssues=[{...issue(),evidence:{essay_span:[1,3],promptQuote:''}}];
 assert.equal(evidence.materialise(a,essay).feedbackIssues[0].evidence.essayQuote,essay.split(/\s+/).slice(0,3).join(' '));
});

test('Exercises use the issue passage and suggested action instead of quoting an unrelated introduction',()=>{
 const plan=require('../public/essay-next-steps').plan;
 const a=raw();a.scores.content=5;a.feedbackIssues=[issue()];const final=F.apply({...a,essayText:essay},F.normalize(a,essay,question,a.scores));
 const card=plan(final)[0];assert.equal(card.issueId,final.feedbackIssues[0].id);assert.equal(card.source,issue().evidence.essayQuote);assert.equal(card.exercise,issue().suggestedChange);
});

test('Renderer escapes student and model content, keeps full evidence and labels optional content',()=>{
 const a={feedbackVersion:F.VERSION,essayText:'<img src=x onerror=alert(1)>',feedbackIssues:[],overallVerdict:'<script>bad</script>',strengths:['<b>unsafe</b>'],revisionDecisions:[]};
 const html=F.render(a);assert(!html.includes('<script>'));assert(!html.includes('<img '));assert(html.includes('&lt;script&gt;'));
 assert.equal(F.render({overallVerdict:'historical'}),'');
});

test('Feature rollout is disabled by default, requires verified identity, has stable cohorts and a kill switch',()=>{
 assert.equal(rollout.enabledFor('student',{}),false);assert.equal(rollout.enabledFor('',{ESSAY_FEEDBACK_V3:'true',ESSAY_FEEDBACK_V3_PERCENT:'100'}),false);
 const env={ESSAY_FEEDBACK_V3:'true',ESSAY_FEEDBACK_V3_USERS:'purU',ESSAY_FEEDBACK_V3_PERCENT:'0'};assert.equal(rollout.enabledFor('Puru',env),true);assert.equal(rollout.enabledFor('student',env),false);
 assert.equal(rollout.enabledFor('student',{...env,ESSAY_FEEDBACK_V3_PERCENT:'100'}),true);assert.equal(rollout.enabledFor('Puru',{...env,ESSAY_FEEDBACK_V3:'false'}),false);
 assert.equal(rollout.enabledFor('student',{...env,ESSAY_FEEDBACK_V3_PERCENT:'10'}),rollout.enabledFor('STUDENT',{...env,ESSAY_FEEDBACK_V3_PERCENT:'10'}));
});

test('History cap preserves the original and final drafts when many intermediate revisions exist',()=>{
 const history=Array.from({length:70},(_,i)=>({id:'a'+i,date:i+1,attemptGroupId:'a0',originalAttemptId:'a0',parentAttemptId:i?'a'+(i-1):null,revisionNumber:i,isFinalDraft:i===50,essayText:'draft '+i}));
 const merged=sync.mergeHistory([],history,[]);assert.equal(merged.length,50);assert(merged.some(a=>a.id==='a0'));assert(merged.some(a=>a.id==='a69'));assert(merged.some(a=>a.id==='a50'));
});
