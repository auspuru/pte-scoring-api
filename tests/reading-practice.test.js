'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {score,diagnostic,report,remaining,storageKey}=require('../public/reading-practice');
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
 const ctx={currentUserId:'first',document:{getElementById:()=>host,hidden:false},localStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},fetch:async()=>({ok:true,json:async()=>bank}),AbortSignal,Date,setInterval:fn=>{timers.push(fn);return timers.length;},clearInterval(){},confirm:()=>true};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../public/reading-practice'),'utf8'),ctx);
 const click=dataset=>host.onclick({target:{closest:()=>({dataset,disabled:false})}});
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
