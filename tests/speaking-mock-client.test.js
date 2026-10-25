'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createController}=require('../public/speaking-mock-client'),{installSpeakingMock}=require('../speaking-mock');
async function harness(t,{prepare=true,failUpload=false}={}){
  let at=1000000,uid='alice',recorderStarts=0,permissionCalls=0,full=false;const nodes=new Map(),intervals=new Map(),requests=[],audios=[];let seq=0;
  class Element{constructor(id){this.id=id;this.hidden=false;this.disabled=false;this.textContent='';this.style={};nodes.set(id,this);}set innerHTML(text){this.html=text;if(this.id==='speakingMockPane'){for(const id of [...nodes.keys()])if(id!==this.id)nodes.delete(id);for(const m of text.matchAll(/id="([^"]+)"/g))new Element(m[1]);}}get innerHTML(){return this.html||'';}replaceChildren(){this.innerHTML='';}}
  const host=new Element('speakingMockPane');
  class Recorder{static isTypeSupported(type){return type==='audio/webm;codecs=opus';}constructor(){this.state='inactive';this.mimeType='audio/webm';}start(){this.state='recording';recorderStarts++;}stop(){if(this.state!=='recording')return;this.state='inactive';this.ondataavailable?.({data:new Blob([Buffer.alloc(200,2)],{type:this.mimeType})});this.onstop?.();}}
  class Audio{constructor(url){this.url=url;this.currentTime=0;this.volume=1;audios.push(this);}async play(){this.played=true;}pause(){this.paused=true;}}
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-mock-ui-')),app=require('express')();app.use(require('express').json());
  const lab=installSpeakingMock(app,{directory,now:()=>at,verifyToken:token=>token==='alice'?'alice':null,getAccount:async()=>({}),gptAvailable:true,azureAvailable:true,
    gradeResponse:async()=>({transcript:'A clear response.',content:{total:6,maximum:6,scoringMode:'ai'},gpt:{status:'assessed',pronunciation:{score:5},fluency:{score:5}},azure:{status:'assessed',pronunciation:{score:4},fluency:{score:5}}}),
    assessOverall:async()=>({status:'assessed',overallScore:90,summary:'Clear across the mock.',pronunciation:{score:5},fluency:{score:5}})});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const env={document:{getElementById:id=>nodes.get(id)||null,hidden:false},Date:{now:()=>at},MediaRecorder:Recorder,Audio,Blob,crypto:require('node:crypto').webcrypto,
    localStorage:{getItem:key=>key==='pte_session_token'?'alice':null},sessionStorage:{getItem:()=>null},
    navigator:{mediaDevices:{getUserMedia:async()=>{permissionCalls++;return {getTracks:()=>[{stop(){}}]};}}},
    URL:{createObjectURL:()=> 'blob:mock-'+(++seq),revokeObjectURL(){}},confirm:()=>true,
    setInterval:fn=>{const id=++seq;intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id),
    PortalExamMode:{prepare:async()=>{full=prepare;return prepare;},set:(owner,active)=>{full=active;},isLocked:()=>false},
    fetch:async(url,options={})=>{requests.push({url,...options});if(failUpload&&url.includes('/recordings/')&&options.method==='POST'){failUpload=false;return {ok:false,json:async()=>({error:'Upload interrupted'})};}return fetch(base+url,options);}
  };
  const controller=createController(env,{getUserId:()=>uid});
  t.after(async()=>{controller.reset();await lab.waitForJobs();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
  const flush=async()=>{for(let n=0;n<25;n++)await new Promise(resolve=>setImmediate(resolve));};
  return {env,host,nodes,requests,audios,controller,lab,flush,
    click:data=>host.onclick({target:{closest:()=>({dataset:data,disabled:false})}}),
    tick:async ms=>{at+=ms;for(const fn of [...intervals.values()])await fn();await flush();},
    active:async()=>{const [row]=await lab.store.list('alice');return row&&lab.store.update('alice',row.id,a=>a);},
    starts:()=>recorderStarts,permissions:()=>permissionCalls,protected:()=>full,user:value=>uid=value};
}

test('Cancelling protected-screen preflight creates no attempt and does not open the microphone',async t=>{
  const h=await harness(t,{prepare:false});await h.controller.open();await h.click({sm:'start',paper:'speaking-mock-1'});
  assert.equal(h.permissions(),0);assert.equal(h.requests.filter(r=>r.method==='POST').length,0);assert.equal(await h.active(),undefined);
});

test('One complete mock runs timed recording, reuses saved audio, hides feedback until submission and shows both providers',async t=>{
  const h=await harness(t);await h.controller.open();await h.click({sm:'start',paper:'speaking-mock-1'});
  assert.equal(h.protected(),true);assert.match(h.host.innerHTML,/Recorded Answer/);assert.doesNotMatch(h.host.innerHTML,/Individual question feedback|Score|Transcript|Sample response|Pause|Replay/);
  for(let index=0;index<28;index++){
    const a=await h.active(),q=a.questions[index];const recordingAt=a.questionStartedAt+3000+(q.audioSeconds||0)*1000+q.preparation*1000;
    if(q.audioSource){await h.tick(Math.max(0,a.questionStartedAt+3001-h.env.Date.now()));const count=h.audios.length;await h.tick(100);assert.equal(h.audios.length,count,'A prompt plays once.');}
    await h.tick(Math.max(0,recordingAt+100-h.env.Date.now()));assert.equal(h.starts(),index+1);
    await h.click({sm:'next'});
  }
  await h.lab.waitForJobs();await h.tick(3000);
  assert.equal(h.permissions(),1);assert.equal(h.protected(),false);assert.match(h.nodes.get('sm-results-summary').innerHTML,/90/);
  assert.match(h.host.innerHTML,/GPT pronunciation/);assert.match(h.host.innerHTML,/Azure pronunciation/);
  assert.match(h.nodes.get('sm-result-rows').innerHTML,/5\/5/);assert.match(h.nodes.get('sm-result-rows').innerHTML,/4\/5/);
  assert(h.requests.filter(r=>r.method==='POST'&&r.url.includes('/recordings/')).every(r=>r.headers['x-session-token']==='alice'));
  assert(h.audios.every(a=>a.url.startsWith('/speaking-mock-audio/')));
  assert.match(h.host.innerHTML,/Reattempt this mock/);
  const original=await h.active(),before=JSON.stringify(original);
  await h.controller.open({history:true});assert.match(h.host.innerHTML,/data-sm="reattempt"/);
  const prepare=h.env.PortalExamMode.prepare,posts=h.requests.filter(r=>r.method==='POST').length;
  h.env.PortalExamMode.prepare=async()=>false;await h.click({sm:'reattempt',id:original.id});
  assert.equal(h.requests.filter(r=>r.method==='POST').length,posts);assert.equal(h.permissions(),1);
  h.env.PortalExamMode.prepare=prepare;await h.click({sm:'reattempt',id:original.id});
  const creation=h.requests.findLast(r=>r.method==='POST'&&r.url.endsWith('/reattempt')),freshId=JSON.parse(creation.body).id;
  assert(creation.url.includes(original.id));assert.notEqual(freshId,original.id);
  const fresh=await h.lab.store.update('alice',freshId,a=>a);assert.equal(fresh.index,0);assert.deepEqual(fresh.responses,[]);assert.deepEqual(fresh.questions,original.questions);
  await h.tick(28100);assert.equal(h.starts(),29,'A reattempt can record the same introduction again.');await h.click({sm:'next'});
  assert.equal((await h.lab.store.update('alice',freshId,a=>a)).index,1);
  assert.equal(JSON.stringify(await h.lab.store.update('alice',original.id,a=>a)),before);

});

test('An interrupted upload reuses the captured recording rather than recording the response again',async t=>{
  const h=await harness(t,{failUpload:true});await h.controller.open();await h.click({sm:'start',paper:'speaking-mock-1'});
  await h.tick(28100);assert.equal(h.starts(),1);await h.click({sm:'next'});
  assert.equal((await h.active()).index,1);assert.equal(h.starts(),1);assert.equal(h.requests.filter(r=>r.method==='POST'&&r.url.includes('/recordings/')).length,2);
});

test('Saved history opens a completed mock without microphone access or a new submission',async t=>{
  const h=await harness(t);await h.controller.open({history:true});assert.match(h.host.innerHTML,/Your saved attempts/);assert.equal(h.permissions(),0);assert.equal(h.requests.filter(r=>r.method==='POST').length,0);
});

test('A fresh session token takes priority over stale local authentication',async t=>{
  const h=await harness(t);h.env.localStorage.getItem=()=> 'stale-token';h.env.sessionStorage.getItem=key=>key==='pte_session_token'?'alice':null;
  await h.controller.open({history:true});assert.match(h.host.innerHTML,/Your saved attempts/);assert(h.requests.every(r=>r.headers['x-session-token']==='alice'));
});

test('The final in-flight recording is saved before a whole-test deadline submits the mock',async t=>{
  const h=await harness(t);await h.controller.open();await h.click({sm:'start',paper:'speaking-mock-1'});
  await h.tick(28100);assert.equal(h.starts(),1);
  const attempt=await h.active();await h.lab.store.update('alice',attempt.id,a=>{a.deadline=h.env.Date.now()+1000;return a;});
  // Refresh the active view so its server-owned deadline is current.
  await h.controller.open();await h.click({sm:'resume',id:attempt.id});
  await h.tick(1100);await h.lab.waitForJobs();
  const saved=await h.active();assert.equal(saved.status,'submitted');assert(saved.responses[0].recording);
  const upload=h.requests.findIndex(r=>r.method==='POST'&&r.url.endsWith('/recordings/0'));
  const finalRead=h.requests.findLastIndex(r=>r.method==='GET'&&r.url.endsWith('/attempts/'+attempt.id));
  assert(upload>=0&&upload<finalRead,'The final upload precedes submission reconciliation.');
});

async function savedReview(h){
  const id=require('node:crypto').randomUUID(),paper=require('../content/speaking-mocks').papers[0];
  await h.lab.store.update('alice',id,()=>({id,title:paper.title,paperId:paper.id,status:'submitted',index:28,
    questions:structuredClone(paper.questions),responses:[],questionCount:27,startedAt:1,deadline:2,
    grading:{status:'processing'},lease:{owner:'other-worker',expiresAt:h.env.Date.now()+1000000},integrity:{events:[]}}));
  await h.controller.open({history:true});await h.click({sm:'resume',id});return id;
}

test('An aborted result fetch keeps saved results visible and automatically recovers polling',async t=>{
  const h=await harness(t),id=await savedReview(h),request=h.env.fetch;let failed=false;
  h.env.fetch=async(url,args)=>{if(!failed&&url.endsWith('/attempts/'+id)){failed=true;throw new DOMException('Fetch is aborted','AbortError');}return request(url,args);};
  await h.tick(3000);assert.match(h.nodes.get('sm-notice').textContent,/retrying results automatically/);
  assert.doesNotMatch(h.nodes.get('sm-notice').textContent,/Fetch is aborted/);assert.match(h.host.innerHTML,/Individual question feedback/);
  await h.lab.store.update('alice',id,a=>{a.grading.status='complete';a.overall={overallScore:82,summary:'Saved complete assessment.'};return a;});
  await h.tick(3000);assert.match(h.nodes.get('sm-results-summary').innerHTML,/82/);assert.equal(h.nodes.get('sm-notice').textContent,'');
  const reads=h.requests.length;await h.tick(30000);assert.equal(h.requests.length,reads,'Completed results stop polling.');
});

test('Transient server errors back off, while an expired sign-in stops result polling',async t=>{
  const h=await harness(t),id=await savedReview(h),request=h.env.fetch;let calls=0;
  h.env.fetch=async(url,args)=>{if(url.endsWith('/attempts/'+id)){calls++;return {ok:false,status:calls<3?503:401,json:async()=>({error:calls<3?'Temporarily unavailable':'Please sign in again.'})};}return request(url,args);};
  await h.tick(3000);assert.equal(calls,1);await h.tick(3000);assert.equal(calls,2);
  await h.tick(3000);assert.equal(calls,2,'Repeated failures wait longer.');await h.tick(3000);assert.equal(calls,3);
  assert.equal(h.nodes.get('sm-notice').textContent,'Please sign in again.');await h.tick(30000);assert.equal(calls,3);
});

test('Repeated retry clicks send one action and a disconnected retry resumes read-only polling',async t=>{
  const h=await harness(t);await savedReview(h);const request=h.env.fetch;let rejectRetry,calls=0;
  h.env.fetch=async(url,args)=>{if(url.endsWith('/retry')){calls++;return new Promise((resolve,reject)=>{rejectRetry=reject;});}return request(url,args);};
  const first=h.click({sm:'retry'});await h.click({sm:'retry'});assert.equal(calls,1);
  rejectRetry(new DOMException('Fetch is aborted','AbortError'));await first;
  assert.match(h.nodes.get('sm-notice').textContent,/checking the results automatically/);
  const reads=h.requests.length;await h.tick(3000);assert.equal(h.requests.length,reads+1);assert.equal(calls,1,'Polling never resubmits a paid assessment action.');
});

test('A late polling failure cannot alter the history screen after leaving results',async t=>{
  const h=await harness(t),id=await savedReview(h),request=h.env.fetch;let rejectRead;
  h.env.fetch=async(url,args)=>url.endsWith('/attempts/'+id)?new Promise((resolve,reject)=>{rejectRead=reject;}):request(url,args);
  const polling=h.tick(3000);await h.controller.open({history:true});rejectRead(Error('Fetch is aborted'));await polling;
  assert.match(h.host.innerHTML,/Your saved attempts/);assert.equal(h.nodes.get('sm-notice').textContent,'');
});
