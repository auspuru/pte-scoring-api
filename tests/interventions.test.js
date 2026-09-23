const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const express=require('express');
const {installInterventions}=require('../interventions');

async function harness(){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'interventions-'));
  const app=express();app.use(express.json());
  const users=new Set(['alice','bob']);
  installInterventions(app,{
    directory,
    verifyToken:token=>users.has(token)?token:null,
    getAccount:async uid=>users.has(uid)?{username:uid,blocked:false}:null,
    requireAdmin:(req,res,next)=>req.headers['x-admin-key']==='teacher'?next():res.status(403).json({error:'Invalid admin key'})
  });
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  return {directory,server,base:'http://127.0.0.1:'+server.address().port};
}
async function call(base,url,{method='GET',body,token,admin}={}){
  const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(token?{'x-session-token':token}:{}),...(admin?{'x-admin-key':admin}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  let data={};try{data=await r.json();}catch(_){}
  return {status:r.status,data};
}
test('teacher assigns next steps and student completes them for review',async t=>{
  const h=await harness();t.after(async()=>{await new Promise(r=>h.server.close(r));await fs.rm(h.directory,{recursive:true,force:true});});
  const created=await call(h.base,'/api/admin/interventions/alice',{method:'POST',admin:'teacher',body:{
    moduleCode:'PR-01',area:'Speaking',task:'Read Aloud',title:'Pronunciation Clarity',reason:'Improve clarity',notify:true,
    items:[{kind:'video',title:'Exercise',url:'https://example.com/video'},{kind:'question',title:'RA 1',engine:'speaking',route:'speaking-ra',questionId:'ra-1',requireNewAttempt:true}]
  }});
  assert.equal(created.status,200);assert.equal(created.data.plan.notificationUnread,true);assert.equal(created.data.plan.items.length,2);
  const list=await call(h.base,'/api/interventions',{token:'alice'});assert.equal(list.status,200);assert.equal(list.data.plans.length,1);
  const plan=list.data.plans[0],first=plan.items[0],second=plan.items[1];
  let r=await call(h.base,'/api/interventions/'+plan.id+'/items/'+first.id,{method:'POST',token:'alice',body:{action:'complete'}});
  assert.equal(r.status,200);assert.equal(r.data.plan.status,'in_progress');
  r=await call(h.base,'/api/interventions/'+plan.id+'/ready',{method:'POST',token:'alice',body:{}});
  assert.equal(r.status,409);
  await call(h.base,'/api/interventions/'+plan.id+'/items/'+second.id,{method:'POST',token:'alice',body:{action:'start'}});
  r=await call(h.base,'/api/interventions/'+plan.id+'/items/'+second.id,{method:'POST',token:'alice',body:{action:'complete'}});
  assert.equal(r.status,200);
  r=await call(h.base,'/api/interventions/'+plan.id+'/ready',{method:'POST',token:'alice',body:{}});
  assert.equal(r.status,200);assert.equal(r.data.plan.status,'ready_for_review');
  r=await call(h.base,'/api/admin/interventions/alice/'+plan.id,{method:'POST',admin:'teacher',body:{status:'mastered'}});
  assert.equal(r.status,200);assert.equal(r.data.plan.status,'mastered');assert.ok(r.data.plan.masteredAt);
});
test('student routes require auth and active focus areas are capped at three',async t=>{
  const h=await harness();t.after(async()=>{await new Promise(r=>h.server.close(r));await fs.rm(h.directory,{recursive:true,force:true});});
  assert.equal((await call(h.base,'/api/interventions')).status,401);
  for(let i=0;i<3;i++){
    const r=await call(h.base,'/api/admin/interventions/bob',{method:'POST',admin:'teacher',body:{title:'Plan '+i,items:[{kind:'practice',title:'Step'}]}});
    assert.equal(r.status,200);
  }
  const fourth=await call(h.base,'/api/admin/interventions/bob',{method:'POST',admin:'teacher',body:{title:'Plan 4',items:[{kind:'practice',title:'Step'}]}});
  assert.equal(fourth.status,409);assert.match(fourth.data.error,/3 active focus areas/);
});
test('notification can be dismissed without completing the plan',async t=>{
  const h=await harness();t.after(async()=>{await new Promise(r=>h.server.close(r));await fs.rm(h.directory,{recursive:true,force:true});});
  const created=(await call(h.base,'/api/admin/interventions/alice',{method:'POST',admin:'teacher',body:{title:'Focus',items:[{kind:'practice',title:'Step'}]}})).data.plan;
  const result=await call(h.base,'/api/interventions/'+created.id+'/notification-read',{method:'POST',token:'alice',body:{}});
  assert.equal(result.status,200);assert.equal(result.data.plan.notificationUnread,false);assert.equal(result.data.plan.status,'not_started');
});
