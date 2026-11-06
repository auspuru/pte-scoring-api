'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),express=require('express');
const completion=require('../speaking-mock-completion'),report=require('../speaking-mock-report'),{hash}=require('../scoring-jobs'),{installSpeakingMock,present}=require('../speaking-mock');
const {fixture,content,raw}=require('./helpers/speaking-reassessment-fixture');
test('An older Speaking Mock publishes current bands after explicit Azure reassessment',async t=>{
 const delivery=require('../speaking-delivery'),assessed={version:'synthetic-continuous',pronunciation:{score:5,raw:94},fluency:{score:5,raw:90}};
 const f=await fixture(t,{deliveryReassessment:{assess:async()=>assessed,rebandCurrent:true,gradeContent:async q=>content(q)}});
 const before=await f.store.get(f.owner,f.id),view=await f.service.deliveryReview.inspect(f.owner,f.id);
 const body={operation:'delivery:current-bands',questionIds:[f.questions[f.index].id],evidenceHash:view.evidenceHash,autoPublish:true};
 await f.service.deliveryReview.send(f.owner,f.id,body);await f.service.deliveryReview.drain();
 const proposal=(await f.service.deliveryReview.inspect(f.owner,f.id)).operations[body.operation];
 assert.equal(proposal.status,'published');assert.equal(proposal.items[0].result.bandPolicy,delivery.VERSION);
 assert.deepEqual([proposal.items[0].result.pronunciation.score,proposal.items[0].result.fluency.score],[4,4]);
 const after=await f.store.get(f.owner,f.id);
 assert.equal(after.assessmentProfile.deliveryPolicy,undefined);
 assert.deepEqual([after.responses[f.index].azure.pronunciation.score,after.responses[f.index].azure.fluency.score],[4,4]);
 assert.deepEqual(after.responses[f.index+1],before.responses[f.index+1]);
});
test('A published Speaking Mock can correct a later Azure reading from archived original raw scores',async t=>{
 const delivery=require('../speaking-delivery');let azureCalls=0;
 const f=await fixture(t,{deliveryReassessment:{providerConfiguration:()=>({ready:false,message:'Azure unavailable.'}),assess:async()=>{azureCalls++;throw Error('Do not remeasure saved audio');}}});
 const ra=f.questions.findIndex(q=>q.type==='ra'),rs=f.questions.findIndex(q=>q.type==='rs');
 await f.store.update(f.owner,f.id,a=>{
  const items=[f.index,ra,rs].map(index=>{
   const r=a.responses[index],original=structuredClone(r),raw=index===f.index?[40,55]:[94,89];
   original.azure.pronunciation={score:index===f.index?1:5,raw:raw[0]};
   original.azure.fluency={score:index===f.index?1:4,raw:raw[1]};
   r.azure.pronunciation={score:5,raw:95};r.azure.fluency={score:5,raw:95};
   return {index,previous:require('../speaking-mock-reassessment').metadata(original)};
  });
  a.deliveryReassessments={'delivery:prior-batch':{operation:'delivery:prior-batch',status:'published',at:100,items}};
  return a;
 });
 const view=await f.service.deliveryReview.inspect(f.owner,f.id),question=view.questions.find(q=>q.index===f.index);
 assert.equal(question.savedRawAvailable,true);assert.equal(question.blocked,false);
 const body={operation:'delivery:correct-original-raw',questionIds:[f.index,ra,rs].map(index=>view.questions.find(q=>q.index===index).id),evidenceHash:view.evidenceHash,autoPublish:true};
 await f.service.deliveryReview.send(f.owner,f.id,body);await f.service.deliveryReview.drain();
 const after=await f.store.get(f.owner,f.id),op=after.deliveryReassessments[body.operation];
 assert.equal(op.status,'published');assert.equal(azureCalls,0);
 assert.equal(op.items[0].result.bandPolicy,delivery.VERSION);
 assert.deepEqual([after.responses[f.index].azure.pronunciation.raw,after.responses[f.index].azure.fluency.raw],[40,55]);
 assert.deepEqual([after.responses[f.index].azure.pronunciation.score,after.responses[f.index].azure.fluency.score],[1,1]);
 for(const index of [ra,rs])assert.deepEqual([after.responses[index].azure.pronunciation.score,after.responses[index].azure.fluency.score],[4,4]);
});
test('New Speaking mocks publish confirmed content while missing Azure traits stay unavailable',async t=>{
 const f=await fixture(t);await f.store.update(f.owner,f.id,a=>{a.responses[f.index].azure={status:'unavailable'};a.assessment.status='processing';a.grading.status='pending';return a;});
 const before=await f.store.get(f.owner,f.id);await f.service.progressive.ensure(f.owner,before);await f.service.waitForJobs();
 const a=await f.store.get(f.owner,f.id),r=report.summarize(a).azure,row=r.questions.find(q=>q.index===f.index);
 assert.equal(a.assessment.status,'ready');assert.equal(r.status,'assessed');assert.equal(row.content,6);assert.equal(row.maximum,6);assert.equal(row.pronunciation,null);assert.equal(row.fluency,null);assert.deepEqual(row.unavailableTraits,['pronunciation','fluency']);
 assert.equal((await f.service.progressive.jobs.list(f.owner,f.id))[0].data.stages.azure.failure,'uncertain_provider_outcome');
 const copy=structuredClone(a),view=present(a,3000,{completeOnly:true});assert.equal(view.resultsReady,true);assert.equal(view.responses[f.index].providers.azure.pronunciation.score,null);assert.deepEqual(a,copy);
});
test('A Speaking partial result retains the independently confirmed Azure companion trait',async t=>{
 const f=await fixture(t);await f.store.update(f.owner,f.id,a=>{const r=a.responses[f.index];r.azure={status:'assessed',recordingHash:r.recording.hash,pronunciation:{score:4},fluency:{status:'unavailable'}};r.assessmentOutcome=completion.receipt(a.questions[f.index],r,'available',1234);return a;});
 const a=await f.store.get(f.owner,f.id),row=report.summarize(a).azure.questions.find(q=>q.index===f.index);assert.equal(row.pronunciation,4);assert.equal(row.fluency,null);assert.equal(row.maximum,11);assert.equal(row.total,10);assert.deepEqual(row.unavailableTraits,['fluency']);
});
for(const kind of ['missing','quiet'])test('Speaking '+kind+' recordings are excluded without invented marks',async t=>{
 let calls=0;const f=await fixture(t,{quietRecording:async()=>true,transcribe:async()=>{calls++;return 'Should not be transcribed';}});
 await f.store.update(f.owner,f.id,a=>{const r=a.responses[f.index];delete r.content;delete r.transcript;delete r.transcriptionStatus;delete r.azure;if(kind==='missing')delete r.recording;a.assessment.status='processing';a.grading.status='pending';return a;});
 await f.service.progressive.ensure(f.owner,await f.store.get(f.owner,f.id));await f.service.waitForJobs();const a=await f.store.get(f.owner,f.id),r=report.summarize(a).azure,row=r.questions.find(row=>row.index===f.index);
 assert.equal(r.status,'assessed');assert.equal(r.excludedCount,1);assert.equal(row.total,null);assert.match(row.exclusion.note,kind==='quiet'?/too quiet/:/No recording/);assert.equal(calls,0);assert.equal(present(a).responses[f.index].exclusion.reason,kind==='quiet'?'quiet-audio':'recording-missing');
});
test('An old Speaking attempt retains its pending-delivery behavior',async t=>{
 const f=await fixture(t,{policy:false});await f.store.update(f.owner,f.id,a=>{a.responses[f.index].azure={status:'unavailable'};a.assessment.status='processing';return a;});
 await f.service.progressive.ensure(f.owner,await f.store.get(f.owner,f.id));await f.service.waitForJobs();const a=await f.store.get(f.owner,f.id);
 assert.equal(report.summarize(a).azure.status,'pending');assert.notEqual(a.assessment.status,'ready');
});
test('A new completely missing Speaking attempt finishes with an unavailable score, not zero',async t=>{
 const f=await fixture(t);await f.store.update(f.owner,f.id,a=>{a.responses=a.questions.map(()=>({skipped:true}));a.assessment.status='processing';a.grading.status='pending';return a;});await f.service.progressive.ensure(f.owner,await f.store.get(f.owner,f.id));await f.service.waitForJobs();
 const a=await f.store.get(f.owner,f.id),r=report.summarize(a).azure;assert.equal(a.assessment.status,'ready');assert.equal(r.status,'assessed');assert.equal(r.overallScore,null);assert.equal(r.excludedCount,27);assert.equal(r.unavailable,true);
});
test('All 27 Speaking recordings can be resent and published with student-visible changes',async t=>{
 let calls=0;const f=await fixture(t,{policy:false,deliveryReassessment:{assess:async recording=>{calls++;assert.equal(recording.data,f.recording.data);return raw;},gradeContent:async q=>content(q)}});
 const before=await f.store.get(f.owner,f.id),v=await f.service.deliveryReview.inspect(f.owner,f.id),body={operation:'delivery:whole-speaking',all:true,evidenceHash:v.evidenceHash,autoPublish:true};
 await f.service.deliveryReview.send(f.owner,f.id,body);await f.service.deliveryReview.drain();const a=await f.store.get(f.owner,f.id),op=a.deliveryReassessments[body.operation];
 assert.equal(calls,27);assert.equal(op.status,'published');assert.equal(report.summarize(a).azure.excludedCount,0);assert.equal(op.items.length,27);
 for(let i=1;i<a.questions.length;i++){assert.deepEqual(a.responses[i].recording,before.responses[i].recording);assert.deepEqual(a.responses[i].content,before.responses[i].content);assert.equal(a.responses[i].azure.pronunciation.score,4);}
 const view=present(a);assert.equal(view.scoreChanges[0].changes.length,27);assert.match(require('../public/speaking-mock-client').scoreUpdates(view.scoreChanges),/2\/5 → 4\/5/);
 assert.deepEqual((await f.service.progressive.hydrate(f.owner,a)).responses,a.responses);
 await f.service.deliveryReview.send(f.owner,f.id,body);await f.service.deliveryReview.drain();assert.equal(calls,27);await assert.rejects(f.service.deliveryReview.inspect('other-account',f.id),/not found/);
});
test('Competing Speaking controllers send a selected recording once and reject an operation reused for another selection',async t=>{
 let calls=0,finish;const f=await fixture(t,{deliveryReassessment:{assess:async()=>{calls++;return new Promise(resolve=>{finish=resolve;});}}}),view=await f.service.deliveryReview.inspect(f.owner,f.id),body={operation:'delivery:competing-speaking',questionIds:[f.questions[f.index].id],evidenceHash:view.evidenceHash,autoPublish:true};
 await f.service.deliveryReview.send(f.owner,f.id,body);while(!finish)await new Promise(resolve=>setImmediate(resolve));
 const other=require('../speaking-mock-reassessment').create({store:f.store,jobStore:f.service.progressive.jobs,assess:async()=>{calls++;throw Error('No repeated provider call');}});
 await other.send(f.owner,f.id,body);assert.equal(calls,1);finish(raw);await f.service.deliveryReview.drain();await other.drain();
 const a=await f.store.get(f.owner,f.id);assert.equal(a.deliveryReassessments[body.operation].status,'published');assert.equal(calls,1);
 await assert.rejects(other.send(f.owner,f.id,{...body,questionIds:[f.questions[1].id]}),/another selection/);
});
test('A previously excluded Speaking recording is included after its confirmed reassessment',async t=>{
 const f=await fixture(t,{policy:false});await f.store.update(f.owner,f.id,a=>{const q=a.questions[f.index];a.assessmentExclusions={[f.index]:{reason:'feedback-unavailable',authorizedBy:'administrator',attemptId:a.id,index:f.index,questionId:q.id,questionHash:hash(q),recordingHash:a.responses[f.index].recording.hash,operation:'review:old-exclusion',note:'Earlier unavailable feedback excluded by the instructor.',excludedAt:1234}};return a;});
 const before=await f.store.get(f.owner,f.id);assert.equal(report.summarize(before).azure.excludedCount,1);const v=await f.service.deliveryReview.inspect(f.owner,f.id),body={operation:'delivery:restore-speaking',questionIds:[f.questions[f.index].id],evidenceHash:v.evidenceHash,autoPublish:true};
 await f.service.deliveryReview.send(f.owner,f.id,body);await f.service.deliveryReview.drain();const a=await f.store.get(f.owner,f.id);
 assert.equal(a.deliveryReassessments[body.operation].status,'published');assert.equal(report.summarize(a).azure.excludedCount,0);assert.deepEqual(a.assessmentExclusions,before.assessmentExclusions);assert.equal(completion.replacement(a,f.index),true);
});
test('Unavailable Azure after a new content assessment still publishes the content',async t=>{
 const f=await fixture(t,{deliveryReassessment:{assess:async()=>{throw Object.assign(Error('timeout'),{uncertain:true});},gradeContent:async q=>content(q)}});
 await f.store.update(f.owner,f.id,a=>{const r=a.responses[f.index];delete r.content;delete r.azure;r.assessmentOutcome=completion.receipt(a.questions[f.index],r,'assessment-unavailable',1234);return a;});
 const v=await f.service.deliveryReview.inspect(f.owner,f.id),body={operation:'delivery:restore-content',questionIds:[f.questions[f.index].id],evidenceHash:v.evidenceHash,autoPublish:true};await f.service.deliveryReview.send(f.owner,f.id,body);await f.service.deliveryReview.drain();
 const a=await f.store.get(f.owner,f.id),r=report.summarize(a).azure.questions.find(row=>row.index===f.index);assert.equal(a.deliveryReassessments[body.operation].status,'published');assert.equal(r.content,6);assert.equal(r.pronunciation,null);assert.equal(r.maximum,6);assert.equal(present(a).scoreChanges[0].changes[0].traits[0].trait,'Content');
 assert.equal((await f.service.deliveryReview.inspect(f.owner,f.id)).questions.find(q=>q.index===f.index).blocked,true);
});

