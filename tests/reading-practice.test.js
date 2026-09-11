'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {score,diagnostic,report,remaining,storageKey,totals}=require('../public/reading-practice');
const {compose,createSpeaker}=require('../public/reading-mock-tools');
const bank=require('../public/reading-bank.json');
test('Every imported reading question retains a complete usable answer key',()=>{
 for(const set of bank.sets)for(const q of set.questions){
  const answers=q.type==='mcsa'?[q.answer]:q.answers;
  assert(answers.length);
  if(['dropdown','wordbank'].includes(q.type)){
   assert.equal([...q.passage.matchAll(/\[\[\d+\]\]/g)].length,answers.length);
   answers.forEach((a,i)=>assert((q.type==='dropdown'?q.options[i]:q.bank).includes(a)));
  }
  assert.equal(score(q,answers).earned,score(q,answers).possible);
  assert.equal(score(q,[]).earned,0);
 }
});
test('Multiple answers penalize wrong selections without negative totals or duplicate credit',()=>{
 const q={type:'mcma',answers:[0,2]};
 assert.equal(score(q,[0,1]).earned,0);
 assert.equal(score(q,[0,0,2]).earned,2);
 assert.equal(score(q,[1,3]).earned,0);
});
test('Reordering awards correct adjacent pairs rather than matching positions',()=>{
 assert.deepEqual(score({type:'reorder',answers:['A','B','C','D']},['C','D','A','B']),{earned:2,possible:3});
});
test('Diagnostic samples all five tasks with distinct stable question identities',()=>{
 const qs=diagnostic(bank.sets);assert.equal(qs.length,10);assert.equal(new Set(qs.map(q=>q.uid)).size,10);
 const rows=report(qs,{});assert.equal(rows.length,5);assert(rows.every(r=>r.count===2&&r.earned===0));
});
test('Timed sessions keep their original deadline on refresh; untimed sessions never expire',()=>{
 const session=JSON.parse(JSON.stringify({deadline:10000}));
 assert.equal(remaining(session,1000),9);assert.equal(remaining(session,12000),0);assert.equal(remaining({deadline:null},12000),null);
});
test('Reading storage is isolated by account and normalizes case',()=>{
 assert.equal(storageKey(' A@B.COM '),storageKey('a@b.com'));assert.notEqual(storageKey('a'),storageKey('b'));
});
const fs=require('node:fs'),vm=require('node:vm');
function client(){
 const values=new Map(), timers=[];
 const host={hidden:false,innerHTML:'',replaceChildren(){this.innerHTML='';},querySelector(selector){return {'#readingSet':{value:'v1'},'#readingType':{value:'dropdown'},'#readingTimed':{checked:false}}[selector]||null;},querySelectorAll(){return [];}};
 const ctx={currentUserId:'first',document:{getElementById:()=>host,hidden:false},localStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},fetch:async()=>({ok:true,json:async()=>bank}),AbortSignal,Date,setInterval:fn=>{timers.push(fn);return timers.length;},clearInterval(){},setTimeout,clearTimeout,confirm:()=>true};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../public/reading-mock-tools'),'utf8'),ctx);vm.runInContext(fs.readFileSync(require.resolve('../public/reading-exam-player'),'utf8'),ctx);vm.runInContext(fs.readFileSync(require.resolve('../public/reading-session-timing'),'utf8'),ctx);vm.runInContext(fs.readFileSync(require.resolve('../public/reading-review'),'utf8'),ctx);vm.runInContext(fs.readFileSync(require.resolve('../public/reading-practice'),'utf8'),ctx);
 const click=dataset=>host.onclick({target:{closest:()=>({dataset,disabled:false,setAttribute(){}})}});
 return {ctx,host,values,timers,click};
}
test('Reading UI saves an answer, restores it, and removes it when another account opens',async()=>{
 const h=client();await h.ctx.ReadingPractice.open();h.click({start:'practice'});
 h.host.onchange({target:{dataset:{answer:'0'},value:'Calm'}});
 assert.match(h.values.get(storageKey('first')),/Calm/);
 h.ctx.ReadingPractice.reset();await h.ctx.ReadingPractice.open();assert.match(h.host.innerHTML,/option selected value="Calm"/);
 h.ctx.currentUserId='second';await h.ctx.ReadingPractice.open();assert.doesNotMatch(h.host.innerHTML,/data-answer/);assert.doesNotMatch(h.host.innerHTML,/Continue session/);
});
test('Reading UI completes an expired mock once and retains its review in history',async()=>{
 const h=client();await h.ctx.ReadingPractice.open();h.click({start:'mock'});
 const key=storageKey('first'),saved=JSON.parse(h.values.get(key));saved.session.deadline=Date.now()-1000;h.values.set(key,JSON.stringify(saved));
 h.ctx.ReadingPractice.reset();await h.ctx.ReadingPractice.open();
 assert.match(h.host.innerHTML,/Session complete/);let result=JSON.parse(h.values.get(key));assert.equal(result.history.length,1);assert.equal(result.session.done,true);
 h.timers.at(-1)();result=JSON.parse(h.values.get(key));assert.equal(result.history.length,1);
});
test('A question-bank response arriving after sign-out cannot restore the reading pane',async()=>{
 const h=client();let resolve;h.ctx.fetch=()=>new Promise(r=>resolve=r);
 const pending=h.ctx.ReadingPractice.open();h.ctx.currentUserId='';h.ctx.ReadingPractice.reset();resolve({ok:true,json:async()=>bank});await pending;
 assert.equal(h.host.innerHTML,'');assert.equal(h.values.size,0);
});
const swtPassage={id:901,title:'Shared resources',text:'Researchers examining shared resources found that clear responsibilities and fair access helped communities maintain them. '.repeat(3),keyElements:{what:'Clear responsibilities and fair access sustain shared resources.'},sampleResponse:'Clear responsibilities and fair access help communities sustain shared resources.'};
const secondSwtPassage={id:902,title:'Urban shade',text:'Urban researchers found that street trees reduced summer temperatures while improving pedestrian comfort. Long-term maintenance helped sustain these benefits across the city.',keyElements:{what:'Maintained street trees cool cities and improve pedestrian comfort.'},sampleResponse:'Well-maintained street trees cool cities while improving pedestrian comfort.'};
const swtPassages=[swtPassage,secondSwtPassage];
const confirmedGrade={raw_score:8,max_raw_score:9,trait_scores:{content:3,form:1,grammar:2,vocabulary:2}};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('Full mixed mock adds SWT and highlight tasks; two fixed sectionals contain reading only',()=>{
 for(const set of bank.sets){
  const full=compose(bank,'full',set.id,swtPassages);
  assert.equal(full.minutes,55);assert.equal(full.questions.length,set.questions.length+6);
  assert.equal(full.questions.filter(q=>q.type==='swt').length,2);
  assert.equal(full.questions.filter(q=>q.type==='hcs').length,2);
  assert.equal(full.questions.filter(q=>q.type==='hiw').length,2);
  assert.equal(new Set(full.questions.map(q=>q.uid)).size,full.questions.length);
 }
 const sections=bank.sectionalMocks.map(m=>compose(bank,m.id,'v3'));
 assert.deepEqual(sections.map(s=>s.questions.length),[16,20]);
 assert.deepEqual(sections.map(s=>s.minutes),[25,30]);
 assert(sections.every(s=>s.questions.every(q=>!['swt','hcs','hiw'].includes(q.type))));
 assert(!sections[0].questions.some(q=>sections[1].questions.some(other=>other.uid===q.uid)));
 assert.throws(()=>compose(bank,'full','v1'),/SWT passage/);
});
test('C2-targeted HIW keys correspond exactly to transcript/audio differences',()=>{
 for(const q of bank.mixedMock.audioQuestions.filter(q=>q.type==='hiw')){
  const written=q.passage.split(/\s+/),spoken=q.audioText.split(/\s+/);
  assert.equal(q.cefrTarget,'C2');assert.equal(written.length,spoken.length);
  assert.deepEqual(written.flatMap((word,i)=>word===spoken[i]?[]:[i]),q.answers);
  for(const c of q.corrections){assert.equal(written[c.index],c.written);assert.equal(spoken[c.index],c.spoken);}
  assert.equal(score(q,q.answers).earned,6);
  assert.equal(score(q,[...q.answers,0]).earned,5);
  assert.equal(score(q,[0,1,2]).earned,0);
  assert.equal(score(q,[...q.answers,...q.answers]).earned,6);
 }
 for(const q of bank.mixedMock.audioQuestions.filter(q=>q.type==='hcs')){
  assert.equal(score(q,[q.answer]).earned,1);assert.equal(score(q,[(q.answer+1)%q.choices.length]).earned,0);
  assert(q.reasoning.correct);assert(q.reasoning.options);
 }
});
test('Provisional SWT and unplayed audio are excluded from confirmed totals, with visible counts',()=>{
 const questions=compose(bank,'full','v1',swtPassages).questions;
 const swt=questions[0],hiw=questions.find(q=>q.type==='hiw');
 const s={questions,answers:{[swt.uid]:['A complete summary.'],[hiw.uid]:hiw.answers},assessments:{},audioStates:{}};
 const before=totals(s);assert.equal(before.pending,1);assert.equal(before.excluded,4);assert.equal(before.earned,0);
 s.assessments[swt.uid]={result:{...confirmedGrade,score_provisional:true}};assert.equal(totals(s).pending,1);
 s.assessments[swt.uid]={result:confirmedGrade};s.audioStates[hiw.uid]={status:'complete'};
 const after=totals(s);assert.equal(after.pending,0);assert.equal(after.excluded,3);assert.equal(after.earned,14);assert.equal(after.possible,before.possible+15);
});
function speechHarness(){
 const utterances=[],timeouts=[],events=[];
 const env={SpeechSynthesisUtterance:class{constructor(text){this.text=text;}},speechSynthesis:{getVoices:()=>[{lang:'en-AU'}],speak:u=>utterances.push(u),cancel(){}},setTimeout:fn=>{timeouts.push(fn);return timeouts.length;},clearTimeout(){}};
 return {env,utterances,timeouts,events,speaker:createSpeaker(env,(...event)=>events.push(event))};
}
test('Audio completion requires playback to start; cancellation ignores late callbacks and allows recovery',()=>{
 const h=speechHarness();h.speaker.play('q1','first audio');const first=h.utterances[0];
 assert.equal(first.voice.lang,'en-AU');first.onend();assert.equal(h.events.at(-1)[1],'error');
 h.speaker.play('q1','first audio');const retry=h.utterances[1];retry.onstart();h.speaker.cancel();retry.onend();assert.equal(h.events.at(-1)[1],'error');
 h.speaker.play('q2','second audio');const second=h.utterances[2];second.onstart();first.onend();second.onend();
 assert.deepEqual(h.events.at(-1).slice(0,2),['q2','complete']);
 h.timeouts.forEach(fn=>fn());assert.equal(h.events.at(-1)[1],'complete');
 const events=[];createSpeaker({},(...event)=>events.push(event)).play('unsupported','test');assert.equal(events[0][1],'error');
});
test('Full mock preserves submitted SWT through a failed grade and retries without duplicating history',async()=>{
 const h=client();h.ctx.passages=swtPassages;let calls=0;
 h.ctx.requestSwtGrade=async payload=>{calls++;assert(swtPassages.some(p=>p.id===payload.passageId));assert.equal(payload.userId,'first');if(calls===1)throw Error('Temporarily unavailable');return confirmedGrade;};
 await h.ctx.ReadingPractice.open();await h.click({start:'full'});
 assert.match(h.host.innerHTML,/readingSwtResponse/);
 h.host.oninput({target:{dataset:{swtResponse:''},value:'Clear responsibilities and fair access help communities sustain shared resources.'}});
 h.click({action:'submit'});await flush();
 let saved=JSON.parse(h.values.get(storageKey('first')));const uid=saved.session.questions[0].uid;
 assert.equal(saved.session.assessments[uid].status,'error');assert.equal(saved.history.length,1);assert.equal(saved.history[0].pending,1);assert.match(h.host.innerHTML,/Temporarily unavailable/);
 await h.click({action:'retry-swt'});saved=JSON.parse(h.values.get(storageKey('first')));
 assert.equal(calls,2);assert.equal(saved.session.assessments[uid].status,'complete');assert.equal(saved.history.length,1);assert.equal(saved.history[0].pending,0);assert.match(h.host.innerHTML,/8\/9 SWT points/);
});
test('A late SWT grade updates its completed history while another mock remains untouched',async()=>{
 const h=client();h.ctx.passages=swtPassages;let resolve,calls=0;
 h.ctx.requestSwtGrade=()=>{calls++;return new Promise(r=>resolve=r);};
 await h.ctx.ReadingPractice.open();await h.click({start:'full'});h.host.oninput({target:{dataset:{swtResponse:''},value:'A saved summary for assessment.'}});h.click({action:'submit'});
 h.click({action:'home'});h.click({history:'0'});await h.click({action:'retry-swt'});assert.equal(calls,1);
 h.click({action:'home'});await h.click({start:'sectional-1'});resolve(confirmedGrade);await flush();
 const saved=JSON.parse(h.values.get(storageKey('first')));assert.equal(saved.session.mode,'sectional-1');assert.equal(saved.session.done,false);assert.equal(saved.history.length,1);assert.equal(saved.history[0].pending,0);
});
test('A SWT grade arriving after an account switch cannot write to either account',async()=>{
 const h=client();h.ctx.passages=swtPassages;let resolve;
 h.ctx.requestSwtGrade=()=>new Promise(r=>resolve=r);
 await h.ctx.ReadingPractice.open();await h.click({start:'full'});h.host.oninput({target:{dataset:{swtResponse:''},value:'A saved summary for assessment.'}});h.click({action:'submit'});
 const first=h.values.get(storageKey('first'));h.ctx.currentUserId='second';await h.ctx.ReadingPractice.open();const second=h.values.get(storageKey('second'));
 resolve(confirmedGrade);await flush();assert.equal(h.values.get(storageKey('first')),first);assert.equal(h.values.get(storageKey('second')),second);assert.doesNotMatch(h.host.innerHTML,/8\/9/);
});
test('HIW selection stays interactive during audio; leaving interrupts playback and reopening retains the answer',async()=>{
 const h=client(),audio=speechHarness();Object.assign(h.ctx,audio.env);h.ctx.passages=swtPassages;
 await h.ctx.ReadingPractice.open();await h.click({start:'full'});
 const saved=()=>JSON.parse(h.values.get(storageKey('first'))),index=saved().session.questions.findIndex(q=>q.type==='hiw');
 for(let i=0;i<index;i++){h.click({action:'exam-next'});h.click({action:'exam-confirm'});}
 const readyAt=saved().session.audioStates[saved().session.questions[index].uid].readyAt;h.ctx.Date=class extends Date { static now(){return readyAt;} };h.timers.at(-1)();const utterance=audio.utterances[0];utterance.onstart();
 const html=h.host.innerHTML;h.click({hiwWord:'4'});assert.equal(h.host.innerHTML,html);
 const q=saved().session.questions[index];assert.deepEqual(saved().session.answers[q.uid],[4]);
 h.ctx.ReadingPractice.leave();assert.equal(saved().session.audioStates[q.uid].status,'error');utterance.onend();assert.equal(saved().session.audioStates[q.uid].status,'error');
 await h.ctx.ReadingPractice.open();assert.match(h.host.innerHTML,/data-hiw-word="4"[^>]*aria-pressed="true"/);
 h.click({action:'play'});audio.utterances[1].onstart();audio.utterances[1].onend();h.click({action:'play'});assert.equal(audio.utterances.length,2);
 h.click({action:'submit'});assert.equal(saved().session.audioStates[q.uid].status,'complete');
});
const examPlayer=require('../public/reading-exam-player');
test('Every mock and diagnostic uses the same exam shell while practice keeps its review tools',async()=>{
 for(const mode of ['full','mock','sectional-1','sectional-2','diagnostic','practice']){
  const h=client();h.ctx.passages=swtPassages;await h.ctx.ReadingPractice.open();await h.click({start:mode});
  const isMock=mode!=='practice';assert.equal(h.host.innerHTML.includes('data-exam-player'),isMock);
  if(isMock){
   assert.match(h.host.innerHTML,/[Tt]ime remaining/);assert.match(h.host.innerHTML,/data-action="exam-next"/);
   assert.doesNotMatch(h.host.innerHTML,/data-question=|data-action="flag"|data-move="-1"|data-action="check"/);
  }else assert.match(h.host.innerHTML,/data-action="check"/);
 }
});
test('Exam Next immediately skips unanswered parts, blocks backward movement, and preserves the deadline',async()=>{
 const h=client();await h.ctx.ReadingPractice.open();await h.click({start:'sectional-1'});
 const saved=()=>JSON.parse(h.values.get(storageKey('first'))),deadline=saved().session.deadline;
 h.click({action:'exam-next'});assert.equal(saved().session.index,1);assert.doesNotMatch(h.host.innerHTML,/unanswered parts|Continue to next question|Keep working/);
 assert.deepEqual(saved().session.answers,{});
 h.click({question:'0'});h.click({move:'-1'});h.click({action:'check'});assert.equal(saved().session.index,1);assert.equal(saved().session.checked.length,0);
 h.click({action:'exam-exit'});h.click({action:'exam-confirm'});assert.doesNotMatch(h.host.innerHTML,/data-exam-player/);assert.match(h.host.innerHTML,/Continue session/);
 h.ctx.ReadingPractice.reset();await h.ctx.ReadingPractice.open();assert.equal(saved().session.index,1);assert.equal(saved().session.deadline,deadline);assert.match(h.host.innerHTML,/Question 2 of 16/);
});
test('Finish mock submits once and shows every question on one review page',async()=>{
 const h=client();await h.ctx.ReadingPractice.open();await h.click({start:'sectional-2'});
 const saved=()=>JSON.parse(h.values.get(storageKey('first')));
 for(let i=0;i<saved().session.questions.length-1;i++){h.click({action:'exam-next'});h.click({action:'exam-confirm'});}
 assert.match(h.host.innerHTML,/Finish mock/);h.click({action:'exam-next'});assert.equal(saved().session.done,true);assert.equal(saved().history.length,1);assert.doesNotMatch(h.host.innerHTML,/data-exam-player/);
 assert.match(h.host.innerHTML,/Question 1 of 20/);assert.match(h.host.innerHTML,/Question 20 of 20/);assert.equal((h.host.innerHTML.match(/data-review-question=/g)||[]).length,20);
 assert.doesNotMatch(h.host.innerHTML,/data-question=|data-move=|data-action="exam-next"/);
 h.timers.at(-1)();assert.equal(saved().history.length,1);
});
test('The two reorder panels transfer, return and reorder selected paragraphs without duplicate answers',async()=>{
 const h=client();await h.ctx.ReadingPractice.open();await h.click({start:'sectional-1'});
 const saved=()=>JSON.parse(h.values.get(storageKey('first'))),index=saved().session.questions.findIndex(q=>q.type==='reorder');
 for(let i=0;i<index;i++){h.click({action:'exam-next'});h.click({action:'exam-confirm'});}
 const q=saved().session.questions[index],first=q.items[0].key,second=q.items[1].key;
 assert.match(h.host.innerHTML,/Source paragraphs/);assert.match(h.host.innerHTML,/Paragraphs in your chosen order/);
 h.click({paragraph:first,panel:'source'});h.click({transfer:'target'});
 h.click({paragraph:second,panel:'source'});h.click({transfer:'target'});h.click({orderStep:'-1'});
 assert.deepEqual(saved().session.answers[q.uid],[second,first]);
 h.click({transfer:'source'});assert.deepEqual(saved().session.answers[q.uid],[first]);
 assert.deepEqual(examPlayer.moveParagraph(q,[first,second],first,'target'),[second,first]);
 assert.deepEqual(examPlayer.moveParagraph(q,[first],first,'target'),[first]);
});
test('Mock mode closes on exit, completion and sign-out without changing the stored theme',async()=>{
 const h=client(),classes=new Set(['dark']);h.ctx.document.body={classList:{toggle(name,on){on?classes.add(name):classes.delete(name);}}};
 await h.ctx.ReadingPractice.open();await h.click({start:'mock'});assert(classes.has('reading-exam-open'));
 h.click({action:'exam-exit'});h.click({action:'exam-confirm'});assert(!classes.has('reading-exam-open'));assert(classes.has('dark'));
 h.click({action:'resume'});assert(classes.has('reading-exam-open'));
 h.click({action:'submit'});assert(!classes.has('reading-exam-open'));
 await h.click({start:'sectional-1'});h.ctx.currentUserId='';h.ctx.ReadingPractice.reset();assert(!classes.has('reading-exam-open'));assert(classes.has('dark'));
});

