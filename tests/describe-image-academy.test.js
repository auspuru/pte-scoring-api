'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const academy=require('../describe-image-academy'),format=require('../speaking-judge-format'),scoring=require('../speaking-scoring');
const q={id:'mock-di',type:'di',title:'Campus travel',imageCategory:'line',facts:[
  'Trips rose from 200 to 450, with a brief fall in 2021.',
  'The final count was more than twice the initial count.'
],optionalFactIndices:[1]};
const text='The image shows trips rising from 200 to 450, despite a brief fall.';
function wire(score=6){return {judgment:{score,relevance:'image-specific',accuracy:'accurate',
  scoreImpact:score===6?null:{kind:'relationship',quote:text,factIndices:[0],
    observation:'The comparison is fragmented and its main relationship is unclear.',impact:'The listener cannot connect the exception to the overall trend.'},
  requiredEvidence:{quote:'trips rising from 200 to 450',factIndices:[0],kind:'relationship'},otherEvidence:[]},
  reason:score===6?'The main trend and exception form a clear picture.':'The exception is disconnected from the main trend.',
  nextStep:score===6?'Keep the connected trend and exception.':'Connect the exception to the overall rise.'};}
const envelope=raw=>({stop_reason:'tool_use',content:[{type:'tool_use',name:academy.NAME,input:raw}]});

test('Full mock DI uses the Academy rubric, exact quote schema and one content judgment',async()=>{
  let calls=0;
  const result=await scoring.grade(q,text,async(prompt,context)=>{
    calls++;assert.equal(context.contentPolicy,academy.VERSION);
    assert.match(prompt,/Separate score-impacting gaps from optional improvements/);
    assert.match(prompt,/immediate explicit self-correction/);
    assert.match(prompt,/A formal concluding sentence is optional/);
    const request=format.request(prompt,'test-model',context),schema=request.tools[0].input_schema;
    assert.equal(request.tools[0].strict,true);assert.equal(request.tool_choice.name,academy.NAME);
    assert(schema.$defs.learnerQuote.enum.every(quote=>text.includes(quote)));
    assert.deepEqual(schema.$defs.factIndex.enum,[0,1]);
    assert.deepEqual(schema.properties.judgment.properties.score.enum,[0,1,2,3,4,5,6,null]);
    assert.equal(schema.properties.coverage,undefined,'The holistic mark does not count every bank fact.');
    return format.response(envelope(wire()),context);
  },{academyDescribeImage:true});
  assert.equal(calls,1);assert.equal(result.total,6);assert.equal(result.maximum,6);
  assert.equal(result.contentPolicyVersion,academy.VERSION);assert.equal(result.academyPolicyVersion,'meaning-first-40s-v5');
  assert.equal(result.academyAssessment.scoreImpact,null);assert.equal(result.contentStatus,'assessed');
  assert.equal(result.academyAssessment.evidence[0].quote,'trips rising from 200 to 450');
});

test('Every full-mock DI request fits the Claude strict-schema subset without changing the Academy validator',()=>{
  const forbidden=['maxItems','minimum','maximum','minLength','maxLength','uniqueItems','oneOf'];
  for(const question of require('../content/speaking-mocks').papers.flatMap(p=>p.questions.filter(q=>q.type==='di'))){
    const words=question.sample||text,request=academy.request('test-model',{question,transcript:words});let unions=0;
    function inspect(value){
      if(!value||typeof value!=='object')return;
      for(const name of forbidden)assert.equal(Object.hasOwn(value,name),false,question.id+' unsupported '+name);
      if(value.minItems!==undefined)assert([0,1].includes(value.minItems));
      if(value.anyOf||Array.isArray(value.type))unions++;
      if(value.properties){assert.equal(value.additionalProperties,false);assert.deepEqual(value.required,Object.keys(value.properties));}
      for(const child of Object.values(value))if(child&&typeof child==='object')Array.isArray(child)?child.forEach(inspect):inspect(child);
    }
    inspect(request.tools[0].input_schema);assert(unions<=4,question.id+' has a bounded grammar');
    assert(request.tools[0].input_schema.$defs.learnerQuote.enum.every(quote=>words.includes(quote)));
    assert.equal(request.tools[0].strict,true);assert(request.max_tokens>=3200);
  }
});

test('The flat provider format restores nullable evidence and keeps unsupported high marks unavailable',async()=>{
  const raw=wire();raw.judgment.inaccuracy=null;
  assert.equal((await academy.grade(q,text,async()=>academy.response(envelope(raw)))).total,6);
  raw.judgment.requiredEvidence=null;
  assert.equal((await academy.grade(q,text,async()=>academy.response(envelope(raw)))).total,null);
  raw.judgment.requiredEvidence={quote:text,factIndices:[0],kind:'relationship'};
  raw.judgment.accuracy='major-errors';raw.judgment.inaccuracy={quote:'The image',factIndices:[0]};
  assert.equal((await academy.grade(q,text,async()=>academy.response(envelope(raw)))).total,null);
});

test('Provider failure diagnostics expose status and safe codes without request content or credentials',()=>{
  const error=Object.assign(Error('student transcript and secret-key must stay private'),{status:400,name:'BadRequestError',error:{message:'a private request body'}});
  assert.deepEqual(academy.diagnostic(error),{code:'provider_request',providerStatus:400,errorType:'BadRequestError'});
  assert.equal(academy.diagnostic({status:429}).code,'provider_rate_limit');
  assert.equal(academy.diagnostic({name:'APIConnectionTimeoutError'}).code,'provider_timeout');
  assert.equal(academy.diagnostic({contentValidationCode:'unsupported-deduction'}).code,'unsupported-deduction');
  assert.throws(()=>academy.response({stop_reason:'max_tokens'}),{code:'ACADEMY_TRUNCATED'});
});

