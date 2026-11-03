'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{parseHTML}=require('linkedom'),catalogue=require('../public/practice-catalogue');
const reading=require('../public/reading-bank.json');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
test('Practice choices are actionable while every catalogue and history request is stalled',async()=>{
 const {document}=parseHTML('<main id="practiceHubPane"></main>'),bank=deferred(),history=deferred(),navigations=[];
 const c=catalogue.createController({document,navigate:route=>navigations.push(route),getProgress:()=>history.promise,fetch:()=>bank.promise});
 const done=c.openPractice(),host=document.getElementById('practiceHubPane');
 assert.match(host.textContent,/Reading Practice/);assert.doesNotMatch(host.textContent,/Loading practice choices|Not attempted yet/);
 const details=host.querySelector('.practice-banner.reading'),button=host.querySelector('[data-practice-route="reading-dropdown"]');details.open=true;
 button.click();assert.deepEqual(navigations,['reading-dropdown']);
 bank.resolve({ok:true,json:async()=>reading});history.resolve({practice:{'reading-dropdown':{count:42,lastAttempt:1000}},mocks:{}});
 await done;assert.equal(host.querySelector('[data-practice-route="reading-dropdown"]'),button,'Metadata does not recreate controls');assert.equal(details.open,true);
 assert.match(button.textContent,/42 questions/);assert.match(button.textContent,/Last attempt/);
});
test('Failed metadata requests leave all choices available and allow a later retry',async()=>{
 const {document}=parseHTML('<main id="practiceHubPane"></main>');let fail=true;
 const c=catalogue.createController({document,navigate(){},getProgress:async()=>{if(fail)throw Error('Offline');return{practice:{swt:{count:18}}};},fetch:async()=>{if(fail)throw Error('Offline');return{ok:true,json:async()=>reading};}});
 await c.openPractice();assert.equal(document.querySelectorAll('[data-practice-route]').length,catalogue.groups.flatMap(g=>g.tasks).length);assert.doesNotMatch(document.getElementById('practiceHubPane').textContent,/Not attempted yet|could not load/);
 fail=false;await c.openPractice();assert.match(document.querySelector('[data-practice-route="swt"]').textContent,/18 questions/);
});
test('Late metadata from an old account cannot overwrite the current account practice menu',async()=>{
 const {document}=parseHTML('<main id="practiceHubPane"></main>'),first=deferred(),second=deferred();let owner='first';
 const c=catalogue.createController({document,navigate(){},getSessionToken:()=>owner,getProgress:()=>owner==='first'?first.promise:second.promise,fetch:async()=>({ok:true,json:async()=>reading})});
 const old=c.openPractice();owner='second';const current=c.openPractice();second.resolve({practice:{swt:{count:2}},mocks:{}});await current;
 first.resolve({practice:{swt:{count:99,lastAttempt:1000}},mocks:{}});await old;
 const button=document.querySelector('[data-practice-route="swt"]');assert.match(button.textContent,/2 questions/);assert.doesNotMatch(button.textContent,/99 questions|Last attempt/);
});
