'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const adapters=require('../full-mock/adapters'),assessment=require('../full-mock/assessment');
const {aggregate,inputHash,partialValid,COMPLETION_POLICY}=require('../full-mock/aggregation');
const exclusions=require('../full-mock/exclusions'),report=require('../full-mock/report'),ui=require('../public/full-mock-report');
const {fixture,secondRecording}=require('./helpers/delivery-reassessment-fixture');
const azure={version:'synthetic',pronunciation:{score:3,raw:60},fluency:{score:2,raw:40}};
const content=(q)=>({total:4,maximum:adapters.maxima(q).content,version:'synthetic-content',scoringMode:'ai',contentStatus:'assessed',overview:'Confirmed content.'});

test('Effectively silent saved audio is skipped without asking a provider to invent a transcript',async t=>{
 const f=await fixture(t,async()=>azure),q=f.q.question,response=(await f.store.get(f.owner,f.id)).state.responses[f.number];let calls=0;
 const pcm=Buffer.alloc(32000),bytes=require('../full-mock/recording').wav(pcm),recording={mime:'audio/wav',data:bytes.toString('base64')};
 const a=adapters.createAdapters({transcribe:async()=>{calls++;return 'A recogniser hallucination';},gradeSpeaking:async q=>content(q),assessDelivery:async()=>({deliveryVersion:'synthetic',pronunciation:{score:3},fluency:{score:2}})});
 const skipped=await a.assess(q,response,{recording,completionPolicy:COMPLETION_POLICY});assert.equal(skipped.status,'failed');assert.equal(skipped.stages.transcription.failureCode,'quiet_audio');assert.equal(calls,0);
 await f.store.update(f.owner,f.id,state=>{state.assessment.completionPolicy={version:COMPLETION_POLICY,snapshotHash:state.assessment.snapshotHash};const job=state.assessment.items[f.q.id];job.status='failed';job.result={status:'failed',reason:skipped.reason};job.stages=skipped.stages;assert(exclusions.releaseAvailable(state,f.paper,1234));return state;});
 assert.match(aggregate(f.paper,(await f.store.get(f.owner,f.id)).state).items[f.number-1].exclusion.note,/too quiet/);
 pcm.writeInt16LE(33,0);assert.equal(adapters.quietRecording({mime:'audio/wav',data:require('../full-mock/recording').wav(pcm).toString('base64')}),false);
 await a.assess(q,response,{recording});assert.equal(calls,1);
});

test('A new attempt keeps confirmed content and any Azure trait, while an older attempt still waits',async t=>{
  const f=await fixture(t,async()=>azure),q=f.q.question,response=(await f.store.get(f.owner,f.id)).state.responses[f.number];
  let calls=0,optionsSeen;
  const a=adapters.createAdapters({transcribe:async()=> 'The chart shows a change over time.',gradeSpeaking:async q=>content(q),assessDelivery:async(recording,options)=>{calls++;optionsSeen=options;return {deliveryVersion:'synthetic',deliveryProvider:'azure',pronunciation:{score:4},fluency:{status:'unavailable'}};}});
  const value=await a.assess(q,response,{recording:{data:'synthetic'},completionPolicy:COMPLETION_POLICY,deliveryPolicy:require('../speaking-delivery').PREVIOUS_VERSION});
  assert.equal(optionsSeen,undefined);
  assert.equal(value.status,'assessed');assert.deepEqual(value.scores,{content:4,pronunciation:4,fluency:null});
  assert.equal(value.total,8);assert.equal(value.maximum,11);assert.deepEqual(value.unavailableTraits,['fluency']);
  const {stages,...result}=value;assert.equal(partialValid(result,adapters.maxima(q),stages,'di'),true);
  assert.equal(partialValid({...result,scores:{...result.scores,fluency:5}},adapters.maxima(q),stages,'di'),false);
  assert.equal((await a.assess(q,response,{recording:{data:'synthetic'}})).reason,'delivery-unavailable');assert.equal(calls,2);
  await f.store.update(f.owner,f.id,state=>{state.assessment.completionPolicy={version:COMPLETION_POLICY,snapshotHash:state.assessment.snapshotHash};const job=state.assessment.items[f.q.id];job.result=result;job.stages=stages;return state;});
  const state=(await f.store.get(f.owner,f.id)).state,actual=aggregate(f.paper,state),view=report.buildReport(f.paper,state);
  assert.equal(actual.ready,true);assert.equal(actual.partialCount,1);assert.equal(actual.items[f.number-1].status,'assessed');
  const html=ui.review(view.items[f.number-1]);assert.match(html,/Not assessed/);assert.doesNotMatch(html,/null\/5/);
  assert.match(ui.overview(view),/unavailable marks/);
});