test('An excluded Speaking answer with confirmed content can be published while Azure is unconfigured',async t=>{
 let calls=0;const f=await fixture(t,{deliveryReassessment:{providerConfiguration:()=>({ready:false,message:'Azure unavailable.'}),assess:async()=>{calls++;throw Error('No provider call expected');}}});
 await f.store.update(f.owner,f.id,a=>{const r=a.responses[f.index];delete r.azure;r.assessmentOutcome=completion.receipt(a.questions[f.index],r,'assessment-unavailable',1234);return a;});
 const v=await f.service.deliveryReview.inspect(f.owner,f.id);assert.equal(v.questions.find(q=>q.index===f.index).blocked,false);
 const body={operation:'delivery:unconfigured-speaking',questionIds:[f.questions[f.index].id],evidenceHash:v.evidenceHash,autoPublish:true};await f.service.deliveryReview.send(f.owner,f.id,body);await f.service.deliveryReview.drain();
 const a=await f.store.get(f.owner,f.id);assert.equal(calls,0);assert.equal(a.deliveryReassessments[body.operation].status,'published');assert.equal(report.summarize(a).azure.questions.find(q=>q.index===f.index).status,'available-marks');
});
test('Changed Speaking evidence prevents publication and tampered audio never reaches Azure',async t=>{
 let calls=0;const f=await fixture(t,{deliveryReassessment:{assess:async()=>{calls++;return raw;}}});
 await f.store.update(f.owner,f.id,a=>{a.responses[f.index].recording.data=Buffer.from('tampered').toString('base64');return a;});const v=await f.service.deliveryReview.inspect(f.owner,f.id),body={operation:'delivery:tampered-speaking',questionIds:[f.questions[f.index].id],evidenceHash:v.evidenceHash,autoPublish:true};await f.service.deliveryReview.send(f.owner,f.id,body);await f.service.deliveryReview.drain();
 const a=await f.store.get(f.owner,f.id);assert.equal(calls,0);assert.equal(a.deliveryReassessments[body.operation].items[0].status,'failed');assert.equal(a.responses[f.index].azure.pronunciation.score,2);
});