test('Reading mock composition enforces Pearson timing, task counts, order, unique items and prompt limits',()=>{
 const {validateReading}=require('../public/reading-mock-tools');
 for(const set of bank.sets)assert.doesNotThrow(()=>validateReading(compose(bank,'mock',set.id).questions,set.minutes));
 const first=compose(bank,'sectional-1','v1'),second=compose(bank,'sectional-2','v1');
 assert.deepEqual(['dropdown','mcma','reorder','wordbank','mcsa'].map(type=>second.questions.filter(q=>q.type===type).length),[6,3,3,5,3]);
 assert.throws(()=>validateReading(first.questions,22),/section time/);
 assert.throws(()=>validateReading(first.questions,31),/section time/);
 assert.throws(()=>validateReading(first.questions.filter(q=>q.type!=='mcma'),25),/number/);
 assert.throws(()=>validateReading([...first.questions,first.questions[0]],25),/repeated/);
 assert.throws(()=>validateReading([...first.questions].reverse(),25),/task order/);
 const overlong=structuredClone(first.questions);overlong.find(q=>q.type==='wordbank').passage='word '.repeat(81);
 assert.throws(()=>validateReading(overlong,25),/word limit/);
 const broken=structuredClone(bank);broken.sectionalMocks[1].questionRefs[0].questionId=-1;
 assert.throws(()=>compose(broken,'sectional-2','v1'),/unavailable/);
});

