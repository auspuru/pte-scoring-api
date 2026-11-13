'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { database } = require('./helpers/full-mock-systems');
const { loadPaper, digest } = require('../full-mock/paper');
const { createStore } = require('../full-mock/store');
const session = require('../full-mock/session');
const { createEngine } = require('../full-mock/assessment');
const adapters = require('../full-mock/adapters');
const paper = loadPaper(), native = q => adapters.result(q, adapters.maxima(q));
const make = (id, at) => session.create(id, paper, at, { preview:true });

test('PostgreSQL: competing instructor reviews retain a two-retry cap across pools and wait for manual publication',async t=>{
 const db=await database(t),stores=[createStore({pool:db.first}),createStore({pool:db.pool()})];await Promise.all(stores.map(s=>s.initialise()));
 let calls=0;const options={paper,now:()=>3000,assemble:async()=>({status:'ready',recording:{}}),adapters:{assess:async()=>{calls++;await new Promise(r=>setImmediate(r));return{status:'failed',reason:'delivery-unavailable'};}}};
 const engines=stores.map(store=>createEngine({...options,store}));t.after(()=>Promise.all(engines.map(e=>e.stop())));
 const id=randomUUID(),selected=paper.questions.findIndex(q=>q.question.type==='rs');await stores[0].create('alice',id,paper,make,1000);
 await stores[0].update('alice',id,state=>{session.end(state,paper,2000);state.assessment=require('../full-mock/assessment').stateFor(engines[0].snapshot);state.assessment.status='needs-attention';
  paper.questions.forEach((q,i)=>{const response=state.responses[i+1];if(i===selected)response.segments=[{id:randomUUID(),mime:'audio/webm',finished:true,chunkCount:1,chunks:{0:{stored:true,sha256:'a'.repeat(64),bytes:100}}}];state.assessment.items[q.id]={inputHash:require('../full-mock/aggregation').inputHash(response),snapshotHash:state.assessment.snapshotHash,status:i===selected?'failed':'assessed',...(i===selected?{result:{status:'failed',reason:'delivery-unavailable'},stages:{delivery:{status:'partial',uncertain:false}}}:{result:native(q.question),stages:{}})};});return state;
 });
 const plan=async()=>{const r=await stores[0].get('alice',id);return require('../mock-result-review').fullPlan(r.state,r.paper,3000);};
 for(let n=1;n<=2;n++){const p=await plan(),body={action:'analyse',operation:'review:competing-round-'+n,evidenceHash:p.evidenceHash};await Promise.all(engines.map(e=>e.review('alice',id,body)));await Promise.all(engines.map(e=>e.drain()));assert.equal(calls,n);assert.equal((await engines[0].results('alice',id)).ready,false);if(n===1){await engines[1].stop();engines[1]=createEngine({...options,store:stores[1]});}}
 const p=await plan();assert.equal(p.retries,2);assert(p.canPublish);const body={action:'publish',operation:'review:competing-publish',evidenceHash:p.evidenceHash,note:'Instructor confirmed publication after two unavailable assessment retries.',confirmPublish:true};
 await Promise.all(engines.map(e=>e.review('alice',id,body)));assert.equal(calls,2);const result=await engines[0].results('alice',id);assert(result.ready);assert.equal(result.assessedCount,64);assert.equal(result.excludedCount,1);
});

