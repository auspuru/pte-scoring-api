'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{parseHTML}=require('linkedom');
const {mount,canRepair}=require('../public/admin-mock-recovery');
const id='006d4971-2ad3-4f14-8e2a-0ea3ed450bdd';
const diagnostic=()=>({attemptId:id,status:'delayed',ready:false,accountedFor:26,total:27,jobs:[{id:'job',index:19,status:'needs_attention',stages:{content:{status:'needs_attention',code:'validation'},azure:{status:'ready'}}}]});
test('Recovery offers only held stages and blocks uncertain, protected and running work',()=>{
 const j=diagnostic().jobs[0];assert.equal(canRepair(j,'content',j.stages.content),true);
 for(const code of ['academy_transport','uncertain_provider_outcome',401,403,'invalid_api_key'])assert.equal(canRepair(j,'content',{status:'needs_attention',code}),false);
 assert.equal(canRepair({...j,exclusion:{note:'excluded'}},'content',j.stages.content),false);
 assert.equal(canRepair({...j,status:'running'},'content',j.stages.content),false);
 assert.equal(canRepair(j,'azure',j.stages.azure),false);
});
test('Recovery binds owner/attempt/stage and reuses an operation after an interrupted response',async()=>{
 const {document}=parseHTML('<html><body><div id="host"></div></body></html>'),host=document.getElementById('host'),requests=[];
 const ui=mount(host,{username:'student name',operationId:()=> 'one-operation',request:async(path,body)=>{requests.push({path,body});if(body)throw Error('Connection interrupted');return diagnostic();}});
 const input=host.querySelector('input');input.value=id;await ui.inspect();
 assert.equal(host.querySelectorAll('[data-mock-job]').length,1);
 for(let i=0;i<2;i++)await host.querySelector('[data-mock-diagnostics]').onclick({target:host.querySelector('[data-mock-job]')});
 assert.equal(requests[0].path,'/api/admin/speaking-mocks/student%20name/'+id+'/scoring');
 assert.deepEqual(requests[1].body,{jobId:'job',stage:'content',operation:'staff:one-operation',acknowledgeUncertain:false});assert.deepEqual(requests[2].body,requests[1].body);
 input.value='another';input.oninput();assert.equal(host.querySelectorAll('[data-mock-job]').length,0);
 await ui.inspect();assert.equal(requests.length,3);
});