test('An answer event after the deadline cannot change the response before the next timer tick',async()=>{
 const h=client();await h.ctx.ReadingPractice.open();await h.click({start:'sectional-1'});
 const key=storageKey('first'),initial=JSON.parse(h.values.get(key)).session;
 h.ctx.Date=class extends Date { static now(){return initial.deadline+600000;} };
 h.host.onchange({target:{dataset:{answer:'0'},value:'late answer'}});
 const saved=JSON.parse(h.values.get(key));
 assert.equal(saved.session.done,true);assert.equal(saved.session.finishedAt,initial.deadline);
 assert.equal(saved.session.completionReason,'timeout');assert.deepEqual(saved.session.answers,{});
 assert(saved.session.times[initial.questions[0].uid]<=25*60000);
 assert.match(h.host.innerHTML,/Time is up/);
 h.timers.at(-1)();assert.equal(JSON.parse(h.values.get(key)).history.length,1);
});

test('Next and resume enforce expiry even when browser background timers have not run',async()=>{
 for(const action of ['exam-next','resume']){
  const h=client();await h.ctx.ReadingPractice.open();await h.click({start:'sectional-2'});
  const key=storageKey('first'),initial=JSON.parse(h.values.get(key)).session;
  h.ctx.Date=class extends Date { static now(){return initial.deadline+3600000;} };
  h.click({action});const saved=JSON.parse(h.values.get(key));
  assert.equal(saved.session.done,true);assert.equal(saved.session.index,0);
  assert.equal(saved.session.finishedAt-initial.startedAt,30*60000);
  assert.equal(saved.history.length,1);
 }
 assert.equal(remaining({deadline:0},1),0);
});

