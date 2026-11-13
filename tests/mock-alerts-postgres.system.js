'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {database}=require('./helpers/full-mock-systems');
const {createStore}=require('../writing-lab-store');
const {createStore:createFullStore}=require('../full-mock/store');
const {createJobs}=require('../scoring-jobs');
const {createSpeakingMockAlerts}=require('../speaking-mock-alerts');
const {createMockTestAlerts}=require('../mock-test-alerts');
const {createSources}=require('../mock-test-alert-sources');
test('PostgreSQL recovery discovers legacy and integrated Listening plus every mock type, and concurrent alert workers send once per event',async t=>{
  const db=await database(t),pool=db.first,messages=[];let time=1800000000000;
  const speaking=createStore(pool,'/unused',{table:'speaking_mock_attempts'}),writing=createStore(pool,'/unused'),full=createFullStore({pool,directory:'/unused'}),listening=createFullStore({pool,directory:'/unused',namespace:'listening_mock'});
  await Promise.all([speaking.initialise(),writing.initialise(),full.initialise(),listening.initialise()]);
  await createJobs({pool,directory:'/unused',table:'speaking_answer_jobs'}).initialise();
  await pool.query('CREATE TABLE user_data(username TEXT PRIMARY KEY REFERENCES accounts(username),data JSONB NOT NULL)');
  const sources=createSources({pool,speakingStore:speaking,writingStore:writing,fullStore:full,listeningStore:listening,loadReading:async uid=>(await pool.query("SELECT data->'readingProgress' AS value FROM user_data WHERE username=$1",[uid])).rows[0]?.value});
  const mailer={verify:async()=>true,sendMail:async message=>{messages.push(message);return{accepted:['admin@example.test'],messageId:message.messageId};}};
  const services=[];
  async function service(){
    const delivery=createSpeakingMockAlerts({pool,directory:'/unused',mockStore:speaking,progressive:{},mailer,from:'alerts@example.test',recipient:'admin@example.test',enabled:true,now:()=>time,logger:{info(){},warn(){}}});
    const monitor=createMockTestAlerts({pool,directory:'/unused',delivery,sources,enabled:true,now:()=>time,logger:{warn(){}}});
    await delivery.start();await monitor.start();
    const value={delivery,monitor,async stop(){await monitor.stop();await delivery.stop();},async wait(){await monitor.wait();await delivery.wait();}};services.push(value);db.onClose(value.stop);return value;
  }
  const first=await service(); // Persist rollout time before storing new submissions.
  const speakingId=randomUUID(),writingId=randomUUID(),listeningId=randomUUID(),fullId=randomUUID();
  await speaking.update('student',speakingId,()=>({id:speakingId,status:'submitted',finishedAt:time,assessment:{status:'ready'}}));
  await writing.update('student',writingId,()=>({id:writingId,kind:'mock',module:'writing',status:'submitted',finishedAt:time,questions:[{type:'swt'}],answers:['PRIVATE'],results:[{total:9,maximum:9}],overallFeedback:{status:'complete'}}));
  await writing.update('student',listeningId,()=>({id:listeningId,kind:'mock',module:'listening',status:'submitted',finishedAt:time,questions:[{type:'hcs'}],answers:['PRIVATE'],results:[{total:1,maximum:1}]}));
  const paper=require('../full-mock/paper').loadPaper(),session=require('../full-mock/session');
  await full.create('student',fullId,paper,(id,at)=>{const state=session.create(id,paper,at,{preview:true});session.end(state,paper,at);
    state.assessment={status:'complete',items:Object.fromEntries(paper.questions.map(q=>[q.id,{status:'assessed'}]))};return state;},time);
  assert.equal((await sources.full.get('student',fullId)).finishedAt,time);
  const integratedId=randomUUID(),listeningPaper=require('../listening-mock/papers').registeredPapers()[0];
  await listening.create('student',integratedId,listeningPaper,(id,at)=>{const state=session.create(id,listeningPaper,at);session.end(state,listeningPaper,at);state.assessment={status:'complete',items:Object.fromEntries(listeningPaper.questions.map(q=>[q.id,{status:'assessed'}]))};return state;},time);
  const scanned=[];let cursor='';do{const batch=await sources.listening.scan({since:time,cursor,limit:1});scanned.push(...batch.rows);cursor=batch.nextCursor;}while(cursor);
  assert.deepEqual(scanned.map(r=>r.snapshot.id).sort(),[listeningId,integratedId].sort());assert(scanned.every(r=>r.snapshot.ready));
  await pool.query('INSERT INTO user_data(username,data) VALUES($1,$2)',['student',JSON.stringify({readingProgress:{history:[{id:'reading-synthetic',done:true,finishedAt:time,questions:[{type:'mcsa'}],answers:{secret:'PRIVATE'}}]}})]);
  const second=await service();await Promise.all([first.monitor.check(),second.monitor.check()]);await Promise.all(services.map(s=>s.wait()));
  assert.equal(messages.length,6);assert.equal(new Set(messages.map(m=>m.messageId)).size,6);assert(messages.every(m=>m.to==='admin@example.test'&&!m.text.includes('PRIVATE')));
  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM mock_admin_event_jobs WHERE data->>'outcome'='sent'")).rows[0].count,6);
  await first.stop();await second.stop();time+=60001;
  const resumed=await service();await resumed.monitor.check();await resumed.wait();assert.equal(messages.length,6);
  assert.equal(resumed.monitor.health().activeSince,time-60001);
});

