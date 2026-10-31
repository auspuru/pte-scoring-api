'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createController,time}=require('../public/speaking-practice'),bank=require('../content/speaking-bank'),{present}=require('../speaking-lab');
function harness({includePredictions=false,audioCue=false}={}) {
  const nodes=new Map(),events={},intervals=new Map(),attempts=new Map(),requests=[],recorders=[],audio=[],storage=new Map();let seq=0,now=1000,stops=0,uid='alice';
  class Element {
    constructor(id){this.id=id;this.value='';this.dataset={};this.disabled=false;this.hidden=false;this.textContent='';nodes.set(id,this);}
    set innerHTML(value){this.html=value;if(this.id==='speakingPane'){for(const id of [...nodes.keys()])if(id!=='speakingPane')nodes.delete(id);for(const m of value.matchAll(/id="([^"]+)"/g))new Element(m[1]);}}
    get innerHTML(){return this.html||'';}replaceChildren(){this.innerHTML='';}
  }
  const host=new Element('speakingPane'),doc={hidden:false,getElementById:id=>nodes.get(id)||null,addEventListener:(name,fn)=>events[name]=fn};
  class Recorder {
    static isTypeSupported(t){return t==='audio/webm;codecs=opus';}
    constructor(stream,opts){this.state='inactive';this.mimeType=opts?.mimeType||'audio/webm';recorders.push(this);}
    start(){this.state='recording';this.startedAt=now;}
    stop(){if(this.state!=='recording')return;this.state='inactive';this.ondataavailable?.({data:new Blob([Buffer.alloc(300,2)],{type:this.mimeType})});this.onstop?.();}
  }
  class Audio {constructor(url){this.url=url;this.paused=true;audio.push(this);}async play(){this.paused=false;}pause(){this.paused=true;}}
  const env={document:doc,Date:{now:()=>now},Audio,MediaRecorder:Recorder,Blob,crypto:require('node:crypto').webcrypto,
    URL:{createObjectURL:()=> 'blob:recording-'+(++seq),revokeObjectURL(){}},navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>stops++}],getAudioTracks:()=>[]})}},
    sessionStorage:{getItem:()=>null},localStorage:{getItem:key=>key==='pte_session_token'?'local-test-token':storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    setInterval:fn=>{const id=++seq;intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id),addEventListener(){},switchSection(){}
  };
  env.fetch=async(url,options={})=>{
    requests.push({url,body:options.body});const route=url.replace('/api/speaking',''),parts=route.split('/').filter(Boolean),body=typeof options.body==='string'?JSON.parse(options.body):options.body;
    const reply=(data,ok=true)=>({ok,json:async()=>data,blob:async()=>new Blob([Buffer.alloc(300)])});
    if(route==='/catalog')return reply({types:bank.types,source:bank.source,questions:includePredictions?bank.questions:bank.questions.filter(q=>!q.predictionSource),transcriptionAvailable:true,deliveryAssessmentAvailable:true,deliveryVersion:'test-delivery',deliveryVersions:env.deliveryVersions||{}});
    if(route==='/attempts'&&!body)return reply([...attempts.values()].map(a=>({...a,title:bank.questions.find(q=>q.id===a.questionId).title,type:bank.questions.find(q=>q.id===a.questionId).type})));
    if(route==='/attempts'){const q=bank.questions.find(q=>q.id===body.questionId),a={id:body.id,questionId:body.questionId,practiceMode:body.practiceMode||'timed',...(q.type==='rts'?{questionSnapshot:structuredClone(q)}:{}),status:'draft',revision:0,transcript:'',startedAt:now};attempts.set(a.id,a);return reply(present(a));}
    const a=attempts.get(parts[1]);assert(a,route);
    if(parts[2]==='recording'&&body){if(env.rejectUpload)return reply({error:'Upload interrupted'},false);a.recording={mime:body.type||'audio/webm',data:Buffer.alloc(300).toString('base64')};}
    if(parts[2]==='transcript'){a.transcript=body.text;a.revision++;}
    if(parts[2]==='transcribe'){if(env.rejectTranscription)return reply({error:'Transcription unavailable'},false);a.transcript=bank.questions.find(q=>q.id===a.questionId).text;a.transcription=a.transcript;a.revision++;}
    if(parts[2]==='submit'){
      if(!a.transcript&&env.rejectTranscription)return reply({error:'Automatic transcription is temporarily unavailable.'},false);
      if(!a.transcript){a.transcript=bank.questions.find(q=>q.id===a.questionId).text;a.transcription=a.transcript;a.revision++;}
      a.status='submitted';a.result={total:3,maximum:3,overview:'Content checked.',scoringMode:env.contentFallback?'local':'ai',strengths:[],improvements:['Review with your teacher.'],deliveryVersion:'test-delivery'};
    }
    return reply(present(a));
  };
  const cueAudio=audioCue?require('./fixtures/speaking-audio-context')(env):null;
  const controller=createController(env,{getUserId:()=>uid});
  return {env,doc,host,nodes,controller,attempts,requests,recorders,audio,storage,events,cueAudio,stops:()=>stops,user:value=>uid=value,
    tick:milliseconds=>{now+=milliseconds;cueAudio?.run();for(const fn of [...intervals.values()])fn();},
    click:data=>host.onclick({target:{closest:()=>({dataset:data,disabled:false})}})};
}
async function flush(){for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));}
async function deliveryReport(h,result){
 await h.controller.open('rts');await h.click({speakingQuestion:bank.questions.find(q=>q.type==='rts').id});
 const a=[...h.attempts.values()][0];Object.assign(a,{status:'submitted',transcript:'A saved response explaining the technical problem and asking for an extension.',recording:{mime:'audio/webm',data:Buffer.alloc(300).toString('base64')},result:{total:6,maximum:6,overview:'Content assessed.',strengths:[],improvements:[],scoringMode:'ai',deliveryProvider:'azure-speech-pronunciation',deliveryVersion:'test-delivery',...result}});
 await h.click({speakingAttempt:a.id});return a;
}
test('An audio service failure never blames speech length, even with stale insufficient evidence',async()=>{
 for(const evidence of [undefined,{sufficient:false,spokenWords:2,durationSeconds:1}]){
  const h=harness();const a=await deliveryReport(h,{deliveryStatus:'Azure audio assessment temporarily unavailable',deliveryEvidence:evidence});
  assert.match(h.host.innerHTML,/Audio assessment unavailable/);assert.match(h.host.innerHTML,/Retry audio assessment/);
  assert.doesNotMatch(h.host.innerHTML,/Not enough speech|Spoken words|Audio <strong>/);
  assert.match(h.host.innerHTML,/Your recording and content feedback are saved/);assert.equal(a.result.total,6);
  h.controller.reset();
 }
});
test('Only explicit insufficient audio evidence displays the speech-length message',async()=>{
 const h=harness();await deliveryReport(h,{deliveryEvidence:{sufficient:false,spokenWords:2,durationSeconds:1},deliveryStatus:'Not enough speech for a reliable estimate.'});
 assert.match(h.host.innerHTML,/Not enough speech/);assert.doesNotMatch(h.host.innerHTML,/Retry audio assessment/);h.controller.reset();
 const unknown=harness();await deliveryReport(unknown,{});assert.match(unknown.host.innerHTML,/Audio assessment unavailable/);assert.doesNotMatch(unknown.host.innerHTML,/Not enough speech/);unknown.controller.reset();
});
test('Retry audio assessment reuses the saved attempt and recording without new capture or upload',async()=>{
 const h=harness(),a=await deliveryReport(h,{deliveryStatus:'Azure audio assessment temporarily unavailable'}),originalRecording=JSON.stringify(a.recording),recorders=h.recorders.length,request=h.env.fetch;
 const writes=h.requests.filter(r=>r.body).length;
 h.env.fetch=async(url,options={})=>{
  if(url.endsWith('/'+a.id+'/submit')){
   h.requests.push({url,body:options.body});
   a.result={...a.result,deliveryStatus:'Audio assessed',pronunciation:{score:4,maximum:5},fluency:{score:5,maximum:5}};
   return {ok:true,json:async()=>present(a)};
  }
  return request(url,options);
 };
 await h.click({speakingAction:'submit'});
 assert.equal(h.attempts.size,1);assert.equal(h.recorders.length,recorders);assert.equal(JSON.stringify(a.recording),originalRecording);assert.equal(a.result.total,6);
 assert.equal(h.requests.filter(r=>r.body).length,writes+1);assert.equal(h.requests.filter(r=>r.url.endsWith('/'+a.id+'/recording')&&r.body).length,0);
 assert.match(h.host.innerHTML,/Audio assessed/);assert.doesNotMatch(h.host.innerHTML,/Audio assessment unavailable|Not enough speech/);h.controller.reset();
});
test('Describe Image practice uses a matching clear file and retains the saved original as fallback',async()=>{
 const h=harness({includePredictions:true});await h.controller.open('di');await h.click({speakingQuestion:'di-pred-3000137'});
 const entry=require('../di-image-display').manifest.entries['di-pred-3000137'];assert(h.host.innerHTML.includes('src="'+entry.displayImageUrl+'"'));assert(h.host.innerHTML.includes('data-original-image="'+entry.originalImageUrl+'"'));
 assert.match(h.host.innerHTML,/Enlarge image/);assert.match(h.host.innerHTML,/Non-agricultural land/);assert.match(h.host.innerHTML,/speaking-image-dialog/);assert.equal(h.attempts.size,1);
 h.controller.reset();
});
test('Repeat Sentence practice waits for one beep, then records the complete 15-second response',async()=>{
 const h=harness({audioCue:true});await h.controller.open('rs');await h.click({speakingQuestion:'rs-1'});
 assert.equal(h.cueAudio.tones.length,0);assert.equal(h.recorders.length,0);
 const ended=h.audio[0].onended;ended();ended();assert.equal(h.cueAudio.tones.length,1);assert.equal(h.recorders.length,0);assert.equal(h.nodes.get('speaking-phase').textContent,'Get ready');
 h.tick(299);assert.equal(h.recorders.length,0);h.tick(1);assert.equal(h.recorders.length,1);
 assert(h.recorders[0].startedAt>=h.cueAudio.tones[0].stoppedAt*1000);h.tick(14999);assert.equal(h.recorders[0].state,'recording');h.tick(1);assert.equal(h.recorders[0].state,'inactive');await flush();
});
test('leaving practice during the beep prevents a late microphone start',async()=>{
 const h=harness({audioCue:true});await h.controller.open('rs');await h.click({speakingQuestion:'rs-1'});h.audio[0].onended();
 h.controller.leave();h.tick(1000);assert.equal(h.recorders.length,0);assert.equal(h.requests.filter(r=>r.url.endsWith('/recording')).length,0);
});

