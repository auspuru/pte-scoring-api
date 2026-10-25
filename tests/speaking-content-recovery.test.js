'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createStore}=require('../writing-lab-store'),{recoverLatest,recoverRecent}=require('../speaking-content-recovery'),bank=require('../content/speaking-bank');
const uid='mahabir1',id=()=>crypto.randomUUID(),q=bank.questions.find(q=>q.id==='rl-1'),text=q.sample,logger={info(){}};
const review=()=>({total:5,overview:'Connected main ideas with useful support.',strengths:['Clear main meaning.'],improvements:[],coverage:q.facts.map((_,point)=>({point,status:'covered',evidence:text.slice(0,100),feedback:'The main point is represented.'})),summaryAssessment:{responseForm:'connected',mainMessageAccurate:true,relationshipsClear:true,sufficientSubstance:true,mostlyAccurate:true,materialMeaningChange:false,speakerAttributionClear:true,evidence:text.slice(0,100),reason:'Enough connected and accurate meaning.'}});
async function setup(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'content-recovery-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const practiceStore=createStore(null,path.join(dir,'practice'),{table:'speaking_lab_attempts'}),mockStore=createStore(null,path.join(dir,'mock'),{table:'speaking_mock_attempts'});return {practiceStore,mockStore,username:uid,operation:'test-repair-1',logger};}
const pending=()=>({scoringMode:'local',total:null,maximum:6,pronunciation:{score:4},fluency:{score:5},deliveryComparisons:{azure:{score:4},gpt:{score:5}},deliveryComparisonHistory:{azure:[{score:3}]}});
test('Repair targets the latest submitted practice response once and preserves all delivery scores',async t=>{
 const s=await setup(t),older=id(),latest=id(),result=pending();
 await s.practiceStore.update(uid,older,()=>({id:older,questionId:q.id,status:'submitted',startedAt:1,transcript:text,result:pending()}));
 await s.practiceStore.update(uid,latest,()=>({id:latest,questionId:q.id,status:'submitted',startedAt:2,transcript:text,recording:{hash:'saved'},result}));
 let calls=0;const options={...s,callModel:async()=>{calls++;return review();}};
 const report=await recoverLatest(options);assert.equal(report.attemptId,latest);assert.equal(report.recovered,1);assert.equal(report.status,'complete');assert.equal(calls,1);
 const saved=await s.practiceStore.update(uid,latest,a=>a);assert.equal(saved.result.total,6);assert.equal(saved.result.modelSuggestedTotal,5);
 for(const key of ['pronunciation','fluency','deliveryComparisons','deliveryComparisonHistory'])assert.deepEqual(saved.result[key],result[key]);
 assert.equal((await s.practiceStore.update(uid,older,a=>a)).result.total,null);assert.deepEqual(saved.contentScoreHistory[0].previous,result);
 const later=id();await s.practiceStore.update(uid,later,()=>({id:later,questionId:q.id,status:'submitted',startedAt:3,transcript:text,result:pending()}));
 await recoverLatest(options);assert.equal(calls,1,'An unchanged repair flag must never process a later attempt on restart.');assert.equal((await s.practiceStore.update(uid,later,a=>a)).result.total,null);
 await recoverLatest({...options,operation:'pinned-repair',attemptId:older,kind:'practice'});assert.equal(calls,2);assert.equal((await s.practiceStore.update(uid,older,a=>a)).result.total,6);assert.equal((await s.practiceStore.update(uid,later,a=>a)).result.total,null);

});
test('Historical recovery is limited to the named user, task types and fixed time window',async t=>{
 const s=await setup(t),target=id(),excludedType=id(),future=id(),otherUser=id(),mock=id();
 const add=(store,username,attemptId,questionId,startedAt)=>store.update(username,attemptId,()=>({id:attemptId,questionId,status:'submitted',startedAt,transcript:text,result:pending()}));
 await add(s.practiceStore,uid,target,q.id,10);await add(s.practiceStore,uid,excludedType,'sgd-2',11);
 await add(s.practiceStore,uid,future,q.id,21);await add(s.practiceStore,'pppp',otherUser,q.id,12);
 await s.mockStore.update(uid,mock,()=>({id:mock,status:'submitted',startedAt:15,questions:[q,{...q,id:'sgd-2',type:'sgd'}],responses:[{recording:{hash:'one'},transcript:text,content:pending()},{recording:{hash:'two'},transcript:text,content:pending()}]}));
 let calls=0;const options={...s,questionTypes:['di','rl'],startedAfter:1,startedBefore:20,callModel:async()=>{calls++;return review();}};
 const report=await recoverRecent(options);assert.equal(report.candidates,2);assert.equal(report.recovered,2);assert.equal(calls,2);
 const saved=await s.mockStore.update(uid,mock,a=>a);assert.equal(saved.responses[0].content.total,6);assert.equal(saved.responses[1].content.total,null);
 for(const [user,attemptId] of [[uid,excludedType],[uid,future],['pppp',otherUser]])assert.equal((await s.practiceStore.update(user,attemptId,a=>a)).result.total,null);
 await recoverRecent(options);assert.equal(calls,2,'Restart must not repeat provider calls.');
 await assert.rejects(recoverRecent({...options,startedBefore:undefined}),/Invalid historical/);
});
test('Mock repair fills only missing content, retaining recordings, both providers and the whole-test assessment',async t=>{
 const s=await setup(t),mock=id(),overall={overallScore:80},providers={gpt:{pronunciation:{score:4}},azure:{fluency:{score:5}}};
 await s.mockStore.update(uid,mock,()=>({id:mock,status:'submitted',startedAt:10,questions:[{type:'intro'},q,q],overall,responses:[null,{recording:{hash:'one'},transcript:text,content:pending(),...providers},{recording:{hash:'two'},transcript:text,content:{total:0,scoringMode:'ai'},...providers}]}));
 let calls=0;const r=await recoverLatest({...s,callModel:async()=>{calls++;return review();}});assert.equal(r.kind,'mock');assert.equal(calls,1);assert.equal(r.recovered,1);
 const a=await s.mockStore.update(uid,mock,a=>a);assert.deepEqual(a.overall,overall);assert.equal(a.responses[1].content.total,6);assert.equal(a.responses[2].content.total,0);
 for(const entry of a.responses.slice(1)){assert.deepEqual(entry.gpt,providers.gpt);assert.deepEqual(entry.azure,providers.azure);assert(entry.recording.hash);}
});
test('Failed semantic reviews and changed transcripts never become fabricated or stale confirmed marks',async t=>{
 const s=await setup(t),a=id();await s.practiceStore.update(uid,a,()=>({id:a,status:'submitted',questionId:q.id,startedAt:1,transcript:text,result:pending()}));
 const r=await recoverLatest({...s,callModel:async()=>{const raw=review();raw.total=6;raw.summaryAssessment.materialMeaningChange=true;return raw;}});
 assert.equal(r.status,'needs-review');assert.equal((await s.practiceStore.update(uid,a,a=>a)).result.total,null);
 const r2=await recoverLatest({...s,operation:'test-repair-2',callModel:async()=>{await s.practiceStore.update(uid,a,a=>({...a,transcript:'A newer edit.'}));return review();}});
 assert.equal(r2.status,'needs-review');const saved=await s.practiceStore.update(uid,a,a=>a);assert.equal(saved.transcript,'A newer edit.');assert.equal(saved.result.total,null);
});

test('Pinned DI recovery uses the provider-compatible Academy request and preserves all completed assessments',async t=>{
 const s=await setup(t),mock=id(),question={id:'saved-di',type:'di',title:'Trips',imageCategory:'line',facts:['Trips rose from 20 to 80.']};
 const words='Trips rose from 20 to 80.',overall={status:'assessed',overallScore:80},gpt={status:'assessed',pronunciation:{score:4}},azure={status:'assessed',fluency:{score:5}},recording={hash:'saved-original',data:'saved-original-audio'};
 const existing={total:4,maximum:6,scoringMode:'ai'};
 await s.mockStore.update(uid,mock,()=>({id:mock,status:'submitted',startedAt:10,questions:[question,question],overall,responses:[
   {recording,transcript:words,content:{total:null,scoringMode:'unavailable',contentStatus:'unavailable'},gpt,azure},
   {recording,transcript:words,content:existing,gpt,azure}]}));
 const academy=require('../describe-image-academy'),format=require('../speaking-judge-format');let calls=0;
 const options={...s,attemptId:mock,kind:'mock',questionTypes:['di'],callModel:async(prompt,context)=>{
   calls++;const request=format.request(prompt,'test-model',context);assert(!JSON.stringify(request.tools[0].input_schema).includes('maxItems'));
   return format.response({stop_reason:'tool_use',content:[{type:'tool_use',name:academy.NAME,input:{judgment:{score:6,relevance:'image-specific',accuracy:'accurate',scoreImpact:null,requiredEvidence:{quote:words,factIndices:[0],kind:'relationship'},inaccuracy:null,otherEvidence:[]},reason:'The main increase is accurate and connected.',nextStep:'Keep the clear comparison.'}}]},context);
 }};
 const report=await recoverLatest(options);assert.equal(report.recovered,1);assert.equal(report.unavailable,0);assert.equal(report.scores[0].total,6);
 const saved=await s.mockStore.get(uid,mock);assert.deepEqual(saved.overall,overall);assert.deepEqual(saved.responses[1].content,existing);
 assert.deepEqual(saved.responses[0].recording,recording);assert.deepEqual(saved.responses[0].gpt,gpt);assert.deepEqual(saved.responses[0].azure,azure);
 await recoverLatest(options);assert.equal(calls,1,'A restart cannot buy the same recovery again.');
});
