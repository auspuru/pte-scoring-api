'use strict';
const { digest } = require('./paper');
const { fail } = require('./store');
const { aggregate } = require('./aggregation');
const { recordingBytes } = require('./report');
const TYPES = new Set(['ra','rs','di','rl','sgd','rts']);
const fingerprint = state => digest({paper:state.paperHash,snapshot:state.assessment?.snapshotHash,responses:state.responses,items:state.assessment?.items,exclusions:state.assessment?.exclusions,publication:state.instructorReview});
const continuous=require('../azure-continuous-delivery');
function create({store,validate,now=Date.now,assess=continuous.assessRecording,providerConfiguration=()=>assess===continuous.assessRecording?continuous.configuration():{ready:true}}) {
  const jobs=new Map();
  async function read(owner,id) {
    const record=await store.get(owner,id);if(!record)throw fail('Attempt not found.',404);
    check(record.state,record.paper);return record;
  }
  function check(state,paper) {
    validate(state);
    if(state.status!=='submitted'||digest(paper)!==state.paperHash||!aggregate(paper,state).ready||state.assessment.status==='processing'||state.assessment.lease?.expiresAt>now())throw fail('A complete, settled Full Mock report is required.',409);
  }
  function eligible(paper,state) {
    return paper.questions.flatMap((candidate,index)=>{
      const response=state.responses[index+1],job=state.assessment.items[candidate.id];
      const segments=response?.segments.filter(s=>!s.cancelled&&s.chunkCount!==0)||[];
      return TYPES.has(candidate.question.type)&&job?.status==='assessed'&&!job.result?.gated&&segments.length===1 ? [{id:candidate.id,number:index+1,type:candidate.question.type,previous:job.result.scores,segment:segments[0].id}] : [];
    });
  }
  function replace(state,op) {
    const job=state.assessment.items[op.questionId];
    for(const key of ['pronunciation','fluency'])job.result.scores[key]=op.result[key].score;
    job.result.total=Object.values(job.result.scores).reduce((a,b)=>a+b,0);
    job.stages.delivery={status:'complete',uncertain:false,traits:Object.fromEntries(['pronunciation','fluency'].map(key=>[key,{score:op.result[key].score,raw:op.result[key].raw,version:op.result.version,provider:'azure',evidence:[]}]))};
  }
  function view(owner,id,record) {
    return {owner,attemptId:id,paperId:record.paper.id,paperVersion:record.paper.version,evidenceHash:fingerprint(record.state),profiles:aggregate(record.paper,record.state).profiles,questions:eligible(record.paper,record.state),operations:Object.fromEntries(Object.entries(record.state.deliveryReassessments||{}).map(([id,op])=>{const value=structuredClone(op);if(op.batch){value.completedCount=op.items.filter(item=>item.status==='complete').length;value.failedCount=op.items.filter(item=>['failed','confirmation-pending'].includes(item.status)).length;}if(['review','partial'].includes(op.status)&&op.evidenceHash===fingerprint(record.state)){const proposed=structuredClone(record.state);if(op.batch){for(const item of op.items.filter(item=>item.status==='complete'))replace(proposed,item);}else replace(proposed,op);value.proposedProfiles=aggregate(record.paper,proposed).profiles;}return [id,value];}))};
  }
  async function inspect(owner,id){const record=await read(owner,id);for(const [operation,op] of Object.entries(record.state.deliveryReassessments||{}))if(op.batch&&['queued','running','paused'].includes(op.status))schedule(owner,id,operation);const value=view(owner,id,record);value.provider=providerConfiguration();value.questions=value.questions.map(q=>({...q,blocked:blocked(record.state,q.id)}));return value;}
  function blocked(state,questionId) {
    return Object.values(state.deliveryReassessments||{}).some(op=>op.batch
      ? op.items.some(item=>item.questionId===questionId&&((['running','confirmation-pending'].includes(item.status)||item.status==='queued'&&['queued','running','paused'].includes(op.status))||['review','partial'].includes(op.status)&&item.status==='complete'&&op.evidenceHash===fingerprint(state)))
      : op.questionId===questionId&&(['running','confirmation-pending'].includes(op.status)||op.status==='review'&&op.evidenceHash===fingerprint(state)));
  }
  function schedule(owner,id,operation) {
    const key=owner+':'+id+':'+operation;if(jobs.has(key))return;
    const job=Promise.resolve().then(()=>workBatch(owner,id,operation)).catch(async()=>{try{await store.update(owner,id,state=>{const op=state.deliveryReassessments?.[operation];if(op&&['queued','running'].includes(op.status)){op.status='paused';op.message='Background processing paused. Original marks and completed results are saved. Refresh status to resume unsent recordings.';}return state;});}catch{console.warn('[azure-delivery-batch] Reassessment paused; original marks retained.');}}).finally(()=>jobs.delete(key));jobs.set(key,job);
  }
  async function workBatch(owner,id,operation) {
    while(true){
      const record=await read(owner,id);let claimed;
      await store.update(owner,id,state=>{
        claimed=null;check(state,record.paper);const op=state.deliveryReassessments?.[operation];
        if(!op?.batch||!['queued','running','paused'].includes(op.status))return state;
        if(fingerprint(state)!==op.evidenceHash){op.status='stale';op.message='Saved scores or recordings changed. No replacement was published.';return state;}
        for(const item of op.items)if(item.status==='running'&&item.leaseExpiresAt<=now()){item.status='confirmation-pending';item.message='The earlier request did not save a confirmed receipt before its worker lease ended. It will not be sent again automatically; original marks remain.';}
        if(op.items.some(item=>item.status==='running'))return state;
        const item=op.items.find(item=>item.status==='queued');
        if(!item){op.status=op.items.every(item=>item.status==='complete')?'review':'partial';op.completedAt=now();return state;}
        item.status='running';item.startedAt=now();item.leaseExpiresAt=now()+10*60*1000;op.status='running';claimed=structuredClone(item);return state;
      });
      if(!claimed)return;
      let result,audio,sent=false,error;
      try{
        const candidate=record.paper.questions.find(q=>q.id===claimed.questionId),number=record.paper.questions.indexOf(candidate)+1;
        audio=await recordingBytes(owner,id,record.state.responses[number],claimed.segment,store.getChunk);
        const configured=providerConfiguration();if(!configured.ready)throw Object.assign(Error(configured.message),{providerStarted:false});
        await store.update(owner,id,state=>{const op=state.deliveryReassessments[operation];if(fingerprint(state)!==op.evidenceHash)throw fail('Saved inputs changed before sending.',409);const item=op.items.find(item=>item.questionId===claimed.questionId);item.providerStartedAt=now();return state;});
        sent=true;result=await assess({mime:audio.mime,data:audio.bytes.toString('base64')});
        if(!result?.version||!['pronunciation','fluency'].every(k=>Number.isFinite(result[k]?.score)&&result[k].score>=0&&result[k].score<=5))throw Error('Invalid Azure result');
      }catch(caught){error=caught;}
      await store.update(owner,id,state=>{
        const op=state.deliveryReassessments[operation],item=op.items.find(item=>item.questionId===claimed.questionId);
        if(!['running','confirmation-pending'].includes(item.status)||item.startedAt!==claimed.startedAt)throw fail('Reassessment operation changed.',409);
        if(['published','discarded','stale'].includes(op.status)){if(result){item.lateResult=result;item.lateCompletedAt=now();}return state;}
        if(error){const uncertain=sent&&error.providerStarted!==false;item.status=uncertain?'confirmation-pending':'failed';item.message=uncertain?'Azure did not return a confirmed result. This recording will not be sent again automatically; its original marks are retained.':'The saved recording could not be sent. Its original marks are retained. Check recording availability and Azure configuration.';}
        else{item.status='complete';item.result=result;item.recordingHash=require('./store').hash(audio.bytes);}
        item.completedAt=now();
        if(!op.items.some(item=>['queued','running'].includes(item.status))){op.status=op.items.every(item=>item.status==='complete')?'review':'partial';op.completedAt=now();}
        return state;
      });
    }
  }
  async function sendBatch(owner,id,body) {
    const {operation,evidenceHash}=body;
    if(!/^[a-zA-Z0-9:-]{8,100}$/.test(operation||''))throw fail('A stable reassessment operation is required.',400);
    const record=await read(owner,id),available=eligible(record.paper,record.state),previous=record.state.deliveryReassessments?.[operation];
    if(previous){if(!previous.batch||body.all===true&&!previous.all||body.all!==true&&digest(previous.questionIds)!==digest(body.questionIds))throw fail('Operation belongs to another selection.',409);return inspect(owner,id);}
    const questionIds=body.all===true?available.filter(q=>!blocked(record.state,q.id)).map(q=>q.id):body.questionIds;
    if(!Array.isArray(questionIds)||!questionIds.length||questionIds.length>65||new Set(questionIds).size!==questionIds.length||questionIds.some(id=>typeof id!=='string'))throw fail('Select at least one available saved speaking recording.',400);
    const configured=providerConfiguration();if(!configured.ready)throw fail(configured.message,409);
    await store.update(owner,id,state=>{
      check(state,record.paper);state.deliveryReassessments||={};const old=state.deliveryReassessments[operation];
      if(old){if(!old.batch||digest(old.questionIds)!==digest(questionIds))throw fail('Operation belongs to another selection.',409);return state;}
      if(fingerprint(state)!==evidenceHash)throw fail('Saved evidence changed. Reload the attempt before sending.',409);
      if(Object.values(state.deliveryReassessments).some(op=>(op.batch&&['queued','running','paused','review','partial'].includes(op.status)||!op.batch&&op.status==='review')&&op.evidenceHash===evidenceHash))throw fail('Finish or discard the current reassessment before starting another batch.',409);
      const rows=eligible(record.paper,state);
      if(questionIds.some(id=>!rows.some(q=>q.id===id)||blocked(state,id)))throw fail('A selected recording is unavailable or has an earlier unconfirmed request. Refresh its status.',409);
      state.deliveryReassessments[operation]={batch:true,all:body.all===true,questionIds:[...questionIds],evidenceHash,status:'queued',at:now(),items:questionIds.map(questionId=>{const row=rows.find(q=>q.id===questionId);return{questionId,number:row.number,type:row.type,segment:row.segment,status:'queued',previous:structuredClone(state.assessment.items[questionId])};})};return state;
    });
    schedule(owner,id,operation);return inspect(owner,id);
  }
  async function publishBatch(owner,id,{operation,confirmPublish,confirmPartial}) {
    if(confirmPublish!==true)throw fail('Confirm replacement of the published marks.',400);
    const record=await read(owner,id);
    await store.update(owner,id,state=>{
      check(state,record.paper);const op=state.deliveryReassessments?.[operation];if(op?.status==='published')return state;
      if(!op?.batch||!['review','partial'].includes(op.status)||op.evidenceHash!==fingerprint(state))throw fail('The batch is not ready or the saved evidence changed.',409);
      const completed=op.items.filter(item=>item.status==='complete');
      if(!completed.length||op.status==='partial'&&confirmPartial!==true)throw fail('Confirm publication of only the completed recordings; unavailable recordings keep their original marks.',409);
      if(completed.some(item=>digest(item.previous)!==digest(state.assessment.items[item.questionId])))throw fail('Previous scores changed. Reload the saved attempt.',409);
      const before=aggregate(record.paper,state).profiles;for(const item of completed)replace(state,item);
      const after=aggregate(record.paper,state);if(!after.ready)throw fail('The replacement report could not be verified.',409);
      Object.assign(op,{status:'published',publishedAt:now(),beforeProfiles:before,afterProfiles:after.profiles});return state;
    });return inspect(owner,id);
  }
  async function send(owner,id,body) {
    if(Array.isArray(body.questionIds)||body.all===true)return sendBatch(owner,id,body);
    const {operation,questionId,evidenceHash}=body;
    if(!/^[a-zA-Z0-9:-]{8,100}$/.test(operation||'')||typeof questionId!=='string')throw fail('A stable operation and question are required.',400);
    const record=await read(owner,id);const configured=providerConfiguration();if(!configured.ready)throw fail(configured.message,409);let claimed=false;
    await store.update(owner,id,state=>{
      claimed=false;check(state,record.paper);state.deliveryReassessments||={};
      const existing=state.deliveryReassessments[operation];
      if(existing){if(existing.questionId!==questionId)throw fail('Operation belongs to another question.',409);return state;}
      if(fingerprint(state)!==evidenceHash)throw fail('Saved evidence changed. Inspect again.',409);
      if(blocked(state,questionId))throw fail('An earlier request for this recording needs confirmation, or its proposed replacement must be published or discarded.',409);
      if(Object.values(state.deliveryReassessments).some(op=>op.batch&&['queued','running','paused','review','partial'].includes(op.status)&&op.evidenceHash===evidenceHash))throw fail('Finish or discard the current batch before starting another recording.',409);
      if(Object.values(state.deliveryReassessments).some(op=>['running','confirmation-pending'].includes(op.status)))throw fail('An earlier Azure request needs confirmation before another can start.',409);
      if(Object.values(state.deliveryReassessments).some(op=>op.status==='review'&&op.evidenceHash===evidenceHash))throw fail('Publish or discard the proposed replacement before sending another recording.',409);
      const row=eligible(record.paper,state).find(q=>q.id===questionId);if(!row)throw fail('This question is not eligible for delivery replacement.',409);
      state.deliveryReassessments[operation]={questionId,segment:row.segment,evidenceHash,status:'running',at:now(),previous:structuredClone(state.assessment.items[questionId])};claimed=true;return state;
    });
    if(!claimed)return inspect(owner,id);
    try {
      const row=eligible(record.paper,record.state).find(q=>q.id===questionId);
      const audio=await recordingBytes(owner,id,record.state.responses[row.number],row.segment,store.getChunk);
      const result=await assess({mime:audio.mime,data:audio.bytes.toString('base64')});
      if(!result.version||!['pronunciation','fluency'].every(k=>Number.isFinite(result[k]?.score)&&result[k].score>=0&&result[k].score<=5))throw Error('Invalid Azure result');
      await store.update(owner,id,state=>{const op=state.deliveryReassessments[operation];if(op.status!=='running')throw fail('Operation changed.',409);op.result=result;op.recordingHash=require('./store').hash(audio.bytes);op.status='review';op.completedAt=now();return state;});
    } catch(error) {
      await store.update(owner,id,state=>{const op=state.deliveryReassessments[operation];if(op.status==='running'){op.status='confirmation-pending';op.message='The request did not complete with a verified result. Original marks are retained; do not resend until the provider request is resolved.';}return state;});
    }
    return inspect(owner,id);
  }
  async function publish(owner,id,{operation,confirmPublish,confirmPartial}) {
    const initial=await store.get(owner,id);if(initial?.state.deliveryReassessments?.[operation]?.batch)return publishBatch(owner,id,{operation,confirmPublish,confirmPartial});
    if(confirmPublish!==true)throw fail('Confirm replacement of the published marks.',400);
    const record=await read(owner,id);
    await store.update(owner,id,state=>{
      check(state,record.paper);const op=state.deliveryReassessments?.[operation];
      if(op?.status==='published')return state;
      if(op?.status!=='review'||op.evidenceHash!==fingerprint(state)||digest(op.previous)!==digest(state.assessment.items[op.questionId]))throw fail('Scores or inputs changed. Inspect the saved attempt again.',409);
      const before=aggregate(record.paper,state).profiles;
      replace(state,op);
      const after=aggregate(record.paper,state);if(!after.ready)throw fail('The replacement report could not be verified.',409);
      Object.assign(op,{status:'published',publishedAt:now(),beforeProfiles:before,afterProfiles:after.profiles});return state;
    });return inspect(owner,id);
  }
  async function discard(owner,id,{operation}) {
    await read(owner,id);
    await store.update(owner,id,state=>{const op=state.deliveryReassessments?.[operation];if(!op||!['review','partial','stale','discarded'].includes(op.status))throw fail('Only a completed, unpublished review can be discarded.',409);op.status='discarded';op.discardedAt=now();return state;});
    return inspect(owner,id);
  }
  return {inspect,send,publish,discard,drain:async()=>{while(jobs.size)await Promise.allSettled([...jobs.values()]);}};
}
module.exports={create,fingerprint};
