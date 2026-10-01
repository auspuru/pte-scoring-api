'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const report = require('../public/writing-lab-report');
const bank = require('../content/writing-lab.json');
const predictions = require('../content/writing-predictions-sep-2026');
const { present, advance } = require('../writing-lab');
const { createController } = require('../public/portal-exam-mode');
const { installWritingLab } = require('../writing-lab');
const express = require('express');
const os = require('node:os');
const client = fs.readFileSync(path.join(__dirname, '../public/writing-lab-client.js'), 'utf8');
function harness({ audioReadyState = 4, protectedMode = false, portal = false } = {}) {
  const nodes = new Map(), intervals = new Map(), recordings = [], requests = [], memory = new Map();
  let now = 100000, seq = 0;
  class Element {
    constructor(id,tagName='DIV') { this.id=id; this.tagName=tagName; this.parentElement=null; this.children=[]; this.attrs=new Map();this.inert=false;this.hidden=false;this.value=''; this.isConnected=true; this.textContent=''; this.disabled=false;this.readOnly=false; this.classes=new Set(); this.events={};
      this.classList={add:c=>this.classes.add(c),remove:c=>this.classes.delete(c),contains:c=>this.classes.has(c),toggle:c=>this.classes.has(c)?this.classes.delete(c):this.classes.add(c)}; }
    addEventListener(name,fn) { this.events[name]=fn; }
    appendChild(child){child.parentElement=this;this.children.push(child);}
    contains(target){return target===this||this.children.some(child=>child.contains(target));}
    getAttribute(name){return this.attrs.get(name)??null;}
    setAttribute(name,value){this.attrs.set(name,value);}
    removeAttribute(name){this.attrs.delete(name);}
    focus() {for(let n=this;n;n=n.parentElement)if(n.inert||n.hidden)return;document.activeElement=this;}
    close() {this.open=false;this.onclose?.();} showModal() {this.open=true;}
    set innerHTML(html) {
      this.html=html;
      if(this.id!=='lab') return;
      this.children=[];
      for(const [id,node] of nodes) if(!['lab','notice','writingLabScreen'].includes(id)&&!id.startsWith('confirm-')) { node.isConnected=false; nodes.delete(id); }
      for(const match of html.matchAll(/<([a-z]+)[^>]*id="([^"]+)"/g)) {const node=new Element(match[2],match[1].toUpperCase());nodes.set(match[2],node);this.appendChild(node);}
      for(const match of html.matchAll(/<[^>]+id="([^"]+)"[^>]*>/g)) if(/\bdisabled\b/.test(match[0])) nodes.get(match[1]).disabled=true;
      for(const match of html.matchAll(/<textarea[^>]*id="([^"]+)"[^>]*>([^]*?)<\/textarea>/g)) nodes.get(match[1]).value=match[2];
    }
    get innerHTML() { return this.html||''; }
  }
  for(const id of ['lab','notice','confirm-dialog']) nodes.set(id,new Element(id,id==='confirm-dialog'?'DIALOG':'DIV'));
  if(portal)nodes.set('writingLabScreen',new Element('writingLabScreen'));
  class Audio {
    constructor(url) { this.src=url; this.readyState=audioReadyState; this.currentTime=0; this.duration=80; this.paused=true; this.ended=false; this.plays=0; this.loads=0; recordings.push(this); }
    async play() { this.paused=false; this.plays++; }
    pause() { const changed=!this.paused; this.paused=true; if(changed) this.onpause?.(); }
    load() { this.loads++; this.error=null; this.readyState=0; }
  }
  class Clock extends Date { static now() { return now; } }
  const listen=(events,name,fn)=>{const prior=events[name];events[name]=prior?e=>{prior(e);fn(e);}:fn;};
  const document={getElementById:id=>nodes.get(id)||null,body:new Element('body'),documentElement:new Element('html'),hidden:false,focused:true,hasFocus(){return this.focused;},events:{},addEventListener(name,fn){listen(this.events,name,fn);},createElement:tag=>new Element('',tag.toUpperCase())};
  document.documentElement.appendChild(document.body);
  const shell=nodes.get('writingLabScreen')||document.body;if(portal)document.body.appendChild(shell);
  for(const id of ['lab','notice','confirm-dialog'])shell.appendChild(nodes.get(id));
  if(protectedMode)for(const id of ['confirm-title','confirm-text','confirm-ok','confirm-cancel']) {const node=new Element(id,id.endsWith('ok')||id.endsWith('cancel')?'BUTTON':'DIV');nodes.set(id,node);nodes.get('confirm-dialog').appendChild(node);}
  document.documentElement.requestFullscreen=async()=>{document.fullscreenElement=document.documentElement;document.events.fullscreenchange?.({});};
  document.exitFullscreen=async()=>{document.fullscreenElement=null;document.events.fullscreenchange?.({});};
  const context={document,Audio,Date:Clock,console,AbortSignal,crypto:require('node:crypto').webcrypto,
    location:{pathname:'/writing-mocks',origin:'https://practice.test'},navigator:{},
    localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},
    sessionStorage:{getItem:()=>null},
    setInterval:(fn,ms)=>{const id=++seq;intervals.set(id,{fn,ms});return id;},clearInterval:id=>intervals.delete(id),
    setTimeout:()=>++seq,clearTimeout:()=>{},
    fetch:async(url,options)=>{ requests.push({url,body:options.body?JSON.parse(options.body):null});
      const value=structuredClone(context.reply || context.window.testApi.current());
      if(context.replyOnce) {context.reply=null;context.replyOnce=false;}
      return {ok:true,json:async()=>value}; }
  };
  context.window={WritingLabReport:report,PteEstimateDisplay:{render:(reading,writing)=>'<div class="test-estimate">'+writing+'<small> / 90</small></div>'},parent:{postMessage(){}},events:{},addEventListener(name,fn){listen(this.events,name,fn);},scrollTo(){}};
  vm.createContext(context);
  const instrumented=client.replace('  if(!inPortal) boot();',`  window.testApi={set(value){username='tester';setAttempt(value);},current:()=>attempt,setCatalog(value){catalog=value;username='tester';},start,edit,recordInterruption,flushIntegrity,hub,handleRequest,showAttempt,tick,writeDraft,renderResults,saveAnswer,resume,reattempt,movePractice,suspend,boot}; return;`);
  vm.runInContext(instrumented,context);
  if(protectedMode)context.window.PortalExamMode=createController(document,context.window);
  const hooks=context.window.testApi;
  return {hooks,nodes,recordings,requests,memory,context,intervals,document,setNow:value=>now=value,
    countdown:async()=>{for(let i=0;i<3;i++) for(const task of [...intervals.values()]) if(task.ms===1000) await task.fn();}};
}
function attempt(index=3) {
  const questions=structuredClone(bank.mocks[0].questions);
  return present({id:'test-id',title:'Writing Sectional Mock 1',kind:'mock',index,status:'active',startedAt:100000,deadline:700000,
    questions,answers:questions.map(()=>''),notes:'',revisions:questions.map(()=>0),completed:questions.map(()=>null),results:questions.map(()=>null),playback:questions.map(()=>null),serverNow:100000});
}
function open(h,a) { a.serverNow=100000;h.hooks.set(a);h.hooks.showAttempt(); }
async function flush() { for(let i=0;i<5;i++) await new Promise(resolve=>setImmediate(resolve)); }

