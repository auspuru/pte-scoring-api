const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const express=require('express');
const {installInterventions}=require('../interventions');
const passages=require('../passages.json').map(require('../swt-reference').studentPassage);

async function harness(options={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'interventions-'));
  const app=express();app.use(express.json());
  const users=new Set(['alice','bob']);
  installInterventions(app,{
    directory,
    verifyToken:token=>users.has(token)?token:null,
    getAccount:async uid=>users.has(uid)?{username:uid,blocked:false}:null,
    getProgress:options.getProgress,
    getPassages:options.getPassages,
    getPassage:options.getPassage,
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

test('assigned reading questions complete automatically from synced attempt evidence',async t=>{
  const finishedAt=Date.now()+2000;
  const h=await harness({getProgress:async()=>({readingProgress:{practiceResults:{'pte:q-1':{earned:3,possible:4,finishedAt}}}})});
  t.after(async()=>{await new Promise(r=>h.server.close(r));await fs.rm(h.directory,{recursive:true,force:true});});
  const created=(await call(h.base,'/api/admin/interventions/alice',{method:'POST',admin:'teacher',body:{
    title:'Reading practice',items:[{kind:'question',title:'FIB 1',engine:'reading',questionId:'pte:q-1',requireNewAttempt:true}]
  }})).data.plan;
  const listed=await call(h.base,'/api/interventions',{token:'alice'});
  const item=listed.data.plans.find(p=>p.id===created.id).items[0];
  assert.equal(item.status,'completed');
  assert.equal(item.completionSource,'attempt_sync');
  assert.match(item.completionEvidence,/Automatically matched/);
});

test('self-help Beta uses recent SWT trait scores and can create a student plan',async t=>{
  const h=await harness({getProgress:async()=>({history:{1:[{
    timestamp:new Date().toISOString(),trait_scores:{content:2,form:1,grammar:2,vocabulary:2}
  }]}})});
  t.after(async()=>{await new Promise(r=>h.server.close(r));await fs.rm(h.directory,{recursive:true,force:true});});
  const advice=await call(h.base,'/api/interventions/help',{method:'POST',token:'alice',body:{task:'swt',problem:'I do not know how to pick the main idea'}});
  assert.equal(advice.status,200);
  assert.equal(advice.data.beta,true);
  assert.equal(advice.data.latestScore.scores.content,2);
  assert(advice.data.suggestions.some(x=>x.moduleCode==='SWT-CONTENT-01'));
  const plan=await call(h.base,'/api/interventions/self-plan',{method:'POST',token:'alice',body:{moduleCode:'SWT-01',problem:'How should I attempt SWT?'}});
  assert.equal(plan.status,200);
  assert.equal(plan.data.plan.source,'student');
  assert.match(plan.data.plan.title,/Self-help Beta/);
});

test('SWT Beta routes important-line questions to the highlight trainer first',async t=>{
  const h=await harness({getProgress:async()=>({history:{1:[{
    timestamp:new Date().toISOString(),trait_scores:{content:4,form:1,grammar:2,vocabulary:2}
  }]}})});
  t.after(async()=>{await new Promise(r=>h.server.close(r));await fs.rm(h.directory,{recursive:true,force:true});});
  const advice=await call(h.base,'/api/interventions/help',{method:'POST',token:'alice',body:{task:'swt',problem:'how to know which lines are important?'}});
  assert.equal(advice.status,200);
  assert.equal(advice.data.suggestions[0].moduleCode,'SWT-CONTENT-01');
  assert.match(advice.data.suggestions[0].action,/Highlight only the important sentences/i);
  assert.equal(advice.data.latestScore.scores.content,4);
});

test('SWT highlight trainer serves existing passages and completes after the configured minimum',async t=>{
  const h=await harness({
    getPassages:async()=>passages,
    getPassage:async id=>passages.find(p=>String(p.id)===String(id))||null
  });
  t.after(async()=>{await new Promise(r=>h.server.close(r));await fs.rm(h.directory,{recursive:true,force:true});});
  const created=await call(h.base,'/api/admin/interventions/alice',{method:'POST',admin:'teacher',body:{
    moduleCode:'SWT-CONTENT-01',area:'Writing',task:'Summarize Written Text',title:'Highlight trainer',
    items:[{kind:'swt_selection_trainer',title:'Highlight practice',exerciseCount:15,minimumToComplete:2,required:true}]
  }});
  assert.equal(created.status,200);
  const plan=created.data.plan,item=plan.items[0];
  const first=await call(h.base,'/api/interventions/'+plan.id+'/items/'+item.id+'/swt-selection',{token:'alice'});
  assert.equal(first.status,200);
  assert.equal(first.data.catalog.length,15);
  assert.equal(Object.hasOwn(first.data.exercise,'targetSentenceIndexes'),false);
  const firstId=first.data.exercise.id;
  let checked=await call(h.base,'/api/interventions/'+plan.id+'/items/'+item.id+'/swt-selection/check',{method:'POST',token:'alice',body:{passageId:firstId,selected:[0]}});
  assert.equal(checked.status,200);
  assert.equal(checked.data.progress.attempted,1);
  assert.equal(checked.data.item.status,'started');
  assert(Array.isArray(checked.data.result.targetSentenceIndexes));
  const next=await call(h.base,'/api/interventions/'+plan.id+'/items/'+item.id+'/swt-selection',{token:'alice'});
  const secondId=next.data.exercise.id;
  assert.notEqual(secondId,firstId);
  checked=await call(h.base,'/api/interventions/'+plan.id+'/items/'+item.id+'/swt-selection/check',{method:'POST',token:'alice',body:{passageId:secondId,selected:[0]}});
  assert.equal(checked.status,200);
  assert.equal(checked.data.progress.attempted,2);
  assert.equal(checked.data.item.status,'completed');
  assert.equal(checked.data.item.completionSource,'trainer_sync');
});

test('SWT content self-help remaps generic Content Picking to the highlight trainer',async t=>{
  const h=await harness();
  t.after(async()=>{await new Promise(r=>h.server.close(r));await fs.rm(h.directory,{recursive:true,force:true});});
  const result=await call(h.base,'/api/interventions/self-plan',{method:'POST',token:'alice',body:{
    moduleCode:'CP-01',task:'swt',problem:'how to improve content?'
  }});
  assert.equal(result.status,200);
  assert.equal(result.data.plan.moduleCode,'SWT-CONTENT-01');
  assert.equal(result.data.plan.task,'Summarize Written Text');
  assert.equal(result.data.plan.items[0].kind,'swt_selection_trainer');
});

test('an older generic CP-01 self-help card upgrades automatically to the SWT trainer',async t=>{
  const h=await harness();
  t.after(async()=>{await new Promise(r=>h.server.close(r));await fs.rm(h.directory,{recursive:true,force:true});});
  const created=await call(h.base,'/api/admin/interventions/alice',{method:'POST',admin:'teacher',body:{
    source:'student',moduleCode:'CP-01',area:'Writing / Speaking / Listening',task:'SWT, RL, SGD, SST',
    title:'Content Picking — Main Idea · Self-help Beta',reason:'You asked for help with: how to improve content?',
    items:[{kind:'practice',title:'Main idea drill',description:'For 5 passages or audios, identify only the central idea.'}]
  }});
  assert.equal(created.status,200);
  const listed=await call(h.base,'/api/interventions',{token:'alice'});
  const plan=listed.data.plans.find(p=>p.id===created.data.plan.id);
  assert.equal(plan.moduleCode,'SWT-CONTENT-01');
  assert.equal(plan.items[0].kind,'swt_selection_trainer');
});

test('practice-set progress completes automatically from qualifying SWT submissions',async t=>{
  const future1=new Date(Date.now()+3000).toISOString(),future2=new Date(Date.now()+4000).toISOString();
  const h=await harness({getProgress:async()=>({history:{
    1:[{timestamp:future1,trait_scores:{content:4,form:1,grammar:2,vocabulary:2}}],
    2:[{timestamp:future2,trait_scores:{content:3,form:1,grammar:2,vocabulary:2}}]
  }})});
  t.after(async()=>{await new Promise(r=>h.server.close(r));await fs.rm(h.directory,{recursive:true,force:true});});
  const created=await call(h.base,'/api/admin/interventions/alice',{method:'POST',admin:'teacher',body:{
    title:'SWT application',items:[{kind:'practice_set',title:'3 SWT attempts',engine:'swt',route:'swt',practiceType:'swt',minimumAttempts:2}]
  }});
  assert.equal(created.status,200);
  const listed=await call(h.base,'/api/interventions',{token:'alice'});
  const item=listed.data.plans.find(p=>p.id===created.data.plan.id).items[0];
  assert.equal(item.attemptProgress.count,2);
  assert.equal(item.status,'completed');
  assert.equal(item.completionSource,'attempt_sync');
});

test('Beta content suggestions stay task-specific for SST and Essay',async t=>{
  const h=await harness();
  t.after(async()=>{await new Promise(r=>h.server.close(r));await fs.rm(h.directory,{recursive:true,force:true});});
  let advice=await call(h.base,'/api/interventions/help',{method:'POST',token:'alice',body:{task:'sst',problem:'I struggle with content and key points'}});
  assert.equal(advice.status,200);
  assert(advice.data.suggestions.some(x=>x.moduleCode==='SST-01'));
  assert.equal(advice.data.suggestions.some(x=>x.moduleCode==='NT-01'),false);
  advice=await call(h.base,'/api/interventions/help',{method:'POST',token:'alice',body:{task:'essay',problem:'I struggle with content and ideas'}});
  assert.equal(advice.status,200);
  assert(advice.data.suggestions.some(x=>x.moduleCode==='ESSAY-01'));
  assert.equal(advice.data.suggestions.some(x=>x.moduleCode==='CP-01'),false);
});
