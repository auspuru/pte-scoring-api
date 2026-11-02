(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./speaking-start-cue'):root.SpeakingStartCue,typeof module==='object'&&module.exports?require('./speaking-images'):root.SpeakingImages,typeof module==='object'&&module.exports?require('./mock-report-ui'):root.MockReportUI);if(typeof module==='object'&&module.exports)module.exports=api;else root.SpeakingMock=api.createController(root,{getUserId:()=>typeof currentUserId==='undefined'?'':currentUserId});})(typeof globalThis==='undefined'?this:globalThis,function(cues,images,layout){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clock=value=>{const s=Math.max(0,Math.ceil(value));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
  const labels={intro:'Introduction',ra:'Read Aloud',rs:'Repeat Sentence',di:'Describe Image',rl:'Retell Lecture',sgd:'Summarise Group Discussion',rts:'Respond to a Situation'};
  function createController(env,{getUserId=()=>env.currentUserId||''}={}){
    const doc=env.document,OWNER='speaking-mock',memory=new Map(),done=new Set(),urls=new Map(),promptFinished=new Set(),startCue=cues.create(env),imageViewer=images.create(env);let rsCue,check,checkTimer,flow,serverOffset=0;
    let host,catalog,a,owner='',serial=0,busy=false,ending=false,stream,recorder,capture,recordingPromise,prompt,played='',timer,poller,pollBusy=false,pollUntil=0,pollFailures=0,nextPollAt=0,resultVersion=0,notice='',selected=null,reportFilter='all',reviewSignature='',reviewAudioTicket=0,reportSection='overview',reportProvider='azure',responsePane='feedback',context,analyser,silence=0,heard=false;
    const localNow=()=>env.Date?.now?.()||Date.now(),now=()=>localNow()+serverOffset,identity=()=>String(getUserId()||'').trim().toLowerCase();
    const valid=ticket=>ticket===serial&&identity()===owner;
    const key=(id,index)=>owner+':'+id+':'+index;
    const token=()=>{
      try{const current=env.sessionStorage?.getItem('pte_impersonate_token')||env.sessionStorage?.getItem('pte_session_token');if(current)return current;}catch{}
      try{return env.localStorage?.getItem('pte_session_token')||'';}catch{return '';}
    };
    async function api(route,body,raw=false){
      const headers={'x-session-token':token()};if(body!==undefined)headers['Content-Type']=raw?body.type.split(';')[0]:'application/json';
      try{
        const response=await env.fetch('/api/speaking-mocks'+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:raw?body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(30000)});
        const data=await response.json();if(Number.isFinite(data.serverNow))serverOffset=data.serverNow-localNow();if(!response.ok)throw Object.assign(Error(data.error||'The mock could not finish this action.'),{status:response.status,retryable:response.status===408||response.status===429||response.status>=500});return data;
      }catch(error){
        if(error.status)throw error;
        throw Object.assign(Error('The connection was interrupted. Your saved mock is safe; please retry.'),{retryable:true});
      }
    }
    async function pending(action,id,value){
      if(action==='put')memory.set(id,value);if(action==='delete')memory.delete(id);
      if(!env.indexedDB)return action==='get'?memory.get(id):undefined;
      try{return await new Promise((resolve,reject)=>{
        const opening=env.indexedDB.open('ipt-speaking-mock-audio',1);
        opening.onupgradeneeded=()=>opening.result.createObjectStore('pending');opening.onerror=()=>reject(opening.error);
        opening.onsuccess=()=>{const db=opening.result,tx=db.transaction('pending',action==='get'?'readonly':'readwrite'),store=tx.objectStore('pending');
          const request=action==='get'?store.get(id):action==='put'?store.put(value,id):store.delete(id);
          let result;request.onsuccess=()=>{result=request.result;};request.onerror=()=>reject(request.error);
          tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=()=>{db.close();reject(tx.error);};};
      });}catch{return action==='get'?memory.get(id):undefined;}
    }
    function message(text){notice=text;const node=doc.getElementById('sm-notice');if(node)node.textContent=text;}
    function stopPrompt(){if(prompt){prompt.pause();prompt.onended=null;prompt=null;}}
    function stopTimer(){env.clearInterval(timer);timer=null;}
    function stopPolling(){env.clearInterval(poller);poller=null;}
    function release(){stopCheck();flow=null;imageViewer.close();stopTimer();stopPrompt();startCue.close();rsCue=null;if(recorder?.state==='recording')recorder.stop();stream?.getTracks().forEach(t=>t.stop());stream=null;analyser=null;context?.close?.().catch(()=>{});context=null;}
    function leave(){stopPolling();release();serial++;}
    function reset(){leave();a=null;owner='';selected=null;reportFilter='all';reportSection='overview';reportProvider='azure';responsePane='feedback';reviewSignature='';for(const url of urls.values())env.URL.revokeObjectURL(url);urls.clear();host?.replaceChildren();}
    function shell(html){imageViewer.close();host.innerHTML=html;images.bindFallback(host);host.onclick=click;host.onchange=e=>{if(e.target.id==='sm-check-heard'&&check){check.confirmed=!!e.target.checked;checkControls();}else reportChange(e);};host.onkeydown=reportKeydown;host.oninput=e=>{if(e.target.id==='sm-volume'&&prompt)prompt.volume=Number(e.target.value);};}
    function protectedMode(){env.PortalExamMode?.set(OWNER,a?.status==='active',host,{onEvent:event=>{if(a)api('/attempts/'+a.id+'/integrity',{events:[event]}).catch(()=>{});},onLock:()=>{stopPrompt();startCue.cancel();rsCue=null;played='';if(recorder?.state==='recording')recorder.stop();},onResume:()=>{if(a)refresh().catch(e=>message(e.message));}});}
    async function open(options={}){
      if(check)release();
      if(owner&&owner!==identity())reset();stopPolling();owner=identity();if(!owner)return;host=doc.getElementById('speakingMockPane');const ticket=++serial;
      shell('<p role="status">Loading speaking mocks…</p>');
      try{const values=await Promise.all([api('/catalog'),api('/attempts')]);if(!valid(ticket))return;catalog=values[0];hub(values[1],options);}
      catch(error){if(valid(ticket))shell('<p role="alert">'+esc(error.message)+'</p><button class="portal-button" data-sm="reload">Retry</button>');}
    }
    function hub(history,options={}){
      a=null;release();stopPolling();env.PortalExamMode?.set(OWNER,false,host);
      shell('<div class="sm-hub"><h2>'+(options.history?'Saved speaking mocks':'Speaking mock test')+'</h2><p>A timed speaking paper with saved prompt recordings and one chance to record each answer.</p>'
        +(options.history?'':catalog.papers.filter(p=>!options.paperId||p.id===options.paperId).map(p=>'<article class="sm-paper"><h3>'+esc(p.title)+'</h3><p>'+esc(p.scope)+'</p><p>'+p.questionCount+' scored questions · about '+p.minutes+' minutes · unscored introduction</p><p>Use headphones and a working microphone. Questions play once. Review your saved responses and feedback after the test.</p><button class="portal-button primary" data-sm="start" data-paper="'+esc(p.id)+'">Start speaking mock</button></article>').join(''))
        +'<h3>Your saved attempts</h3><div class="ipr-history-grid">'+history.map(row=>layout.historyCard({title:row.title,at:row.startedAt,status:row.status==='active'?'In progress':row.resultsReady===false?'Assessing':'Completed',score:row.speakingReport?.azure?.status==='assessed'?row.speakingReport.azure.overallScore:null,actions:'<button class="portal-button" data-sm="resume" data-id="'+esc(row.id)+'">'+(row.status==='active'?'Continue':row.resultsReady===false?'View status':'Score report')+'</button>'+(row.status==='submitted'?'<button class="portal-button" data-sm="reattempt" data-id="'+esc(row.id)+'">Reattempt</button>':'')})).join('')+'</div>' +'<p id="sm-notice" role="status"></p></div>');
    }
    async function microphone(){
      if(stream)return;if(!env.MediaRecorder||!env.navigator?.mediaDevices?.getUserMedia)throw Error('This browser cannot record microphone audio. Use a supported browser for the speaking mock.');stream=await env.navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
      try{const Context=env.AudioContext||env.webkitAudioContext;if(Context){context=new Context();await context.resume();const source=context.createMediaStreamSource(stream);analyser=context.createAnalyser();analyser.fftSize=256;source.connect(analyser);}}catch{analyser=null;}
    }
    function stopCheck(){
      const previous=check;check=null;env.clearInterval(checkTimer);checkTimer=null;
      if(previous){previous.audio?.pause();if(previous.recorder?.state==='recording')previous.recorder.stop();if(previous.url)env.URL.revokeObjectURL(previous.url);}
    }
    function checkControls(){
      const ready=check?.blob?.size&&check.played&&check.confirmed;
      const begin=doc.getElementById('sm-check-begin');if(begin)begin.disabled=!ready||busy;
      const heard=doc.getElementById('sm-check-heard');if(heard)heard.disabled=!check?.played;
      const play=doc.getElementById('sm-check-play');if(play)play.disabled=!check?.blob?.size||check.recorder?.state==='recording';
      const record=doc.getElementById('sm-check-record');if(record)record.disabled=busy||check?.recorder?.state==='recording';
    }
    function start(paperId,reattemptId){
      if(busy)return;release();check={paperId,reattemptId,ticket:serial,confirmed:false,played:false};
      shell('<section class="sm-equipment"><p class="ipr-eyebrow">Before you begin</p><h1>Check your microphone and headphones</h1><p>Record a few words, play them through your headset, then confirm you can hear your voice clearly. The test starts after this check.</p><label class="sm-check-meter">Microphone level<meter id="sm-check-level" min="0" max="1" value="0"></meter></label><div class="sm-check-actions"><button type="button" class="portal-button" id="sm-check-record" data-sm="check-record">Record a 3-second sample</button><button type="button" class="portal-button" id="sm-check-play" data-sm="check-play" disabled>Play my sample</button></div><p id="sm-check-status" role="status">Your sample stays on this device.</p><label class="sm-check-confirm"><input type="checkbox" id="sm-check-heard" disabled> I can hear my recorded voice clearly.</label><p id="sm-notice" role="status"></p><div class="sm-check-actions"><button type="button" class="portal-button" data-sm="reload">Back</button><button type="button" class="portal-button primary" id="sm-check-begin" data-sm="check-begin" disabled>Begin speaking mock</button></div></section>');
      checkTimer=env.setInterval(()=>{
        if(!check)return;
        if(analyser){const values=new Uint8Array(analyser.fftSize);analyser.getByteTimeDomainData(values);const level=Math.sqrt(values.reduce((sum,n)=>sum+((n-128)/128)**2,0)/values.length);const meter=doc.getElementById('sm-check-level');if(meter)meter.value=Math.min(1,level*5);}
        if(check.recorder?.state==='recording'&&localNow()-check.startedAt>=3000)check.recorder.stop();
      },100);
    }
    async function recordCheck(){
      if(!check||busy||check.recorder?.state==='recording')return;busy=true;const active=check;checkControls();
      try{
        await microphone();if(check!==active||!valid(active.ticket))return;
        active.audio?.pause();if(active.url)env.URL.revokeObjectURL(active.url);active.url=null;active.blob=null;active.played=false;active.confirmed=false;const heard=doc.getElementById('sm-check-heard');if(heard)heard.checked=false;
        const type=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(value=>env.MediaRecorder.isTypeSupported?.(value));
        const recorded=new env.MediaRecorder(stream,type?{mimeType:type}:undefined),chunks=[];active.recorder=recorded;
        recorded.ondataavailable=event=>{if(event.data?.size)chunks.push(event.data);};
        recorded.onstop=()=>{if(check!==active||!valid(active.ticket))return;active.blob=new env.Blob(chunks,{type:recorded.mimeType||type||'audio/webm'});if(active.blob.size)active.url=env.URL.createObjectURL(active.blob);doc.getElementById('sm-check-status').textContent=active.blob.size?'Sample recorded. Play it through your headset.':'No sample was captured. Check the microphone and record again.';checkControls();};
        recorded.onerror=()=>{if(check===active){message('The sample could not be recorded. Check your microphone and try again.');if(recorded.state==='recording')recorded.stop();}};
        active.startedAt=localNow();recorded.start();doc.getElementById('sm-check-status').textContent='Say a few words now…';message('');
      }catch(error){if(check===active)message(error.message||'Allow microphone access, then record the sample again.');}
      finally{busy=false;checkControls();}
    }
    async function playCheck(){
      const active=check;if(!active?.url||active.recorder?.state==='recording')return;
      active.audio?.pause();active.played=false;active.confirmed=false;const heard=doc.getElementById('sm-check-heard');if(heard)heard.checked=false;
      const audio=new env.Audio(active.url);active.audio=audio;
      audio.onended=()=>{if(check!==active||active.audio!==audio||!valid(active.ticket))return;active.played=true;doc.getElementById('sm-check-status').textContent='If you heard your voice clearly, confirm below to begin.';checkControls();};
      audio.onerror=()=>{if(check===active)message('The sample could not play. Check your headset connection and record another sample.');};
      try{await audio.play();if(check===active){message('');doc.getElementById('sm-check-status').textContent='Playing your sample…';}}catch{if(check===active)message('Playback was blocked. Select Play my sample again.');}checkControls();
    }
    async function beginMock(){
      if(busy||!check?.blob?.size||!check.played||!check.confirmed)return;
      const {paperId,reattemptId}=check;startCue.unlock();busy=true;checkControls();const ticket=serial;
      try{const ready=await env.PortalExamMode.prepare(OWNER,host,{immediate:true});if(!ready||!valid(ticket))return;await microphone();if(!valid(ticket)){release();return;}
        const id=env.crypto.randomUUID();a=await api(reattemptId?'/attempts/'+reattemptId+'/reattempt':'/attempts',reattemptId?{id}:{id,paperId});if(!valid(ticket))return;stopCheck();stopPolling();selected=null;capture=null;recordingPromise=null;played='';await begin();
      }catch(error){message(error.message||'Microphone access is required to start the speaking mock.');env.PortalExamMode?.set(OWNER,false,host);release();}
      finally{busy=false;checkControls();}
    }
    async function resume(id){
      if(busy)return;startCue.unlock();busy=true;const ticket=serial;
      try{const saved=await api('/attempts/'+id);if(!valid(ticket))return;
        if(saved.status==='active'){const ready=await env.PortalExamMode.prepare(OWNER,host,{immediate:true});if(!ready||!valid(ticket))return;await microphone();if(!valid(ticket)){release();return;}}
        a=saved;selected=null;reportFilter='all';reportSection='overview';responsePane='feedback';reviewSignature='';
        if(a.status==='active'){const blob=await pending('get',key(a.id,a.index));if(blob){done.add(key(a.id,a.index));await upload(blob,a.id,a.index);}await begin();}else{startCue.close();results();}
      }catch(error){message(error.message);env.PortalExamMode?.set(OWNER,false,host);}
      finally{busy=false;}
    }
    async function begin(){
      if(a.status!=='active'){results();return;}
      const fresh=a.timing.phase==='ready';if(fresh)a=await api('/attempts/'+a.id+'/begin',{index:a.index,timingVersion:2});
      flow={key:key(a.id,a.index),leadUntil:localNow()+(fresh?3000:Math.max(0,a.timing.audioAt-now())),fresh,ended:a.timing.playbackDriven&&a.timing.prepAt!=null,prepUntil:null,finishing:false};
      notice='';renderExam();protectedMode();stopTimer();timer=env.setInterval(tick,100);tick();
    }
    function renderExam(){
      const q=a.question;
      shell('<div class="sm-exam"><header class="sm-exam-header"><strong>IPT Brisbane · Speaking</strong><div><span id="sm-time">'+clock((a.deadline-now())/1000)+'</span><span>Item '+(a.index+1)+' of '+a.totalItems+'</span></div></header>'
        +'<main class="sm-exam-main"><p class="sm-instructions">'+esc(q.instruction)+'</p><div class="sm-question '+(q.type==='di'?'sm-visual':'')+'">'
        +'<div class="sm-stimulus">'+(q.type==='di'&&q.title?'<h2 class="sm-image-title">'+esc(q.title)+'</h2>':'')+(q.text?'<p class="sm-passage">'+esc(q.text)+'</p>':'')+(q.imageUrl?'<button type="button" class="sm-exam-image" data-sm="zoom-image" aria-label="Enlarge question image">'+images.image(q)+'</button><button type="button" class="portal-button sm-image-enlarge" data-sm="zoom-image">Enlarge image</button>'+images.legend(q):'')+'</div>'
        +'<div class="sm-controls">'+(q.audioUrl?'<section class="sm-audio-panel" aria-label="Prompt audio"><div>Status: <span id="sm-audio-status">Beginning shortly</span></div><label class="sm-volume">Volume <input id="sm-volume" aria-label="Prompt volume" type="range" min="0" max="1" step="0.1" value="1"></label><div class="sm-bar"><span id="sm-audio-bar"></span></div></section>':'')
        +'<section class="sm-record-panel" aria-label="Recorded answer"><strong>Recorded Answer</strong><p>Current Status:</p><div id="sm-preparation-status" role="status"></div><div id="sm-record-status" role="status" aria-live="polite">Beginning shortly</div><div class="sm-bar"><span id="sm-record-bar"></span></div></section></div></div>'
        +'<p id="sm-notice" role="status">'+esc(notice)+'</p><button class="portal-button" data-sm="play" id="sm-play" hidden>Play remaining audio</button><button class="portal-button" data-sm="upload" id="sm-upload" hidden>Retry saving recording</button></main>'
        +'<footer class="sm-exam-footer"><span>'+esc(q.type==='intro'?'Personal Introduction · Not scored':labels[q.type])+'</span><button type="button" class="sm-next" data-sm="next" id="sm-next">Next <span aria-hidden="true">➜</span></button></footer><dialog id="sm-image-dialog" class="sm-image-dialog" aria-label="Full-size question image"></dialog></div>');
    }
    function beep(){try{if(!context)return;const tone=context.createOscillator(),gain=context.createGain();tone.frequency.value=1000;gain.gain.value=.07;tone.connect(gain);gain.connect(context.destination);tone.start();tone.stop(context.currentTime+.12);}catch{}}
    async function playPrompt(){
      if(!a?.question.audioUrl||env.PortalExamMode?.isLocked(OWNER))return;
      const clipKey=key(a.id,a.index);played=clipKey;stopPrompt();prompt=new env.Audio(a.question.audioUrl);
      const audio=prompt;audio.currentTime=flow?.fresh?0:Math.max(0,(now()-a.timing.audioAt)/1000);
      const ticket=serial;promptFinished.delete(clipKey);
      audio.onended=()=>{if(!valid(ticket)||!a||key(a.id,a.index)!==clipKey||prompt!==audio)return;promptFinished.add(clipKey);stopPrompt();if(a.timing.playbackDriven){flow.ended=true;finishPrompt();}else tick();};
      audio.onerror=()=>{const node=doc.getElementById('sm-play');if(node)node.hidden=false;message('The prompt audio could not load. Select Play remaining audio to retry.');};
      try{await audio.play();if(valid(ticket)&&prompt===audio){const node=doc.getElementById('sm-play');if(node)node.hidden=true;}}catch{const node=doc.getElementById('sm-play');if(node)node.hidden=false;message('Audio was blocked. Select Play remaining audio to continue.');}
    }
    async function finishPrompt(){
      const active=flow;if(!active||active.finishing||!a||!a.timing.playbackDriven||a.timing.prepAt!=null)return;
      active.finishing=true;const id=a.id,index=a.index,ticket=serial;
      try{const saved=await api('/attempts/'+id+'/playback',{index});if(!valid(ticket)||flow!==active||a?.id!==id||a.index!==index)return;a=saved;active.prepUntil=localNow()+a.question.preparation*1000;const button=doc.getElementById('sm-play');if(button){button.hidden=true;button.textContent='Play remaining audio';}message('');tick();}
      catch(error){if(valid(ticket)&&flow===active){message(error.message+' Select Continue after audio to retry.');const button=doc.getElementById('sm-play');if(button){button.textContent='Continue after audio';button.hidden=false;}}}
      finally{active.finishing=false;}
    }
    function startRecording(){
      const captureKey=key(a.id,a.index);if(done.has(captureKey)||capture?.key===captureKey)return;
      const options=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(type=>env.MediaRecorder.isTypeSupported?.(type));
      try{
        recorder=new env.MediaRecorder(stream,options?{mimeType:options}:undefined);const activeRecorder=recorder,chunks=[],current={key:captureKey,id:a.id,index:a.index,ticket:serial,startedAt:now(),endsAt:a.question.type==='rs'||a.timing.playbackDriven?now()+a.question.seconds*1000:a.timing.endsAt};capture=current;
        heard=false;silence=0;if(a.question.type!=='rs')beep();
        recordingPromise=new Promise(resolve=>{
          recorder.ondataavailable=event=>{if(event.data?.size)chunks.push(event.data);};
          recorder.onstop=async()=>{done.add(current.key);analyser&&=(context?.state==='closed'?null:analyser);
            const blob=new env.Blob(chunks,{type:activeRecorder.mimeType||options||'audio/webm'});await pending('put',current.key,blob);
            if(valid(current.ticket)){try{await upload(blob,current.id,current.index);}catch(error){message(error.message+' Your recording is saved on this device; retry saving it.');const node=doc.getElementById('sm-upload');if(node)node.hidden=false;}}
            resolve();};
        });
        recorder.onerror=()=>{message('Recording was interrupted. Continue when your saved response is ready.');if(recorder.state==='recording')recorder.stop();};recorder.start(500);
      }catch(error){message('The microphone could not start: '+error.message);}
    }
    async function upload(blob,id,index){
      const saved=await api('/attempts/'+id+'/recordings/'+index,blob,true);await pending('delete',key(id,index));
      if(a?.id===id&&identity()===owner){a=saved;message('Recording saved. Select Next to continue.');const node=doc.getElementById('sm-upload');if(node)node.hidden=true;tick();}
    }
    async function finishAtDeadline(){
      if(ending)return;ending=true;const ticket=serial;
      stopTimer();stopPrompt();startCue.cancel();rsCue=null;
      try{
        if(recorder?.state==='recording')recorder.stop();
        if(recordingPromise)await recordingPromise;
        if(valid(ticket))await refresh();
      }catch(error){if(valid(ticket))message(error.message);}
      finally{ending=false;}
    }
    function tick(){
      if(!a||a.status!=='active')return;
      const time=doc.getElementById('sm-time');if(time)time.textContent=clock((a.deadline-now())/1000);
      if(now()>=a.deadline)return finishAtDeadline();
      if(env.PortalExamMode?.isLocked(OWNER))return;
      const t=a.timing,current=now(),q=a.question,captureKey=key(a.id,a.index);
      const completed=t.phase==='completed'||done.has(captureKey);
      let text;
      if(completed)text='Completed';
      else if(t.playbackDriven){
        if(flow&&localNow()<flow.leadUntil)text='Audio begins in '+clock((flow.leadUntil-localNow())/1000);
        else if(!flow?.ended){text='Listening';if(played!==captureKey)playPrompt();}
        else if(t.prepAt==null)text='Preparing your response…';
        else if((flow?.prepUntil!=null&&localNow()<flow.prepUntil)||current<t.cueAt)text='Preparation time: '+clock(Math.max((flow?.prepUntil||0)-localNow(),t.cueAt-current)/1000);
        else if(q.type==='rs'){
          if(rsCue?.key!==captureKey){const pending={key:captureKey,ready:false};rsCue=pending;startCue.play(captureKey,()=>{if(rsCue===pending)pending.ready=true;});}
          if(!rsCue.ready||current<t.recordingAt)text='Get ready';
          else if(!capture||capture.key!==captureKey||current<capture.endsAt){text='Recording';startRecording();}
          else{if(recorder?.state==='recording')recorder.stop();text=done.has(captureKey)?'Completed':'Recording period completed';}
        }else if(!capture||capture.key!==captureKey||current<capture.endsAt){text='Recording';startRecording();}
        else{if(recorder?.state==='recording')recorder.stop();text=done.has(captureKey)?'Completed':'Recording period completed';}
      }
      else if(current<t.audioAt)text='Beginning in '+clock((t.recordingAt-current)/1000);else if(current<t.prepAt){text='Beginning in '+clock((t.recordingAt-current)/1000);if(played!==captureKey)playPrompt();}
      else if(q.type==='rs'){
        if(!promptFinished.has(captureKey)){
          text='Listening';if(played!==captureKey)playPrompt();
        }else{
          if(rsCue?.key!==captureKey){const pending={key:captureKey,ready:false};rsCue=pending;startCue.play(captureKey,()=>{if(rsCue===pending)pending.ready=true;});}
          if(!rsCue.ready||current<t.recordingAt)text='Get ready';
          else if(!capture||capture.key!==captureKey||current<capture.endsAt){text='Recording';startRecording();}
          else{if(recorder?.state==='recording')recorder.stop();text=done.has(captureKey)?'Completed':'Recording period completed';}
        }
      }
      else if(current<t.recordingAt){stopPrompt();text='Beginning in '+clock((t.recordingAt-current)/1000);}
      else if(current<t.endsAt){stopPrompt();text='Recording';startRecording();}
      else{if(recorder?.state==='recording')recorder.stop();text=done.has(captureKey)?'Completed':'Recording period completed';}
      const status=doc.getElementById('sm-record-status');if(status&&status.textContent!==text)status.textContent=text;
      const began=q.type==='rs'||t.playbackDriven?(capture?.key===captureKey?capture.startedAt:current):t.recordingAt;
      const bar=doc.getElementById('sm-record-bar');if(bar)bar.style.width=(completed?100:Math.max(0,Math.min(100,(current-began)/(q.seconds*10))))+'%';
      const audioStatus=doc.getElementById('sm-audio-status');if(audioStatus)audioStatus.textContent=t.playbackDriven?(flow&&localNow()<flow.leadUntil?'Beginning in '+clock((flow.leadUntil-localNow())/1000):flow?.ended?'Completed':prompt?.paused?'Select Play remaining audio':'Playing'):current<t.audioAt?'Beginning shortly':current<t.prepAt||q.type==='rs'&&!promptFinished.has(captureKey)?'Playing':'Completed';
      const preparation=doc.getElementById('sm-preparation-status');if(preparation)preparation.textContent=text.startsWith('Preparation time:')?text:'';
      const audioBar=doc.getElementById('sm-audio-bar');if(audioBar)audioBar.style.width=(t.playbackDriven?(flow?.ended?100:Math.max(0,Math.min(100,(prompt?.currentTime||0)/(q.audioSeconds||1)*100))):Math.max(0,Math.min(100,(current-t.audioAt)/(q.audioSeconds*10))))+'%';
      if(analyser&&recorder?.state==='recording'){
        const data=new Uint8Array(analyser.fftSize);analyser.getByteTimeDomainData(data);const level=Math.sqrt(data.reduce((sum,n)=>sum+((n-128)/128)**2,0)/data.length);
        if(level>.015){heard=true;silence=0;}else if(heard){silence||=current;if(current-silence>=3000)recorder.stop();}
      }
    }
    async function next(){
      if(busy||!a||a.status!=='active')return;busy=true;const ticket=serial,id=a.id,index=a.index;
      const button=doc.getElementById('sm-next');if(button){button.disabled=true;button.textContent='Moving on…';}
      try{
        if(recorder?.state==='recording')recorder.stop();if(recordingPromise&&capture?.id===id&&capture.index===index)await recordingPromise;
        const blob=await pending('get',key(id,index));if(blob)await upload(blob,id,index);
        const completed=a.timing.phase==='completed';
        stopTimer();stopPrompt();startCue.cancel();rsCue=null;a=await api('/attempts/'+id+'/next',{index,skip:!completed});if(!valid(ticket))return;
        capture=null;recordingPromise=null;if(a.status==='submitted'){release();results();}else await begin();
      }catch(error){message(error.message);}finally{busy=false;if(button){button.disabled=false;button.innerHTML='Next <span aria-hidden="true">➜</span>';}}
    }
    async function refresh(){const ticket=serial,saved=await api('/attempts/'+a.id);if(!valid(ticket))return;a=saved;if(a.status==='submitted'){release();results();}else{renderExam();protectedMode();tick();}}
    function score(trait){return trait?.score==null?'—':esc(trait.score)+'/5'+(trait.manualOverride?' (manual override)':'');}
    const setMarkup=(node,markup)=>{if(node&&node.innerHTML!==markup)node.innerHTML=markup;};
    const answers=()=>a?.responses?.filter(r=>r.question.type!=='intro')||[];
    const visibleAnswers=()=>answers().filter(r=>reportFilter==='all'||r.question.type===reportFilter);
    function answerLabel(response){
      const number=answers().filter(r=>r.question.type===response.question.type).findIndex(r=>r.index===response.index)+1;
      return labels[response.question.type]+' '+number;
    }
    const providerOptions=()=>[['azure','Azure Speech']].map(([value,label])=>'<option value="'+value+'"'+(reportProvider===value?' selected':'')+'>'+label+'</option>').join('');
    function reportKeydown(event){
      const data=event.target?.dataset;if(!data||!['section','response-pane'].includes(data.sm)||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      const sections=data.sm==='section',values=sections?['overview','answers','analysis','next']:['feedback','transcript','sample'],at=values.indexOf(sections?reportSection:responsePane);
      const next=event.key==='Home'?0:event.key==='End'?values.length-1:(at+(event.key==='ArrowRight'?1:-1)+values.length)%values.length;
      event.preventDefault();if(sections){reportSection=values[next];updateReportState();if(reportSection==='next')updateNextSteps();}else{responsePane=values[next];refreshReviewFeedback();}
      doc.getElementById((sections?'sm-tab-':'sm-response-tab-')+values[next])?.focus?.({preventScroll:true});
    }
    function reportChange(event){
      if(!a||a.status!=='submitted')return;
      const target=event.target;
      if(target.id==='sm-task-picker'){reportFilter=Object.hasOwn(labels,target.value)&&target.value!=='intro'?target.value:'all';reportSection='answers';updateResults();}
      if(target.id==='sm-question-picker')review(Number(target.value));
      if(target.id==='sm-overview-provider'||target.id==='sm-review-provider'){
        if(target.value!=='azure')return;
        reportProvider=target.value;updateReportState();refreshReviewFeedback();doc.getElementById(target.id)?.focus?.({preventScroll:true});
      }
    }
    function updateReportState(){
      const report=doc.getElementById('sm-report');report?.setAttribute?.('data-provider',reportProvider);
      for(const section of ['overview','answers','analysis','next']){
        const panel=doc.getElementById('sm-panel-'+section),tab=doc.getElementById('sm-tab-'+section);
        if(panel)panel.hidden=reportSection!==section;
        tab?.setAttribute?.('aria-selected',String(reportSection===section));tab?.setAttribute?.('tabindex',reportSection===section?'0':'-1');
      }
      const provider=doc.getElementById('sm-overview-provider');if(provider)provider.value=reportProvider;
    }
    function preparing(){
      shell('<div class="sm-results"><header class="sm-results-heading"><div><h2>'+esc(a.title)+'</h2><p id="sm-preparing-status" role="status" aria-live="polite">Preparing your results. Please wait.</p></div><button class="portal-button" data-sm="history">Saved speaking mocks</button></header><p>Your answers are saved. Results may take around 5–10 minutes. This page will open your complete report automatically. You can leave and return later.</p><p id="sm-preparing-progress" class="sm-muted"></p><p id="sm-notice" role="status"></p></div>');
      updatePreparing();pollResults();
    }
    function updatePreparing(){
      const progress=a.resultStatus||{},node=doc.getElementById('sm-preparing-progress'),status=doc.getElementById('sm-preparing-status');
      if(node)node.textContent=progress.accountedFor==null?'':progress.accountedFor+' of '+progress.total+' questions accounted for.';
      if(status)status.textContent=progress.delayed?'Your results are taking longer than usual. Your answers are saved; we are checking the remaining assessments.':'Preparing your results. Please wait.';
    }
    function results(){
      env.PortalExamMode?.set(OWNER,false,host);stopTimer();stopPrompt();
      if(a.resultsReady===false){preparing();return;}
      shell('<div class="sm-results ipt-mock-report" id="sm-report" data-provider="'+reportProvider+'"><header class="sm-results-heading ipr-heading"><div><p class="ipr-eyebrow">Speaking score report</p><h2>'+esc(a.title)+'</h2><p class="sm-muted">Your responses, feedback and next steps.</p></div><div class="sm-results-actions"><button class="portal-button" data-sm="history">Saved speaking mocks</button><button class="portal-button" data-sm="reattempt" data-id="'+esc(a.id)+'">Reattempt this mock</button></div></header>'
        +'<nav class="sm-report-tabs ipr-tabs" role="tablist" aria-label="Speaking report sections">'+[['overview','Score report'],['answers','Answers'],['analysis','Analysis'],['next','Feedback']].map(([value,label])=>'<button id="sm-tab-'+value+'" role="tab" data-sm="section" data-section="'+value+'" aria-controls="sm-panel-'+value+'" aria-selected="'+(reportSection===value)+'">'+label+'</button>').join('')+'</nav>'
        +'<p id="sm-assessment-status" class="sm-assessment-status" role="status"></p><section id="sm-panel-overview" role="tabpanel" aria-labelledby="sm-tab-overview"><div id="sm-results-summary" class="sm-summary-grid" aria-live="polite"></div><div class="sm-overview-shortcuts"><button class="portal-button primary" data-sm="section" data-section="answers">Review your answers →</button><button class="portal-button" data-sm="filter" data-type="di">Describe Image samples</button><button class="portal-button" data-sm="section" data-section="next">See next steps →</button></div></section>'
        +'<section id="sm-panel-answers" role="tabpanel" aria-labelledby="sm-tab-answers" hidden><section class="sm-answer-review" aria-labelledby="sm-answers-heading"><h3 id="sm-answers-heading">Individual question feedback</h3><div class="sm-compact-navigation"><label>Task<select id="sm-task-picker"></select></label><label>Question<select id="sm-question-picker"></select></label><p id="sm-question-count" class="sm-muted"></p></div>'
        +'<div id="sm-review-details"></div><details class="sm-all-questions"><summary>Browse all questions</summary><div id="sm-task-filters" class="sm-task-filters" role="group" aria-label="Filter questions by task"></div><div id="sm-question-list"></div></details></section>'
        +'</section><section id="sm-panel-analysis" role="tabpanel" aria-labelledby="sm-tab-analysis" hidden><div class="sm-score-breakdown"><h3>Question overview</h3><div class="sm-table-wrap"><table class="sm-table"><thead><tr><th scope="col">Question</th><th scope="col">Content</th><th scope="col">Pronunciation / fluency</th><th scope="col">Review</th></tr></thead><tbody id="sm-result-rows"></tbody></table></div></div></section>'
        +'<section id="sm-panel-next" role="tabpanel" aria-labelledby="sm-tab-next" hidden><h3>Your feedback</h3><p class="sm-muted">Choose an answer and focus on one useful improvement.</p><div id="sm-next-steps"></div></section>'
        +'<dialog id="sm-image-dialog" class="sm-image-dialog" aria-label="Full-size question image"></dialog><footer class="sm-report-footer"><p id="sm-notice" role="status"></p>'+(a.resultsReady===undefined?'<button class="portal-button" data-sm="retry">Retry unavailable scores</button>':'')+'</footer></div>');
      updateResults();pollResults();
    }
    function updateQuestionNavigation(){
      const all=answers(),visible=visibleAnswers(),filters=doc.getElementById('sm-task-filters'),list=doc.getElementById('sm-question-list'),count=doc.getElementById('sm-question-count');
      const tasks=[['all','All questions',all.length],...Object.entries(labels).filter(([type])=>type!=='intro').map(([type,label])=>[type,label,all.filter(r=>r.question.type===type).length])].filter(([, ,n])=>n);
      setMarkup(filters,tasks.map(([type,label,n])=>'<button type="button" class="sm-task-filter" data-sm="filter" data-type="'+type+'" aria-pressed="'+(reportFilter===type)+'">'+esc(label)+' <span>'+n+'</span></button>').join(''));
      setMarkup(doc.getElementById('sm-task-picker'),tasks.map(([type,label,n])=>'<option value="'+type+'"'+(reportFilter===type?' selected':'')+'>'+esc(label)+' ('+n+')</option>').join(''));
      setMarkup(doc.getElementById('sm-question-picker'),visible.map(r=>'<option value="'+r.index+'"'+(selected===r.index?' selected':'')+'>'+esc(answerLabel(r))+' · '+esc(r.question.title||labels[r.question.type])+'</option>').join(''));
      if(count)count.textContent=visible.length+' question'+(visible.length===1?'':'s')+(reportFilter==='all'?' in this mock':' in this task');
      setMarkup(list,visible.map(r=>'<button type="button" class="sm-question-link" data-sm="review" data-index="'+r.index+'" aria-current="'+(selected===r.index?'true':'false')+'"><span><strong>'+esc(answerLabel(r))+'</strong><small>'+esc(r.question.title||labels[r.question.type])+'</small></span><span class="sm-content-badge">'+(r.exclusion?'Excluded':r.content?.total==null?(r.recording?(a.grading?.status==='complete'?'Unavailable':'Pending'):'Skipped'):esc(r.content.total)+'/'+esc(r.content.maximum))+'</span></button>').join(''));
    }
    function updateNextSteps(){
      const current=answers().find(r=>r.index===selected&&r.content?.improvements?.length);
      const candidates=[current||answers().find(r=>r.content?.improvements?.length)].filter(Boolean);
      const saved=a.overallFeedback,overview=saved?'<article class="sm-practice-step"><h3>Your response review</h3><p>'+esc(saved.summary)+'</p>'+(saved.strengths||[]).map(text=>'<p><strong>Keep:</strong> '+esc(text)+'</p>').join('')+'</article>':''; // Legacy priorities are replaced by the active score-based order.
      setMarkup(doc.getElementById('sm-next-steps'),layout.impactFeedback(a.impactFeedback)+overview+(candidates.length?candidates.map(r=>'<article class="sm-practice-step"><p class="sm-eyebrow">'+esc(answerLabel(r))+'</p><h4>'+esc(r.question.title||labels[r.question.type])+'</h4>'+(r.content.strengths?.[0]?'<p><strong>Keep:</strong> '+esc(r.content.strengths[0])+'</p>':'')+'<p><strong>Try this next:</strong> '+esc(r.content.improvements[0])+'</p><button class="portal-button" data-sm="review" data-index="'+r.index+'">Open this answer →</button><button class="portal-button" data-sm="sample" data-index="'+r.index+'">Compare with a sample</button></article>').join(''):'<p class="sm-muted">No specific next step is available yet. Open an answer to listen to your recording and review the saved feedback.</p>'));
    }
    function updateResults(){
      const report=a.speakingReport,summary=doc.getElementById('sm-results-summary'),status=doc.getElementById('sm-assessment-status'),value=report?.azure,complete=value?.status==='assessed';
      const overallScore=complete?value.overallScore:null;
      const exclusions=value?.excludedQuestions?.length?'<aside class="sm-practice-focus"><h4>Responses requiring attention</h4>'+value.excludedQuestions.map(q=>'<p><strong>Question '+esc(q.number)+' · '+esc(q.title||q.questionId)+'</strong><br>'+esc(q.note)+'</p>').join('')+'</aside>':'';
      setMarkup(summary,layout.hero({title:a.title,user:owner,at:a.startedAt,count:a.questionCount,overall:overallScore,skills:[{name:'Speaking',value:overallScore}],status:complete?'Completed':'Assessing'})+layout.contributions({section:'speaking',groups:value?.byType})+(value?'<p class="sm-muted">'+esc(value.assessedCount||0)+' of '+esc(value.questionCount||a.questionCount)+' responses assessed.</p>':'')+exclusions+(value?.insufficientSpeechCount?'<p class="sm-muted">'+esc(value.insufficientSpeechCount)+' short response(s) have saved content credit but no delivery credit. Open the answer for details.</p>':''));
      const recorded=a.completedCount??answers().filter(r=>r.recording).length,contentCount=report?.azure?.questions.filter(r=>r.content!==null).length??0;
      if(status)status.textContent=a.grading?.status==='complete'?'Assessment finished · '+recorded+' of '+a.questionCount+' responses recorded · '+contentCount+' of '+(report?.azure?.questionCount??a.questionCount)+' content scores available.'+(report?.azure?.excludedCount?' '+report.azure.excludedCount+' question'+(report.azure.excludedCount===1?' is':'s are')+' excluded from the overall score.':'')+(report?.azure?.status!=='assessed'?' Some assessments are pending.':''): 'Assessment in progress. Your recordings are saved; you can leave and return to this report.';
      const rows=doc.getElementById('sm-result-rows');setMarkup(rows,answers().map(r=>'<tr><th scope="row">'+esc(answerLabel(r))+'</th><td>'+(r.exclusion?'Excluded':r.content?.total==null?'—':esc(r.content.total)+'/'+esc(r.content.maximum))+'</td><td>'+(r.exclusion?'—':score(r.providers.azure?.pronunciation)+' / '+score(r.providers.azure?.fluency))+'</td><td><button class="portal-button" data-sm="review" data-index="'+r.index+'">Review</button></td></tr>').join(''));
      updateReportState();updateNextSteps();const visible=visibleAnswers();if(!visible.some(r=>r.index===selected)&&visible.length)review(visible[0].index);else{updateQuestionNavigation();refreshReviewFeedback();}
    }
    function reviewFeedback(response){
      const content=response.content,q=response.question,providers=response.providers||{},unique=values=>[...new Set(values.filter(Boolean))];
      const shown=['azure'];
      const delivery=shown.map(provider=>['pronunciation','fluency'].map(kind=>{
        const trait=providers[provider]?.[kind];
        return '<span class="sm-trait-score '+(kind==='fluency'?'sm-score-sand':'sm-score-mint')+'">'+esc((shown.length>1?'Azure ':'')+(kind==='fluency'?'Oral fluency':'Pronunciation'))+'<strong>'+score(trait)+'</strong>'+(trait?.score==null?'<small>Unavailable</small>':'')+'</span>';
      }).join('')).join('');
      const list=(title,items)=>Array.isArray(items)&&items.length?'<h5>'+title+'</h5><ul>'+unique(items).map(value=>'<li>'+esc(value)+'</li>').join('')+'</ul>':'';
      return '<div class="sm-response-tabs" role="tablist" aria-label="Response details">'+[['feedback','Feedback'],['transcript','Transcript'],['sample',q.type==='di'?'Sample answer':'Reference']].map(([value,label])=>'<button type="button" role="tab" id="sm-response-tab-'+value+'" data-sm="response-pane" data-pane="'+value+'" aria-controls="sm-response-'+value+'" aria-selected="'+(responsePane===value)+'">'+label+'</button>').join('')+'</div>'
        +'<section id="sm-response-feedback" role="tabpanel" aria-labelledby="sm-response-tab-feedback"'+(responsePane!=='feedback'?' hidden':'')+'>'+(response.exclusion?'<section class="sm-practice-focus" role="note"><h4>Excluded from the overall score</h4><p>'+esc(response.exclusion.note)+'</p></section>':''+(response.deliveryOutcome?'<section class="sm-practice-focus" role="note"><h4>Short response</h4><p>'+esc(response.deliveryOutcome.note)+'</p></section>':'')+'<div class="sm-review-score-strip"><span class="sm-trait-score">Content <strong>'+(content?.total==null?'—':esc(content.total)+'/'+esc(content.maximum))+'</strong>'+(content?.total==null?'<small>Unavailable</small>':'')+'</span>'+delivery+'</div><section class="sm-content-feedback"><h4>What worked well</h4><p>'+esc(content?.strengths?.[0]||'No specific strength is available yet.')+'</p>'+(content?.improvements?.[0]?'<div class="sm-practice-focus"><h4>Try this next</h4><p>'+esc(content.improvements[0])+'</p></div>':'')+'</section><details class="sm-provider-details"><summary>Full saved feedback</summary><p>'+esc(content?.overview||'Content review is unavailable for this response.')+'</p>'+list('What worked',content?.strengths)+list('Next steps',content?.improvements)+'<div class="sm-provider-feedback">'+['azure'].map(provider=>'<section><h4>'+esc('Speaking feedback')+'</h4>'+['pronunciation','fluency'].map(kind=>{const trait=providers[provider]?.[kind];return '<h5>'+esc(kind==='fluency'?'Oral fluency':'Pronunciation')+' · '+score(trait)+'</h5><p>'+esc(unique([trait?.reason,trait?.coaching||trait?.nextStep]).join(' ')||'No delivery feedback available.')+'</p>';}).join('')+'</section>').join('')+'</div></details>')+'</section>'
        +'<section id="sm-response-transcript" class="sm-student-transcript" role="tabpanel" aria-labelledby="sm-response-tab-transcript"'+(responsePane!=='transcript'?' hidden':'')+'><h4>Your transcript</h4><p>'+esc(response.transcript||'No transcript available for this response.')+'</p><small>Check the recording before treating a transcript error as a speaking mistake.</small></section>'
        +'<section id="sm-response-sample" class="sm-sample-response" role="tabpanel" aria-labelledby="sm-response-tab-sample"'+(responsePane!=='sample'?' hidden':'')+'><p class="sm-eyebrow">Compare and practise</p><h4>'+(q.type==='di'?'Sample response':['ra','rs'].includes(q.type)?'Reference wording':'Sample response')+'</h4><p>'+esc((['ra','rs'].includes(q.type)?q.reference||q.sample:q.sample||q.reference)||'No saved sample is available for this question.')+'</p><small>'+(['ra','rs'].includes(q.type)?'Reference wording for this question.':'One possible response. Other accurate descriptions are valid.')+'</small></section>';
    }
    function refreshReviewFeedback(){
      const response=answers().find(r=>r.index===selected),node=doc.getElementById('sm-review-feedback');if(!response||!node)return;
      const signature=JSON.stringify([response.exclusion,response.deliveryOutcome,response.content,response.providers,response.transcript,reportProvider,responsePane]);if(signature===reviewSignature)return;
      const expanded=node.querySelector?.('.sm-provider-details')?.open;
      node.innerHTML=reviewFeedback(response);if(expanded){const details=node.querySelector?.('.sm-provider-details');if(details)details.open=true;}reviewSignature=signature;
    }
    const localAsset=url=>typeof url==='string'&&/^\/(?!\/)/.test(url)?url:'';
    function showImage(){
      const q=a.status==='active'?a.question:answers().find(r=>r.index===selected)?.question;
      imageViewer.open(doc.getElementById('sm-image-dialog'),q);
    }
    async function review(index,{focus=false}={}){
      const response=answers().find(r=>r.index===index),node=doc.getElementById('sm-review-details');if(!response||!node)return;
      selected=index;reviewSignature='';const audioTicket=++reviewAudioTicket,ticket=serial,id=a.id;
      const visible=visibleAnswers(),position=visible.findIndex(r=>r.index===index),q=response.question,image=images.source(q),sourceAudio=localAsset(q.audioUrl);
      const stimulus=q.type==='di'?'<figure class="sm-image-sample">'+(image?'<div class="sm-image-toolbar"><span>Question image</span><button class="portal-button" data-sm="zoom-image">Zoom image ↗</button></div><button class="sm-image-button" data-sm="zoom-image" aria-label="Enlarge question image">'+images.image(q)+'</button>'+images.legend(q)+'<figcaption><a href="'+esc(image)+'" target="_blank" rel="noopener noreferrer">Open full-size image</a></figcaption>':'<p class="sm-muted">The saved question image is unavailable.</p>')+'</figure>':'<section class="sm-review-prompt"><p class="sm-eyebrow">Question</p>'+(q.text?'<p>'+esc(q.text)+'</p>':'')+(sourceAudio?'<h4>Question audio</h4><audio controls preload="none" src="'+esc(sourceAudio)+'" aria-label="Question audio"></audio>':'')+(q.reference&&q.reference!==q.text?'<details><summary>Original prompt / transcript</summary><p>'+esc(q.reference)+'</p></details>':'')+'</section>';
      node.innerHTML='<section class="sm-question-review"><header class="sm-review-heading"><div><p class="sm-eyebrow">'+esc(answerLabel(response))+' · Question '+esc(answers().findIndex(r=>r.index===index)+1)+' of '+esc(a.questionCount)+'</p><h3 id="sm-review-heading" tabindex="-1">'+esc(q.title||labels[q.type])+'</h3></div><nav class="sm-review-pagination" aria-label="Review another question"><button class="portal-button" data-sm="review-step" data-step="-1"'+(position<=0?' disabled':'')+'>Previous</button><button class="portal-button" data-sm="review-step" data-step="1"'+(position>=visible.length-1?' disabled':'')+'>Next</button></nav></header><div class="sm-response-layout">'+stimulus+'<section class="sm-response-detail"><section class="sm-student-audio"><h4>Your recording</h4><div id="sm-review-audio">'+(response.recording?'<p class="sm-muted">Loading your recording…</p>':'<p class="sm-muted">No recording was saved for this question.</p>')+'</div></section><div id="sm-review-feedback">'+reviewFeedback(response)+'</div></section></div></section>';
      reviewSignature=JSON.stringify([response.exclusion,response.deliveryOutcome,response.content,response.providers,response.transcript,reportProvider,responsePane]);updateQuestionNavigation();updateReportState();
      if(focus){node.scrollIntoView?.({behavior:env.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches?'auto':'smooth',block:'start'});doc.getElementById('sm-review-heading')?.focus?.({preventScroll:true});}
      if(response.recording){try{
        const audioKey=key(id,index);let url=urls.get(audioKey);if(!url){const reply=await env.fetch('/api/speaking-mocks/attempts/'+id+'/recordings/'+index,{headers:{'x-session-token':token()},cache:'no-store'});if(!reply.ok)throw Error('Recording could not load.');const blob=await reply.blob();if(!valid(ticket)||a?.id!==id||selected!==index||audioTicket!==reviewAudioTicket)return;url=env.URL.createObjectURL(blob);urls.set(audioKey,url);}
        if(valid(ticket)&&a?.id===id&&selected===index&&audioTicket===reviewAudioTicket){const slot=doc.getElementById('sm-review-audio');if(slot)slot.innerHTML='<audio controls preload="metadata" src="'+esc(url)+'" aria-label="Your recorded response"></audio>';}
      }catch(error){if(valid(ticket)&&a?.id===id&&selected===index&&audioTicket===reviewAudioTicket){const slot=doc.getElementById('sm-review-audio');if(slot)slot.innerHTML='<p class="sm-muted">Your recording could not load. Select this question again to retry.</p>';}}}
    }
    function pollResults(){
      if(a.grading?.status==='complete'&&a.combinedRecovery?.status!=='processing'&&a.providerComparisonStatus!=='processing'){stopPolling();return;}if(poller)return;pollUntil=now()+20*60000;
      pollFailures=0;nextPollAt=0;
      poller=env.setInterval(async()=>{if(pollBusy||doc.hidden||now()<nextPollAt)return;if(now()>pollUntil&&a.resultsReady!==false){stopPolling();message('Your recordings are saved. Reopen these results to check for the remaining scores.');return;}const ticket=serial,id=a.id,version=resultVersion;pollBusy=true;
        try{if(a.resultsReady===false){const progress=await api('/attempts/'+id+'/status');if(!valid(ticket)||a?.id!==id||version!==resultVersion)return;if(!progress.ready){a.resultStatus=progress;updatePreparing();pollFailures=0;return;}}const saved=await api('/attempts/'+id);if(!valid(ticket)||a?.id!==id||version!==resultVersion)return;const wasPreparing=a.resultsReady===false;a=saved;if(wasPreparing)results();else updateResults();if(pollFailures)message('');pollFailures=0;if(a.grading?.status==='complete'&&a.combinedRecovery?.status!=='processing'&&a.providerComparisonStatus!=='processing')stopPolling();}
        catch(error){if(!valid(ticket)||a?.id!==id||version!==resultVersion)return;if(error.retryable){nextPollAt=now()+Math.min(30000,3000*2**Math.min(pollFailures++,4));message('Connection interrupted. Your recordings are saved; retrying results automatically…');}else{stopPolling();message(error.message);}}finally{pollBusy=false;}
      },3000);
    }
    async function click(event){const button=event.target.closest('[data-sm]');if(!button||button.disabled)return;const data=button.dataset;
      if(data.sm==='start')return start(data.paper);
      if(data.sm==='reattempt')return start(null,data.id);
      if(data.sm==='resume')return resume(data.id);
      if(data.sm==='next')return next();
      if(data.sm==='section'){if(['overview','answers','analysis','next'].includes(data.section)){reportSection=data.section;updateReportState();if(reportSection==='next')updateNextSteps();}return;}
      if(data.sm==='response-pane'){if(['feedback','transcript','sample'].includes(data.pane)){responsePane=data.pane;refreshReviewFeedback();doc.getElementById('sm-response-tab-'+data.pane)?.focus?.({preventScroll:true});}return;}
      if(data.sm==='zoom-image')return showImage();
      if(data.sm==='close-image'){doc.getElementById('sm-image-dialog')?.close?.();return;}
      if(data.sm==='sample'){responsePane='sample';reportSection='answers';return review(Number(data.index),{focus:true});}
      if(data.sm==='review'){reportSection='answers';
        const response=answers().find(r=>r.index===Number(data.index));if(response&&reportFilter!=='all'&&response.question.type!==reportFilter)reportFilter=response.question.type;
        return review(Number(data.index),{focus:true});
      }
      if(data.sm==='filter'){reportSection='answers';reportFilter=Object.hasOwn(labels,data.type)&&data.type!=='intro'?data.type:'all';updateResults();return;}
      if(data.sm==='review-step'){const list=visibleAnswers(),position=list.findIndex(r=>r.index===selected),next=list[position+Number(data.step)];if(next)return review(next.index);return;}
      if(data.sm==='check-record')return recordCheck();
      if(data.sm==='check-play')return playCheck();
      if(data.sm==='check-begin')return beginMock();
      if(data.sm==='play'){if(flow?.ended&&a?.timing.playbackDriven)return finishPrompt();played='';return playPrompt();}
      if(data.sm==='upload'){const blob=await pending('get',key(a.id,a.index));if(blob)try{await upload(blob,a.id,a.index);}catch(error){message(error.message);}return;}
      if(data.sm==='retry'){
        if(busy||!a)return;busy=true;button.disabled=true;stopPolling();const ticket=serial,id=a.id,version=++resultVersion;
        try{const saved=await api('/attempts/'+id+'/retry',{});if(!valid(ticket)||a?.id!==id||version!==resultVersion)return;a=saved;message('');updateResults();pollResults();}
        catch(error){if(valid(ticket)&&a?.id===id&&version===resultVersion){message(error.retryable?'The retry request was interrupted. Your recordings are saved; checking the results automatically…':error.message);if(error.retryable)pollResults();}}
        finally{busy=false;button.disabled=false;}return;
      }
      if(data.sm==='history'||data.sm==='reload')return open({history:data.sm==='history'});
    }
    return {open,leave,reset};
  }
  return {createController,clock};
});
