'use strict';
const express=require('express'),crypto=require('node:crypto'),path=require('node:path'),fs=require('node:fs/promises');
const bank=require('./content/speaking-mocks'),scoring=require('./speaking-scoring'),azure=require('./speaking-delivery');
const academy=require('./describe-image-academy');
const manualDelivery=require('./speaking-manual-delivery');
const azureWhole=require('./speaking-mock-azure');
const combined=require('./speaking-mock-combined');
const speakingReport=require('./speaking-mock-report');
const {createStore}=require('./writing-lab-store'),{transcribeRecording}=require('./speaking-lab');
const fail=(message,status=400)=>Object.assign(Error(message),{status});
function timing(a,now=Date.now()){
  const q=a.questions[a.index];if(!q||a.status!=='active')return {phase:'finished'};
  if(a.responses[a.index]?.recording||a.responses[a.index]?.skipped)return {phase:'completed'};
  if(!a.questionStartedAt)return {phase:'ready'};
  const audioAt=a.questionStartedAt+3000,prepAt=audioAt+(q.audioSeconds||0)*1000;
  const cueAt=prepAt+q.preparation*1000,recordingAt=cueAt+(q.type==='rs'?q.startCueMs||0:0),endsAt=recordingAt+q.seconds*1000;
  return {audioAt,prepAt,cueAt,recordingAt,endsAt,phase:now<audioAt?'instructions':now<prepAt?'listening':now<cueAt?'preparing':now<recordingAt?'cue':now<endsAt?'recording':'expired'};
}
function reconcile(a,now=Date.now()){
  if(a.status==='active'&&now>=a.deadline){a.status='submitted';a.finishedAt=now;a.grading={status:'pending'};}
  return a;
}
function present(a,now=Date.now(),{completeOnly=false,progress}={}){
  if(completeOnly){const ready=a.status==='submitted'&&require('./speaking-mock-jobs').complete(a);if(!ready)return{id:a.id,paperId:a.paperId,title:a.title,status:a.status,startedAt:a.startedAt,deadline:a.deadline,index:a.index,reattemptOf:a.reattemptOf||null,questionCount:a.questionCount,totalItems:a.questions.length,completedCount:a.completedCount||0,integrity:a.integrity,grading:{status:'processing'},resultsReady:false,resultStatus:progress||{status:'preparing',ready:false,total:a.questionCount},speakingReport:null,overall:null,overallAzure:null,combinedOverall:null,overallFeedback:null,combinedComparisons:null,...(a.status==='active'&&a.index<a.questions.length?{question:bank.publicQuestion(a.questions[a.index],false),timing:timing(a,now)}:{})};}

  const submitted=a.status==='submitted';
  const savedContent=a.combinedOverall?.status==='assessed'&&a.combinedOverall.sourceFingerprint===combined.fingerprint(a)?a.combinedOverall.content:null;
  return {id:a.id,paperId:a.paperId,title:a.title,status:a.status,startedAt:a.startedAt,deadline:a.deadline,index:a.index,
    reattemptOf:a.reattemptOf||null,questionCount:a.questionCount,totalItems:a.questions.length,completedCount:a.completedCount||0,...(completeOnly?{resultsReady:true,resultStatus:{status:'ready',ready:true}}:{}),grading:a.grading,overall:null,overallAzure:a.overallAzure||null,combinedOverall:null,combinedRecovery:a.combinedRecovery?{status:a.combinedRecovery.status}:null,
    speakingReport:submitted?speakingReport.summarize(a):null,
    overallFeedback:submitted&&savedContent?{summary:savedContent.summary,strengths:savedContent.strengths||[],nextSteps:savedContent.nextSteps||[]}:null,
    combinedComparisons:null,providerComparisonStatus:null,integrity:a.integrity,
    ...(a.index<a.questions.length?{question:bank.publicQuestion(a.questions[a.index],submitted),timing:timing(a,now)}:{}),
    ...(submitted?{responses:a.questions.map((q,i)=>{
      const r=a.responses[i]||{};
      return {index:i,question:bank.publicQuestion(q,true),recording:!!r.recording,transcript:r.transcript||'',skipped:!r.recording,
        content:scoring.resultForClient(r.content,r.transcript||'')||null,providers:{azure:academy.deliveryForClient(r.content,q.type==='rs'?manualDelivery.effective(r,'azure'):r.azure)||null}};
    })}:{})};
}
function installSpeakingMock(app,{pool,directory,verifyToken,getAccount,callModel,transcribe=transcribeRecording,
  assessAzure=azure.assessRecording,gradeResponse,
  azureAvailable=azure.isConfigured(),
  assessAzureOverall=azureWhole.assess,azureOverallAvailable=azureAvailable&&azure.isConfigured(),backgroundEnabled=false,academyClient,now=Date.now}={}){
  const gptAvailable=false;
  const store=createStore(pool,directory,{table:'speaking_mock_attempts'}),router=express.Router(),jobs=new Map(),instance=crypto.randomUUID();
  const progressive=require('./speaking-mock-jobs').createMockJobs({pool,directory,store,transcribe,assessAzure,callModel,gradeResponse,academyClient,includeLegacy:backgroundEnabled,now});
  const useProgressive=a=>backgroundEnabled||a?.assessmentProfile?.mode==='progressive-v1';
  const view=a=>present(a,now(),{completeOnly:useProgressive(a)});
  const profile=uid=>backgroundEnabled?{assessmentProfile:{mode:'progressive-v1',owner:uid,diBackend:'academy',requiredProviders:['azure']}}:{};
  const wrap=fn=>(req,res)=>Promise.resolve(fn(req,res)).catch(e=>res.status(e.status||503).json({error:e.status?e.message:'This action could not finish. Your saved mock is safe; please retry.'}));
  const read=(uid,id)=>store.update(uid,id,a=>{if(!a)throw fail('Mock attempt not found.',404);return reconcile(a,now());});
  async function readResults(uid,id){
    const a=await store.get(uid,id,{omitMockAudio:true});if(!a)throw fail('Mock attempt not found.',404);
    // Only an expired active attempt needs a write to submit it. Saved results
    // are read-only; polling must not compete with background assessment saves.
    return a.status==='active'&&now()>=a.deadline?read(uid,id):a;
  }
  const snapshot=(result,recording)=>({...result,status:'assessed',recordingHash:recording.hash,assessedAt:now()});
  const unavailable=()=>({status:'unavailable'});
  async function score(uid,id,{overallOnly=false,reassessOverall=false,azureOverallOnly=false,operation}={}){
    let claimed=false;
    let a=await store.update(uid,id,a=>{
      claimed=false;
      if(a.status!=='submitted'||!['pending','processing'].includes(a.grading?.status))return a;
      if(a.lease&&a.lease.expiresAt>now())return a;
      claimed=true;a.lease={owner:instance,expiresAt:now()+120000};a.grading={status:'processing'};return a;
    });
    if(!claimed)return;
    async function save(fn){return store.update(uid,id,current=>{if(current.lease?.owner!==instance)return current;fn(current);if(current.lease?.owner===instance)current.lease.expiresAt=now()+120000;return current;});}
    const heartbeat=setInterval(()=>save(()=>{}).catch(()=>{}),20000);heartbeat.unref?.();
    async function grade(i){
      if(overallOnly||azureOverallOnly)return;
      const q=a.questions[i],r=a.responses[i];if(!r?.recording||q.type==='intro')return;
      const patch=async value=>{a=await save(current=>{Object.assign(current.responses[i],value);});};
      if(gradeResponse){if(r.content&&r.content.scoringMode!=='local'&&(!azureAvailable||r.azure?.status==='assessed'))return;await patch(await gradeResponse(q,r.recording,r));return;}
      if(!r.transcript){
        try{await patch({transcript:await transcribe(r.recording),transcriptionStatus:'assessed'});}
        catch{await patch({transcriptionStatus:'unavailable'});return;}
      }
      const current=a.responses[i],tasks=[];
      const contentGated=speakingReport.validContent(q,current.content)&&current.content.total===0;
      const retainDelivery=(provider,result)=>{
        const value=snapshot(result,r.recording);
        const prior=speakingReport.deliveryTraits({...current,manualDeliveryOverrides:undefined},provider);
        const next=speakingReport.deliveryTraits({recording:r.recording,[provider]:value},provider);
        // A partial retry cannot erase an independently verified companion trait.
        for(const name of ['pronunciation','fluency'])if(next[name]===null&&prior[name]!==null)value[name]=current[provider][name];
        return value;
      };
      const providerFailure=provider=>current[provider]?.status==='assessed'?{...current[provider],retryStatus:'unavailable'}:unavailable();
      if(!speakingReport.validContent(q,current.content)||(q.type==='di'&&academy.needsReview(current.content)))tasks.push(scoring.grade(q,current.transcript,callModel,{academyDescribeImage:true}).then(content=>patch({content})));
      if(!contentGated&&azureAvailable&&speakingReport.deliveryTraits(current,'azure').missing.length)tasks.push(assessAzure(r.recording,{question:q,transcript:current.transcript,transcribe}).then(result=>patch({azure:result?retainDelivery('azure',result):providerFailure('azure')}),()=>patch({azure:providerFailure('azure')})));
      await Promise.allSettled(tasks);
    }
    const overallJob=Promise.resolve();
    const azureOverallJob=(async()=>{
      if(!azureOverallOnly||!azureOverallAvailable||a.overallAzure?.status==='assessed')return;
      const recordings=a.responses.flatMap((r,i)=>a.questions[i].type!=='intro'&&r?.recording?[{mime:r.recording.mime,data:r.recording.data,hash:r.recording.hash}]:[]);
      try{
        const items=a.questions.flatMap((q,i)=>q.type==='intro'?[]:[{index:i,response:a.responses[i]}]);
        const unanswered=items.filter(({response:r})=>!r?.recording&&r?.skipped===true&&!r?.transcript?.trim());
        const unexplained=items.filter(({response:r})=>!r?.recording&&!(r?.skipped===true&&!r?.transcript?.trim()));
        if(items.length!==a.questionCount||unexplained.length)throw Object.assign(Error('A saved response recording is missing.'),{code:'AZURE_COVERAGE',coverage:{recordingCount:recordings.length,expectedCount:a.questionCount,missingQuestions:unexplained.map(r=>r.index)}});
        // Every actual recording is required. Explicit unanswered questions are
        // accounted for by content; they cannot create nonexistent audio files.
        const result=await assessAzureOverall(recordings,{expectedCount:recordings.length});
        if(result?.status!=='assessed'||!Number.isFinite(result.pronunciation?.raw)||!Number.isFinite(result.fluency?.raw))throw Error('Azure overall was not confirmed.');
        await save(current=>{current.overallAzure={...result,questionCount:a.questionCount,unansweredCount:unanswered.length,assessedAt:now(),...(operation?{operation}:{})};});
      }catch(error){
        const failure={code:/^AZURE_[A-Z_]+$/.test(error.code||'')?error.code:'AZURE_OVERALL_UNAVAILABLE',...(Number.isInteger(error.providerStatus)?{providerStatus:error.providerStatus}:{}),
          ...(['NoMatch','InitialSilenceTimeout','BabbleTimeout','EndOfDictation','Error'].includes(error.recognitionStatus)?{recognitionStatus:error.recognitionStatus}:{}),
          ...(error.audioSection?{audioSection:error.audioSection}:{}),...(error.coverage?{coverage:error.coverage}:{})};
        console.warn('[speaking-azure-overall]',JSON.stringify(failure));
        await save(current=>{current.overallAzure={status:'unavailable',failure,summary:'The Azure audio summary could not finish. Your saved recordings and GPT result are unchanged.'};});
      }
    })();
    let cursor=0;
    const worker=async()=>{while(cursor<a.questions.length){const i=cursor++;try{await grade(i);}catch{await save(current=>{current.responses[i]||={};current.responses[i].gradingError=true;});}}};
    try{await Promise.allSettled([overallJob,azureOverallJob,worker(),worker()]);await save(current=>{current.grading={status:'complete'};delete current.lease;});}
    finally{clearInterval(heartbeat);}
  }
  function queue(uid,a,options){
    if(useProgressive(a)&&!options?.overallOnly&&!options?.azureOverallOnly){const task=progressive.ensure(uid,a);task.catch(()=>console.warn('[speaking-mock] Saved answers will resume in the recovery scan.'));return task;}
    if(jobs.has(a.id))return jobs.get(a.id);
    if(a.status!=='submitted'||!['pending','processing'].includes(a.grading?.status)||jobs.size>=2)return;
    const job=score(uid,a.id,options);jobs.set(a.id,job);
    job.catch(()=>console.warn('[speaking-mock] Assessment interrupted; saved stages can resume.')).finally(()=>jobs.delete(a.id));
    return job;
  }
  async function recoverOverall(request={}){
    if(request.provider&&request.provider!=='azure')throw fail('GPT speech scoring has been retired. Use Azure.',410);
    return recoverAzureOverall(request);
  }
  async function recoverAzureOverall({username,attemptId,operation,wait}={}){
    if(!require('./speaking-access').allowed(username)||typeof operation!=='string'||!/^[a-zA-Z0-9:_-]{1,120}$/.test(operation))throw fail('Invalid Azure overall scope.');
    if(!azureOverallAvailable)throw fail('Azure whole-test assessment is not configured.',503);
    let a=await read(username,attemptId);if(a.status!=='submitted')throw fail('Finish the mock before reviewing scores.',409);
    const report=()=>({operation,attemptId,status:a.overallAzure?.status==='assessed'?'complete':'needs-review',
      pronunciation:a.overallAzure?.pronunciation?.raw??null,fluency:a.overallAzure?.fluency?.raw??null,nativeMaximum:100,
      pronunciationBand:a.overallAzure?.pronunciation?.score??null,fluencyBand:a.overallAzure?.fluency?.score??null,
      recordingCount:a.overallAzure?.recordingCount??0,chunkCount:a.overallAzure?.chunkCount??0,version:a.overallAzure?.version||null,
      ...(a.overallAzure?.failure?{failure:a.overallAzure.failure}:{})});
    if(a.overallAzure?.status==='assessed'||a.overallAzureRecovery?.operation===operation){const result=report();console.info('[speaking-azure-overall-recovery]',JSON.stringify({...result,existing:true}));return result;}
    console.info('[speaking-azure-overall-recovery]',JSON.stringify({operation,attemptId,status:'started'}));
    for(let n=0;n<8;n++){
      if(jobs.has(attemptId))await jobs.get(attemptId);
      a=await read(username,attemptId);if(a.overallAzure?.status==='assessed'||a.overallAzureRecovery?.operation===operation)break;
      if(a.lease?.expiresAt>now()||jobs.size>=2){await wait(Math.min(30000,Math.max(1000,(a.lease?.expiresAt||now()+30000)-now()+50)));continue;}
      let scheduled=false;
      a=await store.update(username,attemptId,current=>{scheduled=false;if(current.lease?.expiresAt>now()||current.overallAzureRecovery?.operation===operation)return current;scheduled=true;current.grading={status:'pending'};current.overallAzureRecovery={operation,status:'processing',startedAt:now()};return current;});
      if(!scheduled)continue;
      const job=queue(username,a,{azureOverallOnly:true,operation});if(!job)continue;await job;a=await read(username,attemptId);break;
    }
    const result=report();await store.update(username,attemptId,current=>{if(current.overallAzureRecovery?.operation===operation)current.overallAzureRecovery={...current.overallAzureRecovery,...result,finishedAt:now()};return current;});
    console.info('[speaking-azure-overall-recovery]',JSON.stringify(result));return result;
  }
  router.get('/catalog',(_,res)=>res.json({version:bank.VERSION,papers:bank.catalogue(),gptAvailable,azureAvailable,azureOverallAvailable,speakingScoring:{version:speakingReport.VERSION,weights:speakingReport.WEIGHTS,calibration:'uncalibrated'},describeImageScoring:{source:'Describe Image Academy',version:academy.VERSION,sourceCommit:academy.SOURCE_COMMIT}}));
  router.use(async(req,res,next)=>{
    try{const uid=verifyToken(req.headers['x-session-token']||''),account=uid&&await getAccount(uid);if(!account||account.blocked)return res.status(401).json({error:'Please sign in to your practice account.'});req.mockUser=uid;res.set('Cache-Control','no-store');next();}
    catch{res.status(503).json({error:'Your account could not be checked. Please retry.'});}
  });
  const limiter=require('express-rate-limit')({windowMs:600000,max:240,keyGenerator:req=>req.mockUser,standardHeaders:true,legacyHeaders:false,message:{error:'Please wait before starting another speaking-mock action.'}});
  router.get('/attempts',wrap(async(req,res)=>res.json((await store.list(req.mockUser,{omitMockAudio:true})).map(a=>{const value=view(a);return{id:a.id,paperId:a.paperId,title:a.title,status:a.status,index:a.index,startedAt:a.startedAt,grading:value.grading,resultsReady:value.resultsReady,resultStatus:value.resultStatus,speakingReport:value.speakingReport,overall:value.overall,overallAzure:value.overallAzure,combinedOverall:value.combinedOverall,completedCount:a.completedCount||0,questionCount:a.questionCount};}))));
  router.post('/attempts',limiter,wrap(async(req,res)=>{
    const paper=bank.papers.find(p=>p.id===req.body?.paperId);if(!paper)throw fail('Speaking mock not found.',404);
    const a=await store.update(req.mockUser,req.body.id,old=>{
      if(old){if(old.paperId!==paper.id)throw fail('This attempt belongs to another paper.',409);return old;}
      return {...profile(req.mockUser),id:req.body.id,paperId:paper.id,title:paper.title,version:bank.VERSION,questionCount:paper.questionCount,questions:structuredClone(paper.questions),responses:[],index:0,status:'active',startedAt:now(),deadline:now()+paper.minutes*60000,integrity:{protected:true,events:[]}};
    });res.json(view(a));
  }));
  router.post('/attempts/:id/reattempt',limiter,wrap(async(req,res)=>{
    const original=await read(req.mockUser,req.params.id);
    if(original.status!=='submitted')throw fail('Finish this mock before reattempting it.',409);
    if(req.body?.id===original.id)throw fail('Use a new attempt for the reattempt.',409);
    const a=await store.update(req.mockUser,req.body?.id,old=>{
      if(old){if(old.reattemptOf!==original.id)throw fail('This attempt belongs to another mock.',409);return old;}
      const startedAt=now();
      return {...profile(req.mockUser),id:req.body.id,paperId:original.paperId,title:original.title,version:original.version,questionCount:original.questionCount,
        questions:bank.reattemptQuestions(original),reattemptOf:original.id,responses:[],index:0,status:'active',startedAt,
        deadline:startedAt+(original.deadline-original.startedAt),integrity:{protected:true,events:[]}};
    });res.json(view(a));
  }));
  router.get('/attempts/:id/status',wrap(async(req,res)=>{const a=await readResults(req.mockUser,req.params.id);res.json(useProgressive(a)?await progressive.status(req.mockUser,a):{ready:a.grading?.status==='complete',status:a.grading?.status==='complete'?'ready':'preparing'});}));
  router.get('/attempts/:id',wrap(async(req,res)=>{const a=await readResults(req.mockUser,req.params.id);res.json(view(a));queue(req.mockUser,a);}));
  router.post('/attempts/:id/begin',limiter,wrap(async(req,res)=>{
    const a=await store.update(req.mockUser,req.params.id,a=>{if(!a)throw fail('Mock attempt not found.',404);reconcile(a,now());if(a.status!=='active')throw fail('This mock has finished.',409);if(req.body.index!==a.index)throw fail('A different question is active. Reopen the mock.',409);a.questionStartedAt||=now();return a;});res.json(view(a));
  }));
  router.post('/attempts/:id/recordings/:index',limiter,express.raw({type:['audio/webm','audio/mp4','audio/wav','audio/mpeg'],limit:'3mb'}),wrap(async(req,res)=>{
    const index=Number(req.params.index),mime=String(req.headers['content-type']||'').split(';')[0],data=req.body;
    if(!Number.isInteger(index)||!Buffer.isBuffer(data)||data.length<100||!['audio/webm','audio/mp4','audio/wav','audio/mpeg'].includes(mime))throw fail('Upload a valid saved recording.');
    const hash=crypto.createHash('sha256').update(data).digest('hex');
    const a=await store.update(req.mockUser,req.params.id,a=>{
      if(!a)throw fail('Mock attempt not found.',404);
      if(a.responses[index]?.recording?.hash===hash)return a;
      if(a.status!=='active'||index!==a.index||!a.questionStartedAt||a.responses[index]?.recording)throw fail('This response is locked.',409);
      const clock=timing(a,now());if(now()<clock.recordingAt)throw fail('The recording period has not begun.',409);
      if(now()>clock.endsAt+90000)throw fail('The recording period has expired. Continue to the next question.',409);
      a.responses[index]={recording:{mime,data:data.toString('base64'),hash},savedAt:now()};a.completedCount=a.responses.filter((r,i)=>r?.recording&&a.questions[i].type!=='intro').length;return a;
    });res.json(view(a));queue(req.mockUser,a);
  }));
  router.get('/attempts/:id/recordings/:index',wrap(async(req,res)=>{
    const a=await readResults(req.mockUser,req.params.id);if(useProgressive(a)&&a.status==='submitted'&&!require('./speaking-mock-jobs').complete(a))throw fail('Your results are being prepared.',409);const full=await store.getResponse(req.mockUser,req.params.id,Number(req.params.index)),r=full?.response;if(!r?.recording)throw fail('Recording not found.',404);
    res.type(r.recording.mime).set('X-Content-Type-Options','nosniff').send(Buffer.from(r.recording.data,'base64'));
  }));
  router.post('/attempts/:id/next',limiter,wrap(async(req,res)=>{
    const a=await store.update(req.mockUser,req.params.id,a=>{
      if(!a)throw fail('Mock attempt not found.',404);reconcile(a,now());
      if(req.body.index<a.index)return a;
      if(a.status!=='active'||req.body.index!==a.index)throw fail('This question is no longer active.',409);
      if(!a.responses[a.index]?.recording&&!req.body.skip)throw fail('Save your response before continuing.');
      a.responses[a.index]||={skipped:true};a.index++;delete a.questionStartedAt;
      if(a.index===a.questions.length){a.status='submitted';a.finishedAt=now();a.grading={status:'pending'};}return a;
    });res.json(view(a));queue(req.mockUser,a);
  }));
  router.post('/attempts/:id/retry',limiter,wrap(async(req,res)=>{
    const a=await store.update(req.mockUser,req.params.id,a=>{if(!a)throw fail('Mock attempt not found.',404);if(a.status!=='submitted')throw fail('Finish the mock before reviewing scores.',409);if(a.grading?.status!=='processing')a.grading={status:'pending'};return a;});res.json(view(a));queue(req.mockUser,a);
  }));
  router.post('/attempts/:id/integrity',wrap(async(req,res)=>{
    const events=req.body?.events;if(!Array.isArray(events)||events.length>20||events.some(e=>!e||typeof e.id!=='string'||e.id.length>80||!['tab-hidden','window-blur','fullscreen-exit','fullscreen-required','external-paste-blocked','external-drop-blocked'].includes(e.reason)||!Number.isFinite(e.at)))throw fail('Invalid interruption record.');
    const a=await store.update(req.mockUser,req.params.id,a=>{if(!a)throw fail('Mock attempt not found.',404);for(const e of events)if(!a.integrity.events.some(x=>x.id===e.id)&&a.integrity.events.length<200)a.integrity.events.push({id:e.id,reason:e.reason,at:e.at,receivedAt:now()});return a;});res.json(a.integrity);
  }));
  router.use((error,req,res,next)=>error.type==='entity.too.large'?res.status(413).json({error:'The response recording is too large. Use a recording under 3 MB.'}):next(error));
  app.use('/api/speaking-mocks',router);
  app.get('/speaking-mock-audio/:id.mp3',wrap(async(req,res)=>{
    const q=bank.papers.flatMap(p=>p.questions).find(q=>q.id===req.params.id&&q.audioSource);if(!q)throw fail('Prompt recording not found.',404);
    const file=path.join(__dirname,'content',q.audioSource.folder==='speaking'?'speaking-audio':'writing-audio',q.audioSource.id+'.mp3');
    await fs.access(file);res.type('audio/mpeg').set('Cache-Control','public,max-age=3600').sendFile(file);
  }));
  return {store,recoverOverall,progressive,start:()=>progressive.start(),stop:()=>progressive.stop(),waitForJobs:async()=>{await Promise.allSettled([...jobs.values()]);await progressive.wait();}};
}
module.exports={timing,reconcile,present,installSpeakingMock};