test('Speaking reassessment preserves the published instructor ledger and unrelated exclusions',async t=>{
 const f=await fixture(t,{policy:false}),review=require('../mock-result-review'),other=f.questions.findIndex(q=>q.type==='rs');
 await f.store.update(f.owner,f.id,a=>{
  for(const i of [f.index,other])delete a.responses[i].azure;
  const plan=review.speakingPlan(a,a,[],1234);a.instructorReview={version:review.VERSION,status:'published',inputsHash:plan.inputsHash,confirmed:review.confirmed(a,'speaking'),rounds:[]};
  a.assessmentExclusions=Object.fromEntries([f.index,other].map(i=>[i,{reason:'instructor-review-unavailable',operation:'review:published',note:'Earlier unavailable delivery excluded at instructor request.',attemptId:a.id,index:i,questionId:a.questions[i].id,questionHash:hash(a.questions[i]),responseHash:hash(require('../speaking-mock-reassessment').metadata(a.responses[i]))}]));
  a.instructorReview.publication={operation:'review:published',questionIds:[a.questions[f.index].id,a.questions[other].id],exclusionsHash:hash(a.assessmentExclusions)};return a;
 });
 const before=await f.store.get(f.owner,f.id);assert.equal(review.publicationValid(before,'speaking'),true);assert.equal(report.summarize(before).azure.excludedCount,2);
 const v=await f.service.deliveryReview.inspect(f.owner,f.id),body={operation:'delivery:instructor-speaking',questionIds:[f.questions[f.index].id],evidenceHash:v.evidenceHash,autoPublish:true};await f.service.deliveryReview.send(f.owner,f.id,body);await f.service.deliveryReview.drain();
 const a=await f.store.get(f.owner,f.id);assert.equal(a.deliveryReassessments[body.operation].status,'published');assert.equal(review.publicationValid(a,'speaking'),true);assert.equal(report.summarize(a).azure.excludedCount,1);assert.deepEqual(a.assessmentExclusions,before.assessmentExclusions);assert.deepEqual(a.instructorReview.publication,before.instructorReview.publication);
 assert.deepEqual(a.deliveryReassessments[body.operation].instructorReviewAmendment.beforeConfirmed,before.instructorReview.confirmed);
});

