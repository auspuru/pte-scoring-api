'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const bank=require('../content/speaking-mocks'),{installSpeakingMock,timing}=require('../speaking-mock'),whole=require('../speaking-mock-overall');
const gpt=require('../gpt-speaking-delivery'),express=require('express');
const top=()=>({status:'scored',pattern:'minor_slips',overallImpact:'none',score:5,reason:'Clear, connected delivery across the recordings, with isolated harmless slips.',nextStep:'Keep the natural phrasing.',evidence:[{recording:1,start:1,end:2,kind:'strength',phrase:'clear phrasing',observation:'The phrase is readily understood.',impact:''}]});
const raw=()=>({assessable:true,overallScore:90,summary:'Generally clear and connected speech throughout the mock.',pronunciation:top(),fluency:top()});

test('The speaking paper has full task counts, an unscored introduction and only existing verified audio',async()=>{
  assert.equal(bank.papers.length,3);
  for(const p of bank.papers){assert.equal(p.questionCount,27);assert.equal(p.questions.length,28);
  assert.deepEqual(Object.fromEntries(Object.keys(require('../content/speaking-bank').types).map(type=>[type,p.questions.filter(q=>q.type===type).length])),{ra:6,rs:10,di:5,rl:2,sgd:2,rts:2});
  assert.equal(new Set(p.questions.map(q=>q.id)).size,28);
  for(const q of p.questions){
    assert(q.instruction);assert(q.seconds>0);
    if(q.type==='ra')assert(q.text.split(/\s+/u).length<=60);
    if(q.imageUrl)assert((await fs.stat(path.join(__dirname,'..','public',q.imageUrl))).size>100);
    if(q.audioSource){const file=path.join(__dirname,'..','content',q.audioSource.folder==='speaking'?'speaking-audio':'writing-audio',q.audioSource.id+'.mp3');assert((await fs.stat(file)).size>100);}
    const shown=bank.publicQuestion(q);assert.equal(shown.facts,undefined);assert.equal(shown.reference,undefined);assert.equal(shown.sample,undefined);
    if(['rs','rl','sgd'].includes(q.type))assert.equal(shown.text,undefined);
  }
  }
  for(const type of ['ra','rs','di']){const items=bank.papers.flatMap(p=>p.questions.filter(q=>q.type===type));assert.equal(new Set(items.map(q=>q.id)).size,items.length);}
  assert(bank.catalogue().every(p=>!p.questions));
  for(const type of ['ra','rs','di','rl','sgd','rts'])assert(gpt.applies({type}));
});

test('Overall review sends every original audio clip without question marks, transcripts or metadata',async()=>{
  let calls=0;
  const recordings=Array.from({length:27},(_,i)=>({mime:'audio/webm',data:'audio-'+i,hash:'hash-'+i,individualScore:i===0?0:90,feedback:'DO_NOT_SEND',questionText:'DO_NOT_SEND',transcript:'DO_NOT_SEND'}));
  const result=await whole.assess(recordings,{apiKey:'test-only',expectedCount:27,convert:async r=>({data:Buffer.from(r.data).toString('base64'),seconds:8}),request:async(url,args)=>{
    calls++;const body=JSON.parse(args.body),content=body.messages[1].content;
    assert.equal(content.filter(c=>c.type==='input_audio').length,27);assert.equal(body.store,false);assert.equal(body.model,gpt.MODEL);
    assert(!args.body.includes('DO_NOT_SEND'));assert(!args.body.includes('individualScore'));assert.match(body.messages[0].content,/Do not average/);
    return {ok:true,json:async()=>({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'record_mock_delivery',arguments:JSON.stringify(raw())}}]}}]})};
  }});
  assert.equal(calls,1);assert.equal(result.overallScore,90,'One zero individual mark cannot lower an independently assessed whole-test score.');assert.equal(result.pronunciation.score,5);
});

