'use strict';
const { digest } = require('./paper');
const { fail } = require('./store');
const { aggregate } = require('./aggregation');
const { recordingBytes } = require('./report');
const TYPES = new Set(['ra','rs','di','rl','sgd','rts']);
const fingerprint = state => digest({paper:state.paperHash,snapshot:state.assessment?.snapshotHash,responses:state.responses,items:state.assessment?.items,exclusions:state.assessment?.exclusions,publication:state.instructorReview});
function create({store,validate,now=Date.now,assess=require('../azure-continuous-delivery').assessRecording}) {
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
    return {owner,attemptId:id,paperId:record.paper.id,paperVersion:record.paper.version,evidenceHash:fingerprint(record.state),profiles:aggregate(record.paper,record.state).profiles,questions:eligible(record.paper,record.state),operations:Object.fromEntries(Object.entries(record.state.deliveryReassessments||{}).map(([id,op])=>{const value=structuredClone(op);if(op.status==='review'&&op.evidenceHash===fingerprint(record.state)){const proposed=structuredClone(record.state);replace(proposed,op);value.proposedProfiles=aggregate(record.paper,proposed).profiles;}return [id,value];}))};
  }
  async function inspect(owner,id){return view(owner,id,await read(owner,id));}
  async function send(owner,id,body) {
    const {operation,questionId,evidenceHash}=body;
    if(!/^[a-zA-Z0-9:-]{8,100}$/.test(operation||'')||typeof questionId!=='string')throw fail('A stable operation and question are required.',400);
    const record=await read(owner,id);let claimed=false;
    await store.update(owner,id,state=>{
      claimed=false;check(state,record.paper);state.deliveryReassessments||={};
      const existing=state.deliveryReassessments[operation];
      if(existing){if(existing.questionId!==questionId)throw fail('Operation belongs to another question.',409);return state;}
      if(fingerprint(state)!==evidenceHash)throw fail('Saved evidence changed. Inspect again.',409);
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
  async function publish(owner,id,{operation,confirmPublish}) {
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
    await store.update(owner,id,state=>{const op=state.deliveryReassessments?.[operation];if(!op||!['review','discarded'].includes(op.status))throw fail('Only a completed, unpublished review can be discarded.',409);op.status='discarded';op.discardedAt=now();return state;});
    return inspect(owner,id);
  }
  return {inspect,send,publish,discard};
}
module.exports={create,fingerprint};
