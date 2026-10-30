'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const express=require('express');
const {createSpeakingMockAlerts}=require('../speaking-mock-alerts');
const {createMockTestAlerts,TEN_MINUTES}=require('../mock-test-alerts');
const {createSources,snapshot}=require('../mock-test-alert-sources');
const {capture}=require('../mock-test-alert-http');
const {eventKey}=require('../mock-test-alert-events');
async function fixture(t,{enabled=true,send}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'all-mock-alerts-'));let time=1800000000000;
  const messages=[],records=new Map(),services=[],sources={};
  for(const engine of ['speaking','writing','listening','reading','full'])sources[engine]={get:async(uid,id)=>records.get(engine+':'+uid+':'+id)||null};
  const mailer={verify:async()=>true,sendMail:async message=>{messages.push(structuredClone(message));return send?send(message):{accepted:['owner@example.test'],messageId:message.messageId};}};
  function create(){
    const delivery=createSpeakingMockAlerts({directory,enabled,recipient:'owner@example.test',from:'alerts@example.test',mailer,now:()=>time,logger:{info(){},warn(){}},mockStore:{scanForScoring:async()=>[]},progressive:{}});
    const monitor=createMockTestAlerts({directory,enabled,delivery,sources,now:()=>time,logger:{warn(){}}});
    const service={delivery,monitor,async start(){await delivery.start();await monitor.start();},async wait(){await monitor.wait();await delivery.wait();},async stop(){await monitor.stop();await delivery.stop();}};services.push(service);return service;
  }
  t.after(async()=>{for(const service of services)await service.stop();await fs.rm(directory,{recursive:true,force:true});});
  const service=create();await service.start();
  return{...service,create,sources,records,messages,mailer,time:()=>time,advance(ms){time+=ms;},put(engine,options={}){const a={id:randomUUID(),isMock:true,title:engine+' mock',submitted:true,finishedAt:time,ready:true,pending:0,...options};records.set(engine+':student:'+a.id,a);return a;}};
}
for(const engine of ['speaking','writing','listening','reading','full'])test(engine+' submission sends one fixed-recipient notification across repeats and restart',async t=>{
  const h=await fixture(t),a=h.put(engine);
  await Promise.all([h.monitor.observe(engine,'student',a),h.monitor.observeId(engine,'student',a.id)]);await h.wait();
  assert.equal(h.messages.length,1);assert.equal(h.messages[0].to,'owner@example.test');assert.match(h.messages[0].subject,/mock submitted: student/);
  assert.match(h.messages[0].text,/Submission received and saved/);assert.match(h.messages[0].text,/Report status: Ready/);
  await h.stop();h.advance(60000);const resumed=h.create();await resumed.start();await resumed.monitor.observe(engine,'student',a);await resumed.wait();
  assert.equal(h.messages.length,1);assert.equal(resumed.monitor.health().activeSince,a.finishedAt);
});
test('old submissions and individual practice do not generate submission mail; a persisted activation time survives restart',async t=>{
  const h=await fixture(t),old=h.put('reading',{finishedAt:h.time()-1}),practice=h.put('listening',{isMock:false});
  await h.monitor.observe('reading','student',old);await h.monitor.observe('listening','student',practice);await h.wait();assert.equal(h.messages.length,0);
  await h.stop();h.advance(86400000);const resumed=h.create();await resumed.start();
  const missed=h.put('writing',{finishedAt:old.finishedAt+1000});h.sources.writing.scan=async()=>({rows:[{username:'student',snapshot:missed}],nextCursor:''});
  await resumed.monitor.check();await resumed.wait();assert.equal(h.messages.length,1,'A submission missed during downtime is recovered after rollout, without historical backfill.');
});
test('a report still pending after ten minutes triggers one attention notice; ready reports do not',async t=>{
  const h=await fixture(t),a=h.put('full',{ready:false,pending:3});await h.monitor.observe('full','student',a);await h.wait();assert.equal(h.messages.length,1);
  h.advance(TEN_MINUTES-1);await h.wait();assert.equal(h.messages.length,1);
  h.advance(60001);await h.wait();assert.equal(h.messages.length,2);assert.match(h.messages[1].subject,/needs attention/);assert.match(h.messages[1].text,/Pending question assessments: 3/);
  await h.monitor.check();await h.wait();assert.equal(h.messages.length,2);
  const ready=h.put('writing',{ready:false});await h.monitor.observe('writing','student',ready);await h.wait();ready.ready=true;h.advance(TEN_MINUTES+1);await h.wait();
  assert.equal(h.messages.length,3,'The second mock receives only its submission notice.');
});
test('staff-review failures alert before ten minutes and resolved queued incidents are cancelled',async t=>{
  const h=await fixture(t),a=h.put('listening',{ready:false,held:true,pending:1});await h.monitor.observe('listening','student',a);await h.wait();
  assert.equal(h.messages.length,2);assert.match(h.messages[1].text,/ASSESSMENT_FAILED/);
  // Delay validation until a simulated recovery completes.
  const b=h.put('full',{ready:false,held:true});let reads=0;
  h.sources.full.get=async()=>{if(++reads>=2)b.ready=true;return b;};
  await h.monitor.observe('full','student',b);await h.wait();
  assert.equal(h.messages.filter(m=>m.text.includes(b.id)&&m.subject.includes('needs attention')).length,0);
});
test('errors have separate persistent deduplication, safe codes and no answers, transcripts or recordings',async t=>{
  const h=await fixture(t),a=h.put('writing');
  await h.monitor.observe('writing','student',{...a,answers:['PRIVATE_ANSWER'],transcript:'PRIVATE_TRANSCRIPT',recording:'PRIVATE_AUDIO'});
  await h.monitor.error('writing','student',a.id,'assessment','PRIVATE_SECRET_ERROR',a.title);await h.monitor.error('writing','student',a.id,'save','HTTP_503',a.title);await h.wait();
  assert.equal(h.messages.length,2);assert.match(h.messages[1].text,/SERVER_ERROR/);
  for(const privateText of ['PRIVATE_ANSWER','PRIVATE_TRANSCRIPT','PRIVATE_AUDIO','PRIVATE_SECRET_ERROR'])assert(!JSON.stringify(h.messages).includes(privateText));
  const diagnostic=await h.monitor.diagnostics('writing','student',a.id);assert.equal(diagnostic.notifications.length,2);assert(!JSON.stringify(diagnostic).includes('PRIVATE_'));
});
test('mail failures retry the frozen event and never block mock event registration',async t=>{
  let calls=0;const h=await fixture(t,{send:async message=>{if(++calls===1)throw Object.assign(Error('connection failed'),{code:'ECONNECTION',command:'CONN'});return{accepted:['owner@example.test'],messageId:message.messageId};}});
  const a=h.put('reading');await h.monitor.observe('reading','student',a);await h.wait();assert.equal(h.messages.length,1);
  a.title='changed title';h.advance(60001);await h.monitor.observe('reading','student',a);await h.wait();
  assert.equal(h.messages.length,2);assert.deepEqual(h.messages[0],h.messages[1]);
  const row=await h.delivery.eventJobs.get('student',eventKey({kind:'submitted',engine:'reading',username:'student',attemptId:a.id}));assert.equal(row.data.outcome,'sent');
});
test('disabled monitoring performs no reads, jobs or sends',async t=>{
  const h=await fixture(t,{enabled:false});h.sources.full.get=()=>{throw Error('must not read');};
  await h.monitor.observeId('full','student',randomUUID());await h.monitor.check();await h.wait();assert.equal(h.messages.length,0);
});
test('source adapters distinguish mocks, modes and full/sectional readiness without assessing anything',async()=>{
  const question={type:'swt'},a={id:randomUUID(),kind:'mock',module:'writing',status:'submitted',finishedAt:1,questions:[question],results:[{total:9,maximum:9}],answers:['PRIVATE_ANSWER'],overallFeedback:{status:'complete'}};
  assert.equal(snapshot('writing',a).ready,true);assert.equal(snapshot('listening',a),null);
  assert.equal(snapshot('writing',{...a,kind:'sst'}),null);assert.equal(snapshot('writing',{...a,overallFeedback:{status:'unavailable'}}).held,true);
  assert.equal(snapshot('writing',{...a,overallFeedback:undefined}).ready,false,'A writing overview that has not started cannot be reported ready.');
  const reading={id:'reading-id',done:true,finishedAt:1,questions:[{type:'mcsa'}],answers:{private:'PRIVATE_ANSWER'}};
  assert.equal(snapshot('reading',reading).ready,true);assert.equal(snapshot('reading',{...reading,practiceUid:'single-question'}),null);
  const sources=createSources({loadReading:async()=>({session:{...reading,pending:undefined},history:[{...reading,pending:true}]})});
  assert.equal((await sources.reading.get('student',reading.id)).pending,1,'Use the saved history pending status rather than the unannotated session.');
  assert(!JSON.stringify(await sources.reading.get('student',reading.id)).includes('PRIVATE_ANSWER'));
});
test('HTTP capture observes only authenticated owning mocks, excludes validation errors and practice, and records server errors',async t=>{
  const h=await fixture(t),reading=h.put('reading',{id:'reading-test',questions:[{type:'mcsa'}],done:true}),full=h.put('full');
  const app=express();app.use(express.json());app.use(capture({monitor:()=>h.monitor,verifyToken:token=>token==='valid'?'student':null,logger:{warn(){}}}));
  app.post('/api/sync/:userId',(req,res)=>res.sendStatus(req.query.fail?500:200));
  app.post('/api/full-mocks/attempts/:id/end',(req,res)=>res.sendStatus(req.query.bad?400:req.query.fail?503:200));
  const server=app.listen(0,'127.0.0.1');t.after(()=>new Promise(resolve=>server.close(resolve)));await new Promise(resolve=>server.on('listening',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const post=(route,body={},token='valid')=>fetch(origin+route,{method:'POST',headers:{'Content-Type':'application/json','x-session-token':token},body:JSON.stringify(body)});
  await post('/api/sync/other',{readingProgress:{history:[reading]}});await post('/api/full-mocks/attempts/'+full.id+'/end',{},'invalid');
  await post('/api/full-mocks/attempts/'+full.id+'/end?bad=1');
  await new Promise(resolve=>setImmediate(resolve));await h.wait();assert.equal(h.messages.length,0);
  await post('/api/sync/student',{readingProgress:{history:[reading]}});
  await post('/api/full-mocks/attempts/'+full.id+'/end?fail=1');
  // The finish listener queues independent durable work after the response.
  for(let n=0;n<20&&h.messages.length<3;n++){await new Promise(resolve=>setTimeout(resolve,5));await h.wait();}
  assert.equal(h.messages.length,3);assert(h.messages.some(m=>m.subject.includes('Reading mock submitted')));assert(h.messages.some(m=>m.text.includes('HTTP_503')));
});