for(const type of ['rl','sgd','rts'])test(`${type}: only Azure scores are shown and opening a report never requests a reassessment`,async()=>{
 const h=harness(),version=require('../speaking-delivery').VERSION;h.env.deliveryVersions={[type]:version};
 await h.controller.open(type);await h.click({speakingQuestion:bank.questions.find(q=>q.type===type).id});
 const a=[...h.attempts.values()][0];a.status='submitted';a.transcript='A saved response.';a.result={total:6,maximum:6,overview:'Content assessed.',strengths:[],improvements:[],scoringMode:'ai',deliveryVersion:version,deliveryProvider:'azure-speech-pronunciation',pronunciation:{score:3,maximum:5},fluency:{score:4,maximum:5},deliveryComparisons:{gpt:{status:'assessed',pronunciation:{score:5},fluency:{score:5}}}};
 const before=h.requests.filter(r=>r.body).length;await h.click({speakingAttempt:a.id});assert.match(h.host.innerHTML,/Pronunciation/);assert.match(h.host.innerHTML,/Oral fluency/);assert.doesNotMatch(h.host.innerHTML,/GPT Audio|Compare audio scorers|Scores from both providers/);assert.equal(h.requests.filter(r=>r.body).length,before);
});

test('a saved Azure comparison supplies the report while older GPT snapshots stay hidden',async()=>{
 const h=harness();await h.controller.open('rts');await h.click({speakingQuestion:bank.questions.find(q=>q.type==='rts').id});const a=[...h.attempts.values()][0];a.status='submitted';a.transcript='A saved response.';
 a.result={total:6,maximum:6,overview:'Saved content.',strengths:[],improvements:[],scoringMode:'ai',deliveryVersion:'old-gpt',pronunciation:{score:1,maximum:5},fluency:{score:1,maximum:5},deliveryComparisons:{gpt:{status:'assessed',pronunciation:{score:1},fluency:{score:1}},azure:{status:'assessed',deliveryProvider:'azure-speech-pronunciation',deliveryVersion:'test-delivery',pronunciation:{score:5,maximum:5},fluency:{score:4,maximum:5}}}};
 const before=h.requests.filter(r=>r.body).length;await h.click({speakingAttempt:a.id});assert.doesNotMatch(h.host.innerHTML,/GPT Audio|Scores from both providers/);assert.equal(h.requests.filter(r=>r.body).length,before);assert.equal(a.result.pronunciation.score,1,'The original stored result stays intact.');
});

