'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const report = require('../public/writing-lab-report');
const bank = require('../content/writing-lab.json');
const { present } = require('../writing-lab');
const { installWritingLab } = require('../writing-lab');
const express = require('express');
const os = require('node:os');
const client = fs.readFileSync(path.join(__dirname, '../public/writing-lab-client.js'), 'utf8');
function harness({ audioReadyState = 4 } = {}) {
  const nodes = new Map(), intervals = new Map(), recordings = [], requests = [], memory = new Map();
  let now = 100000, seq = 0;
  class Element {
    constructor(id) { this.id=id; this.parentElement=this; this.value=''; this.isConnected=true; this.textContent=''; this.disabled=false; this.classes=new Set(); this.events={};
      this.classList={add:c=>this.classes.add(c),remove:c=>this.classes.delete(c),toggle:c=>this.classes.has(c)?this.classes.delete(c):this.classes.add(c)}; }
    addEventListener(name,fn) { this.events[name]=fn; }
    focus() {} close() {} showModal() {}
    set innerHTML(html) {
      this.html=html;
      if(this.id!=='lab') return;
      for(const [id,node] of nodes) if(!['lab','notice','confirm-dialog'].includes(id)) { node.isConnected=false; nodes.delete(id); }
      for(const match of html.matchAll(/id="([^"]+)"/g)) nodes.set(match[1],new Element(match[1]));
      for(const match of html.matchAll(/<[^>]+id="([^"]+)"[^>]*>/g)) if(/\bdisabled\b/.test(match[0])) nodes.get(match[1]).disabled=true;
      for(const match of html.matchAll(/<textarea[^>]*id="([^"]+)"[^>]*>([^]*?)<\/textarea>/g)) nodes.get(match[1]).value=match[2];
    }
    get innerHTML() { return this.html||''; }
  }
  for(const id of ['lab','notice','confirm-dialog']) nodes.set(id,new Element(id));
  class Audio {
    constructor(url) { this.src=url; this.readyState=audioReadyState; this.currentTime=0; this.duration=80; this.paused=true; this.ended=false; this.plays=0; this.loads=0; recordings.push(this); }
    async play() { this.paused=false; this.plays++; }
    pause() { const changed=!this.paused; this.paused=true; if(changed) this.onpause?.(); }
    load() { this.loads++; this.error=null; this.readyState=0; }
  }
  class Clock extends Date { static now() { return now; } }
  const document={getElementById:id=>nodes.get(id)||null,body:new Element('body'),hidden:false,events:{},addEventListener(name,fn){this.events[name]=fn;}};
  const context={document,Audio,Date:Clock,console,AbortSignal,crypto:require('node:crypto').webcrypto,
    location:{pathname:'/writing-mocks'},navigator:{},
    localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},
    sessionStorage:{getItem:()=>null},
    setInterval:(fn,ms)=>{const id=++seq;intervals.set(id,{fn,ms});return id;},clearInterval:id=>intervals.delete(id),
    setTimeout:()=>++seq,clearTimeout:()=>{},
    fetch:async(url,options)=>{ requests.push({url,body:options.body?JSON.parse(options.body):null});
      const value=structuredClone(context.reply || context.window.testApi.current());
      if(context.replyOnce) {context.reply=null;context.replyOnce=false;}
      return {ok:true,json:async()=>value}; }
  };
  context.window={WritingLabReport:report,addEventListener(){},scrollTo(){}};
  vm.createContext(context);
  const instrumented=client.replace('  (async()=>{\n    try { const values=',`  window.testApi={set(value){username='tester';setAttempt(value);},current:()=>attempt,showAttempt,tick,writeDraft,renderResults,saveAnswer}; return;\n  (async()=>{\n    try { const values=`);
  vm.runInContext(instrumented,context);
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
  const response=await fetch(base+'/api/writing-lab/attempts',{method:'POST',headers:{'Content-Type':'application/json','x-session-token':'tester'},body:JSON.stringify({id,testId:bank.spoken[0].id})});
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

test('SST waits for playable audio, retries a failed load, and starts its timer only when the student can play',async()=>{
  const h=harness({audioReadyState:1}), a=attempt(3);
  Object.assign(a,{kind:'sst',status:'ready',deadline:null});
  open(h,a);
  const player=h.recordings[0], button=h.nodes.get('audio-start');
  player.onloadedmetadata();
  assert.equal(button.disabled,true);
  assert.equal(h.requests.length,0);
  player.error={code:2};player.onerror();
  assert.equal(button.textContent,'Retry audio');
  assert.equal(h.hooks.current().status,'ready');
  assert.equal(h.requests.length,0);
  await button.onclick();assert.equal(player.loads,1);
  player.readyState=4;player.oncanplay();
  assert.equal(button.disabled,false);
  assert.equal(h.requests.length,0);
  h.context.reply={...a,status:'active',deadline:700000};
  h.context.replyOnce=true;
  await button.onclick();await flush();
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
