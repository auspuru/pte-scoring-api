(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.SpeakingPractice=api.createController(root,{getUserId:()=>typeof currentUserId==='undefined'?'':currentUserId});
})(typeof globalThis==='undefined'?this:globalThis,function(){
  'use strict';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const time=n=>{const seconds=Math.ceil(Math.max(0,n));return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');};
  function createController(env,{getUserId=()=>env.currentUserId||''}={}) {
    const doc=env.document,now=()=>env.Date?env.Date.now():Date.now(),pendingUploads=new Map();
    let host,catalog,owner='',activeType='',attempt=null,serial=0,visible=false,busy=false,saveQueue=Promise.resolve();
    let phase='idle',deadline=0,clockId,promptAudio,stream,recorder,playbackUrl='',uploadBlob=null,notice='';
    let captureGeneration=0,levelContext,levelTimer,permissionTimer;
    const token=()=>{try{return env.sessionStorage.getItem('pte_impersonate_token')||env.localStorage.getItem('pte_session_token')||'';}catch{return '';}};
    const identity=()=>String(getUserId()||'').trim().toLowerCase();
    const localKey=a=>'ipt-speaking:'+owner+':'+a.id;
    const message=text=>{notice=text;const node=doc.getElementById('speaking-notice');if(node)node.textContent=text;};
    const valid=(ticket,user)=>serial===ticket&&identity()===user&&owner===user;
    async function api(url,body,raw=false) {
      const headers={'x-session-token':token()};if(body!==undefined)headers['Content-Type']=raw?body.type.split(';')[0]:'application/json';
      const r=await env.fetch('/api/speaking'+url,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:raw?body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(90000)});
      const data=await r.json().catch(()=>({error:'The connection was interrupted. Please retry.'}));
      if(!r.ok)throw Error(data.error||'The request could not finish. Please retry.');return data;
    }
    function cacheDraft() {
      const editor=doc.getElementById('speaking-transcript');if(!attempt||attempt.status==='submitted'||!editor)return;
      try{env.localStorage.setItem(localKey(attempt),JSON.stringify({text:editor.value,revision:attempt.revision}));}catch{message('Device draft saving is unavailable. Use Save transcript before leaving.');}
    }
    function draftText(a) {
      try{const local=JSON.parse(env.localStorage.getItem(localKey(a))||'null');if(local&&local.revision>=a.revision)return local.text;}catch{}
      return a.transcript||'';
    }
    function stopLevel() {
      env.clearInterval(levelTimer);levelTimer=null;
      if(levelContext){levelContext.close().catch(()=>{});levelContext=null;}
    }
    function monitorMicrophone() {
      const Context=env.AudioContext||env.webkitAudioContext;if(!Context)return;
      try {
        levelContext ||= new Context();levelContext.resume().catch(()=>{});
        const input=levelContext.createMediaStreamSource(stream),analyser=levelContext.createAnalyser();analyser.fftSize=256;input.connect(analyser);
        const data=new Uint8Array(analyser.fftSize);
        levelTimer=env.setInterval(()=>{
          analyser.getByteTimeDomainData(data);const level=Math.min(100,Math.round(Math.sqrt(data.reduce((sum,n)=>sum+Math.pow((n-128)/128,2),0)/data.length)*400));
          const meter=doc.getElementById('speaking-level');if(meter)meter.value=level;
          const label=doc.getElementById('speaking-mic-status');if(label)label.textContent=phase==='recording'?(level>3?'Voice detected — recording':'Recording — speak now; check your microphone if this bar stays still'):'Microphone connected — recording starts after preparation';
        },150);
      }catch{stopLevel();}
    }
    function clearAudio() {
      captureGeneration++;env.clearInterval(permissionTimer);stopLevel();
      env.clearInterval(clockId);promptAudio?.pause();promptAudio=null;
      if(recorder?.state==='recording')recorder.stop();
      stream?.getTracks().forEach(t=>t.stop());stream=null;
    }
    function releasePlayback(){if(playbackUrl)env.URL.revokeObjectURL(playbackUrl);playbackUrl='';}
    function reset() {
      cacheDraft();serial++;visible=false;owner='';attempt=null;activeType='';clearAudio();pendingUploads.clear();releasePlayback();uploadBlob=null;phase='idle';busy=false;
      if(host)host.replaceChildren();
    }
    function leave() {
      cacheDraft();if(attempt?.status==='draft'&&!busy)saveTranscript().catch(()=>{});
      visible=false;serial++;clearAudio();if(phase==='preparing'||phase==='listening')phase='idle';
    }
    function chrome(content) {
      const locked=!!(attempt&&attempt.status!=='submitted');
      host.innerHTML='<div class="speaking-workspace">'+(locked?'':'<button class="portal-button" data-speaking-action="practice">← Speaking Practice</button>')+'<p id="speaking-notice" role="status" aria-live="polite">'+esc(notice)+'</p>'+content+'</div>';
      host.onclick=click;host.oninput=()=>cacheDraft();host.onchange=change;
    }
    async function open(type, questionId) {
      const user=identity();if(!user)return;
      if(owner&&owner!==user)reset();owner=user;activeType=type;visible=true;host=doc.getElementById('speakingPane');
      const ticket=++serial;
      try{
        catalog=await api('/catalog');if(!valid(ticket,user)||!visible)return;
        if(!catalog.types[type])return;
        if(questionId){
          const target=catalog.questions.find(q=>String(q.id)===String(questionId)&&q.type===type);
          if(!target){chrome('<h2>'+esc(catalog.types[type].name)+'</h2><p>This assigned question is no longer available.</p><button class="portal-button" data-speaking-action="list">Open question list</button>');return;}
          if(attempt?.questionId===target.id){render();return;}
          attempt=null;releasePlayback();phase='idle';await start(target.id);return;
        }
        if(attempt?.question.type===type){render();return;}
        attempt=null;releasePlayback();phase='idle';await library();
      }catch(e){if(valid(ticket,user)){chrome('<h2>Speaking practice</h2><p>'+esc(e.message)+'</p><button class="portal-button" data-speaking-action="reload">Retry</button>');}}
    }
    async function library() {
      const type=activeType,ticket=serial,user=owner;
      chrome('<p class="portal-eyebrow">Speaking Practice</p><h2>'+esc(catalog.types[type].name)+'</h2><p class="speaking-footnote speaking-exam-disclosure">Exam-style mode: selecting a question starts the timed flow and requests microphone access. Your saved recording is automatically processed for transcription and practice scoring when those services are enabled.</p><div class="speaking-question-list">'+catalog.questions.filter(q=>q.type===type).map((q,i)=>'<article><div><span class="speaking-number">0'+(i+1)+'</span><h3>'+'Question '+(i+1)+'</h3></div><button class="portal-button primary" data-speaking-question="'+q.id+'">Practise →</button></article>').join('')+'</div><details class="speaking-card"><summary>My saved attempts</summary><div id="speaking-history">Loading…</div></details>');
      try{const history=await api('/attempts');if(!valid(ticket,user)||attempt||activeType!==type)return;const node=doc.getElementById('speaking-history');if(node)node.innerHTML=history.filter(a=>a.type===type).map(a=>'<article class="speaking-history-row"><div><strong>'+esc(a.title)+'</strong><p>'+esc(new Date(a.startedAt).toLocaleString())+' · '+(a.result?a.result.total+'/'+a.result.maximum+' content':a.status==='submitted'?'Feedback pending':'Saved draft')+'</p></div><button class="portal-button" data-speaking-attempt="'+a.id+'">'+(a.status==='submitted'?'Review':'Resume')+'</button></article>').join('')||'<p>Your attempts will appear here.</p>';}catch(e){const node=doc.getElementById('speaking-history');if(node)node.textContent=e.message;}
    }
    async function start(questionId) {
      if(busy)return;busy=true;message('Preparing your question…');const ticket=serial,user=owner;let shouldBegin=false;
      try{const a=await api('/attempts',{id:env.crypto.randomUUID(),questionId});if(!valid(ticket,user))return;clearAudio();releasePlayback();uploadBlob=null;attempt=a;phase='idle';notice='';render();shouldBegin=true;}catch(e){message(e.message);}finally{busy=false;refreshControls();}
      if(shouldBegin&&valid(ticket,user)&&attempt?.status==='draft'&&!attempt.recording)await begin();
    }
    async function resume(id) {
      if(busy)return;busy=true;const ticket=serial,user=owner;let shouldBegin=false,shouldAssess=false;
      try{const a=await api('/attempts/'+id);if(!valid(ticket,user))return;clearAudio();releasePlayback();uploadBlob=pendingUploads.get(a.id)||null;attempt=a;phase='idle';notice='';render();if(a.status==='submitted')await loadPlayback();else if(a.recording)shouldAssess=true;else shouldBegin=true;}catch(e){message(e.message);}finally{busy=false;refreshControls();}
      if(shouldAssess&&valid(ticket,user)&&attempt?.status==='draft'&&attempt.recording)await submit();
      else if(shouldBegin&&valid(ticket,user)&&attempt?.status==='draft'&&!attempt.recording)await begin();
    }
    async function loadPlayback() {
      if(!attempt?.recording||playbackUrl)return;const id=attempt.id,user=owner;
      const r=await env.fetch('/api/speaking/attempts/'+id+'/recording',{headers:{'x-session-token':token()},cache:'no-store'});
      if(!r.ok){message('Your recording could not load. Reopen the attempt to retry.');return;}
      const blob=await r.blob();if(attempt?.id!==id||identity()!==user)return;playbackUrl=env.URL.createObjectURL(blob);mountPlayback();
    }
    function mountPlayback() {
      const node=doc.getElementById('speaking-playback');if(!node)return;
      node.innerHTML=playbackUrl?'<audio controls src="'+playbackUrl+'" aria-label="Your recorded response"></audio><a class="portal-button" href="'+playbackUrl+'" download="'+attempt.questionId+'-response.'+(attempt.recording?.mime==='audio/mp4'?'mp4':attempt.recording?.mime==='audio/wav'?'wav':attempt.recording?.mime==='audio/mpeg'?'mp3':'webm')+'">Download for teacher review</a>':attempt.recording?'Your recording is saved. Loading playback…':'';
    }
    function questionNavigation() {
      const questions=catalog.questions.filter(q=>q.type===attempt.question.type),index=questions.findIndex(q=>q.id===attempt.questionId);
      return '<nav class="speaking-actions" aria-label="Practice questions"><button class="portal-button" data-speaking-move="-1" '+(index<=0?'disabled':'')+'>← Back</button><span>Question '+(index+1)+' of '+questions.length+'</span><button class="portal-button" data-speaking-move="1" '+(index>=questions.length-1?'disabled':'')+'>Next →</button></nav>';
    }
    async function moveQuestion(direction) {
      if(busy||uploadBlob||!['idle','error'].includes(phase)){message('Finish and save your recording before changing questions.');return;}
      const questions=catalog.questions.filter(q=>q.type===attempt.question.type),index=questions.findIndex(q=>q.id===attempt.questionId),target=questions[index+direction];
      if(!target)return;
      busy=true;const ticket=serial,user=owner;
      try {await saveTranscript();const history=await api('/attempts');if(!valid(ticket,user))return;
        const saved=history.filter(a=>a.questionId===target.id).sort((a,b)=>new Date(b.startedAt)-new Date(a.startedAt))[0];
        busy=false;if(saved)await resume(saved.id);else await start(target.id);
      }catch(e){message(e.message);}finally{busy=false;refreshControls();}
    }
    function render() {
      if(!attempt)return;const q=attempt.question,r=attempt.result,submitted=attempt.status==='submitted';
      const number=catalog.questions.filter(item=>item.type===q.type).findIndex(item=>item.id===q.id)+1;
      const examPanel=!submitted
        ? '<section class="speaking-card speaking-exam-panel">'
          +'<div class="speaking-exam-status"><div><span class="speaking-kicker">Exam mode</span><span id="speaking-phase" role="status"></span></div><strong id="speaking-clock"></strong></div>'
          +'<div id="speaking-level-panel" class="speaking-exam-mic" hidden><meter id="speaking-level" min="0" max="100" value="0"></meter><p id="speaking-mic-status" role="status">Microphone connected</p></div>'
          +'<div class="speaking-exam-actions"><button class="portal-button primary" data-speaking-action="skip" id="speaking-skip" hidden>Skip preparation</button><button class="portal-button primary" data-speaking-action="record" id="speaking-record" hidden>Retry microphone</button><button class="portal-button primary" data-speaking-action="submit" id="speaking-assess-retry" hidden>Retry assessment</button><button class="portal-button" data-speaking-action="upload-retry" id="speaking-upload-retry" hidden>Retry saving response</button></div>'
          +'<p class="speaking-exam-note">The microphone opens automatically when preparation ends. Recording stops automatically at the response limit.</p>'
          +'</section>'
        : '';
      const review=submitted
        ? '<div class="speaking-card speaking-recording-card"><div class="speaking-section-head"><div><span class="speaking-kicker">Recording</span><h3>Your response audio</h3></div>'+(catalog.deliveryAssessmentAvailable?'<span class="speaking-provider-badge">Audio assessment enabled</span>':'')+'</div><div id="speaking-playback"></div>'+(catalog.deliveryAssessmentAvailable?'<p class="speaking-footnote">Your saved audio can be checked for pronunciation and oral fluency. Scores are independent practice estimates, not Pearson scores.</p>':'<p class="speaking-footnote">Pronunciation and oral fluency are currently available for teacher review only.</p>')+'</div>'
          +'<section class="speaking-card speaking-result-card">'+(r?feedback(r):'<div class="speaking-empty-result"><span class="speaking-kicker">Assessment</span><h3>Feedback is pending</h3><p>Your response is saved. Retry the assessment when ready.</p><button class="portal-button primary" data-speaking-action="submit">Retry assessment</button></div>')+'</section>'
          +'<details class="speaking-card speaking-collapsible"><summary><span><span class="speaking-kicker">Transcript</span><strong>Your response</strong></span><span aria-hidden="true">⌄</span></summary><p>'+esc(attempt.transcript||'No response supplied.')+'</p></details>'
          +'<details class="speaking-card speaking-collapsible speaking-sample"><summary><span><span class="speaking-kicker">Reference</span><strong>Sample response</strong></span><span aria-hidden="true">⌄</span></summary><p>'+esc(q.sample)+'</p>'+(q.reference&&!['ra','rts'].includes(q.type)?'<details class="speaking-inner-details"><summary>Prompt transcript</summary><p>'+esc(q.reference).replace(/\n/g,'<br>')+'</p></details>':'')+'</details>'
          +'<div class="speaking-result-actions"><button class="portal-button primary" data-speaking-question="'+q.id+'">Reattempt this question</button><button class="portal-button" data-speaking-action="list">Back to my questions</button></div>'
          +questionNavigation()
        : '';
      chrome('<div class="speaking-heading"><div><p class="portal-eyebrow">'+esc(q.name)+'</p><h2>Question '+number+'</h2></div>'+(submitted?'<button class="portal-button" data-speaking-action="list">My questions</button>':'')+'</div><p class="speaking-intro">'+esc(q.instruction)+'</p>'
        +(q.text?'<div class="speaking-card speaking-prompt">'+esc(q.text)+'</div>':'')+(q.imageUrl?'<img class="speaking-image" src="'+q.imageUrl+'" alt="'+esc(q.title)+' — describe the visual and its labelled data">':'')
        +examPanel+review);
      if(submitted)mountPlayback();refreshControls();
    }
    function feedback(r) {
      const list=items=>'<ul>'+items.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul>';
      const scoreCard=(label,value,kind,detail='')=>{
        const ready=value&&value.score!==null&&value.score!==undefined&&Number.isFinite(Number(value.score));
        return '<article class="speaking-metric '+kind+(ready?' is-ready':' is-pending')+'"><span class="speaking-metric-label">'+esc(label)+'</span>'
          +(ready?'<div class="speaking-metric-value"><strong>'+esc(value.score)+'</strong><span>/ '+esc(value.maximum||5)+'</span></div>':'<div class="speaking-metric-value speaking-metric-pending">—</div>')
          +(detail?'<small>'+detail+'</small>':'')+'</article>';
      };
      const staleDelivery=!!(catalog.deliveryVersion&&r.deliveryVersion&&catalog.deliveryVersion!==r.deliveryVersion);
      const pronunciationCurrent=!staleDelivery?r.pronunciation:null,fluencyCurrent=!staleDelivery?r.fluency:null;
      const pronunciationReady=!!(pronunciationCurrent&&pronunciationCurrent.score!==null&&pronunciationCurrent.score!==undefined&&Number.isFinite(Number(pronunciationCurrent.score)));
      const fluencyReady=!!(fluencyCurrent&&fluencyCurrent.score!==null&&fluencyCurrent.score!==undefined&&Number.isFinite(Number(fluencyCurrent.score)));
      const deliveryReady=pronunciationReady&&fluencyReady;
      const pronunciationDetail=deliveryReady&&Number.isFinite(Number(pronunciationCurrent.raw))?esc(Math.round(Number(pronunciationCurrent.raw)))+'/100 acoustic score':'';
      const fluencyDetail=deliveryReady&&Number.isFinite(Number(fluencyCurrent.raw))?esc(Math.round(Number(fluencyCurrent.raw)))+'/100 acoustic score':'';
      const evidence=r.deliveryEvidence||{};
      const evidenceNote=evidence.coverage!==null&&evidence.coverage!==undefined&&Number.isFinite(Number(evidence.coverage))
        ? '<div class="speaking-delivery-summary"><span>Matched <strong>'+esc(evidence.matchedWords)+' / '+esc(evidence.referenceWords)+' words</strong></span><span>Audio <strong>'+esc(evidence.durationSeconds)+'s</strong></span></div>'
        : (Number.isFinite(Number(evidence.spokenWords))?'<div class="speaking-delivery-summary"><span>Spoken words <strong>'+esc(evidence.spokenWords)+'</strong></span><span>Audio <strong>'+esc(evidence.durationSeconds)+'s</strong></span></div>':'');
      const deliveryStatus=staleDelivery
        ? '<div class="speaking-delivery-callout"><div><strong>Delivery scoring has been recalibrated</strong><p>Update this saved recording to use the current pronunciation and oral-fluency method.</p></div><button class="portal-button" data-speaking-action="submit">Update audio score</button></div>'
        : deliveryReady
          ? '<div class="speaking-delivery-summary">'
            +(Number.isFinite(Number(pronunciationCurrent.accuracy))?'<span>Accuracy <strong>'+esc(Math.round(Number(pronunciationCurrent.accuracy)))+'/100</strong></span>':'')
            +(Number.isFinite(Number(pronunciationCurrent.prosody))?'<span>Prosody <strong>'+esc(Math.round(Number(pronunciationCurrent.prosody)))+'/100</strong></span>':'')
            +'</div>'
            +(pronunciationCurrent.words?.length?'<div class="speaking-practice-words"><h4>Words to practise</h4><div class="speaking-word-diff">'+pronunciationCurrent.words.map(w=>'<span class="replacement">'+esc(w.word)+(Number.isFinite(Number(w.accuracy))?' · '+esc(Math.round(Number(w.accuracy)))+'/100':'')+'</span>').join('')+'</div></div>':'')
          : '<div class="speaking-delivery-callout speaking-delivery-insufficient"><div><strong>Not enough speech for a reliable delivery score</strong><p>'+esc(r.deliveryStatus||'Pronunciation and oral fluency are withheld when the response is too short or incomplete to assess reliably.')+'</p></div></div>'+evidenceNote;
      const mistakes=r.changes?r.changes.filter(c=>c.kind!=='correct'):[];
      const comparison=r.changes
        ? '<div class="speaking-comparison"><h4>Word accuracy</h4>'
          +(mistakes.length?'<div class="speaking-word-diff speaking-word-errors">'+mistakes.map(c=>'<span class="'+c.kind+'" title="'+esc(c.kind)+'">'+(c.kind==='replacement'?esc(c.actual)+' → '+esc(c.expected):c.kind==='omission'?'Missing: '+esc(c.expected):'Extra: '+esc(c.actual))+'</span>').join('')+'</div>':'<p class="speaking-success-note">All reference words matched.</p>')
          +'<details class="speaking-inner-details"><summary>View full word-by-word comparison</summary><div class="speaking-word-diff">'+r.changes.map(c=>'<span class="'+c.kind+'" title="'+esc(c.kind)+'">'+(c.kind==='replacement'?esc(c.actual)+' → '+esc(c.expected):c.kind==='omission'?'Missing: '+esc(c.expected):c.kind==='insertion'?'Extra: '+esc(c.actual):esc(c.actual))+'</span>').join('')+'</div></details></div>'
        : '';
      return '<div class="speaking-result-head"><div><span class="speaking-kicker">Your result</span><h3>'+esc(r.overview)+'</h3></div><span class="speaking-result-label">Practice estimate</span></div>'
        +'<div class="speaking-metrics">'
          +scoreCard('Content',{score:r.total,maximum:r.maximum},'content')
          +scoreCard('Pronunciation',pronunciationCurrent,'pronunciation',pronunciationDetail)
          +scoreCard('Oral fluency',fluencyCurrent,'fluency',fluencyDetail)
        +'</div>'
        +deliveryStatus
        +'<div class="speaking-feedback-grid">'
          +(r.strengths.length?'<section><h4>What you did well</h4>'+list(r.strengths)+'</section>':'')
          +(r.improvements.length?'<section><h4>Your next step</h4>'+list(r.improvements)+'</section>':'')
        +'</div>'
        +(r.coverage?'<div class="speaking-coverage">'+r.coverage.map(c=>'<article><span class="speaking-status '+c.status+'">'+esc(c.status)+'</span><h4>'+esc(c.point)+'</h4>'+(c.evidence?'<blockquote>“'+esc(c.evidence)+'”</blockquote>':'')+'<p>'+esc(c.feedback)+'</p></article>').join('')+'</div>':'')
        +comparison
        +'<p class="speaking-result-disclaimer">'+esc(r.deliveryAssessment||'Content and delivery scores are independent practice estimates and are not Pearson scores.')+'</p>';
    }
    function refreshControls() {
      const retryMic=doc.getElementById('speaking-record'),skip=doc.getElementById('speaking-skip'),retrySave=doc.getElementById('speaking-upload-retry'),retryAssess=doc.getElementById('speaking-assess-retry');
      const levelPanel=doc.getElementById('speaking-level-panel');if(levelPanel)levelPanel.hidden=!stream;
      if(skip)skip.hidden=phase!=='preparing';
      if(retrySave)retrySave.hidden=!(uploadBlob&&!attempt?.recording&&!busy);
      if(retryAssess)retryAssess.hidden=!(attempt?.recording&&attempt?.status!=='submitted'&&phase==='error'&&!uploadBlob&&!busy);
      if(retryMic){
        const technicalRetry=phase==='error'&&!attempt?.recording&&!uploadBlob;
        retryMic.hidden=!technicalRetry;
        retryMic.textContent=stream&&attempt?.question.audioUrl?'Play prompt':'Retry microphone';
        retryMic.disabled=busy;
      }
      const phaseNode=doc.getElementById('speaking-phase');
      if(phaseNode)phaseNode.textContent={
        idle:attempt?.recording?'Response saved':'Preparing attempt…',
        permission:'Microphone check',
        listening:'Listening',
        preparing:'Preparation',
        recording:'● Recording',
        saving:'Submitting response',
        error:attempt?.recording?'Assessment interrupted':'Attempt interrupted'
      }[phase]||'';
      const clock=doc.getElementById('speaking-clock');if(clock)clock.textContent=['recording','preparing'].includes(phase)?time((deadline-now())/1000):'';
    }
    function countdown(seconds,next) {deadline=now()+seconds*1000;env.clearInterval(clockId);refreshControls();clockId=env.setInterval(()=>{refreshControls();if(now()>=deadline){env.clearInterval(clockId);next();}},200);}
    function prepare(){if(!visible){clearAudio();phase='idle';return;}phase='preparing';if(attempt.question.preparation)countdown(attempt.question.preparation,record);else record();}
    function record() {
      env.clearInterval(clockId);if(!visible||doc.hidden||!stream){clearAudio();phase='idle';refreshControls();return;}
      if(stream.getAudioTracks?.().some(track=>track.readyState==='ended')){clearAudio();phase='error';message('Microphone disconnected. Reconnect it, then use Retry microphone.');refreshControls();return;}
      const id=attempt.id,user=owner,chunks=[],capturedStream=stream;
      let activeRecorder;
      // Some browsers advertise a format that their recorder cannot initialise.
      // Try each supported format, then the browser's native default.
      const formats=['audio/webm;codecs=opus','audio/mp4','audio/webm'];
      for(const mime of [...formats,null]) {
        try {
          if(mime&&typeof env.MediaRecorder.isTypeSupported==='function'&&!env.MediaRecorder.isTypeSupported(mime))continue;
          const candidate=new env.MediaRecorder(capturedStream,mime?{mimeType:mime,audioBitsPerSecond:64000}:undefined);
          const output=(candidate.mimeType||mime||'').split(';')[0];
          if(output&&!['audio/webm','audio/mp4','audio/wav','audio/mpeg'].includes(output))continue;
          candidate.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
          candidate.onstop=async()=>{
            env.clearInterval(clockId);stopLevel();capturedStream.getTracks().forEach(t=>t.stop());if(stream===capturedStream)stream=null;
            if(owner!==user||identity()!==user)return;
            const type=(candidate.mimeType||chunks[0]?.type||mime||'audio/webm').split(';')[0];
            const captured=new env.Blob(chunks,{type});
            if(captured.size<100){if(attempt?.id===id){phase='error';message('No audio was captured. Check microphone access, then use Retry microphone.');refreshControls();}return;}
            pendingUploads.set(id,captured);
            if(attempt?.id===id){uploadBlob=captured;phase='saving';releasePlayback();playbackUrl=env.URL.createObjectURL(captured);mountPlayback();refreshControls();}
            await uploadRecording(id,user,captured);
          };
          candidate.onerror=()=>{message('Recording was interrupted. Saving any captured audio…');if(candidate.state==='recording')candidate.stop();else{clearAudio();phase='error';refreshControls();}};
          candidate.start();activeRecorder=candidate;break;
        }catch{chunks.length=0;}
      }
      if(!activeRecorder){clearAudio();phase='error';message('This browser could not start recording. Open the portal in Safari or Chrome, allow microphone access, then use Retry microphone.');refreshControls();return;}
      recorder=activeRecorder;phase='recording';message('Recording has started. Speak now. It will stop automatically when the response time ends.');countdown(attempt.question.seconds,()=>{if(activeRecorder.state==='recording')activeRecorder.stop();});
    }
    async function playPrompt(ticket,user) {
      phase='listening';promptAudio=new env.Audio(attempt.question.audioUrl);
      promptAudio.onended=()=>{if(valid(ticket,user)&&visible)prepare();};
      promptAudio.onerror=()=>{clearAudio();phase='error';message('The prompt recording could not load. Retry when ready.');refreshControls();};
      try {await promptAudio.play();refreshControls();}
      catch(e){if(!valid(ticket,user))return;if(e.name==='NotAllowedError'){promptAudio.pause();phase='error';message('Your browser blocked automatic prompt audio. Use Play prompt once to continue this attempt.');refreshControls();}else{clearAudio();phase='error';message('The prompt could not play. Check your audio output and retry.');refreshControls();}}
    }
    async function begin() {
      if(busy||attempt.recording||uploadBlob||!['idle','error'].includes(phase))return;
      if(!env.navigator.mediaDevices?.getUserMedia||!env.MediaRecorder){phase='error';message('Microphone recording is unavailable in this browser. Open this HTTPS portal directly in Safari or Chrome.');refreshControls();return;}
      if(stream&&attempt.question.audioUrl){levelContext?.resume().catch(()=>{});return playPrompt(serial,owner);}
      try{const Context=env.AudioContext||env.webkitAudioContext;if(Context){levelContext ||= new Context();levelContext.resume().catch(()=>{});}}catch{}
      const ticket=serial,user=owner,capture=++captureGeneration;phase='permission';message('Allow microphone access when your browser asks.');refreshControls();
      const requestedAt=now();env.clearInterval(permissionTimer);
      permissionTimer=env.setInterval(()=>{if(now()-requestedAt<20000)return;env.clearInterval(permissionTimer);if(capture!==captureGeneration)return;captureGeneration++;stopLevel();phase='error';message('Microphone access is still waiting. Allow the microphone in your browser’s site settings, then use Retry microphone.');refreshControls();},500);
      try{
        const mic=await env.navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
        if(capture!==captureGeneration||!valid(ticket,user)||!visible||doc.hidden){mic.getTracks().forEach(t=>t.stop());if(capture===captureGeneration){phase='idle';refreshControls();}return;}
        env.clearInterval(permissionTimer);stream=mic;monitorMicrophone();
        for(const track of mic.getAudioTracks?.()||[])track.onended=()=>{if(stream===mic){message('Microphone disconnected. Any captured response will be saved.');if(recorder?.state==='recording')recorder.stop();else{clearAudio();phase='error';refreshControls();}}};
        if(attempt.question.audioUrl)await playPrompt(ticket,user);else prepare();
      }catch(e){if(capture!==captureGeneration)return;clearAudio();phase='error';message(e.name==='NotAllowedError'?'Microphone access was not allowed. Allow Microphone in your browser’s settings for this site, then retry. If using an in-app browser, open the portal in Safari or Chrome.':e.name==='NotFoundError'?'No microphone was found. Connect a microphone and retry.':e.name==='NotReadableError'?'The microphone is busy or unavailable. Close other apps using it, then retry.':'Audio could not start. Check your microphone and try again.');refreshControls();}
    }
    async function uploadRecording(id=attempt.id,user=owner,blob=uploadBlob) {
      if(owner!==user||identity()!==user)return;
      if(!blob||blob.size<100){phase='error';message('No usable recording was captured. Use Retry microphone.');refreshControls();return;}
      if(blob.size>3*1024*1024){phase='error';message('The captured response is too large to save. Reattempt this question from the question list.');refreshControls();return;}
      pendingUploads.set(id,blob);busy=true;phase='saving';message('Saving and checking your response…');refreshControls();
      try{
        const saved=await api('/attempts/'+id+'/recording',blob,true);
        if(owner!==user||identity()!==user||attempt?.id!==id)return;
        pendingUploads.delete(id);attempt=saved;releasePlayback();playbackUrl=env.URL.createObjectURL(blob);uploadBlob=null;
        message('Checking your response…');
        const assessed=await api('/attempts/'+id+'/submit',{});
        if(owner!==user||identity()!==user||attempt?.id!==id)return;
        attempt=assessed;phase='idle';notice='';render();
        if(typeof env.CustomEvent==='function')env.dispatchEvent?.(new env.CustomEvent('pte:attempt-completed',{detail:{engine:'speaking',questionId:assessed.questionId}}));
      }catch(e){
        if(attempt?.id!==id)return;
        phase='error';
        if(attempt?.recording){message(e.message+' Your recording is saved; use Retry assessment.');render();}
        else message(e.message+' Your captured response is still on this page; use Retry saving response.');
      }finally{busy=false;refreshControls();}
    }
    function saveTranscript() {
      const a=attempt,editor=doc.getElementById('speaking-transcript'),user=owner,text=editor?.value;
      if(!a||a.status==='submitted'||text===undefined)return Promise.resolve();cacheDraft();
      const task=saveQueue.catch(()=>{}).then(async()=>{if(identity()!==user||owner!==user)return;if(a.transcript===text)return;const saved=await api('/attempts/'+a.id+'/transcript',{text,revision:a.revision});a.transcript=saved.transcript;a.revision=saved.revision;if(attempt?.id===a.id){attempt.transcript=saved.transcript;attempt.revision=saved.revision;}try{const local=JSON.parse(env.localStorage.getItem(localKey(a))||'null');if(local?.text===text)env.localStorage.removeItem(localKey(a));}catch{}});saveQueue=task;return task;
    }
    async function submit() {
      if(busy||!attempt)return;
      if(['permission','listening','preparing','recording','saving'].includes(phase)||uploadBlob){message('The timed response is still in progress.');return;}
      if(!attempt.recording){message('No saved recording is available for assessment.');return;}
      busy=true;phase='saving';refreshControls();const id=attempt.id,user=owner;message('Checking your saved response…');
      try{
        const a=await api('/attempts/'+id+'/submit',{});
        if(owner===user&&identity()===user&&attempt?.id===id){attempt=a;phase='idle';notice='';render();if(typeof env.CustomEvent==='function')env.dispatchEvent?.(new env.CustomEvent('pte:attempt-completed',{detail:{engine:'speaking',questionId:a.questionId}}));}
      }catch(e){
        phase='error';message(e.message+' Your recording is saved; use Retry assessment.');
        try{const a=await api('/attempts/'+id);if(owner===user&&identity()===user&&attempt?.id===id){attempt=a;render();}}catch{}
      }finally{busy=false;refreshControls();}
    }
    async function click(e) {
      const b=e.target.closest('button');if(!b||b.disabled)return;const d=b.dataset;
      if(d.speakingMove!==undefined)return moveQuestion(Number(d.speakingMove));
      if(d.speakingQuestion)return start(d.speakingQuestion);if(d.speakingAttempt)return resume(d.speakingAttempt);
      const action=d.speakingAction;
      if(action==='practice'){leave();env.switchSection('practice-hub');return;}
      if(action==='reload')return open(activeType);
      if(action==='record')return begin();
      if(action==='skip')return record();if(action==='upload-retry')return uploadRecording();if(action==='submit')return submit();
      if(action==='list'){if(['permission','listening','preparing','recording','saving'].includes(phase)||busy||uploadBlob){message('Finish and save the recording before opening your question list.');return;}try{await saveTranscript();attempt=null;releasePlayback();await library();}catch(e){message(e.message);}return;}
      if(action==='save'){try{await saveTranscript();message('Transcript saved to your account.');}catch(e){message(e.message);}return;}
      if(action==='transcribe'){if(busy)return;if(doc.getElementById('speaking-transcript')?.value.trim()){message('Your transcript already contains words. Review them, or clear and save it before transcribing.');return;}busy=true;refreshControls();message('Transcribing. Please keep the words you actually said.');const id=attempt.id,user=owner;try{await saveTranscript();const a=await api('/attempts/'+id+'/transcribe',{});if(owner===user&&identity()===user&&attempt?.id===id){attempt=a;render();message('Check the transcript against your recording before assessment.');}}catch(e){message(e.message);}finally{busy=false;refreshControls();}}
    }
    async function change(e) {
      if(e.target.id!=='speaking-file')return;const file=e.target.files?.[0];if(!file||busy||attempt.recording)return;
      if(!['audio/webm','audio/mp4','audio/wav','audio/mpeg'].includes(file.type.split(';')[0])||file.size>3*1024*1024){message('Choose a WebM, MP4, WAV or MP3 audio file under 3 MB.');return;}
      uploadBlob=file;await uploadRecording();
    }
    doc.addEventListener('visibilitychange',()=>{if(doc.hidden&&visible){cacheDraft();const interrupted=['listening','preparing','permission'].includes(phase);clearAudio();if(interrupted){phase='error';message('This timed attempt was interrupted when the tab was hidden. Return here and use Retry microphone to restart the question flow.');}refreshControls();}});
    env.addEventListener?.('beforeunload',()=>{cacheDraft();clearAudio();});
    return {open,leave,reset};
  }
  return {createController,esc,time};
});