test('Existing saved sectionals retain their original questions and deadline after a preset update',async()=>{
 const h=client();await h.ctx.ReadingPractice.open();await h.click({start:'sectional-2'});
 const key=storageKey('first'),old=JSON.parse(h.values.get(key));
 old.session.questions=bank.sets[1].questions.map(q=>({...q,uid:'v2:'+q.id}));
 old.session.formatVersion=2;old.session.deadline=old.session.startedAt+25*60000;
 h.values.set(key,JSON.stringify(old));h.ctx.ReadingPractice.reset();await h.ctx.ReadingPractice.open();
 const saved=JSON.parse(h.values.get(key));assert.equal(saved.session.questions.length,15);assert.equal(saved.session.deadline,old.session.deadline);
 h.click({action:'exam-exit'});h.click({action:'exam-confirm'});assert.match(h.host.innerHTML,/keeps its original questions and timer/);
});

test('Clicking a selected single answer again clears it without changing any other answers',async()=>{
 const h=client();await h.ctx.ReadingPractice.open();await h.click({start:'sectional-1'});
 const key=storageKey('first'),saved=()=>JSON.parse(h.values.get(key));
 const index=saved().session.questions.findIndex(q=>q.type==='mcsa');
 for(let i=0;i<index;i++){h.click({action:'exam-next'});h.click({action:'exam-confirm'});}
 const uid=saved().session.questions[index].uid;
 h.host.querySelectorAll=()=>[{dataset:{choice:'0'}}];
 h.host.onchange({target:{dataset:{choice:'0'}}});assert.deepEqual(saved().session.answers[uid],[0]);
 let prevented=false;
 h.host.onclick({target:{dataset:{choice:'0'},matches:()=>true},preventDefault(){prevented=true;}});
 assert(prevented);assert.deepEqual(saved().session.answers[uid],[]);
});

