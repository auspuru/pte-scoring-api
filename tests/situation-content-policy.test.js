'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const scoring = require('../speaking-scoring');
const policy = require('../situation-content-policy');
const bank = require('../content/speaking-bank');
const {installSpeakingLab} = require('../speaking-lab');
const delivery = require('../speaking-delivery');

const alternatives = [
  ['rts-1', "I don't understand your feedback. Could you explain what I need to change? We could talk after class."],
  ['rts-2', "Sorry, my shift changed and I can't come today. Could we meet tomorrow instead?"],
  ['rts-3', "Hey, it's loud in the kitchen and I need to sleep. Could you keep it down at night?"],
  ['rts-4', "I bought these headphones three days ago and one side doesn't work. Could I get a refund?"],
  ['rts-5', "The projector in our booked room won't turn on. We need to practise our presentation. Could someone fix it?"]
];

function review(text, {total=6,level='effective',materialProblem=false,evidence=text}={}) {
  return {total,overview:'Your message is clear and the recipient can understand what you need.',
    strengths:['You communicate a relevant request clearly.'],improvements:[],
    communicationAssessment:{level,materialProblem,evidence,reason:'The relevant purpose is communicated understandably without needing sample ideas.'}};
}

for(const [id,text] of alternatives){
  const question=bank.questions.find(q=>q.id===id);
  test(`${id}: a basic response with alternative wording or ideas can receive 6 in one request`, async()=>{
    let calls=0;
    const result=await scoring.grade(question,text,async prompt=>{
      calls++;
      const data=JSON.parse(prompt.split('DATA=')[1]);
      assert.deepEqual(data,{type:'rts',prompt:question.text,student:text});
      assert.equal(data.sample,undefined);
      assert.equal(data.facts,undefined);
      return review(text);
    });
    assert.equal(calls,1);
    assert.equal(result.total,6);
    assert.equal(result.scoringMode,'ai');
    assert.equal(result.contentPolicyVersion,policy.VERSION);
    assert.equal(result.communicationAssessment.level,'effective');
    assert.equal(result.coverage,undefined,'RTS must not render missing sample ideas as a checklist.');
    assert.equal(result.pronunciation,null);
    assert.equal(result.fluency,null);
  });
}

test('Minor slips, indirect requests and omitted optional niceties do not block effective communication',()=>{
  const question=bank.questions.find(q=>q.id==='rts-3');
  for(const text of [
    'The kitchen is very noisy and I has an early class. Can you talk quieter tonight?',
    "I'm struggling to sleep with the kitchen noise. It would really help if it were quieter at night.",
    'Please keep the kitchen quiet tonight. I need to sleep.'
  ])assert.equal(scoring.normalize(question,text,review(text)).total,6);
});

test('A functional response with an actual ambiguity about the requested action still receives a good mark',()=>{
  const question=bank.questions.find(q=>q.id==='rts-2');
  const text="I can't come to our meeting. Please change the time, but don't change when we meet.";
  const raw=review(text,{total:5,level:'mostly_effective'});
  raw.communicationAssessment.reason='The group understands the attendance problem, but needs clarification of the contradictory scheduling request.';
  assert.equal(scoring.normalize(question,text,raw).total,5);
});

test('A contextually clear problem statement and a request without a proposed solution can earn full marks',()=>{
  for(const [id,text] of [
    ['rts-4','These headphones stopped working.'],
    ['rts-2',"I can't come to our meeting. Could we arrange another time?"]
  ])assert.equal(scoring.normalize(bank.questions.find(q=>q.id===id),text,review(text)).total,6);
});

test('Missing or inaccurate reference-checklist classifications do not override a valid functional judgment',()=>{
  const question=bank.questions.find(q=>q.id==='rts-4');
  const text=alternatives[3][1],raw=review(text);
  raw.coverage=question.facts.map((_,point)=>({point,status:'missing',evidence:'',feedback:'No sample wording.'}));
  assert.equal(scoring.normalize(question,text,raw).total,6);
  raw.coverage[0]={point:0,status:'inaccurate',evidence:text,feedback:'The student requests a refund instead of the sample replacement.'};
  const result=scoring.normalize(question,text,raw);
  assert.equal(result.total,6);
  assert.equal(result.coverage,undefined);
});

test('A basic functional response cannot be assigned 3 merely for lacking development',async()=>{
  const question=bank.questions.find(q=>q.id==='rts-5'),text=alternatives[4][1];
  let calls=0;
  const result=await scoring.grade(question,text,async prompt=>{
    calls++;
    if(calls===1)return review(text,{total:3});
    assert.match(prompt,/RETRY NOTE/);
    assert.match(prompt,/Basic, relevant and understandable communication deserves 5–6/);
    assert.doesNotMatch(prompt,/Include every supplied fact|no inaccurate facts/);
    return review(text);
  });
  assert.equal(result.total,6);
  assert.equal(calls,2);
});

