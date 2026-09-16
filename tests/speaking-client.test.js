'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createController,time}=require('../public/speaking-practice'),bank=require('../content/speaking-bank'),{present}=require('../speaking-lab');
function harness() {
  const nodes=new Map(),events={},intervals=new Map(),attempts=new Map(),requests=[],recorders=[],audio=[],storage=new Map();let seq=0,now=1000,stops=0,uid='alice';
  class Element {
    constructor(id){this.id=id;this.value='';this.dataset={};this.disabled=false;this.hidden=false;nodes.set(id,this);}
    set innerHTML(value){this.html=value;if(this.id==='speakingPane'){for(const id of [...nodes.keys()])if(id!=='speakingPane')nodes.delete(id);for(const m of value.matchAll(/id="([^"]+)"/g))new Element(m[1]);for(const m of value.matchAll(/<textarea[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g))nodes.get(m[1]).value=m[2];}}
    get innerHTML(){return this.html||'';}replaceChildren(){this.innerHTML='';}
  }
  const host=new Element('speakingPane'),doc={hidden:false,getElementById:id=>nodes.get(id)||null,addEventListener:(name,fn)=>events[name]=fn};
  class Recorder {
    static isTypeSupported(t){return t==='audio/webm;codecs=opus';}
    constructor(stream,opts){this.state='inactive';this.mimeType=opts.mimeType;recorders.push(this);}
    start(){this.state='recording';}
    stop(){if(this.state!=='recording')return;this.state='inactive';this.ondataavailable({data:new Blob([Buffer.alloc(300,2)],{type:'audio/webm'})});this.onstop();}
  }
  class Audio {constructor(url){this.url=url;this.paused=true;audio.push(this);}async play(){this.paused=false;}pause(){this.paused=true;}}
  const env={document:doc,Date:{now:()=>now},Audio,MediaRecorder:Recorder,Blob,crypto:require('node:crypto').webcrypto,
    URL:{createObjectURL:()=> 'blob:recording-'+(++seq),revokeObjectURL(){}},navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>stops++}]})}},
    sessionStorage:{getItem:()=>null},localStorage:{getItem:key=>key==='pte_session_token'?'local-test-token':storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    setInterval:fn=>{const id=++seq;intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id),addEventListener(){},switchSection(){}
  };
  env.fetch=async(url,options={})=>{
    requests.push({url,body:options.body});const route=url.replace('/api/speaking',''),parts=route.split('/').filter(Boolean),body=typeof options.body==='string'?JSON.parse(options.body):options.body;
    const reply=(data,ok=true)=>({ok,json:async()=>data,blob:async()=>new Blob([Buffer.alloc(300)])});
    if(route==='/catalog')return reply({types:bank.types,source:bank.source,questions:bank.questions,transcriptionAvailable:true});
    if(route==='/attempts'&&!body)return reply([...attempts.values()].map(a=>({...a,title:bank.questions.find(q=>q.id===a.questionId).title,type:bank.questions.find(q=>q.id===a.questionId).type})));
    if(route==='/attempts'){const a={id:body.id,questionId:body.questionId,status:'draft',revision:0,transcript:'',startedAt:now};attempts.set(a.id,a);return reply(present(a));}
    const a=attempts.get(parts[1]);assert(a,route);
    if(parts[2]==='recording'&&body){if(env.rejectUpload)return reply({error:'Upload interrupted'},false);a.recording={mime:'audio/webm',data:Buffer.alloc(300).toString('base64')};}
    if(parts[2]==='transcript'){a.transcript=body.text;a.revision++;}
    if(parts[2]==='transcribe'){if(env.rejectTranscription)return reply({error:'Transcription unavailable'},false);a.transcript=bank.questions.find(q=>q.id===a.questionId).text;a.transcription=a.transcript;a.revision++;}
    if(parts[2]==='submit'){a.status='submitted';a.result={total:3,maximum:3,overview:'Content checked.',strengths:[],improvements:['Review with your teacher.']};}
    return reply(present(a));
  };
  const controller=createController(env,{getUserId:()=>uid});
  return {env,doc,host,nodes,controller,attempts,requests,recorders,audio,storage,events,stops:()=>stops,user:value=>uid=value,
    tick:milliseconds=>{now+=milliseconds;for(const fn of [...intervals.values()])fn();},
    click:data=>host.onclick({target:{closest:()=>({dataset:data,disabled:false})}})};
}
async function flush(){for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));}
test('Speaking question pages show five questions and enable recording after an attempt starts',async()=>{
  const h=harness();await h.controller.open('ra');assert.equal((h.host.innerHTML.match(/data-speaking-question=/g)||[]).length,5);
  await h.click({speakingQuestion:'ra-1'});assert.equal(h.nodes.get('speaking-record').disabled,false);assert.doesNotMatch(h.host.innerHTML,/Sample response/);
  await h.click({speakingAction:'record'});assert.equal(h.nodes.get('speaking-phase').textContent,'Prepare your response');
  await h.click({speakingAction:'skip'});assert.equal(h.recorders[0].state,'recording');h.tick(40001);await flush();
  assert.equal(h.recorders[0].state,'inactive');assert(h.stops()>0);assert([...h.attempts.values()][0].recording);assert.match(h.nodes.get('speaking-playback').innerHTML,/Download for teacher review/);
});
test('Repeat Sentence hides the prompt text, then records immediately after its audio',async()=>{
  const h=harness();await h.controller.open('rs');await h.click({speakingQuestion:'rs-1'});
  assert.doesNotMatch(h.host.innerHTML,/university library will remain/);await h.click({speakingAction:'record'});
  assert.equal(h.audio.length,1);assert.equal(h.recorders.length,0);h.audio[0].onended();assert.equal(h.recorders[0].state,'recording');
  h.tick(15001);await flush();assert.equal(h.recorders[0].state,'inactive');
  await h.click({speakingAction:'transcribe'});assert.match(h.nodes.get('speaking-transcript').value,/university library/);
  await h.click({speakingAction:'submit'});assert.match(h.host.innerHTML,/Sample response/);assert.match(h.host.innerHTML,/Content/);assert.doesNotMatch(h.host.innerHTML,/\/ 90/);
  await h.click({speakingQuestion:'rs-1'});assert.equal(h.attempts.size,2);assert.equal([...h.attempts.values()][0].status,'submitted');
});
test('Leaving during capture stops the microphone and saves the original attempt even after changing tasks',async()=>{
  const h=harness();await h.controller.open('ra');await h.click({speakingQuestion:'ra-1'});const id=[...h.attempts.keys()][0];
  await h.click({speakingAction:'record'});await h.click({speakingAction:'skip'});
  h.controller.leave();await h.controller.open('di');await flush();
  assert.equal(h.recorders[0].state,'inactive');assert(h.attempts.get(id).recording);assert.match(h.host.innerHTML,/Describe Image/);
});
test('A denied microphone leaves content-only manual entry available',async()=>{
  const h=harness();h.env.navigator.mediaDevices.getUserMedia=async()=>{throw Object.assign(Error('denied'),{name:'NotAllowedError'});};
  await h.controller.open('di');await h.click({speakingQuestion:'di-1'});await h.click({speakingAction:'record'});
  assert.match(h.nodes.get('speaking-notice').textContent,/not allowed/);assert.equal(h.nodes.get('speaking-record').disabled,false);
  h.nodes.get('speaking-transcript').value='The chart shows household energy use.';await h.click({speakingAction:'save'});
  assert.equal([...h.attempts.values()][0].transcript,'The chart shows household energy use.');
});
test('Failed recording uploads keep captured audio for retry and prevent premature assessment',async()=>{
  const h=harness();await h.controller.open('ra');await h.click({speakingQuestion:'ra-1'});await h.click({speakingAction:'record'});await h.click({speakingAction:'skip'});
  h.env.rejectUpload=true;await h.click({speakingAction:'stop'});await flush();assert.equal(h.nodes.get('speaking-upload-retry').hidden,false);
  await h.click({speakingAction:'submit'});assert(!h.requests.some(r=>r.url.endsWith('/submit')));
  h.env.rejectUpload=false;await h.click({speakingAction:'upload-retry'});assert([...h.attempts.values()][0].recording);
});
test('Hidden tabs and account resets release capture, and a new account never inherits a draft',async()=>{
  const h=harness();await h.controller.open('ra');await h.click({speakingQuestion:'ra-1'});await h.click({speakingAction:'record'});
  h.doc.hidden=true;h.events.visibilitychange();h.tick(40000);assert.equal(h.recorders.length,0);assert(h.stops()>0);
  h.doc.hidden=false;h.nodes.get('speaking-transcript').value='Private first-user draft';h.host.oninput();
  h.controller.reset();h.user('bob');await h.controller.open('ra');assert.doesNotMatch(h.host.innerHTML,/Private first-user draft/);assert(h.storage.size>0);
});
test('Countdown labels round up consistently at minute boundaries',()=>{assert.equal(time(59.9),'1:00');assert.equal(time(120),'2:00');assert.equal(time(-1),'0:00');});
test('Back and Next save transcripts and resume the same attempts without duplicates',async()=>{
  const h=harness();await h.controller.open('ra');await h.click({speakingQuestion:'ra-1'});
  h.nodes.get('speaking-transcript').value='A saved first response.';
  await h.click({speakingMove:'1'});assert.equal(h.attempts.size,2);assert.match(h.host.innerHTML,/Question 2 of 5/);
  await h.click({speakingMove:'-1'});assert.equal(h.attempts.size,2);assert.equal(h.nodes.get('speaking-transcript').value,'A saved first response.');
  await h.click({speakingAction:'record'});await h.click({speakingAction:'skip'});
  await h.click({speakingMove:'1'});assert.equal(h.recorders[0].state,'recording');assert.match(h.host.innerHTML,/Question 1 of 5/);
  assert.match(h.nodes.get('speaking-notice').textContent,/Finish and save/);
});
test('Recorder retries a supported MP4 format when the advertised WebM encoder fails',async()=>{
 const h=harness(),Base=h.env.MediaRecorder,formats=[];
 h.env.MediaRecorder=class extends Base {static isTypeSupported(){return true;}constructor(stream,options){formats.push(options?.mimeType);if(options?.mimeType?.startsWith('audio/webm'))throw Error('Encoder unavailable');super(stream,options);}};
 await h.controller.open('ra');await h.click({speakingQuestion:'ra-1'});await h.click({speakingAction:'record'});await h.click({speakingAction:'skip'});
 assert.equal(h.recorders[0].mimeType,'audio/mp4');assert.equal(h.recorders[0].state,'recording');assert.deepEqual(formats,['audio/webm;codecs=opus','audio/mp4']);
 await h.click({speakingAction:'stop'});await flush();
 const upload=h.requests.find(r=>r.url.endsWith('/recording')&&r.body);assert.equal(upload.body.type,'audio/mp4');assert([...h.attempts.values()][0].recording);
});
test('A recorder start failure becomes a retryable error rather than a stuck preparation screen',async()=>{
 const h=harness(),Base=h.env.MediaRecorder;
 h.env.MediaRecorder=class extends Base {start(){throw Error('Cannot start encoder');}};
 await h.controller.open('ra');await h.click({speakingQuestion:'ra-1'});await h.click({speakingAction:'record'});await h.click({speakingAction:'skip'});
 assert.equal(h.nodes.get('speaking-record').disabled,false);assert.equal(h.nodes.get('speaking-file').disabled,false);assert.match(h.nodes.get('speaking-notice').textContent,/could not start recording/);assert(h.stops()>0);
});
test('An unanswered microphone permission prompt times out and a late grant cannot hijack a new recording',async()=>{
 const h=harness();let resolve,oldStops=0;
 h.env.navigator.mediaDevices.getUserMedia=()=>new Promise(r=>resolve=r);
 await h.controller.open('ra');await h.click({speakingQuestion:'ra-1'});const pending=h.click({speakingAction:'record'});
 h.tick(21000);assert.equal(h.nodes.get('speaking-record').disabled,false);assert.match(h.nodes.get('speaking-notice').textContent,/still waiting/);
 h.env.navigator.mediaDevices.getUserMedia=async()=>({getTracks:()=>[{stop(){}}]});
 await h.click({speakingAction:'record'});await h.click({speakingAction:'skip'});
 resolve({getTracks:()=>[{stop(){oldStops++;}}]});await pending;
 assert.equal(oldStops,1);assert.equal(h.recorders[0].state,'recording');
 await h.click({speakingAction:'stop'});await flush();
});
test('Captured audio remains playable and downloadable when its upload fails',async()=>{
 const h=harness();h.env.rejectUpload=true;await h.controller.open('ra');await h.click({speakingQuestion:'ra-1'});await h.click({speakingAction:'record'});await h.click({speakingAction:'skip'});await h.click({speakingAction:'stop'});await flush();
 assert.match(h.nodes.get('speaking-playback').innerHTML,/<audio controls/);assert.match(h.nodes.get('speaking-playback').innerHTML,/Download for teacher review/);assert.equal(h.nodes.get('speaking-upload-retry').hidden,false);
});
test('A mobile autoplay denial keeps the microphone ready and retries playback on the next tap',async()=>{
 const h=harness(),Base=h.env.Audio;let grants=0;const acquire=h.env.navigator.mediaDevices.getUserMedia;
 h.env.navigator.mediaDevices.getUserMedia=()=>{grants++;return acquire();};
 h.env.Audio=class extends Base {async play(){if(h.audio.length===1)throw Object.assign(Error('Gesture required'),{name:'NotAllowedError'});return super.play();}};
 await h.controller.open('rs');await h.click({speakingQuestion:'rs-1'});await h.click({speakingAction:'record'});
 assert.match(h.nodes.get('speaking-notice').textContent,/Microphone ready/);assert.equal(h.nodes.get('speaking-record').disabled,false);
 await h.click({speakingAction:'record'});assert.equal(grants,1);h.audio[1].onended();assert.equal(h.recorders[0].state,'recording');
 await h.click({speakingAction:'stop'});await flush();assert([...h.attempts.values()][0].recording);
});