test('Leaving during an asynchronous mixed-mock start prevents the late response replacing a new session',async()=>{
 const h=client();await h.ctx.ReadingPractice.open();let resolve;
 h.ctx.fetch=()=>new Promise(r=>resolve=r);
 const pending=h.click({start:'full'});h.ctx.ReadingPractice.leave();
 await h.click({start:'sectional-1'});
 resolve({ok:true,json:async()=>swtPassages});await pending;
 const saved=JSON.parse(h.values.get(storageKey('first')));
 assert.equal(saved.session.mode,'sectional-1');assert.equal(saved.session.questions.length,16);
});

const timing=require('../public/reading-session-timing');
function clockFor(h){let now=Date.now();h.ctx.Date=class extends Date{static now(){return now;}};return {get now(){return now;},set(value){now=value;},add(ms){now+=ms;}};}
function nextQuestion(h){h.click({action:'exam-next'});h.click({action:'exam-confirm'});}
function snapshot(h){return JSON.parse(h.values.get(storageKey('first')));}
async function mixedClient(withAudio=false){const h=client(),clock=clockFor(h);let audio;if(withAudio){audio=speechHarness();Object.assign(h.ctx,audio.env);}h.ctx.passages=swtPassages;await h.ctx.ReadingPractice.open();await h.click({start:'full'});return {h,clock,audio};}
function goToAudio(h){const index=snapshot(h).session.questions.findIndex(q=>q.type==='hcs');while(snapshot(h).session.index<index)nextQuestion(h);}

test('Mixed practice requires two distinct SWT passages and a complete non-overlapping timing plan',()=>{
 assert.throws(()=>compose(bank,'full','v1',[swtPassage]),/Two different SWT/);
 assert.throws(()=>compose(bank,'full','v1',[swtPassage,swtPassage]),/Two different SWT/);
 assert.throws(()=>compose(bank,'full','v1',[swtPassage,{...swtPassage,id:903}]),/Two different SWT/);
 const plan=compose(bank,'full','v1',swtPassages),s={questions:plan.questions};timing.initialise(s,plan.stages,1000);
 assert.deepEqual(s.stages.map(stage=>stage.minutes),[10,10,25,10]);
 assert.equal(s.deadline,601000);assert.equal(s.index,0);
 const broken=structuredClone(plan.stages);broken[1].first=0;
 assert.throws(()=>timing.initialise({questions:plan.questions},broken,1000),/timing plan/);
});

test('SWT expiry saves the first response and starts an independent second clock; early completion discards spare time',async()=>{
 const {h,clock}=await mixedClient();const first=snapshot(h).session;
 h.host.oninput({target:{dataset:{swtResponse:''},value:'My first saved summary.'}});
 clock.set(first.deadline+1000);
 h.host.oninput({target:{dataset:{swtResponse:''},value:'This late input must not enter either response.'}});
 let s=snapshot(h).session;assert.equal(s.stageIndex,1);assert.equal(s.index,1);assert.equal(s.done,false);
 assert.equal(s.answers[s.questions[0].uid][0],'My first saved summary.');assert.equal(s.answers[s.questions[1].uid],undefined);
 assert.equal(s.stages[0].finishedAt,first.deadline);assert.equal(s.deadline,first.deadline+10*60000);
 assert.match(h.host.innerHTML,/SWT 2 of 2/);assert.match(h.host.innerHTML,/time is up/);
 const deadline=s.deadline;h.ctx.ReadingPractice.reset();await h.ctx.ReadingPractice.open();assert.equal(snapshot(h).session.deadline,deadline);
 clock.add(60000);h.host.oninput({target:{dataset:{swtResponse:''},value:'My second saved summary.'}});nextQuestion(h);
 s=snapshot(h).session;assert.equal(s.stageIndex,2);assert.equal(s.index,2);assert.equal(s.deadline,clock.now+25*60000);
 const readingDeadline=s.deadline;nextQuestion(h);assert.equal(snapshot(h).session.deadline,readingDeadline);
 h.click({question:'0'});assert.equal(snapshot(h).session.index,3);
});

test('Reading expiry skips remaining reading items and starts the shared HCS/HIW stage without accepting a late answer',async()=>{
 const {h,clock}=await mixedClient();nextQuestion(h);nextQuestion(h);
 const reading=snapshot(h).session;clock.set(reading.deadline+1000);
 h.host.onchange({target:{dataset:{answer:'0'},value:'late'}});
 const s=snapshot(h).session;assert.equal(s.stageIndex,3);assert.equal(s.questions[s.index].type,'hcs');
 assert.equal(s.deadline,reading.deadline+10*60000);assert.equal(s.answers[reading.questions[2].uid],undefined);
 assert.equal(s.audioStates[s.questions[s.index].uid].status,'countdown');
});

