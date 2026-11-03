'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{parseHTML}=require('linkedom');
test('My Progress distinguishes disabled Speaking from authorization and service failures',async()=>{
 for(const [status,body,warning] of [[403,{code:'SPEAKING_ACCESS_DISABLED'},false],[403,{error:'Account blocked'},true],[401,{error:'Expired'},true],[503,{error:'Unavailable'},true],[200,[],false]]){
  const {document}=parseHTML('<main id="progressPane"></main>'),context={AbortSignal};context.globalThis=context;
  vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../public/student-progress'),'utf8'),context);
  const progress=context.StudentProgress.create({document,identity:()=>({uid:'alice',token:'synthetic'}),loadLocal:async()=>({}),navigate(){},review(){},fetch:async path=>new Response(JSON.stringify(path.includes('speaking/')?body:[]),{status:path.includes('speaking/')?status:200,headers:{'Content-Type':'application/json'}})});
  await progress.open();assert.equal(!!document.querySelector('.progress-notice'),warning,'Speaking response '+status+' '+JSON.stringify(body));
 }
});
