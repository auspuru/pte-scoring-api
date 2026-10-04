'use strict';
const express=require('express'),path=require('node:path'),fs=require('node:fs/promises'),crypto=require('node:crypto');
const bank=require('./content/speaking-bank'),scoring=require('./speaking-scoring'),delivery=require('./speaking-delivery');
const {createStore}=require('./writing-lab-store');
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const hasPrompt=q=>['rs','rl','sgd','rts'].includes(q.type);
function question(q,reveal=false) {
  return {id:q.id,type:q.type,name:q.name,title:q.title,instruction:q.instruction,preparation:q.preparation,seconds:q.seconds,
    ...(['ra','rts'].includes(q.type)?{text:q.text}:{}),
    ...(hasPrompt(q)?{audioUrl:'/speaking-audio/'+q.id+'.mp3?v='+bank.version}:{}),
    ...(q.imageUrl?{imageUrl:q.imageUrl}:q.visual?{imageUrl:'/speaking-image/'+q.id+'.svg'}:{}),
    ...(q.predictionSource?{predictionSource:q.predictionSource}:{}),
    ...(reveal?{sample:q.sample,reference:q.text,facts:q.facts,visual:q.visual}:{})};
}
function present(a) {
  return {id:a.id,questionId:a.questionId,status:a.status,startedAt:a.startedAt,transcript:a.transcript||'',revision:a.revision||0,
    recording:a.recording?{mime:a.recording.mime,bytes:Buffer.byteLength(a.recording.data,'base64')}:null,
    transcribed:!!a.transcription,result:a.result||null,question:question(bank.questions.find(q=>q.id===a.questionId),a.status==='submitted')};
}
async function transcribeRecording(recording,{apiKey=process.env.OPENAI_API_KEY,fetch:request=fetch}={}) {
  if(!apiKey)throw fail('Automatic transcription is not configured. Enter the exact words you said; content feedback still works.',503);
  const suffix={'audio/webm':'webm','audio/mp4':'mp4','audio/wav':'wav','audio/mpeg':'mp3'}[recording.mime];
  if(!suffix)throw fail('Use a WebM, MP4, WAV or MP3 recording for automatic transcription.');
  const form=new FormData();form.append('model',process.env.OPENAI_TRANSCRIPTION_MODEL||'gpt-4o-mini-transcribe');
  form.append('file',new Blob([Buffer.from(recording.data,'base64')],{type:recording.mime}),'response.'+suffix);
  form.append('language','en');
  // Never supply the reference answer: it could bias the transcript toward words not spoken.
  const response=await request('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+apiKey},body:form,signal:AbortSignal.timeout(60000)});
  if(!response.ok){
    const body=await response.json().catch(()=>({}));
    // Log only provider status/codes, never keys, audio, transcripts or raw error messages.
    const code=String(body.error?.code||body.error?.type||'unknown').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);
    console.warn('[speaking-transcription]',JSON.stringify({status:response.status,code}));
    const reason=response.status===401?'The transcription API key is invalid or expired. The administrator needs to update it.'
      :response.status===403?'The transcription API key does not have access. The administrator needs to check its permissions.'
      :code==='insufficient_quota'?'The transcription account has no available API credit. The administrator needs to check API billing and usage limits.'
      :response.status===429?'The transcription service is busy. Please wait a moment and retry.'
      :response.status===400||response.status===422?'The transcription service could not read this audio. Try a new recording or upload a WAV or MP3 file.'
      :response.status===404?'The configured transcription model is unavailable. The administrator needs to check the model setting.'
      :'Automatic transcription is temporarily unavailable. Please retry.';
    throw fail(reason+' Your recording is saved; you can enter your spoken words manually to get content feedback. [Transcription '+(response.status||503)+': '+code+']',503);
  }
  const data=await response.json();if(typeof data.text!=='string'||data.text.length>6000)throw fail('The transcript could not be read. Enter your spoken words manually.',503);
  return data.text;
}
function installSpeakingLab(app,{pool,directory,verifyToken,getAccount,callModel,transcribe=transcribeRecording,transcriptionAvailable=!!process.env.OPENAI_API_KEY,assessDelivery=delivery.assessRecording,deliveryAssessmentAvailable=delivery.isConfigured()}) {
  const store=createStore(pool,directory,{table:'speaking_lab_attempts'}),router=express.Router();
  if(assessDelivery===delivery.assessRecording)console.info('[speaking-delivery-config]',JSON.stringify(delivery.configurationSummary()));
  const wrap=fn=>(req,res)=>Promise.resolve(fn(req,res)).catch(e=>{res.set('Cache-Control','no-store');res.status(e.status||503).json({error:e.status?e.message:'This action could not finish. Your saved work is safe; please retry.'});});
  const get=(uid,id)=>store.update(uid,id,a=>{if(!a)throw fail('Attempt not found.',404);return a;});
  router.get('/catalog',(_,res)=>res.json({version:bank.version,source:bank.source,transcriptionAvailable,deliveryAssessment:deliveryAssessmentAvailable?'audio':'teacher',deliveryAssessmentAvailable,deliveryVersion:delivery.VERSION,types:bank.types,questions:bank.questions.map(q=>({id:q.id,type:q.type,title:q.title,seconds:q.seconds,preparation:q.preparation,...(q.topic?{topic:q.topic}:{}),...(q.predictionSource?.sourceId?{predictionSource:{sourceId:q.predictionSource.sourceId,provider:q.predictionSource.provider,week:q.predictionSource.week,weekly:q.predictionSource.weekly,monthly:q.predictionSource.monthly,priority:q.predictionSource.priority}}:{}),...(q.type==='di'?{imageCategory:q.imageCategory||q.visual?.kind||'unclassified'}:{})}))}));
  router.get('/describe-image-learning',(_,res)=>res.json({
    version:bank.version,source:bank.source,
    questions:bank.questions.filter(q=>q.type==='di').map(q=>({
      id:q.id,title:q.title,imageCategory:q.imageCategory||q.visual?.kind||'unclassified',imageUrl:q.imageUrl||'/speaking-image/'+q.id+'.svg',
      ...(q.predictionSource?{predictionSource:{provider:q.predictionSource.provider,sourceId:q.predictionSource.sourceId,week:q.predictionSource.week,weekly:!!q.predictionSource.weekly,priority:q.predictionSource.priority}}:{})
    }))
  }));
  router.use(async(req,res,next)=>{try{const uid=verifyToken(req.headers['x-session-token']||'');const account=uid&&await getAccount(uid);if(!account||account.blocked)return res.status(401).json({error:'Please sign in to your practice account.'});req.speakingUser=uid;res.set('Cache-Control','no-store');next();}catch{res.status(503).json({error:'Your account could not be checked. Please retry.'});}});
  const limiter=require('express-rate-limit')({windowMs:600000,max:40,keyGenerator:req=>req.speakingUser,standardHeaders:true,legacyHeaders:false,message:{error:'Please wait before starting another speaking action.'}});
  router.get('/attempts',wrap(async(req,res)=>{const entries=await store.list(req.speakingUser);res.json(entries.map(a=>({id:a.id,questionId:a.questionId,title:bank.questions.find(q=>q.id===a.questionId)?.title,type:bank.questions.find(q=>q.id===a.questionId)?.type,status:a.status,startedAt:a.startedAt,result:a.result?{total:a.result.total,maximum:a.result.maximum}:null})));}));
  router.post('/attempts',limiter,wrap(async(req,res)=>{
    const q=bank.questions.find(q=>q.id===req.body?.questionId);if(!q)throw fail('Question not found.',404);
    const a=await store.update(req.speakingUser,req.body.id,old=>{if(old&&old.questionId!==q.id)throw fail('This attempt belongs to another question.',409);return old||{id:req.body.id,questionId:q.id,status:'draft',startedAt:Date.now(),transcript:'',revision:0};});res.json(present(a));
  }));
  router.get('/attempts/:id',wrap(async(req,res)=>res.json(present(await get(req.speakingUser,req.params.id)))));
  router.post('/attempts/:id/recording',limiter,express.raw({type:['audio/webm','audio/mp4','audio/wav','audio/mpeg'],limit:'3mb'}),wrap(async(req,res)=>{
    const mime=(req.headers['content-type']||'').split(';')[0].trim();
    if(!Buffer.isBuffer(req.body)||req.body.length<100||!['audio/webm','audio/mp4','audio/wav','audio/mpeg'].includes(mime))throw fail('Upload a valid WebM, MP4, WAV or MP3 recording.');
    const hash=crypto.createHash('sha256').update(req.body).digest('hex');
    const a=await store.update(req.speakingUser,req.params.id,a=>{if(!a)throw fail('Attempt not found.',404);if(a.recording?.hash===hash)return a;if(a.status==='submitted'||a.recording)throw fail('This attempt already has a recording. Reattempt to make a fresh recording.',409);a.recording={mime,data:req.body.toString('base64'),hash};return a;});res.json(present(a));
  }));
  router.get('/attempts/:id/recording',wrap(async(req,res)=>{const a=await get(req.speakingUser,req.params.id);if(!a.recording)throw fail('No recording is saved for this attempt.',404);res.set('X-Content-Type-Options','nosniff');res.type(a.recording.mime).send(Buffer.from(a.recording.data,'base64'));}));
  router.post('/attempts/:id/transcribe',limiter,wrap(async(req,res)=>{
    const a=await store.update(req.speakingUser,req.params.id,async a=>{if(!a)throw fail('Attempt not found.',404);if(a.status==='submitted')throw fail('This attempt is submitted. Reattempt to practise again.',409);if(!a.recording)throw fail('Record or upload your response first.');if(a.transcription)return a;if(a.transcript.trim())throw fail('A transcript already exists. Review it or start a fresh attempt.',409);a.transcription=await transcribe(a.recording);a.transcript=a.transcription;a.revision++;return a;});res.json(present(a));
  }));
  router.post('/attempts/:id/transcript',wrap(async(req,res)=>{
    const {text,revision}=req.body||{};if(typeof text!=='string'||text.length>6000||!Number.isInteger(revision))throw fail('Enter a transcript of at most 6,000 characters.');
    const a=await store.update(req.speakingUser,req.params.id,a=>{if(!a)throw fail('Attempt not found.',404);if(a.status==='submitted')throw fail('This response is already submitted.',409);if(revision!==a.revision)throw fail('A newer transcript is saved. Reopen this attempt before editing.',409);a.transcript=text;a.revision++;return a;});res.json(present(a));
  }));
  router.post('/attempts/:id/submit',limiter,wrap(async(req,res)=>{
    let a=await store.update(req.speakingUser,req.params.id,async a=>{if(!a)throw fail('Attempt not found.',404);if(!a.transcript?.trim()){
      if(a.recording&&!a.transcription){a.transcription=await transcribe(a.recording);a.transcript=a.transcription;a.revision++;}
      if(!a.transcript?.trim())throw fail('No spoken words were recognised. Review your recording and enter what you said, or record a new attempt.');
    }a.status='submitted';return a;});
    a=await store.update(req.speakingUser,req.params.id,async a=>{
      const q=bank.questions.find(q=>q.id===a.questionId);
      if(!a.result || a.result.scoringMode==='local') {
        const previous=a.result,next=await scoring.grade(q,a.transcript,callModel);
        if(!previous || next.scoringMode!=='local'||next.version!==previous.version) {
          // Content retries must retain the independent assessment of the same audio.
          const savedDelivery={};
          for(const key of ['pronunciation','fluency','deliveryVersion','deliveryEvidence','deliveryStatus','deliveryAssessment','deliveryProvider'])
            if(previous&&Object.prototype.hasOwnProperty.call(previous,key))savedDelivery[key]=previous[key];
          a.result={...next,...savedDelivery};
        }
      }
      if(a.result&&a.recording&&deliveryAssessmentAvailable&&(a.result.pronunciation==null||a.result.deliveryVersion!==delivery.VERSION)) {
        try {
          const assessed=await assessDelivery(a.recording,{question:q,transcript:a.transcript,transcribe});
          if(assessed)a.result={...a.result,...assessed};
        } catch(error) {
          const code=String(error?.code||error?.name||'delivery_error').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);
          const status=Number.isInteger(error?.providerStatus)?error.providerStatus:undefined;
          console.warn('[speaking-delivery]',JSON.stringify({code,...(status?{status}:{})}));
          a.result={...a.result,deliveryStatus:'Audio delivery assessment temporarily unavailable'};
        }
      } else if(a.result&&a.result.pronunciation==null&&!deliveryAssessmentAvailable) {
        a.result={...a.result,deliveryStatus:'Teacher review — automated audio assessment not configured'};
      }
      return a;
    });res.json(present(a));
  }));
  router.use((error,req,res,next)=>{if(error.type==='entity.too.large')return res.status(413).json({error:'Recording is too large. Use a file under 3 MB.'});next(error);});
  app.use('/api/speaking',router);
  app.get('/speaking-image/:id.svg',(req,res)=>{const q=bank.questions.find(q=>q.id===req.params.id&&q.visual&&!q.imageUrl);if(!q)return res.sendStatus(404);res.type('image/svg+xml').set('Cache-Control','public,max-age=3600').send(require('./speaking-visuals').render(q.visual));});
  app.get('/speaking-audio/:id.mp3',wrap(async(req,res)=>{
    const q=bank.questions.find(q=>q.id===req.params.id&&hasPrompt(q));if(!q)throw fail('Recording not found.',404);
    const folder=path.join(__dirname,'content','speaking-audio'),manifest=JSON.parse(await fs.readFile(path.join(folder,'manifest.json'),'utf8')),entry=manifest[q.id];
    if(!entry||entry.textSha256!==crypto.createHash('sha256').update(q.text).digest('hex'))throw fail('This prompt recording is unavailable. Please retry later.',503);
    res.type('audio/mpeg').set('Cache-Control','public,max-age=3600').sendFile(path.join(folder,q.id+'.mp3'));
  }));
  return {store};
}
module.exports={installSpeakingLab,transcribeRecording,question,present};