test('PostgreSQL: concurrent startup and attempt creation preserve one active owned attempt per paper', async t => {
  const db = await database(t), stores = [createStore({ pool:db.first }), createStore({ pool:db.pool() })];
  await Promise.all(stores.map(store => store.initialise()));
  const records = await Promise.all(stores.map(store => store.create('alice', randomUUID(), paper, make, 1000)));
  assert.equal(records[0].state.id, records[1].state.id);
  assert.equal((await stores[0].list('alice')).length, 1); assert.equal(await stores[0].get('bob', records[0].state.id), null);
  assert.equal(digest(records[0].paper), digest(paper));
  await assert.rejects(stores[1].create('bob', records[0].state.id, paper, make, 1000), { status:404 });
});
test('PostgreSQL: the old account-wide index upgrades without changing saved attempts', async t => {
  const db=await database(t),old=createStore({pool:db.first});await old.initialise();
  const second=loadPaper('full-mock-2'),third=loadPaper('full-mock-3');
  const saved=await old.create('alice',randomUUID(),second,(id,at)=>session.create(id,second,at,{preview:true}),1000);
  await db.first.query("DROP INDEX full_mock_one_active_user_paper; CREATE UNIQUE INDEX full_mock_one_active_user ON full_mock_attempts(username) WHERE state->>'status'='active'");
  const stores=[createStore({pool:db.first}),createStore({pool:db.pool()})];await Promise.all(stores.map(s=>s.initialise()));
  const starts=await Promise.all(stores.map(s=>s.create('alice',randomUUID(),third,(id,at)=>session.create(id,third,at,{preview:true}),1000)));
  assert.equal(starts[0].state.id,starts[1].state.id);assert.equal(starts[0].paper.id,'full-mock-3');
  assert.deepEqual(await stores[0].get('alice',saved.state.id),saved);
  assert.equal((await stores[1].create('alice',randomUUID(),second,(id,at)=>session.create(id,second,at,{preview:true}),1000)).state.id,saved.state.id);
  assert.equal((await stores[0].list('alice')).length,2);
  await assert.rejects(stores[0].create('alice',saved.state.id,third,()=>{},1000),{status:409});
});
test('PostgreSQL: racing revisions, sealed answers, shared deadlines and reconnects survive new pools', async t => {
  const db = await database(t), a = createStore({ pool:db.first }); await a.initialise();
  const b = createStore({ pool:db.pool() }); await b.initialise(); const id = randomUUID();
  await a.create('alice', id, paper, make, 1000);
  await a.update('alice', id, state => { state.counter = 0; return state; });
  for (let n = 0; n < 4; n++) await Promise.all([a,b,a,b].map(store => store.update('alice', id, state => { state.counter++; return state; })));
  assert.equal((await b.get('alice', id)).state.counter, 16);
  await a.update('alice', id, state => { while (session.item(paper, state.index).question.type !== 'swt') session.next(state, paper, { itemToken:state.current.token, skip:true }, 1000); return state; });
  const before = (await b.get('alice', id)).state, token = before.current.token;
  await Promise.all([a,b].map((store, index) => store.update('alice', id, state => { session.saveDraft(state, paper, { itemToken:token, sequence:index + 1, answer:[index ? 'Newest saved draft' : 'Older draft'] }); return state; })));
  assert.deepEqual((await a.get('alice', id)).state.responses[before.index].draft, ['Newest saved draft']);
  await a.update('alice', id, state => { session.reconcile(state, paper, before.current.endsAt); return state; });
  const restart = createStore({ pool:db.pool() }), saved = (await restart.get('alice', id)).state;
  assert.deepEqual(saved.responses[before.index].answer, ['Newest saved draft']); assert.equal(saved.current.enteredAt, before.current.endsAt);
  const originalAnswer = structuredClone(saved.responses[before.index].answer);
  await restart.update('alice', id, state => { session.recover(state, paper, { itemToken:token, sequence:3, answer:['Late separate evidence'] }, before.current.endsAt + 1); return state; });
  assert.deepEqual((await a.get('alice', id)).state.responses[before.index].answer, originalAnswer);
  await a.update('alice', id, state => { while (session.item(paper, state.index).question.type !== 'dropdown') session.next(state, paper, { itemToken:state.current.token, skip:true }, state.current.enteredAt); return state; });
  const reading = (await b.get('alice', id)).state;
  await b.update('alice', id, state => { session.next(state, paper, { itemToken:state.current.token }, state.current.enteredAt + 1000); return state; });
  assert.equal((await restart.get('alice', id)).state.current.endsAt, reading.current.endsAt);
});
test('PostgreSQL: immutable BYTEA recordings retain bytes, ownership and manifests after reconnect', async t => {
  const db = await database(t), a = createStore({ pool:db.first }); await a.initialise(); const id = randomUUID(), segment = randomUUID(), bytes = Buffer.from([0,1,255,0,200,33]);
  await a.create('alice', id, paper, make, 1000);
  const chunk = await a.putChunk('alice', id, segment, 0, 'audio/webm', bytes);
  const b = createStore({ pool:db.pool() }), restored = await b.getChunk('alice', id, segment, 0);
  assert.deepEqual(restored.bytes, bytes); assert.equal(restored.sha256, chunk.sha256); assert.equal(await b.getChunk('bob', id, segment, 0), null);
  await b.putChunk('alice', id, segment, 0, 'audio/webm', bytes);
  await assert.rejects(a.putChunk('alice', id, segment, 0, 'audio/webm', Buffer.from('replacement')), /cannot be replaced/);
  assert.deepEqual((await b.getChunk('alice', id, segment, 0)).bytes, bytes);
});
test('PostgreSQL: two leased workers, failed-provider retries and process recovery never double-grade saved work', async t => {
  const db = await database(t), a = createStore({ pool:db.first }); await a.initialise(); const b = createStore({ pool:db.pool() }); await b.initialise();
  const id = randomUUID(); await a.create('alice', id, paper, make, 1000); await a.update('alice', id, state => { session.end(state, paper, 1000); return state; });
  const calls = new Map(); let failure = true;
  const implementation = { assess:async q => { calls.set(q.id, (calls.get(q.id) || 0) + 1); await new Promise(resolve => setImmediate(resolve)); return q.type === 'essay' && failure ? { status:'failed', reason:'writing-unavailable' } : native(q); } };
  const engines = [createEngine({ store:a, adapters:implementation }), createEngine({ store:b, adapters:implementation })]; t.after(() => Promise.all(engines.map(engine => engine.stop())));
  await Promise.all(engines.map(engine => engine.request('alice', id))); await Promise.all(engines.map(engine => engine.drain()));
  const result = await engines[0].results('alice', id); assert.equal(result.assessedCount, 64); assert.equal(result.profiles.writing.practiceIndex, null); assert([...calls.values()].every(count => count === 1));
  await engines[1].request('alice', id); await engines[1].drain(); assert([...calls.values()].every(count => count === 1));
  failure = false; await engines[1].request('alice', id, { retry:true }); await engines[1].drain(); assert.equal((await engines[0].results('alice', id)).ready, true);
  for (const candidate of paper.questions) assert.equal(calls.get(candidate.question.id), candidate.question.type === 'essay' ? 2 : 1);
  await a.update('alice', id, state => { state.assessment.status = 'processing'; state.assessment.lease = { id:randomUUID(), expiresAt:0 }; delete state.assessment.items[paper.questions[0].id]; return state; });
  await engines[1].recover(); await engines[1].drain(); assert.equal((await engines[0].results('alice', id)).ready, true); assert.equal(calls.get(paper.questions[0].question.id), 2);
  const bytes = require('../full-mock/recording').wav(Buffer.alloc(32000, 1)), segment = randomUUID();
  const chunk = await a.putChunk('alice', id, segment, 0, 'audio/wav', bytes);
  await a.update('alice', id, state => {
    state.responses[1].segments = [{ id:segment, mime:'audio/wav', finished:true, chunkCount:1, chunks:{ 0:{ sha256:chunk.sha256, bytes:bytes.length, stored:true, late:true } } }];
    const job = state.assessment.items[paper.questions[0].id];
    job.inputHash = require('../full-mock/aggregation').inputHash(state.responses[1]); job.status = 'pending'; job.reason = 'late-recording'; delete job.result;
    state.assessment.status = 'needs-attention'; return state;
  });
  assert((await b.assessmentQueue()).some(row => row.id === id && row.status === 'needs-attention'));
  await engines[1].recover(); await engines[1].drain();
  assert.equal((await engines[0].results('alice', id)).ready, true);
  assert.equal(calls.get(paper.questions[0].question.id), 3);
  await engines[1].recover(); await engines[1].drain();
  assert.equal(calls.get(paper.questions[0].question.id), 3);
});

