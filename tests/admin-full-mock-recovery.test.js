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
test('Final RS release requires instructor confirmation and retains its exact operation after an interrupted response',async()=>{
 const {document}=parseHTML('<html><body><div id="host"></div></body></html>'),host=document.getElementById('host'),requests=[];
 const value={...diagnostic(),assessedCount:64,accountedFor:64,questions:[{id:'rs-final',number:16,type:'rs',status:'failed',eligible:false,deliveryEligible:true,reason:'delivery-unavailable'}]};
 let completed=false;
 const ui=mount(host,{username:'student',operationId:()=> 'rs-operation',request:async(path,body)=>{requests.push({path,body});if(!body)return value;if(!completed)throw Error('Lost response');return {...value,ready:true,excludedCount:1,accountedFor:65,questions:[]};}});
 host.querySelector('[data-full-attempt]').value=id;await ui.inspect();const details=host.querySelector('[data-full-diagnostics]'),button=host.querySelector('[data-full-exclude-delivery]');
 assert.match(button.textContent,/Question 16/);assert.equal(host.querySelector('[data-full-reviewed]'),null);assert.doesNotMatch(details.textContent,/audio is unusable/);
 await details.onclick({target:button});assert.equal(requests.length,1);host.querySelector('[data-full-instructor-confirm]').checked=true;
 await details.onclick({target:button});completed=true;await details.onclick({target:button});
 assert.deepEqual(requests[1],requests[2]);assert.equal(requests[1].path,'/api/admin/full-mocks/student/'+id+'/scoring/exclude-delivery');assert.deepEqual(requests[1].body.questionIds,['rs-final']);assert.equal(requests[1].body.confirmInstructorExclusion,true);assert.equal(requests[1].body.confirmUnusableAudio,undefined);
 assert.match(host.querySelector('[data-full-notice]').textContent,/Result ready/);assert.match(host.querySelector('[data-full-notice]').textContent,/completed marks are unchanged/);
});
test('Final ASQ transcription exclusion uses instructor confirmation without a claimed listening review',async()=>{
 const {document}=parseHTML('<html><body><div id="host"></div></body></html>'),host=document.getElementById('host'),requests=[];
 const value={...diagnostic(),assessedCount:64,accountedFor:64,questions:[{id:'asq-final',number:28,type:'asq',status:'failed',eligible:true,transcriptionEligible:true,reason:'transcription-unavailable'}]};
 const ui=mount(host,{username:'student',operationId:()=> 'asq-operation',request:async(path,body)=>{requests.push({path,body});return body?{...value,ready:true,excludedCount:1,accountedFor:65,questions:[]}:value;}});
 host.querySelector('[data-full-attempt]').value=id;await ui.inspect();const details=host.querySelector('[data-full-diagnostics]'),button=host.querySelector('[data-full-exclude-transcription]');
 assert.match(button.textContent,/Question 28/);assert.equal(host.querySelector('[data-full-reviewed]'),null);
 await details.onclick({target:button});assert.equal(requests.length,1);host.querySelector('[data-full-transcription-confirm]').checked=true;
 await details.onclick({target:button});assert.equal(requests.length,2);assert.equal(requests[1].body.mode,'failed-transcription');assert.equal(requests[1].body.confirmInstructorExclusion,true);assert.equal(requests[1].body.confirmUnusableAudio,undefined);
 assert.deepEqual(requests[1].body.questionIds,['asq-final']);assert.match(host.querySelector('[data-full-notice]').textContent,/Result ready/);
});
test('Admin can select a submitted attempt, send saved audio, review changes and explicitly publish',async()=>{
 const {document}=parseHTML('<html><body><div id="host"></div></body></html>'),host=document.getElementById('host'),requests=[];
 const d={...diagnostic(),ready:true,questions:[]},op='delivery:fixed-operation';
 let reviewed=false,published=false;
 const delivery=()=>({owner:'student',attemptId:id,paperId:'full-mock-1',paperVersion:1,evidenceHash:'evidence',profiles:{speaking:{practiceIndex:70}},questions:[{id:'di-1',number:17,type:'di',previous:{pronunciation:4,fluency:4}}],operations:reviewed?{[op]:{questionId:'di-1',status:published?'published':'review',evidenceHash:'evidence',previous:{result:{scores:{pronunciation:4,fluency:4}}},result:{pronunciation:{score:3},fluency:{score:2}},proposedProfiles:{speaking:{practiceIndex:65}}}}:{}});
 const ui=mount(host,{username:'student',operationId:()=> 'fixed-operation',request:async(path,body)=>{
  requests.push({path,body});if(path.endsWith('/attempts'))return {owner:'student',attempts:[{id,paperId:'full-mock-1',submittedAt:1000}]};
  if(path.endsWith('/send'))reviewed=true;if(path.endsWith('/publish'))published=true;
  return path.includes('/delivery')?delivery():d;
 }});
 await host.querySelector('[data-full-list]').onclick();const select=host.querySelector('[data-full-select]');select.querySelector('option[value="'+id+'"]').setAttribute('selected','');select.onchange();await ui.inspect();
 const details=host.querySelector('[data-full-diagnostics]');await details.onclick({target:host.querySelector('[data-delivery-load]')});
 assert(host.querySelector('[data-delivery-send]'),host.querySelector('[data-full-notice]').textContent+JSON.stringify(requests));await details.onclick({target:host.querySelector('[data-delivery-send]')});assert.match(details.textContent,/70 → 65/);assert.equal(published,false);
 await details.onclick({target:host.querySelector('[data-delivery-publish]')});assert.equal(published,false);
 host.querySelector('[data-delivery-confirm]').checked=true;await details.onclick({target:host.querySelector('[data-delivery-publish]')});assert.equal(published,true);
 assert.deepEqual(requests.find(r=>r.path.endsWith('/send')).body,{questionId:'di-1',evidenceHash:'evidence',operation:op});
 assert.match(host.querySelector('[data-full-notice]').textContent,/Replacement scores published/);
});
