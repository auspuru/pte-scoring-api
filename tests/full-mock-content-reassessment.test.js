'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {reassess}=require('../full-mock/content-reassessment'),{loadPaper}=require('../full-mock/paper'),session=require('../full-mock/session'),assessment=require('../full-mock/assessment'),adapters=require('../full-mock/adapters'),{inputHash,aggregate}=require('../full-mock/aggregation');
async function fixture(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'full-content-reassessment-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const store=require('../full-mock/store').createStore({directory}),paper=loadPaper(),id=randomUUID(),snap=assessment.snapshot();
 await store.create('sukhpal',id,paper,(id,at)=>session.create(id,paper,at,{preview:true,assessmentSnapshot:snap}),1000);
 await store.update('sukhpal',id,s=>{session.end(s,paper,1000);s.assessment.status='complete';
  for(let i=0;i<paper.questions.length;i++){
   const item=paper.questions[i],q=item.question,r=s.responses[i+1],semantic=['di','rl','sgd','rts'].includes(q.type);
   if(semantic)r.segments.push({id:randomUUID(),chunkCount:1,finished:true,cancelled:false,mime:'audio/webm',chunks:{}});
   const result=adapters.result(q,semantic?{content:2,pronunciation:4,fluency:5}:adapters.maxima(q));
   s.assessment.items[item.id]={status:'assessed',inputHash:inputHash(r),snapshotHash:s.assessment.snapshotHash,result,stages:semantic?{
    transcription:{status:'complete',value:q.sample||'Saved response.'},content:{status:'complete',value:{total:2}},
    delivery:{status:'complete',traits:{pronunciation:{score:4,provider:'azure'},fluency:{score:5,provider:'azure'}}}}:{}};
  }return s;});
 return {store,paper,id,username:'sukhpal',operation:'sukhpal-full-test',startedBefore:2000,logger:{info(){}},grade:async()=>({total:5,maximum:6,scoringMode:'ai',contentStatus:'assessed',version:'test'})};
}
test('Scoped full-mock reassessment changes only content and native totals, preserving snapshot, Azure, other sections and history',async t=>{
 const f=await fixture(t),before=(await f.store.get(f.username,f.id)).state;let calls=0;
 const options={...f,grade:async()=>{calls++;return f.grade();}};
 const report=await reassess(options);assert.equal(report.status,'complete');assert(report.updated>0);assert.equal(calls,report.updated);
 const after=(await f.store.get(f.username,f.id)).state;assert.deepEqual(after.assessment.snapshot,before.assessment.snapshot);assert(aggregate(f.paper,after).ready);
 for(const c of f.paper.questions){const old=before.assessment.items[c.id],next=after.assessment.items[c.id];
  if(['di','rl','sgd','rts'].includes(c.question.type)){
   assert.equal(next.result.scores.content,5);assert.equal(next.result.scores.pronunciation,4);assert.equal(next.result.scores.fluency,5);
   assert.deepEqual(next.stages.delivery,old.stages.delivery);assert.deepEqual(next.contentReassessmentHistory[0].result,old.result);
   assert.equal(next.result.scoringModel,'gpt-6.1-sol');
  }else assert.deepEqual(next,old);
 }
 await reassess(options);assert.equal(calls,report.updated,'Restart must not repeat paid requests');
 await assert.rejects(reassess({...options,username:'mahabir1'}));
});
test('Failed content reviews preserve the prior native score and leave the completed report readable',async t=>{
 const f=await fixture(t),before=(await f.store.get(f.username,f.id)).state;
 const report=await reassess({...f,grade:async()=>{throw Error('Provider unavailable');}});
 assert.equal(report.status,'needs-review');assert.equal(report.updated,0);assert(report.unavailable>0);
 const after=(await f.store.get(f.username,f.id)).state;assert.deepEqual(after.assessment.items,before.assessment.items);assert(aggregate(f.paper,after).ready);
});
