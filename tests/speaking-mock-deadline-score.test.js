'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const policy=require('../speaking-mock-deadline-score'),report=require('../speaking-mock-report'),review=require('../mock-result-review'),submission=require('../speaking-mock-submission'),{attempt,command}=require('./helpers/speaking-deadline-zero-fixture');
test('17 recorded answers plus ten confirmed timeout answers publish with zero credit and all task denominators retained',()=>{
 const a=attempt(),before=structuredClone(a),plan=policy.inspect(a,a,[],3000);assert(plan.eligible);assert.equal(plan.zeroCount,10);assert.equal(plan.assessedCount,17);
 assert.equal(submission.blocked(a),true);assert.equal(report.summarize(a).azure.status,'pending');
 const body=command(plan),next=policy.apply(a,a,[],body,3000),result=report.summarize(next).azure;
 assert.deepEqual(a,before);assert.deepEqual(next.responses,before.responses);assert.deepEqual(next.questions,before.questions);assert.deepEqual(next.submission,before.submission);
 assert(policy.valid(next));assert.equal(submission.blocked(next),false);assert.equal(result.status,'assessed');assert.equal(result.assessedCount,27);assert.equal(result.excludedCount,0);assert.equal(result.questionCount,27);assert.equal(result.deadlineUnattemptedCount,10);assert(result.fullProfile);
 for(const row of result.questions.filter(q=>q.index>=18)){assert.equal(row.total,0);assert.equal(row.content,0);assert.equal(row.pronunciation,0);assert.equal(row.fluency,0);assert.equal(row.excluded,undefined);}
 for(const type of ['rl','sgd','rts']){const g=result.byType.find(g=>g.type===type);assert(g.maximum>0);assert.equal(g.performancePercent,0);}
 assert.equal(result.overallScore,Math.round(10+80*result.byType.reduce((sum,g)=>sum+g.weight*g.total/g.maximum,0)/result.weightTotal));
 assert.equal(policy.inspect(next,next,[],4000).confirmedHash,plan.confirmedHash);assert.deepEqual(policy.apply(next,next,[],body,4000),next);
 const visible=require('../speaking-mock').present(next,4000,{completeOnly:true});assert(visible.resultsReady);assert.equal(visible.responses[18].content.total,0);assert.equal(visible.responses[18].providers.azure.pronunciation.score,0);assert.match(visible.responses[18].unanswered.note,/zero credit/);
});
test('Missing recordings, partial assessments, contradictory timeout evidence, active work and stale evidence stay held',()=>{
 const changes=[a=>a.status='active',a=>a.submission.missing=[18],a=>a.submission.pending=[18],a=>a.submission.startedAt++,a=>a.finishedAt=1999,a=>a.submission.unattempted.push(18),a=>delete a.responses[18].deadlineUnattempted,a=>a.responses[18].recording={hash:'late'},a=>a.responses[18].transcript='unexpected answer',a=>a.responses[18].content={total:0},a=>a.submission.unattempted=[999],a=>delete a.responses[1].recording,a=>delete a.responses[1].azure.fluency,a=>a.lease={expiresAt:4000}];
 for(const change of changes){const a=attempt(),body=command(policy.inspect(a,a,[],3000));change(a);assert.equal(policy.inspect(a,a,[],3000).eligible,false);assert.throws(()=>policy.apply(a,a,[],body,3000));}
 const a=attempt(),body=command(policy.inspect(a,a,[],3000));assert.throws(()=>policy.apply(a,a,[],{...body,confirmDeadlineZeros:false},3000),{status:400});assert.throws(()=>policy.apply(a,a,[],{...body,evidenceHash:'f'.repeat(64)},3000));
 for(const status of ['running','pending','retry_wait','needs_attention'])assert.equal(policy.inspect(a,a,[{status}],3000).eligible,false);
 const next=policy.apply(a,a,[],body,3000);assert.throws(()=>policy.apply(next,next,[],{...body,note:'A different report publication note.'},4000));
 next.responses[1].content.total--;assert.equal(policy.valid(next),false);assert.equal(submission.blocked(next),true);
});
test('An opted-in review can publish timeout zeroes without retrying, excluding whole tasks or altering its input ledger',()=>{
 const a=attempt(),plan=review.speakingPlan(a,a,[],3000),analysed=review.applySpeaking(a,a,[],{action:'analyse',operation:'review:timeout-analysis',evidenceHash:plan.evidenceHash},3000);
 assert(review.held(analysed));assert.equal(analysed.instructorReview.rounds.length,0);
 const p=policy.inspect(analysed,analysed,[],3000),published=policy.apply(analysed,analysed,[],command(p),3000);
 assert.equal(review.held(published),false);assert(review.publicationValid(published,'speaking'));assert.deepEqual(published.responses,a.responses);assert.equal(report.summarize(published).azure.excludedCount,0);
});
test('Owner-bound publication is durable, idempotent and makes no provider calls across restart',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'deadline-zero-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const store=require('../writing-lab-store').createStore(null,directory,{table:'speaking_mock_attempts'}),a=attempt();await store.update('alice',a.id,()=>a);
 let calls=0;const make=()=>require('../speaking-mock-jobs').createMockJobs({directory,store,now:()=>3000,transcribe:async()=>{calls++;throw Error('Unexpected provider call');},assessAzure:async()=>{calls++;throw Error('Unexpected provider call');}});
 const service=make();t.after(()=>service.stop());const diagnostic=await service.diagnostics('alice',a.id),body=command(diagnostic.deadlineScore);
 await assert.rejects(service.repair('bob',a.id,body),{status:404});const result=await service.repair('alice',a.id,body);assert(result.ready);assert.equal(result.assessedCount,27);assert.equal(result.excludedCount,0);
 await service.stop();const restarted=make();t.after(()=>restarted.stop());await restarted.repair('alice',a.id,body);await restarted.ensure('alice',await store.get('alice',a.id));await restarted.wait();assert.equal(calls,0);assert.deepEqual((await store.get('alice',a.id)).responses,a.responses);
});
