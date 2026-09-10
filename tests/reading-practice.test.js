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
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../public/reading-mock-tools'),'utf8'),ctx);vm.runInContext(fs.readFileSync(require.resolve('../public/reading-practice'),'utf8'),ctx);
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
const confirmedGrade={raw_score:8,max_raw_score:9,trait_scores:{content:3,form:1,grammar:2,vocabulary:2}};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('Full mixed mock adds SWT and highlight tasks; two fixed sectionals contain reading only',()=>{
 for(const set of bank.sets){
  const full=compose(bank,'full',set.id,swtPassage);
  assert.equal(full.minutes,45);assert.equal(full.questions.length,set.questions.length+5);
  assert.equal(full.questions.filter(q=>q.type==='swt').length,1);
  assert.equal(full.questions.filter(q=>q.type==='hcs').length,2);
  assert.equal(full.questions.filter(q=>q.type==='hiw').length,2);
  assert.equal(new Set(full.questions.map(q=>q.uid)).size,full.questions.length);
 }
 const sections=bank.sectionalMocks.map(m=>compose(bank,m.id,'v3'));
 assert.deepEqual(sections.map(s=>s.questions.length),[16,15]);
 assert(sections.every(s=>s.minutes===25&&s.questions.every(q=>!['swt','hcs','hiw'].includes(q.type))));
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
 const questions=compose(bank,'full','v1',swtPassage).questions;
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
 const h=client();h.ctx.passages=[swtPassage];let calls=0;
 h.ctx.requestSwtGrade=async payload=>{calls++;assert.equal(payload.passageId,901);assert.equal(payload.userId,'first');if(calls===1)throw Error('Temporarily unavailable');return confirmedGrade;};
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
 const h=client();h.ctx.passages=[swtPassage];let resolve,calls=0;
 h.ctx.requestSwtGrade=()=>{calls++;return new Promise(r=>resolve=r);};
 await h.ctx.ReadingPractice.open();await h.click({start:'full'});h.host.oninput({target:{dataset:{swtResponse:''},value:'A saved summary for assessment.'}});h.click({action:'submit'});
 h.click({action:'home'});h.click({history:'0'});await h.click({action:'retry-swt'});assert.equal(calls,1);
 h.click({action:'home'});await h.click({start:'sectional-1'});resolve(confirmedGrade);await flush();
 const saved=JSON.parse(h.values.get(storageKey('first')));assert.equal(saved.session.mode,'sectional-1');assert.equal(saved.session.done,false);assert.equal(saved.history.length,1);assert.equal(saved.history[0].pending,0);
});
test('A SWT grade arriving after an account switch cannot write to either account',async()=>{
 const h=client();h.ctx.passages=[swtPassage];let resolve;
 h.ctx.requestSwtGrade=()=>new Promise(r=>resolve=r);
 await h.ctx.ReadingPractice.open();await h.click({start:'full'});h.host.oninput({target:{dataset:{swtResponse:''},value:'A saved summary for assessment.'}});h.click({action:'submit'});
 const first=h.values.get(storageKey('first'));h.ctx.currentUserId='second';await h.ctx.ReadingPractice.open();const second=h.values.get(storageKey('second'));
 resolve(confirmedGrade);await flush();assert.equal(h.values.get(storageKey('first')),first);assert.equal(h.values.get(storageKey('second')),second);assert.doesNotMatch(h.host.innerHTML,/8\/9/);
});
test('HIW selection stays interactive during audio; leaving interrupts playback and reopening retains the answer',async()=>{
 const h=client(),audio=speechHarness();Object.assign(h.ctx,audio.env);h.ctx.passages=[swtPassage];
 await h.ctx.ReadingPractice.open();await h.click({start:'full'});
 const saved=()=>JSON.parse(h.values.get(storageKey('first'))),index=saved().session.questions.findIndex(q=>q.type==='hiw');
 h.click({question:String(index)});h.click({action:'play'});const utterance=audio.utterances[0];utterance.onstart();
 const html=h.host.innerHTML;h.click({hiwWord:'4'});assert.equal(h.host.innerHTML,html);
 const q=saved().session.questions[index];assert.deepEqual(saved().session.answers[q.uid],[4]);
 h.ctx.ReadingPractice.leave();assert.equal(saved().session.audioStates[q.uid].status,'error');utterance.onend();assert.equal(saved().session.audioStates[q.uid].status,'error');
 await h.ctx.ReadingPractice.open();assert.match(h.host.innerHTML,/data-hiw-word="4"[^>]*aria-pressed="true"/);
 h.click({action:'play'});audio.utterances[1].onstart();audio.utterances[1].onend();h.click({action:'play'});assert.equal(audio.utterances.length,2);
 h.click({action:'submit'});assert.equal(saved().session.audioStates[q.uid].status,'complete');
});
