'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createSpeakingMockAlerts,TEN_MINUTES,smtpFailure}=require('../speaking-mock-alerts');
const {REPLAY_WINDOW_MS}=require('../speaking-alert-mailer');
function attempt(time){const delivery=()=>({status:'assessed',pronunciation:{score:5},fluency:{score:5}});return{id:crypto.randomUUID(),title:'Speaking mock 1',status:'submitted',startedAt:time-2000000,finishedAt:time-1000,questionCount:1,index:1,grading:{status:'pending'},assessmentProfile:{mode:'progressive-v1',owner:'mahdis'},questions:[{id:'rs-1',type:'rs',text:'one two three four five six'}],responses:[{recording:{hash:'saved',data:'PRIVATE_AUDIO'},transcript:'PRIVATE_TRANSCRIPT',content:{total:3,maximum:3,scoringMode:'ai'},gpt:delivery()}]};}
async function fixture(t,{held=true,send,resolveBeforeSend=false}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-alert-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));let time=1800000000000,reads=0,verified=0;const a=attempt(time),messages=[],logs=[];
  const store={scanForScoring:async cursor=>cursor?[]:[{username:'mahdis',data:a}],get:async(uid,id,opts)=>{assert.equal(uid,'mahdis');assert.equal(id,a.id);assert.equal(opts.omitMockAudio,true);if(resolveBeforeSend&&++reads>=2)a.responses[0].azure={status:'assessed',pronunciation:{score:4},fluency:{score:4}};return structuredClone(a);}};
  const progressive={hydrate:async(uid,value)=>structuredClone(value),publish:async()=>{},diagnostics:async()=>({accountedFor:0,total:1,jobs:held?[{id:'answer-job',index:0,status:'needs_attention',stages:{azure:{status:'needs_attention',code:'validation'}}}]:[]})};
  const mailer={verify:async()=>{verified++;return true;},sendMail:async message=>{messages.push(message);return send?send(message):{accepted:['auspuru@gmail.com'],messageId:message.messageId};}};
  const create=()=>createSpeakingMockAlerts({directory,mockStore:store,progressive,mailer,recipient:'auspuru@gmail.com',from:'portal@example.test',enabled:true,now:()=>time,logger:{info:(tag,line)=>logs.push(line),warn:(tag,line)=>logs.push(line)}});
  const service=create();t.after(()=>service.stop());return{a,service,create,messages,logs,store,progressive,mailer,verified:()=>verified,advance:ms=>{time+=ms;},time:()=>time};
}
test('a submitted mock needing staff review emails the exact admin once, with actionable details and no learner audio or transcript',async t=>{
  const h=await fixture(t);await h.service.start();await h.service.wait();assert.equal(h.messages.length,1);const m=h.messages[0];assert.equal(m.to,'auspuru@gmail.com');assert.match(m.subject,/Speaking mock needs attention: mahdis/);assert.match(m.text,/Student username: mahdis/);assert.match(m.text,/Azure pronunciation/);assert.match(m.text,/validation/);assert.match(m.text,/https:\/\/swt.up.railway.app\/admin/);assert(!JSON.stringify(m).includes('PRIVATE_AUDIO'));assert(!JSON.stringify(m).includes('PRIVATE_TRANSCRIPT'));assert.equal(m.cc,undefined);assert.equal(m.bcc,undefined);assert.equal(h.service.health().verified,true);
  await h.service.check();await h.service.check();await h.service.wait();assert.equal(h.messages.length,1);await h.service.stop();const resumed=h.create();await resumed.start();await resumed.wait();await resumed.stop();assert.equal(h.messages.length,1,'The persistent receipt survives restart.');
});
test('ordinary retries wait ten minutes before alerting, then generate one overdue notification',async t=>{
  const h=await fixture(t,{held:false});await h.service.start();await h.service.wait();assert.equal(h.messages.length,0);h.advance(TEN_MINUTES);await h.service.check();await h.service.check();await h.service.wait();assert.equal(h.messages.length,1);assert.match(h.messages[0].text,/still unpublished after 10 minutes/);assert.match(h.messages[0].text,/Automatic scoring may still be running/);
});
test('the watchdog does not alert for active or fully completed mocks',async t=>{
  const h=await fixture(t);h.a.status='active';await h.service.start();await h.service.wait();assert.equal(h.messages.length,0);h.a.status='submitted';h.a.responses[0].azure={status:'assessed',pronunciation:{score:4},fluency:{score:4}};await h.service.check();await h.service.check();await h.service.wait();assert.equal(h.messages.length,0);
});
test('a report resolved before the queued email is sent cancels the notification',async t=>{
  const h=await fixture(t,{resolveBeforeSend:true});await h.service.start();await h.service.wait();assert.equal(h.messages.length,0);const row=await h.service.jobs.get('mahdis',h.a.id);assert.equal(row.status,'ready');assert.equal(row.data.outcome,'resolved-before-email');
});
test('already-saved complete marks are published without rescoring or sending a false alert',async t=>{
  const h=await fixture(t),delivery={status:'assessed',pronunciation:{score:4},fluency:{score:4}};let publications=0;
  h.progressive.hydrate=async(uid,a)=>{a.responses[0].azure=delivery;return a;};h.progressive.publish=async()=>{publications++;h.a.responses[0].azure=delivery;};
  await h.service.start();await h.service.wait();assert.equal(publications,1);assert.equal(h.messages.length,0);
});
test('a publication failure alerts staff without exposing a raw error or requesting another audio assessment',async t=>{
  const h=await fixture(t,{held:false});h.progressive.hydrate=async(uid,a)=>{a.responses[0].azure={status:'assessed',pronunciation:{score:4},fluency:{score:4}};return a;};h.progressive.publish=async()=>{throw Error('PRIVATE_DATABASE_ERROR');};
  await h.service.start();await h.service.wait();assert.equal(h.messages.length,1);assert.match(h.messages[0].text,/publication_save_failed/);assert.match(h.messages[0].text,/do not reassess the student audio/);assert(!h.messages[0].text.includes('PRIVATE_DATABASE_ERROR'));
});
test('Visual Academy failures include the remote stage and the safe action for an uncertain paid request',async t=>{
  const h=await fixture(t);h.progressive.diagnostics=async()=>({accountedFor:0,total:1,jobs:[{status:'needs_attention',stages:{academy:{status:'needs_attention',code:null}},remoteFailures:[{stage:'content',code:'uncertain_provider_outcome'}]}]});
  await h.service.start();await h.service.wait();assert.match(h.messages[0].text,/Visual Academy content \/ uncertain_provider_outcome/);assert.match(h.messages[0].text,/Inspect provider usage\/request logs before resuming/);
});
test('a definite transient mail connection failure retries durably after backoff and delivers once',async t=>{
  let calls=0;const h=await fixture(t,{send:async message=>{if(++calls===1)throw Object.assign(Error('connection failed'),{code:'ECONNECTION',command:'CONN'});return{accepted:['auspuru@gmail.com'],messageId:message.messageId};}});await h.service.start();await h.service.wait();let row=await h.service.jobs.get('mahdis',h.a.id);assert.equal(row.status,'retry_wait');assert.equal(Number(row.run_after),h.time()+60000);h.advance(60001);await h.service.wait();row=await h.service.jobs.get('mahdis',h.a.id);assert.equal(row.status,'ready');assert.equal(row.data.outcome,'sent');assert.equal(calls,2);assert.equal(h.messages[0].messageId,h.messages[1].messageId);
});
test('an uncertain SMTP DATA outcome is held rather than generating duplicate emails',async t=>{
  const h=await fixture(t,{send:async()=>{throw Object.assign(Error('connection lost after DATA'),{code:'ETIMEDOUT',command:'DATA'});}});await h.service.start();await h.service.wait();let row=await h.service.jobs.get('mahdis',h.a.id);assert.equal(row.status,'needs_attention');assert.equal(row.data.stages.email.failure,'uncertain_provider_outcome');h.advance(86400000);await h.service.check();await h.service.wait();assert.equal(h.messages.length,1);
});
test('SMTP classification retries explicit temporary rejections while keeping authentication failures and uncertain sends distinct',()=>{
  assert.equal(smtpFailure({responseCode:451,command:'DATA'}).httpStatus,503);assert.equal(smtpFailure({responseCode:535,code:'EAUTH',command:'AUTH'}).httpStatus,400);assert.equal(smtpFailure({command:'DATA',code:'ESOCKET'}).uncertain,true);assert.equal(smtpFailure({command:'CONN',code:'ETIMEDOUT'}).uncertain,undefined);
});
test('disabled alerting performs no scans, SMTP checks or sends',async()=>{
  const service=createSpeakingMockAlerts({directory:'/unused',enabled:false,mockStore:{scanForScoring(){throw Error('must not scan');}},progressive:{},mailer:{verify(){throw Error('must not verify');},sendMail(){throw Error('must not send');}}});await service.start();await service.check();await service.stop();assert.equal(service.health().enabled,false);
});

