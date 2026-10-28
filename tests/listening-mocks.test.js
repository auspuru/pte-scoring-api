'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {randomUUID,createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const express=require('express');
const {mocks,missing,listeningFormat}=require('../content/listening-mocks');
const {installWritingLab,present,reconcile}=require('../writing-lab');
const scoring=require('../listening-scoring');
const report=require('../public/writing-lab-report');
const ui=require('../public/listening-tasks');
const catalogue=require('../public/practice-catalogue');
const {createNarration,normalizeMp3}=require('../writing-lab-audio');
const {inspectMp3}=require('../scripts/validate-writing-audio');
const manifest=require('../content/writing-audio/manifest.json');
const correct=q=>scoring.TYPES.has(q.type)?JSON.stringify(q.answers||[q.answer]):q.sample;

test('Three listening-only papers cover all eight task types in exam order without repeated questions',()=>{
  const all=[];
  for(const m of mocks){
    assert.equal(m.questions.length,15);assert.equal(report.minutesFor(m.questions),35);
    assert.deepEqual([...new Set(m.questions.map(q=>q.type))],Object.keys(listeningFormat.tasks));
    for(const [type,[min,max]] of Object.entries(listeningFormat.tasks)){
      const count=m.questions.filter(q=>q.type===type).length;assert(count>=min&&count<=max,type);
    }
    assert.equal(m.questions[0].minutes,10);assert(!m.questions[0].timeGroup);
    assert(m.questions.slice(1).every(q=>q.timeGroup==='listening'&&q.minutes===25));
    all.push(...m.questions.map(q=>q.id));
  }
  assert.equal(new Set(all).size,45);
});
test('Objective marking handles blanks, duplicate selections and negative marking without model calls',()=>{
  for(const q of mocks.flatMap(m=>m.questions).filter(q=>scoring.TYPES.has(q.type))){
    assert.equal(scoring.grade(q,correct(q)).total,scoring.maximum(q));
    assert.equal(scoring.grade(q,'').total,0);
    assert.equal(scoring.grade(q,'not JSON').total,0);
    if(['lmcma','hiw'].includes(q.type)){
      assert.equal(scoring.grade(q,JSON.stringify([q.answers[0],q.answers[0]])).total,1);
      const wrong=q.type==='hiw'?q.passage.split(/\s+/).findIndex((_,i)=>!q.answers.includes(i)):q.choices.findIndex((_,i)=>!q.answers.includes(i));
      assert.equal(scoring.grade(q,JSON.stringify([q.answers[0],wrong])).total,0);
    }
    if(q.type==='lfi'){
      assert.equal(scoring.grade(q,JSON.stringify(q.answers.map(w=>' '+w.toUpperCase()+' '))).total,q.answers.length);
      assert.equal(scoring.grade(q,JSON.stringify(['misspelling',...q.answers.slice(1)])).total,q.answers.length-1);
    }
  }
});
test('Listening answer keys and full transcripts stay hidden until final submission',()=>{
  const m=mocks[0];
  for(let index=0;index<m.questions.length;index++){
    const a={questions:m.questions,index,status:'active',results:[],answers:[]};
    const value=present(a),q=value.questions[index];
    assert.equal(q.text,'');assert.equal(q.answers,undefined);assert.equal(q.answer,undefined);assert.equal(q.explanation,undefined);assert.equal(q.sample,undefined);
    for(const future of value.questions.slice(index+1)){
      assert.equal(future.text,undefined);assert.equal(future.choices,undefined);assert.equal(future.passage,undefined);
    }
    if(scoring.TYPES.has(q.type))assert.equal(q.maximum,scoring.maximum(m.questions[index]));
    if(['lfi','hiw'].includes(q.type))assert(q.passage);
  }
});
test('All reused recordings match verified source transcripts and blank/highlight positions',()=>{
  for(const q of mocks.flatMap(m=>m.questions)){
    if(q.type==='smw')continue;
    assert.equal(manifest[q.audioId||q.id].textSha256,createHash('sha256').update(q.text).digest('hex'),q.id);
    if(q.type==='lfi')assert.equal(q.passage.replace(/\[\[(\d+)\]\]/g,(_,n)=>q.answers[n-1]),q.text);
    if(q.type==='hiw'){
      const written=q.passage.split(/\s+/),heard=q.text.split(/\s+/);
      assert.equal(written.length,heard.length);
      assert.deepEqual(written.flatMap((word,i)=>word!==heard[i]?[i]:[]).sort((a,b)=>a-b),q.answers.slice().sort((a,b)=>a-b));
    }
  }
});
test('SST has its own clock; all remaining listening tasks retain one deadline through Next and expiry',()=>{
  const a={questions:mocks[0].questions,index:0,status:'active',completed:[],deadline:600000};
  reconcile(a,600001);assert.equal(a.index,1);assert.equal(a.deadline,2100000);
  require('../writing-lab').advance(a,700000,'Submitted');assert.equal(a.index,2);assert.equal(a.deadline,2100000);
  reconcile(a,2100001);assert.equal(a.status,'submitted');assert.equal(a.completed.filter(Boolean).length,15);
});
test('Catalogue exposes three listening cards and keeps them out of the writing module',()=>{
  const items=catalogue.mockItems(require('../public/reading-bank.json'),{mocks:[],listeningMocks:mocks.map(m=>({...m,minutes:35}))});
  assert.deepEqual(catalogue.filterMocks(items,{module:'listening'}).map(m=>m.id),mocks.map(m=>m.id));
  assert.equal(catalogue.filterMocks(items,{module:'writing'}).length,0);
});
test('Objective interfaces use native controls, preserve answers and display readable review text',()=>{
  const q=mocks[0].questions;
  assert.match(ui.render(q[1],correct(q[1])),/type="checkbox"/);
  assert.match(ui.render(q[5],correct(q[5])),/type="radio"/);
  assert.equal((ui.render(q[3],correct(q[3])).match(/data-listening-blank=/g)||[]).length,5);
  assert.match(ui.render(q[10],correct(q[10])),/aria-pressed="true"/);
  assert.equal(ui.response(q[1],JSON.stringify([1])),q[1].choices[1]);
  assert.match(ui.correct(q[3]),/Blank 1:/);
  assert(!ui.render({...q[1],choices:['<script>alert(1)</script>']},'[]').includes('<script>'));
});
test('Each complete listening paper saves, resumes, locks answers and returns all eight feedback groups',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'listening-mock-'));
  const app=express();app.use(express.json());let modelCalls=0;
  const {store}=installWritingLab(app,{directory,verifyToken:key=>key==='tester'?'tester':null,getAccount:async()=>({}),callModel:async()=>{modelCalls++;throw Error('Use local summary fallback in test');}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port+'/api/writing-lab',headers={'Content-Type':'application/json','x-session-token':'tester'};
  const request=async(url,body)=>{const response=await fetch(base+url,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})});assert.equal(response.status,200,url);return response.json();};
  const catalog=await request('/catalog');assert.equal(catalog.listeningMocks.length,3);assert(!catalog.mocks.some(m=>m.module==='listening'));
  for(const m of mocks){
    const id=randomUUID();let a=await request('/attempts',{id,testId:m.id});assert.equal(a.module,'listening');let deadline;
    for(let i=0;i<m.questions.length;i++){
      if(i===1)deadline=a.deadline;
      if(i>1)assert.equal(a.deadline,deadline);
      a=await request('/attempts/'+id+'/answer',{index:i,text:correct(m.questions[i]),revision:1,next:true,playback:{position:25,finished:true}});
      if(i===3){const resumed=await request('/attempts/'+id);assert.equal(resumed.deadline,deadline);assert.equal(resumed.answers[3],correct(m.questions[3]));assert(resumed.playback[3].finished);}
    }
    assert.equal(a.status,'submitted');
    for(let i=0;i<m.questions.length;i++)if(!a.results[i]||i===1)await request('/attempts/'+id+'/score/'+i,{});
    a=await request('/attempts/'+id);
    // The test's model always fails, so the local SST mark is provisional:
    // retain objective marks but never claim a complete weighted /90 estimate.
    assert.equal(a.report.complete,false);assert.equal(a.report.score90,null);
    assert.equal(a.report.weighting.profile,'listening');
    assert.equal(a.report.byType.length,8);
    assert.equal(a.report.byType.find(g=>g.type==='sst').marked,0);
    for(const group of a.report.byType.filter(g=>g.type!=='sst'))assert.equal(group.total,group.maximum,group.type);
    const saved=a.answers[1];a=await request('/attempts/'+id+'/answer',{index:1,text:'tamper',revision:2,next:true});assert.equal(a.answers[1],saved);
    assert.equal((await store.list('tester')).find(row=>row.id===id).module,'listening');
  }
  assert.equal(modelCalls,6,'Only the three SST responses can call the existing model scorer (two bounded attempts each).');
});
test('Missing-word narration omits the answer and appends a real audible cue',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'listening-cue-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const voice=execFileSync('ffmpeg',['-loglevel','error','-f','lavfi','-i','sine=frequency=220:duration=1:sample_rate=48000','-f','wav','pipe:1']);
  let input;
  const narration=createNarration(directory,async value=>{input=value;return voice;},{postProcess:normalizeMp3});
  const file=await narration.get(missing[0].id),bytes=await fs.readFile(file);
  assert.equal(input.input,missing[0].text);assert(!input.input.includes(missing[0].choices[missing[0].answer]));assert(input.endCue);
  assert(inspectMp3(bytes).valid);
  const seconds=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',file],{encoding:'utf8'}));
  assert(seconds>1.45&&seconds<1.7,seconds);
  assert.equal(await narration.get(missing[0].id),file);
});
