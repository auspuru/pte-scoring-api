'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const format=require('../essay-openai-format'),claude=require('../essay-judge-format');
const {createEssayProvider,configuration}=require('../essay-provider');
const stages=['assessment','subjective-review','subjective-resolver','evidence-repair','feedback-repair','support-audit','organisation-review'];
const completed=(data,stage='assessment')=>({status:'completed',output:[{type:'reasoning',summary:[]},{type:'function_call',name:'submit_essay_'+stage.replace(/-/g,'_'),status:'completed',arguments:JSON.stringify(data)}]});

test('OpenAI uses the same essay contracts with strict Responses tools, no storage or temperature',()=>{
  for(const stage of stages){
    const options={stage,feedbackV3:stage!=='support-audit',requirements:[{id:'req_1',label:'What is your opinion?'}],previousIssueIds:[]};
    const request=format.request('Assess this essay.',options,{}),tool=request.tools[0];
    assert.equal(request.model,'gpt-6.1-sol');assert.equal(request.store,false);assert.equal(request.temperature,undefined);
    assert.equal(request.reasoning.effort,'medium');assert.equal(request.parallel_tool_calls,false);assert.equal(tool.strict,true);
    assert.deepEqual(tool.parameters,claude.toolFor(stage,options).input_schema);
    assert.deepEqual(request.tool_choice,{type:'function',name:tool.name});
    function check(schema){if(!schema||typeof schema!=='object')return;if(schema.type==='object'){assert.equal(schema.additionalProperties,false);assert.deepEqual(Object.keys(schema.properties).sort(),[...schema.required].sort());}for(const value of Object.values(schema)){if(Array.isArray(value))value.forEach(check);else if(value&&typeof value==='object')check(value);}}
    check(tool.parameters);
    assert.deepEqual(format.response(completed({scores:{content:5}},stage),{stage}),{scores:{content:5}});
  }
  assert.equal(format.request('Assess.',{stage:'assessment'},{ESSAY_OPENAI_MODEL:'explicit-model',ESSAY_OPENAI_REASONING_EFFORT:'high'}).model,'explicit-model');
});

test('OpenAI rejects incomplete, refused, malformed and duplicate output rather than releasing a partial grade',()=>{
  assert.throws(()=>format.response({status:'incomplete',output:[]},{stage:'assessment'}),{code:'ESSAY_TRUNCATED'});
  for(const value of [{status:'failed',output:[]},{status:'completed',output:[]},completed([]),{...completed({}),output:[...completed({}).output,...completed({}).output]},
    {status:'completed',output:[{type:'function_call',name:'wrong',status:'completed',arguments:'{}'}]},
    {status:'completed',output:[{type:'function_call',name:'submit_essay_assessment',status:'completed',arguments:'bad JSON'}]}])
    assert.throws(()=>format.response(value,{stage:'assessment'}),{code:'ESSAY_OUTPUT_FORMAT'});
  assert.throws(()=>format.response({status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'Unable'}]}]}),{code:'ESSAY_OUTPUT_FORMAT'});
});

test('Final support reviews inline reference descriptions without changing the shared score schema',()=>{
  const options={stage:'subjective-resolver',feedbackV3:true,supportReview:true,requirements:[{id:'req_1',label:'What is your opinion?'}]};
  const original=claude.toolFor(options.stage,options).input_schema,before=structuredClone(original);
  const schema=format.request('Assess the essay.',options).tools[0].parameters;
  assert.equal(original.properties.scores.properties.coherence.$ref,'#/$defs/score6');
  assert.equal(schema.properties.scores.properties.coherence.type,'integer');
  assert.equal(schema.properties.scores.properties.coherence.$ref,undefined);
  assert.equal(schema.properties.scores.properties.coherence.description,original.properties.scores.properties.coherence.description);
  assert.deepEqual(schema.$defs,original.$defs);assert.deepEqual(original,before);
  const organisation=format.request('Review organisation.',{...options,stage:'organisation-review'}).tools[0].parameters;
  assert.equal(organisation.properties.promptCoverage,undefined);
});

test('Optional sample generation remains separate from scores',()=>{
  const request=format.request('Return only JSON for a sample.',{},{});assert.equal(request.tools,undefined);assert.deepEqual(request.text.format,{type:'json_object'});
  assert.deepEqual(format.response({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"sampleStatus":"needs-ideas"}'}]}]}),{sampleStatus:'needs-ideas'});
});

test('Provider selection uses the existing key server-side and does not require a Claude key for GPT',async()=>{
  let calls=0;
  const call=createEssayProvider({apiKey:'test-only-secret',env:{ESSAY_SCORING_PROVIDER:'openai'},fetch:async(url,options)=>{
    calls++;assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.headers.Authorization,'Bearer test-only-secret');
    const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.model,'gpt-6.1-sol');assert(!options.body.includes('test-only-secret'));assert(options.signal);
    return {ok:true,json:async()=>completed({scores:{content:5}})};
  }});
  assert.deepEqual(await call('Assess.',{stage:'assessment'}),{scores:{content:5},scoringProvider:'openai',scoringModel:'gpt-6.1-sol'});
  assert.equal(calls,1);assert.deepEqual(call.configuration,{provider:'openai',model:'gpt-6.1-sol'});
});

