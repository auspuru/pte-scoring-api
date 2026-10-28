'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const feedback=require('../public/essay-feedback'),policy=require('../public/essay-scoring');
const format=require('../essay-judge-format');
const root=path.join(__dirname,'..');
function assessed(){
  return {feedbackVersion:feedback.VERSION,wordCount:208,
    essayText:'The assignments are still graded normally but cannot receive a higher score without providing valid reason.',
    scores:{content:5,form:2,coherence:5,linguistic:4,grammar:2,vocabulary:1,spelling:2,total:21},
    feedback:{content:'Your fairness argument is relevant; clarify whether the second alternative caps marks.',form:'208 words: within the 200–300 target.',coherence:'The position, reasons and alternatives follow a logical order.',linguistic:'Several awkward clauses limit expression; simplify the longest sentences.',grammar:'The intended ideas remain clear under the practice rule.',vocabulary:'Replace imprecise expressions with natural wording.',spelling:'No spelling errors were identified.'},
    strengths:['Explains why genuine difficulties can make penalties unfair.'],overallVerdict:'Your position is clear; clarify the second alternative.',
    feedbackIssues:[{code:'stance_conflict',category:'reasoning',trait:'content',priority:'major',affectsScore:true,
      evidence:{essayQuote:'cannot receive a higher score',promptQuote:''},explanation:'This could imply a grade cap, which may conflict with your position.',suggestedChange:'State whether lateness changes the mark, and explain why the policy is fair.',scoreRationale:'One alternative remains ambiguous.'}],
    errors:[],languageCorrections:[{type:'grammar',phrase:'without providing valid reason',correction:'without providing a valid reason',explanation:'The singular countable noun needs an article.'}],optionalRefinements:[],revisionDecisions:[]};
}

test('Essay score explanations are visible for current and saved legacy results, with awarded marks preserved',()=>{
  const a=assessed(),before=structuredClone(a);
  for(const value of [a,{...a,feedbackVersion:undefined}]) {
    const html=feedback.renderScoreBreakdown(value);
    assert.equal((html.match(/scope="row"/g)||[]).length,7);
    for(const text of Object.values(a.feedback))assert(html.includes(text));
    assert.match(html,/21|5\/6/);assert.match(html,/2\/2 does not mean error-free/);
    assert(!html.includes('<details'));
  }
  assert.deepEqual(a,before);
  assert.deepEqual(Object.fromEntries(feedback.CRITERIA.map(([key,,max])=>[key,max])),policy.MAXIMA);
  const gated={...a,scores:Object.fromEntries(Object.keys(a.scores).map(k=>[k,0])),diagnosticScores:a.scores};
  const html=feedback.renderScoreBreakdown(gated);
  assert.match(html,/0\/6/);assert.doesNotMatch(html,/5\/6|2\/2 does not mean error-free/);
});

test('Teacher feedback shows a specific strength, qualified criticism and original-to-correction examples',()=>{
  const a=assessed();a.errors=[...a.languageCorrections];
  const html=feedback.render(a);
  assert(html.indexOf('Score breakdown')<html.indexOf('Overall assessment'));
  assert.match(html,/What you did well/);assert.match(html,/Clarify your position/);
  assert.match(html,/This could imply a grade cap/);assert.match(html,/What to change/);
  assert.match(html,/<q>without providing valid reason<\/q> → without providing a valid reason/);
  assert.equal((html.match(/The singular countable noun needs an article\./g)||[]).length,1);
  assert.doesNotMatch(feedback.render(a,{includeScores:false}),/essay-score-table/);
  assert.doesNotMatch(feedback.render({...a,feedbackIssues:[]}),/Clarify your position/);
});

test('Feedback presentation escapes student wording and long explanations without truncating them',()=>{
  const a=assessed(),unsafe='<img src=x onerror=alert(1)>',long='This complete explanation must remain visible. '.repeat(40);
  a.feedback.content=unsafe+long;a.feedbackIssues[0].evidence.essayQuote=unsafe;
  a.strengths=[unsafe];a.languageCorrections[0].correction=unsafe;
  const html=feedback.render(a);
  assert(!html.includes(unsafe));assert(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert(html.includes(long));assert.equal(feedback.renderScoreBreakdown({}), '');
});

test('The actual essay results view puts the breakdown before corrections for both feedback contracts',()=>{
  const source=fs.readFileSync(path.join(root,'public/index.js'),'utf8');
  const view=source.slice(source.indexOf('function resultsView()'),source.indexOf('\nfunction reattemptPractice()'));
  const sandbox={practiceState:{currentAttempt:assessed()},window:{EssayFeedback:feedback,EssayNextSteps:{render:()=>''}},
    EssayScoring:{taskFocusNote:()=>''},escapeHtml:s=>String(s),renderGrammarSpellingSection:()=>'<section>Grammar corrections</section>',renderPracticeSample:()=>'',welcomeView:()=>''};
  vm.createContext(sandbox);vm.runInContext(view,sandbox);
  for(const version of [feedback.VERSION,undefined]) {
    sandbox.practiceState.currentAttempt.feedbackVersion=version;
    const html=vm.runInContext('resultsView()',sandbox);
    assert.equal((html.match(/class="essay-score-table"/g)||[]).length,1);
    assert(html.indexOf('Score breakdown')<html.indexOf('Grammar corrections'));
    assert.doesNotMatch(html,/<details[^>]*><summary>Score breakdown/);
  }
});

test('Essay scoring defaults to Sonnet independently of the general model and honours an explicit essay override',()=>{
  assert.equal(format.essayModel({CLAUDE_MODEL:'claude-haiku-4-5-20251001'}),'claude-sonnet-4-6');
  assert.equal(format.essayModel({ESSAY_CLAUDE_MODEL:'configured-essay-model'}),'configured-essay-model');
  const source=fs.readFileSync(path.join(root,'server.js'),'utf8');
  assert.match(source,/essayJudgeFormat\.request\(prompt, ESSAY_CLAUDE_MODEL, options\)/);
});
