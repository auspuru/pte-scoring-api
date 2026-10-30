'use strict';
const {digest}=require('./paper');
const {aggregate,inputHash,nativeValid}=require('./aggregation');
const adapters=require('./adapters');
const TYPES=new Set(['di','rl','sgd','rts']);
const fail=()=>Error('Full mock content reassessment could not finish.');

async function reassess({store,username,operation,startedBefore,callModel,logger=console,
 grade=(q,text,call)=>require('../speaking-scoring').grade(q,text,call,{academyDescribeImage:true}),now=Date.now}){
 if(username!=='sukhpal'||typeof operation!=='string'||!/^[a-zA-Z0-9:_-]{1,90}$/.test(operation)||!Number.isFinite(startedBefore))throw fail();
 const rows=await store.list(username);
 const prior=rows.find(s=>s.contentReassessment?.operation===operation);
 if(prior){logger.info('[full-mock-content-reassessment]',JSON.stringify({...prior.contentReassessment,existing:true}));return prior.contentReassessment;}
 const chosen=rows.filter(s=>s.status==='submitted'&&s.createdAt<=startedBefore).sort((a,b)=>b.createdAt-a.createdAt)[0];
 if(!chosen)throw fail();
 const record=await store.get(username,chosen.id),before=aggregate(record.paper,record.state);
 logger.info('[full-mock-content-reassessment]',JSON.stringify({operation,attemptId:chosen.id,username,status:'selected',assessmentStatus:record.state.assessment?.status,assessedCount:before.assessedCount,expectedCount:before.expectedCount}));
 if(record.state.assessment?.status==='processing'||record.state.assessment?.lease?.expiresAt>now())throw fail();
 const snapshotHash=record.state.assessment.snapshotHash;
 await store.update(username,chosen.id,s=>{
  if(s.contentReassessment?.status==='processing'||s.assessment.snapshotHash!==snapshotHash)throw fail();
  s.contentReassessment={operation,attemptId:chosen.id,username,model:'gpt-6.1-sol',status:'processing',startedAt:now(),reviewed:0,updated:0,unavailable:0};return s;
 });
 logger.info('[full-mock-content-reassessment]',JSON.stringify({operation,attemptId:chosen.id,username,status:'started'}));
 const report={operation,attemptId:chosen.id,username,model:'gpt-6.1-sol',reviewed:0,updated:0,unavailable:0,scores:[]};
 for(let i=0;i<record.paper.questions.length;i++){
  const candidate=record.paper.questions[i],q=candidate.question;if(!TYPES.has(q.type))continue;
  const response=record.state.responses[i+1],old=record.state.assessment.items[candidate.id];
  if(!response.segments.some(s=>!s.cancelled&&s.chunkCount>0))continue;
  report.reviewed++;
  try{
   const text=old.stages?.transcription?.value;
   if(old.status!=='assessed'||old.snapshotHash!==snapshotHash||!nativeValid(old.result,adapters.maxima(q))||typeof text!=='string'||!text.trim()||old.inputHash!==inputHash(response))throw fail();
   const content=await grade(q,text,callModel);
   if(!Number.isInteger(content?.total)||content.total<0||content.total>6||content.maximum!==6||content.scoringMode!=='ai'||content.contentStatus!=='assessed'||content.score_provisional||content.needs_semantic_review)throw fail();
   const delivery=old.stages?.delivery;
   let scores;
   if(content.total===0)scores={content:0,pronunciation:0,fluency:0};
   else if(delivery?.status==='complete')scores={content:content.total,pronunciation:delivery.traits.pronunciation.score,fluency:delivery.traits.fluency.score};
   else if(nativeValid(old.result,adapters.maxima(q))&&!old.result.gated)scores={...old.result.scores,content:content.total};
   else throw fail();
   const result=adapters.result(q,scores,{nativeVersion:content.version,scoringProvider:'openai',scoringModel:'gpt-6.1-sol',...(content.total===0?{gated:true,reason:'Native Content gate'}:{})});
   await store.update(username,chosen.id,s=>{
    const current=s.assessment.items[candidate.id];
    if(s.contentReassessment?.operation!==operation||s.assessment.snapshotHash!==snapshotHash||digest(current)!==digest(old)||inputHash(s.responses[i+1])!==old.inputHash)throw fail();
    current.contentReassessmentHistory=[...(current.contentReassessmentHistory||[]),{operation,at:now(),result:structuredClone(current.result),content:structuredClone(current.stages.content)}].slice(-3);
    current.stages.content={status:'complete',value:{...content,scoringProvider:'openai',scoringModel:'gpt-6.1-sol'},reassessmentOperation:operation};
    current.result=result;current.assessedAt=now();s.contentReassessment.updated++;return s;
   });
   report.updated++;report.scores.push({id:candidate.id,type:q.type,content:content.total});
  }catch{report.unavailable++;}
 }
 report.status=report.unavailable?'needs-review':'complete';
 await store.update(username,chosen.id,s=>{
  if(s.contentReassessment?.operation!==operation)throw fail();
  const after=aggregate(record.paper,s);if(before.ready&&!after.ready)throw fail();
  s.contentReassessment={...s.contentReassessment,...report,finishedAt:now(),speaking:after.profiles.speaking.practiceIndexRange};return s;
 });
 logger.info('[full-mock-content-reassessment]',JSON.stringify(report));return report;
}

async function run(options){
 // One scoped operation reuses the production connection settings. Credentials
 // stay in-process; no credentials, transcripts or audio appear in logs.
 const url=process.env.PGURL||process.env.DATABASE_URL||process.env.DATABASE_PUBLIC_URL;
 let pool;
 try{
  if(url){const local=/(\blocalhost\b|127\.0\.0\.1|@\/|host=\/)/.test(url);pool=new(require('pg').Pool)({connectionString:url,max:1,connectionTimeoutMillis:10000,ssl:process.env.PGSSL==='disable'||local&&process.env.PGSSL!=='require'?false:{rejectUnauthorized:false}});pool.on('error',()=>{});}
  const directory=require('node:path').join(process.env.RAILWAY_VOLUME_MOUNT_PATH||(process.env.NODE_ENV==='production'?'/app/data':'./data'),'full-mock');
  return await reassess({...options,store:require('./store').createStore({pool,directory})});
 }finally{await pool?.end();}
}
module.exports={reassess,run};