test('Missing, quiet and unavailable assessments are truthfully excluded once, including an entire task',async t=>{
 const f=await fixture(t,async()=>azure);
 await f.store.update(f.owner,f.id,state=>{
  state.assessment.completionPolicy={version:COMPLETION_POLICY,snapshotHash:state.assessment.snapshotHash};
  for(const candidate of f.paper.questions.filter(q=>q.question.type==='ra')){const job=state.assessment.items[candidate.id];job.status='pending';job.result={status:'pending',reason:'recording-not-ready'};job.stages={};}
  const job=state.assessment.items[f.q.id];job.status='failed';job.result={status:'failed',reason:'transcription-unavailable'};job.stages={transcription:{status:'failed',failureCode:'unintelligible_audio',uncertain:false}};
  assert.equal(exclusions.releaseAvailable(state,f.paper,1234),true);state.assessment.status='complete';return state;
 });
 const state=(await f.store.get(f.owner,f.id)).state,r=aggregate(f.paper,state),quiet=r.items[f.number-1];
 assert.equal(r.ready,true);assert.equal(r.groups.ra.omitted,true);assert.equal(quiet.exclusion.reason,'unintelligible-audio');
 assert(Number.isFinite(r.profiles.speaking.practiceIndex));assert.match(ui.breakdown(report.buildReport(f.paper,state)),/Unavailable/);
 const ra=f.paper.questions.find(q=>q.question.type==='ra'),number=f.paper.questions.indexOf(ra)+1;
 assert.equal(r.items[number-1].exclusion.reason,'recording-missing');
 state.responses[number].segments.push({id:'later-upload',mime:'audio/webm',chunks:{},finished:false});
 assert.equal(aggregate(f.paper,state).items[number-1].status,'excluded');
});

test('An explicit resend publishes confirmed marks and shows their changes to the student',async t=>{
 let calls=0;const f=await fixture(t,async()=>{calls++;return azure;}),second=await secondRecording(f),v=await f.api.inspect(f.owner,f.id);
 const body={operation:'delivery:auto-publish',questionIds:[f.q.id,second.candidate.id],evidenceHash:v.evidenceHash,autoPublish:true};
 await f.api.send(f.owner,f.id,body);await f.api.drain();
 const state=(await f.store.get(f.owner,f.id)).state,op=state.deliveryReassessments[body.operation];
 assert.equal(op.status,'published');assert.equal(calls,2);assert.equal(aggregate(f.paper,state).items[f.number-1].status,'assessed');
 const student=report.buildReport(f.paper,state);assert.equal(student.scoreChanges[0].changes.length,2);
 assert.match(ui.overview(student),/Scores updated/);assert.match(ui.overview(student),/5\/5 → 3\/5/);
 assert.equal(JSON.stringify(student.scoreChanges).includes('synthetic-student'),false);
});

