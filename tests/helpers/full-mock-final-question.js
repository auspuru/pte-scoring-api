'use strict';
const {randomUUID}=require('node:crypto');
const session=require('../../full-mock/session'),assessment=require('../../full-mock/assessment'),adapters=require('../../full-mock/adapters');
const {inputHash}=require('../../full-mock/aggregation');
function make(paper,{historical=false,type='rs'}={}){
 const state=session.create(randomUUID(),paper,1000,{preview:true});session.end(state,paper,2000);
 const snapshot=structuredClone(assessment.snapshot());
 if(historical)snapshot.scoringSources=require('../../content/full-mock/automatic-final-question-compatible-sources.json');
 state.assessment=assessment.stateFor(snapshot);state.assessment.status='needs-attention';state.assessment.recovery={version:1,status:'exhausted',retries:8};
 const selected=paper.questions.find(q=>q.question.type===type),position=paper.questions.indexOf(selected)+1;
 for(const [index,candidate]of paper.questions.entries()){
  const response=state.responses[index+1],failed=candidate===selected;
  if(failed)response.segments=[{id:randomUUID(),mime:'audio/webm',finished:true,chunkCount:1,chunks:{0:{sha256:'a'.repeat(64),stored:true,bytes:123}}}];
  state.assessment.items[candidate.id]={status:failed?'failed':'assessed',inputHash:inputHash(response),snapshotHash:state.assessment.snapshotHash,...(failed?{result:{status:'failed',reason:type==='essay'?'writing-unavailable':'delivery-unavailable'},stages:{transcription:{status:'complete',value:'Retained synthetic transcript.'},content:{status:'complete',value:{total:2,maximum:3}},[type==='essay'?'writing':'delivery']:{status:'failed',failureCode:503,uncertain:false}}}:{result:adapters.result(candidate.question,adapters.maxima(candidate.question)),stages:{content:{status:'complete',value:{total:1}}}})};
 }
 return {state,selected,position};
}
module.exports={make};
