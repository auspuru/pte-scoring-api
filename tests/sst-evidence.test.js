'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const policy=require('../writing-lab-scoring'),report=require('../public/writing-lab-report');
const {installWritingLab}=require('../writing-lab');
const express=require('express'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const q={id:'evidence-sst',type:'sst',title:'Urban trees',minutes:10,
  text:'Urban trees reduce heat. Shade protects residents during hot weather.',
  keyPoints:['Urban trees reduce heat','Shade protects residents'],sample:''};
const response='Trees cool cities. '+Array(55).fill('practice').join(' ')+'.';
function raw(){return {scores:{content:3,form:2,grammar:2,vocabulary:2,spelling:2},formInvalid:false,formReason:'',
  feedback:{content:'The cooling benefit is captured, but protection from shade is missing.',form:'Valid.',grammar:'Clear.',vocabulary:'Appropriate.',spelling:'Correct.'},
  strengths:['Meaning-preserving paraphrase.'],improvements:['Include how shade protects residents.'],errors:[],coverage:[
    {point:q.keyPoints[0],status:'captured',evidence:'Trees cool cities.',transcriptEvidence:'Urban trees reduce heat.',feedback:'The paraphrase preserves the cooling benefit.'},
    {point:q.keyPoints[1],status:'missing',evidence:'',transcriptEvidence:'Shade protects residents during hot weather.',feedback:'Protection through shade is not included.'}
  ]};}
test('SST semantic coverage accepts paraphrases without changing the existing trait scores',()=>{
  const r=policy.normalize(q,response,raw());assert.equal(r.total,11);assert.equal(r.coverage[0].status,'captured');
  const html=report.sstReview(q,response,r);assert.match(html,/sst-evidence-captured/);assert.match(html,/sst-evidence-missing/);
  assert.match(html,/Replay the part about/);assert.match(html,/Lecture transcript/);assert.match(html,/Your summary/);
});
test('SST evidence rejects fabricated source/student quotations and duplicate ideas',()=>{
  const r=raw();r.coverage[0].evidence='Invented quotation';assert.throws(()=>policy.normalize(q,response,r),/Invalid SST coverage/);
  r.coverage[0].evidence='Trees cool cities.';r.coverage[1].transcriptEvidence='Not in lecture';assert.throws(()=>policy.normalize(q,response,r),/Invalid SST coverage/);
  r.coverage[1]={...r.coverage[0]};assert.throws(()=>policy.normalize(q,response,r),/Incomplete SST coverage/);
});
test('Saved/fallback SST results never fabricate highlights, and a provisional result propagates to the mock report',()=>{
  const r={...policy.normalize(q,response,raw()),scoringMode:'local'};
  const html=report.sstReview(q,response,r);assert.doesNotMatch(html,/<mark/);assert.match(html,/No verified idea-by-idea review/);
  assert.equal(report.summarize([q],[r]).provisional,true);assert.equal(report.summarize([q],[r]).byType[0].provisional,true);
  const unsafe={...q,text:'<script>alert(1)</script>'};assert.doesNotMatch(report.sstReview(unsafe,response,{}),/<script>/);
});
test('SST retry retains saved answers and fallback on failure, then replaces only the provisional assessment',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sst-retry-')),app=express();app.use(express.json());let online=false,calls=0;
  const {store}=installWritingLab(app,{directory,verifyToken:token=>token==='alice'?'alice':null,getAccount:async()=>({}),callModel:async()=>{calls++;if(!online)throw Error('Unavailable');return raw();}});
  const id=randomUUID(),old=policy.localGrade(q,response);
  await store.update('alice',id,()=>({id,status:'submitted',index:1,questions:[q],answers:[response],completed:[{reason:'Submitted'}],results:[old],startedAt:Date.now(),kind:'sst'}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
  const url='http://127.0.0.1:'+server.address().port+'/api/writing-lab/attempts/'+id+'/score/0',options={method:'POST',headers:{'Content-Type':'application/json','x-session-token':'alice'},body:JSON.stringify({retry:true})};
  let res=await fetch(url,options);assert.equal(res.status,200);assert.equal((await res.json()).scoringMode,'local');
  assert.equal((await store.update('alice',id,value=>value)).answers[0],response);online=true;
  res=await fetch(url,options);const updated=await res.json();assert.equal(res.status,200);assert.equal(updated.scoringMode,undefined);assert.equal(updated.coverage.length,2);
  const count=calls;await fetch(url,options);assert.equal(calls,count,'Confirmed AI results are idempotent and cannot be repeatedly overwritten');
  assert.equal((await store.update('alice',id,value=>value)).answers[0],response);
});
