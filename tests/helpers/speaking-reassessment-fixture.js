'use strict';
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),express=require('express');
const completion=require('../../speaking-mock-completion'),report=require('../../speaking-mock-report'),{hash}=require('../../scoring-jobs'),{installSpeakingMock}=require('../../speaking-mock');
const raw={version:'synthetic-continuous',pronunciation:{score:4,raw:80},fluency:{score:3,raw:60}};
const content=q=>({status:'assessed',scoringMode:'ai',contentStatus:'assessed',total:report.contentMaximum(q),maximum:report.contentMaximum(q),overview:'Confirmed synthetic content.',strengths:[],improvements:[]});
async function fixture(t,{policy=true,...options}={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-available-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const app=express();app.use(express.json());const owner='synthetic-speaking-student',id=crypto.randomUUID(),bytes=Buffer.from('retained synthetic original recording'),recording={mime:'audio/webm',data:bytes.toString('base64'),hash:hash(bytes)};
 const service=installSpeakingMock(app,{directory,verifyToken:token=>token===owner?owner:null,getAccount:async uid=>uid===owner?{username:owner}:null,backgroundEnabled:true,quietRecording:async()=>false,
  transcribe:async()=> 'A clear synthetic response.',assessAzure:async()=>{throw Object.assign(Error('Azure unavailable'),{uncertain:true});},
  deliveryReassessment:{assess:async()=>raw,gradeContent:async q=>content(q)},...options});t.after(()=>service.stop());
 const paper=require('../../content/speaking-mocks').papers[0],questions=structuredClone(paper.questions),responses=questions.map(q=>q.type==='intro'?{skipped:true}:{recording:structuredClone(recording),transcript:'A clear synthetic response.',transcriptionStatus:'assessed',content:content(q),azure:{status:'assessed',recordingHash:recording.hash,pronunciation:{score:2},fluency:{score:1}}});
 await service.store.update(owner,id,()=>({id,paperId:paper.id,version:paper.version||'saved',title:paper.title,questionCount:27,questions,responses,index:questions.length,status:'submitted',startedAt:1000,deadline:2000,finishedAt:2001,grading:{status:'complete'},assessment:{status:'ready'},assessmentProfile:{mode:'progressive-v1',owner,diBackend:'portal-gpt',...(policy?{completionPolicy:completion.policy(questions)}:{})},integrity:{events:[]}}));
 return {app,service,store:service.store,owner,id,questions,index:questions.findIndex(q=>q.type==='di'),recording,bytes,directory};
}
module.exports={fixture,content,raw};