test('Partial, generic, fragmented and off-topic communication remains below the good-score range',()=>{
  const question=bank.questions.find(q=>q.id==='rts-4');
  for(const [text,total,level] of [
    ['These headphones broke. Could you repair my laptop instead?',4,'partial'],
    ['Headphones broken, receipt.',2,'limited'],
    ['Hello, please help me.',1,'limited'],
    ['The chart shows three countries.',0,'none']
  ]){
    const raw=review(text,{total,level});
    assert.equal(scoring.normalize(question,text,raw).total,total);
    assert.throws(()=>scoring.normalize(question,text,{...raw,total:6}),/score contradicts/);
  }
});

test('Material communication barriers cannot receive 5 or 6',()=>{
  const question=bank.questions.find(q=>q.id==='rts-2'),text="I can come to the meeting. Don't change it.";
  for(const [total,level] of [[6,'effective'],[5,'mostly_effective']]){
    assert.throws(()=>scoring.normalize(question,text,review(text,{total,level,materialProblem:true})),/score contradicts/);
  }
});

test('Missing semantic judgments, invalid levels and invented quotations fail visibly',()=>{
  const question=bank.questions.find(q=>q.id==='rts-1'),text=alternatives[0][1];
  const missing=review(text);delete missing.communicationAssessment;
  assert.throws(()=>scoring.normalize(question,text,missing),/Incomplete functional-communication/);
  const invalid=review(text);invalid.communicationAssessment.level='matches_sample';
  assert.throws(()=>scoring.normalize(question,text,invalid),/Incomplete functional-communication/);
  assert.throws(()=>scoring.normalize(question,text,review(text,{evidence:'Words the student never said.'})),/Unsupported assessment evidence/);
});

test('Provider failures and repeated contradictory judgments never manufacture good scores',async()=>{
  const question=bank.questions.find(q=>q.id==='rts-1'),text=alternatives[0][1];
  for(const provider of [async()=>{throw Error('offline');},async()=>review(text,{total:3})]){
    let calls=0;
    const result=await scoring.grade(question,text,async()=>{calls++;return provider();});
    assert.equal(calls,2);
    assert.equal(result.total,null);
    assert.equal(result.contentStatus,'unavailable');
  }
});

test('The RTS prompt rewards functional communication and excludes the rigid development rule',()=>{
  const question=bank.questions.find(q=>q.id==='rts-1');
  const prompt=scoring.prompt(question,alternatives[0][1]);
  assert.match(prompt,/GOOD score \(5–6\)/);
  assert.match(prompt,/no single preferred solution or fixed idea list/);
  assert.match(prompt,/short direct request or a clear conventional indirect request/);
  assert.match(prompt,/Do not return coverage/);
  assert.doesNotMatch(prompt,/3=basic functional response|6=fully achieves communication goal|Include one coverage item/);
  for(const type of ['rl','sgd','di','ra','rs'])assert.equal(policy.prompt({type}),'');
});

test('Saved RTS assessments retain the new judgment and audio scores without duplicate requests',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'rts-communication-')),app=require('express')();
  app.use(require('express').json());
  let contentCalls=0,audioCalls=0,transcriptionCalls=0;
  installSpeakingLab(app,{directory,verifyToken:token=>token==='student'?'student':null,getAccount:async()=>({}),
    transcriptionAvailable:true,deliveryAssessmentAvailable:true,
    transcribe:async recording=>{transcriptionCalls++;return alternatives[Buffer.from(recording.data,'base64')[0]-1][1];},
    callModel:async prompt=>{contentCalls++;return review(JSON.parse(prompt.split('DATA=')[1]).student);},
    assessDelivery:async()=>{audioCalls++;return {deliveryVersion:delivery.VERSION,pronunciation:{score:4,maximum:5},fluency:{score:4,maximum:5}};}
  });
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port+'/api/speaking';
  async function request(route,body,raw=false){
    const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'x-session-token':'student','Content-Type':raw?'audio/webm':'application/json'},body:body===undefined?undefined:raw?body:JSON.stringify(body)});
    assert.equal(response.status,200);return response.json();
  }
  for(let i=0;i<alternatives.length;i++){
    const [questionId,text]=alternatives[i],id=crypto.randomUUID();
    await request('/attempts',{id,questionId});await request('/attempts/'+id+'/recording',Buffer.alloc(200,i+1),true);
    const result=await request('/attempts/'+id+'/submit',{});
    assert.equal(result.transcript,text);assert.equal(result.result.total,6);assert.equal(result.result.coverage,undefined);
    assert.equal(result.result.communicationAssessment.level,'effective');assert.equal(result.result.pronunciation.score,4);
    const cached=await request('/attempts/'+id+'/submit',{});
    assert.deepEqual(cached.result,result.result);
    assert.equal(contentCalls,i+1);assert.equal(audioCalls,i+1);assert.equal(transcriptionCalls,i+1);
  }
});
