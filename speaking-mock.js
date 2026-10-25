'use strict';
const express=require('express'),crypto=require('node:crypto'),path=require('node:path'),fs=require('node:fs/promises');
const bank=require('./content/speaking-mocks'),scoring=require('./speaking-scoring'),gpt=require('./gpt-speaking-delivery'),azure=require('./speaking-delivery'),whole=require('./speaking-mock-overall');
const academy=require('./describe-image-academy');
const {createStore}=require('./writing-lab-store'),{transcribeRecording}=require('./speaking-lab');
const fail=(message,status=400)=>Object.assign(Error(message),{status});
function timing(a,now=Date.now()){
  const q=a.questions[a.index];if(!q||a.status!=='active')return {phase:'finished'};
  if(a.responses[a.index]?.recording||a.responses[a.index]?.skipped)return {phase:'completed'};
  if(!a.questionStartedAt)return {phase:'ready'};
  const audioAt=a.questionStartedAt+3000,prepAt=audioAt+(q.audioSeconds||0)*1000;
  const recordingAt=prepAt+q.preparation*1000,endsAt=recordingAt+q.seconds*1000;
  return {audioAt,prepAt,recordingAt,endsAt,phase:now<audioAt?'instructions':now<prepAt?'listening':now<recordingAt?'preparing':now<endsAt?'recording':'expired'};
}
function reconcile(a,now=Date.now()){
  if(a.status==='active'&&now>=a.deadline){a.status='submitted';a.finishedAt=now;a.grading={status:'pending'};}
  return a;
}
function present(a,now=Date.now()){
  const submitted=a.status==='submitted';
  return {id:a.id,paperId:a.paperId,title:a.title,status:a.status,startedAt:a.startedAt,deadline:a.deadline,index:a.index,
    reattemptOf:a.reattemptOf||null,questionCount:a.questionCount,totalItems:a.questions.length,completedCount:a.completedCount||0,grading:a.grading,overall:a.overall||null,integrity:a.integrity,
    ...(a.index<a.questions.length?{question:bank.publicQuestion(a.questions[a.index],submitted),timing:timing(a,now)}:{}),
    ...(submitted?{responses:a.questions.map((q,i)=>{
      const r=a.responses[i]||{};
      return {index:i,question:bank.publicQuestion(q,true),recording:!!r.recording,transcript:r.transcript||'',skipped:!r.recording,
        content:scoring.resultForClient(r.content,r.transcript||'')||null,providers:{gpt:academy.deliveryForClient(r.content,r.gpt)||null,azure:academy.deliveryForClient(r.content,r.azure)||null}};
    })}:{})};
}
function installSpeakingMock(app,{pool,directory,verifyToken,getAccount,callModel,transcribe=transcribeRecording,
  assessGpt=gpt.assessRecording,assessAzure=azure.assessRecording,assessOverall=whole.assess,gradeResponse,
  gptAvailable=gpt.isConfigured(),azureAvailable=azure.isConfigured(),now=Date.now}={}){
  const store=createStore(pool,directory,{table:'speaking_mock_attempts'}),router=express.Router(),jobs=new Map(),instance=crypto.randomUUID();
  const wrap=fn=>(req,res)=>Promise.resolve(fn(req,res)).catch(e=>res.status(e.status||503).json({error:e.status?e.message:'This action could not finish. Your saved mock is safe; please retry.'}));
  const read=(uid,id)=>store.update(uid,id,a=>{if(!a)throw fail('Mock attempt not found.',404);return reconcile(a,now());});
  const snapshot=(result,recording)=>({...result,status:'assessed',recordingHash:recording.hash,assessedAt:now()});
  const unavailable=()=>({status:'unavailable'});
  async function score(uid,id){
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
      const q=a.questions[i],r=a.responses[i];if(!r?.recording||q.type==='intro')return;
      const patch=async value=>{a=await save(current=>{Object.assign(current.responses[i],value);});};
      if(gradeResponse){if(r.content&&r.content.scoringMode!=='local'&&(!gptAvailable||r.gpt?.status==='assessed')&&(!azureAvailable||r.azure?.status==='assessed'))return;await patch(await gradeResponse(q,r.recording,r));return;}
      if(!r.transcript){
        try{await patch({transcript:await transcribe(r.recording),transcriptionStatus:'assessed'});}
        catch{await patch({transcriptionStatus:'unavailable'});return;}
      }
      const current=a.responses[i],tasks=[];
      if(q.type==='di'?academy.needsReview(current.content):!current.content||current.content.scoringMode==='local')tasks.push(scoring.grade(q,current.transcript,callModel,{academyDescribeImage:true}).then(content=>patch({content})));
      if(gptAvailable&&current.gpt?.status!=='assessed')tasks.push(assessGpt(r.recording,{question:q,transcript:current.transcript}).then(result=>patch({gpt:snapshot(result,r.recording)}),()=>patch({gpt:unavailable()})));
      if(azureAvailable&&current.azure?.status!=='assessed')tasks.push(assessAzure(r.recording,{question:q,transcript:current.transcript,transcribe}).then(result=>patch({azure:result?snapshot(result,r.recording):unavailable()}),()=>patch({azure:unavailable()})));
      await Promise.allSettled(tasks);
    }
    const overallJob=(async()=>{
      if(a.overall&&a.overall.status!=='unavailable')return;
      if(!gptAvailable){await save(current=>{current.overall={status:'unavailable',summary:'Whole-test audio assessment is not configured.'};});return;}
      // Deliberate boundary: no question, transcript, mark or feedback enters
      // the blind overall scorer. It receives only the saved student audio.
      const recordings=a.responses.flatMap((r,i)=>a.questions[i].type!=='intro'&&r?.recording?[r.recording]:[]);
      try{const result=await assessOverall(recordings,{expectedCount:a.questionCount});await save(current=>{current.overall=result;});}
      catch{await save(current=>{current.overall={status:'unavailable',summary:'The whole-test audio review could not finish. Retry this saved mock without recording again.'};});}
    })();
    let cursor=0;
    const worker=async()=>{while(cursor<a.questions.length){const i=cursor++;try{await grade(i);}catch{await save(current=>{current.responses[i]||={};current.responses[i].gradingError=true;});}}};
    try{await Promise.allSettled([overallJob,worker(),worker()]);await save(current=>{current.grading={status:'complete'};delete current.lease;});}
    finally{clearInterval(heartbeat);}
  }
  function queue(uid,a){
    if(a.status!=='submitted'||!['pending','processing'].includes(a.grading?.status)||jobs.has(a.id)||jobs.size>=2)return;
    const job=score(uid,a.id);jobs.set(a.id,job);
    job.catch(()=>console.warn('[speaking-mock] Assessment interrupted; saved stages can resume.')).finally(()=>jobs.delete(a.id));
  }
  router.get('/catalog',(_,res)=>res.json({version:bank.VERSION,papers:bank.catalogue(),gptAvailable,azureAvailable,describeImageScoring:{source:'Describe Image Academy',version:academy.VERSION,sourceCommit:academy.SOURCE_COMMIT}}));
  router.use(async(req,res,next)=>{
    try{const uid=verifyToken(req.headers['x-session-token']||''),account=uid&&await getAccount(uid);if(!account||account.blocked)return res.status(401).json({error:'Please sign in to your practice account.'});req.mockUser=uid;res.set('Cache-Control','no-store');next();}
    catch{res.status(503).json({error:'Your account could not be checked. Please retry.'});}
  });
  const limiter=require('express-rate-limit')({windowMs:600000,max:240,keyGenerator:req=>req.mockUser,standardHeaders:true,legacyHeaders:false,message:{error:'Please wait before starting another speaking-mock action.'}});
  router.get('/attempts',wrap(async(req,res)=>res.json((await store.list(req.mockUser)).map(a=>({id:a.id,paperId:a.paperId,title:a.title,status:a.status,index:a.index,startedAt:a.startedAt,grading:a.grading,overall:a.overall||null,completedCount:a.completedCount||0,questionCount:a.questionCount})))));
  router.post('/attempts',limiter,wrap(async(req,res)=>{
    const paper=bank.papers.find(p=>p.id===req.body?.paperId);if(!paper)throw fail('Speaking mock not found.',404);
    const a=await store.update(req.mockUser,req.body.id,old=>{
      if(old){if(old.paperId!==paper.id)throw fail('This attempt belongs to another paper.',409);return old;}
      return {id:req.body.id,paperId:paper.id,title:paper.title,version:bank.VERSION,questionCount:paper.questionCount,questions:structuredClone(paper.questions),responses:[],index:0,status:'active',startedAt:now(),deadline:now()+paper.minutes*60000,integrity:{protected:true,events:[]}};
    });res.json(present(a,now()));
  }));
  router.post('/attempts/:id/reattempt',limiter,wrap(async(req,res)=>{
    const original=await read(req.mockUser,req.params.id);
    if(original.status!=='submitted')throw fail('Finish this mock before reattempting it.',409);
    if(req.body?.id===original.id)throw fail('Use a new attempt for the reattempt.',409);
    const a=await store.update(req.mockUser,req.body?.id,old=>{
      if(old){if(old.reattemptOf!==original.id)throw fail('This attempt belongs to another mock.',409);return old;}
      const startedAt=now();
      return {id:req.body.id,paperId:original.paperId,title:original.title,version:original.version,questionCount:original.questionCount,
        questions:structuredClone(original.questions),reattemptOf:original.id,responses:[],index:0,status:'active',startedAt,
        deadline:startedAt+(original.deadline-original.startedAt),integrity:{protected:true,events:[]}};
    });res.json(present(a,now()));
  }));
  router.get('/attempts/:id',wrap(async(req,res)=>{const a=await read(req.mockUser,req.params.id);res.json(present(a,now()));queue(req.mockUser,a);}));
  router.post('/attempts/:id/begin',limiter,wrap(async(req,res)=>{
    const a=await store.update(req.mockUser,req.params.id,a=>{if(!a)throw fail('Mock attempt not found.',404);reconcile(a,now());if(a.status!=='active')throw fail('This mock has finished.',409);if(req.body.index!==a.index)throw fail('A different question is active. Reopen the mock.',409);a.questionStartedAt||=now();return a;});res.json(present(a,now()));
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
    });res.json(present(a,now()));
  }));
  router.get('/attempts/:id/recordings/:index',wrap(async(req,res)=>{
    const a=await read(req.mockUser,req.params.id),r=a.responses[Number(req.params.index)];if(!r?.recording)throw fail('Recording not found.',404);
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
    });res.json(present(a,now()));queue(req.mockUser,a);
  }));
  router.post('/attempts/:id/retry',limiter,wrap(async(req,res)=>{
    const a=await store.update(req.mockUser,req.params.id,a=>{if(!a)throw fail('Mock attempt not found.',404);if(a.status!=='submitted')throw fail('Finish the mock before reviewing scores.',409);if(a.grading?.status!=='processing')a.grading={status:'pending'};return a;});res.json(present(a,now()));queue(req.mockUser,a);
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
  return {store,waitForJobs:()=>Promise.allSettled([...jobs.values()])};
}
module.exports={timing,reconcile,present,installSpeakingMock};
