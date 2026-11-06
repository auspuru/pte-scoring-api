'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),path=require('node:path'),fs=require('node:fs/promises');
const puppeteer=require('puppeteer'),{mocks}=require('../content/listening-mocks'),scoring=require('../listening-scoring');
const root=path.resolve(__dirname,'..');
const summary='The lecture explains that quiet learning spaces help students concentrate, but silence alone is insufficient. Designers should consider background noise, flexible furniture and access to natural light. Students also needs areas for collaboration as well as individual study. Evaluating how people use these spaces can guide practical improvements and support different learning activities.';
const native={version:'saved-sst-fixture',scores:{form:2,content:2,grammar:1,spelling:0,vocabulary:2},maxima:{form:2,content:4,grammar:2,spelling:2,vocabulary:2},total:7,maximum:12,gated:false,reasons:[],feedback:{form:'The summary meets the word limit.',content:'Explain how the design choices support different learning activities.',grammar:'Use the plural verb with students.',spelling:'Check the spelling of the two highlighted words. <script>throw Error("unsafe feedback")</script>',vocabulary:'The vocabulary is appropriate for the lecture.'},strengths:['The main topic is recognised.'],improvements:['Connect the design choices to the learning outcomes.'],errors:[{phrase:'Students also needs',correction:'Students also need',explanation:'Students takes the plural verb need.'}]};
async function fixture(t,width,admin){
 const app=express(),paper=structuredClone(mocks[0]),attempts=new Map(),requests=[],posts=[];
 const answers=paper.questions.map(q=>scoring.TYPES.has(q.type)?JSON.stringify(q.answers||[q.answer]):q.sample);
 // Retain awkward whitespace exactly as it can occur in a historic saved answer.
 answers[0]=summary+'\n'.repeat(150)+'End of saved summary.';
 const results=paper.questions.map((q,i)=>q.type==='sst'?structuredClone(native):q.type==='wfd'?{scores:{content:q.text.split(/\s+/).length},maxima:{content:q.text.split(/\s+/).length},total:q.text.split(/\s+/).length,maximum:q.text.split(/\s+/).length,feedback:{content:'Saved dictation feedback.'},reasons:[]}:scoring.grade(q,answers[i]));
 const saved={id:'earlier-listening-feedback',testId:paper.id,kind:'mock',module:'listening',title:paper.title,status:'submitted',startedAt:Date.parse('2026-10-01T10:00:00Z'),index:paper.questions.length-1,questions:paper.questions.map(q=>({...q,audioUrl:'/fixture.mp3'})),answers,results,completed:paper.questions.map(()=>({reason:'Submitted'})),playback:paper.questions.map(()=>null),deadline:null};
 attempts.set(saved.id,saved);const before=JSON.stringify(saved),token=admin?'synthetic-admin-view':'synthetic-student-session';
 app.use('/api/writing-lab',(req,res,next)=>{requests.push({path:req.path,token:req.headers['x-session-token']});if(req.method==='POST')posts.push(req.path);if(req.headers['x-session-token']!==token)return res.sendStatus(401);next();});
 app.get('/api/writing-lab/catalog',(_,res)=>res.json({mocks:[],listeningMocks:[paper],spoken:[],dictation:[],listeningPractice:[]}));
 app.get('/api/writing-lab/session',(_,res)=>res.json({username:'synthetic-feedback-student'}));
 app.get('/api/writing-lab/attempts',(_,res)=>res.json([{...saved,questions:paper.questions.length}]));
 app.get('/api/writing-lab/attempts/:id',(req,res)=>{const a=attempts.get(req.params.id);if(!a)return res.sendStatus(404);res.json({...a,serverNow:Date.now()});});
 app.post('/api/writing-lab/*',(_,res)=>res.status(409).json({error:'Review must not reassess or change saved responses.'}));
 app.get('/fixture.mp3',(_,res)=>res.sendFile(path.join(root,'content/speaking-audio/rs-1.mp3')));
 app.get('/',(_,res)=>res.type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/writing-lab-portal.css"><link rel="stylesheet" href="/exam-results.css"><link rel="stylesheet" href="/listening-mocks.css"><link rel="stylesheet" href="/practice-studio.css"><link rel="stylesheet" href="/listening-studio.css"><link rel="stylesheet" href="/portal-calm.css"><link rel="stylesheet" href="/mock-report-ui.css"></head><body><section id="writingLabScreen"><main id="lab" tabindex="-1"></main><div id="notice" role="status"></div></section><script>sessionStorage.setItem('pte_session_token','${admin?'synthetic-staff-session':token}');${admin?`sessionStorage.setItem('pte_impersonate_token','${token}');`:''}</script><script src="/practice-catalogue.js"></script><script src="/practice-studio.js"></script><script src="/listening-studio.js"></script><script src="/listening-tasks.js"></script><script src="/writing-lab-report.js"></script><script src="/mock-impact-feedback.js"></script><script src="/mock-report-ui.js"></script><script src="/writing-lab-client.js"></script><script>WritingLab.open({attemptId:'${saved.id}',tab:'mocks',module:'listening',requestId:'saved-listening-feedback'});</script></body></html>`));
 app.use(express.static(path.join(root,'public')));const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const browser=await puppeteer.launch({headless:true,executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH||'/usr/bin/chromium'});t.after(()=>browser.close());
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width,height:900});await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('.ipt-mock-report');
 return {page,saved,before,posts,requests,errors,token};
}
for(const width of [1363,390,320])for(const admin of [false,true])test('Saved SST feedback is visible without expanding details for '+(admin?'admin view':'student')+' at '+width+'px',{timeout:45000},async t=>{
 const f=await fixture(t,width,admin),{page}=f;
 await page.click('[data-mock-tab="answers"]');await page.click('[data-mock-filter="sst"]');
 await page.waitForSelector('#review-0 .sst-mock-feedback',{visible:true,timeout:3000});
 const feedback=await page.$eval('#review-0 .sst-mock-feedback',e=>({text:e.innerText,collapsed:!!e.closest('details:not([open])'),overflow:e.scrollWidth>e.clientWidth+1,heading:e.querySelector('h3')?.textContent}));
 assert.match(feedback.heading,/Spoken Text feedback/);assert.match(feedback.text,/design choices support/);assert.match(feedback.text,/Use the plural verb/);assert.match(feedback.text,/spelling of the two highlighted words/);assert.match(feedback.text,/Students also need/);assert.equal(feedback.collapsed,false);assert.equal(feedback.overflow,false);
 assert.equal(await page.$('#review-0 .sst-mock-feedback script'),null);
 const answer=await page.$eval('#review-0 .sst-saved-summary',e=>({text:e.textContent,height:e.clientHeight,scrollHeight:e.scrollHeight,tabIndex:e.tabIndex,afterFeedback:!!(document.querySelector('#review-0 .sst-mock-feedback').compareDocumentPosition(e)&Node.DOCUMENT_POSITION_FOLLOWING)}));
 assert.equal(answer.text,f.saved.answers[0]);assert(answer.height<=340);assert(answer.scrollHeight>answer.height);assert.equal(answer.tabIndex,0);assert(answer.afterFeedback);
 await fs.mkdir(path.join(root,'.cache'),{recursive:true});await page.$eval('#review-0',e=>e.scrollIntoView({block:'start',behavior:'instant'}));await page.screenshot({path:path.join(root,'.cache','sst-listening-answers-'+width+'-'+(admin?'admin':'student')+'.png')});
 await page.focus('#review-0 .sst-saved-summary');await page.keyboard.press('End');await page.waitForFunction(()=>document.querySelector('#review-0 .sst-saved-summary').scrollTop>0,{timeout:2000});
 await page.click('[data-mock-tab="feedback"]');await page.waitForSelector('[data-mock-panel="feedback"] .sst-mock-feedback',{visible:true});
 assert.match(await page.$eval('[data-mock-panel="feedback"] .sst-mock-feedback',e=>e.innerText),/Use the plural verb/);
 assert.equal(await page.$$eval('[id]',nodes=>{const ids=nodes.map(e=>e.id);return ids.length===new Set(ids).size;}),true);
 await fs.mkdir(path.join(root,'.cache'),{recursive:true});await page.$eval('[data-mock-panel="feedback"] .sst-mock-feedback',e=>e.scrollIntoView({block:'start',behavior:'instant'}));await page.screenshot({path:path.join(root,'.cache','sst-listening-feedback-'+width+'-'+(admin?'admin':'student')+'.png')});
 assert.equal(JSON.stringify(f.saved),f.before);assert.deepEqual(f.posts,[]);assert.deepEqual(f.errors,[]);assert(f.requests.every(r=>r.token===f.token));
});