test('One weak answer cannot substantiate a recurring whole-test difficulty',()=>{
  const value=raw();value.overallScore=75;value.fluency={...top(),score:4,pattern:'recurring_difficulty',overallImpact:'noticeable',evidence:[
    {...top().evidence[0],kind:'score-impact',impact:'The flow is interrupted.'},
    {...top().evidence[0],start:4,end:5,kind:'score-impact',impact:'The flow is interrupted again.'}
  ]};
  assert.throws(()=>whole.normalize(value,[8,8,8]),/single answer/);
  value.fluency.evidence[1].recording=2;assert.equal(whole.normalize(value,[8,8,8]).fluency.score,4);
  value.fluency.evidence[1].end=9;assert.throws(()=>whole.normalize(value,[8,8,8]),/Unsupported/);
});

test('A clear independent whole-test review cannot claim a lower overall band with no score-impact evidence',()=>{
  const value=raw();value.overallScore=75;
  assert.throws(()=>whole.normalize(value,[8,8,8]),{validationIssue:'overall_band_conflict'});
  for(const score of [85,88,90]){value.overallScore=score;assert.equal(whole.normalize(value,[8,8,8]).overallScore,score);}
  assert(whole.PROMPT.startsWith(require('../delivery-rubric').instructions));
  assert.match(whole.PROMPT,/must not lower either trait or the overall band/);
});

test('Whole-test timestamps remain local and numeric strings cannot corrupt offsets',()=>{
 const value=raw();value.pronunciation.evidence[0]={...top().evidence[0],recording:2,start:'1',end:'2'};
 const result=whole.normalize(value,[8,8,8]);assert.equal(result.pronunciation.score,5);assert.equal(result.pronunciation.evidence[0].start,1);assert.equal(result.pronunciation.evidence[0].end,2);
 value.pronunciation.evidence[0].end=99;
 assert.throws(()=>whole.normalize(value,[8,8,8]),error=>{assert.deepEqual(error.evidenceIssue,{trait:'pronunciation',recording:2,start:1,end:99,durationSeconds:8,reason:'timestamp_range'});return true;});
});

test('Overall review labels every clip and permits one evidence-only repair without individual marks',async()=>{
 let calls=0;const recordings=Array.from({length:8},(_,i)=>({data:'clip-'+i,individualScore:90,transcript:'PRIVATE_TRANSCRIPT'}));
 const result=await whole.assess(recordings,{apiKey:'test-only',convert:async r=>({data:r.data,seconds:8}),request:async(_,args)=>{
   calls++;const body=JSON.parse(args.body),content=body.messages[1].content;
   assert.equal(content.filter(c=>c.type==='input_audio').length,8);
   const labels=content.filter(c=>c.type==='text'&&c.text.includes('start_of_this_recording'));assert.equal(labels.length,8);
   assert.deepEqual(labels.map(c=>JSON.parse(c.text).recording),[1,2,3,4,5,6,7,8]);assert(!args.body.includes('PRIVATE_TRANSCRIPT'));assert(!args.body.includes('individualScore'));
   if(calls===2){assert.match(content.at(-1).text,/timestamp_range/);assert.match(content.at(-1).text,/No prior score is supplied/);assert(!content.at(-1).text.includes('overallScore'));}
   const value=raw();if(calls===1)value.pronunciation.evidence[0].end=99;
   return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{tool_calls:[{function:{name:'record_mock_delivery',arguments:JSON.stringify(value)}}]}}]})};
 }});
 assert.equal(result.overallScore,90);assert.equal(result.providerCalls,2);assert.equal(calls,2);
});

test('Unrepaired overall evidence fails closed after two calls and provider errors never trigger a paid retry',async()=>{
 let calls=0;
 await assert.rejects(whole.assess(Array.from({length:8},()=>({data:'clip'})),{apiKey:'test-only',convert:async()=>({data:'clip',seconds:8}),request:async()=>{
   calls++;const value=raw();value.pronunciation.evidence[0].end=99;return {ok:true,json:async()=>({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'record_mock_delivery',arguments:JSON.stringify(value)}}]}}]})};
 }}),{code:'WHOLE_VALIDATION'});assert.equal(calls,2);
 calls=0;await assert.rejects(whole.assess(Array.from({length:8},()=>({data:'clip'})),{apiKey:'test-only',convert:async()=>({data:'clip',seconds:8}),request:async()=>{calls++;return {ok:false,status:429,json:async()=>({error:{code:'insufficient_quota'}})};}}),{providerStatus:429});assert.equal(calls,1);
});