test('Speaking provider receipts survive controller restart and old job patches cannot restore earlier scores',async t=>{
 let calls=0;const f=await fixture(t,{deliveryReassessment:{assess:async()=>{calls++;return raw;}}}),v=await f.service.deliveryReview.inspect(f.owner,f.id),body={operation:'delivery:resume-speaking',questionIds:[f.questions[f.index].id],evidenceHash:v.evidenceHash};
 await f.service.deliveryReview.send(f.owner,f.id,body);await f.service.deliveryReview.drain();assert.equal((await f.store.deliveryQueue()).length,0);
 const old=await f.store.get(f.owner,f.id),r=old.responses[f.index];await f.service.progressive.jobs.enqueue({id:'old-synthetic-job',owner:f.owner,groupId:f.id,inputHash:hash({q:f.questions[f.index],r:r.recording.hash}),data:{index:f.index,questionHash:hash(f.questions[f.index]),recordingHash:r.recording.hash,patch:{azure:r.azure},stages:{}}});
 const row=await f.service.progressive.jobs.claim();await f.service.progressive.jobs.save(row,row.data,{status:'ready'});
 await f.store.update(f.owner,f.id,a=>{a.deliveryReassessments[body.operation].autoPublish=true;return a;});
 const restarted=require('../speaking-mock-reassessment').create({store:f.store,jobStore:f.service.progressive.jobs,assess:async()=>{throw Error('Do not repeat the provider request');}});await restarted.recover();await restarted.drain();
 const a=await f.store.get(f.owner,f.id);assert.equal(a.deliveryReassessments[body.operation].status,'published');assert.equal(calls,1);assert.equal((await f.service.progressive.hydrate(f.owner,a)).responses[f.index].azure.pronunciation.score,4);
});

