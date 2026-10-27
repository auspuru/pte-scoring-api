'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {recover}=require('../speaking-incident-recovery'),{createStore}=require('../writing-lab-store'),{createMockJobs,identity}=require('../speaking-mock-jobs'),{hash}=require('../scoring-jobs');
async function fixture(t,{remoteReady=false,rtsHeld=false,uncertain=false}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-incident-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const store=createStore(null,directory,{table:'speaking_mock_attempts'}),id=crypto.randomUUID(),logs=[],calls={azure:0,model:0,remote:0,transcribe:0};
  const delivery={status:'assessed',pronunciation:{score:4},fluency:{score:5},deliveryEvidence:{sufficient:true}};
  const questions=[{id:'image',type:'di',facts:['A verified feature.']},{id:'situation',type:'rts',text:'Explain a request.'}],
    content={total:6,maximum:6,scoringMode:'ai'},responses=questions.map((q,i)=>({recording:{mime:'audio/webm',hash:'saved-'+i,data:'PRIVATE_AUDIO'},transcript:'PRIVATE_TRANSCRIPT',transcriptionStatus:'assessed',azure:structuredClone(delivery),...(i===1&&!rtsHeld?{content:structuredClone(content)}:{})}));
  const a={id,status:'submitted',index:2,questionCount:2,startedAt:1,questions,responses,grading:{status:'pending'}};await store.update('student',id,()=>a);
  const receipt={id:'remote',inputHash:'input',normalizedHash:'normalised'},remoteContent={status:'scored',score:6,max:6,policyVersion:'current',reason:'Verified content.',nextStep:'Keep the comparison.'};
  const academyClient={poll:async()=>remoteReady?{status:'ready',content:remoteContent,failures:[]}:{status:'needs_attention',failures:[{stage:'content',code:'validation'}]},retry:async(_,input)=>{assert.deepEqual(input.stages,['content']);calls.remote++;remoteReady=true;}};
  const progressive=createMockJobs({directory,store,academyClient,assessAzure:async()=>{calls.azure++;return delivery;},callModel:async()=>{calls.model++;},transcribe:async()=>{calls.transcribe++;return 'New transcript';}});t.after(()=>progressive.stop());
  for(const index of [0,...(rtsHeld?[1]:[])]){
    const q=questions[index],stage=index===0?'academy':'content',row=await progressive.jobs.enqueue({id:identity(a,index),owner:'student',groupId:id,inputHash:hash({recording:responses[index].recording.hash,question:q}),
      data:{index,recordingHash:responses[index].recording.hash,questionHash:hash(q),patch:{azure:delivery},...(index===0?{remote:receipt,remoteFailures:[{stage:'content',code:'validation'}]}:{}),
        stages:{[stage]:{status:'needs_attention',failure:index===1&&uncertain?'uncertain_provider_outcome':'validation',attempts:3,detail:'PRIVATE_DETAILS'},azure:{status:'ready'}}}});
    const claim=await progressive.jobs.claim();await progressive.jobs.save(claim,claim.data,{status:'needs_attention'});
  }
  return{a,store,calls,progressive,logs,options:{username:'student',attemptId:id,operation:'incident-test-1',indices:[0,1],action:'repair',mockStore:store,progressive,academyClient,logger:{info:(tag,value)=>logs.push(value)}}};
}
test('targeted recovery resumes only missing Academy content and publishes without repeating Azure or completed content',async t=>{
  const f=await fixture(t),before=structuredClone(f.a);
  const result=await recover(f.options);assert.equal(result.accountedFor,2);assert.equal(result.status,'ready');
  assert.deepEqual(f.calls,{azure:0,model:0,remote:1,transcribe:0});
  const saved=await f.store.get('student',f.a.id);assert.equal(saved.assessment.status,'ready');
  for(let i=0;i<2;i++){assert.deepEqual(saved.responses[i].recording,before.responses[i].recording);assert.deepEqual(saved.responses[i].azure,before.responses[i].azure);}
  assert.deepEqual(saved.responses[1].content,before.responses[1].content);
  assert(!f.logs.join().includes('PRIVATE_'));
  await recover(f.options);assert.deepEqual(f.calls,{azure:0,model:0,remote:1,transcribe:0});
});
test('a completed remote review can repair its local held stage without another paid request',async t=>{
  const f=await fixture(t,{remoteReady:true});assert.equal((await recover(f.options)).status,'ready');assert.equal(f.calls.remote,0);
});
test('diagnosis is read-only and never starts provider requests or changes a held job',async t=>{
  const f=await fixture(t),row=(await f.progressive.jobs.list('student',f.a.id))[0],before=structuredClone(row);
  const result=await recover({...f.options,action:'diagnose'});assert.equal(result.accountedFor,1);
  assert.deepEqual(f.calls,{azure:0,model:0,remote:0,transcribe:0});assert.deepEqual(await f.progressive.jobs.get('student',row.id),before);
});
test('an uncertain companion stage prevents every paid retry in the requested incident scope',async t=>{
  const f=await fixture(t,{rtsHeld:true,uncertain:true});await assert.rejects(recover(f.options),/needs investigation/);
  assert.deepEqual(f.calls,{azure:0,model:0,remote:0,transcribe:0});
});
test('wrong recording hashes and invalid incident scopes are rejected before any paid repair',async t=>{
  const f=await fixture(t);await f.store.update('student',f.a.id,a=>{a.responses[0].recording.hash='changed';return a;});
  await assert.rejects(recover(f.options),/changed/);assert.equal(f.calls.remote,0);
  for(const change of [{indices:[]},{indices:[0,0]},{username:'../all'},{attemptId:'any'},{indices:[9]},{operation:'bad operation'}])await assert.rejects(recover({...f.options,...change}));
});
