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
      const indices=[...new Set([...scores.openai.missingQuestions,...scores.azure.missingQuestions].map(q=>q.index))];
      const value={operation,username,attemptId:a.id,startedAt:a.startedAt,finishedAt:a.finishedAt||null,status:diagnostics.status,accountedFor:diagnostics.accountedFor,total:a.questionCount,
        questions:indices.map(index=>{const q=a.questions[index],r=candidate.responses[index]||{};return{index,type:q.type,questionId:q.id,recording:!!r.recording,transcriptionStatus:r.transcriptionStatus||null,transcriptWords:tokens(r.transcript||'').length,referenceWords:tokens(q.text||'').length,
          content:{valid:report.validContent(q,r.content),total:r.content?.total??null,maximum:r.content?.maximum??null},
          missing:{openai:scores.openai.missingQuestions.find(q=>q.index===index)?.missing||[],azure:scores.azure.missingQuestions.find(q=>q.index===index)?.missing||[]},
          delivery:Object.fromEntries(['gpt','azure'].map(p=>[p,{status:r[p]?.status||null,pronunciation:r[p]?.pronunciation?.score??null,fluency:r[p]?.fluency?.score??null,evidence:evidence(r[p]?.deliveryEvidence),failureTraits:r[p]?.deliveryFailureTraits||[]}]))};}),jobs:diagnostics.jobs};
      results.push(value);logger.info('[speaking-background-recovery]',JSON.stringify(value));
    }
  }return results;
}
module.exports={diagnose};
