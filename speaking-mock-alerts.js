'use strict';
const path=require('node:path'),report=require('./speaking-mock-report');
const {createJobs,createWorker,stage,disposition,hash}=require('./scoring-jobs');
const VERSION='speaking-admin-alert-v1',TEN_MINUTES=10*60000;
const LABELS={ra:'Read Aloud',rs:'Repeat Sentence',di:'Describe Image',rl:'Retell Lecture',sgd:'Summarise Group Discussion',rts:'Respond to a Situation'};
const clean=(value,max=120)=>String(value||'').replace(/[\r\n<>]/g,' ').slice(0,max);
const complete=a=>a?.status==='submitted'&&report.summarize(a).openai.status==='assessed'&&report.summarize(a).azure.status==='assessed';
function smtpFailure(error){
  const response=Number(error?.responseCode),command=String(error?.command||'').toUpperCase();
  const code=error?.code==='EAUTH'?'SMTP_AUTH':Number.isInteger(response)?'SMTP_'+response:/^(ECONNECTION|ESOCKET|ETIMEDOUT|EDNS)$/.test(error?.code||'')?error.code:'SMTP_UNCONFIRMED';
  const definite=Number.isInteger(response)&&response>=400&&response<=599;
  const beforeData=['CONN','EHLO','HELO','STARTTLS','AUTH','MAIL FROM','RCPT TO'].includes(command);
  return Object.assign(Error('Administrator alert email could not be confirmed.'),{code,...(definite?{httpStatus:response>=500?400:503}:beforeData?{httpStatus:503}:{uncertain:true})});
}
function guidance(code){
  if(code==='publication_save_failed')return'All required marks are present. Check the database write/result-publication failure; do not reassess the student audio.';
  if(code==='uncertain_provider_outcome')return'Inspect provider usage/request logs before resuming; the earlier paid request has an uncertain outcome.';
  if([401,403].includes(code))return'Check the provider credentials and account/model access.';
  if(code===429)return'Check the provider quota and rate limits.';
  if(code==='academy_transport')return'Check the Visual Academy scoring-service connection and service status.';
  if(code==='validation')return'Inspect the saved audio and validation diagnostics; resume only the missing assessment.';
  return'Check the scoring worker and provider diagnostics; retain successful scores and the original recording.';
}
function messageFor(incident,{recipient,from,origin}){
  const date=new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Brisbane',dateStyle:'medium',timeStyle:'short'}).format(new Date(incident.submittedAt));
  const lines=['A speaking mock needs administrator attention.','',
    'Student username: '+clean(incident.username),'Mock: '+clean(incident.title),'Attempt ID: '+incident.attemptId,
    'Submitted: '+date+' (Brisbane)','Waiting: '+incident.waitingMinutes+' minutes',
    'Questions accounted for in both reports: '+incident.accountedFor+'/'+incident.total,'',
    incident.reason==='staff_review'?'Scoring has stopped for staff review.':'The complete report is still unpublished after 10 minutes. Automatic scoring may still be running.','',
    'Pending assessments:',...(incident.pending.length?incident.pending.map(q=>'- Question '+q.number+' — '+q.label+' ['+clean(q.questionId)+']: '+q.missing.join('; ')):['- All required marks are present; result publication needs checking.']),
    '', 'Checks needed:',...(incident.failures.length?incident.failures.map(f=>'- '+clean(f.stage)+' / '+clean(f.code)+(f.detail?' ('+clean(f.detail)+')':'')+': '+guidance(f.code)):['- Check worker progress, provider availability and result publication.']),
    '', 'Admin portal: '+origin+'/admin',
    'Diagnostics (admin authentication required): '+origin+'/api/admin/speaking-mocks/'+encodeURIComponent(incident.username)+'/'+encodeURIComponent(incident.attemptId)+'/scoring',
    '', 'The student recordings and completed assessments are saved. The report remains hidden until all required results are ready.',
    'This notification is sent once for this attempt; restarting the service does not generate another alert.'];
  return{from:'"IPT Brisbane Alerts" <'+from+'>',to:recipient,replyTo:from,
    subject:'[IPT Brisbane] Speaking mock needs attention: '+clean(incident.username,80),
    messageId:'<speaking-mock-'+hash(incident.attemptId).slice(0,40)+'@'+new URL(origin).hostname+'>',text:lines.join('\n')};
}
function createSpeakingMockAlerts({pool,directory,mockStore,progressive,mailer,from='',recipient='',origin='https://swt.up.railway.app',enabled=false,now=Date.now,logger=console,intervalMs=60000}={}){
  if(enabled&&(!/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(recipient)||!/^https:\/\/[^/]+$/.test(origin)))throw Error('Invalid speaking alert configuration.');
  const jobs=createJobs({pool,directory:path.join(directory,'admin-alerts'),table:'speaking_mock_alert_jobs',now});
  let cursor='',timer,checking=false,started=false,verification;
  const health={enabled,recipient:enabled?recipient:null,transportConfigured:!!mailer&&!!from,verified:false,verifiedAt:null,lastError:null,lastSentAt:null};
  async function incident(username,a){
    if(!a||a.status!=='submitted'||complete(a))return null;
    const candidate=await progressive.hydrate(username,a);let publicationFailed=false;
    if(complete(candidate)){try{await progressive.publish(username,a.id);a=await mockStore.get(username,a.id,{omitMockAudio:true});if(complete(a))return null;}catch{publicationFailed=true;}}
    const diagnostic=await progressive.diagnostics(username,a.id),submittedAt=a.finishedAt||a.deadline||a.startedAt;
    const held=publicationFailed||diagnostic.jobs.some(j=>j.status==='needs_attention');
    if(!held&&now()-submittedAt<TEN_MINUTES)return null;
    const summary=report.summarize(candidate),indices=[...new Set([...summary.openai.missingQuestions,...summary.azure.missingQuestions].map(q=>q.index))];
    const missingLabel={content:'content',pronunciation:'pronunciation',fluency:'fluency',recording:'saved recording','question-rubric':'question rubric'};
    return{username,attemptId:a.id,title:a.title||'Speaking mock',submittedAt,waitingMinutes:Math.max(0,Math.floor((now()-submittedAt)/60000)),reason:held?'staff_review':'overdue',
      total:a.questionCount,accountedFor:diagnostic.accountedFor,pending:indices.map(index=>({number:a.questions.slice(0,index+1).filter(q=>q.type!=='intro').length,label:LABELS[a.questions[index].type]||'Speaking answer',questionId:a.questions[index].id,
        missing:['openai','azure'].flatMap(provider=>(summary[provider].missingQuestions.find(q=>q.index===index)?.missing||[]).map(name=>(provider==='openai'?'OpenAI':'Azure')+' '+(missingLabel[name]||'assessment')))})),
      failures:[...(publicationFailed?[{stage:'publication',code:'publication_save_failed',detail:null}]:[]),...diagnostic.jobs.flatMap(job=>[
        ...Object.entries(job.stages).filter(([name,s])=>s.status==='needs_attention'&&(name!=='academy'||s.code)).map(([name,s])=>({stage:name,code:s.code,detail:s.detail?.recognitionStatus||s.detail?.code||null})),
        ...(job.remoteFailures||[]).map(f=>({stage:'Visual Academy '+f.stage,code:f.code,detail:null}))])].slice(0,30)};
  }
  const worker=createWorker({store:jobs,now,concurrency:1,run:async ctx=>{
    const a=await mockStore.get(ctx.row.owner,ctx.row.group_id,{omitMockAudio:true}),current=await incident(ctx.row.owner,a);
    if(!current){await ctx.save(d=>{d.outcome='resolved-before-email';d.closedAt=now();});return{status:'ready'};}
    await ctx.save(d=>{d.incident=current;});
    await stage(ctx,'email',async()=>{
      if(!mailer||!from)throw Object.assign(Error('Portal mailer is not configured.'),{httpStatus:400,code:'SMTP_NOT_CONFIGURED'});
      let receipt;try{receipt=await mailer.sendMail(messageFor(current,{recipient,from,origin}));}catch(error){const failure=smtpFailure(error);health.lastError=failure.code;if(error?.code==='EAUTH')health.verified=false;throw failure;}
      if(!receipt?.accepted?.some(address=>String(address).toLowerCase()===recipient.toLowerCase()))throw Object.assign(Error('Alert recipient was rejected.'),{httpStatus:400,code:'SMTP_RECIPIENT_REJECTED'});
      health.lastError=null;health.lastSentAt=now();return{messageId:clean(receipt.messageId,200),acceptedAt:now()};
    },{now,maxAttempts:8,retryDelay:n=>Math.min(3600000,60000*5**Math.min(n-1,3)),accept:(d,value)=>{d.outcome='sent';d.sentAt=value.acceptedAt;}});
    const final=disposition(ctx.data,ctx.data.outcome==='sent',now);
    if(final.status==='ready')logger.info('[speaking-alerts]',JSON.stringify({event:'email_sent',attemptId:ctx.row.group_id,recipient}));
    else if(final.status==='needs_attention')logger.warn('[speaking-alerts]',JSON.stringify({event:'email_delivery_needs_attention',attemptId:ctx.row.group_id,code:ctx.data.stages.email?.failure,detail:ctx.data.stages.email?.detail}));
    return final;
  }});
  async function candidates(){
    if(pool)return(await pool.query(`SELECT a.id::text AS id,a.username FROM speaking_mock_attempts a
      WHERE a.id::text>$1 AND a.data->>'status'='submitted' AND COALESCE(a.data->'assessment'->>'status','')<>'ready'
      AND (a.data->'assessmentProfile'->>'mode'='progressive-v1' OR a.data->'grading'->>'status' IN ('pending','processing')
        OR EXISTS(SELECT 1 FROM speaking_answer_jobs j WHERE j.owner=a.username AND j.group_id=a.id::text))
      AND NOT EXISTS(SELECT 1 FROM speaking_mock_alert_jobs n WHERE n.id=a.id::text AND n.owner=a.username)
      ORDER BY a.id LIMIT 100`,[cursor])).rows;
    return(await mockStore.scanForScoring(cursor,100)).map(row=>({id:row.data.id,username:row.username}));
  }
  async function check(){if(!enabled||checking)return;checking=true;try{
    const rows=await candidates();cursor=rows.length?rows.at(-1).id:'';
    for(const row of rows){try{const a=await mockStore.get(row.username,row.id,{omitMockAudio:true});if(await incident(row.username,a))await jobs.enqueue({id:row.id,owner:row.username,groupId:row.id,inputHash:hash({version:VERSION,username:row.username,id:row.id}),data:{version:VERSION,openedAt:now(),stages:{}}});}catch{logger.warn('[speaking-alerts]',JSON.stringify({event:'attempt_check_failed',attemptId:row.id}));}}
    await worker.wake();
  }finally{checking=false;}}
  async function verify(){if(!enabled)return health;try{if(!mailer?.verify||!from)throw Error('not-configured');await mailer.verify();health.verified=true;health.verifiedAt=now();health.lastError=null;logger.info('[speaking-alerts]',JSON.stringify({event:'smtp_verified',recipient,stallMinutes:10,checkSeconds:intervalMs/1000}));}catch(error){health.verified=false;health.lastError=error?.code==='EAUTH'?'SMTP_AUTH':mailer?'SMTP_CONNECTION':'SMTP_NOT_CONFIGURED';logger.warn('[speaking-alerts]',JSON.stringify({event:'smtp_verification_failed',code:health.lastError}));}return{...health};}
  return{jobs,check,verify,health:()=>({...health}),async start(){if(!enabled||started)return;started=true;await jobs.initialise();await worker.start();await check();timer=setInterval(()=>check().catch(()=>logger.warn('[speaking-alerts] monitor scan will retry')),intervalMs);timer.unref?.();verification=verify();},async stop(){started=false;clearInterval(timer);await worker.stop();await verification;},wait:worker.wait};
}
module.exports={VERSION,TEN_MINUTES,createSpeakingMockAlerts,messageFor,smtpFailure};
