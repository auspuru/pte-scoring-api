'use strict';
const { randomUUID } = require('node:crypto');
const { hash } = require('./scoring-jobs');
const { input } = require('./writing-lab-recovery');
const report = require('./public/writing-lab-report');

const OWNER = 'sukhpal';
const ATTEMPT = 'a7e5cadb-8b63-4420-8035-490923d28bc5';
const OPERATION = 'sukhpal-writing-sst-claude-2026-11-10';
const INDEX = 3;
const originalTotals = [8, 6.5, 17, 4, 7, 5, 6];

function createRunner({ store, score, onComplete = async()=>{}, now = Date.now, model = 'claude-haiku-4-5-20251001' }) {
  const pending = new Map();
  function eligible(uid, a) {
    return uid === OWNER && a?.id === ATTEMPT && a.kind === 'mock' && a.module === 'writing'
      && a.status === 'submitted' && a.title === 'Writing Prediction Mock 01'
      && a.questions?.length === 7 && a.questions[INDEX]?.type === 'sst'
      && a.questions[INDEX]?.id === 'pred26-user-sst-03'
      && a.answers?.[INDEX]?.length === 360
      && a.completed?.[INDEX] && a.results?.length === 7
      && a.results.every((result, index) => result?.total === originalTotals[index] && !report.needsReview(result,a.questions[index]));
  }
  async function run(uid, id) {
    if(uid !== OWNER || id !== ATTEMPT) return null;
    if(pending.has(id)) return pending.get(id);
    const task=(async()=>{
      let receipt, source;
      await store.update(uid,id,a=>{
        if(!eligible(uid,a) || a.sstReassessment?.operation !== OPERATION || a.sstReassessment.status !== 'queued') return a;
        receipt={operation:OPERATION,lease:randomUUID(),inputHash:input(a,INDEX),oldHash:hash(a.results[INDEX]),startedAt:now()};
        source={question:structuredClone(a.questions[INDEX]),answer:a.answers[INDEX]};
        a.sstReassessment={...receipt,status:'processing',expiresAt:now()+180000};
        return a;
      });
      if(!receipt)return null;
      let result, error;
      try {
        result=await score(source.question,source.answer);
        if(!result || result.maximum!==12 || report.needsReview(result,source.question)
          || !Number.isFinite(result.total) || result.total<0 || result.total>12
          || Object.keys(result.scores||{}).sort().join()!=='content,form,grammar,spelling,vocabulary'
          || Object.values(result.scores||{}).reduce((sum,value)=>sum+value,0)!==result.total)
          throw Error('Unconfirmed SST reassessment');
      } catch(caught) {error=caught;}
      const saved=await store.update(uid,id,a=>{
        const marker=a?.sstReassessment;
        if(marker?.operation!==OPERATION || marker.lease!==receipt.lease || marker.status!=='processing')return a;
        if(!eligible(uid,a) || input(a,INDEX)!==receipt.inputHash || hash(a.results[INDEX])!==receipt.oldHash){
          a.sstReassessment={...marker,status:'needs-review',finishedAt:now(),code:'saved-evidence-changed'};return a;
        }
        if(error){a.sstReassessment={...marker,status:'needs-review',finishedAt:now(),code:'review-unavailable'};return a;}
        a.sstReassessmentHistory=[...(a.sstReassessmentHistory||[]),{operation:OPERATION,at:now(),index:INDEX,
          inputHash:receipt.inputHash,oldResult:structuredClone(a.results[INDEX]),oldOverallFeedback:structuredClone(a.overallFeedback||null)}];
        a.results[INDEX]={...result,scoringProvider:'anthropic',scoringModel:model,reassessmentOperation:OPERATION};
        a.sstReassessment={...marker,status:'complete',finishedAt:now(),oldTotal:originalTotals[INDEX],newTotal:result.total,newHash:hash(a.results[INDEX])};
        return a;
      });
      console.info('[writing-sst-reassessment]',JSON.stringify({operation:OPERATION,status:saved.sstReassessment?.status,
        oldTotal:originalTotals[INDEX],newTotal:saved.sstReassessment?.newTotal}));
      if(saved.sstReassessment?.status==='complete')await onComplete(uid,saved);
      return saved.sstReassessment;
    })().finally(()=>pending.delete(id));
    pending.set(id,task);
    return task;
  }
  return { run, eligible, operation:OPERATION };
}
module.exports={ createRunner, OWNER, ATTEMPT, OPERATION, INDEX };
