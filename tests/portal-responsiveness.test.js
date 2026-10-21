'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../public/index'),'utf8');
function fn(name) {
  let start=source.indexOf('async function '+name+'(');
  if(start<0)start=source.indexOf('function '+name+'(');
  assert(start>=0,name);
  return source.slice(start,source.indexOf('\n}',start)+2);
}
function harness() {
  const requests=[],resumes=[];
  const ctx={currentUserId:'student',sessionToken:'token-a',API_URL:'',AbortSignal,
    canonicalClientUserId:s=>String(s).toLowerCase(),
    portalCatalogueProgressCache:{uid:'',at:0,value:null},portalWritingAttemptsCache:null,
    portalResumeCache:{uid:'',at:0,item:null},portalResumeFetchSerial:0,passages:[],essays:[],
    LocalStore:{get:()=>({})},getPteStorageKey:()=>'',getPracticeHistory:()=>[],localAccountProgress:()=>({}),
    window:{AccountProgress:require('../public/account-progress')},
    applyPortalResumeCandidate:item=>resumes.push(item),
    fetch:(url,options)=>new Promise(resolve=>requests.push({url,options,
      reply:(data,ok=true)=>resolve({ok,json:async()=>data})}))};
  vm.createContext(ctx);
  vm.runInContext(['getPortalWritingAttempts','practiceLastTime','setLatestPracticeMeta','getPortalCatalogueProgress','refreshWritingPortalResume'].map(fn).join('\n'),ctx);
  return {ctx,requests,resumes};
}
test('simultaneous catalogue and dashboard refreshes share reads and start independent APIs together',async()=>{
  const {ctx,requests,resumes}=harness();
  const tasks=Array.from({length:25},()=>ctx.getPortalCatalogueProgress());
  tasks.push(...Array.from({length:25},()=>ctx.refreshWritingPortalResume(null)));
  assert.deepEqual(requests.map(r=>r.url).sort(),['/api/speaking/attempts','/api/speaking/catalog','/api/writing-lab/attempts']);
  for(const request of requests)request.reply(request.url.endsWith('/catalog')?{questions:[{type:'di'}]}:
    request.url.includes('writing-lab')?[{id:'saved',kind:'sst',status:'active',startedAt:100}]:[]);
  const values=await Promise.all(tasks);
  assert.equal(requests.length,3);
  assert.equal(values[0].practice['speaking-di'].count,1);
  assert.equal(values[0].practice['spoken-text'].lastAttempt,100);
  assert.equal(resumes.at(-1).id,'saved');
  await ctx.getPortalWritingAttempts();await ctx.getPortalCatalogueProgress();
  assert.equal(requests.length,3);
});
test('a failed attempts read is retryable and never cached as an empty successful response',async()=>{
  const {ctx,requests}=harness();
  const failed=ctx.getPortalWritingAttempts();requests[0].reply({},false);
  await assert.rejects(failed,/could not load/);
  const retry=ctx.getPortalWritingAttempts();assert.equal(requests.length,2);
  requests[1].reply([{id:'actual'}]);assert.equal((await retry)[0].id,'actual');
});
test('relogin changes the cache identity and late private data cannot overwrite the new session',async()=>{
  const {ctx,requests}=harness();
  const previous=ctx.getPortalWritingAttempts();
  const rejected=assert.rejects(previous,/Account session changed/);
  ctx.sessionToken='token-b';
  const current=ctx.getPortalWritingAttempts();
  assert.equal(requests.length,2);
  requests[0].reply([{id:'old'}]);requests[1].reply([{id:'new'}]);
  await rejected;assert.equal((await current)[0].id,'new');
  assert.equal((await ctx.getPortalWritingAttempts())[0].id,'new');
  assert.equal(requests.length,2);
});
test('catalogue results finishing after an account switch cannot publish the previous account history',async()=>{
  const {ctx,requests}=harness();
  const old=ctx.getPortalCatalogueProgress();
  ctx.currentUserId='other';ctx.sessionToken='token-b';
  for(const request of requests)request.reply(request.url.endsWith('/catalog')?{questions:[]}:[{id:'private'}]);
  assert.deepEqual(JSON.parse(JSON.stringify(await old)),{practice:{},mocks:{}});
});
test('hidden dashboard and resume widgets do no rendering or network work during practice',()=>{
  const ctx={document:{body:{dataset:{section:'reading-dropdown'}},getElementById(){throw Error('Hidden UI was touched.');}}};
  vm.runInNewContext(fn('updateDashboard')+'\n'+fn('updatePortalResume'),ctx);
  assert.doesNotThrow(()=>ctx.updateDashboard());assert.doesNotThrow(()=>ctx.updatePortalResume());
});
test('reading dependencies download together and the client waits for every dependency',async()=>{
  const requests=[];
  const ctx={window:{},readingRuntimeLoadPromise:null,loadDeferredScript:(src,key)=>new Promise(resolve=>requests.push({src,key,resolve:()=>{
    if(key==='reading practice')ctx.window.ReadingPractice={open(){}};
    resolve();
  }}))};
  vm.runInNewContext(fn('ensureReadingRuntimeLoaded'),ctx);
  const result=ctx.ensureReadingRuntimeLoaded();
  assert.equal(requests.length,5);
  requests.slice(0,4).forEach(r=>r.resolve());
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests.length,5);
  requests[4].resolve();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests.length,6);assert.equal(requests[5].key,'reading practice');
  requests[5].resolve();assert.equal(await result,ctx.window.ReadingPractice);
  assert.match(fn('loadDeferredScript'),/script\.async = false/);
});
test('optional public configuration cannot stall login when its request is slow',async()=>{
  let loginShown=false;
  const ctx={authFlowRevision:0,initialisePortalWorkspace(){},console:{log(){}},
    window:{location:{search:''}},API_URL:'',fetch:()=>new Promise(()=>{}),URLSearchParams,
    sessionStorage:{getItem:()=>null},LocalStore:{getUserId:()=>null},showLogin:()=>{loginShown=true;}};
  vm.runInNewContext(fn('initApp'),ctx);
  await ctx.initApp();assert.equal(loginShown,true);
});
test('attempt metadata expires promptly instead of hiding newly saved work',async()=>{
  const {ctx,requests}=harness();let now=1000;ctx.Date={now:()=>now,parse:Date.parse};
  const first=ctx.getPortalWritingAttempts();requests[0].reply([{id:'before'}]);await first;
  now+=10001;
  const next=ctx.getPortalWritingAttempts();assert.equal(requests.length,2);
  requests[1].reply([{id:'after'}]);assert.equal((await next)[0].id,'after');
});
