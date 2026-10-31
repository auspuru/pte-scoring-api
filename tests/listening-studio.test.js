'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const express=require('express'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {installWritingLab,present,reconcile}=require('../writing-lab');
const studio=require('../public/listening-studio'),ui=require('../public/listening-tasks');
const {mocks}=require('../content/listening-mocks');
const {routes}=require('../public/portal-workspace');

test('Listening workspace lists all eight task routes and keeps earlier HCS/HIW banks available',()=>{
 assert.equal(studio.tasks.length,8);assert.equal(new Set(studio.tasks.map(t=>t[0])).size,8);
 for(const [type,,,route]of studio.tasks){assert.equal(routes[route].pane,'writingLabScreen');assert.equal(routes[route].labTab,type);}
 assert.equal(routes['listening-hcs-bank'].readingLibrary,'hcs');assert.equal(routes['listening-hiw-bank'].readingLibrary,'hiw');
 const html=studio.wrap('<p>Question</p>',{type:'lfi',items:[]});assert.match(html,/aria-label="Listening tasks"/);assert.match(html,/data-listening-mode="practice" aria-pressed="true"/);
 const mock=studio.wrap('<p>Mock</p>',{type:'sst',mock:true});assert.doesNotMatch(mock,/data-listening-type|data-listening-mode|studio-search/);
});
test('Search and status filters preserve question numbers, current state and escaped values',()=>{
 const items=[{id:'one'},{id:'two'},{id:'<unsafe>'}],history=[{testId:'two',mode:'practice',status:'submitted',startedAt:4}];
 assert.match(studio.rows({items,history,filter:'done'}),/Question 2/);assert.doesNotMatch(studio.rows({items,history,filter:'done'}),/Question 1/);
 assert.match(studio.rows({items,bookmarks:['<unsafe>'],filter:'bookmarked'}),/data-listening-open="&lt;unsafe&gt;"/);
 assert.doesNotMatch(studio.rows({items,search:'2'}),/Question 1/);assert.match(studio.rows({items,search:'99'}),/No questions match/);
});
test('Listening tools collapse while the current response stays visible and the library never duplicates its list',()=>{
 const content='<textarea id="answer">Saved response</textarea><button id="submit">Submit</button>';
 const html=studio.wrap(content,{type:'sst',activeId:'one',items:[{id:'one'}],search:'"<&'});
 const panels=[...html.matchAll(/<details\b[^>]*>[\s\S]*?<\/details>/g)].map(m=>m[0]);
 assert.equal(panels.length,3);assert(panels.every(p=>!/<details[^>]*\bopen\b/.test(p)));
 const main=panels.reduce((remaining,p)=>remaining.replace(p,''),html);
 assert(main.includes(content));assert.match(html,/id="studio-search"[^>]*value="&quot;&lt;&amp;"/);
 assert.match(studio.wrap(content,{type:'sst',activeId:'one',items:[{id:'one'}]}),/data-listening-open="one"/);
 const library=studio.wrap('<p>Question choices</p>',{type:'sst',library:true,items:[{id:'one'}]});
 assert.doesNotMatch(library,/studio-search|data-listening-open=/);
 const mock=studio.wrap(content,{type:'sst',mock:true});
 assert(mock.includes(content));assert.doesNotMatch(mock,/studio-focused|studio-task-switcher|studio-side|data-portal=/);
});
test('Objective review differentiates missed answers, wrong selections and spelling without changing marks',()=>{
 const all=mocks[0].questions,lfi=all.find(q=>q.type==='lfi'),hiw=all.find(q=>q.type==='hiw'),multi=all.find(q=>q.type==='lmcma');
 assert.match(ui.review(lfi,JSON.stringify(['<script>'])),/Check spelling/);assert.doesNotMatch(ui.review(lfi,JSON.stringify(['<script>'])),/<script>/);
 assert.match(ui.review(hiw,'[]'),/Missed mismatch/);assert.match(ui.review(hiw,'[0]'),/Unnecessary selection/);
 assert.match(ui.review(multi,'[0]'),/Incorrect selection/);assert.match(ui.review(multi,'[]'),/Correct answer · not selected/);
 const diff=ui.wordDiff('Students submit proposals','Students submitted proposal');assert.match(diff,/class="missing"/);assert.match(diff,/class="extra"/);
});
test('Untimed practice never expires while timed and legacy attempts retain server deadlines',()=>{
 const q=mocks[0].questions[1];const base={questions:[q],index:0,status:'active',completed:[null],deadline:null,mode:'practice'};
 assert.equal(reconcile(structuredClone(base),Number.MAX_SAFE_INTEGER).status,'active');
 assert.equal(reconcile({...structuredClone(base),deadline:10,mode:'exam'},11).status,'submitted');
 const a=present({...base,answers:['[]'],results:[null]});assert.equal(a.questions[0].answer,undefined);assert.equal(a.questions[0].text,'');
});
test('Individual listening API supports all six objective types, saves mode/playback and keeps answer keys private',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'listening-studio-'));const app=express();app.use(express.json());let modelCalls=0;
 const {store}=installWritingLab(app,{directory,verifyToken:key=>key==='tester'?'tester':key==='other'?'other':null,getAccount:async()=>({}),callModel:async()=>{modelCalls++;throw Error('No model should run');}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{await new Promise(r=>server.close(r));await fs.rm(directory,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port+'/api/writing-lab';
 async function request(url,body,expected=200,token='tester'){const r=await fetch(base+url,{headers:{'Content-Type':'application/json','x-session-token':token},...(body?{method:'POST',body:JSON.stringify(body)}:{})});assert.equal(r.status,expected,url);return r.json();}
 const catalog=await request('/catalog');assert.equal(catalog.listeningPractice.length,33);assert.equal(new Set(catalog.listeningPractice.map(q=>q.type)).size,6);assert(catalog.listeningPractice.every(q=>!q.answers&&!q.text&&!q.passage));
 for(const type of ['lmcma','lfi','hcs','lmcsa','smw','hiw']){
  const item=catalog.listeningPractice.find(q=>q.type===type),source=mocks.flatMap(m=>m.questions).find(q=>q.id===item.id),id=randomUUID();
  let a=await request('/attempts',{id,testId:item.id,mode:'practice'});assert.equal(a.kind,type);assert.equal(a.mode,'practice');assert.equal(a.deadline,null);assert.equal(a.questions[0].answers,undefined);
  a=await request('/attempts/'+id+'/begin',{});assert.equal(a.status,'active');assert.equal(a.deadline,null);
  a=await request('/attempts/'+id+'/answer',{index:0,text:JSON.stringify(source.answers||[source.answer]),revision:1,next:true,playback:{position:25,finished:true,plays:2}});assert.equal(a.status,'submitted');assert.equal(a.playback[0].plays,2);assert(a.questions[0].answer!==undefined||a.questions[0].answers);
  const score=await request('/attempts/'+id+'/score/0',{});assert.equal(score.total,score.maximum);
  await request('/attempts/'+id,undefined,404,'other');
 }
 const rows=await request('/attempts');assert(rows.every(a=>a.mode==='practice'&&a.supported&&a.playCount===2));assert.equal(modelCalls,0);
 const id=randomUUID(),item=catalog.listeningPractice[0];let exam=await request('/attempts',{id,testId:item.id,mode:'exam'});exam=await request('/attempts/'+id+'/begin',{});assert(exam.deadline>exam.serverNow);assert.equal(exam.mode,'exam');
 const mock=await request('/attempts',{id:randomUUID(),testId:'listening-mock-1',mode:'practice'});assert.equal(mock.kind,'mock');assert.equal(mock.mode,'exam');assert(mock.deadline>mock.serverNow);
 await request('/attempts',{id:randomUUID(),testId:item.id,mode:'invalid'},400);
 await request('/attempts/'+id+'/answer',{index:0,text:'[]',revision:1,playback:{position:0,finished:false,plays:-1}},400);
 assert.equal((await store.list('tester')).length,8);
});

test('NAV-07: Listening badges and filters use the selected mode, including legacy timed attempts',()=>{
 const items=[{id:'8'},{id:'18'},{id:'28'}],history=[
  {id:'exam8',testId:'8',status:'submitted',mode:'exam',startedAt:'2026-10-31T00:00:00Z'},
  {id:'practice18',testId:'18',status:'submitted',mode:'practice',startedAt:20},
  {id:'legacy28',testId:'28',status:'submitted',startedAt:30}];
 assert.deepEqual(studio.visibleQuestions({items,history,mode:'practice',filter:'done'}).map(r=>r.q.id),['18']);
 assert.deepEqual(studio.visibleQuestions({items,history,mode:'exam',filter:'done'}).map(r=>r.q.id),['8','28']);
 assert.deepEqual(studio.visibleQuestions({items,history,mode:'practice',filter:'new'}).map(r=>r.q.id),['8','28']);
 assert.equal(studio.latest(history,'8','practice'),undefined);
 assert.equal(studio.latest(history,'28','exam').id,'legacy28');
 assert.match(studio.rows({items,history,mode:'practice',search:'28'}),/Question 3/);
});
