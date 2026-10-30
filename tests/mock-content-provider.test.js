'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const provider=require('../mock-content-provider');
const {createMockContentAssessment}=require('../mock-content-assessment');
const speaking=require('../speaking-judge-format');
const completed=(name,data)=>({status:'completed',output:[{type:'reasoning',summary:[]},
  {type:'function_call',name,status:'completed',arguments:JSON.stringify(data)}]});
const message=data=>({status:'completed',output:[{type:'message',status:'completed',content:[{type:'output_text',text:JSON.stringify(data)}]}]});
const q={type:'rts',text:'Your purchased book has missing pages. What would you say?',facts:[]};
const text='Some pages are missing. Could I have a refund please?';

test('Mock content contracts use Sol 6.1 Responses without unsupported sampling, while preserving rubrics and system instructions',()=>{
  const paper=require('../full-mock/paper').loadPaper();
  const originals=['di','rl','sgd','rts'].map(type=>{
    const question=paper.questions.find(item=>item.question.type===type).question;
    return speaking.request('Assess the response.','old-model',{question,transcript:text,
      ...(type==='di'?{contentPolicy:require('../describe-image-academy').VERSION}:{})});
  });
  originals.push(require('../swt-judge-format').request('Assess this summary.','old-model'));
  originals.push(require('../writing-mock-overall').request({questions:[{type:'swt',text:'Source'}],answers:['A response.']},'old-model'));
  for(const original of originals){
    const before=structuredClone(original),request=provider.request(original);
    assert.equal(request.model,'gpt-6.1-sol');assert.equal(request.store,false);
    assert.deepEqual(request.reasoning,{effort:'medium'});assert.equal(request.temperature,undefined);
    assert.equal(request.max_tokens,undefined);assert.equal(request.parallel_tool_calls,false);
    assert.equal(request.tools[0].strict,true);assert.equal(request.tool_choice.name,original.tools[0].name);
    assert.deepEqual(request.input,original.messages);assert.equal(request.instructions,original.system);
    function check(schema){
      if(!schema||typeof schema!=='object')return;
      if(schema.type==='object'){assert.equal(schema.additionalProperties,false);assert.deepEqual(new Set(schema.required),new Set(Object.keys(schema.properties)));}
      assert.equal(schema.uniqueItems,undefined);if(schema.$ref)assert.equal(Object.keys(schema).length,1);
      Object.values(schema).forEach(value=>Array.isArray(value)?value.forEach(check):check(value));
    }
    check(request.tools[0].parameters);assert.deepEqual(original,before);
  }
});

test('A GPT situation assessment still restores exact evidence and passes the existing communication validator',async()=>{
  let calls=0;const logs=[];
  const service=createMockContentAssessment({apiKey:'test-secret',onAssessment:value=>logs.push(value),fetch:async(url,options)=>{
    calls++;assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.headers.Authorization,'Bearer test-secret');
    const body=JSON.parse(options.body);assert.equal(body.model,'gpt-6.1-sol');assert(!options.body.includes('test-secret'));
    return {ok:true,json:async()=>completed(body.tool_choice.name,{total:6,overview:'The problem and requested action are clear.',strengths:['A clear request.'],improvements:[],
      communicationAssessment:{level:'effective',materialProblem:false,evidence_span:[1,10],reason:'The request is understandable and relevant.'}})};
  }});
  const result=await require('../speaking-scoring').grade(q,text,service.speaking);
  assert.equal(result.total,6);assert.equal(result.contentStatus,'assessed');assert.equal(calls,1);
  assert.equal(result.communicationAssessment.evidence,text);assert.equal(result.pronunciation,null);assert.equal(result.fluency,null);
  assert.equal(logs[0].model,'gpt-6.1-sol');assert.equal(logs[0].task,'rts');assert(!JSON.stringify(logs).includes(text));
});

test('SST JSON is complete and uses the selected model independently of legacy provider settings',async()=>{
  const service=createMockContentAssessment({apiKey:'test',env:{ESSAY_SCORING_PROVIDER:'anthropic',ESSAY_OPENAI_MODEL:'old-model'},fetch:async(url,options)=>{
    const body=JSON.parse(options.body);assert.equal(body.model,'gpt-6.1-sol');assert.deepEqual(body.text.format,{type:'json_object'});
    return {ok:true,json:async()=>message({content:4,explanation:'The main ideas are connected.'})};
  }});
  assert.deepEqual(await service.writing('Assess the SST and return JSON.'),{content:4,explanation:'The main ideas are connected.'});
});

test('Partial, refused, wrong-tool, duplicate and malformed outputs cannot become content grades',()=>{
  const original=speaking.request('Assess.','old',{question:q,transcript:text});
  const valid=completed(speaking.NAME,{});
  const rejected=[{status:'incomplete',output:[]},{status:'failed',output:[]},completed('wrong',{}),completed(speaking.NAME,[]),
    {...valid,output:[...valid.output,...valid.output]},
    {status:'completed',output:[{type:'function_call',name:speaking.NAME,status:'completed',arguments:'bad JSON'}]},
    {status:'completed',output:[{type:'message',status:'completed',content:[{type:'refusal',refusal:'Unable'}]}]}];
  for(const value of rejected)assert.throws(()=>provider.response(value,original),/could not finish/);
  assert.throws(()=>provider.response(completed('unexpected',{}),{messages:[]}),/could not finish/);
  assert.throws(()=>provider.response(message([]),{messages:[]}),/could not finish/);
});

test('Content transport failures stay secret-safe and never invoke another provider; cancellation reaches the request',async()=>{
  for(const status of [400,401,403,404,429,500]){
    let calls=0,cancelled=0;
    const transport=provider.createProvider({apiKey:'test-secret',fetch:async()=>{calls++;return {ok:false,status,body:{cancel:async()=>cancelled++},json:()=>{throw Error('Must not read provider error body');}};}});
    await assert.rejects(transport.call({messages:[{role:'user',content:'Private sample'}]}),error=>{
      assert.equal(error.code,'MOCK_CONTENT_HTTP');assert.equal(error.status,status);assert(!error.message.includes('test-secret'));return true;
    });assert.equal(calls,1);assert.equal(cancelled,1);
  }
  const controller=new AbortController();controller.abort(Error('Cancelled'));
  const transport=provider.createProvider({apiKey:'test',fetch:async(url,options)=>{assert(options.signal.aborted);throw options.signal.reason;}});
  await assert.rejects(transport.call({messages:[]},{signal:controller.signal}),/Cancelled/);
  await assert.rejects(provider.createProvider({apiKey:''}).call({messages:[]}),{code:'MOCK_CONTENT_UNAVAILABLE'});
});
