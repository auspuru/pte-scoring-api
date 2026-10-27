'use strict';
const report=require('./speaking-mock-report'),{hash}=require('./scoring-jobs');
const {createAcademyClient,contentResult}=require('./visual-academy-client');
const knownFailure=code=>['validation','provider',429,500,502,503,504].includes(code);
// Only explicitly selected content stages can be resumed. All provider calls
// still go through the existing owned, hash-checked and idempotent job repair.
async function recover({username,attemptId,operation,action='diagnose',indices=[],mockStore,progressive,
  academyClient=createAcademyClient(),logger=console}={}){
  if(typeof username!=='string'||!/^[a-z0-9_.-]{1,80}$/.test(username)||typeof attemptId!=='string'||!/^[a-f0-9-]{36}$/.test(attemptId)
    ||typeof operation!=='string'||!/^[a-zA-Z0-9:_-]{1,100}$/.test(operation)||!['diagnose','repair'].includes(action)
    ||!Array.isArray(indices)||indices.length>6||new Set(indices).size!==indices.length||indices.some(i=>!Number.isInteger(i)||i<0||i>200)
    ||action==='repair'&&!indices.length)throw Error('Invalid incident recovery scope.');
  const attempt=await mockStore.get(username,attemptId,{omitMockAudio:true});
  if(!attempt||attempt.status!=='submitted'||indices.some(i=>!attempt.questions[i]||attempt.questions[i].type==='intro'))throw Error('Submitted incident attempt not found.');
  async function diagnose(){
    const current=await mockStore.get(username,attemptId,{omitMockAudio:true}),candidate=await progressive.hydrate(username,current);
    const scores=report.summarize(candidate).azure,diagnostics=await progressive.diagnostics(username,attemptId);
    const value={operation,attemptId,status:diagnostics.status,accountedFor:diagnostics.accountedFor,total:current.questionCount,
      overallScore:scores.overallScore,missing:scores.missingQuestions,
      jobs:diagnostics.jobs.filter(j=>scores.missingQuestions.some(q=>q.index===j.index)).map(j=>({id:j.id,index:j.index,status:j.status,
        stages:Object.fromEntries(Object.entries(j.stages||{}).map(([name,s])=>[name,{status:s.status,attempts:s.attempts,code:s.code}])),
        remoteFailures:(j.remoteFailures||[]).map(f=>({stage:f.stage,code:f.code}))}))};
    logger.info('[speaking-incident-recovery]',JSON.stringify(value));return value;
  }
  const before=await diagnose();if(action==='diagnose')return before;
  const candidate=await progressive.hydrate(username,attempt),rows=await progressive.jobs.list(username,attemptId),plans=[];
  // Validate every selected target before issuing any paid retry.
  for(const index of indices){
    const q=attempt.questions[index],response=candidate.responses[index];
    if(report.validContent(q,response?.content))continue;
    const row=rows.find(r=>r.data.index===index);
    if(!row||!attempt.responses[index]?.recording?.hash||row.owner!==username||row.group_id!==attemptId||row.data.recordingHash!==attempt.responses[index].recording.hash
      ||row.data.questionHash!==hash(q))throw Error('Incident recording or question changed.');
    if(row.data.repairs?.some(r=>r.operation===operation))continue;
    const stage=q.type==='di'?'academy':'content',state=row.data.stages?.[stage];
    if(row.status!=='needs_attention'||state?.status!=='needs_attention')continue;
    if(stage==='academy'){
      if(!row.data.remote)throw Error('Held Academy receipt is unavailable.');
      const remote=await academyClient.poll(row.data.remote,row.data.recordingHash);
      const failures=(remote.failures||[]).filter(f=>f.stage==='content');
      if(remote.status==='needs_attention'&&!contentResult(remote.content,remote.feedback)
        &&(!failures.length||failures.some(f=>!knownFailure(f.code))))throw Error('Academy provider outcome needs investigation.');
      plans.push({row,stage,remoteReady:!!contentResult(remote.content,remote.feedback)||remote.status!=='needs_attention'});
    }else{
      if(!knownFailure(state.failure))throw Error('Content provider outcome needs investigation.');
      plans.push({row,stage});
    }
  }
  for(const {row,stage,remoteReady}of plans){
    if(remoteReady)await progressive.jobs.retry(username,row.id,{stages:[stage],operation});
    else await progressive.repair(username,attemptId,{jobId:row.id,stage,operation});
    logger.info('[speaking-incident-recovery]',JSON.stringify({operation,attemptId,index:row.data.index,stage,status:'resumed'}));
  }
  await progressive.ensure(username,await mockStore.get(username,attemptId,{omitMockAudio:true}));
  await progressive.wait();return diagnose();
}
module.exports={recover};
