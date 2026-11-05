'use strict';
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {create}=require('../../full-mock/delivery-reassessment'),{loadPaper}=require('../../full-mock/paper'),session=require('../../full-mock/session'),assessment=require('../../full-mock/assessment'),adapters=require('../../full-mock/adapters'),{inputHash}=require('../../full-mock/aggregation');
async function fixture(t,assess){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'delivery-review-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const store=require('../../full-mock/store').createStore({directory}),paper=loadPaper(),id=randomUUID(),owner='synthetic-student',snap=assessment.snapshot(),bytes=Buffer.from('original synthetic recording'),segment=randomUUID();
 await store.create(owner,id,paper,(id,at)=>session.create(id,paper,at,{preview:true,assessmentSnapshot:snap}),1000);
 const q=paper.questions.find(c=>c.question.type==='di'),number=paper.questions.indexOf(q)+1;
 await store.putChunk(owner,id,segment,0,'audio/webm',bytes);
 await store.update(owner,id,s=>{session.end(s,paper,1000);s.assessment.status='complete';
  for(let i=0;i<paper.questions.length;i++){
   const item=paper.questions[i],r=s.responses[i+1];
   if(item.id===q.id)r.segments.push({id:segment,chunkCount:1,finished:true,cancelled:false,mime:'audio/webm',chunks:{0:{stored:true,bytes:bytes.length,sha256:require('../../full-mock/store').hash(bytes)}}});
   s.assessment.items[item.id]={status:'assessed',inputHash:inputHash(r),snapshotHash:s.assessment.snapshotHash,result:adapters.result(item.question,adapters.maxima(item.question)),stages:{delivery:{status:'complete',traits:{pronunciation:{score:5},fluency:{score:5}}}}};
  }return s;});
 const engine=assessment.createEngine({store});const api=create({store,validate:engine.validate,assess});
 return {store,paper,id,owner,q,number,api,bytes,directory};
}
async function secondRecording(f){
 const candidate=f.paper.questions.find(q=>q.question.type==='rs'),number=f.paper.questions.indexOf(candidate)+1,segment=randomUUID(),bytes=Buffer.from('second original recording');
 await f.store.putChunk(f.owner,f.id,segment,0,'audio/webm',bytes);
 await f.store.update(f.owner,f.id,state=>{const response=state.responses[number];response.segments=[{id:segment,chunkCount:1,finished:true,cancelled:false,mime:'audio/webm',chunks:{0:{stored:true,bytes:bytes.length,sha256:require('../../full-mock/store').hash(bytes)}}}];state.assessment.items[candidate.id].inputHash=inputHash(response);return state;});
 return {candidate,number,bytes};
}
module.exports={fixture,secondRecording};
