'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{parseHTML}=require('linkedom');
const {mount}=require('../public/admin-full-mock-recovery');
const id='006d4971-2ad3-4f14-8e2a-0ea3ed450bdd';
const diagnostic=()=>({owner:'student',attemptId:id,ready:false,assessedCount:62,excludedCount:0,accountedFor:62,total:65,recovery:{status:'scheduled'},evidenceHash:'a'.repeat(64),responsesHash:'responses',confirmedHash:'marks',questions:[{id:'asq-1',number:24,type:'asq',status:'failed',eligible:true,reason:'transcription-unavailable'}]});
test('Full Mock exclusion requires explicit audio review and reuses the exact operation after a lost response',async()=>{
  const {document}=parseHTML('<html><body><div id="host"></div></body></html>'),host=document.getElementById('host'),requests=[];
  const ui=mount(host,{username:'student',operationId:()=> 'one-operation',request:async(path,body)=>{requests.push({path,body});if(body)throw Error('Connection interrupted');return diagnostic();}});
  const input=host.querySelector('[data-full-attempt]');input.value=id;await ui.inspect();
  const details=host.querySelector('[data-full-diagnostics]'),button=host.querySelector('[data-full-exclude]');
  await details.onclick({target:button});assert.equal(requests.length,1);
  host.querySelector('[data-full-question]').setAttribute('checked','');host.querySelector('[data-full-reviewed]').checked=true;
  for(let i=0;i<2;i++)await details.onclick({target:button});
  assert.equal(requests.length,3);assert.deepEqual(requests[1],requests[2]);
  assert.equal(requests[1].path,'/api/admin/full-mocks/student/'+id+'/scoring/exclude-audio');
  assert.equal(requests[1].body.operation,'staff:one-operation');assert.deepEqual(requests[1].body.questionIds,['asq-1']);assert.equal(requests[1].body.confirmUnusableAudio,true);
  input.oninput();assert.equal(host.querySelector('[data-full-exclude]'),null);
});
test('Active assessment work has no exclusion action and successful publication verifies retained evidence hashes',async()=>{
  const {document}=parseHTML('<html><body><div id="host"></div></body></html>'),host=document.getElementById('host');
  let busy=true;
  const ui=mount(host,{username:'student',operationId:()=> 'one-operation',request:async(path,body)=>body?{...diagnostic(),ready:true,assessedCount:62,excludedCount:3,accountedFor:65,questions:[]}:{...diagnostic(),busy}});
  host.querySelector('[data-full-attempt]').value=id;await ui.inspect();assert.equal(host.querySelector('[data-full-exclude]'),null);
  busy=false;await ui.inspect();host.querySelector('[data-full-question]').setAttribute('checked','');host.querySelector('[data-full-reviewed]').checked=true;
  await host.querySelector('[data-full-diagnostics]').onclick({target:host.querySelector('[data-full-exclude]')});
  assert.match(host.querySelector('[data-full-notice]').textContent,/Result ready/);
});