test('The real protected controller allows typing and saving in every Writing mock task, including dictations',async()=>{
  for(const portal of [false,true]) {
    const h=harness({protectedMode:true,portal}),mode=h.context.window.PortalExamMode;
    const server=attempt(0),events=[];h.hooks.setCatalog({mocks:bank.mocks,spoken:[],dictation:[]});
    h.context.fetch=async(url,options={})=>{
      const body=options.body?JSON.parse(options.body):{};h.requests.push({url,body});
      if(url.endsWith('/answer')) {
        server.answers[body.index]=body.text;server.revisions[body.index]=body.revision;server.notes=body.notes;
        if(body.next)advance(server,100000,'Submitted');
      }
      if(url.endsWith('/integrity')){events.push(...body.events);return {ok:true,json:async()=>({protected:true,events})};}
      return {ok:true,json:async()=>({...structuredClone(server),serverNow:100000})};
    };
    const starting=h.hooks.start(bank.mocks[0].id,{disabled:false});
    h.nodes.get('confirm-ok').onclick();await flush();
    const guard=h.document.body.children.find(n=>n.id==='portal-exam-guard'),enter=guard.children[0].children.find(n=>n.tagName==='BUTTON');
    assert(mode.isLocked());await enter.onclick();await starting;
    const typed=new Set();
    for(let index=0;index<server.questions.length;index++) {
      const question=server.questions[index],editor=h.nodes.get('answer'),text='My response for '+question.type+' '+index;
      assert.equal(h.hooks.current().index,index);assert(!mode.isLocked());assert(guard.hidden);
      editor.focus();assert.equal(h.document.activeElement,editor);assert(!editor.disabled);assert(!editor.readOnly);
      let blocked=false;h.document.events.keydown({key:'a',target:editor,preventDefault(){blocked=true;},stopImmediatePropagation(){}});assert(!blocked);
      editor.value=text;editor.events.input();typed.add(question.type);
      if(question.type==='sst') {
        h.document.focused=false;h.context.window.events.blur({});assert(mode.isLocked());assert(!guard.hidden);
        h.document.focused=true;await enter.onclick();
        assert.equal(h.nodes.get('answer').value,text);h.nodes.get('answer').focus();assert.equal(h.document.activeElement,h.nodes.get('answer'));
      }
      await h.hooks.saveAnswer(false);assert.equal(server.answers[index],text);
      if(index<server.questions.length-1)await h.nodes.get('next').onclick();
    }
    assert.deepEqual([...typed].sort(),['essay','sst','swt','wfd']);assert.equal(events.length,1);
    mode.reset();
  }
});

