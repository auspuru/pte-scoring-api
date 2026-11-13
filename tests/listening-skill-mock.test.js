'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const papers=require('../listening-mock/papers'),session=require('../full-mock/session'),assessment=require('../full-mock/assessment'),adapters=require('../full-mock/adapters'),aggregation=require('../full-mock/aggregation'),reports=require('../full-mock/report');
const {digest}=require('../full-mock/paper'),{fixture}=require('./helpers/auth-server');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
test('All Listening papers retain their original fifteen questions and add the complete oral contribution block',()=>{
 const legacy=require('../content/listening-mocks').mocks;
 for(const paper of papers.registeredPapers()){
  assert.equal(paper.questions.length,34);assert.equal(paper.skipIntroduction,true);assert.equal(paper.questions[0].question.type,'rs');
  const old=legacy.find(p=>p.id===paper.id);
  assert.deepEqual(paper.questions.slice(19).map(c=>c.question.sourceQuestionId),old.questions.map(q=>q.id));
  for(const [i,q]of old.questions.entries())for(const key of ['text','passage','choices','answer','answers','sample','keyPoints'])if(q[key]!==undefined)assert.deepEqual(paper.questions[19+i].question[key],q[key]);
  assert.deepEqual(paper.questions.reduce((counts,c)=>(counts[c.question.type]=(counts[c.question.type]||0)+1,counts),{}),papers.COUNTS);
  const state=session.create(crypto.randomUUID(),paper,1000,{sectionTransitions:true}),view=session.present(state,paper,1000);
  assert.equal(view.scoredQuestionCount,34);assert.equal(view.completedCount,0);assert.equal(view.index,1);assert.equal(view.transition.partCount,2);assert(!view.transition.details.join(' ').includes('unscored'));
  session.beginSection(state,paper,state.transition.id,2000);assert.equal(state.responses[1].type,'rs');assert.equal(state.current.enteredAt,2000);
 }
});
test('Listening recordings have immutable matching bytes and valid neural audio',()=>{
 const checked=new Set();
 for(const paper of papers.registeredPapers())for(const candidate of paper.questions){
  const a=candidate.audio.entry;if(checked.has(a.audioSha256))continue;checked.add(a.audioSha256);
  const bytes=fs.readFileSync(path.join(__dirname,'..',candidate.audio.path));assert.equal(hash(bytes),a.audioSha256);assert.equal(bytes.length,a.bytes);
  assert.equal(require('../scripts/validate-writing-audio').inspectMp3(bytes).valid,true);
  assert(a.voice?.includes('Neural')||a.voices?.every(v=>v.includes('Neural')||/p\d+|ljspeech/.test(v))||/neural|piper/i.test(a.generator||''));
 }
});
function completed(paper){
 const snapshot=assessment.snapshot(assessment.claudeConfiguration(),undefined,paper),state=session.create(crypto.randomUUID(),paper,1000,{assessmentSnapshot:snapshot});
 state.status='submitted';state.submittedAt=2000;state.current=null;
 paper.questions.forEach((candidate,index)=>{
  const response={type:candidate.question.type,answer:['synthetic response'],draft:['synthetic response'],segments:[],sealed:true,status:'saved',reason:'next'};
  state.responses[index+1]=response;
  const maxima=adapters.maxima(candidate.question),total=Object.values(maxima).reduce((n,v)=>n+v,0);
  state.assessment.items[candidate.id]={status:'assessed',inputHash:aggregation.inputHash(response),snapshotHash:state.assessment.snapshotHash,result:{status:'assessed',version:adapters.VERSION,type:candidate.question.type,scores:{...maxima},maxima,total,maximum:total},stages:{}};
 });state.assessment.status='complete';return state;
}
test('Listening reports use the existing Listening profile and hold every missing assessment',()=>{
 const paper=papers.registeredPapers()[0],state=completed(paper),result=aggregation.aggregate(paper,state);
 assert.equal(result.ready,true);assert.equal(result.expectedCount,34);assert.equal(result.assessedCount,34);assert.deepEqual(Object.keys(result.profiles),['listening']);assert.equal(result.profiles.listening.practiceIndex,90);
 const report=reports.buildReport(paper,state,3000);assert.equal(report.items.length,34);assert.equal(report.groups.length,12);assert.equal(report.module,'listening');assert.equal(report.items[0].questionCount,34);
 assert(report.groups.every(g=>g.skills.length===1&&g.skills[0]==='listening'));
 const missing=paper.questions.find(c=>c.question.type==='sst');delete state.assessment.items[missing.id];
 const held=aggregation.aggregate(paper,state);assert.equal(held.ready,false);assert.equal(held.profiles.listening.practiceIndex,null);assert.equal(held.assessedCount,33);
 state.responses[1].answer=['changed'];assert.equal(aggregation.aggregate(paper,state).assessedCount,32);
 state.paperHash='0'.repeat(64);assert.throws(()=>aggregation.aggregate(paper,state),{status:503});
});
test('New Listening starts expose all three papers and retain separate readable earlier attempts',{timeout:30000},async t=>{
 const f=await fixture(t),created=(await f.request('/api/auth/register',{username:'listening-student',password:'Listening-pass-123',email:'listening-student@example.test'})).body;
 const token=created.token,catalog=await f.request('/api/listening-mocks/catalog',undefined,token);
 assert.equal(catalog.status,200);assert.equal(catalog.body.papers.length,3);assert(catalog.body.papers.every(p=>p.questionCount===34&&p.taskTypeCount===12));
 assert.equal((await f.request('/api/listening-mocks/attempts')).status,401);
 const lab=await f.request('/api/writing-lab/catalog');assert(lab.body.listeningMocks.every(p=>p.questionCount===34));
 const old=await f.request('/api/writing-lab/attempts',{id:crypto.randomUUID(),testId:'listening-mock-1'},token);assert.equal(old.status,200);assert.equal(old.body.questions.length,15);
 for(const paper of catalog.body.papers){
  const id=crypto.randomUUID(),start=await f.request('/api/listening-mocks/attempts',{id,paperId:paper.id,checks:{microphone:true,playback:true}},token);
  assert.equal(start.status,200);assert.equal(start.body.id,id);assert.equal(start.body.scoredQuestionCount,34);assert.equal(start.body.index,1);assert.equal(start.body.transition.title,'Speaking tasks');
 }
 const legacy=await f.request('/api/listening-mocks/legacy-attempts',undefined,token);assert.equal(legacy.body.length,1);assert.equal(legacy.body[0].questionCount,15);
 assert.equal((await f.request('/api/full-mocks/attempts',undefined,token)).body.length,0);
 const current=(await f.request('/api/listening-mocks/attempts',undefined,token)).body;assert.equal(current.length,3);assert(current.every(a=>a.expectedCount===34));
});