test('Stopping a recording transcribes it automatically before content submission',async()=>{
 const h=harness();await h.controller.open('rs');await h.click({speakingQuestion:'rs-1'});await h.click({speakingAction:'record'});h.audio[0].onended();
 await h.click({speakingAction:'stop'});await flush();
 assert([...h.attempts.values()][0].recording);assert(h.requests.some(r=>r.url.endsWith('/transcribe')));
 assert.match(h.nodes.get('speaking-transcript').value,/university library/);
 await h.click({speakingAction:'submit'});assert.match(h.host.innerHTML,/Content checked/);
});
test('Transcription failure preserves recording playback and offers transcription retry',async()=>{
 const h=harness();h.env.rejectTranscription=true;await h.controller.open('rs');await h.click({speakingQuestion:'rs-1'});await h.click({speakingAction:'record'});h.audio[0].onended();
 await h.click({speakingAction:'stop'});await flush();
 assert([...h.attempts.values()][0].recording);assert.match(h.nodes.get('speaking-playback').innerHTML,/<audio controls/);
 assert.equal(h.nodes.get('speaking-upload-retry').hidden,true);assert.equal(h.nodes.get('speaking-transcribe').disabled,false);
 assert.match(h.nodes.get('speaking-notice').textContent,/Recording saved.*Transcribe recording/);
 h.env.rejectTranscription=false;await h.click({speakingAction:'transcribe'});assert.match(h.nodes.get('speaking-transcript').value,/university library/);
});