test('A later recording can be assessed and brought back into a published report by an explicit resend',async t=>{
 let calls=0;const f=await fixture(t,async()=>azure);let saved;
 await f.store.update(f.owner,f.id,state=>{
  state.assessment.completionPolicy={version:COMPLETION_POLICY,snapshotHash:state.assessment.snapshotHash};
  const response=state.responses[f.number],job=state.assessment.items[f.q.id];saved=structuredClone(response.segments);response.segments=[];
  job.inputHash=inputHash(response);job.status='pending';job.result={status:'pending',reason:'recording-not-ready'};job.stages={};
  assert.equal(exclusions.releaseAvailable(state,f.paper,1234),true);state.assessment.status='complete';response.segments=saved;return state;
 });
 const fake=adapters.createAdapters({transcribe:async()=> 'The chart shows a change over time.',gradeSpeaking:async q=>content(q),assessDelivery:async()=>{throw Error('content preparation must not send Azure');}});
 const engine=assessment.createEngine({store:f.store,adapters:fake}),api=require('../full-mock/delivery-reassessment').create({store:f.store,validate:engine.validate,assessContent:engine.prepareContent,
  assemble:async()=>({status:'ready',recording:{mime:'audio/wav',data:'synthetic'}}),assess:async()=>{calls++;return azure;}});
 const before=(await f.store.get(f.owner,f.id)).state;assert.equal(aggregate(f.paper,before).items[f.number-1].status,'excluded');
 const v=await api.inspect(f.owner,f.id);assert(v.questions.some(q=>q.id===f.q.id&&q.needsContent));
 const body={operation:'delivery:late-audio',questionIds:[f.q.id],evidenceHash:v.evidenceHash,autoPublish:true};await api.send(f.owner,f.id,body);await api.drain();
 const state=(await f.store.get(f.owner,f.id)).state,op=state.deliveryReassessments[body.operation],r=aggregate(f.paper,state);
 assert.equal(calls,1);assert.equal(op.status,'published');assert.equal(r.ready,true);assert.equal(r.items[f.number-1].status,'assessed');
 assert.equal(state.assessment.items[f.q.id].result.scores.content,4);assert.equal(state.assessment.items[f.q.id].result.scores.pronunciation,3);
 assert.deepEqual(state.assessment.exclusions[f.q.id],before.assessment.exclusions[f.q.id]);
 assert.match(ui.overview(report.buildReport(f.paper,state)),/Content: Not assessed → 4\/6/);
 assert.match(ui.overview(report.buildReport(f.paper,state)),/Not assessed → 3\/5/);
});

test('A partial resend publishes the confirmed recording and does not repeat an uncertain provider call',async t=>{
 let calls=0;const f=await fixture(t,async()=>{calls++;if(calls===2)throw Object.assign(Error('provider timeout'),{uncertain:true});return azure;}),second=await secondRecording(f);
 const before=(await f.store.get(f.owner,f.id)).state,v=await f.api.inspect(f.owner,f.id),body={operation:'delivery:auto-partial',questionIds:[f.q.id,second.candidate.id],evidenceHash:v.evidenceHash,autoPublish:true};
 await f.api.send(f.owner,f.id,body);await f.api.drain();const state=(await f.store.get(f.owner,f.id)).state,op=state.deliveryReassessments[body.operation];
 assert.equal(op.status,'published');assert.equal(op.items[1].status,'confirmation-pending');assert.equal(calls,2);
 assert.equal(state.assessment.items[f.q.id].result.scores.pronunciation,3);
 assert.deepEqual(state.assessment.items[second.candidate.id],before.assessment.items[second.candidate.id]);
 assert.equal(report.buildReport(f.paper,state).scoreChanges[0].changes.length,1);
 await f.api.inspect(f.owner,f.id);await f.api.drain();assert.equal(calls,2);
});

test('The assessment worker releases a new report after content fallback and missing audio',async t=>{
 const f=await fixture(t,async()=>azure),missing=f.paper.questions.find(q=>q.question.type==='ra');
 await f.store.update(f.owner,f.id,state=>{state.assessment.completionPolicy={version:COMPLETION_POLICY,snapshotHash:state.assessment.snapshotHash};
  state.assessment.status='not-requested';state.assessment.run=0;delete state.assessment.items[f.q.id];delete state.assessment.items[missing.id];return state;});
 const a=adapters.createAdapters({transcribe:async()=> 'The chart shows a change over time.',gradeSpeaking:async q=>content(q),assessDelivery:async()=>{throw Object.assign(Error('provider unavailable'),{uncertain:false});}});
 const engine=assessment.createEngine({store:f.store,adapters:a,assemble:async()=>({status:'ready',recording:{mime:'audio/wav',data:'synthetic'}})});
 await engine.request(f.owner,f.id);await engine.drain();const state=(await f.store.get(f.owner,f.id)).state,r=aggregate(f.paper,state);
 assert.equal(state.assessment.status,'complete');assert.equal(r.ready,true);assert.equal(r.partialCount,1);
 assert.deepEqual(r.items[f.number-1].unavailableTraits,['pronunciation','fluency']);
 assert.equal(r.items[f.paper.questions.indexOf(missing)].exclusion.reason,'recording-missing');
});

