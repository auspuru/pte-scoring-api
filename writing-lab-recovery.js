'use strict';
const {randomUUID}=require('node:crypto'),{hash}=require('./scoring-jobs'),{retryState}=require('./mock-recovery-policy');
const input=(a,i)=>hash({question:a.questions[i],answer:a.answers[i],completed:a.completed[i]});
const unavailable=()=>Object.assign(Error('This saved response is awaiting background assessment.'),{status:503,retryable:false});
function createRecovery({store,now=Date.now,isConfirmed}) {
  async function claim(uid,id,index){
    const lease=randomUUID();let receipt;
    await store.update(uid,id,a=>{
      receipt=undefined;
      if(!a||!a.completed[index])throw unavailable();
      if(isConfirmed(a,index))return a;
      a.assessmentRecovery||={};const prior=a.assessmentRecovery[index],fingerprint=input(a,index);
      if(prior?.fingerprint===fingerprint){
        if(prior.status==='calling'){
          if(prior.expiresAt<=now())a.assessmentRecovery[index]={...prior,status:'held',uncertain:true,code:'uncertain_provider_outcome'};
          return a;
        }
        if(['held','exhausted'].includes(prior.status)||prior.nextAt>now())return a;
      }
      receipt={lease,fingerprint,attempts:prior?.fingerprint===fingerprint?(prior.attempts||0)+1:1};
      a.assessmentRecovery[index]={...receipt,status:'calling',startedAt:now(),expiresAt:now()+180000};return a;
    });
    return receipt;
  }
  async function save(uid,id,index,receipt,result){
    return store.update(uid,id,a=>{
      const state=a?.assessmentRecovery?.[index];
      if(state?.lease!==receipt.lease||input(a,index)!==receipt.fingerprint)throw unavailable();
      if(!isConfirmed(a,index))a.results[index]=result;
      a.assessmentRecovery[index]=isConfirmed(a,index)?{...receipt,status:'complete',completedAt:now()}:{...receipt,...retryState({code:'validation'},receipt.attempts,now())};
      return a;
    });
  }
  async function fail(uid,id,index,receipt,error){
    if(!receipt)return;
    await store.update(uid,id,a=>{
      if(a?.assessmentRecovery?.[index]?.lease===receipt.lease&&!isConfirmed(a,index))a.assessmentRecovery[index]={...receipt,...retryState(error,receipt.attempts,now())};
      return a;
    });
  }
  return{claim,save,fail};
}
module.exports={createRecovery,input};
