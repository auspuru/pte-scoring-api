'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),{allowed,gate}=require('../speaking-access');
test('Speaking allowlist contains only the five designated accounts',()=>{for(const user of ['pppp','mehakbir1','mahabir1','mahdis','sukhpal',' SUKHPAL ',' MAHDIS ',' PPPP '])assert(allowed(user));for(const user of ['admin','alice','',null])assert(!allowed(user));});
test('Both speaking APIs block unauthenticated and other accounts before catalogue or attempt handlers',async t=>{const app=express();let calls=0;app.use(['/api/speaking','/api/speaking-mocks'],gate(token=>token||null));app.use((req,res)=>{calls++;res.json({ok:true});});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>{server.closeAllConnections();server.close();});const base='http://127.0.0.1:'+server.address().port;for(const prefix of ['/api/speaking','/api/speaking-mocks'])for(const route of ['/catalog','/attempts','/attempts/test/reattempt'])for(const user of ['','alice','mahabir1','pppp','mehakbir1','mahdis','sukhpal']){const r=await fetch(base+prefix+route,{headers:{'x-session-token':user}});assert.equal(r.status,!user?401:allowed(user)?200:403);assert.match(r.headers.get('cache-control'),/no-store/);}assert.equal(calls,30);});

test('Admin speaking controls persist grants and revocations, protect writes and apply to existing sessions',async t=>{
  const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-access-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const app=express();app.use(express.json());
  const options={directory,verify:token=>token||null,getAccount:async uid=>uid==='missing'?null:{blocked:uid==='blocked'},requireAdmin:(req,res,next)=>req.headers['x-admin-key']==='test-key'?next():res.sendStatus(403)};
  const service=require('../speaking-access').install(app,options);
  app.get('/speaking-test',gate(options.verify,service.allowed),(req,res)=>res.json({ok:true}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>{server.closeAllConnections();server.close();});
  const base='http://127.0.0.1:'+server.address().port;
  const update=(username,enabled,key='test-key')=>fetch(base+'/api/admin/speaking-access',{method:'POST',headers:{'Content-Type':'application/json','x-admin-key':key},body:JSON.stringify({username,enabled})});
  assert.equal((await update('alice',true,'wrong')).status,403);assert.equal(await service.allowed('alice'),false);
  assert.equal((await update('missing',true)).status,404);assert.equal((await update('alice','true')).status,400);
  assert.equal((await update(' ALICE ',true)).status,200);assert.equal(await service.allowed('alice'),true);
  assert.equal((await fetch(base+'/speaking-test',{headers:{'x-session-token':'alice'}})).status,200);
  assert.equal((await update('alice',false)).status,200);
  assert.equal((await fetch(base+'/speaking-test',{headers:{'x-session-token':'alice'}})).status,403);
  assert.equal(await service.allowed('mahdis'),true);await update('mahdis',false);assert.equal(await service.allowed('mahdis'),false);
  const restarted=require('../speaking-access').install(express(),options);assert.equal(await restarted.allowed('mahdis'),false);assert.equal(await restarted.allowed('alice'),false);
  assert.equal((await fetch(base+'/api/speaking-access')).status,401);
  const blocked=await (await fetch(base+'/api/speaking-access',{headers:{'x-session-token':'blocked'}})).json();assert.equal(blocked.enabled,false);
  const decorated=await service.decorate([{username:'mahdis'},{username:'sukhpal'},{username:'alice'},{username:'pppp',hasAccount:false}]);assert.deepEqual(decorated.map(u=>u.speakingAccess),[false,true,false,false]);
});