test('After a restart only explicitly auto-publishable saved batches resume; old reviews stay unchanged',async t=>{
 let calls=0;const f=await fixture(t,async()=>{calls++;return azure;}),v=await f.api.inspect(f.owner,f.id);
 const body={operation:'delivery:restart-auto',questionIds:[f.q.id],evidenceHash:v.evidenceHash};await f.api.send(f.owner,f.id,body);await f.api.drain();
 const fresh=require('../full-mock/delivery-reassessment').create({store:f.store,validate:assessment.createEngine({store:f.store}).validate,assess:async()=>{throw Error('Must not call provider again');}});
 assert.equal((await f.store.deliveryQueue()).length,0);await fresh.recover();await fresh.drain();
 assert.equal((await f.store.get(f.owner,f.id)).state.deliveryReassessments[body.operation].status,'review');
 await f.store.update(f.owner,f.id,state=>{state.deliveryReassessments[body.operation].autoPublish=true;return state;});
 assert.equal((await f.store.deliveryQueue()).length,1);await fresh.recover();await fresh.drain();
 assert.equal((await f.store.get(f.owner,f.id)).state.deliveryReassessments[body.operation].status,'published');assert.equal(calls,1);
});

test('A confirmed selection cannot be published while it remains excluded or invalid',async t=>{
 const f=await fixture(t,async()=>azure);
 await f.store.update(f.owner,f.id,state=>{state.assessment.completionPolicy={version:COMPLETION_POLICY,snapshotHash:state.assessment.snapshotHash};
  state.assessment.items[f.q.id].result.scores.content=999;assert.equal(exclusions.releaseAvailable(state,f.paper,1234),true);return state;});
 const before=(await f.store.get(f.owner,f.id)).state,view=await f.api.inspect(f.owner,f.id);
 const body={operation:'delivery:invalid-selection',questionIds:[f.q.id],evidenceHash:view.evidenceHash,autoPublish:true};
 await f.api.send(f.owner,f.id,body);await f.api.drain();const after=(await f.store.get(f.owner,f.id)).state,op=after.deliveryReassessments[body.operation];
 assert.equal(op.status,'review');assert.equal(op.autoPublishError,true);assert.match(op.message,/Q/);assert.deepEqual(after.assessment,before.assessment);
 const preview=await f.api.inspect(f.owner,f.id);assert.equal(preview.operations[body.operation].proposalReady,false);
 await assert.rejects(f.api.publish(f.owner,f.id,{operation:body.operation,confirmPublish:true}),/unassessed|excluded/);
});

test('All 23 selected recordings publish as assessed, including one previously excluded with confirmed content',async t=>{
 let calls=0;const f=await fixture(t,async()=>{calls++;return azure;}),review=require('../mock-result-review'),{hash}=require('../scoring-jobs'),{randomUUID}=require('node:crypto');
 const selected=f.paper.questions.filter(q=>['ra','rs','di','rl','sgd','rts'].includes(q.question.type)).slice(0,23);assert.equal(selected.length,23);assert(selected.some(q=>q.id===f.q.id));
 const segments=new Map();for(const item of selected){const id=randomUUID();await f.store.putChunk(f.owner,f.id,id,0,'audio/webm',f.bytes);segments.set(item.id,{id,chunkCount:1,finished:true,cancelled:false,mime:'audio/webm',chunks:{0:{stored:true,bytes:f.bytes.length,sha256:require('../full-mock/store').hash(f.bytes)}}});}
 await f.store.update(f.owner,f.id,state=>{
  for(const candidate of selected){const response=state.responses[f.paper.questions.indexOf(candidate)+1];response.segments=[segments.get(candidate.id)];state.assessment.items[candidate.id].inputHash=inputHash(response);}
  const job=state.assessment.items[f.q.id],response=state.responses[f.number];job.status='failed';job.result={status:'failed',reason:'delivery-unavailable'};
  job.stages={transcription:{status:'complete',value:'The chart shows a change over time.'},content:{status:'complete',value:content(f.q.question)},delivery:{status:'partial',traits:{}}};
  const plan=review.fullPlan(state,f.paper,Date.now());state.instructorReview={version:review.VERSION,status:'published',operation:'review:started',startedAt:1,inputsHash:plan.inputsHash,confirmed:review.confirmed(state,'full'),rounds:[]};
  state.assessment.exclusions={[f.q.id]:{reason:'instructor-review-unavailable',operation:'review:publication',at:2,note:'Unavailable assessment excluded by instructor.',inputHash:inputHash(response),snapshotHash:state.assessment.snapshotHash,previousJobHash:hash(job)}};
  state.instructorReview.publication={operation:'review:publication',at:2,questionIds:[f.q.id],exclusionsHash:hash(state.assessment.exclusions)};return state;
 });
 const before=(await f.store.get(f.owner,f.id)).state;assert.equal(aggregate(f.paper,before).items[f.number-1].status,'excluded');
 const view=await f.api.inspect(f.owner,f.id),body={operation:'delivery:twenty-three',questionIds:selected.map(q=>q.id),evidenceHash:view.evidenceHash,autoPublish:true};
 await f.api.send(f.owner,f.id,body);await f.api.drain();const after=(await f.store.get(f.owner,f.id)).state,r=aggregate(f.paper,after),op=after.deliveryReassessments[body.operation];
 assert.equal(calls,23);assert.equal(op.status,'published');assert.equal(op.items.filter(item=>item.status==='complete').length,23);
 assert(selected.every(q=>r.items.find(row=>row.id===q.id).status==='assessed'));assert.equal(r.excludedCount,0);assert.equal(r.ready,true);
 assert.deepEqual(after.assessment.exclusions,before.assessment.exclusions);assert.equal(review.publicationValid(after,'full'),true);
 assert.equal(report.buildReport(f.paper,after).scoreChanges[0].changes.length,23);
});