test('PostgreSQL: scheduled recovery is durable, waits for its deadline and has one worker after restart',async t=>{
 const db=await database(t),store=createStore({pool:db.first});await store.initialise();const id=randomUUID();let at=1000,available=false,calls=new Map();
 await store.create('alice',id,paper,make,at);await store.update('alice',id,state=>{session.end(state,paper,at);return state;});
 const target=paper.questions.find(c=>c.question.type==='essay').question.id;
 const implementation={assess:async q=>{calls.set(q.id,(calls.get(q.id)||0)+1);return q.id===target&&!available?{status:'failed',reason:'writing-unavailable'}:native(q);}};
 const first=createEngine({store,now:()=>at,adapters:implementation});await first.request('alice',id);await first.drain();await first.stop();
 assert(!(await store.assessmentQueue(at)).some(row=>row.id===id));
 const engines=[1,2].map(()=>createEngine({store:createStore({pool:db.pool()}),now:()=>at,adapters:implementation}));t.after(()=>Promise.all(engines.map(e=>e.stop())));
 at=31000;available=true;assert((await store.assessmentQueue(at)).some(row=>row.id===id));
 await Promise.all(engines.map(e=>e.recover()));await Promise.all(engines.map(e=>e.drain()));
 assert.equal((await engines[0].results('alice',id)).ready,true);for(const [key,count]of calls)assert.equal(count,key===target?2:1);
});