test('Complete audio tool calls and JSON replies with finish_reason stop retain the validated overall score',()=>{
 const durations=[8,8,8],call={type:'function',function:{name:'record_mock_delivery',arguments:JSON.stringify(raw())}};
 for(const choice of [
   {finish_reason:'tool_calls',message:{tool_calls:[call]}},
   {finish_reason:'stop',message:{tool_calls:[call]}},
   {finish_reason:'stop',message:{content:'```json\n'+JSON.stringify(raw())+'\n```'}}
 ])assert.equal(whole.parseReview(choice,durations).overallScore,90);
 assert.throws(()=>whole.parseReview({finish_reason:'length',message:{tool_calls:[call]}},durations),{code:'WHOLE_TRUNCATED'});
 assert.throws(()=>whole.parseReview({finish_reason:'stop',message:{tool_calls:[{...call,function:{...call.function,name:'wrong_function'}}]}},durations),{code:'WHOLE_INCOMPLETE'});
 const invalid=raw();invalid.pronunciation.evidence[0].end=99;
 assert.throws(()=>whole.parseReview({finish_reason:'stop',message:{content:JSON.stringify(invalid)}},durations),{code:'WHOLE_VALIDATION'});
});

test('Overall provider failures retain safe request details while redacting credentials and audio',async()=>{
 await assert.rejects(whole.assess(Array.from({length:8},()=>({data:'test'})),{apiKey:'test-only',convert:async()=>({data:'test',seconds:8}),request:async()=>({ok:false,status:400,json:async()=>({error:{code:'invalid_request',param:'tools[0]',message:'Invalid request sk-secret-key '+ 'a'.repeat(100)}})})}),error=>{
   const info=whole.diagnostic(error);assert.equal(info.providerStatus,400);assert.equal(info.providerCode,'invalid_request');assert.equal(info.providerParam,'tools[0]');
   assert(!JSON.stringify(info).includes('sk-secret-key'));assert(!JSON.stringify(info).includes('a'.repeat(100)));return true;
 });
});

test('Missing recording evidence withholds an overall score without paid calls',async()=>{
  const result=await whole.assess([{data:'one'}],{expectedCount:27,apiKey:'test',request:()=>{throw Error('Must not call');}});
  assert.equal(result.status,'unassessed');assert.equal(result.overallScore,null);
});

