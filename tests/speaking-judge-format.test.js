'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const format=require('../speaking-judge-format'),scoring=require('../speaking-scoring');
const transcript='The first speaker wants quiet study,  while the second supports group work. They agree to try separate zones.';
const question={type:'sgd',text:'Three speakers discuss separating quiet and group study.',facts:['Quiet study is needed.','Group work should be retained.','They agree to separate the zones.']};
function review(){return {total:6,overview:'The main positions and their agreement are clearly connected.',strengths:['The solution connects both needs.'],improvements:[],
  coverage:question.facts.map((_,point)=>({point,status:'covered',evidence_span:point===2?[13,18]:[1,12],feedback:'The relevant idea is expressed.',errorImpact:'none'})),
  summaryAssessment:{responseForm:'connected',mainMessageAccurate:true,relationshipsClear:true,sufficientSubstance:true,mostlyAccurate:true,
    materialMeaningChange:false,speakerAttributionClear:true,evidence_span:[1,12],reason:'Both needs are linked to a shared solution.'}};}
const envelope=input=>({stop_reason:'tool_use',content:[{type:'tool_use',name:format.NAME,input}]});

test('Speaking summaries and situations force their complete task-specific output contract',()=>{
  for(const type of ['rl','sgd','rts']){
    const q={...question,type},req=format.request(scoring.prompt(q,transcript),'test-model',{question:q,transcript});
    assert.deepEqual(req.tool_choice,{type:'tool',name:format.NAME});
    assert.equal(req.tools[0].strict,true);assert.equal(req.max_tokens,4000);
    const props=req.tools[0].input_schema.properties;
    assert(props[type==='rts'?'communicationAssessment':'summaryAssessment']);
    assert.equal(!!props.coverage,type!=='rts');
    assert.match(req.messages[0].content,/1:The 2:first 3:speaker/);
    function check(schema){
      if(schema.type==='object'){
        assert.equal(schema.additionalProperties,false);
        assert.deepEqual(new Set(schema.required),new Set(Object.keys(schema.properties)));
        Object.values(schema.properties).forEach(check);
      }
      if(schema.items)check(schema.items);
    }
    check(req.tools[0].input_schema);
  }
});

test('Structured review restores literal student words and produces a validated content mark',async()=>{
  let calls=0;
  const result=await scoring.grade(question,transcript,async(prompt,context)=>{
    calls++;assert.equal(context.question,question);assert.equal(context.transcript,transcript);
    const request=format.request(prompt,'test-model',context);assert.equal(request.tools.length,1);
    return format.response(envelope(review()),context);
  });
  assert.equal(calls,1);assert.equal(result.total,6);assert.equal(result.contentStatus,'assessed');
  assert.equal(result.coverage[0].evidence,'The first speaker wants quiet study,  while the second supports group work.');
  assert.equal(result.coverage[2].evidence,'They agree to try separate zones.');
  assert.equal(result.pronunciation,null);assert.equal(result.fluency,null);
});

test('Missing optional facts use empty spans without losing the content score',()=>{
  const raw=review();raw.coverage[2]={...raw.coverage[2],status:'missing',evidence_span:[]};
  const parsed=format.response(envelope(raw),{question,transcript});
  assert.equal(parsed.coverage[2].evidence,'');assert.equal(scoring.normalize(question,transcript,parsed).total,6);
});

test('Spans cannot invent, correct, overrun or quote excessive student evidence',()=>{
  for(const span of [[0,2],[2,1],[1,999],['1',2],[1],[],null]){
    const raw=review();raw.summaryAssessment.evidence_span=span;
    assert.throws(()=>format.response(envelope(raw),{question,transcript}),/Unsupported assessment evidence/);
  }
  const raw=review();raw.coverage[0].status='missing';
  assert.throws(()=>format.response(envelope(raw),{question,transcript}),/Unsupported assessment evidence/);
  assert.throws(()=>format.response(envelope(review()),{question,transcript:'x'.repeat(501)+' '+transcript}),/Unsupported assessment evidence/);
});

test('A situation communicates successfully without requiring any sample ideas',()=>{
  const q={type:'rts',text:'A book you purchased has missing pages. What would you say?'},text='Some pages are missing. Could I have a refund please?';
  const raw={total:6,overview:'Your problem and request are clear.',strengths:['A useful request.'],improvements:[],
    communicationAssessment:{level:'effective',materialProblem:false,evidence_span:[1,10],reason:'The listener understands the problem and requested action.'}};
  const result=scoring.normalize(q,text,format.response(envelope(raw),{question:q,transcript:text}));
  assert.equal(result.total,6);assert.equal(result.coverage,undefined);
});

test('The second review receives the actual invalid assessment and a specific repair instruction',async()=>{
  let calls=0;
  const result=await scoring.grade(question,transcript,async(prompt,context)=>{
    calls++;
    if(calls===2){assert.match(prompt,/numeric total contradicted summaryAssessment/);assert.match(prompt,/PREVIOUS_ASSESSMENT_DATA/);assert.match(prompt,/"materialMeaningChange":true/);assert.match(prompt,/VALIDATION_FAILURE_DATA/);assert.match(prompt,/"fullEligible":false/);assert.match(prompt,/Do not change flags/);}
    const raw=review();if(calls===1)raw.summaryAssessment.materialMeaningChange=true;
    return format.response(envelope(raw),context);
  });
  assert.equal(calls,2);assert.equal(result.total,6);
});

test('Unrepaired semantic contradictions still withhold content and log a safe, specific cause',async()=>{
  const saved=console.warn,logs=[];console.warn=(...args)=>logs.push(args.join(' '));
  try{
    const result=await scoring.grade(question,transcript,async(prompt,context)=>{
      const raw=review();raw.summaryAssessment.materialMeaningChange=true;return format.response(envelope(raw),context);
    });
    assert.equal(result.total,null);assert.equal(result.contentStatus,'unavailable');
    assert.match(logs.join('\n'),/"issue":"summary_score_conflict"/);
    assert(!logs.join('\n').includes(transcript));assert(!logs.join('\n').includes('speaker wants'));
  }finally{console.warn=saved;}
});

test('Truncated and missing tool responses cannot become confirmed marks',()=>{
  assert.throws(()=>format.response({stop_reason:'max_tokens'},{question,transcript}),/Incomplete content/);
  assert.throws(()=>format.response({content:[{type:'text',text:'6'}]},{question,transcript}),/Incomplete content/);
});

test('Describe Image keeps its existing JSON and coaching path',()=>{
  const q={type:'di'},req=format.request('Existing image review','test-model',{question:q});
  assert.equal(req.tools,undefined);assert.equal(req.max_tokens,3200);
  const raw={total:5,coaching:{priority:'expression'}};
  assert.deepEqual(format.response({content:[{type:'text',text:JSON.stringify(raw)}]},{question:q}),raw);
});
