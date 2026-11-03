'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{parseHTML}=require('linkedom');
const defer=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};};
const saved=title=>({swt:{7:[{text:'A saved summary.',timestamp:1700000000000,overall_score:80}]},passages:[{id:7,title}]});
function setup(options){const {document}=parseHTML('<main id="progressPane"></main>'),context={AbortSignal};context.globalThis=context;vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../public/student-progress'),'utf8'),context);return{document,controller:context.StudentProgress.create({document,navigate(){},review(){},...options})};}
async function microtasks(){for(let i=0;i<10;i++)await Promise.resolve();}
test('Cached progress is usable while cloud activity and refresh requests are stalled',async()=>{
 const gate=defer(),reviews=[];const h=setup({identity:()=>({uid:'alice',token:'alice'}),loadLocal:()=>saved('Cached SWT passage'),refreshLocal:()=>gate.promise.then(()=>saved('Fresh SWT passage')),fetch:()=>gate.promise.then(()=>Response.json([])),review:entry=>reviews.push(entry)});
 const done=h.controller.open();await microtasks();assert.match(h.document.getElementById('progressPane').textContent,/Cached SWT passage/);assert.doesNotMatch(h.document.getElementById('progressPane').textContent,/Loading your progress/);
 h.document.querySelector('[data-progress-attempt]').click();assert.equal(reviews[0].passageId,'7');
 gate.resolve();await done;assert.match(h.document.getElementById('progressPane').textContent,/Fresh SWT passage/);
});
test('Writing results appear without waiting for Speaking or account sync',async()=>{
 const gate=defer();const h=setup({identity:()=>({uid:'alice',token:'alice'}),loadLocal:()=>({}),refreshLocal:()=>gate.promise.then(()=>({})),fetch:path=>path.includes('speaking/')?gate.promise.then(()=>Response.json([])):Promise.resolve(Response.json([{id:'dictation',kind:'wfd',title:'New dictation result',status:'submitted',total:3,maximum:3,startedAt:1700000000000}]))});
 const done=h.controller.open();await new Promise(resolve=>setImmediate(resolve));assert.match(h.document.getElementById('progressPane').textContent,/New dictation result/);gate.resolve();await done;
});
test('Slow old local reads cannot replace a newer cloud snapshot',async()=>{
 const gate=defer(),h=setup({identity:()=>({uid:'alice',token:'alice'}),loadLocal:()=>gate.promise.then(()=>saved('Old snapshot')),refreshLocal:()=>saved('New snapshot'),fetch:async()=>Response.json([])});
 const done=h.controller.open();await microtasks();assert.match(h.document.getElementById('progressPane').textContent,/New snapshot/);gate.resolve();await done;assert.doesNotMatch(h.document.getElementById('progressPane').textContent,/Old snapshot/);
});
test('Account switches clear cached rows and ignore late old-account responses',async()=>{
 let uid='alice';const gate=defer(),h=setup({identity:()=>({uid,token:uid}),loadLocal:()=>saved(uid==='alice'?'Private Alice passage':'Bob passage'),fetch:()=>gate.promise.then(()=>Response.json([]))});
 const first=h.controller.open();await microtasks();assert.match(h.document.getElementById('progressPane').textContent,/Private Alice/);uid='bob';const second=h.controller.open();assert.doesNotMatch(h.document.getElementById('progressPane').textContent,/Private Alice/);await microtasks();gate.resolve();await Promise.all([first,second]);assert.match(h.document.getElementById('progressPane').textContent,/Bob passage/);assert.doesNotMatch(h.document.getElementById('progressPane').textContent,/Private Alice/);
});