for(const mode of ['unconfigured','uncertain'])test('A late recording publishes content when Azure is '+mode,async t=>{
 let calls=0;const f=await fixture(t,async()=>azure);let saved;
 await f.store.update(f.owner,f.id,state=>{state.assessment.completionPolicy={version:COMPLETION_POLICY,snapshotHash:state.assessment.snapshotHash};
  const response=state.responses[f.number],job=state.assessment.items[f.q.id];saved=structuredClone(response.segments);response.segments=[];
  job.inputHash=inputHash(response);job.status='pending';job.result={status:'pending',reason:'recording-not-ready'};job.stages={};
  assert.equal(exclusions.releaseAvailable(state,f.paper,1234),true);state.assessment.status='complete';response.segments=saved;return state;});
 const fake=adapters.createAdapters({transcribe:async()=> 'The chart shows a change over time.',gradeSpeaking:async q=>content(q),assessDelivery:async()=>{throw Error('Not used');}});
 const engine=assessment.createEngine({store:f.store,adapters:fake}),api=require('../full-mock/delivery-reassessment').create({store:f.store,validate:engine.validate,assessContent:engine.prepareContent,
  assemble:async()=>({status:'ready',recording:{mime:'audio/wav',data:'synthetic'}}),providerConfiguration:()=>mode==='unconfigured'?{ready:false,message:'Azure not configured.'}:{ready:true},
  assess:async()=>{calls++;throw Object.assign(Error('timeout'),{uncertain:true});}});
 const view=await api.inspect(f.owner,f.id),row=view.questions.find(q=>q.id===f.q.id);assert(row.needsContent);assert.equal(row.blocked,false);
 const body={operation:'delivery:content-'+mode,questionIds:[f.q.id],evidenceHash:view.evidenceHash,autoPublish:true};await api.send(f.owner,f.id,body);await api.drain();
 const state=(await f.store.get(f.owner,f.id)).state,op=state.deliveryReassessments[body.operation],item=aggregate(f.paper,state).items[f.number-1];
 assert.equal(op.status,'published');assert.equal(item.status,'assessed');assert.equal(item.scores.content,4);assert.deepEqual(item.unavailableTraits,['pronunciation','fluency']);
 assert.equal(calls,mode==='unconfigured'?0:1);assert.match(ui.overview(report.buildReport(f.paper,state)),/Content: Not assessed → 4\/6/);
 if(mode==='uncertain')assert.equal((await api.inspect(f.owner,f.id)).questions.find(q=>q.id===f.q.id).blocked,true);
});