test('A recording saved after missing-audio publication can be explicitly reassessed and included',async t=>{
 const f=await fixture(t);await f.store.update(f.owner,f.id,a=>{a.responses[f.index]={skipped:true};a.assessment.status='processing';a.grading.status='pending';return a;});
 await f.service.progressive.ensure(f.owner,await f.store.get(f.owner,f.id));await f.service.waitForJobs();
 await f.store.update(f.owner,f.id,a=>{a.responses[f.index].recording=structuredClone(f.recording);return a;});
 const before=await f.store.get(f.owner,f.id);assert.equal(report.summarize(before).azure.status,'assessed');assert.equal(report.summarize(before).azure.excludedCount,1);
 const v=await f.service.deliveryReview.inspect(f.owner,f.id),body={operation:'delivery:late-speaking-audio',questionIds:[f.questions[f.index].id],evidenceHash:v.evidenceHash,autoPublish:true};await f.service.deliveryReview.send(f.owner,f.id,body);await f.service.deliveryReview.drain();
 const a=await f.store.get(f.owner,f.id);assert.equal(a.deliveryReassessments[body.operation].status,'published');assert.equal(report.summarize(a).azure.excludedCount,0);assert.equal(present(a).scoreChanges[0].changes[0].traits[0].trait,'Content');
});