test('A Next save conflict keeps the response editable while preserving the draft and blocking advancement',async()=>{
  const h=harness();open(h,attempt(0));const editor=h.nodes.get('answer');editor.value='My unsaved response';editor.events.input();
  const conflict=attempt(0);conflict.answers[0]='A newer response';conflict.revisions[0]=20;h.context.reply=conflict;
  await h.nodes.get('next').onclick();
  assert.equal(h.hooks.current().index,0);assert.equal(editor.value,'My unsaved response');assert(!editor.readOnly);assert(h.nodes.get('next').disabled);
});

test('Writing mock creation waits for protected preflight and cancelling starts no server attempt',async()=>{
  for(const accepted of [false,true]) {
    const h=harness();h.hooks.setCatalog({mocks:bank.mocks,spoken:[],dictation:[]});
    for(const id of ['confirm-title','confirm-text','confirm-ok','confirm-cancel'])h.nodes.set(id,{textContent:''});
    const dialog=h.nodes.get('confirm-dialog');dialog.close=()=>dialog.onclose();
    let ready;h.context.window.PortalExamMode={prepare:()=>new Promise(resolve=>ready=resolve),set(){}};
    h.context.reply=attempt(0);const button={disabled:false},starting=h.hooks.start(bank.mocks[0].id,button);
    h.nodes.get('confirm-ok').onclick();await flush();
    assert.equal(h.requests.length,0);assert.equal(h.hooks.current(),null);
    ready(accepted);await starting;
    assert.equal(h.requests.filter(request=>request.url==='/api/writing-lab/attempts').length,accepted?1:0);
    if(!accepted)assert.equal(button.disabled,false);
  }
});

test('Writing interruption records retry after offline recovery and survive stale server snapshots without changing the deadline',async()=>{
  const h=harness(),initial=attempt(0);open(h,initial);let online=false;
  h.context.fetch=async(url,options)=>{
    h.requests.push({url,body:JSON.parse(options.body),keepalive:options.keepalive});
    if(!online)throw Error('Offline');
    return {ok:true,json:async()=>({protected:true,events:JSON.parse(options.body).events.map(event=>({...event,receivedAt:200000}))})};
  };
  h.hooks.recordInterruption({id:'interruption-1',reason:'window-blur',at:100000});await flush();
  const key='ipt-mock-interruptions:tester:test-id';assert(h.memory.has(key));
  h.hooks.set({...initial,integrity:{protected:true,events:[]}});assert.equal(h.hooks.current().integrity.events.length,1);
  online=true;await h.hooks.flushIntegrity();assert(!h.memory.has(key));
  assert.equal(h.hooks.current().integrity.events[0].receivedAt,200000);assert.equal(h.hooks.current().deadline,initial.deadline);
  assert(h.requests.every(request=>request.keepalive));
  const practice=attempt(3);practice.kind='sst';open(h,practice);const count=h.requests.length;
  h.hooks.recordInterruption({id:'practice',reason:'tab-hidden',at:100000});await flush();assert.equal(h.requests.length,count);
});

test('Protected Writing clipboard controls delegate to the internal clipboard and do not access the system clipboard',async()=>{
  const h=harness(),calls=[];open(h,attempt(0));
  h.context.window.PortalExamMode={edit:(command,editor)=>{calls.push({command,id:editor.id});return true;}};
  h.context.navigator.clipboard={readText(){throw Error('System clipboard must not be read');},writeText(){throw Error('System clipboard must not be written');}};
  await h.hooks.edit('paste');assert.deepEqual(calls,[{command:'paste',id:'answer'}]);
});

test('Writing mocks show only forward navigation and release exam mode after submission or suspension', async () => {
  const h=harness(),calls=[];
  h.context.window.PortalExamMode={set:(owner,enabled)=>calls.push({owner,enabled})};
  open(h,attempt(0));
  assert.deepEqual(calls.at(-1),{owner:'writing',enabled:true});
  assert.doesNotMatch(h.nodes.get('lab').innerHTML,/data-leave=|data-portal=|data-tab=|data-practice-move=/);
  assert.match(h.nodes.get('lab').innerHTML,/id="next"/);
  await h.hooks.suspend(); assert.equal(calls.at(-1).enabled,false);
  const completed=attempt(0); completed.status='submitted'; completed.questions=structuredClone(bank.mocks[0].questions); completed.results=completed.questions.map(q=>({total:0,maximum:report.maximumFor(q),maxima:{content:report.maximumFor(q)},scores:{content:0},feedback:{},reasons:[]}));
  h.hooks.set(completed); h.hooks.showAttempt(); assert.equal(calls.at(-1).enabled,false);
  const practice=attempt(3); practice.kind='sst'; open(h,practice);
  assert.equal(calls.at(-1).enabled,false); assert.match(h.nodes.get('lab').innerHTML,/data-leave="1"/);
});