test('Returning after all four stage deadlines finishes once without granting new time or starting audio',async()=>{
 const {h,clock,audio}=await mixedClient(true);const began=snapshot(h).session.startedAt;
 h.ctx.ReadingPractice.leave();clock.set(began+80*60000);h.ctx.ReadingPractice.reset();await h.ctx.ReadingPractice.open();
 const saved=snapshot(h);assert.equal(saved.session.done,true);assert.equal(saved.session.finishedAt,began+55*60000);
 assert.equal(saved.session.stageIndex,3);assert(saved.session.stages.every(stage=>stage.completionReason==='timeout'));
 assert.equal(saved.history.length,1);assert.equal(audio.utterances.length,0);
 h.timers.at(-1)();assert.equal(snapshot(h).history.length,1);
});

test('Both saved SWT responses use the existing grader independently and merge into one attempt',async()=>{
 const {h}=await mixedClient();const payloads=[];h.ctx.requestSwtGrade=async payload=>{payloads.push(payload);return confirmedGrade;};
 h.host.oninput({target:{dataset:{swtResponse:''},value:'First response uses my original ideas.'}});nextQuestion(h);
 h.host.oninput({target:{dataset:{swtResponse:''},value:'Second response uses different original ideas.'}});h.click({action:'submit'});await flush();
 const saved=snapshot(h);assert.equal(payloads.length,2);assert.equal(new Set(payloads.map(p=>p.passageId)).size,2);
 assert.equal(saved.history.length,1);assert.equal(saved.history[0].pending,0);
 assert(saved.session.questions.filter(q=>q.type==='swt').every(q=>saved.session.assessments[q.uid].result.raw_score===8));
});

test('Each HCS and HIW question counts down, autoplays once and shares the same listening deadline',async()=>{
 const {h,clock,audio}=await mixedClient(true);goToAudio(h);const deadline=snapshot(h).session.deadline;
 for(let i=0;i<4;i++){
  let s=snapshot(h).session,q=s.questions[s.index],item=s.audioStates[q.uid];assert.equal(item.status,'countdown');
  assert.equal(item.readyAt,clock.now+10000);const ready=item.readyAt;
  // A harmless re-render cannot reset the preparation interval or start a second player.
  h.click({action:'exam-exit'});h.click({action:'exam-stay'});assert.equal(snapshot(h).session.audioStates[q.uid].readyAt,ready);
  clock.set(ready-1);h.timers.at(-1)();assert.equal(audio.utterances.length,i);
  clock.set(ready);h.timers.at(-1)();assert.equal(audio.utterances.length,i+1);
  const utterance=audio.utterances[i];utterance.onstart();h.timers.at(-1)();assert.equal(audio.utterances.length,i+1);
  utterance.onend();h.click({action:'play'});assert.equal(audio.utterances.length,i+1);
  assert.equal(snapshot(h).session.audioStates[q.uid].status,'complete');assert.equal(snapshot(h).session.deadline,deadline);
  nextQuestion(h);
 }
 assert.equal(snapshot(h).session.done,true);
});

test('Blocked autoplay offers manual recovery and ignores delayed events from the blocked attempt',async()=>{
 const {h,clock,audio}=await mixedClient(true);goToAudio(h);let s=snapshot(h).session,q=s.questions[s.index];
 clock.set(s.audioStates[q.uid].readyAt);h.timers.at(-1)();const blocked=audio.utterances[0];blocked.onerror({error:'not-allowed'});
 assert.match(snapshot(h).session.audioStates[q.uid].message,/blocked autoplay.*Play audio/);
 h.timers.at(-1)();assert.equal(audio.utterances.length,1);
 h.click({action:'play'});const retry=audio.utterances[1];retry.onstart();blocked.onstart();blocked.onend();
 assert.equal(snapshot(h).session.audioStates[q.uid].status,'playing');retry.onend();
 assert.equal(snapshot(h).session.audioStates[q.uid].status,'complete');h.click({action:'play'});assert.equal(audio.utterances.length,2);
});

test('A speech engine that silently blocks startup offers recovery after eight seconds',()=>{
 const h=speechHarness();h.speaker.play('blocked','Text to hear.');h.timeouts[0]();
 assert.equal(h.events.at(-1)[1],'error');assert.match(h.events.at(-1)[2],/Play audio/);
 h.utterances[0].onstart();h.utterances[0].onend();assert.equal(h.events.at(-1)[1],'error');
 h.speaker.play('blocked','Text to hear.');h.utterances[1].onstart();h.utterances[1].onend();assert.equal(h.events.at(-1)[1],'complete');
});

test('Exiting or refreshing during the countdown cancels autoplay while retaining the stage deadline',async()=>{
 const {h,clock,audio}=await mixedClient(true);goToAudio(h);const s=snapshot(h).session,q=s.questions[s.index],deadline=s.deadline;
 h.click({action:'exam-exit'});h.click({action:'exam-confirm'});clock.add(15000);h.timers.at(-1)();assert.equal(audio.utterances.length,0);
 h.click({action:'resume'});assert.equal(snapshot(h).session.audioStates[q.uid].status,'error');assert.equal(snapshot(h).session.deadline,deadline);
 h.ctx.ReadingPractice.reset();await h.ctx.ReadingPractice.open();h.timers.at(-1)();assert.equal(audio.utterances.length,0);assert.equal(snapshot(h).session.deadline,deadline);
 h.click({action:'play'});assert.equal(audio.utterances.length,1);
 h.ctx.currentUserId='second';await h.ctx.ReadingPractice.open();audio.utterances[0].onstart();audio.utterances[0].onend();assert.doesNotMatch(h.host.innerHTML,/data-audio-status/);
});

test('A backgrounded page cancels pending audio and late completion cannot pass a stage deadline',async()=>{
 const h=client(),clock=clockFor(h),audio=speechHarness(),listeners=new Map();Object.assign(h.ctx,audio.env);
 h.ctx.document.addEventListener=(name,fn)=>listeners.set(name,fn);h.ctx.document.removeEventListener=name=>listeners.delete(name);
 h.ctx.passages=swtPassages;await h.ctx.ReadingPractice.open();await h.click({start:'full'});goToAudio(h);
 let s=snapshot(h).session,q=s.questions[s.index];h.ctx.document.hidden=true;listeners.get('visibilitychange')();clock.add(12000);h.timers.at(-1)();assert.equal(audio.utterances.length,0);
 h.ctx.document.hidden=false;listeners.get('visibilitychange')();h.click({action:'play'});const utterance=audio.utterances[0];utterance.onstart();
 s=snapshot(h).session;clock.set(s.deadline+1);utterance.onend();
 const saved=snapshot(h);assert.equal(saved.session.done,true);assert.notEqual(saved.session.audioStates[q.uid].status,'complete');assert.equal(saved.history.length,1);
});