test('Saved SST pending, valid-zero and legacy feedback remain truthful without a new assessment',{timeout:45000},async t=>{
 const f=await fixture(t,390,true),{page}=f;
 const cases=[
  {result:null,pending:true},
  {result:{...structuredClone(native),score_provisional:true},pending:true},
  {result:{...structuredClone(native),scores:{form:0,content:0,grammar:0,spelling:0,vocabulary:0},total:0,gated:true,reasons:['Use 50–70 words for full Form marks.'],feedback:{form:'The saved summary does not meet the word limit.'},strengths:[],improvements:[],errors:[]},note:/does not meet the word limit/},
  {result:{...structuredClone(native),feedback:null,strengths:undefined,improvements:undefined,errors:undefined},note:/No detailed feedback was saved/}
 ];
 for(const value of cases){
  f.saved.results[0]=value.result;const before=JSON.stringify(f.saved);await page.reload();await page.waitForSelector('.ipt-mock-report');await page.click('[data-mock-tab="feedback"]');await page.waitForSelector('[data-mock-panel="feedback"] .sst-mock-feedback',{visible:true});
  const text=await page.$eval('[data-mock-panel="feedback"] .sst-mock-feedback',e=>e.innerText);
  if(value.pending){assert.match(text,/still being prepared/);assert.equal(await page.$('[data-mock-panel="feedback"] .sst-mock-criteria'),null);assert.doesNotMatch(text,/plural verb/);}
  else assert.match(text,value.note);
  assert.equal(JSON.stringify(f.saved),before);
 }
 assert.deepEqual(f.posts,[]);assert.deepEqual(f.errors,[]);
});