test('PostgreSQL unattended Writing claims are exclusive across pools and retain the real owner during scanning',async t=>{
 const db=await database(t),first=createStore(db.first,'/unused'),second=createStore(db.pool(),'/unused');await first.initialise();
 const a={id:randomUUID(),kind:'mock',module:'writing',status:'submitted',startedAt:1000,questions:[{type:'essay',text:'Saved prompt'}],answers:['Saved original response'],completed:[{at:1000}],results:[null]};
 await first.update('alice',a.id,()=>a);let at=1000;
 const make=store=>require('../writing-lab-recovery').createRecovery({store,now:()=>at,isConfirmed:(a,i)=>!!a.results[i]});
 const outcomes=await Promise.all([make(first).claim('alice',a.id,0),make(second).claim('alice',a.id,0)]);assert.equal(outcomes.filter(Boolean).length,1);
 const rows=await second.scanForScoring('',20,{since:500});assert(rows.some(row=>row.username==='alice'&&row.data.id===a.id));
 at+=300001;assert.equal(await make(second).claim('alice',a.id,0),undefined);
 const held=await second.get('alice',a.id);assert.equal(held.assessmentRecovery[0].status,'held');assert.deepEqual(held.answers,a.answers);assert.equal(await second.get('bob',a.id),null);
});

test('Speaking deadline scan and upload across PostgreSQL pools retain the reserved recording once',{timeout:20000},async t=>{
 const express=require('express'),{installSpeakingMock,timing}=require('../speaking-mock');const db=await database(t);let at=9000,calls=0;const servers=[],services=[];
 const make=async pool=>{const app=express();app.use(express.json());const lab=installSpeakingMock(app,{pool,directory:'/unused',verifyToken:s=>s==='alice'?'alice':null,getAccount:async()=>({}),now:()=>at,backgroundEnabled:true,azureAvailable:false,gradeResponse:async q=>{calls++;return{transcript:'Synthetic response.',content:{scoringMode:'ai',total:0,maximum:require('../speaking-mock-report').contentMaximum(q)}};}});await lab.store.initialise();await lab.progressive.jobs.initialise();const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));servers.push(server);services.push(lab);return{lab,base:'http://127.0.0.1:'+server.address().port+'/api/speaking-mocks/attempts/'};};
 db.onClose(async()=>{for(const lab of services){await lab.waitForJobs();await lab.stop();}for(const server of servers){server.closeAllConnections();await new Promise(r=>server.close(r));}});
 const first=await make(db.first),second=await make(db.pool()),id=randomUUID();const q={id:'synthetic-ra',type:'ra',name:'Read Aloud',text:'A synthetic response.',preparation:0,seconds:40};
 await first.lab.store.update('alice',id,()=>({id,questions:[q],responses:[],questionCount:1,index:0,status:'active',startedAt:1000,questionStartedAt:1000,deadline:10000,assessmentProfile:{mode:'progressive-v1',owner:'alice',diBackend:'portal-gpt'}}));at=10000;
 await Promise.all([first.lab.progressive.recover(),second.lab.progressive.recover()]);const waiting=await first.lab.store.get('alice',id);assert.equal(waiting.submission.state,'finalizing');assert.deepEqual(waiting.submission.pending,[0]);
 const body=Buffer.alloc(300,7),post=base=>fetch(base+id+'/recordings/0',{method:'POST',headers:{'x-session-token':'alice','Content-Type':'audio/webm'},body});at=21000;
 const replies=await Promise.all([post(first.base),post(second.base),first.lab.progressive.recover()]);assert.equal(replies[0].status,200);assert.equal(replies[1].status,200);await Promise.all(services.map(s=>s.waitForJobs()));const saved=await second.lab.store.get('alice',id);assert.equal(saved.submission.state,'complete');assert.equal(saved.responses[0].recording.data,body.toString('base64'));assert.equal(calls,1);
});
