'use strict';
const {digest}=require('../full-mock/paper');
const native=require('../full-mock/aggregation');
const defaults=require('../full-mock/profiles');
const {COUNTS,FORMAT}=require('./papers');
const VERSION='listening-skill-aggregation-20261113.1';
function aggregate(paper,state,{ignorePublication=false}={}){
 if(paper.module!=='listening'||paper.format!==FORMAT||paper.questions.length!==34)throw Error('Invalid Listening assessment paper.');
 if(state.status!=='submitted')throw Object.assign(Error('Submit the test before viewing assessment results.'),{status:409});
 const snapshot=state.assessment?.snapshot;
 if(digest(paper)!==state.paperHash||!snapshot||snapshot.paperHash!==state.paperHash||digest(snapshot)!==state.assessment.snapshotHash)throw Object.assign(Error('Saved assessment integrity failed.'),{status:503});
 const weighting=snapshot.weighting||defaults.SNAPSHOT;defaults.validate(weighting.profiles);
 const expectedVersion=snapshot.scoringSources.files['full-mock/adapters.js'].version;
 const rows=paper.questions.map((candidate,index)=>{
  const response=state.responses[index+1],job=state.assessment.items[candidate.id],maxima=snapshot.nativeMaxima[candidate.id];
  const valid=!!(response?.sealed&&job?.status==='assessed'&&job.inputHash===native.inputHash(response)&&job.snapshotHash===state.assessment.snapshotHash&&job.result?.version===expectedVersion&&(native.nativeValid(job.result,maxima)||native.availableMarks(state)&&native.partialValid(job.result,maxima,job.stages,candidate.question.type)));
  return{id:candidate.id,type:candidate.question.type,status:valid?'assessed':job?.status==='failed'?'failed':'pending',valid,result:valid?job.result:null};
 });
 const groups=Object.fromEntries(Object.entries(COUNTS).map(([type,count])=>{
  const items=rows.filter(r=>r.type===type),marked=items.filter(r=>r.valid),complete=items.length===count&&marked.length===count;
  return[type,{count:items.length,expected:count,excludedCount:0,complete,earned:complete?marked.reduce((n,r)=>n+r.result.total,0):null,possible:complete?marked.reduce((n,r)=>n+r.result.maximum,0):null}];
 }));
 const held=!ignorePublication&&require('../mock-result-review').held(state),complete=!held&&Object.values(groups).every(g=>g.complete);
 const source=weighting.profiles.listening;
 let profile={version:source.version,status:complete?'complete':'pending',calibrated:false,official:false,practiceIndex:null,practiceIndexRange:null,missing:rows.filter(r=>!r.valid).map(r=>({id:r.id,type:r.type,status:r.status}))};
 if(complete){
  const fractions=Object.fromEntries(Object.entries(groups).map(([type,g])=>[type,g.earned/g.possible])),interval=native.bounds(source,fractions);
  const value=weighting.practiceIndex.minimum+(weighting.practiceIndex.maximum-weighting.practiceIndex.minimum)*interval.low;
  profile={...profile,...interval,weightedFraction:interval.low,weightedFractionRange:{low:interval.low,high:interval.high},practiceIndex:Math.round(value),practiceIndexRange:{low:Math.floor(value+1e-9),high:Math.ceil(value-1e-9)}};
 }
 return{version:VERSION,module:'listening',assessmentVersion:state.assessment.version,snapshotHash:state.assessment.snapshotHash,paperHash:state.paperHash,assessmentType:'IPT Listening practice assessment',calibrated:false,official:false,ready:complete,assessedCount:rows.filter(r=>r.valid).length,excludedCount:0,partialCount:rows.filter(r=>r.valid&&r.result.partialDelivery===native.COMPLETION_POLICY).length,accountedCount:rows.filter(r=>r.valid).length,expectedCount:34,weightingVersion:weighting.version,practiceIndexPolicy:weighting.practiceIndex,groups,profiles:{listening:profile},items:rows.map(({id,type,status,valid,result})=>({id,type,status,...(valid?{total:result.total,maximum:result.maximum,scores:result.scores,maxima:result.maxima,version:result.version,...(result.unavailableTraits?{unavailableTraits:result.unavailableTraits}:{})}:{})}))};
}
module.exports={VERSION,aggregate};
