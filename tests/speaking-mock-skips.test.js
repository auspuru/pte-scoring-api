'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const report=require('../speaking-mock-report'),completion=require('../speaking-mock-completion'),bank=require('../content/speaking-mocks');
function attempt(){
 const questions=structuredClone(bank.papers[3].questions);
 const a={id:crypto.randomUUID(),paperId:'speaking-mock-4',title:'Speaking Mock 4',status:'submitted',index:questions.length,questionCount:27,questions,responses:questions.map(()=>({skipped:true})),assessmentProfile:{completionPolicy:completion.policy(questions)}};
 a.assessment={omissions:completion.omissions(a,1000)};return a;
}
test('explicit skips stay zero and remain in every task denominator after available-marks publication',()=>{
 const a=attempt();let kept=0;for(const [i,q]of a.questions.entries())if(q.type!=='intro'&&kept++<6)a.responses[i]={recording:{hash:'saved-'+i},transcript:'Recorded answer.',content:{scoringMode:'ai',total:report.contentMaximum(q),maximum:report.contentMaximum(q)},azure:{status:'assessed',recordingHash:'saved-'+i,pronunciation:{score:5},fluency:{score:5}}};
 // These six recorded RA items have full marks. All other tasks were skipped.
 const before=structuredClone(a);for(const i of Object.keys(a.assessment.omissions))if(a.responses[i].recording)delete a.assessment.omissions[i];
 const frozen=structuredClone(a),r=report.summarize(a).azure;
 assert.equal(r.overallScore,17);assert.equal(r.questionCount,27);assert.equal(r.excludedCount,0);assert.equal(r.unansweredCount,21);assert.equal(r.status,'assessed');assert.equal(r.fullProfile,true);
 assert.equal(r.questions.filter(q=>q.total===0).length,21);assert.equal(r.byType.find(q=>q.type==='rs').maximum,130);assert.deepEqual(a,frozen);assert.deepEqual(a.responses,before.responses);
});
test('an all-skipped completed mock has zero task credit and the existing minimum practice score',()=>{
 const a=attempt(),r=report.summarize(a).azure;assert.equal(r.overallScore,10);assert.equal(r.performancePercent,0);assert.equal(r.unansweredCount,27);assert.equal(r.excludedCount,0);assert.equal(r.questionCount,27);
});
test('a missing recording and an unsettled upload are not mistaken for deliberate skips',()=>{
 const a=attempt(),i=a.questions.findIndex(q=>q.type==='rs');a.responses[i]={};let r=report.summarize(a).azure;assert.equal(r.questions.find(q=>q.index===i).exclusion.reason,'recording-missing');
 a.responses[i]={skipped:true};a.submission={pending:[i]};r=report.summarize(a).azure;assert.notEqual(r.questions.find(q=>q.index===i).status,'unanswered');
});
test('published response details project skip zeros without modifying saved grades or questions',()=>{
 const a=attempt(),before=structuredClone(a),shown=require('../speaking-mock').present(a);
 assert.equal(shown.speakingReport.azure.unansweredCount,27);
 const q=shown.responses.find(q=>q.question.type==='rs');assert.equal(q.content.total,0);assert.equal(q.content.maximum,3);assert.equal(q.providers.azure.pronunciation.score,0);assert.equal(q.unanswered.reason,'skipped');assert.equal(q.exclusion,undefined);assert.deepEqual(a,before);
});