test('PostgreSQL: competing restart workers publish the final exhausted question once without providers or changed evidence',async t=>{
 const db=await database(t),stores=[createStore({pool:db.first}),createStore({pool:db.pool()})];await Promise.all(stores.map(s=>s.initialise()));
 const {state,selected}=require('./helpers/full-mock-final-question').make(paper,{historical:true}),owner='alice';
 await stores[0].create(owner,state.id,paper,()=>state,1000);let calls=0;
 const engines=stores.map(store=>createEngine({store,paper,now:()=>3000,adapters:{assess:async()=>{calls++;throw Error('No provider call');}}}));t.after(()=>Promise.all(engines.map(e=>e.stop())));
 await Promise.all(engines.map(e=>e.recover()));await Promise.all(engines.map(e=>e.drain()));
 const saved=(await stores[1].get(owner,state.id)).state,result=require('../full-mock/aggregation').aggregate(paper,saved);
 assert.equal(result.ready,true);assert.equal(result.excludedCount,1);assert.equal(result.assessedCount,64);assert.equal(calls,0);
 assert.deepEqual(saved.responses,state.responses);assert.deepEqual(saved.assessment.items,state.assessment.items);assert.deepEqual(saved.assessment.snapshot,state.assessment.snapshot);
 assert.equal(Object.keys(saved.assessment.exclusionOperations).length,1);assert.equal(saved.assessment.recovery.finalQuestionReview.questionId,selected.id);
 assert.equal((await stores[0].assessmentQueue(3000)).length,0);assert.equal(await stores[1].get('wrong-owner',state.id),null);
 // Ineligible exhausted rows are reviewed and removed from this policy's queue.
 const held=require('./helpers/full-mock-final-question').make(paper);held.state.assessment.items[held.selected.id].stages.delivery.uncertain=true;
 await stores[0].create('bob',held.state.id,paper,()=>held.state,1000);await engines[0].recover();
 assert.equal((await stores[1].get('bob',held.state.id)).state.assessment.recovery.finalQuestionReview.status,'held');assert.equal((await stores[1].assessmentQueue(3000)).length,0);
});

test('PostgreSQL: competing Speaking timeout publications preserve 17 marks and ten zeroes across pools and restart',async t=>{
 const db=await database(t),{attempt,command}=require('./helpers/speaking-deadline-zero-fixture'),a=attempt();
 const create=pool=>require('../writing-lab-store').createStore(pool,'unused',{table:'speaking_mock_attempts'});
 const stores=[create(db.first),create(db.pool())];for(const store of stores)await store.initialise();await stores[0].update('alice',a.id,()=>a);
 const services=stores.map(store=>require('../speaking-mock-jobs').createMockJobs({pool:store===stores[0]?db.first:db.pool(),directory:'unused',store,now:()=>3000}));db.onClose(()=>Promise.all(services.map(s=>s.stop())));
 const body=command((await services[0].diagnostics('alice',a.id)).deadlineScore);
 await assert.rejects(services[1].repair('bob',a.id,body),{status:404});await Promise.all(services.map(s=>s.repair('alice',a.id,body)));
 const restarted=create(db.pool()),saved=await restarted.get('alice',a.id);assert.deepEqual(saved.responses,a.responses);assert.equal(saved.deadlineZeroPublication.indices.length,10);
 const result=require('../speaking-mock-report').summarize(saved).azure;assert.equal(result.assessedCount,27);assert.equal(result.excludedCount,0);assert.equal(result.deadlineUnattemptedCount,10);
 const again=await services[1].repair('alice',a.id,body);assert(again.ready);assert.equal((await restarted.get('alice',a.id)).deadlineZeroPublication.at,3000);
});

test('PostgreSQL: integrated Listening attempts and recording bytes remain isolated from Full Mocks across pools',async t=>{
 const db=await database(t),lp=require('../listening-mock/papers').registeredPapers()[0],full=createStore({pool:db.first}),listening=createStore({pool:db.pool(),namespace:'listening_mock'});
 await Promise.all([full.initialise(),listening.initialise()]);const id=randomUUID(),segment=randomUUID();
 await full.create('alice',id,paper,make,1000);await listening.create('alice',id,lp,(id,at)=>session.create(id,lp,at),1000);
 await full.putChunk('alice',id,segment,0,'audio/webm',Buffer.from('full-recording'));
 await listening.putChunk('alice',id,segment,0,'audio/webm',Buffer.from('listening-recording'));
 const restarted=createStore({pool:db.pool(),namespace:'listening_mock'});await restarted.initialise();
 assert.equal((await restarted.get('alice',id)).paper.id,lp.id);assert.equal((await full.get('alice',id)).paper.id,paper.id);
 assert.equal((await restarted.getChunk('alice',id,segment,0)).bytes.toString(),'listening-recording');assert.equal((await full.getChunk('alice',id,segment,0)).bytes.toString(),'full-recording');
 assert.equal(await restarted.get('bob',id),null);assert.equal(await restarted.getChunk('bob',id,segment,0),null);
 const starts=await Promise.all([listening,restarted].map(store=>store.create('alice',randomUUID(),lp,(id,at)=>session.create(id,lp,at),2000)));assert(starts.every(row=>row.state.id===id));
 const other=require('../listening-mock/papers').registeredPapers()[1];await restarted.create('alice',randomUUID(),other,(id,at)=>session.create(id,other,at),2000);
 assert.equal((await full.list('alice')).length,1);assert.equal((await listening.list('alice')).length,2);
});
