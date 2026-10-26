'use strict';
const path=require('node:path'),report=require('./speaking-mock-report'),scoring=require('./speaking-scoring');
const {createJobs,createWorker,stage,disposition,hash}=require('./scoring-jobs');
const academy=require('./visual-academy-client');
const VERSION='progressive-speaking-v1';
const complete=a=>{const s=report.summarize({...a,status:'submitted'});return s.openai.status==='assessed'&&s.azure.status==='assessed';};
const identity=(a,index)=>hash({version:VERSION,id:a.id,index,recording:a.responses[index].recording.hash,question:a.questions[index],profile:a.assessmentProfile?.diBackend||'academy'});
const missing=(a,i)=>['gpt','azure'].some(p=>report.questionResult({...a,status:'submitted'},a.questions[i],a.responses[i],i,p).total===null);
function createMockJobs({pool,directory,store,transcribe,assessGpt,assessAzure,callModel,gradeResponse,academyClient=academy.createAcademyClient(),includeLegacy=true,now=Date.now}={}){
  const jobs=createJobs({pool,directory:path.join(directory,'answer-jobs'),table:'speaking_answer_jobs',now});let cursor='',sweeping=false,sweeper;
  const worker=createWorker({store:jobs,now,concurrency:3,onSettled:row=>publish(row.owner,row.group_id),run:async ctx=>{
    const d=ctx.data,saved=await store.getResponse(ctx.row.owner,ctx.row.group_id,d.index);
    if(!saved?.response?.recording||saved.response.recording.hash!==d.recordingHash||hash(saved.question)!==d.questionHash)return{status:'needs_attention'};
    const q=saved.question,original=saved.response,recording=original.recording;
    const response=()=>({...original,...ctx.data.patch,recording});
    if(gradeResponse){await stage(ctx,'fixture',()=>gradeResponse(q,recording,response()),{now,accept:(data,value)=>Object.assign(data.patch,value),valid:()=>['gpt','azure'].every(p=>report.questionResult({status:'submitted'},q,response(),d.index,p).total!==null)});return disposition(ctx.data,!['gpt','azure'].some(p=>report.questionResult({status:'submitted'},q,response(),d.index,p).total===null),now);}
    if(!response().transcript&&response().transcriptionStatus!=='assessed')await stage(ctx,'transcription',()=>transcribe(recording),{now,valid:v=>typeof v==='string',accept:(data,v)=>{if(typeof v==='string'){data.patch.transcript=v;data.patch.transcriptionStatus='assessed';}}});
    if(response().transcriptionStatus!=='assessed'&&!response().transcript)return disposition(ctx.data,false,now);
    const text=response().transcript||'',tasks=[];
    const retain=(data,provider,value)=>{if(!value)return;const prior={...original,...data.patch},next={...value,status:'assessed',recordingHash:recording.hash,assessedAt:now()};
      for(const name of ['pronunciation','fluency'])if(report.deliveryTraits({recording,[provider]:next},provider)[name]===null&&report.deliveryTraits(prior,provider)[name]!==null)next[name]=prior[provider]?.[name];data.patch[provider]=next;};
    const contentGated=()=>report.validContent(q,response().content)&&response().content.total===0;
    if(q.type==='di'&&text.trim()){
      if(!report.validContent(q,response().content)||report.deliveryTraits(response(),'gpt').missing.length&&!contentGated())tasks.push((async()=>{
        try{
          if(!ctx.data.remote&&ctx.data.remotePrepared){try{const found=await academyClient.poll(ctx.data.remotePrepared,recording.hash);if(found.inputReady!==false||found.status==='ready')await ctx.save(data=>{data.remote=data.remotePrepared;});}catch(error){if(error.status!==404)throw error;}}
          if(!ctx.data.remote){const requested=[];if(!report.validContent(q,response().content))requested.push('content');if(report.deliveryTraits(response(),'gpt').missing.length&&!contentGated())requested.push('delivery');
            const id=hash({job:ctx.row.id,requested});await ctx.save(data=>{data.remoteRequest={id,requested};});
            const receipt=await academyClient.submit({id,requested,question:q,recording,transcript:text,expected:ctx.data.remotePrepared,onPrepared:receipt=>ctx.save(data=>{data.remotePrepared=receipt;})});await ctx.save(data=>{data.remote=receipt;});}
          const remote=await academyClient.poll(ctx.data.remote,recording.hash);
          await ctx.save(data=>{const content=academy.contentResult(remote.content,remote.feedback);if(content)data.patch.content=content;retain(data,'gpt',academy.deliveryResult(remote.delivery,recording.hash,now));data.remoteStatus=remote.status;data.remoteFailures=remote.failures||[];data.stages.academy={status:remote.status==='needs_attention'?'needs_attention':remote.status==='ready'?'ready':'waiting'};});
        }catch(error){await ctx.save(data=>{const attempts=(data.stages.academy?.attempts||0)+1;data.stages.academy={status:attempts>=5||[400,401,403,409].includes(error.status)?'needs_attention':'retry_wait',attempts,failure:'academy_transport',nextAt:now()+Math.min(60000,5000*attempts)};});}
      })());
    }else{
      if(!report.validContent(q,response().content))tasks.push(stage(ctx,'content',()=>scoring.grade(q,text,callModel,{academyDescribeImage:true}),{now,valid:v=>report.validContent(q,v),accept:(data,v)=>{if(report.validContent(q,v))data.patch.content=v;}}));
      if(!contentGated()&&report.deliveryTraits(response(),'gpt').missing.length)tasks.push(stage(ctx,'gpt',()=>assessGpt(recording,{question:q,transcript:text}),{now,accept:(data,v)=>retain(data,'gpt',v),valid:()=>!report.deliveryTraits(response(),'gpt').missing.length}));
    }
    if(!contentGated()&&report.deliveryTraits(response(),'azure').missing.length)tasks.push(stage(ctx,'azure',()=>assessAzure(recording,{question:q,transcript:text,transcribe,chunkCache:ctx.data.azureChunks||{},checkpointChunk:(key,value)=>ctx.save(data=>{data.azureChunks||={};data.azureChunks[key]={...data.azureChunks[key],...value};})}),{now,accept:(data,v)=>retain(data,'azure',v),valid:()=>!report.deliveryTraits(response(),'azure').missing.length}));
    await Promise.allSettled(tasks);
    return disposition(ctx.data,['gpt','azure'].every(p=>report.questionResult({status:'submitted'},q,response(),d.index,p).total!==null),now);
  }});
  async function ensure(uid,a){if(!a)return;for(let i=0;i<a.questions.length;i++){const r=a.responses[i];if(a.questions[i].type==='intro'||!r?.recording||!missing(a,i))continue;
    const patch={};for(const name of ['transcript','transcriptionStatus','content','gpt','azure'])if(r[name]!=null)patch[name]=r[name];
    await jobs.enqueue({id:identity(a,i),owner:uid,groupId:a.id,inputHash:hash({recording:r.recording.hash,question:a.questions[i]}),data:{index:i,recordingHash:r.recording.hash,questionHash:hash(a.questions[i]),patch,stages:{},version:VERSION}});
  }await publish(uid,a.id);await worker.wake();}
  async function hydrate(uid,a){if(!a)return a;const result=structuredClone(a),rows=await jobs.list(uid,a.id);for(const row of rows){const d=row.data,i=d.index;if(a.responses[i]?.recording?.hash!==d.recordingHash||hash(a.questions[i])!==d.questionHash)continue;
    const patch={...d.patch};for(const provider of ['gpt','azure'])if(patch[provider])for(const trait of ['pronunciation','fluency'])if(report.deliveryTraits(a.responses[i],provider)[trait]!==null&&report.deliveryTraits({...a.responses[i],[provider]:patch[provider]},provider)[trait]===null)patch[provider][trait]=a.responses[i][provider]?.[trait];
    Object.assign(result.responses[i],patch);}
    return result;
  }
  async function publish(uid,id){const a=await store.get(uid,id,{omitMockAudio:true});if(!a||a.status!=='submitted'||a.assessment?.status==='ready'&&complete(a))return;
    const candidate=await hydrate(uid,a);if(!complete(candidate))return;
    await store.update(uid,id,current=>{if(current.status!=='submitted'||hash(current.questions)!==hash(candidate.questions))return current;for(let i=0;i<current.questions.length;i++){const patch=candidate.responses[i];if(!patch||current.responses[i]?.recording?.hash!==patch.recording?.hash)continue;const {recording,manualDeliveryOverrides,...marks}=patch;Object.assign(current.responses[i],marks);}
      if(complete(current)){current.grading={status:'complete'};current.assessment={status:'ready',version:VERSION,publishedAt:now()};delete current.lease;}return current;});
  }
  async function status(uid,a){const ready=a.status==='submitted'&&complete(a);if(ready)return{status:'ready',ready:true,accountedFor:a.questionCount,total:a.questionCount};
    const candidate=await hydrate(uid,a),rows=await jobs.list(uid,a.id),s=report.summarize({...candidate,status:'submitted'}),held=rows.some(r=>r.status==='needs_attention');
    const accountedFor=s.openai.questions.filter((r,i)=>r.total!==null&&s.azure.questions[i]?.total!==null).length;
    return{status:held?'delayed':'preparing',ready:false,accountedFor,total:a.questionCount,delayed:held||now()-(a.finishedAt||now())>600000};
  }
  async function sweep(){if(sweeping)return;sweeping=true;try{const rows=await store.scanForScoring(cursor);cursor=rows.length?rows.at(-1).data.id:'';for(const {username,data}of rows){if(!includeLegacy&&data.assessmentProfile?.mode!=='progressive-v1')continue;let a=data;if(a.status==='active'&&now()>=a.deadline)a=await store.update(username,a.id,current=>{if(current.status==='active'&&now()>=current.deadline){current.status='submitted';current.finishedAt=now();current.grading={status:'pending'};}return current;});if(a.assessment?.status!=='ready')await ensure(username,a);}}finally{sweeping=false;}}
  return{ensure,hydrate,status,publish,jobs,async repair(uid,id,{jobId,stage:stageName,operation,acknowledgeUncertain=false}={}){const row=await jobs.get(uid,jobId);if(!row||row.group_id!==id)throw Object.assign(Error('Job not found.'),{status:404});if(!['transcription','content','gpt','azure','academy'].includes(stageName))throw Object.assign(Error('Invalid repair stage.'),{status:400});if(stageName==='academy'&&row.data.remote&&row.data.remoteFailures?.length){const remote=await academyClient.poll(row.data.remote,row.data.recordingHash);if(remote.inputReady===false){const saved=await store.getResponse(uid,id,row.data.index);await academyClient.submit({id:row.data.remote.id,requested:row.data.remoteRequest.requested,question:saved.question,recording:saved.response.recording,transcript:row.data.patch.transcript||saved.response.transcript,expected:row.data.remote});}await academyClient.retry(row.data.remote,{stages:row.data.remoteFailures.map(f=>f.stage),operation,acknowledgeUncertain});}await jobs.retry(uid,jobId,{stages:[stageName],operation,acknowledgeUncertain});await worker.wake();return{status:'queued',jobId};},async diagnostics(uid,id){const a=await store.get(uid,id,{omitMockAudio:true});if(!a)return null;return{attemptId:id,...await status(uid,a),jobs:(await jobs.list(uid,id)).map(r=>({id:r.id,index:r.data.index,status:r.status,updatedAt:Number(r.updated_at),stages:Object.fromEntries(Object.entries(r.data.stages||{}).map(([name,s])=>[name,{status:s.status,attempts:s.attempts||0,code:s.failure||null}])),remoteFailures:r.data.remoteFailures||[]}))};},async start(){await jobs.initialise();await worker.start();await sweep();sweeper=setInterval(()=>sweep().catch(()=>console.warn('[speaking-jobs] recovery scan will resume')),15000);sweeper.unref?.();},async stop(){clearInterval(sweeper);await worker.stop();},wait:worker.wait};
}
module.exports={VERSION,complete,identity,createMockJobs};
