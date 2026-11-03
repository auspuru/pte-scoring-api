'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {loadPaper}=require('../full-mock/paper'),session=require('../full-mock/session');
for(const id of ['full-mock-1','full-mock-2','full-mock-3'])test(id+': section introductions persist without consuming clocks; each new section starts once',()=>{
 const paper=loadPaper(id),state=session.create(randomUUID(),paper,1000,{preview:true,sectionTransitions:true});
 const start=(at)=>{const token=state.transition.id;session.beginSection(state,paper,token,at);const before=structuredClone(state.current);session.beginSection(state,paper,token,at+5000);assert.deepEqual(state.current,before);return token;};
 const until=type=>{while(session.item(paper,state.index).question.type!==type){assert(!state.transition);session.next(state,paper,{itemToken:state.current.token,skip:true},100000);}};
 const initial=structuredClone(state);session.reconcile(state,paper,100000000);assert.deepEqual(state,initial);assert.equal(state.current,null);assert.equal(state.responses.length,0);
 const view=session.present(state,paper,100000000);assert.equal(view.transition.part,1);assert.equal(view.question,undefined);assert.equal(view.current,undefined);
 assert.throws(()=>session.next(state,paper,{itemToken:randomUUID()},1000));assert.throws(()=>session.beginSection(state,paper,randomUUID(),1000),{status:409});
 start(2000);assert.equal(state.current.enteredAt,2000);assert.equal(state.current.responseAt-state.current.enteredAt,25300);
 until('swt');const swt1=state.current;assert.equal(swt1.endsAt-swt1.enteredAt,600000);
 session.next(state,paper,{itemToken:swt1.token},150000);assert.equal(state.current.endsAt,750000);assert.equal(session.item(paper,state.index).question.type,'swt');
 session.next(state,paper,{itemToken:state.current.token},160000);assert.equal(state.current.endsAt,1360000);assert.equal(session.item(paper,state.index).question.type,'essay');
 session.next(state,paper,{itemToken:state.current.token},170000);assert.equal(state.transition.section,'reading');assert.equal(state.clocks.reading,undefined);
 session.reconcile(state,paper,90000000);assert.equal(state.current,null);start(90000000);const deadline=state.current.endsAt;assert.equal(deadline,90000000+paper.clockPolicy.readingSeconds*1000);
 session.next(state,paper,{itemToken:state.current.token},90010000);assert.equal(state.current.endsAt,deadline);
 session.reconcile(state,paper,deadline+999999);assert.equal(state.transition.section,'listening');assert.equal(state.clocks.listening,undefined);assert.equal(state.responses.length,state.index);
 start(deadline+1000000);assert.equal(session.item(paper,state.index).question.type,'sst');assert.equal(state.current.endsAt-state.current.enteredAt,600000);
 session.next(state,paper,{itemToken:state.current.token},deadline+1001000);const listeningDeadline=state.current.endsAt;assert.equal(listeningDeadline,deadline+1001000+paper.clockPolicy.listeningAfterSstSeconds*1000);
 session.next(state,paper,{itemToken:state.current.token},deadline+1002000);assert.equal(state.current.endsAt,listeningDeadline);
 session.end(state,paper,listeningDeadline);assert.equal(state.status,'submitted');assert.equal(state.responses.length,66);assert(state.responses.every(r=>r.sealed));
});
test('Legacy saved attempts keep their existing clocks and early finish can close an introduction screen',()=>{
 const paper=loadPaper(),legacy=session.create(randomUUID(),paper,1000,{preview:true});assert(legacy.current.endsAt);session.reconcile(legacy,paper,100000000);assert.equal(legacy.status,'submitted');
 const fresh=session.create(randomUUID(),paper,1000,{preview:true,sectionTransitions:true});session.end(fresh,paper,2000);assert.equal(fresh.status,'submitted');assert.equal(fresh.responses.length,66);
});

for(const id of ['full-mock-1','full-mock-2','full-mock-3'])test(id+': preparation and playback countdowns precede every applicable response',()=>{
 const paper=loadPaper(id),state=session.create(randomUUID(),paper,1000,{preview:true});
 const expected={ra:35,rs:0,di:25,rl:10,asq:0,sgd:10,rts:10};
 while(state.status==='active'){
  const item=session.item(paper,state.index),q=item.question,current=state.current;
  if(Object.hasOwn(expected,q.type)){
   assert.equal(q.preparation,expected[q.type]);
   assert.equal(current.responseAt-current.promptEndsAt,q.preparation*1000+(q.startCueMs||0));
   if(q.preparation)assert.equal(session.phase(state,current.responseAt-(q.startCueMs||0)-1),'preparing');
   assert.equal(session.phase(state,current.responseAt),'recording');
  }
  if(item.audio){assert.equal(current.promptAt-current.enteredAt,q.playbackDelaySeconds*1000);assert.equal(session.phase(state,current.promptAt-1),'instructions');}
  session.next(state,paper,{itemToken:current.token,skip:true},1000);
 }
});
