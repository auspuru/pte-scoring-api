'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createController,time}=require('../public/speaking-practice'),bank=require('../content/speaking-bank'),{present}=require('../speaking-lab');
function harness({includePredictions=false}={}) {
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
    start(){this.state='recording';}
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
    if(route==='/catalog')return reply({types:bank.types,source:bank.source,questions:includePredictions?bank.questions:bank.questions.filter(q=>!q.predictionSource),transcriptionAvailable:true,deliveryAssessmentAvailable:true,deliveryVersion:'test-delivery'});
    if(route==='/attempts'&&!body)return reply([...attempts.values()].map(a=>({...a,title:bank.questions.find(q=>q.id===a.questionId).title,type:bank.questions.find(q=>q.id===a.questionId).type})));
    if(route==='/attempts'){const a={id:body.id,questionId:body.questionId,status:'draft',revision:0,transcript:'',startedAt:now};attempts.set(a.id,a);return reply(present(a));}
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
  const controller=createController(env,{getUserId:()=>uid});
  return {env,doc,host,nodes,controller,attempts,requests,recorders,audio,storage,events,stops:()=>stops,user:value=>uid=value,
    tick:milliseconds=>{now+=milliseconds;for(const fn of [...intervals.values()])fn();},
    click:data=>host.onclick({target:{closest:()=>({dataset:data,disabled:false})}})};
}
async function flush(){for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));}

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
  await h.click({speakingQuestion:'di-3'});await h.click({speakingAction:'skip'});h.tick(41000);await flush();
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

test('Skipping during recording discards unfinished audio and stops the old timer',async()=>{
 const h=harness();await h.controller.open('ra');await h.click({speakingQuestion:'ra-1'});await h.click({speakingAction:'skip'});
 await h.click({speakingMove:'1'});await flush();
 assert.equal(h.recorders[0].state,'inactive');assert.match(h.host.innerHTML,/Question 2 of/);
 assert(!h.requests.some(r=>r.url.endsWith('/submit')||r.url.endsWith('/recording')));
 assert.equal([...h.attempts.values()][0].status,'draft');
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

test('A flagged-word replay seeks and pauses the saved audio without another upload',async()=>{
  const h=harness();await h.controller.open('ra');await h.click({speakingQuestion:'ra-1'});
  await h.click({speakingAction:'skip'});await h.click({speakingAction:'finish'});await flush();
  let plays=0,pauses=0;const player={currentTime:0,play:async()=>{plays++;},pause:()=>{pauses++;}};
  h.nodes.set('speaking-response-player',player);
  const uploads=h.requests.filter(r=>r.url.endsWith('/recording')&&r.body).length;
  await h.click({speakingAction:'replay-word',speakingStart:'6.2',speakingEnd:'7.05'});
  assert.equal(player.currentTime,6.2);assert.equal(plays,1);
  player.currentTime=7.1;player.ontimeupdate();assert.equal(pauses,1);assert.equal(player.ontimeupdate,null);
  assert.equal(h.requests.filter(r=>r.url.endsWith('/recording')&&r.body).length,uploads);
});