test('Optional polish, fabricated errors and unsupported high marks are withheld without paid repairs',async()=>{
  for(const mutate of [
    raw=>{raw.judgment.scoreImpact.observation='The wording could improve slightly.';raw.judgment.scoreImpact.impact='Use smoother wording.';},
    raw=>{raw.judgment.requiredEvidence.quote='Invented learner words';},
    raw=>{raw.judgment.requiredEvidence.factIndices=[99];},
    raw=>{raw.judgment.requiredEvidence.kind='feature';},
    raw=>{raw.judgment.accuracy='major-errors';raw.judgment.inaccuracy={quote:text,factIndices:[0]};}
  ]){
    const raw=wire(5);mutate(raw);let calls=0;
    const result=await academy.grade(q,text,async()=>{calls++;return raw;});
    assert.equal(calls,1);assert.equal(result.total,null);assert.equal(result.contentStatus,'unavailable');
    assert.equal(result.needs_semantic_review,true);assert.equal(academy.needsReview(result),true);
  }
  let calls=0;const failed=await academy.grade(q,text,async()=>{calls++;throw Error('provider failed');});
  assert.equal(calls,1);assert.equal(failed.total,null);
});

test('A harmless minor slip can retain 6, a material error cannot, and source limitations abstain',async()=>{
  const minor=wire();minor.judgment.accuracy='minor-errors';minor.judgment.inaccuracy={quote:'The image',factIndices:[0]};
  let result=await academy.grade(q,text,async()=>minor);assert.equal(result.total,6);
  minor.judgment.accuracy='major-errors';result=await academy.grade(q,text,async()=>minor);assert.equal(result.total,null);
  const source={judgment:{score:null,scoreImpact:null,relevance:'source-limited',accuracy:'unverifiable',otherEvidence:[{quote:text,factIndices:[],kind:'generic'}]},
    reason:'The supplied reference cannot verify the central relationship.',nextStep:'Use an image with verified source facts.'};
  result=await academy.grade(q,text,async()=>source);assert.equal(result.total,null);assert.equal(result.contentStatus,'source-limited');
  const legacy={scoringMode:'ai',total:6};assert.equal(academy.needsReview(legacy),true);
  assert.equal(academy.needsReview(await academy.grade(q,text,async()=>wire())),false);
});

test('Zero-content gating changes displayed DI traits while preserving the saved provider evidence',async()=>{
  const result=await academy.grade(q,'',()=>{throw Error('Empty speech needs no model');});
  const provider={status:'assessed',pronunciation:{score:5,evidence:[{phrase:'original'}]},fluency:{score:4}};
  const gated=academy.deliveryForClient(result,provider);
  assert.equal(result.total,0);assert.equal(gated.pronunciation.score,null);assert.equal(gated.fluency.status,'unassessed');
  assert.equal(provider.pronunciation.score,5);assert.equal(provider.fluency.score,4);
  assert.equal(academy.deliveryForClient({total:0},provider),provider,'Other tasks retain their scoring contract.');
});

test('Saved mock retry refreshes only old DI content, then reuses it and both completed audio providers',async t=>{
  const express=require('express'),{installSpeakingMock}=require('../speaking-mock');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'academy-mock-')),app=express();app.use(express.json());
  let calls=0;
  const lab=installSpeakingMock(app,{directory,verifyToken:()=> 'alice',getAccount:async()=>({}),gptAvailable:true,azureAvailable:true,
    callModel:async(_,context)=>{calls++;assert.equal(context.contentPolicy,academy.VERSION);return wire();},
    transcribe:async()=>{throw Error('Do not retranscribe saved words');},
    assessGpt:async()=>{throw Error('Do not repeat GPT audio');},assessAzure:async()=>{throw Error('Do not repeat Azure audio');},
    assessOverall:async()=>{throw Error('Do not repeat whole-test audio');}});
  const id=crypto.randomUUID(),recording={hash:'saved',mime:'audio/webm',data:Buffer.alloc(200).toString('base64')};
  const provider={status:'assessed',pronunciation:{score:5},fluency:{score:5}},overall={status:'assessed',overallScore:85};
  const other={type:'ra',text:'Reference'},otherContent={scoringMode:'ai',total:1,maximum:1};
  await lab.store.update('alice',id,()=>({id,status:'submitted',startedAt:1,deadline:2,index:2,questionCount:2,
    questions:[q,other],responses:[{recording,transcript:text,content:{scoringMode:'ai',total:4},gpt:provider,azure:provider},
      {recording,transcript:'Reference',content:otherContent,gpt:provider,azure:provider}],overall,grading:{status:'complete'}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await lab.waitForJobs();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
  const url='http://127.0.0.1:'+server.address().port+'/api/speaking-mocks/attempts/'+id;
  await fetch(url);await lab.waitForJobs();assert.equal(calls,0,'Opening a finished mock does not buy a new assessment.');
  const retry=()=>fetch(url+'/retry',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  await retry();await lab.waitForJobs();let saved=await lab.store.update('alice',id,a=>a);
  assert.equal(calls,1);assert.equal(saved.responses[0].content.total,6);assert.equal(saved.responses[0].content.contentPolicyVersion,academy.VERSION);
  assert.deepEqual(saved.responses[1].content,otherContent);assert.deepEqual(saved.overall,overall);
  assert.deepEqual(saved.responses[0].recording,recording);assert.deepEqual(saved.responses[0].gpt,provider);assert.deepEqual(saved.responses[0].azure,provider);
  await retry();await lab.waitForJobs();assert.equal(calls,1);
});