test('HTTPS retries keep the original body when waiting time and diagnostics have changed',async t=>{
  let calls=0;const h=await fixture(t,{send:async message=>{if(++calls===1)throw Object.assign(Error('timed out'),{code:'RESEND_CONNECTION',httpStatus:503});return{accepted:['auspuru@gmail.com'],messageId:'accepted'};}});
  Object.assign(h.mailer,{provider:'resend',replayWindowMs:REPLAY_WINDOW_MS,classifyFailure:error=>error});
  // Recreate to capture the HTTPS transport selected before startup.
  const service=h.create();t.after(()=>service.stop());await service.start();await service.wait();h.advance(60001);await service.wait();
  assert.equal(calls,2);assert.deepEqual(h.messages[0],h.messages[1]);assert.equal((await service.jobs.get('mahdis',h.a.id)).data.outcome,'sent');
});

test('a crashed HTTPS send is recovered with the same payload and key inside the replay window',async t=>{
  let calls=0;const h=await fixture(t,{send:async message=>{if(++calls===1)throw Object.assign(Error('timed out'),{code:'RESEND_CONNECTION',httpStatus:503});return{accepted:['auspuru@gmail.com'],messageId:'accepted'};}});
  Object.assign(h.mailer,{provider:'resend',replayWindowMs:REPLAY_WINDOW_MS,classifyFailure:error=>error});const first=h.create();await first.start();await first.wait();await first.stop();
  h.advance(60001);const row=await first.jobs.claim();row.data.stages.email.status='calling';await first.jobs.save(row,row.data);h.advance(180001);
  const resumed=h.create();t.after(()=>resumed.stop());await resumed.start();await resumed.wait();assert.equal(calls,2);assert.deepEqual(h.messages[0],h.messages[1]);assert.equal((await resumed.jobs.get('mahdis',h.a.id)).status,'ready');
});

