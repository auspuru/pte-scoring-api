'use strict';
const report=require('./speaking-mock-report'),{tokens}=require('./speaking-scoring');
function evidence(value){if(!value)return null;return Object.fromEntries(['sufficient','durationSeconds','spokenWords','referenceWords','matchedWords','coverage'].filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));}
// Operations run inside the owning service through its existing Railway admin
// configuration. Never export recordings, transcripts, session tokens or keys.
async function diagnose({usernames,operation,limit=3,mockStore,progressive,logger=console}={}){
  if(!Array.isArray(usernames)||!usernames.length||usernames.length>5||usernames.some(u=>typeof u!=='string'||!/^[a-z0-9_.-]{1,80}$/.test(u))||typeof operation!=='string'||!/^[a-zA-Z0-9:_-]{1,120}$/.test(operation)||!Number.isInteger(limit)||limit<1||limit>5)throw Error('Invalid background recovery scope.');
  const results=[];
  for(const username of [...new Set(usernames)]){
    const attempts=(await mockStore.list(username,{omitMockAudio:true})).filter(a=>a.status==='submitted').sort((a,b)=>b.startedAt-a.startedAt).slice(0,limit);
    if(!attempts.length){const value={operation,username,status:'no-submitted-attempt'};results.push(value);logger.info('[speaking-background-recovery]',JSON.stringify(value));continue;}
    for(const a of attempts){const candidate=await progressive.hydrate(username,a),scores=report.summarize(candidate),diagnostics=await progressive.diagnostics(username,a.id);
      const indices=scores.azure.missingQuestions.map(q=>q.index);
      const value={operation,username,attemptId:a.id,startedAt:a.startedAt,finishedAt:a.finishedAt||null,status:diagnostics.status,accountedFor:diagnostics.accountedFor,total:a.questionCount,
        questions:indices.map(index=>{const q=a.questions[index],r=candidate.responses[index]||{};return{index,type:q.type,questionId:q.id,recording:!!r.recording,transcriptionStatus:r.transcriptionStatus||null,transcriptWords:tokens(r.transcript||'').length,referenceWords:tokens(q.text||'').length,
          content:{valid:report.validContent(q,r.content),total:r.content?.total??null,maximum:r.content?.maximum??null},
          missing:{azure:scores.azure.missingQuestions.find(q=>q.index===index)?.missing||[]},
          delivery:Object.fromEntries(['azure'].map(p=>[p,{status:r[p]?.status||null,pronunciation:r[p]?.pronunciation?.score??null,fluency:r[p]?.fluency?.score??null,evidence:evidence(r[p]?.deliveryEvidence),failureTraits:r[p]?.deliveryFailureTraits||[]}]))};}),jobs:diagnostics.jobs};
      results.push(value);logger.info('[speaking-background-recovery]',JSON.stringify(value));
    }
  }return results;
}
async function recover(options={}){
  const {action='diagnose',repairs=[],operation,usernames,progressive,mockStore,logger=console}=options;
  if(action==='diagnose')return diagnose(options);
  if(action!=='repair'||!Array.isArray(repairs)||!repairs.length||repairs.length>10)throw Error('Invalid background repair scope.');
  // Validate the complete account scope before changing any job.
  await diagnose({...options,logger:{info(){}}});
  const plans=[];
  for(const repair of repairs){if(!usernames.includes(repair.username)||typeof repair.attemptId!=='string'||typeof repair.jobId!=='string'||!Array.isArray(repair.stages)||!repair.stages.length||repair.stages.some(s=>s!=='azure'))throw Error('Invalid background repair target.');
    const row=await progressive.jobs.get(repair.username,repair.jobId),attempt=await mockStore.get(repair.username,repair.attemptId,{omitMockAudio:true});
    if(!row||row.group_id!==repair.attemptId||!attempt||attempt.responses[row.data.index]?.recording?.hash!==row.data.recordingHash)throw Error('Background repair target changed.');
    if(!row.data.repairs?.some(r=>r.operation===operation))for(const name of repair.stages){const stage=row.data.stages?.[name];if(stage?.status!=='needs_attention'||!['validation','provider',429,500,502,503,504].includes(stage.failure))throw Error('Only known, confirmed failures can use automatic recovery.');}
    plans.push(repair);
  }
  for(const plan of plans){await progressive.jobs.retry(plan.username,plan.jobId,{stages:plan.stages,operation});logger.info('[speaking-background-recovery]',JSON.stringify({operation,username:plan.username,attemptId:plan.attemptId,jobId:plan.jobId,stages:plan.stages,status:'resumed'}));}
  for(const {username,attemptId}of plans)await progressive.ensure(username,await mockStore.get(username,attemptId,{omitMockAudio:true}));
  await progressive.wait();
  return diagnose(options);
}
module.exports={diagnose,recover};
