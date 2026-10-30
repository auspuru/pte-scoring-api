'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createController}=require('../public/speaking-mock-client'),{installSpeakingMock}=require('../speaking-mock');
async function harness(t,{prepare=true,failUpload=false,backgroundEnabled=false,gradeGate=Promise.resolve(),audioCue=false,autoCheck=true}={}){
  let at=1000000,uid='alice',recorderStarts=0,permissionCalls=0,full=false;const nodes=new Map(),intervals=new Map(),requests=[],audios=[];let seq=0;
  class Element{constructor(id){this.id=id;this.hidden=false;this.disabled=false;this.textContent='';this.style={};nodes.set(id,this);}set innerHTML(text){this.html=text;if(this.id==='speakingMockPane'){for(const id of [...nodes.keys()])if(id!==this.id)nodes.delete(id);}for(const m of text.matchAll(/id="([^"]+)"/g))new Element(m[1]);}get innerHTML(){return this.html||'';}replaceChildren(){this.innerHTML='';}}
  const host=new Element('speakingMockPane');
  class Recorder{static isTypeSupported(type){return type==='audio/webm;codecs=opus';}constructor(){this.state='inactive';this.mimeType='audio/webm';}start(){this.state='recording';if(!nodes.has('sm-check-record'))recorderStarts++;}stop(){if(this.state!=='recording')return;this.state='inactive';this.ondataavailable?.({data:new Blob([Buffer.alloc(200,2)],{type:this.mimeType})});this.onstop?.();}}
  class Audio{constructor(url){this.url=url;this.currentTime=0;this.volume=1;audios.push(this);const id=url.split('/').at(-1).split('.mp3')[0];this.duration=url.startsWith('blob:')?3:require('../content/speaking-mocks').papers.flatMap(p=>p.questions).find(q=>q.id===id)?.audioSeconds;}async play(){this.played=true;this.paused=false;this.playedAt=at;this.offset=this.currentTime;}pause(){this.paused=true;}}
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-mock-ui-')),app=require('express')();app.use(require('express').json());
  const lab=installSpeakingMock(app,{directory,backgroundEnabled,now:()=>at,verifyToken:token=>token==='alice'?'alice':null,getAccount:async()=>({}),gptAvailable:true,azureAvailable:true,
    gradeResponse:async q=>{await gradeGate;return({transcript:'A clear response.',content:{total:require('../speaking-mock-report').contentMaximum(q),maximum:require('../speaking-mock-report').contentMaximum(q),scoringMode:'ai'},gpt:{status:'assessed',pronunciation:{score:5},fluency:{score:5}},azure:{status:'assessed',pronunciation:{score:4},fluency:{score:5}}});},
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
  const cueAudio=audioCue?require('./fixtures/speaking-audio-context')(env):null;
  const controller=createController(env,{getUserId:()=>uid});
  t.after(async()=>{controller.reset();await lab.waitForJobs();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
  const flush=async()=>{for(let n=0;n<25;n++)await new Promise(resolve=>setImmediate(resolve));};
  const tick=async ms=>{at+=ms;for(const audio of audios)if(audio.played&&!audio.paused&&!audio.ended&&audio.duration&&at>=audio.playedAt+(audio.duration-audio.offset)*1000){audio.ended=true;audio.onended?.();}cueAudio?.run();for(const fn of [...intervals.values()])await fn();await flush();const ends=Date.now()+3000;while(nodes.get('sm-record-status')?.textContent==='Preparing your response…'&&Date.now()<ends)await new Promise(resolve=>setTimeout(resolve,1));};
  const rawClick=data=>host.onclick({target:{closest:()=>({dataset:data,disabled:false})}});
  const finishCheck=async()=>{await rawClick({sm:'check-record'});await tick(3001);await rawClick({sm:'check-play'});await tick(3001);host.onchange({target:{id:'sm-check-heard',checked:true}});await rawClick({sm:'check-begin'});};
  return {env,host,nodes,requests,audios,controller,lab,flush,cueAudio,finishCheck,rawClick,
    click:async data=>{await rawClick(data);if(autoCheck&&['start','reattempt'].includes(data.sm)&&nodes.has('sm-check-record'))await finishCheck();},tick,
    active:async()=>{const [row]=await lab.store.list('alice');return row&&lab.store.update('alice',row.id,a=>a);},
    starts:()=>recorderStarts,permissions:()=>permissionCalls,protected:()=>full,user:value=>uid=value};
}

test('Headset check records and plays locally before creating a timed mock, with explicit sound confirmation',async t=>{
 const h=await harness(t,{autoCheck:false});await h.controller.open();await h.click({sm:'start',paper:'speaking-mock-1'});
 assert.match(h.host.innerHTML,/Check your microphone and headphones/);assert.equal(h.permissions(),0);assert.equal(await h.active(),undefined);
 await h.rawClick({sm:'check-begin'});assert.equal(await h.active(),undefined);
 await h.rawClick({sm:'check-record'});await h.tick(3001);
 assert.equal(h.permissions(),1);assert.equal(h.starts(),0);assert.equal(h.requests.filter(r=>r.method==='POST').length,0);
 h.host.onchange({target:{id:'sm-check-heard',checked:true}});await h.rawClick({sm:'check-begin'});assert.equal(await h.active(),undefined);
 await h.rawClick({sm:'check-play'});assert(h.audios.at(-1).url.startsWith('blob:'));await h.tick(3001);
 await h.rawClick({sm:'check-begin'});assert.equal(await h.active(),undefined,'Listening alone does not confirm the headset.');
 h.host.onchange({target:{id:'sm-check-heard',checked:true}});await h.rawClick({sm:'check-begin'});
 assert.equal((await h.active()).index,0);assert.equal(h.permissions(),1);assert.equal(h.protected(),true);assert.equal(h.starts(),0);
 assert.equal(h.requests.filter(r=>r.method==='POST'&&r.url.includes('/recordings/')).length,0,'Headset samples are never uploaded.');
});
test('Leaving the headset check stops the sample and microphone without creating an attempt',async t=>{
 const h=await harness(t,{autoCheck:false});await h.controller.open();await h.click({sm:'start',paper:'speaking-mock-1'});await h.rawClick({sm:'check-record'});
 h.controller.leave();await h.tick(5000);assert.equal(await h.active(),undefined);assert.equal(h.requests.filter(r=>r.method==='POST').length,0);assert.equal(h.starts(),0);
});
test('Denied microphone access and blocked sample playback keep the mock unstarted and allow another check',async t=>{
 const h=await harness(t,{autoCheck:false});await h.controller.open();await h.click({sm:'start',paper:'speaking-mock-1'});const microphone=h.env.navigator.mediaDevices.getUserMedia;
 h.env.navigator.mediaDevices.getUserMedia=async()=>{throw Error('Microphone permission denied');};await h.rawClick({sm:'check-record'});
 assert.match(h.nodes.get('sm-notice').textContent,/Microphone permission denied/);assert.equal(await h.active(),undefined);
 h.env.navigator.mediaDevices.getUserMedia=microphone;await h.rawClick({sm:'check-record'});await h.tick(3001);
 const Audio=h.env.Audio;h.env.Audio=class extends Audio{async play(){throw Error('Playback blocked');}};await h.rawClick({sm:'check-play'});
 assert.match(h.nodes.get('sm-notice').textContent,/Playback was blocked/);h.host.onchange({target:{id:'sm-check-heard',checked:true}});await h.rawClick({sm:'check-begin'});assert.equal(await h.active(),undefined);
 h.env.Audio=Audio;await h.rawClick({sm:'check-play'});await h.tick(3001);h.host.onchange({target:{id:'sm-check-heard',checked:true}});
 await h.rawClick({sm:'check-record'});await h.tick(3001);await h.rawClick({sm:'check-begin'});assert.equal(await h.active(),undefined,'A new sample must be listened to and confirmed again.');
});
test('A delayed begin response and a fast device clock do not consume the visible audio countdown',async t=>{
 const h=await harness(t),clock=h.env.Date.now;h.env.Date.now=()=>clock()+300000;
 await h.controller.open();await h.click({sm:'start',paper:'speaking-mock-1'});const saved=await h.active(),index=saved.questions.findIndex(q=>q.type==='rl');
 await h.lab.store.update('alice',saved.id,a=>{a.index=index;delete a.questionStartedAt;return a;});await h.controller.open();const request=h.env.fetch;
 h.env.fetch=async(url,options)=>{const response=await request(url,options);if(url.endsWith('/begin'))await h.tick(5000);return response;};
 await h.click({sm:'resume',id:saved.id});const prompts=()=>h.audios.filter(a=>a.url.startsWith('/speaking-mock-audio/'));
 assert.equal(prompts().length,0);await h.tick(2999);assert.equal(prompts().length,0);await h.tick(1);assert.equal(prompts().length,1);assert.equal(prompts()[0].offset,0);
});
for(const type of ['rl','sgd','rts'])test(type+': a full visible lead-in and preparation follow real prompt completion, even when playback is delayed',async t=>{
 const h=await harness(t);await h.controller.open();await h.click({sm:'start',paper:'speaking-mock-1'});
 const first=await h.active(),index=first.questions.findIndex(q=>q.type===type);await h.lab.store.update('alice',first.id,a=>{a.index=index;delete a.questionStartedAt;return a;});
 await h.controller.open();await h.click({sm:'resume',id:first.id});
 const prompts=()=>h.audios.filter(a=>a.url.startsWith('/speaking-mock-audio/'));
 assert.equal(prompts().length,0);await h.tick(2999);assert.equal(prompts().length,0);await h.tick(1);
 const audio=prompts().at(-1);assert.equal(audio.offset,0);audio.playedAt+=5000;
 await h.tick(audio.duration*1000);assert.equal(h.starts(),0);assert.equal(h.nodes.get('sm-record-status').textContent,'Listening');
 await h.tick(5001);assert.match(h.nodes.get('sm-record-status').textContent,/Preparation time: 0:10/);assert.equal(h.starts(),0);
 await h.tick(9999);assert.equal(h.starts(),0);await h.tick(1);assert.equal(h.starts(),1);
 await h.tick(first.questions[index].seconds*1000-1);assert.equal((await h.active()).responses[index],undefined);
 await h.tick(1);await h.flush();const saved=await h.active();assert(saved.responses[index].recording);assert.equal(prompts().length,1);
});
test('the active mock shows a verified clear image with enlargement while preserving the saved question',async t=>{
 const h=await harness(t);await h.controller.open();await h.click({sm:'start',paper:'speaking-mock-1'});
 const saved=await h.active(),index=saved.questions.findIndex(q=>q.type==='di');await h.lab.store.update('alice',saved.id,a=>{a.index=index;delete a.questionStartedAt;return a;});
 await h.controller.open();await h.click({sm:'resume',id:saved.id});const q=(await h.active()).questions[index],entry=require('../di-image-display').manifest.entries[q.id];
 assert(h.host.innerHTML.includes('src="'+entry.displayImageUrl+'"'));assert(h.host.innerHTML.includes('data-original-image="'+q.imageUrl+'"'));assert.match(h.host.innerHTML,/Enlarge image/);assert.match(h.host.innerHTML,/sm-image-dialog/);
 assert.equal(q.displayImageUrl,undefined);assert.equal(q.imageUrl,entry.originalImageUrl);
});
test('background results show only a preparing banner, poll automatically and open the complete report',async t=>{
  let release;const gradeGate=new Promise(resolve=>release=resolve),h=await harness(t,{backgroundEnabled:true,gradeGate}),paper=require('../content/speaking-mocks').papers[0],id=require('node:crypto').randomUUID();
  const questions=structuredClone(paper.questions),index=questions.length-1,responses=questions.map(()=>({skipped:true}));responses[index]={recording:{mime:'audio/webm',data:Buffer.alloc(200,7).toString('base64'),hash:'saved'},transcript:'Saved response.'};
  await h.lab.store.update('alice',id,()=>({id,paperId:paper.id,title:paper.title,status:'submitted',questions,responses,questionCount:27,index:questions.length,startedAt:1,deadline:2,grading:{status:'pending'},assessmentProfile:{mode:'progressive-v1',owner:'alice',diBackend:'academy'},integrity:{events:[]}}));
  await h.controller.open({history:true});await h.click({sm:'resume',id});assert.match(h.host.innerHTML,/Preparing your results/);assert.match(h.host.innerHTML,/5–10 minutes/);assert.doesNotMatch(h.host.innerHTML,/Retry unavailable|Individual question feedback|Sample answer|Your transcript/);
  await h.tick(3000);assert(h.requests.some(r=>r.url.endsWith('/status')));release();await h.lab.waitForJobs();await h.tick(3000);assert.match(h.host.innerHTML,/Speaking score report/);assert.doesNotMatch(h.host.innerHTML,/Retry unavailable/);assert(h.nodes.get('sm-results-summary').innerHTML.includes('/90'));
});

test('Cancelling protected-screen preflight creates no attempt and does not open the microphone',async t=>{
  const h=await harness(t,{prepare:false});await h.controller.open();await h.click({sm:'start',paper:'speaking-mock-1'});
  assert.equal(h.permissions(),1);assert.equal(h.requests.filter(r=>r.method==='POST').length,0);assert.equal(await h.active(),undefined);
});
test('Next opens the following question without a confirmation when the current question is unanswered',async t=>{
 const h=await harness(t);h.env.confirm=()=>{throw Error('Next must not open a confirmation.');};
 await h.controller.open();await h.click({sm:'start',paper:'speaking-mock-1'});await h.click({sm:'next'});
 const saved=await h.active();assert.equal(saved.index,1);assert.equal(saved.responses[0].skipped,true);assert.match(h.host.innerHTML,/Item 2 of 28/);
 assert.equal(h.requests.filter(r=>r.method==='POST'&&r.url.endsWith('/next')).length,1);
});
test('Next saves an in-flight recording before advancing and repeated clicks cannot skip another question',async t=>{
 const h=await harness(t);h.env.confirm=()=>{throw Error('Next must not open a confirmation.');};
 await h.controller.open();await h.click({sm:'start',paper:'speaking-mock-1'});await h.tick(28100);
 const request=h.env.fetch;let release;
 h.env.fetch=(url,options)=>url.endsWith('/recordings/0')&&options?.method==='POST'?new Promise(resolve=>{release=()=>resolve(request(url,options));}):request(url,options);
 const first=h.click({sm:'next'});await h.flush();assert.equal(typeof release,'function');assert.equal((await h.active()).index,0);assert.equal(h.nodes.get('sm-next').disabled,true);
 await h.click({sm:'next'});release();await first;
 const saved=await h.active();assert.equal(saved.index,1);assert(saved.responses[0].recording);assert(!saved.responses[0].skipped);
 assert.equal(h.requests.filter(r=>r.method==='POST'&&r.url.endsWith('/recordings/0')).length,1);assert.equal(h.requests.filter(r=>r.method==='POST'&&r.url.endsWith('/next')).length,1);
});
test('mock Repeat Sentence waits for audio and one beep, keeping 15 seconds after a late prompt finish',async t=>{
 const h=await harness(t,{audioCue:true});await h.controller.open();await h.click({sm:'start',paper:'speaking-mock-1'});
 const first=await h.active(),index=first.questions.findIndex(q=>q.type==='rs');
 await h.lab.store.update('alice',first.id,a=>{a.index=index;delete a.questionStartedAt;return a;});
 await h.controller.open();await h.click({sm:'resume',id:first.id});let a=await h.active();
 await h.tick(a.questionStartedAt+3001-h.env.Date.now());assert.equal(h.cueAudio.tones.length,0);
 const audio=h.audios.at(-1);audio.playedAt+=1000; // Simulate a slow playback start.
 await h.tick(a.questions[index].audioSeconds*1000);assert.equal(h.starts(),0);assert.equal(h.cueAudio.tones.length,0);
 await h.tick(1000);assert.equal(h.cueAudio.tones.length,1);assert.equal(h.starts(),0);
 await h.tick(100);await h.tick(100);assert.equal(h.cueAudio.tones.length,1);assert.equal(h.starts(),0);
 await h.tick(100);assert.equal(h.starts(),1);const started=h.env.Date.now();
 await h.tick(14999);assert.equal((await h.active()).responses[index],undefined);
 await h.tick(1);await h.flush();a=await h.active();assert(a.responses[index].recording);assert.equal(h.env.Date.now()-started,15000);assert.equal(h.cueAudio.tones.length,1);
});
test('moving to the next mock question cancels a pending beep without saving a phantom response',async t=>{
 const h=await harness(t,{audioCue:true});await h.controller.open();await h.click({sm:'start',paper:'speaking-mock-1'});
 const first=await h.active(),index=first.questions.findIndex(q=>q.type==='rs');await h.lab.store.update('alice',first.id,a=>{a.index=index;delete a.questionStartedAt;return a;});
 await h.controller.open();await h.click({sm:'resume',id:first.id});const a=await h.active();await h.tick(a.questionStartedAt+3001-h.env.Date.now());await h.tick(a.questions[index].audioSeconds*1000);
 assert.equal(h.cueAudio.tones.length,1);await h.click({sm:'next'});await h.tick(300);assert.equal(h.starts(),0);assert.equal((await h.active()).responses[index].skipped,true);
});

test('One complete mock runs timed recording, reuses saved audio, hides feedback until submission and shows saved delivery feedback',async t=>{
  const h=await harness(t);await h.controller.open();await h.click({sm:'start',paper:'speaking-mock-1'});
  assert.equal(h.protected(),true);assert.match(h.host.innerHTML,/Recorded Answer/);assert.doesNotMatch(h.host.innerHTML,/Individual question feedback|Score|Transcript|Sample response|Pause|Replay/);
  for(let index=0;index<28;index++){
    const a=await h.active(),q=a.questions[index];const recordingAt=a.questionStartedAt+3000+(q.audioSeconds||0)*1000+q.preparation*1000+(q.startCueMs||0);
    if(q.audioSource){await h.tick(Math.max(0,a.questionStartedAt+3001-h.env.Date.now()));const count=h.audios.length;await h.tick(100);assert.equal(h.audios.length,count,'A prompt plays once.');}
    if(q.audioSource){await h.tick(q.audioSeconds*1000+100);await h.tick(q.preparation*1000+(q.startCueMs||0)+100);}else await h.tick(Math.max(0,recordingAt+100-h.env.Date.now()));assert.equal(h.starts(),index+1);
    await h.click({sm:'next'});
  }
  await h.lab.waitForJobs();await h.tick(3000);
  assert.equal(h.permissions(),1);assert.equal(h.protected(),false);assert.match(h.nodes.get('sm-results-summary').innerHTML,/90/);
  assert.doesNotMatch(h.host.innerHTML,/GPT pronunciation|OpenAI-based overall/);assert.match(h.host.innerHTML,/Pronunciation \/ fluency/);
  assert.match(h.nodes.get('sm-result-rows').innerHTML,/5\/5/);assert.match(h.nodes.get('sm-result-rows').innerHTML,/4\/5/);
  assert(h.requests.filter(r=>r.method==='POST'&&r.url.includes('/recordings/')).every(r=>r.headers['x-session-token']==='alice'));
  assert(h.audios.every(a=>a.url.startsWith('/speaking-mock-audio/')||a.url.startsWith('blob:')));
  assert.match(h.host.innerHTML,/Reattempt this mock/);
  const original=await h.active(),before=JSON.stringify(original);
  await h.controller.open({history:true});assert.match(h.host.innerHTML,/data-sm="reattempt"/);
  const prepare=h.env.PortalExamMode.prepare,posts=h.requests.filter(r=>r.method==='POST').length;
  h.env.PortalExamMode.prepare=async()=>false;await h.click({sm:'reattempt',id:original.id});
  assert.equal(h.requests.filter(r=>r.method==='POST').length,posts);assert.equal(h.permissions(),2);
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
  await h.tick(3000);assert.match(h.nodes.get('sm-results-summary').innerHTML,/Pending/);assert.doesNotMatch(h.nodes.get('sm-results-summary').innerHTML,/>82</);assert.equal(h.nodes.get('sm-notice').textContent,'');
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

test('Instructor overrides are labeled beside the RS scores in the results table',async t=>{
 const h=await harness(t),id=require('node:crypto').randomUUID(),q=require('../content/speaking-mocks').papers[0].questions.find(q=>q.type==='rs');
 const trait={score:5,maximum:5,source:'instructor_override',recordingHash:'saved-rs',reason:'Assigned manually by the instructor.'};
 await h.lab.store.update('alice',id,()=>({id,title:'Saved mock',status:'submitted',startedAt:1,deadline:2,index:1,questionCount:1,questions:[q],responses:[{recording:{hash:'saved-rs'},content:{total:3,maximum:3,scoringMode:'exact'},manualDeliveryOverrides:{gpt:{pronunciation:trait,fluency:trait},azure:{pronunciation:trait,fluency:trait}}}],grading:{status:'complete'},overall:{overallScore:75,pronunciation:{score:4},fluency:{score:4}}}));
 await h.controller.open({history:true});await h.click({sm:'resume',id});
 assert.equal((h.nodes.get('sm-result-rows').innerHTML.match(/5\/5 \(manual override\)/g)||[]).length,2);
 assert.match(h.nodes.get('sm-results-summary').innerHTML,/>90</);assert.match(h.nodes.get('sm-results-summary').innerHTML,/alt="IPT Brisbane"/);assert.doesNotMatch(h.nodes.get('sm-results-summary').innerHTML,/>75</);
});

test('The score report keeps provider diagnostics private and does not substitute a legacy whole score',async t=>{
 const h=await harness(t),id=require('node:crypto').randomUUID(),q=require('../content/speaking-mocks').papers[0].questions.find(q=>q.type==='rs');
 await h.lab.store.update('alice',id,()=>({id,title:'Saved mock',status:'submitted',startedAt:1,deadline:2,index:1,questionCount:1,questions:[q],responses:[{}],grading:{status:'complete'},overall:{overallScore:85,pronunciation:{score:5},fluency:{score:5}},overallAzure:{status:'assessed',summary:'Fresh audio assessment.',pronunciation:{raw:96,score:5},fluency:{raw:92,score:4}}}));
 await h.controller.open({history:true});await h.click({sm:'resume',id});
 const summary=h.nodes.get('sm-results-summary').innerHTML;
 assert.match(summary,/Overall score/);assert.doesNotMatch(summary,/96\/100|92\/100|Saved Azure whole-mock|task-weighted/);assert.doesNotMatch(summary,/>85</);
});

async function sampleReport(h,{paperIndex=0,processing=false}={}){
 const id=require('node:crypto').randomUUID(),paper=require('../content/speaking-mocks').papers[paperIndex],questions=structuredClone(paper.questions);
 const responses=questions.map((q,i)=>({recording:{mime:'audio/webm',hash:'saved-'+i,data:Buffer.alloc(200,2).toString('base64')},transcript:q.type==='di'?'My description of '+q.title:'A saved response.',content:{scoringMode:'ai',total:require('../speaking-mock-report').contentMaximum(q),maximum:require('../speaking-mock-report').contentMaximum(q),overview:'Saved content feedback.',strengths:['The main idea is clear.'],improvements:['Include one useful comparison.']},gpt:{status:'assessed',pronunciation:{score:5},fluency:{score:5}},azure:{status:'assessed',pronunciation:{score:4},fluency:{score:5}}}));
 await h.lab.store.update('alice',id,()=>({id,title:paper.title,paperId:paper.id,status:'submitted',index:28,questions,responses,questionCount:27,completedCount:27,startedAt:1,deadline:2,grading:{status:processing?'processing':'complete'},...(processing?{lease:{owner:'other-worker',expiresAt:h.env.Date.now()+1000000}}:{}),integrity:{events:[]},overall:{overallScore:85,pronunciation:{score:5},fluency:{score:5}}}));
 await h.controller.open({history:true});await h.click({sm:'resume',id});return {id,questions};
}
const escaped=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

test('an excluded faulty-headphones response shows its note and an overall for the other 26 answers',async t=>{
 const h=await harness(t),{id}=await sampleReport(h,{paperIndex:1}),note='Feedback could not be generated for your response to the faulty headphones question. This question is excluded from your overall assessment.';
 await h.lab.store.update('alice',id,a=>{const q=a.questions[27],r=a.responses[27];delete r.content;a.assessmentExclusions={27:{attemptId:id,username:'alice',index:27,questionId:q.id,questionHash:require('../scoring-jobs').hash(q),recordingHash:r.recording.hash,operation:'exclude-headphones-ui',note,reason:'feedback-unavailable',authorizedBy:'administrator',excludedAt:1}};return a;});
 await h.controller.open({history:true});await h.click({sm:'resume',id});const summary=h.nodes.get('sm-results-summary').innerHTML;
 assert.match(summary,/26 of 26 responses assessed/);assert.match(summary,/Responses requiring attention/);assert(summary.includes(note));assert.doesNotMatch(summary,/Pending/);assert.match(h.nodes.get('sm-assessment-status').textContent,/26 of 26 content scores available/);
 await h.click({sm:'review',index:'27'});assert.match(h.nodes.get('sm-question-list').innerHTML,/Excluded/);assert(h.nodes.get('sm-review-details').innerHTML.includes(note));assert.match(h.nodes.get('sm-review-details').innerHTML,/Excluded from the overall score/);assert.doesNotMatch(h.nodes.get('sm-review-details').innerHTML,/Unavailable/);
 assert.match(h.nodes.get('sm-review-audio').innerHTML,/<audio/);await h.click({sm:'response-pane',pane:'transcript'});assert.match(h.nodes.get('sm-review-feedback').innerHTML,/A saved response/);
});

test('Task-weighted reports update with question marks and never fall back to a legacy whole score',async t=>{
 const h=await harness(t),{id}=await sampleReport(h,{processing:true});
 await h.lab.store.update('alice',id,a=>{a.responses[1].azure.fluency.score=null;return a;});
 await h.click({sm:'resume',id});assert.match(h.nodes.get('sm-results-summary').innerHTML,/Pending/);
 await h.lab.store.update('alice',id,a=>{a.grading.status='complete';a.responses[1].azure.fluency.score=5;a.combinedOverall={status:'assessed',overallScore:75};return a;});
 await h.tick(3000);const html=h.nodes.get('sm-results-summary').innerHTML;
 for(const text of ['Overall score','85','27 of 27 responses assessed'])assert(html.includes(text));assert.doesNotMatch(html,/Task weights|31%|101%|weighted task accuracy/);
 assert.doesNotMatch(html,/37\.5%|31\.25%|>75</);assert.match(h.nodes.get('sm-assessment-status').textContent,/27 of 27 content scores available/);
});

test('Provider comparison shows two explicitly labeled totals using the same content and each provider audio traits',async t=>{
 const h=await harness(t),{id}=await sampleReport(h),combined=require('../speaking-mock-combined');
 await h.lab.store.update('alice',id,a=>{
  for(const [i,r] of a.responses.entries()){r.recording={mime:'audio/webm',hash:'saved-'+i,data:Buffer.alloc(200,2).toString('base64')};r.transcript='A saved response.';}
  a.completedCount=27;a.overall={status:'assessed',recordingCount:27,overallScore:85,pronunciation:{score:5},fluency:{score:5}};
  a.overallAzure={status:'assessed',recordingCount:27,pronunciation:{score:4,raw:82},fluency:{score:4,raw:82}};
  const content={score:4,maximum:6,summary:'Broadly relevant responses.',nextSteps:[],coverage:combined.entries(a).map(r=>({index:r.index}))};
  a.combinedOverall={...combined.combine(content,a.overall),questionCount:27,recordingCount:27,contentReviewedCount:27,sourceFingerprint:combined.fingerprint(a)};
  a.providerComparisonRecovery={status:'complete'};return a;
 });
 await h.click({sm:'resume',id});const html=h.nodes.get('sm-results-summary').innerHTML;
 for(const text of ['Overall score','85'])assert(html.includes(text));assert(h.nodes.get('sm-next-steps').innerHTML.includes('Broadly relevant responses.'));assert.doesNotMatch(html,/confirmed question content marks|Task weights/);assert.doesNotMatch(html,/Shared content 4\/6|content ceiling/);
 assert.equal((html.match(/class="ipr-score-report"/g)||[]).length,1);
});

test('Every mock exposes each saved Describe Image sample beside its matching image after submission',async t=>{
 const h=await harness(t);
 for(const paperIndex of [0,1,2]){
  const {id,questions}=await sampleReport(h,{paperIndex}),images=questions.filter(q=>q.type==='di');
  await h.click({sm:'filter',type:'di'});
  assert.equal((h.nodes.get('sm-question-list').innerHTML.match(/data-sm="review"/g)||[]).length,5);
  for(let i=0;i<images.length;i++){
   const details=h.nodes.get('sm-review-details').innerHTML,q=images[i];
   assert(details.includes(escaped(q.sample)));assert(details.includes(escaped(q.imageUrl||'/speaking-image/'+q.id+'.svg')));
   assert.match(details,/Sample response/);assert.match(details,/Other accurate descriptions are valid/);
   assert.match(details,/Open full-size image/);assert.match(details,/rel="noopener noreferrer"/);
   if(i<images.length-1)await h.click({sm:'review-step',step:'1'});
  }
  await h.click({sm:'review-step',step:'-1'});assert(h.nodes.get('sm-review-details').innerHTML.includes(escaped(images[3].title)));
  await h.click({sm:'filter',type:'ra'});assert.match(h.nodes.get('sm-review-details').innerHTML,/Reference wording/);assert.doesNotMatch(h.nodes.get('sm-review-details').innerHTML,/sm-image-sample/);
  const saved=await h.lab.store.get('alice',id);assert.deepEqual(saved.questions,questions);
 }
 assert.equal(h.permissions(),0);assert.equal(h.requests.filter(r=>r.method==='POST').length,0,'Reviewing examples never starts a recording, reattempt or paid assessment.');
});

test('New feedback arrives in place without replacing the current audio player or reloading its recording',async t=>{
 const h=await harness(t),{id}=await sampleReport(h,{processing:true});await h.click({sm:'filter',type:'di'});
 for(let n=0;n<100&&!h.nodes.get('sm-review-audio').innerHTML.includes('<audio');n++)await new Promise(resolve=>setTimeout(resolve,2));
 const audio=h.nodes.get('sm-review-audio'),markup=audio.innerHTML;
 assert.match(markup,/<audio controls/);
 await h.tick(3000);assert.equal(h.nodes.get('sm-review-audio'),audio);assert.equal(audio.innerHTML,markup);
 await h.lab.store.update('alice',id,a=>{a.responses[17].content.overview='The latest content review has arrived.';a.responses[17].transcript='Updated student words.';return a;});
 await h.tick(3000);assert.match(h.nodes.get('sm-review-feedback').innerHTML,/latest content review has arrived/);assert.match(h.nodes.get('sm-review-feedback').innerHTML,/Updated student words/);
 assert.equal(h.nodes.get('sm-review-audio'),audio);assert.equal(audio.innerHTML,markup);
 assert.equal(h.requests.filter(r=>r.url.endsWith('/recordings/17')).length,1);
});

test('A delayed recording from the previous question cannot replace the selected question audio',async t=>{
 const h=await harness(t),{questions}=await sampleReport(h);const request=h.env.fetch;let resolveAudio;
 h.env.fetch=(url,args)=>url.endsWith('/recordings/17')?new Promise(resolve=>{resolveAudio=resolve;}):request(url,args);
 await h.click({sm:'filter',type:'di'});assert(resolveAudio);await h.click({sm:'review-step',step:'1'});await h.flush();
 const audio=h.nodes.get('sm-review-audio'),markup=audio.innerHTML;
 resolveAudio({ok:true,blob:async()=>new Blob(['old audio'])});await h.flush();
 assert.equal(h.nodes.get('sm-review-audio'),audio);assert.equal(audio.innerHTML,markup);assert(h.nodes.get('sm-review-details').innerHTML.includes(escaped(questions.filter(q=>q.type==='di')[1].title)));
});

test('Report sections, providers and response tabs preserve the loaded recording and never request a reassessment',async t=>{
 const h=await harness(t);await sampleReport(h);await h.click({sm:'filter',type:'di'});
 for(let n=0;n<100&&!h.nodes.get('sm-review-audio').innerHTML.includes('<audio');n++)await new Promise(resolve=>setTimeout(resolve,2));
 const audio=h.nodes.get('sm-review-audio'),markup=audio.innerHTML,requests=h.requests.length;
 for(const section of ['overview','next','answers']){await h.click({sm:'section',section});assert.equal(h.nodes.get('sm-panel-'+section).hidden,false);}
 for(const provider of ['azure','all','gpt']){h.host.onchange({target:{id:'sm-review-provider',value:provider}});assert.doesNotMatch(h.nodes.get('sm-review-feedback').innerHTML,/GPT Audio|Compare both|<select/);}
 await h.click({sm:'response-pane',pane:'sample'});assert.match(h.nodes.get('sm-review-feedback').innerHTML,/id="sm-response-sample"[^>]*aria-labelledby="sm-response-tab-sample">/);
 await h.click({sm:'response-pane',pane:'transcript'});assert.match(h.nodes.get('sm-review-feedback').innerHTML,/id="sm-response-transcript"[^>]*aria-labelledby="sm-response-tab-transcript">/);
 assert.equal(h.nodes.get('sm-review-audio'),audio);assert.equal(audio.innerHTML,markup);assert.equal(h.requests.length,requests);
});

test('Old generated-image reports retain their saved image while a new reattempt uses the supplied prediction image',async t=>{
 const h=await harness(t),{id}=await sampleReport(h),legacy=structuredClone(require('../content/speaking-bank').questions.find(q=>q.id==='di-1'));
 await h.lab.store.update('alice',id,a=>{a.questions[17]=legacy;return a;});
 await h.click({sm:'resume',id});await h.click({sm:'filter',type:'di'});assert(h.nodes.get('sm-review-details').innerHTML.includes('/speaking-image/di-1.svg'));
 await h.click({sm:'reattempt',id});const fresh=await h.active();assert.equal(fresh.reattemptOf,id);assert.equal(fresh.questions[17].id,'di-pred-3000411');
 assert.deepEqual((await h.lab.store.get('alice',id)).questions[17],legacy);
 assert.equal(require('../content/speaking-mocks').papers[0].questions[17].id,'di-pred-3000411');
});
