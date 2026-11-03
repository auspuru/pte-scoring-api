'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const writing=require('../content/writing-lab.json'),listening=require('../content/listening-mocks'),{predictionMocks,advance}=require('../writing-lab');
for(const mock of [...writing.mocks,...predictionMocks,...listening.mocks])test(mock.id+': individual writing clocks and shared listening/dictation blocks',()=>{
 const a={questions:structuredClone(mock.questions),index:0,status:'active',completed:[],deadline:1000+mock.questions[0].minutes*60000};
 for(let i=0;i<a.questions.length;i++){
  const q=a.questions[i];if(['swt','sst'].includes(q.type))assert.equal(q.minutes,10);if(q.type==='essay')assert.equal(q.minutes,20);
  const prior=a.deadline,next=a.questions[i+1],at=10000+i*1000;advance(a,at,'Submitted');
  if(next)assert.equal(a.deadline,q.timeGroup&&q.timeGroup===next.timeGroup?prior:at+next.minutes*60000);
 }
 assert.equal(a.status,'submitted');
});