test('Legacy mixed attempts keep their single timer and original SWT count on refresh',async()=>{
 const {h}=await mixedClient();const key=storageKey('first'),legacy=snapshot(h);
 legacy.session.questions.splice(1,1);delete legacy.session.stages;delete legacy.session.stageIndex;
 legacy.session.deadline=legacy.session.startedAt+45*60000;legacy.session.formatVersion=3;
 h.values.set(key,JSON.stringify(legacy));h.ctx.ReadingPractice.reset();await h.ctx.ReadingPractice.open();
 assert.equal(snapshot(h).session.questions.filter(q=>q.type==='swt').length,1);assert.equal(snapshot(h).session.deadline,legacy.session.deadline);
});

test('Stage expiry on Reading home stays on home and cannot start audio until Resume',async()=>{
 const {h,clock,audio}=await mixedClient(true);nextQuestion(h);nextQuestion(h);
 const reading=snapshot(h).session;
 h.click({action:'exam-exit'});h.click({action:'exam-confirm'});
 clock.set(reading.deadline+1);h.timers.at(-1)();
 let s=snapshot(h).session;assert.equal(s.stageIndex,3);assert.equal(s.done,false);
 assert.doesNotMatch(h.host.innerHTML,/data-exam-player/);assert.match(h.host.innerHTML,/Continue session/);
 assert.equal(s.audioStates[s.questions[s.index].uid],undefined);
 clock.add(15000);h.timers.at(-1)();assert.equal(audio.utterances.length,0);
 const deadline=s.deadline;h.click({action:'resume'});s=snapshot(h).session;
 assert.match(h.host.innerHTML,/data-exam-player/);assert.equal(s.deadline,deadline);
 assert.equal(s.audioStates[s.questions[s.index].uid].readyAt,clock.now+10000);
 clock.add(10000);h.timers.at(-1)();assert.equal(audio.utterances.length,1);
});

test('Automatic completion on Reading home saves both SWT grades without forcing open the report',async()=>{
 const {h,clock,audio}=await mixedClient(true);let calls=0;h.ctx.requestSwtGrade=async()=>{calls++;return confirmedGrade;};
 h.host.oninput({target:{dataset:{swtResponse:''},value:'My first saved response.'}});nextQuestion(h);
 h.host.oninput({target:{dataset:{swtResponse:''},value:'My second saved response.'}});
 h.click({action:'exam-exit'});h.click({action:'exam-confirm'});
 clock.set(snapshot(h).session.startedAt+80*60000);h.timers.at(-1)();await flush();
 const saved=snapshot(h);assert(saved.session.done);assert.equal(saved.history.length,1);assert.equal(calls,2);assert.equal(saved.history[0].pending,0);
 assert.doesNotMatch(h.host.innerHTML,/reading-report|data-exam-player/);assert.match(h.host.innerHTML,/Review result/);assert.equal(audio.utterances.length,0);
 h.click({action:'resume'});assert.match(h.host.innerHTML,/reading-report/);
});

test('Background expiry and SWT grade completion cannot cancel a newly requested mixed test',async()=>{
 const {h,clock}=await mixedClient();let calls=0;
 h.ctx.requestSwtGrade=async()=>{calls++;return confirmedGrade;};
 h.host.oninput({target:{dataset:{swtResponse:''},value:'My saved response.'}});
 const startedAt=snapshot(h).session.startedAt;h.click({action:'exam-exit'});h.click({action:'exam-confirm'});
 delete h.ctx.passages;
 let resolve;h.ctx.fetch=()=>new Promise(r=>resolve=r);const pending=h.click({start:'full'});
 clock.set(startedAt+80*60000);h.timers.at(-1)();await flush();
 assert.equal(calls,1);assert.equal(snapshot(h).history[0].pending,0);
 assert.doesNotMatch(h.host.innerHTML,/reading-report|data-exam-player/);
 resolve({ok:true,json:async()=>swtPassages});await pending;
 const s=snapshot(h).session;assert.equal(s.mode,'full');assert.equal(s.done,false);assert.equal(s.stageIndex,0);
});

test('Resume opens the current stage or completed result on its first click when background timers were delayed',async()=>{
 for(const expiredAll of [false,true]){
  const {h,clock}=await mixedClient();nextQuestion(h);nextQuestion(h);
  const reading=snapshot(h).session;h.click({action:'exam-exit'});h.click({action:'exam-confirm'});
  clock.set(expiredAll?reading.startedAt+80*60000:reading.deadline+1);
  h.click({action:'resume'});
  const s=snapshot(h).session;assert.equal(s.done,expiredAll);
  assert.match(h.host.innerHTML,expiredAll?/reading-report/:/data-exam-player/);
  if(!expiredAll){assert.equal(s.stageIndex,3);assert.equal(s.deadline,reading.deadline+10*60000);}
 }
});

