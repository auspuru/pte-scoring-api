(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SpeakingMock=api.createController(root,{getUserId:()=>typeof currentUserId==='undefined'?'':currentUserId});})(typeof globalThis==='undefined'?this:globalThis,function(){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clock=value=>{const s=Math.max(0,Math.ceil(value));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
  const labels={intro:'Introduction',ra:'Read Aloud',rs:'Repeat Sentence',di:'Describe Image',rl:'Retell Lecture',sgd:'Summarise Group Discussion',rts:'Respond to a Situation'};
  function createController(env,{getUserId=()=>env.currentUserId||''}={}){
    const doc=env.document,OWNER='speaking-mock',memory=new Map(),done=new Set(),urls=new Map();
    let host,catalog,a,owner='',serial=0,busy=false,ending=false,stream,recorder,capture,recordingPromise,prompt,played='',timer,poller,pollBusy=false,pollUntil=0,pollFailures=0,nextPollAt=0,resultVersion=0,notice='',selected=null,reportFilter='all',reviewSignature='',reviewAudioTicket=0,context,analyser,silence=0,heard=false;
    const now=()=>env.Date?.now?.()||Date.now(),identity=()=>String(getUserId()||'').trim().toLowerCase();
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
        const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error||'The mock could not finish this action.'),{status:response.status,retryable:response.status===408||response.status===429||response.status>=500});return data;
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
    function release(){stopTimer();stopPrompt();if(recorder?.state==='recording')recorder.stop();stream?.getTracks().forEach(t=>t.stop());stream=null;analyser=null;context?.close?.().catch(()=>{});context=null;}
    function leave(){stopPolling();release();serial++;}
    function reset(){leave();a=null;owner='';selected=null;reportFilter='all';reviewSignature='';for(const url of urls.values())env.URL.revokeObjectURL(url);urls.clear();host?.replaceChildren();}
    function shell(html){host.innerHTML=html;host.onclick=click;host.oninput=e=>{if(e.target.id==='sm-volume'&&prompt)prompt.volume=Number(e.target.value);};}
    function protectedMode(){env.PortalExamMode?.set(OWNER,a?.status==='active',host,{onEvent:event=>{if(a)api('/attempts/'+a.id+'/integrity',{events:[event]}).catch(()=>{});},onLock:()=>{stopPrompt();played='';if(recorder?.state==='recording')recorder.stop();},onResume:()=>{if(a)refresh().catch(e=>message(e.message));}});}
    async function open(options={}){
      if(owner&&owner!==identity())reset();stopPolling();owner=identity();if(!owner)return;host=doc.getElementById('speakingMockPane');const ticket=++serial;
      shell('<p role="status">Loading speaking mocks…</p>');
      try{const values=await Promise.all([api('/catalog'),api('/attempts')]);if(!valid(ticket))return;catalog=values[0];hub(values[1],options);}
      catch(error){if(valid(ticket))shell('<p role="alert">'+esc(error.message)+'</p><button class="portal-button" data-sm="reload">Retry</button>');}
    }
    function hub(history,options={}){
      a=null;release();stopPolling();env.PortalExamMode?.set(OWNER,false,host);
      shell('<div class="sm-hub"><h2>'+(options.history?'Saved speaking mocks':'Speaking mock test')+'</h2><p>A timed speaking paper with saved prompt recordings and one chance to record each answer.</p>'
        +(options.history?'':catalog.papers.filter(p=>!options.paperId||p.id===options.paperId).map(p=>'<article class="sm-paper"><h3>'+esc(p.title)+'</h3><p>'+esc(p.scope)+'</p><p>'+p.questionCount+' scored questions · about '+p.minutes+' minutes · unscored introduction</p><p>Use headphones and a working microphone. Questions play once. Individual feedback appears after the test; your overall speaking estimate is assessed across the full set of recordings.</p><button class="portal-button primary" data-sm="start" data-paper="'+esc(p.id)+'">Start speaking mock</button></article>').join(''))
        +'<h3>Your saved attempts</h3>'+history.map(row=>'<article class="sm-history"><div><strong>'+esc(row.title)+'</strong><p>'+esc(new Date(row.startedAt).toLocaleString())+' · '+(row.status==='active'?'In progress':(row.combinedOverall?.overallScore??row.overall?.overallScore)!=null?esc(row.combinedOverall?.overallScore??row.overall.overallScore)+'/90 speaking estimate':row.grading?.status==='complete'?'Review available':'Assessment in progress')+'</p></div><button class="portal-button" data-sm="resume" data-id="'+esc(row.id)+'">'+(row.status==='active'?'Continue':'Review')+'</button>'+(row.status==='submitted'?'<button class="portal-button" data-sm="reattempt" data-id="'+esc(row.id)+'">Reattempt</button>':'')+'</article>').join('')+'<p id="sm-notice" role="status"></p></div>');
    }
    async function microphone(){
      if(stream)return;if(!env.MediaRecorder||!env.navigator?.mediaDevices?.getUserMedia)throw Error('This browser cannot record microphone audio. Use a supported browser for the speaking mock.');stream=await env.navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
      try{const Context=env.AudioContext||env.webkitAudioContext;if(Context){context=new Context();await context.resume();const source=context.createMediaStreamSource(stream);analyser=context.createAnalyser();analyser.fftSize=256;source.connect(analyser);}}catch{analyser=null;}
    }
    async function start(paperId,reattemptId){
      if(busy)return;busy=true;const ticket=serial;
      try{const ready=await env.PortalExamMode.prepare(OWNER,host);if(!ready||!valid(ticket))return;await microphone();if(!valid(ticket)){release();return;}
        const id=env.crypto.randomUUID();a=await api(reattemptId?'/attempts/'+reattemptId+'/reattempt':'/attempts',reattemptId?{id}:{id,paperId});if(!valid(ticket))return;stopPolling();selected=null;capture=null;recordingPromise=null;played='';await begin();
      }catch(error){message(error.message||'Microphone access is required to start the speaking mock.');env.PortalExamMode?.set(OWNER,false,host);release();}
      finally{busy=false;}
    }
    async function resume(id){
      if(busy)return;busy=true;const ticket=serial;
      try{const saved=await api('/attempts/'+id);if(!valid(ticket))return;
        if(saved.status==='active'){const ready=await env.PortalExamMode.prepare(OWNER,host);if(!ready||!valid(ticket))return;await microphone();if(!valid(ticket)){release();return;}}
        a=saved;selected=null;reportFilter='all';reviewSignature='';
        if(a.status==='active'){const blob=await pending('get',key(a.id,a.index));if(blob){done.add(key(a.id,a.index));await upload(blob,a.id,a.index);}await begin();}else results();
      }catch(error){message(error.message);env.PortalExamMode?.set(OWNER,false,host);}
      finally{busy=false;}
    }
    async function begin(){
      if(a.status!=='active'){results();return;}
      if(a.timing.phase==='ready')a=await api('/attempts/'+a.id+'/begin',{index:a.index});
      notice='';renderExam();protectedMode();stopTimer();timer=env.setInterval(tick,100);tick();
    }
    function renderExam(){
      const q=a.question;
      shell('<div class="sm-exam"><header class="sm-exam-header"><strong>IPT Brisbane · Speaking</strong><div><span id="sm-time">'+clock((a.deadline-now())/1000)+'</span><span>Item '+(a.index+1)+' of '+a.totalItems+'</span></div></header>'
        +'<main class="sm-exam-main"><p class="sm-instructions">'+esc(q.instruction)+'</p><div class="sm-question '+(q.type==='di'?'sm-visual':'')+'">'
        +'<div class="sm-stimulus">'+(q.text?'<p class="sm-passage">'+esc(q.text)+'</p>':'')+(q.imageUrl?'<img src="'+esc(q.imageUrl)+'" alt="Image to describe">':'')+'</div>'
        +'<div class="sm-controls">'+(q.audioUrl?'<section class="sm-audio-panel" aria-label="Prompt audio"><div>Status: <span id="sm-audio-status">Beginning shortly</span></div><label class="sm-volume">Volume <input id="sm-volume" aria-label="Prompt volume" type="range" min="0" max="1" step="0.1" value="1"></label><div class="sm-bar"><span id="sm-audio-bar"></span></div></section>':'')
        +'<section class="sm-record-panel" aria-label="Recorded answer"><strong>Recorded Answer</strong><p>Current Status:</p><div id="sm-record-status" role="status" aria-live="polite">Beginning shortly</div><div class="sm-bar"><span id="sm-record-bar"></span></div></section></div></div>'
        +'<p id="sm-notice" role="status">'+esc(notice)+'</p><button class="portal-button" data-sm="play" id="sm-play" hidden>Play remaining audio</button><button class="portal-button" data-sm="upload" id="sm-upload" hidden>Retry saving recording</button></main>'
        +'<footer class="sm-exam-footer"><span>'+esc(q.type==='intro'?'Personal Introduction · Not scored':labels[q.type])+'</span><button type="button" class="sm-next" data-sm="next" id="sm-next">Next <span aria-hidden="true">➜</span></button></footer></div>');
    }
    function beep(){try{if(!context)return;const tone=context.createOscillator(),gain=context.createGain();tone.frequency.value=1000;gain.gain.value=.07;tone.connect(gain);gain.connect(context.destination);tone.start();tone.stop(context.currentTime+.12);}catch{}}
    async function playPrompt(){
      if(!a?.question.audioUrl||env.PortalExamMode?.isLocked(OWNER))return;
      const clipKey=key(a.id,a.index);played=clipKey;stopPrompt();prompt=new env.Audio(a.question.audioUrl);
      const audio=prompt;audio.currentTime=Math.max(0,(now()-a.timing.audioAt)/1000);
      audio.onerror=()=>message('The prompt audio could not load. Check your connection before continuing.');
      try{await audio.play();}catch{const node=doc.getElementById('sm-play');if(node)node.hidden=false;message('Audio was blocked. Select Play remaining audio to continue.');}
    }
    function startRecording(){
      const captureKey=key(a.id,a.index);if(done.has(captureKey)||capture?.key===captureKey)return;
      const options=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(type=>env.MediaRecorder.isTypeSupported?.(type));
      try{
        recorder=new env.MediaRecorder(stream,options?{mimeType:options}:undefined);const activeRecorder=recorder,chunks=[],current={key:captureKey,id:a.id,index:a.index,ticket:serial};capture=current;
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
      stopTimer();stopPrompt();
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
      if(completed)text='Completed';else if(current<t.audioAt)text='Beginning in '+clock((t.recordingAt-current)/1000);else if(current<t.prepAt){text='Beginning in '+clock((t.recordingAt-current)/1000);if(played!==captureKey)playPrompt();}
      else if(current<t.recordingAt){stopPrompt();text='Beginning in '+clock((t.recordingAt-current)/1000);}
      else if(current<t.endsAt){stopPrompt();text='Recording';startRecording();}
      else{if(recorder?.state==='recording')recorder.stop();text=done.has(captureKey)?'Completed':'Recording period completed';}
      const status=doc.getElementById('sm-record-status');if(status&&status.textContent!==text)status.textContent=text;
      const bar=doc.getElementById('sm-record-bar');if(bar)bar.style.width=(completed?100:Math.max(0,Math.min(100,(current-t.recordingAt)/(q.seconds*10))))+'%';
      const audioStatus=doc.getElementById('sm-audio-status');if(audioStatus)audioStatus.textContent=current<t.audioAt?'Beginning shortly':current<t.prepAt?'Playing':'Completed';
      const audioBar=doc.getElementById('sm-audio-bar');if(audioBar)audioBar.style.width=Math.max(0,Math.min(100,(current-t.audioAt)/(q.audioSeconds*10)))+'%';
      if(analyser&&recorder?.state==='recording'){
        const data=new Uint8Array(analyser.fftSize);analyser.getByteTimeDomainData(data);const level=Math.sqrt(data.reduce((sum,n)=>sum+((n-128)/128)**2,0)/data.length);
        if(level>.015){heard=true;silence=0;}else if(heard){silence||=current;if(current-silence>=3000)recorder.stop();}
      }
    }
    async function next(){
      if(busy||!a||a.status!=='active')return;busy=true;const ticket=serial,id=a.id,index=a.index;
      try{
        if(recorder?.state==='recording')recorder.stop();if(recordingPromise&&capture?.id===id&&capture.index===index)await recordingPromise;
        const blob=await pending('get',key(id,index));if(blob)await upload(blob,id,index);
        const completed=a.timing.phase==='completed';
        if(!completed&&!env.confirm('No response is saved for this question. Continue without an answer?'))return;
        stopTimer();stopPrompt();a=await api('/attempts/'+id+'/next',{index,skip:!completed});if(!valid(ticket))return;
        capture=null;recordingPromise=null;if(a.status==='submitted'){release();results();}else await begin();
      }catch(error){message(error.message);}finally{busy=false;}
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
    function results(){
      env.PortalExamMode?.set(OWNER,false,host);stopTimer();stopPrompt();
      shell('<div class="sm-results"><header class="sm-results-heading"><div><p class="sm-eyebrow">Speaking score report</p><h2>'+esc(a.title)+'</h2><p class="sm-muted">Review your delivery, then compare each answer with its feedback.</p></div><div class="sm-results-actions"><button class="portal-button" data-sm="history">Saved speaking mocks</button><button class="portal-button" data-sm="reattempt" data-id="'+esc(a.id)+'">Reattempt this mock</button></div></header>'
        +'<div id="sm-results-summary" class="sm-summary-grid" aria-live="polite"></div><p id="sm-assessment-status" class="sm-assessment-status" role="status"></p>'
        +'<section class="sm-answer-review" aria-labelledby="sm-answers-heading"><div class="sm-review-toolbar"><div><h3 id="sm-answers-heading">Individual question feedback</h3><p class="sm-muted">Choose a question to see your response and feedback.</p></div>'+(answers().some(r=>r.question.type==='di')?'<button class="portal-button" data-sm="filter" data-type="di">Describe Image samples</button>':'')+'</div><div id="sm-task-filters" class="sm-task-filters" role="group" aria-label="Filter questions by task"></div>'
        +'<div class="sm-review-layout"><aside class="sm-question-nav" aria-label="Questions in this mock"><p id="sm-question-count" class="sm-muted"></p><div id="sm-question-list"></div></aside><div id="sm-review-details"></div></div></section>'
        +'<details class="sm-score-breakdown"><summary>Detailed score breakdown</summary><p class="sm-muted">GPT pronunciation / fluency and Azure pronunciation / fluency are independent assessments of each answer.</p><div class="sm-table-wrap"><table class="sm-table"><thead><tr><th scope="col">Question</th><th scope="col">Content</th><th scope="col">GPT pronunciation / fluency</th><th scope="col">Azure pronunciation / fluency</th><th scope="col">Review</th></tr></thead><tbody id="sm-result-rows"></tbody></table></div></details>'
        +'<footer class="sm-report-footer"><p id="sm-notice" role="status"></p><button class="portal-button" data-sm="retry">Retry unavailable scores</button><p class="sm-footnote">Independent practice estimates, not Pearson scores. The whole-test delivery estimate is assessed from your recordings, not averaged from the question marks above.</p></footer></div>');
      updateResults();pollResults();
    }
    function updateQuestionNavigation(){
      const all=answers(),visible=visibleAnswers(),filters=doc.getElementById('sm-task-filters'),list=doc.getElementById('sm-question-list'),count=doc.getElementById('sm-question-count');
      setMarkup(filters,[['all','All questions',all.length],...Object.entries(labels).filter(([type])=>type!=='intro').map(([type,label])=>[type,label,all.filter(r=>r.question.type===type).length])].filter(([, ,n])=>n).map(([type,label,n])=>'<button type="button" class="sm-task-filter" data-sm="filter" data-type="'+type+'" aria-pressed="'+(reportFilter===type)+'">'+esc(label)+' <span>'+n+'</span></button>').join(''));
      if(count)count.textContent=visible.length+' question'+(visible.length===1?'':'s')+(reportFilter==='all'?' in this mock':' in this task');
      setMarkup(list,visible.map(r=>'<button type="button" class="sm-question-link" data-sm="review" data-index="'+r.index+'" aria-current="'+(selected===r.index?'true':'false')+'"><span><strong>'+esc(answerLabel(r))+'</strong><small>'+esc(r.question.title||labels[r.question.type])+'</small></span><span class="sm-content-badge">'+(r.content?.total==null?(r.recording?(a.grading?.status==='complete'?'Unavailable':'Pending'):'Skipped'):esc(r.content.total)+'/'+esc(r.content.maximum))+'</span></button>').join(''));
    }
    function updateResults(){
      const overall=a.overall,azure=a.overallAzure,combined=a.combinedOverall,summary=doc.getElementById('sm-results-summary'),status=doc.getElementById('sm-assessment-status');
      const native=trait=>trait?.raw==null?'—':esc(trait.raw)+'/100';
      const overallNotes=[...new Set([overall?.pronunciation,overall?.fluency].filter(Boolean).map(t=>[t.reason,t.coaching||t.nextStep].filter(Boolean).join(' ')).filter(Boolean))];
      const azureSummary=!azure&&!catalog?.azureOverallAvailable?'':'<section class="sm-overall sm-azure-summary" aria-label="Azure whole-mock delivery"><p class="sm-provider-label">Azure Speech · whole-mock audio</p><div class="sm-native-scores"><div><span>Pronunciation accuracy</span><strong>'+native(azure?.pronunciation)+'</strong></div><div><span>Oral fluency</span><strong>'+native(azure?.fluency)+'</strong></div></div><p class="sm-trait-line">Portal practice bands: pronunciation '+score(azure?.pronunciation)+' · fluency '+score(azure?.fluency)+'</p><details><summary>About the Azure scores</summary><p>'+esc(azure?.summary||(a.grading?.status==='complete'?'Azure whole-mock scores are not available yet. Use Retry unavailable scores to assess the saved audio.':'Azure is assessing your saved recordings.'))+'</p><p>Native Azure acoustic scores, not a PTE score out of 90.</p></details></section>';
      const combinedSummary=combined?.status==='assessed'?'<section class="sm-overall sm-combined-summary" aria-label="Overall Speaking"><p class="sm-provider-label">Overall Speaking · content, pronunciation and fluency</p><strong class="sm-total-score">'+esc(combined.overallScore)+'<small>/90</small></strong><p class="sm-trait-line">Content '+esc(combined.content.score)+'/6 · Pronunciation '+score(combined.pronunciation)+' · Oral fluency '+score(combined.fluency)+'</p><p>'+esc(combined.summary)+'</p><p>'+esc(combined.contentReviewedCount)+' of '+esc(combined.questionCount)+' questions reviewed.</p><details><summary>How this score is calculated</summary><p>Independent whole-mock judgments: content 37.5%, pronunciation 31.25%, fluency 31.25%. Limited relevant content places a ceiling on the combined estimate. Individual question marks are not averaged.</p><p>Institute practice estimate, not a calibrated Pearson prediction.</p>'+(combined.content.nextSteps||[]).map(step=>'<p>'+esc(step)+'</p>').join('')+'</details></section>':'';
      setMarkup(summary,combinedSummary+'<section class="sm-overall sm-gpt-summary" aria-label="GPT overall delivery"><p class="sm-provider-label">GPT Audio · overall speaking delivery</p><strong class="sm-total-score">'+(overall?.overallScore==null?'—':esc(overall.overallScore)+'<small>/90</small>')+'</strong><p class="sm-trait-line">Pronunciation '+score(overall?.pronunciation)+' · Oral fluency '+score(overall?.fluency)+'</p><p>'+esc(overall?.summary||'Your full set of recordings is being reviewed together.')+'</p>'+(overallNotes.length?'<details><summary>Overall delivery feedback</summary>'+overallNotes.map(note=>'<p>'+esc(note)+'</p>').join('')+'</details>':'')+'</section>'+azureSummary);
      const recorded=a.completedCount??answers().filter(r=>r.recording).length,contentCount=answers().filter(r=>r.content?.total!=null).length;
      if(status)status.textContent=a.combinedRecovery?.status==='processing'?'Overall assessment in progress · checking every question.':a.grading?.status==='complete'?'Assessment finished · '+recorded+' of '+a.questionCount+' responses recorded · '+contentCount+' of '+a.questionCount+' content scores available.':'Assessment in progress. Your recordings are saved; you can leave and return to this report.';
      const rows=doc.getElementById('sm-result-rows');setMarkup(rows,answers().map(r=>'<tr><th scope="row">'+esc(answerLabel(r))+'</th><td>'+(r.content?.total==null?'—':esc(r.content.total)+'/'+esc(r.content.maximum))+'</td><td>'+score(r.providers.gpt?.pronunciation)+' / '+score(r.providers.gpt?.fluency)+'</td><td>'+score(r.providers.azure?.pronunciation)+' / '+score(r.providers.azure?.fluency)+'</td><td><button class="portal-button" data-sm="review" data-index="'+r.index+'">Review</button></td></tr>').join(''));
      const visible=visibleAnswers();if(!visible.some(r=>r.index===selected)&&visible.length)review(visible[0].index);else{updateQuestionNavigation();refreshReviewFeedback();}
    }
    function reviewFeedback(response){
      const content=response.content,lists=[['What worked',content?.strengths],['Next step',content?.improvements]].filter(([,list])=>Array.isArray(list)&&list.length);
      const unique=values=>[...new Set(values.filter(Boolean))];
      return '<div class="sm-review-score-strip"><span>Content <strong>'+(content?.total==null?'—':esc(content.total)+'/'+esc(content.maximum))+'</strong></span><span>GPT pronunciation / fluency <strong>'+score(response.providers.gpt?.pronunciation)+' / '+score(response.providers.gpt?.fluency)+'</strong></span><span>Azure pronunciation / fluency <strong>'+score(response.providers.azure?.pronunciation)+' / '+score(response.providers.azure?.fluency)+'</strong></span></div>'
        +'<section class="sm-student-transcript"><h4>Your transcript</h4><p>'+esc(response.transcript||'No transcript available for this response.')+'</p></section><section class="sm-content-feedback"><h4>Content feedback</h4><p>'+esc(content?.overview||'Content review is unavailable for this response.')+'</p><div class="sm-feedback-columns">'+lists.map(([title,list])=>'<div><h5>'+title+'</h5><ul>'+unique(list).map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></div>').join('')+'</div></section>'
        +'<details class="sm-provider-details"><summary>Pronunciation and fluency feedback</summary><div class="sm-provider-feedback">'+['gpt','azure'].map(provider=>'<section><h4>'+esc(provider==='gpt'?'GPT Audio':'Azure Speech')+'</h4>'+['pronunciation','fluency'].map(kind=>{const t=response.providers[provider]?.[kind];return '<h5>'+esc(kind==='fluency'?'Oral fluency':'Pronunciation')+' · '+score(t)+'</h5><p>'+esc(unique([t?.reason,t?.coaching||t?.nextStep]).join(' ')||'No delivery feedback available.')+'</p>';}).join('')+'</section>').join('')+'</div></details>';
    }
    function refreshReviewFeedback(){
      const response=answers().find(r=>r.index===selected),node=doc.getElementById('sm-review-feedback');if(!response||!node)return;
      const signature=JSON.stringify([response.content,response.providers,response.transcript]);if(signature===reviewSignature)return;
      const expanded=node.querySelector?.('.sm-provider-details')?.open;
      node.innerHTML=reviewFeedback(response);if(expanded){const details=node.querySelector?.('.sm-provider-details');if(details)details.open=true;}reviewSignature=signature;
    }
    async function review(index,{focus=false}={}){
      const response=answers().find(r=>r.index===index),node=doc.getElementById('sm-review-details');if(!response||!node)return;
      selected=index;reviewSignature='';const audioTicket=++reviewAudioTicket,ticket=serial,id=a.id;
      const visible=visibleAnswers(),position=visible.findIndex(r=>r.index===index),q=response.question;
      const image=q.type==='di'&&typeof q.imageUrl==='string'&&/^\/(?!\/)/.test(q.imageUrl)?q.imageUrl:'';
      const sample=q.type==='di'?'<section class="sm-sample-response" aria-label="Describe Image sample response"><p class="sm-eyebrow">Compare and practise</p><h4>Sample response</h4><p>'+esc(q.sample||'A sample response is not available for this image yet.')+'</p><small>One possible response. Other accurate descriptions are valid.</small></section>':'';
      node.innerHTML='<section class="sm-question-review"><header class="sm-review-heading"><div><p class="sm-eyebrow">'+esc(answerLabel(response))+'</p><h3 id="sm-review-heading" tabindex="-1">'+esc(q.title||labels[q.type])+'</h3></div><nav class="sm-review-pagination" aria-label="Review another question"><button class="portal-button" data-sm="review-step" data-step="-1"'+(position<=0?' disabled':'')+'>Previous</button><button class="portal-button" data-sm="review-step" data-step="1"'+(position>=visible.length-1?' disabled':'')+'>Next</button></nav></header>'
        +(q.type==='di'?'<div class="sm-image-sample">'+(image?'<figure><img src="'+esc(image)+'" alt="'+esc(q.title||'Image for this Describe Image question')+'"><figcaption><a href="'+esc(image)+'" target="_blank" rel="noopener noreferrer">Open full-size image</a></figcaption></figure>':'')+sample+'</div>':'')
        +'<section class="sm-student-audio"><h4>Your recording</h4><div id="sm-review-audio">'+(response.recording?'<p class="sm-muted">Loading your recording…</p>':'<p class="sm-muted">No recording was saved for this question.</p>')+'</div></section><div id="sm-review-feedback">'+reviewFeedback(response)+'</div>'
        +(q.type!=='di'?'<details class="sm-reference"><summary>'+(['ra','rs'].includes(q.type)?'Reference wording':'Sample response')+'</summary><p>'+esc((['ra','rs'].includes(q.type)?q.reference||q.sample:q.sample||q.reference)||'No reference is available for this question.')+'</p></details>'+(!['ra','rs'].includes(q.type)&&q.reference&&q.reference!==q.sample?'<details class="sm-reference"><summary>Original prompt / transcript</summary><p>'+esc(q.reference)+'</p></details>':''):'')+'</section>';
      reviewSignature=JSON.stringify([response.content,response.providers,response.transcript]);updateQuestionNavigation();
      if(focus){node.scrollIntoView?.({behavior:env.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches?'auto':'smooth',block:'start'});doc.getElementById('sm-review-heading')?.focus?.({preventScroll:true});}
      if(response.recording){try{
        const audioKey=key(id,index);let url=urls.get(audioKey);if(!url){const reply=await env.fetch('/api/speaking-mocks/attempts/'+id+'/recordings/'+index,{headers:{'x-session-token':token()},cache:'no-store'});if(!reply.ok)throw Error('Recording could not load.');const blob=await reply.blob();if(!valid(ticket)||a?.id!==id||selected!==index||audioTicket!==reviewAudioTicket)return;url=env.URL.createObjectURL(blob);urls.set(audioKey,url);}
        if(valid(ticket)&&a?.id===id&&selected===index&&audioTicket===reviewAudioTicket){const slot=doc.getElementById('sm-review-audio');if(slot)slot.innerHTML='<audio controls preload="metadata" src="'+esc(url)+'" aria-label="Your recorded response"></audio>';}
      }catch(error){if(valid(ticket)&&a?.id===id&&selected===index&&audioTicket===reviewAudioTicket){const slot=doc.getElementById('sm-review-audio');if(slot)slot.innerHTML='<p class="sm-muted">Your recording could not load. Select this question again to retry.</p>';}}}
    }
    function pollResults(){
      if(a.grading?.status==='complete'&&a.combinedRecovery?.status!=='processing'){stopPolling();return;}if(poller)return;pollUntil=now()+20*60000;
      pollFailures=0;nextPollAt=0;
      poller=env.setInterval(async()=>{if(pollBusy||doc.hidden||now()<nextPollAt)return;if(now()>pollUntil){stopPolling();message('Your recordings are saved. Reopen these results to check for the remaining scores.');return;}const ticket=serial,id=a.id,version=resultVersion;pollBusy=true;
        try{const saved=await api('/attempts/'+id);if(!valid(ticket)||a?.id!==id||version!==resultVersion)return;a=saved;updateResults();if(pollFailures)message('');pollFailures=0;if(a.grading?.status==='complete'&&a.combinedRecovery?.status!=='processing')stopPolling();}
        catch(error){if(!valid(ticket)||a?.id!==id||version!==resultVersion)return;if(error.retryable){nextPollAt=now()+Math.min(30000,3000*2**Math.min(pollFailures++,4));message('Connection interrupted. Your recordings are saved; retrying results automatically…');}else{stopPolling();message(error.message);}}finally{pollBusy=false;}
      },3000);
    }
    async function click(event){const button=event.target.closest('[data-sm]');if(!button||button.disabled)return;const data=button.dataset;
      if(data.sm==='start')return start(data.paper);
      if(data.sm==='reattempt')return start(null,data.id);
      if(data.sm==='resume')return resume(data.id);
      if(data.sm==='next')return next();
      if(data.sm==='review'){
        const response=answers().find(r=>r.index===Number(data.index));if(response&&reportFilter!=='all'&&response.question.type!==reportFilter)reportFilter=response.question.type;
        return review(Number(data.index),{focus:true});
      }
      if(data.sm==='filter'){reportFilter=Object.hasOwn(labels,data.type)&&data.type!=='intro'?data.type:'all';updateResults();return;}
      if(data.sm==='review-step'){const list=visibleAnswers(),position=list.findIndex(r=>r.index===selected),next=list[position+Number(data.step)];if(next)return review(next.index);return;}
      if(data.sm==='play'){played='';return playPrompt();}
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
