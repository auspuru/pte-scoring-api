'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const combined=require('../speaking-mock-combined'),format=require('../speaking-judge-format');
const {createStore}=require('../writing-lab-store'),{present}=require('../speaking-mock');
const id=()=>crypto.randomUUID(),quiet={info(){},warn(){}};
function attempt(){
  const questions=combined.TYPES.map((type,i)=>({id:'q'+i,type,text:'The cost of travel increased.',facts:['Travel costs increased.']}));
  const responses=questions.map((q,i)=>({recording:{hash:'original-'+i,data:'original-audio',mime:'audio/webm'},transcript:'The cost of travel increased.',content:{total:3,maximum:6,scoringMode:'ai'},
    gpt:{pronunciation:{score:2}},azure:{fluency:{score:1}}}));
  return {id:id(),status:'submitted',startedAt:10,questionCount:6,questions,responses,grading:{status:'complete'},
    overall:{status:'assessed',overallScore:82,recordingCount:6,pronunciation:{score:4},fluency:{score:4}}};
}
function judgment(rows,score=5){return {score,summary:'Generally effective task fulfilment across all six task types.',strengths:['Relevant connected responses.'],nextSteps:['Retain important supporting details.'],
  coverage:Object.fromEntries(rows.map(r=>['q'+r.index,{outcome:r.student.trim()?'adequate':'unanswered',materialError:false,evidence_id:r.student.trim()?1:0,reason:r.student.trim()?'The relevant task content is expressed.':'No response was recorded.'}]))};}
async function setup(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-combined-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const mockStore=createStore(null,path.join(directory,'mock'),{table:'speaking_mock_attempts'}),practiceStore=createStore(null,path.join(directory,'practice'),{table:'speaking_lab_attempts'});
  return {username:'mahdis',operation:'pilot-test',startedBefore:100,mockStore,practiceStore,logger:quiet};}