test('Leaving a result cancels pending comparison polling',async()=>{
  const h=harness();await h.controller.open('rl');await h.click({speakingQuestion:'rl-1'});
  const a=[...h.attempts.values()][0];a.status='submitted';a.transcript='A saved response.';
  a.result={total:6,maximum:6,overview:'Saved.',strengths:[],improvements:[],deliveryComparisons:{gpt:{status:'assessed',pronunciation:{score:5},fluency:{score:5}},azure:{status:'pending'}}};
  await h.click({speakingAttempt:a.id});h.controller.leave();const requests=h.requests.length;
  h.tick(3000);await flush();assert.equal(h.requests.length,requests);
});

test('Describe Image renders quoted Keep/Change/Try coaching safely and refreshes saved feedback without recording again',async()=>{
 const h=harness();await h.controller.open('di');await h.click({speakingQuestion:'di-1'});await h.click({speakingAction:'skip'});await h.click({speakingAction:'finish'});await flush();
 const a=[...h.attempts.values()][0],quote='<img src=x onerror=alert(1)> shows the main contrast.';
 a.transcript=quote;a.result={...a.result,scoringMode:'ai',strengths:['Duplicate generic advice'],improvements:['Duplicate generic advice'],coaching:{version:'older-version',priority:'relationship',strength:{quote,why:'The contrast is relevant.'},changes:[{quote,rewrite:'Heating uses more electricity than cooling.',why:'Connect the two categories directly.'}],revisedResponse:'Heating uses more electricity than cooling.',tip:'Connect the main categories.',nextTry:'Record one sentence comparing the two largest categories.'}};
 await h.click({speakingAttempt:a.id});
 assert.match(h.host.innerHTML,/Keep · Change · Try/);assert.match(h.host.innerHTML,/Try next/);assert.match(h.host.innerHTML,/Your improved response/);
 assert.match(h.host.innerHTML,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.doesNotMatch(h.host.innerHTML,/<img src=x/);assert.doesNotMatch(h.host.innerHTML,/Duplicate generic advice/);
 const uploads=h.requests.filter(r=>r.url.endsWith('/recording')&&r.body).length,recorders=h.recorders.length;
 await h.click({speakingAction:'refresh-di-feedback'});
 assert.deepEqual(JSON.parse(h.requests.filter(r=>r.url.endsWith('/submit')).at(-1).body),{background:true,refreshDescribeFeedback:true});
 assert.equal(h.requests.filter(r=>r.url.endsWith('/recording')&&r.body).length,uploads);assert.equal(h.recorders.length,recorders);
 assert.match(h.host.innerHTML,/Image coaching could not be completed/);
});

test('Read Aloud opens directly in timed preparation with Skip preparation as the only normal control',async()=>{
  const h=harness();await h.controller.open('ra');assert.equal((h.nodes.get('speaking-library-list').innerHTML.match(/data-speaking-question=/g)||[]).length,5);
  await h.click({speakingQuestion:'ra-1'});
  assert.equal(h.nodes.get('speaking-phase').textContent,'Preparation');
  assert.equal(h.nodes.get('speaking-skip').hidden,false);
  assert.equal(h.nodes.get('speaking-record').hidden,true);
  assert.equal(h.nodes.get('speaking-assess-retry').hidden,true);
  assert.equal(h.nodes.get('speaking-upload-retry').hidden,true);
  assert.equal(h.nodes.get('speaking-finish').hidden,true);
  assert.doesNotMatch(h.host.innerHTML,/Stop recording|Confirm what you said|Audio file under 3 MB|Save transcript/);
  assert.match(h.host.innerHTML,/My questions/);
  await h.click({speakingAction:'skip'});assert.equal(h.recorders[0].state,'recording');
  assert.equal(h.nodes.get('speaking-skip').hidden,true);
  h.tick(40001);await flush();
  assert.equal(h.recorders[0].state,'inactive');assert.equal([...h.attempts.values()][0].status,'submitted');
  assert.match(h.host.innerHTML,/Your result/);assert.match(h.host.innerHTML,/Sample response/);assert.match(h.host.innerHTML,/My questions/);
});

test('Submit response ends recording early, saves the audio and starts scoring immediately',async()=>{
  const h=harness();await h.controller.open('ra');await h.click({speakingQuestion:'ra-1'});await h.click({speakingAction:'skip'});
  assert.equal(h.recorders[0].state,'recording');assert.equal(h.nodes.get('speaking-finish').hidden,false);
  h.tick(12000);await h.click({speakingAction:'finish'});await flush();
  assert.equal(h.recorders[0].state,'inactive');assert.equal([...h.attempts.values()][0].status,'submitted');
  assert(h.requests.some(r=>r.url.endsWith('/recording')&&r.body));assert(h.requests.some(r=>r.url.endsWith('/submit')));
  assert.match(h.host.innerHTML,/Your result/);
});

test('Preparation expiry opens the microphone automatically without a second click',async()=>{
  const h=harness();await h.controller.open('di');await h.click({speakingQuestion:'di-1'});
  assert.equal(h.recorders.length,0);assert.equal(h.nodes.get('speaking-phase').textContent,'Preparation');
  h.tick(25001);assert.equal(h.recorders[0].state,'recording');assert.equal(h.nodes.get('speaking-phase').textContent,'● Recording');
});

test('Repeat Sentence hides the transcript prompt, plays once automatically, then records and submits automatically',async()=>{
  const h=harness();await h.controller.open('rs');await h.click({speakingQuestion:'rs-1'});
  assert.doesNotMatch(h.host.innerHTML,/university library will remain/);
  assert.equal(h.audio.length,1);assert.equal(h.nodes.get('speaking-phase').textContent,'Listening');assert.equal(h.recorders.length,0);
  h.audio[0].onended();assert.equal(h.recorders[0].state,'recording');
  h.tick(15001);await flush();
  const a=[...h.attempts.values()][0];assert.equal(a.status,'submitted');assert.match(h.host.innerHTML,/Content checked/);
  assert(h.requests.some(r=>r.url.endsWith('/submit')));
});

test('Audio-prompt tasks show Skip preparation only after the prompt has finished',async()=>{
  const h=harness();await h.controller.open('rl');await h.click({speakingQuestion:'rl-1'});
  assert.equal(h.nodes.get('speaking-skip').hidden,true);h.audio[0].onended();
  assert.equal(h.nodes.get('speaking-phase').textContent,'Preparation');assert.equal(h.nodes.get('speaking-skip').hidden,false);
  await h.click({speakingAction:'skip'});assert.equal(h.recorders[0].state,'recording');
});

test('Leaving during recording saves the captured response rather than exposing manual practice controls',async()=>{
  const h=harness();await h.controller.open('ra');await h.click({speakingQuestion:'ra-1'});const id=[...h.attempts.keys()][0];
  await h.click({speakingAction:'skip'});h.controller.leave();await flush();
  assert.equal(h.recorders[0].state,'inactive');assert(h.attempts.get(id).recording);
});

test('A denied microphone exposes only a technical retry path, not transcript or upload fallbacks',async()=>{
  const h=harness();h.env.navigator.mediaDevices.getUserMedia=async()=>{throw Object.assign(Error('denied'),{name:'NotAllowedError'});};
  await h.controller.open('di');await h.click({speakingQuestion:'di-1'});
  assert.match(h.nodes.get('speaking-notice').textContent,/not allowed/);assert.equal(h.nodes.get('speaking-record').hidden,false);
  assert.doesNotMatch(h.host.innerHTML,/textarea|type="file"|Confirm what you said/);
});

test('Failed recording uploads keep the captured response and offer only retry saving',async()=>{
  const h=harness();h.env.rejectUpload=true;await h.controller.open('ra');await h.click({speakingQuestion:'ra-1'});await h.click({speakingAction:'skip'});
  h.tick(40001);await flush();
  assert.equal(h.nodes.get('speaking-upload-retry').hidden,false);
  assert(!h.requests.some(r=>r.url.endsWith('/submit')));
  h.env.rejectUpload=false;await h.click({speakingAction:'upload-retry'});await flush();
  assert.equal([...h.attempts.values()][0].status,'submitted');
});

test('A hidden tab interrupts preparation and requires a technical restart instead of continuing the countdown',async()=>{
  const h=harness();await h.controller.open('ra');await h.click({speakingQuestion:'ra-1'});
  h.doc.hidden=true;h.events.visibilitychange();h.tick(40000);
  assert.equal(h.recorders.length,0);assert.equal(h.nodes.get('speaking-record').hidden,false);assert.match(h.nodes.get('speaking-notice').textContent,/interrupted/);
});

test('Countdown labels round up consistently at minute boundaries',()=>{assert.equal(time(59.9),'1:00');assert.equal(time(120),'2:00');assert.equal(time(-1),'0:00');});

test('Question navigation is available during preparation and after submission',async()=>{
  const h=harness();await h.controller.open('ra');await h.click({speakingQuestion:'ra-1'});
  assert.match(h.host.innerHTML,/Question 1 of 5/);assert.match(h.host.innerHTML,/Next →/);
  await h.click({speakingAction:'skip'});h.tick(40001);await flush();
  assert.match(h.host.innerHTML,/Question 1 of 5/);assert.match(h.host.innerHTML,/Next →/);
});

test('Recorder retries a supported MP4 format when the advertised WebM encoder fails',async()=>{
 const h=harness(),Base=h.env.MediaRecorder,formats=[];
 h.env.MediaRecorder=class extends Base {static isTypeSupported(){return true;}constructor(stream,options){formats.push(options?.mimeType);if(options?.mimeType?.startsWith('audio/webm'))throw Error('Encoder unavailable');super(stream,options);}};
 await h.controller.open('ra');await h.click({speakingQuestion:'ra-1'});await h.click({speakingAction:'skip'});
 assert.equal(h.recorders[0].mimeType,'audio/mp4');assert.equal(h.recorders[0].state,'recording');assert.deepEqual(formats,['audio/webm;codecs=opus','audio/mp4']);
 h.tick(40001);await flush();
 const upload=h.requests.find(r=>r.url.endsWith('/recording')&&r.body);assert.equal(upload.body.type,'audio/mp4');assert.equal([...h.attempts.values()][0].status,'submitted');
});

test('A recorder start failure becomes a retryable technical error instead of exposing alternate answer entry',async()=>{
 const h=harness(),Base=h.env.MediaRecorder;
 h.env.MediaRecorder=class extends Base {start(){throw Error('Cannot start encoder');}};
 await h.controller.open('ra');await h.click({speakingQuestion:'ra-1'});await h.click({speakingAction:'skip'});
 assert.equal(h.nodes.get('speaking-record').hidden,false);assert.match(h.nodes.get('speaking-notice').textContent,/could not start recording/);assert(h.stops()>0);
 assert.doesNotMatch(h.host.innerHTML,/textarea|type="file"/);
});

test('An unanswered microphone permission prompt times out and a late grant cannot hijack a restarted attempt',async()=>{
 const h=harness();let resolve,oldStops=0;
 h.env.navigator.mediaDevices.getUserMedia=()=>new Promise(r=>resolve=r);
 await h.controller.open('ra');const pending=h.click({speakingQuestion:'ra-1'});await flush();
 h.tick(21000);assert.equal(h.nodes.get('speaking-record').hidden,false);assert.match(h.nodes.get('speaking-notice').textContent,/still waiting/);
 h.env.navigator.mediaDevices.getUserMedia=async()=>({getTracks:()=>[{stop(){}}],getAudioTracks:()=>[]});
 await h.click({speakingAction:'record'});await h.click({speakingAction:'skip'});
 resolve({getTracks:()=>[{stop(){oldStops++;}}],getAudioTracks:()=>[]});await pending;
 assert.equal(oldStops,1);assert.equal(h.recorders[0].state,'recording');
});

test('A mobile autoplay denial keeps the microphone ready and exposes one Play prompt recovery action',async()=>{
 const h=harness(),Base=h.env.Audio;let grants=0;const acquire=h.env.navigator.mediaDevices.getUserMedia;
 h.env.navigator.mediaDevices.getUserMedia=()=>{grants++;return acquire();};
 h.env.Audio=class extends Base {async play(){if(h.audio.length===1)throw Object.assign(Error('Gesture required'),{name:'NotAllowedError'});return super.play();}};
 await h.controller.open('rs');await h.click({speakingQuestion:'rs-1'});
 assert.match(h.nodes.get('speaking-notice').textContent,/blocked automatic prompt audio/);assert.equal(h.nodes.get('speaking-record').hidden,false);assert.equal(h.nodes.get('speaking-record').textContent,'Play prompt');
 await h.click({speakingAction:'record'});assert.equal(grants,1);h.audio[1].onended();assert.equal(h.recorders[0].state,'recording');
 h.tick(15001);await flush();assert.equal([...h.attempts.values()][0].status,'submitted');
});

test('A completed timed recording is transcribed and assessed without showing an editable transcript first',async()=>{
 const h=harness();await h.controller.open('ra');await h.click({speakingQuestion:'ra-1'});await h.click({speakingAction:'skip'});
 assert.doesNotMatch(h.host.innerHTML,/speaking-transcript|Confirm what you said/);
 h.tick(40001);await flush();
 assert(h.requests.some(r=>r.url.endsWith('/submit')));assert.equal([...h.attempts.values()][0].status,'submitted');
 assert.match(h.host.innerHTML,/Transcript/);
});

test('Assessment failure preserves the saved recording and offers Retry assessment',async()=>{
 const h=harness();h.env.rejectTranscription=true;await h.controller.open('rs');await h.click({speakingQuestion:'rs-1'});h.audio[0].onended();
 h.tick(15001);await flush();
 const a=[...h.attempts.values()][0];assert(a.recording);assert.equal(a.status,'draft');assert.equal(h.nodes.get('speaking-assess-retry').hidden,false);
 assert.match(h.host.innerHTML,/recording is saved/i);
 h.env.rejectTranscription=false;await h.click({speakingAction:'submit'});await flush();assert.equal(a.status,'submitted');assert.match(h.host.innerHTML,/Your result/);
});


test('Image filters and search intersect without starting an attempt or requesting audio',async()=>{
  const h=harness();await h.controller.open('di');
  assert.match(h.host.innerHTML,/Line graph/);assert.match(h.host.innerHTML,/Random image \/ photograph/);
  await h.host.onchange({target:{id:'speaking-image-category',value:'line'}});
  assert.match(h.nodes.get('speaking-library-list').innerHTML,/di-3/);
  assert.doesNotMatch(h.nodes.get('speaking-library-list').innerHTML,/di-1/);
  assert.equal(h.nodes.get('speaking-match-count').textContent,'1 of 5 questions');
  h.host.oninput({target:{id:'speaking-search',value:'budget'}});
  assert.match(h.nodes.get('speaking-library-list').innerHTML,/No questions match/);
  await h.click({speakingAction:'clear-filters'});
  assert.equal(h.nodes.get('speaking-match-count').textContent,'5 of 5 questions');
  assert.equal(h.attempts.size,0);assert.equal(h.recorders.length,0);
});

test('Question filters survive task changes and are cleared when the account changes',async()=>{
  const h=harness();await h.controller.open('di');
  await h.host.onchange({target:{id:'speaking-image-category',value:'pie'}});
  await h.controller.open('rts');assert.doesNotMatch(h.host.innerHTML,/id="speaking-image-category"/);
  await h.controller.open('di');assert.equal(h.nodes.get('speaking-match-count').textContent,'1 of 5 questions');
  h.user('bob');await h.controller.open('di');assert.equal(h.nodes.get('speaking-match-count').textContent,'5 of 5 questions');
});

test('Every catalogue page is reachable and search resets pagination',async()=>{
  const h=harness(),fetch=h.env.fetch;
  h.env.fetch=async(url,options)=>{if(url.endsWith('/catalog'))return {ok:true,json:async()=>({types:bank.types,questions:Array.from({length:45},(_,i)=>({id:'di-page-'+(i+1),type:'di',title:'Image '+(i+1),imageCategory:'line'}))})};return fetch(url,options);};
  await h.controller.open('di');
  assert.equal((h.nodes.get('speaking-library-list').innerHTML.match(/data-speaking-question=/g)||[]).length,20);
  await h.click({speakingPage:'2'});
  assert.match(h.nodes.get('speaking-library-list').innerHTML,/di-page-45/);
  assert.equal((h.nodes.get('speaking-library-list').innerHTML.match(/data-speaking-question=/g)||[]).length,5);
  h.host.oninput({target:{id:'speaking-search',value:'di-page-1'}});
  assert.match(h.nodes.get('speaking-library-list').innerHTML,/di-page-1"/);
  assert.equal(h.nodes.get('speaking-match-count').textContent,'11 of 45 questions');
});

test('Filtered result navigation stays within the selected image category',async()=>{
  const h=harness();await h.controller.open('di');
  await h.host.onchange({target:{id:'speaking-image-category',value:'line'}});
  await h.click({speakingQuestion:'di-3'});
  const next={dataset:{speakingMove:'1'},disabled:false},back={dataset:{speakingMove:'-1'},disabled:false};
  h.host.querySelectorAll=selector=>selector.includes('[data-speaking-move]')&&h.host.innerHTML.includes('data-speaking-move')?[next,back]:[];
  await h.click({speakingAction:'skip'});h.tick(41000);await flush();
  assert.equal(next.disabled,true);assert.equal(back.disabled,true);
  assert.match(h.host.innerHTML,/Question 1 of 1/);
  await h.click({speakingMove:'1'});assert.equal(h.attempts.size,1);
  await h.click({speakingAction:'list'});assert.equal(h.nodes.get('speaking-match-count').textContent,'1 of 5 questions');
});

test('Unknown visual kinds are never guessed to be photographs; aliases and source IDs are searchable',()=>{
  const {imageCategory,filterQuestions}=require('../public/speaking-practice');
  assert.equal(imageCategory({type:'di',visual:{kind:'new-format'}}),'unclassified');
  assert.equal(imageCategory({type:'di',imageCategory:'constructor'}),'unclassified');
  assert.equal(imageCategory({type:'di',imageCategory:'random image'}),'photo');
  assert.equal(imageCategory({type:'di',imageCategory:'pie chart'}),'pie');
  const rows=[{id:'di-import-1',type:'di',imageCategory:'process-chart',predictionSource:{sourceId:'321'}},{id:'ra-1',type:'ra',title:'321'}];
  assert.deepEqual(filterQuestions(rows,'di',{search:'321',category:'process'}),[rows[0]]);
});

 test('Supplied weekly DI items intersect with chart filters and search and clear correctly',async()=>{
 const h=harness({includePredictions:true});await h.controller.open('di');
 await h.host.onchange({target:{id:'speaking-prediction',value:'weekly'}});
 assert.equal(h.nodes.get('speaking-match-count').textContent,'49 of 54 questions');
 await h.host.onchange({target:{id:'speaking-image-category',value:'photo'}});
 assert.equal(h.nodes.get('speaking-match-count').textContent,'4 of 54 questions');
 h.host.oninput({target:{id:'speaking-search',value:'3000125'}});
 assert.equal(h.nodes.get('speaking-match-count').textContent,'1 of 54 questions');
 assert.match(h.nodes.get('speaking-library-list').innerHTML,/Weekly Prediction/);
 await h.click({speakingAction:'clear-filters'});
 assert.equal(h.nodes.get('speaking-match-count').textContent,'54 of 54 questions');
 assert.equal(h.attempts.size,0);
 });
test('Skipping preparation opens the next question without submitting an empty attempt',async()=>{
 const h=harness();await h.controller.open('di');await h.click({speakingQuestion:'di-1'});
 await h.click({speakingMove:'1'});h.tick(1000);await flush();
 assert.match(h.host.innerHTML,/Question 2 of/);assert.equal(h.recorders.length,0);
 assert(!h.requests.some(r=>r.url.endsWith('/submit')||r.url.endsWith('/recording')));
 await h.click({speakingMove:'-1'});assert.match(h.host.innerHTML,/Question 1 of/);
});

test('Next during recording saves the audio and stops the old timer',async()=>{
 const h=harness();await h.controller.open('ra');await h.click({speakingQuestion:'ra-1'});await h.click({speakingAction:'skip'});
 await h.click({speakingMove:'1'});await flush();
 assert.equal(h.recorders[0].state,'inactive');assert.match(h.host.innerHTML,/Question 2 of/);
 assert(h.requests.some(r=>r.url.endsWith('/recording')&&r.body));
 const saved=[...h.attempts.values()][0];assert(saved.recording);assert.equal(saved.status,'submitted');
 const submissions=h.requests.filter(r=>r.url.endsWith('/submit')).length;
 await h.click({speakingMove:'-1'});assert.match(h.host.innerHTML,/Question 1 of/);
 assert.equal(h.requests.filter(r=>r.url.endsWith('/submit')).length,submissions);assert.match(h.nodes.get('speaking-playback').innerHTML,/audio controls/);
});

test('Respond now stops the situation audio and starts exactly one recording',async()=>{
 const h=harness();await h.controller.open('rts');await h.click({speakingQuestion:'rts-1'});
 assert.equal(h.nodes.get('speaking-respond').hidden,false);const ended=h.audio[0].onended;
 await h.click({speakingAction:'respond'});assert.equal(h.audio[0].paused,true);
 assert.equal(h.nodes.get('speaking-phase').textContent,'● Recording');assert.equal(h.nodes.get('speaking-respond').hidden,true);
 ended();h.tick(1000);assert.equal(h.recorders.length,1);
 await h.click({speakingAction:'finish'});await flush();assert.equal([...h.attempts.values()][0].status,'submitted');
});

test('Skipping a listening question ignores late audio completion',async()=>{
 const h=harness();await h.controller.open('rts');await h.click({speakingQuestion:'rts-1'});const ended=h.audio[0].onended;
 await h.click({speakingMove:'1'});ended();assert.equal(h.audio[0].paused,true);
 assert.match(h.host.innerHTML,/Question 2 of/);assert.equal(h.nodes.get('speaking-phase').textContent,'Listening');assert.equal(h.recorders.length,0);
});

test('Question list remains accessible on the last unattempted question',async()=>{
 const h=harness();await h.controller.open('di');await h.click({speakingQuestion:'di-5'});
 await h.click({speakingAction:'list'});assert.match(h.host.innerHTML,/speaking-question-list/);assert.equal(h.recorders.length,0);
});


test('Content retry reports continued fallback and successful recovery without another upload',async()=>{
  const h=harness();h.env.contentFallback=true;
  await h.controller.open('di');await h.click({speakingQuestion:'di-1'});
  await h.click({speakingAction:'skip'});h.tick(40001);await flush();
  assert.match(h.host.innerHTML,/Retry content review/);
  const uploads=h.requests.filter(r=>r.url.endsWith('/recording')&&r.body).length;
  await h.click({speakingAction:'submit'});
  assert.match(h.host.innerHTML,/still unavailable/);
  h.env.contentFallback=false;await h.click({speakingAction:'submit'});
  assert.match(h.host.innerHTML,/Content review completed/);
  assert.equal(h.requests.filter(r=>r.url.endsWith('/recording')&&r.body).length,uploads);
  assert.match(h.host.innerHTML,/Improve everyday pronunciation and fluency/);
});

test('Saved local full marks display pending content while preserving audio coaching', async () => {
  const h=harness();h.env.contentFallback=true;
  const request=h.env.fetch;
  h.env.fetch=async(...args)=>{
    const response=await request(...args),json=response.json;
    response.json=async()=>{
      const data=await json();
      if(data.result){
        data.result={...data.result,total:6,maximum:6,scoringMode:'local',overview:'Fully covered.',
          strengths:['Every point covered.'],coverage:[{point:'Sales rose.',status:'covered',evidence:'Sales fell.',feedback:'Fully covered.'}],
          pronunciation:{score:4,maximum:5,descriptor:'Clear delivery',coaching:'Stress the key topic words.'},
          fluency:{score:4,maximum:5,descriptor:'Steady delivery',coaching:'Pause between related ideas.'}};
      }
      return data;
    };
    return response;
  };
  await h.controller.open('di');await h.click({speakingQuestion:'di-1'});
  await h.click({speakingAction:'skip'});h.tick(40001);await flush();
  assert.match(h.host.innerHTML,/speaking-metric content is-pending/);
  assert.match(h.host.innerHTML,/Content review pending/);
  assert.match(h.host.innerHTML,/Stress the key topic words/);
  assert.match(h.host.innerHTML,/Pause between related ideas/);
  assert.doesNotMatch(h.host.innerHTML,/Fully covered|Every point covered|Content strengths/);
});


test('Next stays on the captured response when upload fails and retry preserves the recording',async()=>{
 const h=harness();h.env.rejectUpload=true;await h.controller.open('ra');await h.click({speakingQuestion:'ra-1'});await h.click({speakingAction:'skip'});
 await h.click({speakingMove:'1'});await flush();assert.match(h.host.innerHTML,/Question 1 of/);
 assert.equal(h.nodes.get('speaking-upload-retry').hidden,false);assert.equal(h.requests.filter(r=>r.url.endsWith('/submit')).length,0);
 h.env.rejectUpload=false;await h.click({speakingAction:'upload-retry'});await flush();await h.click({speakingMove:'1'});
 assert.match(h.host.innerHTML,/Question 2 of/);assert([...h.attempts.values()][0].recording);
});

test('Resume opens a saved draft for playback without submitting it',async()=>{
 const h=harness();await h.controller.open('ra');await h.click({speakingQuestion:'ra-1'});
 const a=[...h.attempts.values()][0];a.recording={mime:'audio/webm',data:Buffer.alloc(300).toString('base64')};
 await h.click({speakingAttempt:a.id});assert.equal(h.requests.filter(r=>r.url.endsWith('/submit')).length,0);
 assert.equal(h.recorders.length,0);assert.match(h.nodes.get('speaking-playback').innerHTML,/audio controls/);
 assert.equal(h.nodes.get('speaking-assess-retry').textContent,'Submit saved recording');
});

test('A background assessment cannot delay Next or replace the next question',async()=>{
 const h=harness(),request=h.env.fetch;let finish;
 h.env.fetch=async(url,options={})=>{
  if(url.endsWith('/submit')){h.requests.push({url,body:options.body});return new Promise(resolve=>{finish=()=>resolve({ok:true,json:async()=>({ ...present([...h.attempts.values()][0]),assessment:{status:'pending'} })});});}
  return request(url,options);
 };
 await h.controller.open('ra');await h.click({speakingQuestion:'ra-1'});await h.click({speakingAction:'skip'});
 await Promise.all([h.click({speakingMove:'1'}),h.click({speakingMove:'1'})]);await flush();
 assert.match(h.host.innerHTML,/Question 2 of/);assert.equal(h.attempts.size,2);assert.equal(h.requests.filter(r=>r.url.endsWith('/submit')).length,1);
 finish();await flush();assert.match(h.host.innerHTML,/Question 2 of/);h.controller.reset();
});

test('NAV-08: Adjacent Speaking moves reuse one account-scoped history index',async()=>{
 const h=harness();await h.controller.open('ra');await h.click({speakingQuestion:'ra-1'});
 const reads=()=>h.requests.filter(r=>r.url==='/api/speaking/attempts'&&!r.body).length,before=reads();
 await h.click({speakingMove:'1'});await h.click({speakingMove:'1'});assert.equal(reads(),before);
 const count=h.attempts.size;await h.click({speakingMove:'-1'});assert.equal(h.attempts.size,count);assert.match(h.host.innerHTML,/<h2>Question 2<\/h2>/);
 h.controller.reset();
});
test('NAV-09: Opening a copied Speaking question link never creates an attempt or opens the microphone',async()=>{
 const h=harness();await h.controller.open('ra','ra-1',{navigation:true});
 assert.equal(h.attempts.size,0);assert.equal(h.recorders.length,0);assert.match(h.host.innerHTML,/Start question/);
 assert(!h.requests.some(r=>r.body));h.controller.reset();
});


test('Untimed practice waits for manual recording and stays active beyond the timed task limits',async()=>{
 const h=harness();await h.controller.open('ra');assert.match(h.host.innerHTML,/Timed practice/);assert.match(h.host.innerHTML,/Untimed practice/);
 await h.click({speakingMode:'untimed'});await h.click({speakingQuestion:'ra-1'});
 assert.equal([...h.attempts.values()][0].practiceMode,'untimed');assert.equal(h.nodes.get('speaking-phase').textContent,'Ready when you are');assert.equal(h.nodes.get('speaking-clock').textContent,'Untimed');
 h.tick(120000);assert.equal(h.recorders.length,0);await h.click({speakingAction:'ready-record'});assert.equal(h.recorders[0].state,'recording');
 h.tick(120000);assert.equal(h.recorders[0].state,'recording');assert(!h.requests.some(r=>r.url.endsWith('/recording')&&r.body));
 await h.click({speakingAction:'finish'});await flush();assert.equal([...h.attempts.values()][0].status,'submitted');assert.match(h.host.innerHTML,/Untimed practice/);h.controller.reset();
});
test('Untimed RTS loads its saved situation audio and replay never starts a recorder',async()=>{
 const h=harness();await h.controller.open('rts');await h.click({speakingMode:'untimed'});await h.click({speakingQuestion:'rts-original-20261024-01'});
 const a=[...h.attempts.values()][0];assert(h.requests.some(r=>r.url==='/api/speaking/attempts/'+a.id+'/prompt'));assert.equal(h.audio.length,1);assert.equal(h.audio[0].paused,false);assert.equal(h.recorders.length,0);
 h.audio[0].onended();h.tick(120000);assert.equal(h.nodes.get('speaking-ready-start').hidden,false);assert.equal(h.recorders.length,0);
 await h.click({speakingAction:'replay-prompt'});assert.equal(h.audio.length,2);assert.equal(h.requests.filter(r=>r.url.endsWith('/prompt')).length,1);h.audio[1].onended();assert.equal(h.recorders.length,0);
 await h.click({speakingAction:'ready-record'});assert.equal(h.recorders.length,1);h.controller.reset();await flush();
});
test('Timed text-only RTS waits for prompt playback then gives the full preparation countdown',async()=>{
 const h=harness();await h.controller.open('rts');await h.click({speakingQuestion:'rts-original-20261024-02'});h.tick(60000);assert.equal(h.nodes.get('speaking-phase').textContent,'Listening');assert.equal(h.recorders.length,0);
 h.audio[0].onended();assert.equal(h.nodes.get('speaking-clock').textContent,'0:10');h.tick(9999);assert.equal(h.recorders.length,0);h.tick(2);assert.equal(h.recorders.length,1);assert.equal(h.nodes.get('speaking-clock').textContent,'0:40');h.controller.reset();await flush();
});
test('Mode-specific navigation does not resume a timed attempt as untimed, and preference is account scoped',async()=>{
 const h=harness();await h.controller.open('ra');await h.click({speakingQuestion:'ra-2'});const timed=[...h.attempts.values()][0];await h.click({speakingAction:'list'});
 await h.click({speakingMode:'untimed'});await h.click({speakingQuestion:'ra-1'});await h.click({speakingMove:'1'});
 const attempts=[...h.attempts.values()];assert.equal(attempts.length,3);assert.equal(attempts.at(-1).questionId,'ra-2');assert.equal(attempts.at(-1).practiceMode,'untimed');assert.equal(timed.practiceMode,'timed');
 h.controller.reset();h.user('bob');await h.controller.open('ra');await h.click({speakingQuestion:'ra-1'});assert.equal([...h.attempts.values()].at(-1).practiceMode,'timed');h.controller.reset();
});
test('A failed RTS prompt keeps recording stopped and exposes a retry action',async()=>{
 const h=harness(),request=h.env.fetch;h.env.fetch=(url,opts)=>url.endsWith('/prompt')?Promise.resolve({ok:false}):request(url,opts);
 await h.controller.open('rts');await h.click({speakingQuestion:'rts-original-20261024-03'});assert.equal(h.recorders.length,0);assert.equal(h.nodes.get('speaking-record').hidden,false);assert.match(h.nodes.get('speaking-notice').textContent,/prompt.*retry/i);h.controller.reset();
});
