'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {database}=require('./helpers/full-mock-systems');
const {createStore}=require('../writing-lab-store');
const {createStore:createFullStore}=require('../full-mock/store');
const {createJobs}=require('../scoring-jobs');
const {createSpeakingMockAlerts}=require('../speaking-mock-alerts');
const {createMockTestAlerts}=require('../mock-test-alerts');
const {createSources}=require('../mock-test-alert-sources');
test('PostgreSQL recovery discovers all five mock types and concurrent alert workers send once per event',async t=>{
  const db=await database(t),pool=db.first,messages=[];let time=1800000000000;
  const speaking=createStore(pool,'/unused',{table:'speaking_mock_attempts'}),writing=createStore(pool,'/unused'),full=createFullStore({pool,directory:'/unused'});
  await Promise.all([speaking.initialise(),writing.initialise(),full.initialise()]);
  await createJobs({pool,directory:'/unused',table:'speaking_answer_jobs'}).initialise();
  await pool.query('CREATE TABLE user_data(username TEXT PRIMARY KEY REFERENCES accounts(username),data JSONB NOT NULL)');
  const sources=createSources({pool,speakingStore:speaking,writingStore:writing,fullStore:full,loadReading:async uid=>(await pool.query("SELECT data->'readingProgress' AS value FROM user_data WHERE username=$1",[uid])).rows[0]?.value});
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
  await pool.query('INSERT INTO user_data(username,data) VALUES($1,$2)',['student',JSON.stringify({readingProgress:{history:[{id:'reading-synthetic',done:true,finishedAt:time,questions:[{type:'mcsa'}],answers:{secret:'PRIVATE'}}]}})]);
  const second=await service();await Promise.all([first.monitor.check(),second.monitor.check()]);await Promise.all(services.map(s=>s.wait()));
  assert.equal(messages.length,5);assert.equal(new Set(messages.map(m=>m.messageId)).size,5);assert(messages.every(m=>m.to==='admin@example.test'&&!m.text.includes('PRIVATE')));
  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM mock_admin_event_jobs WHERE data->>'outcome'='sent'")).rows[0].count,5);
  await first.stop();await second.stop();time+=60001;
  const resumed=await service();await resumed.monitor.check();await resumed.wait();assert.equal(messages.length,5);
  assert.equal(resumed.monitor.health().activeSince,time-60001);
});
