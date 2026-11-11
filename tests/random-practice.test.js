'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const random=require('../random-practice'),{fixture}=require('./helpers/random-practice-fixture');
test('the seven single-task pools are unique, ready and only advertise supported set sizes',()=>{
  assert.deepEqual(Object.keys(random.pools()),['ra','rs','di','rl','sgd','rts','wfd']);
  for(const meta of random.catalogue()){
    const pool=random.pools()[meta.type];assert.equal(new Set(pool.map(q=>q.id)).size,pool.length);assert(pool.length>=5);
    assert(meta.counts.every(n=>[5,10,15,20].includes(n)&&n<=pool.length));
    for(const count of meta.counts){const paper=random.make({type:meta.type,count},[],n=>n-1);assert.equal(paper.questions.length,count);assert(paper.questions.every(q=>q.type===meta.type));assert.equal(new Set(paper.questions.map(q=>q.id)).size,count);assert(paper.minutes>0);}
  }
  assert.deepEqual(random.catalogue().find(q=>q.type==='sgd').counts,[5,10,15]);
  assert(random.pools().rs.every(q=>q.text.split(/\s+/u).length<=12));
  for(const q of Object.values(random.pools()).flat().filter(q=>['rs','rl','sgd','rts'].includes(q.type)))assert(q.audioSource&&q.audioSeconds>0);
});
test('selection is random, avoids previously used questions where possible and rejects manual/mixed inputs',()=>{
  const original=JSON.stringify(require('../content/speaking-mocks').papers),config={type:'ra',count:5};
  const one=random.make(config,[],n=>n-1),two=random.make(config,[],()=>0);assert.notDeepEqual(one.questions.map(q=>q.id),two.questions.map(q=>q.id));
  const fresh=random.make(config,[{practiceSet:one.practiceSet,questions:one.questions}],n=>n-1);assert(fresh.questions.every(q=>!one.questions.some(old=>old.id===q.id)));
  for(const bad of [{type:['ra','rs'],count:5},{type:'ra',count:'5'},{type:'ra',count:4},{type:'ra',count:5,questionIds:['ra-1']},{type:'sgd',count:20}])assert.throws(()=>random.options(bad));
  assert.equal(JSON.stringify(require('../content/speaking-mocks').papers),original);
});
test('speaking practice freezes a random selection, keeps native scores and includes deliberate skips',async t=>{
  const f=await fixture(t),id=crypto.randomUUID(),config={type:'rs',count:5};
  let reply=await f.request('/api/speaking-mocks/attempts',{id,practiceSet:config});assert.equal(reply.status,200);assert.equal(reply.body.questionCount,5);assert.equal(reply.body.practiceSet.type,'rs');assert.equal(reply.body.question.reference,undefined);
  const before=await f.speaking.store.get('alice',id);reply=await f.request('/api/speaking-mocks/attempts',{id,practiceSet:config});assert.equal(reply.status,200);assert.deepEqual((await f.speaking.store.get('alice',id)).questions,before.questions);
  assert.equal((await f.request('/api/speaking-mocks/attempts',{id,practiceSet:{type:'ra',count:5}})).status,409);
  await f.speaking.store.update('alice',id,a=>{a.status='submitted';a.index=5;a.grading={status:'complete'};a.responses=a.questions.map(()=>({skipped:true}));a.responses[0]={recording:{hash:'saved',mime:'audio/webm',data:Buffer.alloc(150).toString('base64')},transcript:a.questions[0].text,content:{scoringMode:'ai',total:3,maximum:3},azure:{status:'assessed',recordingHash:'saved',pronunciation:{score:5},fluency:{score:5}}};return a;});
  reply=await f.request('/api/speaking-mocks/attempts/'+id);assert.equal(reply.body.speakingReport.azure.overallScore,26);assert.equal(reply.body.speakingReport.azure.unansweredCount,4);assert.equal(reply.body.responses.length,5);assert.equal(reply.body.responses[1].content.total,0);
  const retake=await f.request('/api/speaking-mocks/attempts/'+id+'/reattempt',{id:crypto.randomUUID()});assert.equal(retake.status,200);assert.equal(retake.body.practiceSet.count,5);assert.equal(retake.body.reattemptOf,id);assert(retake.body.deadline-retake.body.startedAt<40*60000);assert.deepEqual((await f.speaking.store.get('alice',id)).questions,before.questions);
  const history=await f.request('/api/practice-sets/attempts');assert(history.body.some(a=>a.id===id&&a.score90===26&&a.ready));assert.deepEqual((await f.request('/api/practice-sets/attempts',undefined,'bob')).body,[]);assert.equal((await f.request('/api/speaking-mocks/attempts/'+id,undefined,'bob')).status,404);
});
test('all selected speaking prompts, including pool-only questions, serve their actual saved media',async t=>{
  const f=await fixture(t),mocks=require('../content/speaking-mocks'),old=new Set(mocks.audioQuestions.map(q=>q.id));
  for(const type of ['rs','rl','sgd','rts']){
    const q=random.pools()[type].find(q=>!old.has(q.id))||random.pools()[type][0],shown=mocks.publicQuestion(q),response=await fetch(f.base+shown.audioUrl);assert.equal(response.status,200,q.id);assert((await response.arrayBuffer()).byteLength>100);
  }
});
test('dictation practice uses native word accuracy, preserves every answer and appears in saved sets',async t=>{
  const f=await fixture(t),id=crypto.randomUUID(),config={type:'wfd',count:5};let reply=await f.request('/api/writing-lab/attempts',{id,practiceSet:config});
  assert.equal(reply.status,200);assert.equal(reply.body.questions.length,5);assert.equal(reply.body.practiceSet.type,'wfd');assert.equal(reply.body.questions[0].text,'');assert.equal(reply.body.questions[1].audioUrl,undefined);
  const original=await f.writing.store.get('alice',id);assert(original.questions.every(q=>q.type==='wfd'));assert.equal(new Set(original.questions.map(q=>q.id)).size,5);
  await f.request('/api/writing-lab/attempts',{id,practiceSet:config});assert.deepEqual((await f.writing.store.get('alice',id)).questions,original.questions);
  for(let index=0;index<5;index++){reply=await f.request('/api/writing-lab/attempts/'+id+'/answer',{index,text:original.questions[index].text,revision:1,next:true});assert.equal(reply.status,200);}
  await f.writing.waitForJobs();reply=await f.request('/api/writing-lab/attempts/'+id);assert.equal(reply.body.status,'submitted');assert.equal(reply.body.report.score90,90);assert.equal(reply.body.results.length,5);assert(reply.body.results.every(q=>q.total===q.maximum));assert.equal(f.modelCalls(),0);
  const history=await f.request('/api/practice-sets/attempts');assert.equal(history.body.find(a=>a.id===id).score90,90);assert.deepEqual((await f.request('/api/practice-sets/attempts',undefined,'bob')).body,[]);
});
test('new catalogue/history require authentication, respect speaking access and do not accept question picks',async t=>{
  const f=await fixture(t,{canSpeak:false});assert.equal((await f.request('/api/practice-sets/catalog',undefined,null)).status,401);assert.deepEqual((await f.request('/api/practice-sets/catalog')).body.types.map(t=>t.type),['wfd']);
  for(const config of [{type:['ra','rs'],count:5},{type:'wfd',count:5,questionIds:['wfd-practice-01']},{type:'wfd',count:6}])assert.equal((await f.request('/api/writing-lab/attempts',{id:crypto.randomUUID(),practiceSet:config})).status,400);
  assert.equal((await f.request('/api/speaking-mocks/attempts',{id:crypto.randomUUID(),practiceSet:{type:'wfd',count:5}})).status,400);
  assert.equal((await f.request('/api/writing-lab/attempts',{id:crypto.randomUUID(),practiceSet:{type:'ra',count:5}})).status,400);
});

