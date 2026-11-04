'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),ui=require('../public/admin-result-review');
function diagnostic(n=0){return{owner:'owner',attemptId:'saved-attempt',ready:false,review:{started:n>0,retries:n,limit:2,busy:false,evidenceHash:'evidence-'+n,inputsHash:'retained-input',canRetry:n<2,canPublish:n===2,assessedCount:26,questions:[{id:'rts',number:27,type:'rts',reason:'Assessment unavailable',retryable:true}]}};}
test('Admin analysis performs two retry rounds, stops for review, and never sends publication implicitly',async()=>{
 let d=diagnostic(),posts=[],notices=[],locked=[];const host={isConnected:true};
 const options={host,diagnostic:d,operations:new Map(),operationId:()=>String(posts.length)+'-operation',pause:async()=>{},request:async body=>{if(body){posts.push(body);d=diagnostic(posts.length);}return d;},commit:value=>{d=value;},lock:v=>locked.push(v),notice:v=>notices.push(v)};
 await ui.act({target:{closest:selector=>selector==='[data-result-analyse]'}},options);
 assert.equal(posts.length,2);assert(posts.every(p=>p.action==='analyse'));assert.equal(d.review.canPublish,true);assert.match(notices.at(-1),/click Publish results/);assert.deepEqual(locked,[true,false]);
});
test('Publication requires its own confirmation and read-back bound to the same student and inputs',async()=>{
 const d=diagnostic(2),posts=[],notices=[];let checked=false;
 const host={isConnected:true,querySelector:selector=>selector==='[data-result-note]'?{value:'Instructor reviewed the remaining unavailable question.'}:{checked}};
 const options={host,diagnostic:d,operations:new Map(),operationId:()=> 'one-publication',request:async body=>{posts.push(body);return{...d,ready:true,review:{...d.review,published:true}};},commit:()=>{},lock:()=>{},notice:value=>notices.push(value)};
 const event={target:{closest:selector=>selector==='[data-result-publish]'}};
 await ui.act(event,options);assert.equal(posts.length,0);checked=true;await ui.act(event,options);assert.equal(posts.length,1);assert.equal(posts[0].action,'publish');assert.equal(posts[0].confirmPublish,true);assert.match(notices.at(-1),/Results published/);
 options.request=async()=>({...d,owner:'another',ready:true});await ui.act(event,options);assert.match(notices.at(-1),/returned attempt/);
});
test('Closing the review panel stops the next retry and reuses the same operation after an interrupted response',async()=>{
 const d=diagnostic(),operations=new Map(),posts=[],notices=[];const host={isConnected:true};
 const options={host,diagnostic:d,operations,operationId:()=> 'stable-operation',pause:async()=>{host.isConnected=false;},request:async body=>{posts.push(body);throw Error('Connection interrupted');},commit:()=>{},lock:()=>{},notice:value=>notices.push(value)};
 const event={target:{closest:selector=>selector==='[data-result-analyse]'}};await ui.act(event,options);await ui.act(event,options);assert.deepEqual(posts[0],posts[1]);assert.equal(posts.length,2);assert.match(notices.at(-1),/Connection interrupted/);
 options.request=async body=>{posts.push(body);return{...diagnostic(1),review:{...diagnostic(1).review,busy:true,canRetry:false}};};await ui.act(event,options);assert.equal(posts.length,3);
});