test('HTTP/authentication errors are sanitised and never fall back silently to another provider',async()=>{
  for(const status of [400,401,403,404,429,500]){
    let calls=0;
    const call=createEssayProvider({apiKey:'test-only-secret',env:{ESSAY_SCORING_PROVIDER:'openai'},anthropic:{messages:{create(){throw Error('Must not fall back');}}},fetch:async()=>{calls++;return {ok:false,status,json:async()=>({error:{message:'Echoed secret or student input'}})};}});
    await assert.rejects(call('Assess.',{stage:'assessment'}),error=>{assert.equal(error.code,'ESSAY_PROVIDER_HTTP');assert.equal(error.status,status);assert(!error.message.includes('secret'));assert.equal(error.retryable,![400,401,403,404].includes(status));return true;});assert.equal(calls,1);
  }
  await assert.rejects(createEssayProvider({apiKey:'',env:{ESSAY_SCORING_PROVIDER:'openai'}})('Assess.'),{code:'ESSAY_PROVIDER_UNAVAILABLE',retryable:false});
  assert.throws(()=>configuration({ESSAY_SCORING_PROVIDER:'invalid'}),{code:'ESSAY_PROVIDER_CONFIG'});
});

test('Cancellation reaches GPT requests and Claude remains an explicit supported rollback',async()=>{
  const controller=new AbortController();controller.abort(Error('Cancelled'));
  const call=createEssayProvider({apiKey:'test',env:{ESSAY_SCORING_PROVIDER:'openai'},fetch:async(url,options)=>{assert(options.signal.aborted);throw options.signal.reason;}});
  await assert.rejects(call('Assess.',{stage:'assessment',signal:controller.signal}),/Cancelled/);
  let requested;
  const claudeCall=createEssayProvider({env:{},anthropic:{messages:{create:async body=>{requested=body;return {content:[{type:'tool_use',name:'submit_essay_assessment',input:{scores:{content:5}}}]};}}}});
  assert.equal((await claudeCall('Assess.',{stage:'assessment'})).scoringProvider,'anthropic');assert.equal(requested.model,'claude-sonnet-4-6');
});

test('A complete GPT response still passes independent essay validation and caching before publication',async()=>{
  const {question,essay}=require('./essay-fixtures'),policy=require('../public/essay-scoring'),feedback=require('../public/essay-feedback');
  const {createEssayGrader}=require('../essay-grading');
  const words=[...essay.matchAll(/\S+/g)];
  function span(quote){const start=essay.indexOf(quote);assert(start>=0);return [words.findIndex(w=>w.index===start)+1,words.findIndex(w=>w.index+w[0].length===start+quote.length)+1];}
  const first=span('mass media supports learning'),second=span('Schools can respond by teaching students');
  const base={taskRelevance:{status:'relevant',evidence_span:first,reason:'The response explains useful and harmful media effects.'},
    promptCoverage:feedback.requirements(question).map(r=>({requirementId:r.id,requirement:r.label,status:'addressed',evidence_span:first,nextStep:''})),
    scoringEvidence:{linguisticExamples:[{span:first},{span:second}],developmentEvidence:[{span:first},{span:second}]},feedbackIssues:[],revisionDecisions:[]};
  const stages=[];
  const call=createEssayProvider({apiKey:'test',env:{ESSAY_SCORING_PROVIDER:'openai'},fetch:async(url,options)=>{
    const stage=JSON.parse(options.body).tool_choice.name.replace('submit_essay_','').replace(/_/g,'-');stages.push(stage);
    const data=stage==='assessment'?{...base,scores:{...policy.MAXIMA},feedback:Object.fromEntries(Object.keys(policy.MAXIMA).map(k=>[k,'The response is clear and supported.'])),errors:[],optionalRefinements:[],
      scoringEvidence:{...base.scoringEvidence,vocabularyExamples:[{span:span('critical reading')}]},strengths:['Explains both effects.'],improvements:[],overallVerdict:'Both effects are explained with useful support.',templateDetector:'ok',templateNote:'',templateEvidence:[]}
      : {...base,scores:{content:6,linguistic:6,coherence:6},rationale:{content:'Both effects are explained.',linguistic:'Clear varied expression.',coherence:'Logical development.'}};
    return {ok:true,json:async()=>completed(data,stage)};
  }});
  const grader=createEssayGrader(call);
  const a=await grader.grade(question,essay,'9',{feedbackV3:true,includeSample:false});
  assert.equal(a.scores.total,26);assert.equal(a.scoringProvider,'openai');assert.equal(a.scoringModel,'gpt-6.1-sol');
  assert.equal(a.feedbackVersion,feedback.VERSION);assert.deepEqual(a.scoringEvidence.linguisticExamples,['mass media supports learning','Schools can respond by teaching students']);
  assert.equal((await grader.grade(question,essay,'9',{feedbackV3:true,includeSample:false})).scores.total,26);
  assert.deepEqual(stages,['assessment','subjective-review']);
});
