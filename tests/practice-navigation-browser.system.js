'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),path=require('node:path');
const puppeteer=require('puppeteer');
const root=path.resolve(__dirname,'..');
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
