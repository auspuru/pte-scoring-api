'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),path=require('node:path');
const puppeteer=require('puppeteer');
const root=path.resolve(__dirname,'..');
const {fixture:authFixture}=require('./helpers/auth-server');
async function essayGuideScreenshot(page,width,state){
 if(!process.env.CI)return;
 const fs=require('node:fs/promises');await fs.mkdir(path.join(root,'.cache'),{recursive:true});
 await page.screenshot({path:path.join(root,'.cache','essay-guide-'+width+'-'+state+'.png')});
}
for(const width of [1363,390,320])test('Essay guide: combined page, inline approaches, clock, ownership and mock isolation at '+width+'px',{timeout:90000},async t=>{
 const f=await authFixture(t),username='essay-guide-browser',password='Synthetic-pass-123';
 for(const name of [username,'essay-guide-other'])assert.equal((await f.request('/api/auth/register',{username:name,password,email:name+'@example.test'})).body.success,true);
 const browser=await puppeteer.launch({headless:true,...(process.env.FULL_MOCK_TEST_CHROME_PATH?{executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH}:{})});t.after(()=>browser.close());
 const page=await browser.newPage();await page.setViewport({width,height:900});const errors=[],assessmentCalls=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&/\/(?:grade|score)(?:\/|$)/.test(new URL(r.url()).pathname))assessmentCalls.push(r.url());});
 async function ready(){await page.waitForFunction(()=>document.getElementById('appShell')?.style.display==='grid'&&document.getElementById('loadingVeil')?.classList.contains('hidden'));}
 async function login(name){await page.type('#loginUsername',name);await page.type('#loginPassword',password);await page.locator('#loginSubmitBtn').click();await ready();}
 async function prepare(prompt){await ready();await page.evaluate(()=>{switchSection('practice');startNewPractice();setQuestionSource('custom');});await page.type('#practiceCustomPrompt',prompt);}
 const prompt=require('../content/writing-lab.json').predictionEssays[0].text;
 try {
 await page.goto(f.base);await login(username);await prepare(prompt);
 await page.locator('.practice-timer-toggle').click();assert.equal(await page.$eval('#practiceTimerToggle',e=>e.checked),true);await page.locator('#practiceStartBtn').click();await page.waitForSelector('#essay-guide[open]');
 assert.equal(await page.$eval('[data-guide-prompt]',e=>e.textContent),prompt);
 assert.equal(await page.evaluate(()=>document.activeElement.id),'essay-guide-title');
 assert.equal(await page.$$eval('#essay-guide [role=tab]',els=>els.length),0);
 assert.equal(await page.$$eval('[data-guide-explanation]:not([hidden])',els=>els.length),0);
 assert.equal(await page.evaluate(()=>practiceState.timerStartedAt),null);
 await essayGuideScreenshot(page,width,'prompt');
 for(const choice of ['0','1','own']){
  await page.locator('[data-guide-choice="'+choice+'"]').click();
  const inline=await page.$eval('[data-guide-choice="'+choice+'"]',button=>{const panel=document.getElementById(button.getAttribute('aria-controls'));return {adjacent:button.nextElementSibling===panel,shown:!panel.hidden,withinCard:panel.parentElement===button.parentElement,expanded:button.getAttribute('aria-expanded')};});
  assert.deepEqual(inline,{adjacent:true,shown:true,withinCard:true,expanded:'true'});
  assert.equal(await page.$$eval('[data-guide-explanation]:not([hidden])',els=>els.length),1);
  if(choice==='0')await essayGuideScreenshot(page,width,'approach');
 }
 await page.type('#essay-guide-own','A private teaching note, separate from the essay.');
 assert.equal(await page.evaluate(()=>practiceState.timerStartedAt),null,'The optional teaching note does not start the essay clock');
 assert.equal(await page.$eval('#essay-guide',e=>e.scrollWidth<=e.clientWidth+1),true);
 assert.equal(await page.$eval('.essay-guide-footer',e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),true);
 assert.equal(await page.$$eval('#essay-guide button',els=>els.every(e=>e.getBoundingClientRect().height>=44)),true);
 await page.keyboard.press('Escape');await page.waitForSelector('#essay-guide',{hidden:true});
 assert.equal(await page.evaluate(()=>practiceState.writeStep),1,'Closing does not start writing or mark the guide as seen');
 await page.locator('#practiceStartBtn').click();await page.waitForSelector('#essay-guide[open]');
 await page.locator('.essay-guide-skip').click();await page.waitForSelector('#practiceEssayInput');
 assert.equal(await page.$eval('#practiceEssayInput',e=>e.value),'');assert.equal(await page.evaluate(()=>practiceState.timerStartedAt),null);
 assert.equal(await page.evaluate(()=>document.activeElement.id),'practiceEssayInput');
 const draft='Television helps me relax after a demanding workday.';await page.type('#practiceEssayInput',draft);
 const started=await page.evaluate(()=>practiceState.timerStartedAt);assert(started>0);
 await page.locator('#practiceEssayGuideBtn').click();await page.waitForSelector('#essay-guide[open]');
 assert.equal(await page.$eval('#essay-guide [data-guide-auto]',e=>e.checked),true);
 await page.locator('.essay-guide-primary').click();
 assert.equal(await page.$eval('#practiceEssayInput',e=>e.value),draft);assert.equal(await page.evaluate(()=>practiceState.timerStartedAt),started);
 await page.waitForFunction((text,at)=>{const saved=portalDraftStore?.read(currentUserId);return saved?.essayText===text&&saved.timerStartedAt===at;},{},draft,started);
 await page.reload();await ready();await page.waitForSelector('#practiceEssayInput');assert.equal(await page.$eval('#practiceEssayInput',e=>e.value),draft);
 assert.equal(await page.evaluate(()=>practiceState.timerStartedAt),started);
 // The same completed guide is remembered only for this account and wording.
 await prepare(prompt);
 await page.locator('#toast.show .toast-undo').click();await page.waitForSelector('#practiceEssayInput');
 assert.equal(await page.$eval('#practiceEssayInput',e=>e.value),draft,'Undo remains clickable and restores the archived response');
 assert.equal(await page.evaluate(()=>practiceState.timerStartedAt),started);
 await prepare(prompt);assert.equal(await page.$eval('#toast',e=>e.classList.contains('show')),true);
 await page.$eval('#practiceStartBtn',e=>e.scrollIntoView({block:'nearest',behavior:'instant'}));
 assert.equal(await page.$eval('#practiceStartBtn',e=>{const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')?.id;}),'practiceStartBtn','The visible Start control receives the tap while the archive notice is shown');
 await page.locator('#practiceStartBtn').click();await page.waitForSelector('#practiceEssayInput');assert.equal(await page.$('#essay-guide'),null);
 assert.equal(await page.$eval('#practiceEssayInput',e=>e.value),'','Start opens a fresh response without invoking Undo');
 const nextPrompt=require('../content/writing-lab.json').predictionEssays[1].text;
 await prepare(nextPrompt);await page.locator('#practiceStartBtn').click();await page.waitForSelector('#essay-guide[open]');
 await page.evaluate(()=>{window.__oldGuideButton=document.querySelector('.essay-guide-primary');signOut();window.__oldGuideButton.click();});
 await page.waitForSelector('#loginSubmitBtn');assert.equal(await page.$('#essay-guide'),null);
 await page.$eval('#loginUsername',e=>e.value='');await page.$eval('#loginPassword',e=>e.value='');await login('essay-guide-other');await prepare(prompt);
 await page.locator('#practiceStartBtn').click();await page.waitForSelector('#essay-guide[open]');
 assert.equal(await page.$eval('#essay-guide-own',e=>e.value),'');
 await page.click('[data-guide-auto]');await page.locator('.essay-guide-primary').click();await page.waitForSelector('#practiceEssayInput');
 await prepare(nextPrompt);await page.locator('#practiceStartBtn').click();await page.waitForSelector('#practiceEssayInput');assert.equal(await page.$('#essay-guide'),null);
 await prepare('Discuss a new custom topic using relevant examples.');await page.locator('#practiceStartBtn').click();await page.waitForSelector('#practiceEssayInput');assert.equal(await page.$('#essay-guide'),null);
 await page.locator('#practiceEssayGuideBtn').click();await page.waitForSelector('#essay-guide[open]');assert.equal(await page.$eval('#essay-guide',e=>e.textContent.includes('not been reviewed for this exact question')),true);
 await page.keyboard.press('Escape');
 // A multi-part question must retain alternatives under every stance, including an own approach.
 const deductions=require('../public/essay-guidance-data').guides.find(q=>q.n===1);
 await prepare(deductions.prompt);await page.locator('#practiceStartBtn').click();await page.waitForSelector('#practiceEssayInput');
 await page.locator('#practiceEssayGuideBtn').click();await page.waitForSelector('#essay-guide[open]');
 for(const choice of ['0','1','2','own']){
  await page.locator('[data-guide-choice="'+choice+'"]').click();
  assert.deepEqual(await page.$$eval('#essay-guide-route-'+choice+' [data-guide-paragraph]',els=>els.map(e=>Number(e.dataset.guideParagraph))),[1,2,3,4]);
  const text=await page.$eval('#essay-guide-route-'+choice,e=>e.textContent);
  assert.match(text,/Explain your opinion on mark deductions/);
  assert.match(text,/Suggest alternative actions and explain how they work/);
  assert.match(text,/required under every position/);
  assert.equal(await page.$eval('#essay-guide',e=>e.scrollWidth<=e.clientWidth+1),true);
  if(choice==='1'){
   await page.$eval('#essay-guide-route-1 [data-guide-paragraph="3"]',e=>e.scrollIntoView({block:'start',behavior:'instant'}));
   await essayGuideScreenshot(page,width,'deductions-body-hints');
  }
 }
 assert.equal(await page.evaluate(()=>practiceState.timerStartedAt),null);
 await page.evaluate(()=>switchSection('writing-mocks'));await page.waitForFunction(()=>document.body.dataset.section==='writing-mocks');assert.equal(await page.$('#essay-guide'),null);
 await page.evaluate(()=>openPracticeEssayGuide());assert.equal(await page.$('#essay-guide'),null,'No practice guidance can open in a timed mock workspace');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 assert.deepEqual(errors,[]);assert.deepEqual(assessmentCalls,[]);
 } catch(error) {
  await essayGuideScreenshot(page,width,'failure');
  const state=await page.evaluate(()=>{
   const button=document.getElementById('practiceStartBtn'),r=button?.getBoundingClientRect();
   const hit=r?document.elementFromPoint(r.x+r.width/2,r.y+r.height/2):null;
   return {section:document.body.dataset.section,step:practiceState.writeStep,view:practiceState.view,owner:currentUserId,
    veilHidden:document.getElementById('loadingVeil')?.classList.contains('hidden'),dialog:!!document.querySelector('#essay-guide[open]'),editor:!!document.getElementById('practiceEssayInput'),
    start:r?{x:r.x,y:r.y,width:r.width,height:r.height,disabled:button.disabled}:null,hit:hit?{tag:hit.tagName,id:hit.id,className:hit.className}:null,toast:document.getElementById('toast')?.textContent};
  }).catch(()=>({unavailable:true}));
  console.error('Essay guide browser state',JSON.stringify(state));
  throw error;
 }
});
for(const width of [1363,390,320])test('Progress opens exact saved responses and Next Steps is retired at '+width+'px',{timeout:90000},async t=>{
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
 const browser=await puppeteer.launch({headless:true,...(process.env.FULL_MOCK_TEST_CHROME_PATH?{executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH}:{})});t.after(()=>browser.close());
 const page=await browser.newPage();await page.setViewport({width,height:900});const errors=[],assessmentCalls=[],planReads=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname==='/api/interventions')planReads.push(r.url());if(r.method()==='POST'&&/\/(?:grade|score)(?:\/|$)/.test(new URL(r.url()).pathname))assessmentCalls.push(new URL(r.url()).pathname);});
 try {
 await page.goto(f.base);await page.type('#loginUsername',username);await page.type('#loginPassword','Synthetic-pass-123');await page.locator('#loginSubmitBtn').click();
 await page.waitForFunction(()=>document.getElementById('appShell')?.style.display==='grid'&&document.getElementById('loadingVeil')?.classList.contains('hidden')&&location.hash==='#/home');
 async function navigate(id){
  if(width<640&&!await page.$eval('body',e=>e.classList.contains('portal-menu-open'))){
   const hit=await page.$eval('#portalMenuToggle',e=>{const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')?.id;});
   assert.equal(hit,'portalMenuToggle','The visible Menu control must receive the pointer');
   await page.locator('#portalMenuToggle').click();
   await page.waitForFunction(()=>document.body.classList.contains('portal-menu-open'),{timeout:5000});
  }
  await page.locator('#'+id).click();
 }
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
 assert.equal(await page.$('#nav-next-steps'),null);
 assert.equal(await page.$('#nextStepsDashboardCard'),null);
 assert.equal(await page.$('#nextStepNotification'),null,'Existing unread plans do not show a popup');
 await page.goto(f.base+'/#/next-steps');
 await page.waitForFunction(()=>document.body.dataset.section==='progress'&&location.hash==='#/progress');
 await page.waitForSelector('[data-progress-attempt="2"]');
 await page.reload();await page.waitForFunction(()=>document.body.dataset.section==='progress');
 assert.equal(await page.$('#nextStepsPane'),null);
 assert.equal(await page.evaluate(()=>performance.getEntriesByType('resource').some(r=>/interventions-client\.js/.test(r.name))),false);
 await navigate('nav-practice-hub');await page.waitForFunction(()=>{const image=document.querySelector('.practice-banner.writing h3 [data-emoji="essay"] img');return image?.complete&&image.naturalWidth>0;});
 assert.equal(await page.$eval('.practice-banner.writing h3 img',e=>e.complete&&e.naturalWidth>0),true);
 assert.deepEqual(assessmentCalls,[],'Reviewing a saved SWT response does not re-assess it');
 assert.deepEqual(planReads,[],'The retired feature does not fetch assigned plans in the background');
 await navigate('nav-mock-tests');await page.waitForSelector('#catalogue-attempt');
 await page.select('#catalogue-attempt','attempted');
 await page.waitForFunction(()=>!document.getElementById('catalogue-empty').hidden);
 assert.equal(await page.$$eval('[data-mock-id]',nodes=>nodes.length),0);
 await page.select('#catalogue-attempt','unattempted');
 await page.waitForFunction(()=>document.querySelectorAll('[data-mock-id]').length>0);
 await page.select('#catalogue-module','writing');
 assert.equal(await page.$$eval('#catalogue-board .mock-catalogue-card',nodes=>nodes.every(n=>n.classList.contains('writing'))),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 assert.deepEqual(errors,[]);
 } catch(error) {
  console.error('Progress browser state',JSON.stringify(await page.evaluate(()=>({section:document.body.dataset.section,hash:location.hash,menu:document.body.classList.contains('portal-menu-open'),targets:[...document.querySelectorAll('#nav-progress,#portalMenuToggle,a[data-step-start]')].map(e=>{const r=e.getBoundingClientRect(),style=getComputedStyle(e);return {tag:e.tagName,id:e.id,step:e.dataset.stepStart,x:r.x,y:r.y,width:r.width,height:r.height,display:style.display,visibility:style.visibility};})})).catch(()=>({unavailable:true}))));
  throw error;
 }
});
async function fixture(t,width){
 const app=express();app.use(express.json());const attempts=new Map();let historyReads=0,failSave=false;
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
   if(req.params.action==='answer'&&failSave)return res.status(503).json({error:'Fixture offline'});
   if(req.params.action==='answer'){a.answers[0]=req.body.text;a.revisions[0]=req.body.revision;a.playback[0]=req.body.playback;}
   res.json({...a,serverNow:Date.now()});
 });
 app.get('/fixture.mp3',(_,res)=>res.sendFile(path.join(root,'content/speaking-audio/rs-1.mp3')));
 app.get('/spoken-text',(_,res)=>res.type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/writing-lab-portal.css"><link rel="stylesheet" href="/listening-studio.css"><link rel="stylesheet" href="/question-navigation.css"></head><body><div id="lab" tabindex="-1"></div><div id="notice" role="status"></div><dialog id="confirm-dialog"><h2 id="confirm-title"></h2><p id="confirm-text"></p><button id="confirm-ok">Continue</button><button id="confirm-cancel">Cancel</button></dialog><script>localStorage.setItem('pte_session_token','fixture-only');</script><script src="/practice-catalogue.js"></script><script src="/practice-studio.js"></script><script src="/listening-studio.js"></script><script src="/listening-tasks.js"></script><script src="/writing-lab-report.js"></script><script src="/writing-lab-client.js"></script></body></html>`));
 app.use(express.static(path.join(root,'public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const browser=await puppeteer.launch({headless:true,...(process.env.FULL_MOCK_TEST_CHROME_PATH?{executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH}:{}),args:['--autoplay-policy=no-user-gesture-required']});
 t.after(async()=>{await browser.close();});
 const page=await browser.newPage();await page.setViewport({width,height:900});
 await page.goto('http://127.0.0.1:'+server.address().port+'/spoken-text');
 await page.waitForSelector('#studio-search');return {page,attempts,historyReads:()=>historyReads,setFailSave:value=>failSave=value};
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

for(const width of [1363,390,320])test('Listening save failure blocks Next and empty direct-link context keeps the saved response at '+width+'px',async t=>{
 const f=await fixture(t,width),{page}=f;
 await page.click('[data-listening-open="sst-8"]');await page.waitForSelector('#audio-start');
 await page.waitForFunction(()=>!document.getElementById('audio-start').disabled);await page.click('#audio-start');
 await page.waitForFunction(()=>!document.getElementById('answer').disabled);await page.type('#answer','Keep this answer through a connection failure.');
 f.setFailSave(true);await page.click('[data-practice-move="1"]');
 await page.waitForFunction(()=>document.getElementById('notice')?.textContent.includes('Fixture offline'));
 assert.equal(f.attempts.size,1);assert.equal(await page.$eval('#answer',n=>n.value),'Keep this answer through a connection failure.');
 f.setFailSave(false);const id=[...f.attempts.keys()][0];
 await page.evaluate(id=>window.WritingLab.open({tab:'sst',attemptId:id,navigation:true,context:{type:'sst',queue:[]}}),id);
 await page.waitForFunction(()=>document.querySelector('[data-practice-move="1"]')?.disabled);
 assert.equal(await page.$eval('[data-practice-move="-1"]',n=>n.disabled),true);
 assert.equal(await page.$eval('#answer',n=>n.value),'Keep this answer through a connection failure.');assert.equal(f.attempts.size,1);
});

for(const width of [1363,390])test('A submitted Listening mock publishes background results without a retry click at '+width+'px',{timeout:30000},async t=>{
 const f=await fixture(t,width),{page}=f,id='background-listening';
 const a={id,kind:'mock',module:'listening',title:'Background listening recovery',status:'submitted',startedAt:Date.now(),index:0,questions:[{id:'saved-wfd',type:'wfd',text:'The original sentence remains saved.',title:'Saved dictation',sample:'The original sentence remains saved.',minutes:2,audioUrl:'/fixture.mp3'}],answers:['The original sentence remains saved.'],completed:[{reason:'Submitted'}],results:[null],playback:[null],deadline:null,serverNow:Date.now()};
 f.attempts.set(id,a);const assessmentRequests=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/score/'))assessmentRequests.push(r.url());});
 await page.evaluate(id=>window.WritingLab.open({attemptId:id,tab:'mocks',module:'listening',requestId:'background-fixture'}),id);
 await page.waitForFunction(()=>document.getElementById('scoring-status')?.textContent.includes('automatically'));
 a.results=[{total:5,maximum:5,maxima:{spelling:5},scores:{spelling:5},feedback:{content:'All original words are correct.'},strengths:[],improvements:[],errors:[]}];
 await page.waitForFunction(()=>document.querySelector('.score-total')?.textContent.startsWith('90'),{timeout:12000});
 assert.equal(await page.$eval('.results',e=>e.textContent.includes('The original sentence remains saved.')),true);
 assert.deepEqual(assessmentRequests,[]);
});

for(const width of [1363,390,320])test('SWT review: exact corrections, drafts, saved history and ownership at '+width+'px',{timeout:90000},async t=>{
 const f=await authFixture(t),name='swt-review-browser',password='Synthetic-pass-123';
 for(const username of [name,'swt-review-other'])assert.equal((await f.request('/api/auth/register',{username,password,email:username+'@example.test'})).body.success,true);
 const browser=await puppeteer.launch({headless:true,...(process.env.FULL_MOCK_TEST_CHROME_PATH?{executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH}:{})});t.after(()=>browser.close());
 const page=await browser.newPage();await page.setViewport({width,height:900});let calls=0;const errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&/\/(?:grade|score)(?:\/|$)/.test(new URL(r.url()).pathname))calls++;});
 await page.goto(f.base);await page.type('#loginUsername',name);await page.type('#loginPassword',password);await page.locator('#loginSubmitBtn').click();await page.waitForFunction(()=>document.getElementById('appShell')?.style.display==='grid'&&document.getElementById('loadingVeil')?.classList.contains('hidden')&&swtPassageAt(1)!==null&&location.hash==='#/home');
 const original='Trees cool cities and improves air quality.';
 async function show(extra={}){await page.evaluate((text,extra)=>{
  switchSection('swt');currentPassageId=1;const p=swtPassageAt(1);
  const d={overall_score:90,trait_scores:{content:4,content_max:4,form:1,grammar:1,vocabulary:2},content_details:{full_content_eligible:true,summary_assessment:{relationships_clear:true,missing_dependencies:[],conclusion_status:'captured'}},grammar_details:{grammar_annotations:[{phrase:'improves',fix:'improve',type:'agreement',affects_score:true,meaning_effect:'Use the plural verb with trees.'}]},...extra};
  showResults(d,p,null,text);showSwtScreen('swtResultsScreen');
 },original,extra);}
 await show();
 assert.deepEqual(await page.$$eval('.swt-review-heading h2',els=>els.map(e=>e.textContent.replace(/^\d/,''))),['Content & meaning','Grammar & spelling','Form','Revise & practise']);
 await page.locator('[data-review-fix]').click();await page.waitForFunction(()=>!document.getElementById('swtReviewCorrection').hidden);assert.match(await page.$eval('#swtReviewCorrection',e=>e.textContent),/improves.*improve/);
 await page.focus('[data-review-fix]');await page.keyboard.press('Enter');assert.equal(await page.$eval('[data-review-fix]',e=>e.getAttribute('aria-expanded')),'true');
 await page.locator('[data-review-use]').click();await page.waitForFunction(()=>!document.getElementById('swtReviewEditor').hidden);
 assert.equal(await page.$eval('#swtReviewDraft',e=>e.value),'Trees cool cities and improve air quality.');assert.equal(await page.$eval('#annotatedSubmission',e=>e.textContent),original);
 await page.locator('[data-review-undo]').click();assert.equal(await page.$eval('#swtReviewDraft',e=>e.value),original);
 const revised='Trees cool urban areas and improve air quality.';await page.$eval('#swtReviewDraft',(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));},revised);
 await page.locator('[data-review-save]').click();assert.equal(await page.evaluate(()=>LocalStore.get(getPteStorageKey('summaries'))[swtPassageStorageId()].text),revised);
 assert.equal(await page.$eval('#annotatedSubmission',e=>e.textContent),original);
 await page.locator('[data-review-continue]').click();await page.waitForFunction(()=>document.getElementById('swtPracticeScreen').classList.contains('active'));assert.equal(await page.$eval('#summaryInput',e=>e.value),revised);
 await show({score_provisional:true});assert.equal(await page.$eval('#heroScore',e=>e.textContent),'—');assert.equal(await page.$('[data-review-save]'),null);assert.equal(await page.$('[data-review-fix]'),null);
 await show({trait_scores:{content:0,form:0,grammar:0,vocabulary:0},form_details:{reason:'Use one complete sentence.'}});assert.match(await page.$eval('#swtReviewForm',e=>e.textContent),/one complete sentence/);assert.equal(await page.$('[data-review-fix]'),null);
 await show({trait_scores:{content:4,content_max:4,form:1,grammar:2,vocabulary:2},grammar_details:{grammar_annotations:[]}});assert.match(await page.$eval('#swtReviewContent',e=>e.textContent),/Keep this approach/);assert.equal(await page.$('[data-review-use]'),null);
 await show();await page.locator('[data-review-edit]').click();
 assert.equal(await page.$eval('#swtGuidanceBody',e=>e.scrollWidth<=e.clientWidth+1),true);
 if(process.env.CI){const fs=require('node:fs/promises');await fs.mkdir(path.join(root,'.cache'),{recursive:true});await page.$eval('#swtReviewLanguage',e=>e.scrollIntoView({block:'start',behavior:'instant'}));await page.screenshot({path:path.join(root,'.cache','swt-review-'+width+'.png')});}
 await page.evaluate(()=>{window.__oldSwtSave=document.querySelector('[data-review-save]');signOut();});await page.waitForSelector('#loginSubmitBtn');
 await page.$eval('#loginUsername',e=>e.value='');await page.$eval('#loginPassword',e=>e.value='');await page.type('#loginUsername','swt-review-other');await page.type('#loginPassword',password);await page.locator('#loginSubmitBtn').click();await page.waitForFunction(()=>document.getElementById('appShell')?.style.display==='grid'&&document.getElementById('loadingVeil')?.classList.contains('hidden')&&swtPassageAt(1)!==null&&location.hash==='#/home');
 await page.evaluate(()=>window.__oldSwtSave.click());assert.equal(await page.evaluate(()=>Object.values(LocalStore.get(getPteStorageKey('summaries'))||{}).some(x=>x.text==='Trees cool cities and improves air quality.')),false);
 assert.equal(calls,0,'Reviewing, revising and saving do not request an assessment');assert.deepEqual(errors,[]);
});
