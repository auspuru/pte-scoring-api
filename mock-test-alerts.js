'use strict';
const path=require('node:path');
const {createJobs,createWorker,hash}=require('./scoring-jobs');
const {ENGINES}=require('./mock-test-alert-events');
const TEN_MINUTES=10*60000;
const ID=/^[a-zA-Z0-9_-]{1,120}$/;
function createMockTestAlerts({pool,directory,delivery,sources={},enabled=false,now=Date.now,intervalMs=60000,logger=console}={}){
  const watches=createJobs({pool,directory:path.join(directory,'mock-watches'),table:'mock_test_watch_jobs',now});
  let since,started=false,checking=false,timer;const cursors={},registered=new Set(),reportedErrors=new Set();
  const remember=(set,key)=>{set.add(key);if(set.size>5000)set.delete(set.values().next().value);};
  const warning=()=>logger.warn('[mock-alerts] Saved notifications will be checked again.');
  const sourceFor=engine=>ENGINES[engine]&&sources[engine];
  function event(kind,engine,username,snapshot,extra={}){
    return{kind,engine,username,attemptId:snapshot.id,title:snapshot.title||ENGINES[engine]+' mock',at:now(),...extra};
  }
  async function observe(engine,username,snapshot){
    if(!enabled||!started||!sourceFor(engine)||!snapshot?.isMock||!ID.test(snapshot.id||''))return;
    if(snapshot.mediaError&&(!snapshot.mediaErrorAt||snapshot.mediaErrorAt>=since))await error(engine,username,snapshot.id,'media','MEDIA_UNAVAILABLE',snapshot.title);
    if(!snapshot.submitted||!Number.isFinite(snapshot.finishedAt)||snapshot.finishedAt<since||snapshot.finishedAt>now()+60000)return;
    const key=engine+':'+username+':'+snapshot.id;if(registered.has(key))return;
    await delivery.notify(event('submitted',engine,username,snapshot,{at:snapshot.finishedAt,ready:!!snapshot.ready}));
    if(engine==='speaking'){remember(registered,key);return;} // Keep the existing detailed Azure/Academy incident workflow and its receipts.
    const id=hash({kind:'mock-watch-v1',engine,username,id:snapshot.id});
    await watches.enqueue({id,owner:username,groupId:engine+':'+snapshot.id,inputHash:id,
      data:{engine,attemptId:snapshot.id,submittedAt:snapshot.finishedAt,stages:{}}});
    remember(registered,key);
    void worker.wake().catch(warning);
  }
  async function observeId(engine,username,id){
    if(!enabled||!started||!sourceFor(engine)||!ID.test(id||''))return;
    const snapshot=await sources[engine].get(username,id);if(snapshot)await observe(engine,username,snapshot);return snapshot;
  }
  async function error(engine,username,id,operation,code='SERVER_ERROR',title){
    if(!enabled||!started||!sourceFor(engine)||!ID.test(id||'')||typeof username!=='string'||!username)return;
    const key=engine+':'+username+':'+id;if(reportedErrors.has(key))return;
    const safeCode=/^(?:HTTP_5\d\d|MEDIA_UNAVAILABLE|ASSESSMENT_FAILED|ASSESSMENT_PENDING|REPORT_UNAVAILABLE|SERVER_ERROR)$/.test(code)?code:'SERVER_ERROR';
    const safeOperation=['save','recording','submission','assessment','results','load','media','sync'].includes(operation)?operation:'load';
    const receipt=await delivery.notify(event('error',engine,username,{id,title},{code:safeCode,operation:safeOperation}));
    remember(reportedErrors,key);return receipt;
  }
  const worker=createWorker({store:watches,now,concurrency:2,run:async ctx=>{
    if(ctx.data.control)return{status:'ready'};
    const {engine,attemptId,submittedAt}=ctx.data,source=sourceFor(engine);
    if(!source)return{status:'needs_attention'};
    let snapshot;
    try{snapshot=await source.get(ctx.row.owner,attemptId);}catch{
      if(now()-submittedAt>=TEN_MINUTES)await delivery.notify(event('attention',engine,ctx.row.owner,{id:attemptId},{code:'REPORT_UNAVAILABLE',operation:'load'}));
      return{status:'retry_wait',runAfter:now()+intervalMs};
    }
    if(!snapshot||!snapshot.submitted||snapshot.ready)return{status:'ready'};
    if(snapshot.held||now()-submittedAt>=TEN_MINUTES){
      await delivery.notify(event('attention',engine,ctx.row.owner,snapshot,{code:snapshot.held?'ASSESSMENT_FAILED':'ASSESSMENT_PENDING',operation:'assessment',pending:snapshot.pending}));
      return{status:'ready'};
    }
    return{status:'retry_wait',runAfter:now()+intervalMs};
  }});
  delivery?.setEventValidator(async e=>{
    if(e.kind!=='attention')return true;
    const source=sourceFor(e.engine);if(!source)return false;
    // Recheck before the first send; never change an already-started request.
    try{const snapshot=await source.get(e.username,e.attemptId);return !!snapshot?.submitted&&!snapshot.ready;}
    catch(error){if(e.code==='REPORT_UNAVAILABLE')return true;throw error;}
  });
  async function check(){
    if(!enabled||!started||checking)return;checking=true;
    try{
      for(const [engine,source] of Object.entries(sources)){
        if(!source.scan)continue;
        try{
          const batch=await source.scan({since,cursor:cursors[engine]||'',limit:100});
          // Advance only once the batch has been durably registered.
          for(const row of batch.rows)await observe(engine,row.username,row.snapshot);
          cursors[engine]=batch.nextCursor||'';
        }catch{warning();}
      }
      await worker.wake();
    }finally{checking=false;}
  }
  async function diagnostics(engine,username,id){
    const source=sourceFor(engine);if(!source||!ID.test(id||''))return null;
    const snapshot=await source.get(username,id);if(!snapshot)return null;
    const rows=await delivery.eventJobs.list(username,engine+':'+id);
    return{engine,...snapshot,notifications:rows.map(row=>({kind:row.data.event.kind,status:row.status,outcome:row.data.outcome||null,sentAt:row.data.sentAt||null,code:row.data.stages?.email?.detail?.code||row.data.stages?.email?.failure||null}))};
  }
  return{watches,observe,observeId,error,check,diagnostics,health:()=>({...delivery.health(),scope:'all-mocks',engines:Object.keys(sources),events:['submitted','error','attention'],watchdogMinutes:10,activeSince:since||null}),
    async start(){if(!enabled||started)return;await watches.initialise();
      const config=await watches.enqueue({id:'mock-alert-activation-v1',owner:'system',groupId:'configuration',inputHash:'mock-alert-activation-v1',data:{control:true,since:now(),stages:{}}});
      since=config.data.since;started=true;await worker.start();await check();timer=setInterval(()=>check().catch(warning),intervalMs);timer.unref?.();
      const transport=delivery.health();logger.info?.('[mock-alerts]',JSON.stringify({event:'monitor_ready',engines:Object.keys(sources),events:['submitted','error','attention'],activeSince:since,watchdogMinutes:10,recipient:transport.recipient,transportConfigured:transport.transportConfigured,provider:transport.provider}));
    },async stop(){started=false;clearInterval(timer);await worker.stop();},wait:()=>worker.wait()};
}
module.exports={createMockTestAlerts,TEN_MINUTES};