test('Full speaking mock persists recordings, isolates accounts, locks responses and grades independently',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-mock-')),app=express();app.use(express.json());let now=1000000,itemCalls=0,overallCalls=0;
  const {store,waitForJobs}=installSpeakingMock(app,{directory,verifyToken:token=>['alice','bob'].includes(token)?token:null,getAccount:async()=>({}),now:()=>now,gptAvailable:true,azureAvailable:true,
    gradeResponse:async(q,recording)=>{itemCalls++;return {transcript:'Saved student speech.',content:{scoringMode:'ai',total:itemCalls===1?0:6,maximum:6},gpt:{status:'assessed',pronunciation:{score:5},fluency:{score:5}},azure:{status:'assessed',pronunciation:{score:4},fluency:{score:4}}};},
    assessOverall:async(recordings,options)=>{overallCalls++;assert.equal(recordings.length,27);assert.equal(options.expectedCount,27);assert(recordings.every(r=>Object.keys(r).sort().join(',')==='data,hash,mime'));return {status:'assessed',overallScore:90};}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await waitForJobs();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port+'/api/speaking-mocks';
  async function request(route,body,user='alice',binary=false){const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'x-session-token':user,'Content-Type':binary?'audio/webm':'application/json'},body:body===undefined?undefined:binary?body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
  const id=crypto.randomUUID();let a=(await request('/attempts',{id,paperId:'speaking-mock-1',results:[{overallScore:90}]})).body;
  assert.equal(a.overall,null);assert.equal(a.responses,undefined);assert.equal(a.question.type,'intro');
  assert.equal((await request('/attempts/'+id,undefined,'bob')).status,404);assert.equal((await request('/attempts/'+id,undefined,'')).status,401);
  assert.equal((await request('/attempts/'+id+'/recordings/0',Buffer.alloc(200,1),'alice',true)).status,409);
  assert.equal((await request('/attempts/'+id+'/reattempt',{id:crypto.randomUUID()})).status,409);
  for(let index=0;index<a.totalItems;index++){
    a=(await request('/attempts/'+id+'/begin',{index})).body;now=a.timing.recordingAt+500;
    const data=Buffer.alloc(200,index+1);
    a=(await request('/attempts/'+id+'/recordings/'+index,data,'alice',true)).body;assert.equal(a.timing.phase,'completed');
    assert.equal((await request('/attempts/'+id+'/recordings/'+index,data,'alice',true)).status,200);
    assert.equal((await request('/attempts/'+id+'/recordings/'+index,Buffer.alloc(200,99),'alice',true)).status,409);
    a=(await request('/attempts/'+id+'/next',{index,overallScore:90})).body;
  }
  assert.equal(a.status,'submitted');await waitForJobs();
  a=(await request('/attempts/'+id)).body;assert.equal(a.overall.overallScore,90);assert.equal(a.grading.status,'complete');assert.equal(itemCalls,27);assert.equal(overallCalls,1);
  assert.equal(a.responses.filter(r=>r.question.type!=='intro').length,27);assert.equal(a.responses[0].content,null);assert.equal(a.responses[1].content.total,0);
  assert.equal(a.responses[1].providers.azure.pronunciation.score,4);assert.equal(a.responses[1].providers.gpt.pronunciation.score,5);
  await request('/attempts/'+id+'/retry',{});await waitForJobs();assert.equal(overallCalls,1,'A successful overall assessment is never called again.');assert.equal(itemCalls,27,'Successful individual assessments are reused.');
  assert.equal((await request('/attempts/'+id+'/recordings/2',Buffer.alloc(200,99),'alice',true)).status,409);
  const saved=await store.update('alice',id,value=>{value.questions[1].title='The exact saved question';return value;});assert(saved.responses.every(r=>r.recording.hash));
  const before=JSON.stringify(saved),newId=crypto.randomUUID();now+=10000;
  assert.equal((await request('/attempts/'+id+'/reattempt',{id:newId},'bob')).status,404);
  assert.equal((await request('/attempts/'+id+'/reattempt',{id})).status,409);
  assert.equal((await request('/attempts/'+id+'/reattempt',{})).status,400);
  const fresh=(await request('/attempts/'+id+'/reattempt',{id:newId,overallScore:90})).body;
  assert.equal(fresh.id,newId);assert.equal(fresh.reattemptOf,id);assert.equal(fresh.status,'active');assert.equal(fresh.index,0);assert.equal(fresh.overall,null);
  assert.equal(fresh.deadline-fresh.startedAt,saved.deadline-saved.startedAt);assert(fresh.startedAt>saved.startedAt);
  const copy=await store.update('alice',newId,value=>value);assert.deepEqual(copy.questions,saved.questions);assert.deepEqual(copy.responses,[]);assert.equal(copy.grading,undefined);
  assert.equal((await request('/attempts/'+id+'/reattempt',{id:newId})).body.id,newId,'Network retries reuse the same new attempt.');
  assert.equal(JSON.stringify(await store.update('alice',id,value=>value)),before,'Reattempting preserves the prior recordings and result.');
  assert.equal(itemCalls,27);assert.equal(overallCalls,1);
  for(const paper of bank.papers.slice(1)){const created=(await request('/attempts',{id:crypto.randomUUID(),paperId:paper.id})).body;assert.equal(created.paperId,paper.id);assert.equal(created.questionCount,27);}

});

test('The mock clock follows preparation, saved audio, response time and completion',()=>{
  const q=bank.papers[0].questions.find(q=>q.type==='rl'),a={questions:[q],responses:[],index:0,status:'active',questionStartedAt:1000};
  const start=timing(a,1000);assert.equal(start.phase,'instructions');assert.equal(timing(a,start.audioAt+1).phase,'listening');assert.equal(timing(a,start.prepAt+1).phase,'preparing');assert.equal(timing(a,start.recordingAt+1).phase,'recording');assert.equal(timing(a,start.endsAt+1).phase,'expired');
  a.responses[0]={recording:{}};assert.equal(timing(a,start.endsAt+1).phase,'completed');
});

test('Default assessment persists successful stages and retries only a failed audio provider',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-mock-retry-')),app=express();app.use(express.json());
  let transcripts=0,gptCalls=0,azureCalls=0,overallCalls=0;
  const lab=installSpeakingMock(app,{directory,verifyToken:()=> 'alice',getAccount:async()=>({}),gptAvailable:true,azureAvailable:true,
    transcribe:async()=>{transcripts++;return bank.papers[0].questions[1].text;},
    assessGpt:async()=>{if(++gptCalls===1)throw Error('Temporary provider failure');return {pronunciation:{score:5},fluency:{score:5}};},
    assessAzure:async()=>{azureCalls++;return {pronunciation:{score:4},fluency:{score:4}};},
    assessOverall:async()=>{overallCalls++;return {status:'assessed',overallScore:85};}});
  const id=crypto.randomUUID();await lab.store.update('alice',id,()=>({id,paperId:'speaking-mock-1',title:'Saved paper',status:'submitted',index:28,startedAt:1,deadline:2,questionCount:27,
    questions:structuredClone(bank.papers[0].questions),responses:[null,...[1,2].map(n=>({recording:{mime:'audio/webm',data:Buffer.alloc(200,n).toString('base64'),hash:String(n)}}))],grading:{status:'pending'},integrity:{events:[]}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await lab.waitForJobs();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
  const url='http://127.0.0.1:'+server.address().port+'/api/speaking-mocks/attempts/'+id;
  await fetch(url);await lab.waitForJobs();let saved=await lab.store.update('alice',id,a=>a);
  assert.equal(saved.grading.status,'complete');assert.equal(saved.responses[1].gpt.status,'unavailable');assert.equal(saved.responses[1].azure.status,'assessed');assert(saved.responses[1].content);
  assert.deepEqual([transcripts,gptCalls,azureCalls,overallCalls],[2,2,2,1]);
  await fetch(url+'/retry',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});await lab.waitForJobs();saved=await lab.store.update('alice',id,a=>a);
  assert.equal(saved.responses[1].gpt.status,'assessed');assert.deepEqual([transcripts,gptCalls,azureCalls,overallCalls],[2,3,2,1]);
});

async function overallRecoveryFixture(t,{existing=null,fail=false}={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mock-overall-repair-')),app=express();let calls=0;
 const lab=installSpeakingMock(app,{directory,getAccount:async()=>({}),verifyToken:()=> 'mahabir1',gptAvailable:true,azureAvailable:true,
   transcribe:async()=>{throw Error('Do not transcribe during overall recovery.');},callModel:async()=>{throw Error('Do not regrade content.');},
   assessGpt:async()=>{throw Error('Do not repeat individual GPT audio.');},assessAzure:async()=>{throw Error('Do not repeat Azure.');},
   assessOverall:async(recordings,options)=>{calls++;assert.equal(recordings.length,27);assert.equal(options.expectedCount,27);assert(recordings.every(r=>Object.keys(r).sort().join(',')==='data,hash,mime'));
     if(fail)throw Object.assign(Error('Provider failed'),{code:'WHOLE_PROVIDER',providerStatus:503});return whole.normalize(raw(),Array(27).fill(8));}});
 t.after(async()=>{await lab.waitForJobs();await fs.rm(directory,{recursive:true,force:true});});
 const id=crypto.randomUUID(),questions=structuredClone(bank.papers[0].questions),responses=questions.map((q,i)=>({recording:{mime:'audio/webm',hash:'saved-'+i,data:'saved-audio-'+i},transcript:'Saved response '+i,content:{scoringMode:'ai',total:5,maximum:6},gpt:{status:'assessed',pronunciation:{score:4}},azure:{status:'assessed',fluency:{score:4}}}));
 await lab.store.update('mahabir1',id,()=>({id,status:'submitted',startedAt:1,deadline:2,index:28,questionCount:27,completedCount:27,questions,responses,overall:existing||{status:'unavailable'},grading:{status:'complete'}}));
 return {...lab,id,calls:()=>calls,responses,request:{username:'mahabir1',attemptId:id,operation:'overall-repair-test'}};
}

test('Pinned overall recovery assesses original recordings once and preserves every individual score',async t=>{
 const h=await overallRecoveryFixture(t),report=await h.recoverOverall(h.request);
 assert.equal(report.status,'complete');assert.equal(report.overallScore,90);assert.equal(h.calls(),1);
 const saved=await h.store.get('mahabir1',h.id);assert.deepEqual(saved.responses,h.responses);assert.equal(saved.grading.status,'complete');assert.equal(saved.overallRecovery.status,'complete');
 await h.recoverOverall(h.request);assert.equal(h.calls(),1);
 await assert.rejects(h.recoverOverall({...h.request,username:'another-user'}),/Invalid overall/);
});

test('Existing overall results are retained, while failed recovery never invents a mark or repeats automatically',async t=>{
 const existing=whole.normalize(raw(),Array(27).fill(8)),ready=await overallRecoveryFixture(t,{existing});
 assert.equal((await ready.recoverOverall(ready.request)).overallScore,90);assert.equal(ready.calls(),0);
 const h=await overallRecoveryFixture(t,{fail:true});const report=await h.recoverOverall(h.request);
 assert.equal(report.status,'needs-review');assert.equal(report.overallScore,null);assert.equal(report.failure.providerStatus,503);
 assert.deepEqual((await h.store.get('mahabir1',h.id)).responses,h.responses);await h.recoverOverall(h.request);assert.equal(h.calls(),1);
});

test('Overall recovery respects another worker lease and reuses the result that worker saves',async t=>{
 const h=await overallRecoveryFixture(t);await h.store.update('mahabir1',h.id,a=>{a.lease={owner:'another-worker',expiresAt:Date.now()+30000};return a;});
 let waits=0;const report=await h.recoverOverall({...h.request,wait:async()=>{waits++;await h.store.update('mahabir1',h.id,a=>{a.overall=whole.normalize(raw(),Array(27).fill(8));delete a.lease;return a;});}});
 assert.equal(waits,1);assert.equal(h.calls(),0);assert.equal(report.overallScore,90);assert.deepEqual((await h.store.get('mahabir1',h.id)).responses,h.responses);
});

test('An explicit overall reassessment replaces a confirmed result once, preserves history and never touches question scores',async t=>{
 const old={...whole.normalize(raw(),Array(27).fill(8)),overallScore:75};
 const h=await overallRecoveryFixture(t,{existing:old}),request={...h.request,reassess:true};
 const [report]=await Promise.all([h.recoverOverall(request),h.recoverOverall(request)]);
 assert.equal(h.calls(),1);
 const saved=await h.store.get('mahabir1',h.id);
 assert.equal(saved.overall.overallScore,90);assert.equal(saved.overall.reassessmentOperation,request.operation);
 assert.deepEqual(saved.overallHistory,[{operation:request.operation,replacedAt:saved.overall.assessedAt,assessment:old}]);
 assert.deepEqual(saved.responses,h.responses);assert.equal(saved.overallRecovery.status,'complete');
 assert.equal((await h.recoverOverall(request)).status,'complete');assert.equal(h.calls(),1);
 assert.equal(report.reassessment,true);
 await assert.rejects(h.recoverOverall({...request,reassess:'true',operation:'bad'}),/Invalid overall/);
});

test('A failed explicit reassessment retains the prior overall and is not retried on restart',async t=>{
 const old={...whole.normalize(raw(),Array(27).fill(8)),overallScore:75};
 const h=await overallRecoveryFixture(t,{existing:old,fail:true}),request={...h.request,reassess:true};
 const report=await h.recoverOverall(request);
 assert.equal(report.status,'needs-review');assert.equal(report.overallScore,75);assert.equal(report.failure.providerStatus,503);
 const saved=await h.store.get('mahabir1',h.id);assert.deepEqual(saved.overall,old);assert.equal(saved.overallHistory,undefined);assert.deepEqual(saved.responses,h.responses);
 await h.recoverOverall(request);assert.equal(h.calls(),1);
});