test('Speaking admin routes require authentication and the student only sees their own changed scores',async t=>{
 const requireAdmin=(req,res,next)=>req.headers['x-admin-key']==='isolated-test'?next():res.sendStatus(403),f=await fixture(t,{requireAdmin});
 const server=f.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port,route='/api/admin/speaking-mocks/'+f.owner+'/'+f.id+'/scoring/delivery',headers={'x-admin-key':'isolated-test'};
 assert.equal((await fetch(base+route)).status,403);assert.equal((await fetch(base+route,{headers})).status,200);assert.equal((await fetch(base+route.replace(f.owner,'other-user'),{headers})).status,404);
 const v=await (await fetch(base+route,{headers})).json(),body={operation:'delivery:http-speaking',questionIds:[f.questions[f.index].id],evidenceHash:v.evidenceHash,autoPublish:true};
 assert.equal((await fetch(base+route+'/send',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(body)})).status,200);await f.service.deliveryReview.drain();
 const own=await fetch(base+'/api/speaking-mocks/attempts/'+f.id,{headers:{'x-session-token':f.owner}});assert.equal(own.status,200);const student=await own.json();assert.equal(student.scoreChanges[0].changes.length,1);assert.equal(JSON.stringify(student).includes('recording.data'),false);assert.equal(student.deliveryReassessments,undefined);
 assert.equal((await fetch(base+'/api/speaking-mocks/attempts/'+f.id,{headers:{'x-session-token':'other-user'}})).status,401);
});

test('An earlier pending Speaking recording can publish its existing content when Azure is unavailable',async t=>{
 let contentCalls=0;const f=await fixture(t,{policy:false,deliveryReassessment:{gradeContent:async()=>{contentCalls++;throw Error('Reuse saved content');},assess:async()=>{throw Object.assign(Error('Azure timeout'),{uncertain:true});}}});
 await f.store.update(f.owner,f.id,a=>{delete a.responses[f.index].azure;a.assessment.status='needs-attention';a.grading.status='pending';return a;});
 const before=await f.store.get(f.owner,f.id);assert.equal(report.summarize(before).azure.status,'pending');const v=await f.service.deliveryReview.inspect(f.owner,f.id),body={operation:'delivery:earlier-speaking',questionIds:[f.questions[f.index].id],evidenceHash:v.evidenceHash,autoPublish:true};await assert.rejects(f.service.deliveryReview.send(f.owner,f.id,{...body,autoPublish:false}),/current admin/);assert.deepEqual(await f.store.get(f.owner,f.id),before);await f.service.deliveryReview.send(f.owner,f.id,body);await f.service.deliveryReview.drain();
 const after=await f.store.get(f.owner,f.id),op=after.deliveryReassessments[body.operation],row=report.summarize(after).azure.questions.find(q=>q.index===f.index);assert.equal(op.status,'published');assert.equal(row.status,'available-marks');assert.equal(row.content,6);assert.equal(row.pronunciation,null);assert.equal(contentCalls,0);
 assert.deepEqual(op.earlierPublication.responses,before.responses.map(require('../speaking-mock-reassessment').metadata));assert.deepEqual(after.responses[f.index].recording,before.responses[f.index].recording);assert.equal(op.beforeProfiles.speaking.practiceIndex,null);
});

test('Earlier Speaking job receipts are reused instead of buying another content assessment',async t=>{
 let contentCalls=0;const f=await fixture(t,{policy:false,deliveryReassessment:{gradeContent:async()=>{contentCalls++;throw Error('Reuse the confirmed job');},assess:async()=>raw}});
 await f.store.update(f.owner,f.id,a=>{delete a.responses[f.index].content;delete a.responses[f.index].azure;a.assessment.status='needs-attention';a.grading.status='pending';return a;});
 await f.service.progressive.jobs.enqueue({id:'saved-earlier-content',owner:f.owner,groupId:f.id,inputHash:hash({id:f.id,index:f.index}),data:{index:f.index,recordingHash:f.recording.hash,questionHash:hash(f.questions[f.index]),patch:{content:content(f.questions[f.index])},stages:{content:{status:'ready'},azure:{status:'needs_attention',failure:503}}}});
 const job=await f.service.progressive.jobs.claim();await f.service.progressive.jobs.save(job,job.data,{status:'needs_attention'});
 const v=await f.service.deliveryReview.inspect(f.owner,f.id),body={operation:'delivery:reuse-earlier-job',questionIds:[f.questions[f.index].id],evidenceHash:v.evidenceHash,autoPublish:true};await f.service.deliveryReview.send(f.owner,f.id,body);await f.service.deliveryReview.drain();const a=await f.store.get(f.owner,f.id);
 assert.equal(a.deliveryReassessments[body.operation].status,'published');assert.equal(contentCalls,0);assert.equal(a.responses[f.index].content.total,6);assert.equal(a.responses[f.index].azure.pronunciation.score,4);assert.equal(present(a).scoreChanges[0].changes[0].traits[0].trait,'Content');
});