test('HTTPS never replays an uncertain request after the provider deduplication window',async t=>{
  const h=await fixture(t,{send:async()=>{throw Object.assign(Error('timed out'),{code:'RESEND_CONNECTION',httpStatus:503});}});Object.assign(h.mailer,{provider:'resend',replayWindowMs:REPLAY_WINDOW_MS,classifyFailure:error=>error});
  const service=h.create();t.after(()=>service.stop());await service.start();await service.wait();h.advance(REPLAY_WINDOW_MS);await service.wait();const row=await service.jobs.get('mahdis',h.a.id);assert.equal(h.messages.length,1);assert.equal(row.status,'needs_attention');assert.equal(row.data.stages.email.detail.code,'MAIL_REPLAY_WINDOW_EXPIRED');
});

test('an unconfigured mail provider preserves queued alerts without consuming the send retry budget',async t=>{
  const h=await fixture(t);h.mailer.configured=false;h.mailer.configurationError='RESEND_NOT_CONFIGURED';const blocked=h.create();await blocked.start();await blocked.wait();let row=await blocked.jobs.get('mahdis',h.a.id);assert.equal(row.status,'retry_wait');assert.equal(row.data.stages.email,undefined);assert.equal(h.messages.length,0);await blocked.stop();
  h.mailer.configured=true;h.advance(60001);const resumed=h.create();t.after(()=>resumed.stop());await resumed.start();await resumed.wait();row=await resumed.jobs.get('mahdis',h.a.id);assert.equal(row.data.outcome,'sent');assert.equal(h.messages.length,1);
});

test('configuration-only HTTPS validation does not claim a verified mail connection',async t=>{
  const h=await fixture(t,{held:false});h.mailer.provider='resend';h.mailer.verify=async()=>({configurationOnly:true});const service=h.create();t.after(()=>service.stop());await service.start();await service.verify();assert.equal(service.health().verified,false);assert.equal(service.health().verification,'configuration-only');assert.equal(service.health().transportConfigured,true);assert.equal(h.messages.length,0);
});
