'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const repair=require('../speaking-mock-reference-repair'),{hash}=require('../scoring-jobs'),{createMockJobs,identity}=require('../speaking-mock-jobs'),{createStore}=require('../writing-lab-store');
// Reconstruct the exact pre-review snapshot; fresh papers now have fuller references.
const question=()=>require('../di-practice-references').forAttempt({},structuredClone(require('../content/speaking-mocks').papers[1].questions[19]));
const delivery={status:'assessed',pronunciation:{score:4,maximum:5},fluency:{score:5,maximum:5}};
test('The reference supplement binds the retained original image and exact historical snapshot without editing it',()=>{
 const q=question(),before=structuredClone(q),review=repair.prepare(q);
 assert.equal(hash(q),repair.QUESTION_HASH);assert.deepEqual(q,before);assert.notEqual(review.question,q);
 assert.equal(review.reference.imageSha256,repair.IMAGE_SHA256);assert.equal(review.reference.originalQuestionHash,hash(q));
 assert.deepEqual(review.question.facts.slice(0,q.facts.length),q.facts);
 assert(review.question.facts.some(f=>f.includes('northern plains')));assert(review.question.facts.some(f=>f.includes('northeast')));
 assert.equal(hash(require('../describe-image-feedback').mapping(review.question)),review.reference.mappingHash);
 for(const changed of [{...q,id:'other-di'},{...q,preparation:24},{...q,facts:[...q.facts,'A later reference.']},{...q,imageUrl:'/other.png'}]){
  const untouched=repair.prepare(changed);assert.equal(untouched.question,changed);assert.equal(untouched.reference,undefined);
 }
});
for(const available of [true,false])test('A missing map content review '+(available?'publishes with retained reference evidence':'stays pending when still source-limited')+' and preserves confirmed work',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'map-reference-recovery-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const store=createStore(null,directory,{table:'speaking_mock_attempts'}),text='Forests are concentrated in the northeast, while yellow arable land spreads across the northern plains.';
 const q=question(),a={id:crypto.randomUUID(),status:'submitted',index:2,questionCount:2,startedAt:1,deadline:100000,
  assessmentProfile:{mode:'progressive-v1',diBackend:'portal-gpt'},grading:{status:'pending'},questions:[q,{id:'saved-rs',type:'rs',text:'Keep this result.'}],
  responses:[{recording:{hash:'saved-map-audio',data:'SAVED_AUDIO',mime:'audio/webm'},transcript:text,transcriptionStatus:'assessed',azure:structuredClone(delivery)},
   {recording:{hash:'saved-companion-audio',data:'OTHER_AUDIO',mime:'audio/webm'},transcript:'Keep this result.',content:{total:3,maximum:3,scoringMode:'ai'},azure:structuredClone(delivery)}]};
 const before=structuredClone(a);await store.update('student',a.id,()=>a);let calls=0;
 const jobs=createMockJobs({directory,store,now:()=>1000,transcribe:()=>assert.fail('Retain transcript'),assessAzure:()=>assert.fail('Retain Azure'),
  callModel:async(prompt,context)=>{calls++;assert(context.question.facts.length>q.facts.length);assert(prompt.includes('northern plains'));assert.equal(context.transcript,text);
   return available?{judgment:{score:6,relevance:'image-specific',accuracy:'accurate',scoreImpact:null,requiredEvidence:{quote:text,factIndices:[4,5],kind:'relationship'},inaccuracy:null,otherEvidence:[]},reason:'The response contrasts two supported spatial patterns.',nextStep:'Keep the clear spatial contrast.'}
    :{judgment:{score:null,relevance:'source-limited',accuracy:'unverifiable',scoreImpact:null,requiredEvidence:null,inaccuracy:null,otherEvidence:[{quote:text,factIndices:[],kind:'generic'}]},reason:'This response still cannot be verified.',nextStep:'Review the source evidence.'};
  }});t.after(()=>jobs.stop());
 const id=identity(a,0);await jobs.jobs.enqueue({id,owner:'student',groupId:a.id,inputHash:hash({recording:a.responses[0].recording.hash,question:q}),
  data:{index:0,recordingHash:a.responses[0].recording.hash,questionHash:hash(q),diBackend:'portal-gpt',patch:structuredClone(a.responses[0]),
   stages:{content:{status:'needs_attention',failure:'validation',attempts:3},azure:{status:'ready'},transcription:{status:'ready'}}}});
 const row=await jobs.jobs.claim();await jobs.jobs.save(row,row.data,{status:'needs_attention'});
 const operation={jobId:id,stage:'content',operation:'test:reference-recovery',acknowledgeUncertain:false};
 await jobs.repair('student',a.id,operation);await jobs.wait();const saved=await store.get('student',a.id);
 assert.equal(calls,1);assert.deepEqual(saved.questions,before.questions);assert.deepEqual(saved.responses[1],before.responses[1]);
 for(const key of ['recording','transcript','transcriptionStatus','azure'])assert.deepEqual(saved.responses[0][key],before.responses[0][key]);
 if(available){assert.equal(saved.assessment.status,'ready');assert.equal(saved.responses[0].content.total,6);
  assert.deepEqual(saved.responses[0].content.reviewReference,repair.prepare(q).reference);
  await jobs.repair('student',a.id,operation);await jobs.wait();assert.equal(calls,1);
 }else{assert.equal(saved.responses[0].content,undefined);assert.equal((await jobs.status('student',saved)).ready,false);
  assert.equal((await jobs.diagnostics('student',a.id)).jobs[0].stages.content.detail.code,'source-limited');}
});
