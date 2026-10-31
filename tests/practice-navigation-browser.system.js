'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),path=require('node:path');
const puppeteer=require('puppeteer');
const root=path.resolve(__dirname,'..');
const {fixture:authFixture}=require('./helpers/auth-server');
for(const width of [1363,390])test('Progress opens exact saved responses and Next Steps launches stable SWT questions and resources at '+width+'px',{timeout:90000},async t=>{
 const f=await authFixture(t),username='progress-browser';
 const registration=await f.request('/api/auth/register',{username,password:'Synthetic-pass-123',email:'progress@example.test'});
 assert.equal(registration.body.success,true);
 const passages=(await f.request('/api/passages')).body;
 const passage=(Array.isArray(passages)?passages:passages.passages)[0];
 const older={text:'Older saved summary response for exact historical feedback.',timestamp:'2026-10-01T10:00:00.000Z',overall_score:65,trait_scores:{content:2,form:1,grammar:2,vocabulary:2},content_details:{},feedback:'Older saved feedback'};
 const latest={...older,text:'Latest saved summary response must not replace the older response.',timestamp:'2026-10-03T10:00:00.000Z',overall_score:80};
 const history={[passage.id]:[latest,older]};
 const synced=await f.request('/api/sync/'+username,{history,scores:{[passage.id]:{...latest,__text:latest.text,__timestamp:latest.timestamp}},practiceHistory:[{id:'saved-essay',date:Date.parse('2026-10-02T10:00:00.000Z'),questionTitle:'Saved essay question',questionText:'Discuss the topic.',essayText:'The exact saved essay response.',wordCount:220,scores:{total:20}}]},registration.body.token);
 assert.equal(synced.body.success,true);
 const assigned=await f.request('/api/admin/interventions/'+username,{title:'SWT navigation plan',items:[{id:'assigned-swt',kind:'question',title:'Assigned SWT',engine:'swt',route:'swt',questionId:String(passage.id),requireNewAttempt:true},{id:'lesson',kind:'video',title:'SWT resource',url:f.base+'/fixture-resource'}]},null,true);
 assert.equal(assigned.status,200);
 await f.request('/api/interventions/'+assigned.body.plan.id+'/notification-read',{},registration.body.token);
 const browser=await puppeteer.launch({headless:true,...(process.env.FULL_MOCK_TEST_CHROME_PATH?{executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH}:{})});t.after(()=>browser.close());
 const page=await browser.newPage();await page.setViewport({width,height:900});const errors=[],assessmentCalls=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&/\/(?:grade|score)(?:\/|$)/.test(new URL(r.url()).pathname))assessmentCalls.push(new URL(r.url()).pathname);});
 try {
 await page.goto(f.base);await page.type('#loginUsername',username);await page.type('#loginPassword','Synthetic-pass-123');await page.locator('#loginSubmitBtn').click();
 await page.waitForFunction(()=>document.getElementById('appShell')?.style.display==='grid'&&document.getElementById('loadingVeil')?.classList.contains('hidden')&&location.hash==='#/home');
 async function navigate(id){if(width<640&&!await page.$eval('body',e=>e.classList.contains('portal-menu-open')))await page.locator('#portalMenuToggle').click();await page.locator('#'+id).click();}
 await navigate('nav-progress');await page.waitForSelector('[data-progress-attempt="2"]');
 assert.equal(await page.$eval('#progressPane h3',e=>e.textContent),'Recently attempted questions');
 assert.equal(await page.$eval('[data-progress-attempt="1"]',e=>e.textContent.includes('Saved essay question')),true);
 assert.equal(await page.$eval('#progressPane',e=>e.textContent.includes('Task trends')),false);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 await page.locator('[data-progress-attempt="2"]').click();
 await page.waitForFunction(()=>document.getElementById('swtResultsScreen')?.classList.contains('active'));
 assert.equal(await page.$eval('#swtResultsScreen',(e,text)=>e.textContent.includes(text),older.text),true);
 assert.equal(await page.$eval('#swtResultsScreen',(e,text)=>e.textContent.includes(text),latest.text),false);
 await page.reload();await page.waitForFunction(()=>document.getElementById('swtResultsScreen')?.classList.contains('active'));
 assert.equal(await page.$eval('#swtResultsScreen',(e,text)=>e.textContent.includes(text),older.text),true);
 await navigate('nav-next-steps');await page.waitForSelector('[data-step-start="assigned-swt"]');
 await page.locator('[data-step-start="assigned-swt"]').click();await page.waitForFunction(id=>document.body.dataset.section==='swt'&&document.getElementById('swtPracticeScreen')?.classList.contains('active')&&String(swtPassageAt(currentPassageId)?.id)===String(id),{},passage.id);
 assert.equal(await page.evaluate(()=>swtPassageAt(currentPassageId)?.id),passage.id,'The selected stable question opens even when the client reorders passages');
 await navigate('nav-next-steps');await page.waitForSelector('a[data-step-start="lesson"]');
 const [resource]=await Promise.all([browser.waitForTarget(target=>target.url()===f.base+'/fixture-resource'),page.locator('a[data-step-start="lesson"]').click()]);await (await resource.page()).close();
 await navigate('nav-practice-hub');await page.waitForFunction(()=>{const image=document.querySelector('.practice-banner.writing h3 [data-emoji="essay"] img');return image?.complete&&image.naturalWidth>0;});
 assert.equal(await page.$eval('.practice-banner.writing h3 img',e=>e.complete&&e.naturalWidth>0),true);
 assert.deepEqual(assessmentCalls,[],'Reviewing a saved SWT response does not re-assess it');
 assert.deepEqual(errors,[]);
 } catch(error) {
  console.error('Progress browser state',JSON.stringify(await page.evaluate(()=>({section:document.body.dataset.section,hash:location.hash,menu:document.body.classList.contains('portal-menu-open'),targets:[...document.querySelectorAll('#nav-progress,#portalMenuToggle,a[data-step-start]')].map(e=>{const r=e.getBoundingClientRect(),style=getComputedStyle(e);return {tag:e.tagName,id:e.id,step:e.dataset.stepStart,x:r.x,y:r.y,width:r.width,height:r.height,display:style.display,visibility:style.visibility};})})).catch(()=>({unavailable:true}))));
  throw error;
 }
});
async function fixture(t,width){
 const app=express();app.use(express.json());const attempts=new Map();let historyReads=0;
 const questions=Array.from({length:30},(_,i)=>({id:'sst-'+(i+1),type:'sst',title:'Lecture '+(i+1),minutes:10,audioUrl:'/fixture.mp3'}));
 app.get('/api/writing-lab/catalog',(_,res)=>res.json({mocks:[],spoken:questions,dictation:[],listeningPractice:[]}));
 app.get('/api/writing-lab/session',(_,res)=>res.json({username:'navigation-fixture'}));
 app.get('/api/writing-lab/attempts',(_,res)=>{historyReads++;res.json([...attempts.values()].map(a=>({...a,questions:1})));});
 app.post('/api/writing-lab/attempts',(req,res)=>{
   const q=questions.find(q=>q.id===req.body.testId);if(!q)return res.sendStatus(404);
   const a={id:req.body.id,testId:q.id,kind:'sst',mode:req.body.mode,title:q.title,status:'ready',startedAt:Date.now(),serverNow:Date.now(),index:0,questions:[q],answers:[''],notes:'',revisions:[0],completed:[null],results:[null],playback:[null],deadline:null};attempts.set(a.id,a);res.json(a);
 });
 app.get('/api/writing-lab/attempts/:id',(req,res)=>{const a=attempts.get(req.params.id);if(!a)return res.sendStatus(404);res.json({...a,serverNow:Date.now()});});
 app.post('/api/writing-lab/attempts/:id/:action',(req,res)=>{
   const a=attempts.get(req.params.id);if(!a)return res.sendStatus(404);
   if(req.params.action==='begin')a.status='active';
   if(req.params.action==='answer'){a.answers[0]=req.body.text;a.revisions[0]=req.body.revision;a.playback[0]=req.body.playback;}
   res.json({...a,serverNow:Date.now()});
 });
 app.get('/fixture.mp3',(_,res)=>res.sendFile(path.join(root,'content/speaking-audio/rs-1.mp3')));
 app.get('/spoken-text',(_,res)=>res.type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/writing-lab-portal.css"><link rel="stylesheet" href="/listening-studio.css"><link rel="stylesheet" href="/question-navigation.css"></head><body><div id="lab" tabindex="-1"></div><div id="notice" role="status"></div><dialog id="confirm-dialog"><h2 id="confirm-title"></h2><p id="confirm-text"></p><button id="confirm-ok">Continue</button><button id="confirm-cancel">Cancel</button></dialog><script>localStorage.setItem('pte_session_token','fixture-only');</script><script src="/practice-catalogue.js"></script><script src="/practice-studio.js"></script><script src="/listening-studio.js"></script><script src="/listening-tasks.js"></script><script src="/writing-lab-report.js"></script><script src="/writing-lab-client.js"></script></body></html>`));
 app.use(express.static(path.join(root,'public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const browser=await puppeteer.launch({headless:true,...(process.env.FULL_MOCK_TEST_CHROME_PATH?{executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH}:{}),args:['--autoplay-policy=no-user-gesture-required']});
 t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const page=await browser.newPage();await page.setViewport({width,height:900});
 await page.goto('http://127.0.0.1:'+server.address().port+'/spoken-text');
 await page.waitForSelector('#studio-search');return {page,attempts,historyReads:()=>historyReads};
}
for(const width of [1363,390,320])test('NAV-05/06/08/11/12: Listening queue, draft, focus and dock at '+width+'px',async t=>{
 const f=await fixture(t,width),{page}=f;await page.type('#studio-search','8');
 assert.equal(await page.$$eval('[data-listening-open]:not([hidden])',nodes=>nodes.length),3);
 await page.click('[data-listening-open="sst-8"]');await page.waitForSelector('#audio-start');
 assert.equal(await page.evaluate(()=>document.activeElement.className),'exam-strip');
 await page.waitForFunction(()=>!document.getElementById('audio-start').disabled);await page.click('#audio-start');
 await page.waitForFunction(()=>!document.getElementById('answer').disabled);await page.type('#answer','A retained summary draft for lecture eight.');
 await page.click('[data-practice-move="1"]');await page.waitForFunction(()=>document.getElementById('answer')?.value==='');
 await page.waitForFunction(()=>document.querySelector('.exam-strip')?.textContent.includes('Question 2 of 3'));
 await page.click('[data-practice-move="-1"]');await page.waitForFunction(()=>document.getElementById('answer')?.value==='A retained summary draft for lecture eight.');
 assert.equal(f.attempts.size,2);assert.equal(f.historyReads(),1);
 await page.evaluate(()=>{document.getElementById('answer').style.minHeight='1800px';window.scrollTo(0,document.body.scrollHeight);});
 const geometry=await page.evaluate(()=>{const dock=document.querySelector('.practice-question-dock'),r=dock.getBoundingClientRect();return {top:r.top,bottom:r.bottom,viewport:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+1,overflowNodes:[...document.querySelectorAll('body *')].filter(n=>{const b=n.getBoundingClientRect();return b.width>0&&(b.right>innerWidth+1||b.left< -1);}).slice(0,10).map(n=>({tag:n.tagName,id:n.id,className:n.className,width:n.getBoundingClientRect().width,right:n.getBoundingClientRect().right}))};});
 assert(geometry.top>=-1&&geometry.bottom<=geometry.viewport,'Question controls remain in the viewport');assert.equal(geometry.overflow,false,JSON.stringify(geometry));
 await page.click('.practice-question-dock [data-tab="sst"]');await page.waitForSelector('#studio-search');
 assert.equal(await page.$eval('#studio-search',node=>node.value),'8');
 assert.equal(await page.$$eval('[data-listening-open]:not([hidden])',nodes=>nodes.length),3);
});
