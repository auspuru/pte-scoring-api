'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const feedback=require('../describe-image-feedback'),scoring=require('../speaking-scoring');
const bank=require('../content/speaking-bank'),{installSpeakingLab}=require('../speaking-lab'),delivery=require('../speaking-delivery');
const graph={type:'di',title:'Campus cycling',imageCategory:'line',visual:{kind:'line',labels:['2020','2024'],values:[20,80]},facts:['Cycling rose from 20 trips in 2020 to 80 trips in 2024.']};
const text='Cycling rose from 20 trips in 2020 to 80 trips in 2024.';
function coaching(words=text){return {priority:'none',strength:{quote:words,why:'You link the beginning and end to a clear rise.'},changes:[],revisedResponse:words,rewriteFactIndices:[0],tip:'Keep the overall trend clear.',nextTry:'Describe another graph by linking its beginning and end.'};}
function result(q,words){return {total:6,overview:'The main picture is clear.',strengths:['Accurate key features.'],improvements:[],coverage:q.facts.map((_,point)=>({point,status:'covered',evidence:words.slice(0,120),feedback:'The key feature is represented.'})),coaching:coaching(words)};}

test('DI coaching shares one content request; other speaking tasks keep their existing contract',async()=>{
 let calls=0;
 const r=await scoring.grade(graph,text,async prompt=>{calls++;assert.match(prompt,/DESCRIBE IMAGE COACHING/);assert.match(prompt,/immediate explicit self-correction/);assert.match(prompt,/concluding sentence is optional/);return result(graph,text);});
 assert.equal(calls,1);assert.equal(r.total,6);assert.equal(r.coaching.version,feedback.VERSION);assert.equal(r.coaching.ready,true);assert.deepEqual(r.coaching.changes,[]);
 assert.doesNotMatch(scoring.prompt({type:'rl',facts:graph.facts,text:'Lecture'},text),/DESCRIBE IMAGE COACHING/);
});

test('Invalid coaching does not discard valid scores or trigger another paid review',async()=>{
 for(const alter of [c=>{c.strength.quote='Invented learner words';},c=>{c.revisedResponse='Cycling reached 999 trips.';},c=>{c.rewriteFactIndices=[50];},c=>{c.nextTry='You must include every intermediate value.';},c=>{c.strength=null;},c=>{c.revisedResponse='cycling '.repeat(101);c.changes=[{quote:text,rewrite:text,why:'Connect the trend.',factIndices:[0]}];}]){
  let calls=0;const raw=result(graph,text);alter(raw.coaching);
  const r=await scoring.grade(graph,text,async()=>{calls++;return raw;});
  assert.equal(calls,1);assert.equal(r.total,6);assert.equal(r.scoringMode,'ai');assert.equal(r.coaching,undefined);assert.equal(r.coachingStatus,'unavailable');
 }
});

test('Specific image corrections retain the exact original quote and supported replacement',()=>{
 const words='Cycling fell from 20 trips in 2020 to 80 trips in 2024.',data={...coaching(),priority:'accuracy',strength:null,changes:[{quote:words,rewrite:text,why:'The final value is higher, so describe a rise.',factIndices:[0]}]};
 const r=feedback.normalize(graph,words,data,[{status:'inaccurate',evidence:words,feedback:'The direction is reversed.'}]);
 assert.equal(r.ready,false);assert.equal(r.priority,'accuracy');assert.equal(r.changes[0].quote,words);assert.equal(r.changes[0].rewrite,text);
 assert.throws(()=>feedback.normalize(graph,words,{...data,changes:[]},[]));
});

test('Saved DI feedback refresh preserves marks, recording and transcript and does not repeat audio or cached reviews',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'di-feedback-')),app=require('express')();app.use(require('express').json());
 let calls=0,valid=true;
 const q=bank.questions.find(q=>q.type==='di'&&!q.predictionSource),id=crypto.randomUUID();
 const {store}=installSpeakingLab(app,{directory,verifyToken:token=>['alice','bob'].includes(token)?token:null,getAccount:async()=>({}),deliveryAssessmentAvailable:true,
   transcribe:async()=>{throw Error('Feedback refresh must not transcribe');},assessDelivery:async()=>{throw Error('Feedback refresh must not assess audio');},
   callModel:async()=>{calls++;const r=result(q,q.sample);if(!valid)r.coaching.strength.quote='not in this recording';return r;}});
 const audio={mime:'audio/webm',data:Buffer.alloc(200,3).toString('base64')};
 const previous={scoringMode:'ai',total:4,maximum:6,overview:'Saved content result.',strengths:[],improvements:[],coverage:[],pronunciation:{score:4,maximum:5},fluency:{score:3,maximum:5},deliveryVersion:delivery.VERSION};
 await store.update('alice',id,()=>({id,questionId:q.id,status:'submitted',startedAt:1,transcript:q.sample,revision:1,recording:audio,result:previous}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
 const url='http://127.0.0.1:'+server.address().port+'/api/speaking/attempts/'+id+'/submit';
 async function request(body,user='alice'){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-session-token':user},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
 await request({});assert.equal(calls,0,'Opening/re-submitting an assessed answer must not buy coaching implicitly');
 const denied=await request({refreshDescribeFeedback:true},'bob');assert.equal(denied.status,404);assert.equal(calls,0);
 valid=false;let response=await request({refreshDescribeFeedback:true});assert.equal(calls,1);assert.equal(response.body.result.total,4);assert.equal(response.body.result.coachingStatus,'unavailable');
 valid=true;response=await request({refreshDescribeFeedback:true});assert.equal(calls,2);assert.equal(response.body.result.coachingStatus,'assessed');assert.equal(response.body.result.coaching.version,feedback.VERSION);
 for(const key of ['total','maximum','pronunciation','fluency','deliveryVersion'])assert.deepEqual(response.body.result[key],previous[key]);
 const saved=await store.update('alice',id,a=>a);assert.deepEqual(saved.recording,audio);assert.equal(saved.transcript,q.sample);assert.equal(saved.revision,1);
 await request({refreshDescribeFeedback:true});assert.equal(calls,2,'The current saved coaching is reused');
});
