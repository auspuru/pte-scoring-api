'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{parseHTML}=require('linkedom');
const {createController}=require('../public/random-practice'),types=require('../random-practice').catalogue();
function harness(fetch){const {document}=parseHTML('<section id="randomPracticePane"></section>'),launched=[];let owner='alice';const env={document,sessionStorage:{getItem:()=>owner},fetch:fetch||(async url=>({ok:true,json:async()=>url.endsWith('/catalog')?{types}:[]}))};const controller=createController(env,{getUserId:()=>owner,launchSpeaking:request=>launched.push({engine:'speaking',request}),launchWriting:request=>launched.push({engine:'writing',request})});const host=document.getElementById('randomPracticePane');return {controller,document,host,launched,setOwner:value=>owner=value,click:selector=>host.onclick({target:host.querySelector(selector)})};}
test('the selector offers only a single type and count and hands the random choice to the server',async()=>{
 const h=harness();await h.controller.open();assert.equal(h.host.querySelectorAll('select').length,2);assert.equal(h.host.querySelectorAll('input[type="checkbox"]').length,0);assert(!h.host.querySelector('[multiple]'));
 h.host.onchange({target:{id:'practice-set-type',value:'rs'}});h.host.onchange({target:{id:'practice-set-count',value:'20'}});await h.click('[data-rp="start"]');assert.deepEqual(h.launched[0],{engine:'speaking',request:{practiceSet:{type:'rs',count:20}}});
 h.host.onchange({target:{id:'practice-set-type',value:'sgd'}});assert.deepEqual([...h.host.querySelectorAll('#practice-set-count option')].map(q=>q.value),['5','10','15']);
 h.host.onchange({target:{id:'practice-set-type',value:'wfd'}});await h.click('[data-rp="start"]');assert.equal(h.launched[1].engine,'writing');assert.equal(h.launched[1].request.practiceSet.type,'wfd');
});
test('saved sets show overall results and reopen the existing attempt instead of choosing new questions',async()=>{
 const h=harness(async url=>({ok:true,json:async()=>url.endsWith('/catalog')?{types}:[{id:'saved-id',engine:'writing',type:'wfd',count:5,title:'<saved set>',status:'submitted',ready:true,score90:74,startedAt:1}]}));await h.controller.open();assert(h.host.textContent.includes('74'));assert(!h.host.querySelector('saved'));await h.click('[data-rp="resume"]');assert.deepEqual(h.launched[0],{engine:'writing',request:{attemptId:'saved-id'}});
});
test('a delayed history response cannot expose the previous account after switching users',async()=>{
 let release;const h=harness(async(url,options)=>({ok:true,json:()=>url.endsWith('/catalog')?Promise.resolve({types}):options.headers['x-session-token']==='alice'?new Promise(resolve=>release=resolve):Promise.resolve([])}));const before=h.controller.open();await new Promise(resolve=>setImmediate(resolve));h.setOwner('bob');await h.controller.open();release([{id:'private',title:'Alice private practice',type:'ra',count:5,status:'submitted',ready:true,score90:90,startedAt:1}]);await before;assert(!h.host.textContent.includes('Alice private'));assert(!h.host.querySelector('[data-rp="resume"]'));
});
