'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const express=require('express');
const policy=require('../writing-lab-scoring');
const {installWritingLab,reconcile,present,advance,predictionMocks,individualQuestions}=require('../writing-lab');
const report=require('../public/writing-lab-report');
const {createStore}=require('../writing-lab-store');
const {createNarration}=require('../writing-lab-audio');
const bank=require('../content/writing-lab.json');
const predictions=require('../content/writing-predictions-sep-2026');
const sentence=n=>Array(n).fill('word').join(' ')+'.';
test('Published form boundaries and SWT sentence structure',()=>{
  for(const [type,bounds] of Object.entries({sst:[[39,0],[40,1],[49,1],[50,2],[70,2],[71,1],[100,1],[101,0]],essay:[[119,0],[120,1],[199,1],[200,2],[300,2],[301,1],[380,1],[381,0]],swt:[[4,0],[5,1],[75,1],[76,0]]})) {
    for(const [n,score] of bounds) assert.equal(policy.formFor(type,sentence(n)).score,score,type+' '+n);
  }
  assert.equal(policy.formFor('swt','Cities need trees because they provide shade; planners must maintain them carefully.').score,1);
  assert.equal(policy.formFor('swt','Cities need trees. Planners should care for them.').score,0);
  assert.equal(policy.sentenceCount('Dr. Lee suggests that U.S. cities need 2.5 times more trees; suitable care is essential.'),1);
  assert.equal(policy.formFor('sst',sentence(60).toUpperCase()).score,0);
  assert.equal(policy.formFor('essay',sentence(220).replace('.','')).score,0);
});
test('Zero-form answers never call the model or receive invented marks',async()=>{
  const r=await policy.grade(bank.mocks[0].questions[0],'',()=>{throw Error('Must not call model');});
  assert.equal(r.total,0);assert.equal(r.maximum,9);assert.equal(r.gated,true);
});
test('Scoring rejects malformed traits and fabricated error evidence, gates off-topic answers',()=>{
  const q=bank.spoken[0],text=q.sample;
  const raw={scores:{content:4,form:2,grammar:2,vocabulary:2,spelling:2},formInvalid:false,formReason:'',
    feedback:Object.fromEntries(Object.keys(policy.MAXIMA.sst).map(k=>[k,'Clear and appropriate.'])),strengths:['Relevant summary'],improvements:[],errors:[]};
  assert.equal(policy.normalize(q,text,raw).total,12);
  assert.throws(()=>policy.normalize(q,text,{...raw,scores:{...raw.scores,content:5}}));
  assert.throws(()=>policy.normalize(q,text,{...raw,errors:[{phrase:'invented quotation',correction:'...',explanation:'...'}]}));
  assert.equal(policy.normalize(q,text,{...raw,scores:{...raw.scores,content:0},improvements:['Answer the lecture topic.']}).total,0);
});
test('SST practice keeps a saved fallback pending and recovers automatically from the saved response', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sst-practice-retry-'));
  const app = express();
  app.use(express.json());
  let now = Date.now();
  let available = false;
  let outcomeUncertain = false;
  let calls = 0;
  const feedback = Object.fromEntries(Object.keys(policy.MAXIMA.sst).map(key => [key, 'Reviewed feedback.']));
  const service = installWritingLab(app, { directory, verifyToken: token => token === 'tester' ? token : null,
    now: () => now, getAccount: async () => ({}), callModel: async (_, context) => {
      assert.equal(context.sstPractice, true);
      calls++;
      if (outcomeUncertain) throw Object.assign(new Error('Provider timed out'), { name: 'APIConnectionTimeoutError' });
      if (!available) return null;
      return { scores: { content: 2, form: 2, grammar: 1, vocabulary: 1, spelling: 2 },
        formInvalid: false, formReason: '', feedback, strengths: [], improvements: ['Link the main ideas.'], errors: [] };
    } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await service.waitForJobs();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + server.address().port + '/api/writing-lab/attempts';
  const headers = { 'Content-Type': 'application/json', 'x-session-token': 'tester' };
  const id = randomUUID();
  const question = individualQuestions.find(q => q.id === 'sst-user-20261124-01');
  const answer = question.sample;
  const get = async suffix => (await fetch(base + suffix, { headers })).json();
  const post = (suffix, body = {}) => fetch(base + suffix, { method: 'POST', headers, body: JSON.stringify(body) });
  const suffix = '/' + id;
  assert.equal((await post('', { id, testId: question.id, mode: 'practice', timedPractice: true })).status, 200);
  assert.equal((await post(suffix + '/begin')).status, 200);
  const response = await post(suffix + '/answer', { index: 0, revision: 1, text: answer, next: true });
  assert.equal(response.status, 200);
  const submitted = await response.json();
  assert.deepEqual(submitted.practiceFeedback.form, { score:2, maximum:2, reasons:[] });
  assert.deepEqual(submitted.practiceFeedback.transcriptIdeas, question.keyPoints);
  assert.equal(submitted.report.score90, null);
  assert.deepEqual((await service.store.get('tester', id)).practiceFeedback, submitted.practiceFeedback);
  await service.waitForJobs();
  assert.equal((await service.store.get('tester', id)).results[0].score_provisional, true);

  const pending = await get(suffix);
  assert.equal(pending.answers[0], answer);
  assert.deepEqual(pending.results, [null]);
  assert.equal(pending.report.score90, null);
  assert.equal((await get('')).find(a => a.id === id).score90, null);
  assert.equal(pending.assessmentStatus, 'pending');
  assert.equal(calls, 2);
  const legacyResponse = await post(suffix + '/score/0');
  assert.equal(legacyResponse.status, 200);
  const legacy = await legacyResponse.json();
  assert.equal(legacy.total, null);
  assert.deepEqual(legacy.maxima, { form:2 });
  assert.match(legacy.feedback.form, /prepared automatically/);
  assert.deepEqual(legacy.practiceFeedback, submitted.practiceFeedback);
  assert.deepEqual((await get(suffix + '?assessment=1')).practiceFeedback, submitted.practiceFeedback);
  assert.equal(calls, 2);

  available = true;
  now += 30001;
  await service.recover();
  await service.waitForJobs();
  const result = (await get(suffix)).results[0];
  assert.equal(result.total, 8);
  assert.equal(result.feedback.grammar, feedback.grammar);
  const reopened = await get(suffix);
  assert.equal(reopened.answers[0], answer);
  assert.deepEqual(reopened.results[0], result);
  assert.equal((await get('')).find(a => a.id === id).score90, 63);
  assert.equal((await post(suffix + '/score/0')).status, 200);
  assert.equal(calls, 3);

  outcomeUncertain = true;
  const heldSuffix = '/' + randomUUID();
  assert.equal((await post('', { id: heldSuffix.slice(1), testId: question.id, mode: 'practice' })).status, 200);
  assert.equal((await post(heldSuffix + '/begin')).status, 200);
  assert.equal((await post(heldSuffix + '/answer', { index: 0, revision: 1, text: answer, next: true })).status, 200);
  await service.waitForJobs();
  const held = await get(heldSuffix);
  assert.equal(held.assessmentStatus, 'unavailable');
  assert.equal(held.answers[0], answer);
  assert.deepEqual(held.results, [null]);
  const heldLegacy = await post(heldSuffix + '/score/0');
  assert.equal(heldLegacy.status, 200);
  assert.match((await heldLegacy.json()).feedback.form, /AI estimate is unavailable/);
  const heldId = heldSuffix.slice(1);
  await service.store.update('tester', heldId, value => {
    delete value.practiceFeedback;
    value.startedAt = now - 30 * 86400000;
    return value;
  });
  await service.recover();
  await service.recover();
  await service.waitForJobs();
  assert.deepEqual((await service.store.get('tester', heldId)).practiceFeedback, submitted.practiceFeedback);
  assert.equal((await get('')).find(a => a.id === heldId).assessmentStatus, 'unavailable');
  assert.equal(calls, 4);

  const shortSuffix = '/' + randomUUID();
  const shortAnswer = 'The lecture discussed this topic.';
  assert.equal((await post('', { id: shortSuffix.slice(1), testId: question.id, mode: 'practice' })).status, 200);
  assert.equal((await post(shortSuffix + '/begin')).status, 200);
  const submission = await post(shortSuffix + '/answer', { index: 0, revision: 1, text: shortAnswer, next: true });
  assert.equal(submission.status, 200);
  const immediate = await submission.json();
  assert.equal(immediate.report.score90, 10);
  assert.match(immediate.results[0].reasons.join(' '), /allowed range/);
  assert.deepEqual(immediate.questions[0].keyPoints, question.keyPoints);
  const saved = await get(shortSuffix);
  assert.equal(saved.answers[0], shortAnswer);
  assert.deepEqual(saved.results, immediate.results);

  const timedId = randomUUID(), timedSuffix = '/' + timedId;
  assert.equal((await post('', { id: timedId, testId: question.id, mode: 'practice', timedPractice: true })).status, 200);
  assert.equal((await post(timedSuffix + '/begin')).status, 200);
  assert.equal((await post(timedSuffix + '/answer', { index: 0, revision: 1, text: shortAnswer })).status, 200);
  await service.store.update('tester', timedId, value => ({ ...value, deadline: Date.now() - 1 }));
  const expired = await get(timedSuffix);
  assert.equal(expired.completed[0].reason, 'Time expired');
  assert.equal(expired.report.score90, 10);
  assert.equal(expired.answers[0], shortAnswer);
  await service.waitForJobs();
  assert.equal(calls, 4);
});
test('A substantial SST sentence cannot be erased by an unsupported fragment form gate',async()=>{
  const q=bank.spoken[0],text=sentence(57);
  const feedback=Object.fromEntries(Object.keys(policy.MAXIMA.sst).map(key=>[key,'Evidence-based feedback.']));
  const invalid={scores:{content:1,form:0,grammar:0,vocabulary:1,spelling:0},formInvalid:true,
    formReason:'All sentences are fragments.',feedback,strengths:[],improvements:['Improve sentence structure.'],errors:[]};
  assert.throws(()=>policy.normalize(q,text,invalid),/Unsupported SST form gate/);
  let calls=0;
  const result=await policy.grade(q,text,async()=>{
    calls++;
    return calls===1?invalid:{...invalid,scores:{...invalid.scores,form:2},formInvalid:false,formReason:''};
  });
  assert.equal(calls,2);
  assert.deepEqual(result.scores,{content:1,form:2,grammar:0,vocabulary:1,spelling:0});
  assert.equal(result.total,4);
  assert.equal(result.gated,false);
  const unresolved=await policy.grade(q,text,async()=>invalid);
  assert.equal(unresolved.score_provisional,true);
  assert.equal(unresolved.needs_semantic_review,true);
});
test('Elapsed clocks do not reset on refresh, and future prompts/samples stay hidden',()=>{
  const a={status:'active',questions:bank.mocks[0].questions.slice(0,3),index:0,deadline:600000,completed:[null,null,null]};
  assert.equal(present(a).questions[1].text,undefined);assert.equal(present(a).questions[0].sample,undefined);
  reconcile(a,1200100);assert.equal(a.index,2);assert.equal(a.deadline,2400000);
  reconcile(a,2400001);assert.equal(a.status,'submitted');assert.equal(a.completed.filter(Boolean).length,3);
});
test('Writing Mock essays use the shared essay grader',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'writing-shared-essay-'));
  const app=express();app.use(express.json());
  let sharedCalls=0;
  const essayGrader={
    grade:async(questionText,answer,band,options)=>{
      sharedCalls++;
      assert.equal(questionText,bank.mocks[0].questions[2].text);
      assert.match(answer,/minimum age/i);
      assert.equal(band,'9');
      assert.equal(options.totalTimeoutMs,240000);
      return {
        scoring_version:'test-shared-essay',
        scores:{content:5,form:2,grammar:2,vocabulary:2,spelling:2,linguistic:4,coherence:4,total:21},
        scoreGate:{status:'valid',cap:26,reason:''},
        feedback:{content:'Shared grader result.'},
        promptCoverage:[],scoringEvidence:{linguisticExamples:[],developmentEvidence:[],vocabularyExamples:[]},
        errors:[],improvements:[],strengths:[],wordCount:220
      };
    }
  };
  const {store}=installWritingLab(app,{directory:dir,verifyToken:t=>t==='tester'?'tester':null,getAccount:async()=>({}),
    callModel:async()=>{throw Error('Old mock essay scorer must not be called');},essayGrader});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port+'/api/writing-lab';
  const headers={'Content-Type':'application/json','x-session-token':'tester'};
  const id=randomUUID();
  let response=await fetch(base+'/attempts',{method:'POST',headers,body:JSON.stringify({id,testId:'writing-mock-1'})});
  assert.equal(response.status,200);
  await store.update('tester',id,a=>{
    a.status='submitted';
    a.completed=a.questions.map(()=>Date.now());
    a.answers[2]='I believe the minimum age for driving should be eighteen because maturity and road awareness develop with experience. My own experience supports a careful minimum age. '+Array(190).fill('reason').join(' ');
    a.results=a.questions.map(()=>null);
    return a;
  });
  response=await fetch(base+'/attempts/'+id+'/score/2',{method:'POST',headers,body:'{}'});
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(sharedCalls,1);
  assert.equal(result.total,21);
  assert.equal(result.maximum,26);
  assert.equal(result.version,'test-shared-essay');
  assert.equal(result.assessmentType,'Unified essay practice assessment');
});