test('Task pages and saved attempts stay scoped to individual practice or mocks',async()=>{
 const h=harness();h.hooks.setCatalog({mocks:bank.mocks,spoken:bank.spoken,dictation:bank.mocks[0].questions.filter(q=>q.type==='wfd')});
 await h.hooks.hub('sst');assert.match(h.nodes.get('lab').innerHTML,/Summarise Spoken Text/);assert.doesNotMatch(h.nodes.get('lab').innerHTML,/data-board|Start Exam/);
 await h.hooks.hub('wfd');assert.match(h.nodes.get('lab').innerHTML,/Write From Dictation/);assert.doesNotMatch(h.nodes.get('lab').innerHTML,/Summarise Spoken Text/);
 h.context.reply=[{id:'d',kind:'wfd',title:'Dictation saved',startedAt:1,status:'ready'}, {id:'s',kind:'sst',title:'Spoken saved',startedAt:1,status:'ready'}, {id:'m',kind:'mock',title:'Mock saved',startedAt:1,status:'active'}];
 await h.hooks.hub('history');assert.match(h.nodes.get('history-list').innerHTML,/Dictation saved/);assert.doesNotMatch(h.nodes.get('history-list').innerHTML,/Spoken saved|Mock saved/);
 await h.hooks.handleRequest({tab:'history',requestId:'mock-history'});
 assert.match(h.nodes.get('history-list').innerHTML,/Mock saved/);assert.doesNotMatch(h.nodes.get('history-list').innerHTML,/Dictation saved|Spoken saved/);
});
test('Returning to an active task preserves its attempt and deadline without another start',async()=>{
 const h=harness(),a=attempt(3);a.kind='sst';open(h,a);h.hooks.setCatalog({mocks:[],spoken:bank.spoken,dictation:[]});
 await h.hooks.handleRequest({tab:'sst',requestId:'return-sst'});
 assert.equal(h.hooks.current().id,a.id);assert.equal(h.hooks.current().deadline,a.deadline);
 assert(!h.requests.some(r=>r.url.endsWith('/attempts')));
 const n=h.requests.length;await h.hooks.handleRequest({tab:'sst',requestId:'return-sst'});assert.equal(h.requests.length,n);
});
test('A delayed navigation cannot reopen a suspended lab',async()=>{
 const h=harness();open(h,attempt());h.hooks.setCatalog({mocks:[],spoken:bank.spoken,dictation:[]});
 const old=h.nodes.get('lab').innerHTML;let release;
 h.context.fetch=()=>new Promise(resolve=>release=()=>resolve({ok:true,json:async()=>attempt()}));
 const request=h.hooks.handleRequest({tab:'wfd',requestId:'slow'});await flush();
 h.context.window.events.message({source:h.context.window.parent,origin:h.context.location.origin,data:{type:'writing-lab-suspend'}});
 release();await request;
  assert.equal(h.nodes.get('lab').innerHTML,old);assert.equal(h.hooks.current().kind,'mock');
});

for(const action of ['resume','reattempt']) {
  test('A delayed '+action+' cannot reopen the task after leaving the workspace',async()=>{
    const h=harness(), original=attempt();open(h,original);
    const fetchNormally=h.context.fetch;
    let release;
    h.context.fetch=(url,options)=>url.endsWith('/answer')?fetchNormally(url,options):new Promise(resolve=>{
      release=()=>resolve({ok:true,json:async()=>({...attempt(),id:'late-attempt',serverNow:100000})});
    });
    const request=h.hooks[action]('late-attempt',{disabled:false});
    await flush();await h.hooks.suspend();
    const old=h.nodes.get('lab').innerHTML;
    release();await request;
    assert.equal(h.hooks.current().id,original.id);
    assert.equal(h.nodes.get('lab').innerHTML,old);
    assert.equal(h.recordings.length,1);
  });
}

test('Returning to the question list cancels a pending Resume response',async()=>{
  const h=harness();h.hooks.setCatalog({mocks:[],spoken:bank.spoken,dictation:[]});
  let release;
  h.context.fetch=()=>new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({...attempt(),serverNow:100000})});});
  const request=h.hooks.resume('test-id',{disabled:false});
  await h.hooks.hub('sst');
  const list=h.nodes.get('lab').innerHTML;
  release();await request;
  assert.equal(h.hooks.current(),null);
  assert.equal(h.nodes.get('lab').innerHTML,list);
});

test('The most recent Resume selection wins when responses arrive out of order',async()=>{
  const h=harness(), responses=new Map();
  h.context.fetch=(url,options)=>url.endsWith('/answer')
    ? Promise.resolve({ok:true,json:async()=>structuredClone(h.hooks.current())})
    : new Promise(resolve=>responses.set(url.split('/').pop(),()=>resolve({ok:true,json:async()=>({...attempt(),id:url.split('/').pop(),serverNow:100000})})));
  const first=h.hooks.resume('first',{disabled:false});
  const second=h.hooks.resume('second',{disabled:false});
  responses.get('second')();await second;
  responses.get('first')();await first;
  assert.equal(h.hooks.current().id,'second');
});