test('twenty-question and longer discussion sets use their actual count and complete prompt windows',async t=>{
 const f=await fixture(t);const id=crypto.randomUUID(),reply=await f.request('/api/speaking-mocks/attempts',{id,practiceSet:{type:'ra',count:20}});assert.equal(reply.status,200);assert.equal(reply.body.questionCount,20);assert.equal(reply.body.totalItems,20);const saved=await f.speaking.store.get('alice',id);assert(saved.questions.every(q=>q.type==='ra'));assert.equal(saved.questions.length,20);
 const discussion=random.make({type:'sgd',count:15});assert(discussion.minutes>40);assert.equal(discussion.questions.length,15);
});
test('production-style progressive reports publish a completed single-task set with explicit skips',async t=>{
 const f=await fixture(t,{progressive:true}),id=crypto.randomUUID();assert.equal((await f.request('/api/speaking-mocks/attempts',{id,practiceSet:{type:'ra',count:5}})).status,200);
 await f.speaking.store.update('alice',id,a=>{a.status='submitted';a.index=5;a.responses=a.questions.map(()=>({skipped:true}));a.assessment={status:'ready',omissions:require('../speaking-mock-completion').omissions(a,Date.now())};a.grading={status:'complete'};return a;});
 const response=await f.request('/api/speaking-mocks/attempts/'+id);assert.equal(response.body.resultsReady,true);assert.equal(response.body.speakingReport.azure.overallScore,10);assert.equal(response.body.speakingReport.azure.unansweredCount,5);assert.equal(response.body.responses.length,5);
});
