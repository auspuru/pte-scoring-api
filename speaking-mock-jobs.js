'use strict';
const path=require('node:path'),report=require('./speaking-mock-report'),scoring=require('./speaking-scoring');
const {createJobs,createWorker,stage,disposition,hash}=require('./scoring-jobs');
const academy=require('./visual-academy-client');
const VERSION='progressive-speaking-v1';
const complete=a=>report.summarize({...a,status:'submitted'}).azure.status==='assessed';
const identity=(a,index)=>hash({version:VERSION,id:a.id,index,recording:a.responses[index].recording.hash,question:a.questions[index],profile:a.assessmentProfile?.diBackend||'academy'});
const missing=(a,i)=>{const result=report.questionResult({...a,status:'submitted'},a.questions[i],a.responses[i],i,'azure');return !result.excluded&&result.total===null;};
function createMockJobs({pool,directory,store,transcribe,assessGpt,assessAzure,callModel,gradeResponse,academyClient=academy.createAcademyClient(),includeLegacy=true,now=Date.now}={}){
  const jobs=createJobs({pool,directory:path.join(directory,'answer-jobs'),table:'speaking_answer_jobs',now});let cursor='',sweeping=false,sweeper;
  const worker=createWorker({store:jobs,now,concurrency:3,onSettled:row=>publish(row.owner,row.group_id),run:async ctx=>{
    const d=ctx.data,saved=await store.getResponse(ctx.row.owner,ctx.row.group_id,d.index);
    if(!saved?.response?.recording||saved.response.recording.hash!==d.recordingHash||hash(saved.question)!==d.questionHash)return{status:'needs_attention'};
    const q=saved.question,original=saved.response,recording=original.recording;
    if(report.validExclusion(d.assessmentExclusion,q,original,d.index,ctx.row.group_id))return{status:'ready'};
    const response=()=>({...original,...ctx.data.patch,recording});
    await ctx.save(data=>{for(const name of ['gpt',...(report.validContent(q,response().content)?['academy']:[])])if(data.stages[name])data.stages[name]={...data.stages[name],status:'retired',retirement:'azure-only-v1'};});
    if(gradeResponse){await stage(ctx,'fixture',()=>gradeResponse(q,recording,response()),{now,accept:(data,value)=>Object.assign(data.patch,value),valid:()=>report.questionResult({status:'submitted'},q,response(),d.index,'azure').total!==null});return disposition(ctx.data,report.questionResult({status:'submitted'},q,response(),d.index,'azure').total!==null,now);}
    if(!response().transcript&&response().transcriptionStatus!=='assessed')await stage(ctx,'transcription',()=>transcribe(recording),{now,valid:v=>typeof v==='string',accept:(data,v)=>{if(typeof v==='string'){data.patch.transcript=v;data.patch.transcriptionStatus='assessed';}}});
    if(response().transcriptionStatus!=='assessed'&&!response().transcript)return disposition(ctx.data,false,now);
    const text=response().transcript||'',tasks=[];
    const retain=(data,provider,value)=>{if(!value)return;const prior={...original,...data.patch},next={...value,status:'assessed',recordingHash:recording.hash,assessedAt:now()};
      for(const name of ['pronunciation','fluency'])if(report.deliveryTraits({recording,[provider]:next},provider)[name]===null&&report.deliveryTraits(prior,provider)[name]!==null)next[name]=prior[provider]?.[name];data.patch[provider]=next;};
    const contentGated=()=>report.validContent(q,response().content)&&response().content.total===0;
    if(q.type==='di'&&text.trim()&&d.diBackend!=='portal-gpt'){
      if(!report.validContent(q,response().content))tasks.push((async()=>{
        try{
          if(!ctx.data.remote&&ctx.data.remotePrepared){try{const found=await academyClient.poll(ctx.data.remotePrepared,recording.hash);if(found.inputReady!==false||found.status==='ready')await ctx.save(data=>{data.remote=data.remotePrepared;});}catch(error){if(error.status!==404)throw error;}}
          if(!ctx.data.remote){const requested=ctx.data.remotePrepared&&ctx.data.remoteRequest?.requested||['content'];
            const id=hash({job:ctx.row.id,requested});await ctx.save(data=>{data.remoteRequest={id,requested};});
            const receipt=await academyClient.submit({id,requested,question:q,recording,transcript:text,expected:ctx.data.remotePrepared,onPrepared:receipt=>ctx.save(data=>{data.remotePrepared=receipt;})});await ctx.save(data=>{data.remote=receipt;});}
          const remote=await academyClient.poll(ctx.data.remote,recording.hash);
          await ctx.save(data=>{const content=academy.contentResult(remote.content,remote.feedback);if(content)data.patch.content=content;data.remoteStatus=remote.status;data.remoteFailures=(remote.failures||[]).filter(f=>f.stage==='content');data.stages.academy={status:content?'ready':data.remoteFailures.length?'needs_attention':'waiting'};});
        }catch(error){await ctx.save(data=>{const attempts=(data.stages.academy?.attempts||0)+1;data.stages.academy={status:attempts>=5||[400,401,403,409].includes(error.status)?'needs_attention':'retry_wait',attempts,failure:'academy_transport',code:error.status||503,nextAt:now()+Math.min(60000,5000*attempts)};});}
      })());
    }else{
      if(!report.validContent(q,response().content))tasks.push(stage(ctx,'content',()=>scoring.grade(q,text,callModel,{academyDescribeImage:true}),{now,valid:v=>report.validContent(q,v),accept:(data,v)=>{if(report.validContent(q,v))data.patch.content=v;}}));
    }
    if(!contentGated()&&report.deliveryTraits(response(),'azure').missing.length)tasks.push(stage(ctx,'azure',()=>assessAzure(recording,{question:q,transcript:text,transcribe,contentIndependent:true,chunkCache:ctx.data.azureChunks||{},checkpointChunk:(key,value)=>ctx.save(data=>{data.azureChunks||={};data.azureChunks[key]={...data.azureChunks[key],...value};})}),{now,accept:(data,v)=>retain(data,'azure',v),valid:()=>!report.deliveryTraits(response(),'azure').missing.length}));
    await Promise.allSettled(tasks);
    return disposition(ctx.data,report.questionResult({status:'submitted'},q,response(),d.index,'azure').total!==null,now);
  }});
  async function recoverHeld(uid,a){
    for(const row of await jobs.list(uid,a.id)){
      if(row.status!=='needs_attention'||row.data.assessmentExclusion)continue;
      const cycles=(row.data.repairs||[]).filter(r=>r.operation.startsWith('automatic:')).length;
      const delay=[600000,1800000,7200000,21600000][cycles];
      if(delay===undefined||Number(row.updated_at)+delay>now())continue;
      const held=Object.entries(row.data.stages||{}).filter(([,stage])=>stage.status==='needs_attention');
      if(!held.length||held.some(([name,stage])=>require('./mock-recovery-policy').failure({status:stage.code||stage.failure,code:stage.detail?.code,uncertain:stage.failure==='uncertain_provider_outcome'}).blocked||(name==='azure'&&row.data.patch?.azure?.deliveryEvidence?.sufficient===false)))continue;
      // Remote retries must be justified by a confirmed retryable receipt.
      if(held.some(([name])=>name==='academy')&&(row.data.remoteFailures||[]).some(f=>f.uncertain||f.code==='uncertain_provider_outcome'||!f.retryable&&![429,500,502,503,504].includes(Number(f.code||f.status))))continue;
      try{await repair(uid,a.id,{jobId:row.id,stages:held.map(([name])=>name),operation:'automatic:'+cycles,acknowledgeUncertain:false});}
      catch(error){if(error.status!==409)console.warn('[speaking-jobs] Deferred recovery will resume.');}
    }
  }
async function repair(uid,id,{jobId,stage:stageName,stages:stageNames,operation,acknowledgeUncertain=false}={}){const row=await jobs.get(uid,jobId);if(!row||row.group_id!==id)throw Object.assign(Error('Job not found.'),{status:404});if(row.data.assessmentExclusion)throw Object.assign(Error('This question is excluded from the overall assessment.'),{status:409});const selected=stageNames||[stageName];if(!Array.isArray(selected)||!selected.length||selected.length>6||selected.some(name=>!['transcription','content','azure','academy'].includes(name)))throw Object.assign(Error('Invalid repair stage.'),{status:400});if(selected.includes('academy')&&row.data.remote&&row.data.remoteFailures?.length){const remote=await academyClient.poll(row.data.remote,row.data.recordingHash);if(remote.inputReady===false){const saved=await store.getResponse(uid,id,row.data.index);await academyClient.submit({id:row.data.remote.id,requested:row.data.remoteRequest.requested,question:saved.question,recording:saved.response.recording,transcript:row.data.patch.transcript||saved.response.transcript,expected:row.data.remote});}await academyClient.retry(row.data.remote,{stages:row.data.remoteFailures.map(f=>f.stage),operation,acknowledgeUncertain});}await jobs.retry(uid,jobId,{stages:selected,operation,acknowledgeUncertain});await worker.wake();return{status:'queued',jobId};};
  async function ensure(uid,a){if(!a||a.lease?.expiresAt>now())return;for(let i=0;i<a.questions.length;i++){const r=a.responses[i];if(a.questions[i].type==='intro'||!r?.recording||!missing(a,i))continue;
    const patch={};for(const name of ['transcript','transcriptionStatus','content','gpt','azure'])if(r[name]!=null)patch[name]=r[name];
    const row=await jobs.enqueue({id:identity(a,i),owner:uid,groupId:a.id,inputHash:hash({recording:r.recording.hash,question:a.questions[i]}),data:{index:i,recordingHash:r.recording.hash,questionHash:hash(a.questions[i]),diBackend:a.assessmentProfile?.diBackend||'academy',patch,stages:{},version:VERSION}});
    await jobs.retire(uid,row.id,['gpt',...(report.validContent(a.questions[i],{...a.responses[i],...row.data.patch}.content)?['academy']:[])]);
  }await recoverHeld(uid,a);await publish(uid,a.id);await worker.wake();}
  async function hydrate(uid,a){if(!a)return a;const result=structuredClone(a),rows=await jobs.list(uid,a.id);for(const row of rows){const d=row.data,i=d.index;if(a.responses[i]?.recording?.hash!==d.recordingHash||hash(a.questions[i])!==d.questionHash)continue;
    const patch={...d.patch};for(const provider of ['gpt','azure'])if(patch[provider])for(const trait of ['pronunciation','fluency'])if(report.deliveryTraits(a.responses[i],provider)[trait]!==null&&report.deliveryTraits({...a.responses[i],[provider]:patch[provider]},provider)[trait]===null)patch[provider][trait]=a.responses[i][provider]?.[trait];
    Object.assign(result.responses[i],patch);}
    return result;
  }
  async function publish(uid,id){const a=await store.get(uid,id,{omitMockAudio:true});if(!a||a.status!=='submitted'||a.assessment?.status==='ready'&&complete(a))return;
    const candidate=await hydrate(uid,a);if(!complete(candidate))return;
    let published=false;const saved=await store.update(uid,id,current=>{published=false;if(current.status!=='submitted'||current.assessment?.status==='ready'&&complete(current)||hash(current.questions)!==hash(candidate.questions))return current;for(let i=0;i<current.questions.length;i++){const patch=candidate.responses[i];if(!patch||current.responses[i]?.recording?.hash!==patch.recording?.hash)continue;const {recording,manualDeliveryOverrides,...marks}=patch;Object.assign(current.responses[i],marks);}
      if(complete(current)){current.grading={status:'complete'};current.assessment={status:'ready',version:VERSION,publishedAt:now()};delete current.lease;published=true;}return current;});
    if(published){const scores=report.summarize(saved);console.info('[speaking-mock-published]',JSON.stringify({attemptId:id,questionCount:saved.questionCount,provider:'azure',azure:scores.azure.overallScore,accountedFor:scores.azure.assessedCount+scores.azure.excludedCount,assessedCount:scores.azure.assessedCount,excludedCount:scores.azure.excludedCount}));}
  }
  async function status(uid,a){const ready=a.status==='submitted'&&complete(a);if(ready)return{status:'ready',ready:true,accountedFor:a.questionCount,total:a.questionCount};
    const candidate=await hydrate(uid,a),rows=await jobs.list(uid,a.id),s=report.summarize({...candidate,status:'submitted'}),held=rows.some(r=>r.status==='needs_attention'&&!report.exclusionFor(candidate,candidate.questions[r.data.index],r.data.index));
    const accountedFor=s.azure.assessedCount+s.azure.excludedCount;
    return{status:held?'delayed':'preparing',ready:false,accountedFor,total:a.questionCount,delayed:held||now()-(a.finishedAt||now())>600000};
  }
  async function sweep(){if(sweeping)return;sweeping=true;try{const rows=await store.scanForScoring(cursor);cursor=rows.length?rows.at(-1).data.id:'';for(const {username,data}of rows){if(!includeLegacy&&data.assessmentProfile?.mode!=='progressive-v1')continue;let a=data;if(a.status==='active'&&now()>=a.deadline)a=await store.update(username,a.id,current=>{if(current.status==='active'&&now()>=current.deadline){current.status='submitted';current.finishedAt=now();current.grading={status:'pending'};}return current;});if(a.assessment?.status!=='ready')await ensure(username,a);}}finally{sweeping=false;}}
  return{ensure,hydrate,status,publish,jobs,recover:sweep,repair,async diagnostics(uid,id){const a=await store.get(uid,id,{omitMockAudio:true});if(!a)return null;return{attemptId:id,...await status(uid,a),jobs:(await jobs.list(uid,id)).map(r=>({id:r.id,index:r.data.index,status:r.status,...(r.data.assessmentExclusion?{exclusion:{note:r.data.assessmentExclusion.note,operation:r.data.assessmentExclusion.operation}}:{}),updatedAt:Number(r.updated_at),stages:Object.fromEntries(Object.entries(r.data.stages||{}).map(([name,s])=>[name,{status:s.status,attempts:s.attempts||0,code:s.failure||null,...(s.detail?{detail:s.detail}:{})}])),remoteFailures:r.data.remoteFailures||[]}))};},async start(){await jobs.initialise();await worker.start();await sweep();sweeper=setInterval(()=>sweep().catch(()=>console.warn('[speaking-jobs] recovery scan will resume')),15000);sweeper.unref?.();},async stop(){clearInterval(sweeper);await worker.stop();},wait:worker.wait};
}
module.exports={VERSION,complete,identity,createMockJobs};