test('Play can start loading when a browser defers preloading, without starting the timer early',async()=>{
  const h=harness({audioReadyState:0}), a=attempt();
  Object.assign(a,{kind:'sst',status:'ready',deadline:null});open(h,a);
  const button=h.nodes.get('audio-start'),player=h.recordings[0];
  assert.equal(button.disabled,false,'The learner must be able to supply the gesture that loads audio');
  let allowPlayback;
  player.play=()=>{player.plays++;return new Promise(resolve=>{allowPlayback=()=>{player.paused=false;resolve();};});};
  const clicked=button.onclick();
  assert.equal(player.plays,1);
  assert.equal(h.requests.length,0);
  assert.equal(h.hooks.current().deadline,null);
  player.readyState=4;player.oncanplay();
  assert.equal(h.requests.length,0);
  h.context.reply={...a,status:'active',deadline:700000};h.context.replyOnce=true;
  allowPlayback();await clicked;
  assert.equal(h.requests.filter(r=>r.url.endsWith('/begin')).length,1);
  assert.equal(h.hooks.current().status,'active');
  assert.equal(h.nodes.get('audio-status').textContent,'Playing…');
});

test('A stale start response cannot pause audio after returning to the same question',async()=>{
  const h=harness(), a=attempt();Object.assign(a,{kind:'sst',status:'ready',deadline:null});
  h.hooks.setCatalog({mocks:[],spoken:bank.spoken,dictation:[]});open(h,a);
  let release;
  const fetchNormally=h.context.fetch;
  h.context.fetch=()=>new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({...a,status:'active',deadline:700000})});});
  const oldClick=h.nodes.get('audio-start').onclick();await flush();
  await h.hooks.suspend();
  await h.hooks.handleRequest({tab:'sst',requestId:'returned'});
  h.context.fetch=fetchNormally;h.context.reply={...a,status:'active',deadline:700000};h.context.replyOnce=true;
  await h.nodes.get('audio-start').onclick();
  assert.equal(h.recordings[0].paused,false);
  release();await oldClick;
  assert.equal(h.recordings[0].paused,false,'The earlier request no longer owns the visible player');
  assert.equal(h.nodes.get('audio-status').textContent,'Playing…');
});