test('Complete raw responses enter a blind-to-marks whole content review, with task-specific policies',()=>{
  const a=attempt(),rows=combined.entries(a),request=format.request('ignored','test-model',{wholeMockEntries:rows.map(r=>({...r,score:0,feedback:'secret old feedback'}))});
  assert.equal(request.tools[0].name,combined.NAME);assert.equal(request.tools[0].strict,undefined);assert.deepEqual(request.tool_choice,{type:'tool',name:combined.NAME});
  const serialized=JSON.stringify(request);assert(!serialized.includes('secret old feedback'));assert(!serialized.includes('original-audio'));
  for(const r of rows)assert(serialized.includes('"index":'+r.index)||serialized.includes('\\"index\\":'+r.index));
  assert.match(request.messages[0].content,/accurate reproduction/);assert.match(request.messages[0].content,/Visual Academy/);assert.match(request.messages[0].content,/Minor secondary inaccuracies/);
  assert.match(request.messages[0].content,/No mandatory greeting/);
  const parsed=format.response({stop_reason:'tool_use',content:[{type:'tool_use',name:combined.NAME,input:judgment(rows)}]},{wholeMockEntries:rows});
  assert.equal(combined.normalize(parsed,rows).coverage.length,6);
});
test('Every question requires correctly indexed literal student evidence',()=>{
  const rows=combined.entries(attempt()),raw=judgment(rows);
  assert.equal(combined.normalize(raw,rows).coverage[0].evidence,'The cost of travel increased.');
  for(const mutate of [r=>delete r.coverage.q5,r=>r.coverage.extra={},r=>r.coverage.q1.evidence_id=999,r=>r.coverage.q0.outcome='unanswered',r=>{r.coverage.q999=r.coverage.q5;delete r.coverage.q5;}]){
    const edited=structuredClone(raw);mutate(edited);assert.throws(()=>combined.normalize(edited,rows));
  }
  raw.score=0;assert.throws(()=>combined.normalize(raw,rows),/could not be verified/);
  raw.score=6;raw.coverage.q0.materialError=true;raw.coverage.q1.materialError=true;assert.throws(()=>combined.normalize(raw,rows));
});
test('Each question has its own forced evidence choices, including a single valid empty-answer choice',()=>{
 const rows=combined.entries(attempt());rows[1].student='Yes.';rows[2].student='';
 const request=combined.request('test-model',{wholeMockEntries:rows}),properties=request.tools[0].input_schema.properties.coverage.properties;
 assert.deepEqual(properties.q1.properties.evidence_id.enum,[1]);assert.deepEqual(properties.q2.properties.evidence_id.enum,[0]);assert.deepEqual(properties.q2.properties.outcome.enum,['unanswered']);
 const raw=judgment(rows);raw.coverage.q1.evidence_id=2;assert.throws(()=>combined.normalize(raw,rows));
 for(const row of rows)for(const option of combined.quoteOptions(row.student))assert(row.student.includes(option.quote));
});
test('One targeted evidence repair retains the same full raw set and all local validation',async t=>{
 const s=await setup(t),a=attempt();await s.mockStore.update('mahdis',a.id,()=>a);let calls=0;
 const result=await combined.recover({...s,callModel:async(prompt,context)=>{
   calls++;const raw=judgment(context.wholeMockEntries);
   if(calls===1)raw.coverage.q1.evidence_id=999;
   else{const issue=JSON.parse(context.wholeMockDiagnostic);assert.equal(issue.code,'COMBINED_EVIDENCE');assert.equal(issue.issue.questionIndex,1);assert.deepEqual(issue.issue.allowedEvidenceIds,[1]);assert.equal(context.wholeMockEntries.length,6);}
   return raw;
 }});
 assert.equal(result.status,'complete');assert.equal(calls,2);
});
test('Combined scores use whole traits only and prevent fluent unrelated content earning a high mark',()=>{
  const a=attempt();assert.equal(combined.combine({score:5},a.overall).overallScore,75);
  const strong={...a.overall,pronunciation:{score:5},fluency:{score:5}};
  assert.equal(combined.combine({score:6},strong).overallScore,90);
  assert.equal(combined.combine({score:0},strong).overallScore,10);
  assert.equal(combined.combine({score:1},strong).overallScore,39);
  assert.equal(combined.combine({score:2},strong).overallScore,59);
  assert.throws(()=>combined.combine({score:6},{...strong,fluency:{score:null}}));
  assert.equal(combined.combine({score:5},strong).method.questionMarksUsed,false);
});
test('Pilot includes every question, preserves original results, is private and cannot migrate to a later attempt on restart',async t=>{
  const s=await setup(t),a=attempt(),before=structuredClone(a);await s.mockStore.update('mahdis',a.id,()=>a);
  let calls=0;const options={...s,callModel:async(prompt,context)=>{calls++;return judgment(context.wholeMockEntries);}};
  const report=await combined.recover(options);assert.equal(report.status,'complete');assert.equal(report.coverage.confirmedContent,6);assert.equal(report.overallScore,75);
  let saved=await s.mockStore.get('mahdis',a.id);assert.deepEqual(saved.responses,before.responses);assert.deepEqual(saved.overall,before.overall);assert.equal(saved.combinedOverall.contentReviewedCount,6);
  const client=present(saved);assert.equal(client.combinedOverall,null);assert(!JSON.stringify(client).includes('original-audio'));
  const later={...attempt(),startedAt:20};await s.mockStore.update('mahdis',later.id,()=>later);
  await combined.recover(options);assert.equal(calls,1);assert.equal((await s.mockStore.get('mahdis',later.id)).combinedOverall,undefined);
  await assert.rejects(combined.recover({...options,username:'mehakbir1'}),/could not be verified/);
});
test('The explicitly authorized Mahabir pilot uses the same rubric without modifying Mahdis results',async t=>{
 const s=await setup(t),mahdis=attempt(),mahabir=attempt();
 await s.mockStore.update('mahdis',mahdis.id,()=>mahdis);await s.mockStore.update('mahabir1',mahabir.id,()=>mahabir);
 const before=await s.mockStore.get('mahdis',mahdis.id);
 const result=await combined.recover({...s,username:'mahabir1',operation:'mahabir-pilot',callModel:async(prompt,context)=>judgment(context.wholeMockEntries)});
 assert.equal(result.status,'complete');assert.equal(result.overallScore,75);assert.equal(result.coverage.confirmedContent,6);
 assert.deepEqual(await s.mockStore.get('mahdis',mahdis.id),before);
 assert.equal((await s.mockStore.get('mahabir1',mahabir.id)).combinedOverall.version,combined.VERSION);
});
test('Missing recordings or task types withhold the pilot instead of silently skipping questions',async t=>{
  for(const fault of ['recording','task','count']){
    const s=await setup(t),a=attempt();if(fault==='recording')delete a.responses[3].recording;if(fault==='task')a.questions[5].type='rs';if(fault==='count')a.questionCount=27;
    await s.mockStore.update('mahdis',a.id,()=>a);let calls=0;
    const report=await combined.recover({...s,callModel:async()=>{calls++;throw Error('Should not run');}});
    assert.equal(report.status,'needs-review');assert.equal(report.overallScore,null);assert.equal(calls,0);
  }
});
test('A complete 27-question assessment includes two explicitly skipped RS answers as zero content, with all 25 original recordings retained',async t=>{
  const s=await setup(t),a=attempt();
  while(a.questions.length<27){a.questions.push({...a.questions[1],id:'extra-'+a.questions.length});a.responses.push(structuredClone(a.responses[1]));}
  a.questionCount=27;for(const index of [11,16])a.responses[index]={skipped:true};a.overall.recordingCount=25;
  await s.mockStore.update('mahdis',a.id,()=>a);let calls=0;
  const report=await combined.recover({...s,callModel:async(prompt,context)=>{calls++;assert.equal(context.wholeMockEntries.length,27);return judgment(context.wholeMockEntries);}});
  assert.equal(report.status,'complete');assert.equal(report.coverage.confirmedContent,27);assert.equal(report.coverage.recordings,25);assert.deepEqual(report.coverage.unanswered,[11,16]);assert.equal(calls,1);
  const saved=await s.mockStore.get('mahdis',a.id);for(const index of [11,16]){assert.equal(saved.responses[index].content.total,0);assert.equal(saved.responses[index].content.maximum,3);assert.equal(saved.responses[index].recording,undefined);}
  assert.equal(saved.combinedOverall.contentReviewedCount,27);assert.equal(saved.combinedOverall.recordingCount,25);
  assert.equal(saved.combinedOverall.content.coverage.filter(c=>c.outcome==='unanswered').length,2);
});
test('Missing content is genuinely recovered with the stronger reviewer before the independent whole review',async t=>{
  const s=await setup(t),a=attempt();a.responses[5].content={total:null,scoringMode:'local'};await s.mockStore.update('mahdis',a.id,()=>a);
  let repairs=0,reviews=0;
  const report=await combined.recover({...s,callModel:async(prompt,context)=>{
    if(context.wholeMockEntries){reviews++;assert.equal((await s.mockStore.get('mahdis',a.id)).responses[5].content.total,6);return judgment(context.wholeMockEntries);}
    repairs++;assert.equal(context.recoveryReview,true);return {total:6,overview:'The request is understandable.',strengths:['Clear relevant request.'],improvements:[],
      communicationAssessment:{level:'effective',materialProblem:false,evidence:a.responses[5].transcript,reason:'The relevant request is clear.'}};
  }});
  assert.equal(report.status,'complete');assert.equal(repairs,1);assert.equal(reviews,1);assert.equal(report.coverage.missingContent.length,0);
});
test('A failed content assessment prevents publication while the other responses remain saved',async t=>{
  const s=await setup(t),a=attempt();a.responses[5].content={total:null,scoringMode:'local'};await s.mockStore.update('mahdis',a.id,()=>a);
  let wholeCalls=0;
  const report=await combined.recover({...s,callModel:async(prompt,context)=>{if(context.wholeMockEntries)wholeCalls++;throw Error('Provider unavailable');}});
  assert.equal(report.status,'needs-review');assert.deepEqual(report.coverage.missingContent,[5]);assert.equal(wholeCalls,0);
  assert.equal((await s.mockStore.get('mahdis',a.id)).combinedOverall,undefined);
});
test('A transcript changed during whole review prevents stale publication and restart does not buy another review',async t=>{
  const s=await setup(t),a=attempt();await s.mockStore.update('mahdis',a.id,()=>a);let calls=0;
  const opts={...s,callModel:async(prompt,context)=>{calls++;await s.mockStore.update('mahdis',a.id,current=>{current.responses[0].transcript='Changed response';return current;});return judgment(context.wholeMockEntries);}};
  const report=await combined.recover(opts);assert.equal(report.status,'needs-review');assert.equal(report.failure.code,'COMBINED_STALE');
  await combined.recover(opts);assert.equal(calls,1);assert.equal((await s.mockStore.get('mahdis',a.id)).combinedOverall,undefined);
});