test('Sectional mock SST uses the same Claude reviewer as individual practice',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mock-sst-claude-'));
  const app=express();app.use(express.json());
  let claudeCalls=0,gptCalls=0;
  const raw={scores:{content:2,form:2,grammar:2,vocabulary:2,spelling:2},formInvalid:false,formReason:'',
    feedback:Object.fromEntries(Object.keys(policy.MAXIMA.sst).map(key=>[key,'Supported review.'])),
    strengths:['Relevant summary'],improvements:['Include the main relationship.'],errors:[]};
  const {store}=installWritingLab(app,{directory:dir,verifyToken:value=>value==='tester'?'tester':null,
    getAccount:async()=>({}),callModel:async()=>{claudeCalls++;return raw;},
    mockGraders:{callModel:async()=>{gptCalls++;return raw;}}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port+'/api/writing-lab';
  const headers={'Content-Type':'application/json','x-session-token':'tester'},id=randomUUID();
  assert.equal((await fetch(base+'/attempts',{method:'POST',headers,body:JSON.stringify({id,testId:'writing-mock-1'})})).status,200);
  await store.update('tester',id,a=>{a.status='submitted';a.completed=a.questions.map(()=>({at:Date.now()}));
    a.answers[3]=Array(59).fill('word').join(' ')+'.';
    a.results=a.questions.map((question,index)=>index===3?null:{total:0,maximum:report.maximumFor(question)});return a;});
  const response=await fetch(base+'/attempts/'+id+'/score/3',{method:'POST',headers,body:'{}'});
  assert.equal(response.status,200);assert.equal((await response.json()).total,10);
  assert.equal(claudeCalls,1);assert.equal(gptCalls,0);
});

test('Original content has correct task counts, lengths and usable reference answers',()=>{
  assert.equal(bank.spoken.length,15);assert.equal(bank.mocks.length,2);
  for(const q of bank.spoken) {assert(policy.wordCount(q.text)>=175);assert.equal(policy.formFor('sst',q.sample).score,2);}
  for(const mock of bank.mocks) {
    assert.deepEqual(mock.questions.map(q=>q.type),['swt','swt','essay','sst','wfd','wfd','wfd']);
    assert.equal(report.minutesFor(mock.questions),54);
    for(const q of mock.questions) {
      if(q.type==='wfd') { assert.equal(policy.gradeDictation(q,q.sample).total,report.maximumFor(q)); continue; }
      assert.equal(policy.formFor(q.type,q.sample).score,policy.MAXIMA[q.type].form);
      if(q.type==='sst') assert(policy.wordCount(q.text)>=175);
    }
  }
  assert.equal(bank.mocks[0].questions[2].text,"Age restrictions are placed on many activities. It is believed that people should not do things until they reach the right ages, such as getting married, driving, voting, buying certain products, and doing particular things. Give an example, state which minimum age you think it should be and share your own experience.");
  assert.equal(bank.mocks[1].questions[2].text,"Some universities deduct marks from students' work if it is given in late. What is your opinion? Suggest some alternative actions.");
});
test('Prediction mocks preserve essays and use only September 2026 prediction tasks',()=>{
  assert.equal(predictionMocks.length,bank.predictionEssays.length);assert.equal(predictionMocks.length,33);
  assert.deepEqual(predictionMocks[0].questions.slice(0,2).map(q=>q.title),['Origin of Species','Working Nine to Five (Independent Work)']);
  assert.deepEqual(predictionMocks.map(m=>m.questions.find(q=>q.type==='essay').text),bank.predictionEssays.map(e=>e.text));
  const signatures=predictionMocks.map(m=>m.questions.filter(q=>q.type!=='essay').map(q=>q.id).join('|'));
  assert.equal(new Set(signatures).size,predictionMocks.length);
  const allowed={
    swt:new Set(predictions.swt.map(q=>q.id)),
    sst:new Set(predictions.sst.map(q=>q.id)),
    wfd:new Set(predictions.wfd.map(q=>q.id))
  };
  for(const mock of predictionMocks){
    assert.deepEqual(mock.questions.map(q=>q.type),['swt','swt','essay','sst','wfd','wfd','wfd']);
    assert.equal(report.minutesFor(mock.questions),54);
    assert.equal(new Set(mock.questions.filter(q=>q.type==='swt').map(q=>q.id)).size,2);
    assert.equal(new Set(mock.questions.filter(q=>q.type==='wfd').map(q=>q.id)).size,3);
    for(const q of mock.questions.filter(q=>q.type!=='essay')){
      assert(q.id.startsWith('pred26-'),q.id+' must come from the prediction bank');
      assert(allowed[q.type].has(q.id),q.id+' is not in the current prediction bank');
      if(q.predictionSource.contentStatus==='verbatim-user-provided'){
        if(q.type==='wfd'){
          assert.equal(q.predictionSource.provider,'User supplied WFD predictions');
          assert.equal(q.predictionSource.week,'28 September 2026');
        } else if (q.type === 'swt') {
          assert.equal(q.predictionSource.provider,'User supplied SWT prediction screenshots');
          assert.equal(q.predictionSource.week, ['1', '174', '30'].includes(q.predictionSource.sourceId) ? '23 October 2026' : '20 October 2026');
        } else {
          assert.equal(q.predictionSource.provider,'User supplied prediction transcript');
          assert.equal(q.predictionSource.week,'25 September 2026');
        }
      } else {
        assert.equal(q.predictionSource.provider,'PTE Nepal');
        assert.equal(q.predictionSource.week,'21-27 September 2026');
      }
      assert(q.predictionSource.sourceId);
    }
  }
  const distinct=type=>new Set(predictionMocks.flatMap(m=>m.questions.filter(q=>q.type===type).map(q=>q.id))).size;
  assert.equal(distinct('swt'),predictions.swt.length);
  assert.equal(distinct('sst'),predictions.sst.length);
  assert.equal(distinct('wfd'),predictions.wfd.length);
  for(const q of predictions.swt) assert.equal(policy.formFor('swt',q.sample).score,1);
  for(const q of predictions.sst) assert.equal(policy.formFor('sst',q.sample).score,2);
  for(const q of predictions.wfd) assert.equal(q.sample,q.text);
});
test('Authenticated attempts persist, isolate users and lock submitted answers',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'writing-lab-test-'));
  const app=express();app.use(express.json());
  const {store}=installWritingLab(app,{directory:dir,verifyToken:x=>['alice','bob','blocked'].includes(x)?x:null,
    getAccount:async uid=>({blocked:uid==='blocked'}),callModel:async()=>{throw Error('Not used');}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port+'/api/writing-lab';
  async function request(route,body,user='alice') {const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','x-session-token':user},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
  const id=randomUUID();
  assert.equal((await request('/attempts',{id,testId:'writing-mock-1'},'')).status,401);
  assert.equal((await request('/attempts',undefined,'blocked')).status,401);
  const start=(await request('/attempts',{id,testId:'writing-mock-1'})).body;
  assert.equal(start.index,0);assert.equal(start.questions[1].text,undefined);
  assert.equal((await request('/attempts/'+id,undefined,'bob')).status,404);
  assert.equal((await request('/attempts/'+id+'/score/0',{})).status,409);
  const answer={index:0,text:'Cities need sustainable planning; public services make them accessible.',revision:1,next:true};
  const first=(await request('/attempts/'+id+'/answer',answer)).body;
  assert.equal(first.index,1);
  assert.equal((await request('/attempts/'+id+'/answer',answer)).body.index,1);
  assert.equal((await request('/attempts/'+id+'/answer',{...answer,text:'Changed answer',revision:3})).body.answers[0],answer.text);
  await store.update('alice',id,a=>{a.answers[0]='';a.results[0]=null;a.deadline=Date.now()-4000000;return a;});
  const done=(await request('/attempts/'+id)).body;assert.equal(done.status,'submitted');
  const grade=(await request('/attempts/'+id+'/score/0',{})).body;assert.equal(grade.total,0);
  // Expiry queues every unanswered item. Wait for those persisted results before
  // checking the reopened store and removing its directory during teardown.
  const remaining=await Promise.all(done.questions.slice(1).map((_,index)=>request('/attempts/'+id+'/score/'+(index+1),{})));
  for(const result of remaining){assert.equal(result.status,200);assert.equal(result.body.total,0);}
  const restarted=createStore(null,dir);assert.equal((await restarted.list('alice'))[0].results[0].total,0);
  assert.equal((await restarted.list('bob')).length,0);
});
test('Standalone dictation reuses recordings, hides answers, starts on play and keeps independent attempts',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dictation-practice-test-'));
  const app=express();app.use(express.json());
  installWritingLab(app,{directory:dir,verifyToken:t=>t==='tester'?'tester':null,getAccount:async()=>({}),callModel:async()=>{throw Error('Dictation needs no model');}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port+'/api/writing-lab';
  async function request(route,body) { const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','x-session-token':'tester'},body:body===undefined?undefined:JSON.stringify(body)});assert(r.ok);return r.json(); }
  const before=JSON.stringify(bank),catalog=await request('/catalog');
  const practiceSst = require('../content/additional-practice-questions.json').filter(q=>q.type==='sst');
  assert.deepEqual(catalog.spoken.map(q => q.id), [...predictions.sst, ...practiceSst].map(q => q.id));
  assert.equal(new Set(catalog.spoken.map(q => q.id)).size, catalog.spoken.length);
  const markedSst = catalog.spoken.filter(q => q.newInCatalogue);
  assert.equal(markedSst.length, 72);
  const library = require('../public/listening-studio').rows({items:catalog.spoken});
  assert.equal((library.match(/aria-label="Question status: NEW"/g) || []).length, 72);
  for (const q of markedSst) {
    assert(q.audioUrl.includes(q.id));
    assert.equal(q.text, undefined);
    assert.equal(q.sample, undefined);
  }
  const previous=[...new Map([...bank.mocks.flatMap(m=>m.questions.filter(q=>q.type==='wfd')),...bank.dictation].map(q=>[q.id,q])).values()];
  const addedDictations=require('../content/additional-practice-questions.json').filter(q=>q.type==='wfd');
  assert.equal(catalog.dictation.length,92+addedDictations.length);
  assert.equal(new Set(catalog.dictation.map(q=>q.id)).size,catalog.dictation.length);
  assert.deepEqual(catalog.dictation.slice(92).map(q=>q.id),addedDictations.map(q=>q.id));
  assert(catalog.dictation.some(q=>q.id==='pred26-user-wfd-11'));
  assert.deepEqual(catalog.dictation.slice(0,33).map(q=>q.id),predictions.wfd.slice(0,33).map(q=>q.id));
  const screenshotBatch=Array.from({length:139},(_,i)=>'wfd-user-20261125-'+String(i+1).padStart(3,'0'));
  assert.deepEqual(catalog.dictation.slice(93,232).map(q=>q.id),screenshotBatch);
  assert.deepEqual(catalog.dictation.slice(0,232).flatMap((q,i)=>q.newInCatalogue?[i+1]:[]),
    [1,3,4,8,11,14,15,19,20,24,31,32,33,...Array.from({length:140},(_,i)=>i+93)]);
  assert(catalog.dictation.slice(0,33).every(q=>q.prediction===true));
  assert.equal(catalog.dictation[33].id,previous[0].id);
  assert.equal(catalog.dictation[33].prediction,false);
  for(const q of catalog.dictation) {assert(q.audioUrl.includes(q.id));assert.equal(q.text,undefined);assert.equal(q.sample,undefined);}
  const q=addedDictations[0],id=randomUUID();
  const ready=await request('/attempts',{id,testId:q.id});
  assert.equal(ready.kind,'wfd');assert.equal(ready.status,'ready');assert.equal(ready.deadline,null);assert.equal(ready.questions.length,1);
  assert.equal(ready.questions[0].text,'');assert.equal(ready.questions[0].timeGroup,undefined);
  const active=await request('/attempts/'+id+'/begin',{});
  assert.equal(active.deadline-active.startedAt,q.minutes*60000);
  assert.equal((await request('/attempts/'+id+'/begin',{})).deadline,active.deadline);
  const done=await request('/attempts/'+id+'/answer',{index:0,text:q.text,revision:1,next:true,playback:{position:5,finished:true}});
  assert.equal(done.status,'submitted');assert.equal(done.questions[0].text,q.text);
  const result=await request('/attempts/'+id+'/score/0',{});assert.equal(result.total,result.maximum);
  const retryId=randomUUID(),retry=await request('/attempts',{id:retryId,testId:q.id});
  assert.equal(retry.status,'ready');assert.equal(retry.answers[0],'');
  const history=await request('/attempts');assert.equal(history.length,2);
  assert.equal(history.find(a=>a.id===id).score90,90);assert.equal(history.find(a=>a.id===retryId).kind,'wfd');
  const sst = catalog.spoken.find(q => q.id === 'sst-user-20261124-01');
  assert.equal(sst.title, "Patients' Recovery");
  assert.equal(sst.minutes, 10);
  assert.equal(sst.newInCatalogue, true);
  const imported = markedSst.find(q => q.id === 'sst-user-20261124-271');
  const importedAttempt = await request('/attempts', {id:randomUUID(), testId:imported.id});
  assert.equal(importedAttempt.kind, 'sst');
  assert.equal(importedAttempt.questions[0].audioUrl, imported.audioUrl);
  assert.equal(importedAttempt.questions[0].text, '');
  const sstId = randomUUID();
  const sstReady = await request('/attempts', {id:sstId, testId:sst.id});
  assert.equal(sstReady.kind, 'sst');
  assert.equal(sstReady.questions[0].audioUrl, sst.audioUrl);
  assert.equal(sstReady.questions[0].text, '');
  const sstStart = await request('/attempts/'+sstId+'/begin', {});
  assert.equal(sstStart.deadline - sstStart.startedAt, 600000);
  const response = 'The lecture describes how hospital design can improve patient recovery.';
  const saved = await request('/attempts/'+sstId+'/answer', {index:0, text:response, revision:1});
  assert.equal(saved.answers[0], response);
  const timedId=randomUUID(),untimedId=randomUUID();
  const timed=await request('/attempts',{id:timedId,testId:q.id,mode:'practice',timedPractice:true});
  assert.equal(timed.mode,'practice');
  assert.equal(timed.timedPractice,true);
  assert.equal(timed.deadline,null);
  const timedStart=await request('/attempts/'+timedId+'/begin',{});
  assert.equal(timedStart.deadline-timedStart.startedAt,q.minutes*60000);
  assert.equal((await request('/attempts/'+timedId+'/begin',{})).deadline,timedStart.deadline);
  const resumed=await request('/attempts/'+timedId);
  assert.equal(resumed.deadline,timedStart.deadline);
  assert.equal(resumed.timedPractice,true);
  const timedHistory=(await request('/attempts')).find(row=>row.id===timedId);
  assert.equal(timedHistory.timedPractice,true);
  assert.equal(timedHistory.supported,true);
  await request('/attempts',{id:untimedId,testId:q.id,mode:'practice'});
  assert.equal((await request('/attempts/'+untimedId+'/begin',{})).deadline,null);
  assert.equal(JSON.stringify(bank),before,'The original mock dictation timer group is unchanged');
});

test('Prediction and standalone practice IDs are accepted by the narration resolver',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'prediction-audio-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const seen=[];
  const audio=createNarration(dir,async input=>{seen.push(input);return Buffer.alloc(2000,7);});
  await audio.get(predictions.sst[0].id);
  await audio.get(predictions.wfd[0].id);
  const standalone = require('../content/additional-practice-questions.json').filter(question => !question.audioUrl);
  for(const question of standalone) await audio.get(question.id);
  assert.deepEqual(seen.map(item=>item.input),[predictions.sst[0].narrationText,predictions.wfd[0].text,...standalone.map(q=>q.narrationText||q.text)]);
  const voices=['coral','ash','sage','echo','nova'];
  const newDictationInputs=seen.filter(input=>input.model==='gpt-4o-mini-tts'&&input.instructions.startsWith('Read the sentence once'));
  assert.equal(newDictationInputs.length,139);
  assert.deepEqual(newDictationInputs.map(input=>input.voice),Array.from({length:139},(_,i)=>voices[i%voices.length]));
  assert(newDictationInputs.every(input=>input.speed===1&&input.requireNeural&&input.ambience.length===0));
});

test('The new HIW practice questions have exact keys and fixed audio on the Listening route', async t => {
  const publicDirectory = path.join(__dirname, '..', 'public');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hiw-practice-'));
  const app = express();
  app.use(express.json(), express.static(publicDirectory));
  const service = installWritingLab(app, {
    directory:dir, verifyToken:token => token === 'hiw-tester' ? token : null,
    getAccount:async () => ({}), callModel:async () => {throw Error('HIW scores locally');}
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await service.waitForJobs();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, {recursive:true, force:true});
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = async (route, body) => {
    const response = await fetch(base + '/api/writing-lab' + route, {
      method:body === undefined ? 'GET' : 'POST',
      headers:{'Content-Type':'application/json', 'x-session-token':'hiw-tester'},
      body:body === undefined ? undefined : JSON.stringify(body)
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const batch = require('../content/additional-practice-questions.json')
    .filter(q => q.id.startsWith('hiw-practice-20261125-'));
  const existing = require('../content/listening-mocks').mocks.flatMap(mock => mock.questions)
    .filter(q => q.type === 'hiw').map(q => q.id);
  const catalogue = (await request('/catalog')).listeningPractice.filter(q => q.type === 'hiw');
  assert.equal(batch.length, 50);
  assert.deepEqual(catalogue.map(q => q.id), [...new Set(existing), ...batch.map(q => q.id)]);
  assert.deepEqual(catalogue.filter(q => q.newInCatalogue).map(q => q.id), batch.map(q => q.id));
  const library = require('../public/listening-studio').rows({items:catalogue});
  assert.equal((library.match(/aria-label="Question status: NEW"/g) || []).length, 50);
  const hashes = new Set();
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const {inspectMp3} = require('../scripts/validate-writing-audio');
  for (const q of batch) {
    const spoken = q.text.split(/\s+/), displayed = q.passage.split(/\s+/);
    assert.equal(spoken.length, displayed.length, q.id);
    assert.deepEqual(q.answers, spoken.flatMap((word, index) => word === displayed[index] ? [] : [index]), q.id);
    assert(q.answers.length >= 3 && q.answers.length <= 9, q.id);
    assert.equal(q.audio.textSha256, hash(q.text), q.id);
    assert(!hashes.has(q.audio.sha256), q.id);
    hashes.add(q.audio.sha256);
    assert(q.audioUrl.endsWith(q.id + '-' + q.audio.sha256.slice(0,12) + '.mp3'), q.id);
    const audio = await fs.readFile(path.join(publicDirectory, q.audioUrl.slice(1)));
    assert.equal(q.audio.bytes, audio.length, q.id);
    assert.equal(q.audio.sha256, hash(audio), q.id);
    const frames = inspectMp3(audio);
    assert(frames.valid && Math.abs(frames.seconds - q.audio.seconds) < .15, q.id);
  }
  for (const q of batch) {
    const id = randomUUID();
    const attempt = await request('/attempts', {id, testId:q.id, mode:'practice'});
    const route = '/attempts/' + id;
    const audio = await fetch(base + attempt.questions[0].audioUrl, {headers:{Range:'bytes=0-199'}});
    assert.equal(audio.status, 206);
    assert.match(audio.headers.get('content-type'), /^audio\/mpeg/);
    assert.equal((await audio.arrayBuffer()).byteLength, 200);
    assert.equal(attempt.kind, 'hiw');
    assert.equal(attempt.questions[0].audioUrl, q.audioUrl);
    assert.equal(attempt.questions[0].text, '');
    assert.equal(attempt.questions[0].answers, undefined);
    await request(route + '/begin', {});
    const done = await request(route + '/answer', {index:0, revision:1, text:JSON.stringify(q.answers),
      next:true, playback:{position:q.audio.seconds, finished:true}});
    assert.equal(done.status, 'submitted');
    assert.equal(done.questions[0].text, q.text);
    assert.deepEqual(done.questions[0].answers, q.answers);
    await service.waitForJobs();
    assert.equal((await request(route)).results[0].total, q.answers.length);
  }
});

test('Narration accepts only bank IDs, shares concurrent generation and survives restart',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'writing-audio-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  let calls=0;const audio=createNarration(dir,async data=>{calls++;assert.equal(data.input,bank.spoken[0].text);return Buffer.alloc(2000,7);});
  const [a,b]=await Promise.all([audio.get(bank.spoken[0].id),audio.get(bank.spoken[0].id)]);assert.equal(a,b);assert.equal(calls,1);
  assert.equal(await createNarration(dir,()=>{throw Error('Should use cache');}).get(bank.spoken[0].id),a);
  await assert.rejects(audio.get('../../private'));
});

test('Dictation awards exact spelling in sequence without shifted, repeated or extra-word credit',async()=>{
  const q={type:'wfd',text:'The library is open to the public.'};
  const grade=text=>policy.gradeDictation(q,text);
  assert.equal((await policy.grade(q,'THE LIBRARY IS OPEN TO THE PUBLIC!',()=>{throw Error('No AI for dictation');})).total,7);
  assert.equal(grade('The library is open to public.').total,6);
  assert.equal(grade('The library is openn to the public.').total,6);
  assert.equal(grade('The library is open to the public tomorrow.').total,7);
  assert.equal(grade('the the the the').total,2);
  assert.equal(grade('').total,0);
  assert.equal(grade('public the to open is library the').total,3);
  assert.deepEqual(grade('The library is openn to the public.').wordFeedback.filter(x=>!x.correct).map(x=>x.word),['open']);
});

test('Scores out of 90 use complete marks and retain old three-question attempts',()=>{
  const questions=bank.mocks[0].questions;
  const full=questions.map(q=>({total:report.maximumFor(q),maximum:report.maximumFor(q)}));
  assert.equal(report.summarize(questions,full).score90,90);
  assert.deepEqual(report.summarize(questions,full).byType.map(g=>g.type),['swt','essay','sst','wfd']);
  assert.equal(report.summarize(questions,full.map(r=>({...r,total:0}))).score90,10);
  assert.equal(report.score90(5,10),50);
  assert.equal(report.score90(10,9),null);
  assert.equal(report.summarize(questions,full.slice(0,-1)).score90,null);
  assert.equal(report.summarize(questions,full.map((r,i)=>i===6?{...r,maximum:999}:r)).score90,null);
  const legacy=questions.slice(0,3), results=full.slice(0,3);
  assert.equal(report.summarize(legacy,results).maximum,44);
  assert.equal(report.summarize(legacy,results).score90,90);
  assert.equal(report.minutesFor(legacy),40);
});

test('SST transcripts stay hidden and three dictations share one clock through Next and expiry',()=>{
  const a={status:'active',questions:bank.mocks[0].questions,index:3,deadline:600000,completed:Array(7).fill(null)};
  assert.equal(present(a).questions[3].text,'');
  assert.equal(present(a).questions[3].sample,undefined);
  assert.equal(present(a).questions[4].audioUrl,undefined);
  advance(a,100000,'Submitted');
  assert.equal(a.index,4);assert.equal(a.deadline,340000);
  assert.equal(present(a).questions[4].text,'');
  assert.match(present(a).questions[4].audioUrl,/wm1-wfd1/);
  advance(a,120000,'Submitted');
  assert.equal(a.index,5);assert.equal(a.deadline,340000);
  reconcile(a,340001);
  assert.equal(a.status,'submitted');assert.equal(a.finishedAt,340000);
  assert.equal(a.completed[5].at,a.completed[6].at);
  assert.equal(present(a).questions[4].text,bank.mocks[0].questions[4].text);
});

test('Integrated recordings resolve distinct original narration for both mocks',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mock-narration-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const inputs=[];
  const narration=createNarration(dir,async input=>{inputs.push(input.input);return Buffer.alloc(2000,7);});
  const questions=bank.mocks.flatMap(m=>m.questions.filter(q=>['sst','wfd'].includes(q.type)));
  const files=[];
  for(const q of questions) files.push(await narration.get(q.id));
  assert.equal(new Set(files).size,8);assert.equal(new Set(inputs).size,8);
  assert.deepEqual(inputs,questions.map(q=>q.text));
  await assert.rejects(narration.get('wm1-swt1'));
});

test('Seven-question API saves separate playback and returns scores and history out of 90',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mock-api-test-'));
  const app=express();app.use(express.json());
  const {store}=installWritingLab(app,{directory:dir,verifyToken:x=>x==='tester'?'tester':null,getAccount:async()=>({}),callModel:async()=>{throw Error('Not required');}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port+'/api/writing-lab';
  async function request(route,body) {
    const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','x-session-token':'tester'},body:body===undefined?undefined:JSON.stringify(body)});
    assert.equal(response.status,200);return response.json();
  }
  const catalog=await request('/catalog');assert.equal(catalog.mocks[0].questionCount,7);assert.equal(catalog.mocks[0].minutes,54);
  const id=randomUUID();
  const started=await request('/attempts',{id,testId:'writing-mock-1'});assert.equal(started.questions.length,7);
  for(let index=0;index<3;index++) await request('/attempts/'+id+'/answer',{index,text:'',revision:1,next:true});
  await store.update('tester',id,a=>{a.playback[3]={position:0,finished:true};return a;});
  let a=await request('/attempts/'+id+'/answer',{index:3,text:'',revision:1,playback:{position:0,finished:false}});
  assert.deepEqual(a.playback[3],{position:0,finished:false});
  a=await request('/attempts/'+id+'/answer',{index:3,text:'',revision:2,playback:{position:70,finished:true}});
  a=await request('/attempts/'+id+'/answer',{index:3,text:'',revision:3,next:true,playback:{position:0,finished:false}});
  assert.deepEqual(a.playback[3],{position:70,finished:true});assert.equal(a.playback[4],null);
  const deadline=a.deadline;
  for(let index=4;index<7;index++) {
    const q=bank.mocks[0].questions[index];
    a=await request('/attempts/'+id+'/answer',{index,text:q.text,revision:1,next:true,playback:{position:4,finished:true}});
    if(index<6) assert.equal(a.deadline,deadline);
  }
  assert.equal(a.status,'submitted');assert.equal(a.report.score90,null);
  for(let index=0;index<7;index++) await request('/attempts/'+id+'/score/'+index,{});
  const finished=await request('/attempts/'+id), history=await request('/attempts');
  assert.equal(finished.report.complete,true);
  assert.equal(finished.report.byType.find(g=>g.type==='wfd').score90,90);
  assert.equal(history[0].score90,finished.report.score90);
  assert.equal(history[0].maximum,finished.report.maximum);
  assert.deepEqual(history[0].byType.map(g=>g.type),['swt','essay','sst','wfd']);
  assert.equal(history[0].byType.find(g=>g.type==='wfd').total,finished.report.byType.find(g=>g.type==='wfd').total);
  assert.equal((await createStore(null,dir).list('tester'))[0].results[6].total,report.maximumFor(bank.mocks[0].questions[6]));
  // Existing snapshots are never extended by the new catalogue.
  const oldId=randomUUID();
  await store.update('tester',oldId,()=>({...started,id:oldId,status:'active',questions:bank.mocks[0].questions.slice(0,3),completed:[null,null,null],results:[null,null,null],deadline:Date.now()+600000}));
  assert.equal((await request('/attempts/'+oldId)).questions.length,3);
});
test('Fifty additional dictations have distinct sentences and exact sample answers',async()=>{
 assert.equal(bank.dictation.length,50);
 const existing=bank.mocks.flatMap(m=>m.questions).filter(q=>q.type==='wfd');
 assert.equal(new Set([...existing,...bank.dictation].map(q=>q.text)).size,56);
 for(const q of bank.dictation){assert.equal(q.type,'wfd');assert.equal(q.sample,q.text);assert(q.text.split(/\s+/).length>=10);const result=await policy.grade(q,q.sample,()=>{throw Error('No model required');});assert.equal(result.total,result.maximum);}
});
test('Expanded dictation bank starts every question and retains the earliest attempt',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dictation-expanded-')),app=express();app.use(express.json());
 installWritingLab(app,{directory:dir,verifyToken:token=>/^dictation-tester-\d+$/.test(token)?token:null,getAccount:async()=>({}),callModel:()=>{throw Error('No model required');}});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port+'/api/writing-lab';
 const catalog=await (await fetch(base+'/catalog')).json();
 const history=[];let first;
 // Cover the whole bank without exceeding the real per-account start limit.
 for(let offset=0;offset<catalog.dictation.length;offset+=100){
  const headers={'Content-Type':'application/json','x-session-token':'dictation-tester-'+offset};
  const batch=catalog.dictation.slice(offset,offset+100);
  for(const q of batch){
   const id=randomUUID();first ||= id;
   const response=await fetch(base+'/attempts',{method:'POST',headers,body:JSON.stringify({id,testId:q.id})});
   assert.equal(response.status,200,q.id);
   const a=await response.json();assert.equal(a.questions[0].text,'');assert.equal(a.questions[0].sample,undefined);assert.equal(a.status,'ready');
  }
  const saved=await (await fetch(base+'/attempts',{headers})).json();
  assert.equal(saved.length,batch.length);
  history.push(...saved);
 }
 assert.equal(history.length,catalog.dictation.length);
 assert(history.some(a=>a.id===first));assert(history.some(a=>a.testId==='pred26-user-wfd-01'));assert(history.some(a=>a.testId==='wfd-practice-50'));
});


test('legacy local fallback cannot score essays',()=>{
  const q={type:'essay',text:'Should public transport receive more funding than roads?'};
  assert.throws(()=>policy.localGrade(q,'A valid essay response.',{reason:'model offline'}),/unified essay engine/i);
  assert.throws(()=>policy.localContentScore(q,'A valid essay response.'),/unified essay engine/i);
});

test('local Writing fallback returns a usable score when the external model is unavailable',async()=>{
  const swt={type:'swt',text:'Cities can reduce heat by planting trees and protecting green spaces.',keyPoints:['Cities can reduce heat','planting trees','protecting green spaces']};
  const answer='Cities can reduce heat by planting trees and protecting green spaces.';
  const result=await policy.grade(swt,answer,async()=>{throw Error('model offline');});
  assert.equal(result.scoringMode,'local');
  assert.equal(result.assessmentType,'Local practice assessment');
  assert.equal(result.scores.form,1);
  assert.equal(result.scores.content,3);
  assert.equal(result.score_provisional,true);
  assert.equal(result.needs_semantic_review,true);
  assert.equal(result.full_content_eligible,false);
  assert(result.total < result.maximum);
  assert(Number.isFinite(result.total));
});
test('local fallback keeps deterministic WFD scoring unchanged',async()=>{
  const q={type:'wfd',text:'Students should review the lecture before the tutorial.'};
  const result=await policy.grade(q,q.text,async()=>{throw Error('must not be called');});
  assert.equal(result.total,result.maximum);
  assert.equal(result.assessmentType,'Word-by-word practice assessment');
});


test('Writing narration has a local MP3 fallback when remote TTS is unavailable', async () => {
  const source=await fs.readFile(require.resolve('../writing-lab-audio'),'utf8');
  assert.match(source,/createLocalNarration/);
  assert.match(source,/run\('espeak'/);
  assert.match(source,/run\('ffmpeg'/);
  assert.match(source,/using local narrator/);
});

test('Provider-free SWT and SST keyword matches stay provisional, including reversed claims', async () => {
  for (const type of ['swt', 'sst']) {
    const q={type,text:'Trees cool cities and provide shade; councils must maintain them.',
      keyPoints:['Trees cool cities','Trees provide shade','Councils must maintain trees']};
    for (const reversed of [false,true]) {
      let answer=reversed
        ? 'Trees do not cool cities or provide shade, and councils must not maintain trees.'
        : 'Trees cool cities and provide shade, and councils must maintain trees.';
      if(type==='sst') answer += ' '+Array(42).fill('context').join(' ')+'.';
      const r=await policy.grade(q,answer,async()=>{throw Error('offline');});
      assert.equal(r.scoringMode,'local');
      assert.equal(r.score_provisional,true);
      assert.equal(r.full_content_eligible,false);
      assert(r.scores.content<=3);
      assert(r.total<r.maximum);
    }
  }
});

test('Local Content zero awards no native points while retaining language diagnostics', async () => {
  const q={type:'swt',text:'Trees cool cities.',keyPoints:['Trees cool cities','Councils maintain trees']};
  const r=await policy.grade(q,'Astronauts explore distant planets in space.',async()=>{throw Error('offline');});
  assert.equal(r.total,0);
  assert.equal(r.gated,true);
  assert.equal(r.score_provisional,true);
  assert(Object.values(r.scores).every(x=>x===0));
  assert.equal(r.diagnosticScores.form,1);
  assert.equal(r.diagnosticScores.grammar,2);
});