test('The standalone SST Play button starts through the real API, saves playback, and resumes the same timer',async t=>{
  const directory=await fs.promises.mkdtemp(path.join(os.tmpdir(),'sst-start-flow-'));
  const app=express();app.use(express.json());
  installWritingLab(app,{directory,verifyToken:t=>t==='tester'?'tester':null,getAccount:async()=>({}),callModel:()=>{throw Error('Not scoring');}});
  // Match the main app's page fallback: a wrong GET previously returned HTML 200.
  app.get('*',(_,res)=>res.type('html').send('<!doctype html><title>Practice workspace</title>'));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.promises.rm(directory,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  const h=harness();h.memory.set('pte_session_token','tester');
  h.context.fetch=async(url,options)=>{
    h.requests.push({url,method:options.method,body:options.body?JSON.parse(options.body):null});
    return fetch(base+url,options);
  };
  const id=require('node:crypto').randomUUID();
  const response=await fetch(base+'/api/writing-lab/attempts',{method:'POST',headers:{'Content-Type':'application/json','x-session-token':'tester'},body:JSON.stringify({id,testId:require('../content/writing-predictions-sep-2026').sst[0].id})});
  const a=await response.json();assert.equal(a.status,'ready');
  h.hooks.set(a);h.hooks.showAttempt();
  const button=h.nodes.get('audio-start'), player=h.recordings[0];
  const clicked=button.onclick();
  assert.equal(player.plays,1,'Playback is requested during the click, before any network await');
  await clicked;
  assert.deepEqual(h.requests.filter(r=>r.url.endsWith('/begin')).map(r=>r.method),['POST']);
  assert.equal(h.hooks.current().status,'active');
  assert.equal(player.plays,1);
  assert.equal(h.nodes.get('answer').disabled,false);
  assert.equal(h.nodes.get('audio-status').textContent,'Playing…');
  const deadline=h.hooks.current().deadline;
  player.currentTime=5;await h.hooks.saveAnswer(false);
  player.pause();await button.onclick();await h.hooks.saveAnswer(false);
  assert.equal(player.plays,2);
  assert.equal(h.requests.filter(r=>r.url.endsWith('/begin')).length,1);
  const saved=await (await fetch(base+'/api/writing-lab/attempts/'+id,{headers:{'x-session-token':'tester'}})).json();
  assert.equal(saved.deadline,deadline);assert.equal(saved.playback[0].position,5);
});

test('A rejected browser play leaves SST ready and does not consume its timer',async()=>{
  const h=harness(), a=attempt(3);Object.assign(a,{kind:'sst',status:'ready',deadline:null});
  open(h,a);
  const player=h.recordings[0];
  player.play=async()=>{throw Object.assign(Error('A user gesture is required'),{name:'NotAllowedError'});};
  await h.nodes.get('audio-start').onclick();
  assert.equal(h.hooks.current().status,'ready');
  assert.equal(h.hooks.current().deadline,null);
  assert.equal(h.requests.length,0);
  assert.equal(h.nodes.get('audio-start').disabled,false);
  assert.match(h.nodes.get('audio-status').textContent,/allow audio/);
});

test('A start API failure pauses playback and permits a fresh click to retry',async()=>{
  const h=harness(), a=attempt(3);Object.assign(a,{kind:'sst',status:'ready',deadline:null});
  open(h,a);
  const fetchNormally=h.context.fetch;
  h.context.fetch=async()=>({ok:false,json:async()=>({error:'Your attempt could not be started.'})});
  await h.nodes.get('audio-start').onclick();
  assert(h.recordings[0].paused);
  assert.equal(h.hooks.current().status,'ready');
  assert.equal(h.nodes.get('audio-start').disabled,false);
  assert.match(h.nodes.get('audio-status').textContent,/attempt could not be started/);
  h.context.fetch=fetchNormally;h.context.reply={...a,status:'active',deadline:700000};h.context.replyOnce=true;
  await h.nodes.get('audio-start').onclick();await flush();
  assert.equal(h.hooks.current().status,'active');
  assert.equal(h.nodes.get('audio-status').textContent,'Playing…');
});

test('Submitted standalone SST results offer a fresh reattempt while retaining the completed attempt',async()=>{
  const h=harness();
  const q=structuredClone(bank.spoken[0]);
  const result={total:report.maximumFor(q),maximum:report.maximumFor(q),maxima:{content:4,form:2,grammar:2,vocabulary:2,spelling:2},scores:{content:4,form:2,grammar:2,vocabulary:2,spelling:2},feedback:{content:'Complete',form:'Complete',grammar:'Complete',vocabulary:'Complete',spelling:'Complete'},strengths:[],improvements:[],errors:[]};
  const submitted=present({id:'old-id',testId:q.id,title:q.title,kind:'sst',index:0,status:'submitted',startedAt:100000,deadline:null,questions:[q],answers:[q.sample],notes:'',revisions:[1],completed:[{at:100100,reason:'Submitted'}],results:[result],playback:[{position:75,finished:true}],serverNow:100000});
  h.hooks.set(submitted);h.hooks.renderResults();
  assert.match(h.nodes.get('lab').innerHTML,/Reattempt this question/);
  assert.match(h.nodes.get('lab').innerHTML,/data-reattempt="sst-urban-trees"/);
  const fresh=present({id:'new-id',testId:q.id,title:q.title,kind:'sst',index:0,status:'ready',startedAt:200000,deadline:null,questions:[q],answers:[''],notes:'',revisions:[0],completed:[null],results:[null],playback:[null],serverNow:200000});
  h.context.reply=fresh;
  const button={disabled:false};
  await h.hooks.reattempt(q.id,button);
  assert.equal(button.disabled,true);
  assert.equal(h.requests.filter(r=>r.url.endsWith('/attempts')).length,1);
  const request=h.requests[0];
  assert.equal(request.body.testId,q.id);
  assert.notEqual(request.body.id,'old-id');
  assert.equal(h.hooks.current().id,'new-id');
  assert.equal(h.hooks.current().status,'ready');
  assert.equal(h.nodes.get('audio-start').textContent,'Play');
});

test('Integrated audio advances to each new recording and ignores late events from the previous question',async()=>{
  const h=harness();open(h,attempt(3));
  assert.match(h.recordings[0].src,/wm1-sst/);
  await h.countdown();await flush();assert.equal(h.recordings[0].plays,1);
  const first=h.recordings[0], lateEnd=first.onended;
  first.currentTime=80;first.ended=true;first.onended();await flush();
  const next=attempt(4);open(h,next);
  assert(first.paused);assert.equal(h.recordings.length,2);
  assert.match(h.recordings[1].src,/wm1-wfd1/);assert.equal(h.recordings[1].currentTime,0);
  lateEnd();await h.countdown();await flush();
  assert.equal(h.recordings[1].plays,1);
  assert.equal(h.nodes.get('audio-status').textContent,'Playing…');
  open(h,attempt(5));assert.match(h.recordings[2].src,/wm1-wfd2/);
});

test('Refresh resumes the current question from server progress without inheriting the previous recording',()=>{
  const h=harness(), a=attempt(5);
  a.playback[5]={position:3,finished:false};
  h.memory.set('ipt-writing-lab:tester:test-id',JSON.stringify({index:4,audioTime:75,audioFinished:true}));
  open(h,a);assert.equal(h.recordings[0].currentTime,3);
  assert.equal(h.nodes.get('audio-start').textContent,'Continue recording');
  assert.equal([...h.intervals.values()].filter(t=>t.ms===1000).length,0);
  const finished=harness(), b=attempt(6);b.playback[6]={position:7,finished:true};open(finished,b);
  assert(finished.nodes.get('audio-start').classes.has('hidden'));
  assert.equal(finished.recordings[0].plays,0);
});

test('SST retries a failed load in one click and starts its timer only after playback begins',async()=>{
  const h=harness({audioReadyState:1}), a=attempt(3);
  Object.assign(a,{kind:'sst',status:'ready',deadline:null});
  open(h,a);
  const player=h.recordings[0], button=h.nodes.get('audio-start');
  player.onloadedmetadata();
  assert.equal(button.disabled,false);
  assert.equal(h.requests.length,0);
  player.error={code:2};player.onerror();
  assert.equal(button.textContent,'Retry audio');
  assert.equal(h.hooks.current().status,'ready');
  assert.equal(h.requests.length,0);
  let allowPlayback;
  player.play=()=>{player.plays++;return new Promise(resolve=>{allowPlayback=()=>{player.paused=false;resolve();};});};
  const clicked=button.onclick();assert.equal(player.loads,1);
  assert.equal(player.plays,1,'Retry requests playback within the same user gesture');
  player.readyState=4;player.oncanplay();
  assert.equal(button.disabled,true);
  assert.equal(h.requests.length,0);
  h.context.reply={...a,status:'active',deadline:700000};
  h.context.replyOnce=true;
  allowPlayback();await clicked;await flush();
  assert.equal(player.plays,1);
  assert.equal(h.requests.filter(r=>r.url.endsWith('/begin')).length,1);
  assert.equal(h.nodes.get('audio-status').textContent,'Playing…');
  player.currentTime=80;player.ended=true;player.onended();await flush();
  assert(button.classes.has('hidden'));
  assert(h.requests.some(r=>r.body?.playback?.finished && r.body.playback.position===80));
});

test('A zero-second completion from the old silent fallback does not lock a recording',async()=>{
  const h=harness(), a=attempt(3);
  a.playback[3]={position:0,finished:true};
  h.memory.set('ipt-writing-lab:tester:test-id',JSON.stringify({index:3,audioTime:0,audioFinished:true}));
  open(h,a);await h.countdown();await flush();
  assert.equal(h.recordings[0].plays,1);
  assert.equal(h.nodes.get('audio-status').textContent,'Playing…');
  assert(h.requests.some(r=>r.body?.playback?.finished===false));
});

test('Backgrounding or expiry cancels a queued recording without resetting the shared timer',async()=>{
  const h=harness();open(h,attempt(4));h.document.hidden=true;h.document.events.visibilitychange();await flush();
  await h.countdown();assert.equal(h.recordings[0].plays,0);
  const expiry=harness(), a=attempt(4);a.deadline=102000;open(expiry,a);
  const finished={...a,status:'submitted',deadline:null,questions:bank.mocks[0].questions,results:bank.mocks[0].questions.map(q=>({total:0,maximum:report.maximumFor(q),maxima:{content:report.maximumFor(q)},scores:{content:0},feedback:{},strengths:[],improvements:[],errors:[]}))};
  expiry.context.reply=finished;expiry.setNow(102001);await expiry.hooks.tick();await expiry.countdown();
  assert.equal(expiry.recordings[0].plays,0);
  assert.match(expiry.nodes.get('lab').innerHTML,/10<small> \/ 90/);
});

test('Results render pending and completed task estimates out of 90 with safe dictation feedback',()=>{
  const h=harness(), a=attempt(6);a.status='submitted';a.questions=structuredClone(bank.mocks[0].questions);
  a.results=a.questions.map(q=>({total:report.maximumFor(q),maximum:report.maximumFor(q),maxima:{content:report.maximumFor(q)},scores:{content:report.maximumFor(q)},feedback:{content:'Complete'},strengths:[],improvements:[],errors:[]}));
  a.results[4].wordFeedback=[{word:'<script>bad</script>',correct:false}];
  open(h,a);const html=h.nodes.get('lab').innerHTML;
  assert.match(html,/90<small> \/ 90/);assert.match(html,/Write from Dictation/);
  assert.match(html,/View correct sentence/);assert.match(html,/&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>bad/);
});

test('SST Back and Next preserve drafts and resume existing neighbouring attempts',async()=>{
  const h=harness();h.hooks.setCatalog({mocks:[],spoken:bank.spoken,dictation:[]});
  const first=attempt(0);Object.assign(first,{id:'first',kind:'sst',testId:bank.spoken[0].id,questions:[bank.spoken[0]],answers:[''],revisions:[0],completed:[null],results:[null],playback:[null]});
  const second=structuredClone(first);Object.assign(second,{id:'second',testId:bank.spoken[1].id,questions:[bank.spoken[1]],answers:['Saved second response']});
  h.context.fetch=async(url,opts={})=>{h.requests.push({url,opts});let value;
    if(url.endsWith('/answer')){const body=JSON.parse(opts.body),current=url.includes('/first/')?first:second;current.answers[0]=body.text;current.revisions[0]=body.revision;value=current;}
    else if(url.endsWith('/attempts'))value=[{id:'second',testId:second.testId,startedAt:1}];
    else value=second;
    return {ok:true,json:async()=>structuredClone(value)};
  };
  open(h,first);h.nodes.get('answer').value='Keep my first response';
  await h.hooks.movePractice(1,{disabled:false,isConnected:false});
  assert.equal(first.answers[0],'Keep my first response');assert.equal(h.hooks.current().id,'second');
  assert.equal(h.nodes.get('answer').value,'Saved second response');
  assert(!h.requests.some(r=>r.url.endsWith('/attempts')&&r.opts.method==='POST'));
});
test('Dictation catalogue puts 33 labelled predictions before the previous 56 questions',async()=>{
 const h=harness();
 const previous=[...new Map([...bank.mocks.flatMap(m=>m.questions.filter(q=>q.type==='wfd')),...bank.dictation].map(q=>[q.id,q])).values()];
 const predictionRows=predictions.wfd.slice(0,33).map(q=>({id:q.id,minutes:q.minutes,prediction:true}));
 const dictation=[...predictionRows,...previous.map(q=>({id:q.id,minutes:q.minutes,prediction:false}))];
 h.hooks.setCatalog({mocks:[],spoken:bank.spoken,dictation});await h.hooks.hub('wfd');
 let html=h.nodes.get('lab').innerHTML;
 assert.equal((html.match(/data-start=/g)||[]).length,12);assert.match(html,/Question 1</);assert.equal((html.match(/>Prediction</g)||[]).length,12);
 assert.match(html,/pred26-user-wfd-01/);assert.doesNotMatch(html,/estimate|scoring|raw marks|How the/);
 await h.nodes.get('lab').events.click({target:{closest:()=>({disabled:false,dataset:{libraryPage:'2'}})}});
 html=h.nodes.get('lab').innerHTML;
 assert.equal((html.match(/data-start=/g)||[]).length,12);assert.match(html,/Question 33</);assert.equal((html.match(/>Prediction</g)||[]).length,9);
 assert.match(html,new RegExp(previous[0].id));
 await h.nodes.get('lab').events.click({target:{closest:()=>({disabled:false,dataset:{libraryPage:'7'}})}});
 html=h.nodes.get('lab').innerHTML;
 assert.equal((html.match(/data-start=/g)||[]).length,5);assert.match(html,/Question 89</);assert.doesNotMatch(html,/>Prediction</);
});


test('Writing Lab prefers the sessionStorage login token before stale localStorage auth', () => {
  assert.match(client, /sessionStorage\.getItem\('pte_session_token'\)/);
  const sessionIndex=client.indexOf("sessionStorage.getItem('pte_session_token')");
  const localIndex=client.indexOf("storage.get('pte_session_token')");
  assert(sessionIndex >= 0 && localIndex > sessionIndex);
});


test('Writing Lab result UI distinguishes provisional estimates and keeps criterion feedback expandable', () => {
  const h=harness(),a=attempt();a.status='submitted';a.questions=structuredClone(bank.mocks[0].questions);
  a.results=a.questions.map(q=>({total:report.maximumFor(q),maximum:report.maximumFor(q),scores:{content:4,form:2},maxima:{content:4,form:2},feedback:{content:'Main idea captured.',form:'Within the limit.'},strengths:[],improvements:[],errors:[],gated:false,reasons:[]}));
  h.hooks.set(a);h.hooks.renderResults();
  assert.match(h.nodes.get('lab').innerHTML, /<h2>Practice estimate<\/h2>/);
  a.results[3].scoringMode='local';h.hooks.set(a);h.hooks.renderResults();
  assert.match(h.nodes.get('lab').innerHTML, /Provisional practice estimate/);
  assert.match(h.nodes.get('lab').innerHTML, /data-review-retry="3"/);
  assert.match(h.nodes.get('lab').innerHTML, /assessment-details/);
  assert.match(client, /<small> \/ 90<\/small>/);
  assert.doesNotMatch(client, /Native practice result/);
  assert.doesNotMatch(client, /<th>Marks<\/th>/);
  assert.doesNotMatch(client, /No marks awarded for this response/);
});


test('Writing Lab question view hides prediction provenance descriptions', () => {
  assert.doesNotMatch(client, /content-provenance/);
  assert.doesNotMatch(client, /Unseen prediction/);
  assert.doesNotMatch(client, /Adapted practice/);
});


test('Writing Lab exposes a direct in-page portal lifecycle API',()=>{
  assert.match(client,/window\.WritingLab=\{/);
  assert.match(client,/leave:suspend/);
  assert.match(client,/async open\(request=\{\}\)/);
  assert.match(client,/const inPortal = !!portalShell/);
});