test('An explicit resend can retry a previously failed, certain content stage for the same recording',async t=>{
 let calls=0;const f=await fixture(t,async()=>azure);
 await f.store.update(f.owner,f.id,state=>{state.assessment.completionPolicy={version:COMPLETION_POLICY,snapshotHash:state.assessment.snapshotHash};
  const job=state.assessment.items[f.q.id];job.status='failed';job.result={status:'failed',reason:'content-unavailable'};
  job.stages={transcription:{status:'complete',attemptedRun:1,value:'The chart shows a change over time.'},content:{status:'failed',attemptedRun:1,uncertain:false}};
  assert.equal(exclusions.releaseAvailable(state,f.paper,1234),true);state.assessment.status='complete';return state;});
 const fake=adapters.createAdapters({transcribe:async()=>{throw Error('Reuse the completed transcript');},gradeSpeaking:async q=>{calls++;return content(q);},assessDelivery:async()=>{throw Error('Not used');}});
 const engine=assessment.createEngine({store:f.store,adapters:fake}),api=require('../full-mock/delivery-reassessment').create({store:f.store,validate:engine.validate,assessContent:engine.prepareContent,
  assemble:async()=>({status:'ready',recording:{mime:'audio/wav',data:'synthetic'}}),assess:async()=>azure});
 const v=await api.inspect(f.owner,f.id),body={operation:'delivery:retry-content',questionIds:[f.q.id],evidenceHash:v.evidenceHash,autoPublish:true};await api.send(f.owner,f.id,body);await api.drain();
 const state=(await f.store.get(f.owner,f.id)).state;assert.equal(state.deliveryReassessments[body.operation].status,'published');assert.equal(calls,1);assert.equal(aggregate(f.paper,state).items[f.number-1].status,'assessed');
});

for(const azureAvailable of [true,false])test('An earlier pending Full Mock recording can be explicitly reassessed with Azure '+azureAvailable,async t=>{
 let contentCalls=0,azureCalls=0;const f=await fixture(t,async()=>azure);
 await f.store.update(f.owner,f.id,state=>{const job=state.assessment.items[f.q.id];job.status='failed';job.result={status:'failed',reason:'delivery-unavailable'};job.stages={transcription:{status:'complete',value:'The chart shows a change over time.'},content:{status:'complete',value:content(f.q.question)},delivery:{status:'partial',uncertain:false,traits:azureAvailable?{}:{pronunciation:{score:4,version:'earlier-confirmed'}}}};state.assessment.status='needs-attention';return state;});
 const before=(await f.store.get(f.owner,f.id)).state;assert.equal(before.assessment.completionPolicy,undefined);assert.equal(aggregate(f.paper,before).ready,false);
 const fake=adapters.createAdapters({transcribe:async()=>{throw Error('Reuse the saved transcript');},gradeSpeaking:async()=>{contentCalls++;throw Error('Reuse confirmed content');},assessDelivery:async()=>{throw Error('Content preparation only');}}),engine=assessment.createEngine({store:f.store,adapters:fake});
 const api=require('../full-mock/delivery-reassessment').create({store:f.store,validate:engine.validate,assessContent:engine.prepareContent,assemble:async()=>({status:'ready',recording:{mime:'audio/wav',data:'synthetic'}}),assess:async()=>{azureCalls++;if(!azureAvailable)throw Object.assign(Error('Azure timeout'),{uncertain:true});return azure;}});
 const v=await api.inspect(f.owner,f.id);assert(v.questions.some(q=>q.id===f.q.id&&q.needsContent));const body={operation:'delivery:earlier-'+azureAvailable,questionIds:[f.q.id],evidenceHash:v.evidenceHash,autoPublish:true};await assert.rejects(api.send(f.owner,f.id,{...body,autoPublish:false}),/current admin/);assert.deepEqual((await f.store.get(f.owner,f.id)).state.assessment,before.assessment);await api.send(f.owner,f.id,body);await api.drain();
 const after=(await f.store.get(f.owner,f.id)).state,op=after.deliveryReassessments[body.operation],r=aggregate(f.paper,after);assert.equal(op.status,'published');assert.equal(r.ready,true);assert.equal(r.items[f.number-1].status,'assessed');assert.equal(contentCalls,0);assert.equal(azureCalls,1);
 assert.deepEqual(op.earlierPublication.assessment,before.assessment);assert.equal(after.assessment.snapshotHash,before.assessment.snapshotHash);assert.deepEqual(after.responses,before.responses);
 for(const q of f.paper.questions)if(q.id!==f.q.id)assert.deepEqual(after.assessment.items[q.id],before.assessment.items[q.id]);
 assert.equal(after.assessment.items[f.q.id].result.scores.content,4);assert.equal(after.assessment.items[f.q.id].result.scores.pronunciation,azureAvailable?3:4);if(!azureAvailable)assert.deepEqual(after.assessment.items[f.q.id].stages.delivery.traits.pronunciation,before.assessment.items[f.q.id].stages.delivery.traits.pronunciation);
});