test('The home page offers exactly three practice and three sectional mocks covering every Reading contributor',async()=>{
 const h=client();h.ctx.passages=swtPassages;await h.ctx.ReadingPractice.open();
 const ids=[...h.host.innerHTML.matchAll(/data-start="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(ids.length,6);assert.equal(new Set(ids).size,6);
 assert.equal(ids.filter(id=>id.startsWith('practice-mock-')).length,3);assert.equal(ids.filter(id=>id.startsWith('sectional-mock-')).length,3);
 assert.doesNotMatch(h.host.innerHTML,/01 \/ PRACTISE|02 \/ DISCOVER|03 \/ CONNECT|Find my starting point|data-start="(?:full|practice|diagnostic)"|id="readingType"/);
 for(const id of ids){
  await h.click({start:id});const s=snapshot(h).session;
  assert.match(h.host.innerHTML,/data-exam-player/);assert.equal(s.questions.filter(q=>q.type==='swt').length,2);
  assert.deepEqual([...new Set(s.questions.map(q=>q.type))].sort(),['dropdown','hcs','hiw','mcma','mcsa','reorder','swt','wordbank'].sort());
  assert.equal(s.questions.filter(q=>q.type==='hcs').length,2);assert.equal(s.questions.filter(q=>q.type==='hiw').length,2);
  if(id.startsWith('practice')){assert.equal(s.deadline,null);assert.equal(s.stages,undefined);assert.match(h.host.innerHTML,/Untimed practice/);}
  else {assert.equal(s.stages.length,4);assert.deepEqual(s.stages.map(stage=>stage.minutes),[10,10,25,10]);}
 }
});

test('Three mock sets have distinct audio with accurate C2 HIW keys and explanations',()=>{
 const forms=bank.mockCatalogue.filter(m=>m.timed),seen=new Set();
 for(const form of forms){
  const plan=compose(bank,form.id,'ignored',swtPassages);
  assert.equal(plan.questions.length,bank.sets.find(s=>s.id===form.setId).questions.length+6);
  for(const q of plan.questions.filter(q=>['hcs','hiw'].includes(q.type))){
   assert(!seen.has(q.id));seen.add(q.id);assert(q.reasoning.correct);
   if(q.type==='hcs'){assert(q.choices[q.answer]);assert.equal(Object.keys(q.reasoning.options).length,3);}
   else{
    const written=q.passage.split(/\s+/),spoken=q.audioText.split(/\s+/);assert.equal(q.cefrTarget,'C2');assert.equal(written.length,spoken.length);
    assert.deepEqual(written.flatMap((word,i)=>word===spoken[i]?[]:[i]),q.answers);assert.equal(q.answers.length,6);
    for(const c of q.corrections){assert.equal(written[c.index],c.written);assert.equal(spoken[c.index],c.spoken);}
   }
  }
 }
 assert.equal(seen.size,12);
});

test('Next saves a partial answer immediately, advances stage clocks and finishes without confirmation',async()=>{
 const {h,clock}=await mixedClient();let s=snapshot(h).session;
 h.host.oninput({target:{dataset:{swtResponse:''},value:'A saved but unfinished summary'}});
 clock.add(30000);h.click({action:'exam-next'});s=snapshot(h).session;
 assert.equal(s.index,1);assert.equal(s.stageIndex,1);assert.equal(s.deadline,clock.now+600000);
 assert.equal(s.answers[s.questions[0].uid][0],'A saved but unfinished summary');assert.doesNotMatch(h.host.innerHTML,/reading-exam-confirm/);
 h.click({action:'exam-next'});s=snapshot(h).session;
 const q=s.questions[s.index];h.host.onchange({target:{dataset:{answer:'0'},value:q.answers[0]}});
 h.click({action:'exam-next'});s=snapshot(h).session;assert.equal(s.answers[q.uid][0],q.answers[0]);assert.equal(s.index,3);
 while(!snapshot(h).session.done)h.click({action:'exam-next'});
 assert.match(h.host.innerHTML,/All answers &amp; feedback/);assert.doesNotMatch(h.host.innerHTML,/reading-exam-confirm|data-move=|data-question=/);
});

test('One-page review retries the correct SWT response even when another question was last visited',async()=>{
 const {h}=await mixedClient(true);let calls=[],complete=false;
 h.ctx.requestSwtGrade=async payload=>{calls.push(payload.passageId);if(!complete)throw Error('Temporary failure');return {...confirmedGrade,content_details:{notes:'Your main idea is accurate.'}};};
 h.host.oninput({target:{dataset:{swtResponse:''},value:'First saved response.'}});nextQuestion(h);
 h.host.oninput({target:{dataset:{swtResponse:''},value:'Second saved response.'}});
 while(!snapshot(h).session.done)h.click({action:'exam-next'});await flush();
 const s=snapshot(h).session;assert.equal(s.index,s.questions.length-1);
 assert.equal((h.host.innerHTML.match(/data-review-question=/g)||[]).length,s.questions.length);
 assert.match(h.host.innerHTML,/First saved response/);assert.match(h.host.innerHTML,/Second saved response/);assert.match(h.host.innerHTML,/Correct answer/);assert.match(h.host.innerHTML,/Correct highlights/);assert.match(h.host.innerHTML,/Correct order/);
 complete=true;await h.click({action:'retry-swt',reviewUid:s.questions[0].uid});
 assert.equal(calls.at(-1),s.questions[0].passageId);assert.equal(snapshot(h).session.assessments[s.questions[0].uid].status,'complete');
 await h.click({action:'retry-all-swt'});assert.equal(snapshot(h).history[0].pending,0);assert.equal(calls.length,4);assert.match(h.host.innerHTML,/Your main idea is accurate/);
});

test('Review audio is selected by question identity and cannot change an excluded submitted result',async()=>{
 const {h,audio}=await mixedClient(true);while(!snapshot(h).session.done)h.click({action:'exam-next'});
 const before=snapshot(h),q=before.session.questions.find(q=>q.type==='hcs');
 h.click({action:'play',reviewUid:q.uid});assert.equal(audio.utterances.at(-1).text,q.audioText);
 audio.utterances.at(-1).onstart();audio.utterances.at(-1).onend();
 const after=snapshot(h);assert.deepEqual(after.session.audioStates,before.session.audioStates);assert.equal(after.history[0].excluded,before.history[0].excluded);
});

test('The complete review escapes student and model content and exposes feedback without collapsed questions',()=>{
 const review=require('../public/reading-review');
 const q={uid:'swt:1',type:'swt',passage:'<script>bad()</script>',sampleResponse:'A useful example.'};
 const result={...confirmedGrade,content_details:{notes:'<img src=x onerror=bad()>'},grammar_details:{grammar_annotations:[{phrase:'bad <word>',fix:'better',rationale:'Use a clear phrase.'}]}};
 const html=review.question(q,['<svg onload=bad()>'],{result},null,{earned:8,possible:9},0,2,'SWT');
 assert.doesNotMatch(html,/<script>|<img src=x|<svg|<details|data-question=/);assert.match(html,/&lt;svg/);assert.match(html,/A useful example/);assert.match(html,/Optional refinement/);
});
