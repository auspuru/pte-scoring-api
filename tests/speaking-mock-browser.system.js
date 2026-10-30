'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const express=require('express'),puppeteer=require('puppeteer'),run=require('node:util').promisify(require('node:child_process').execFile);
const {database,until}=require('./helpers/full-mock-systems'),{installSpeakingMock}=require('../speaking-mock'),bank=require('../content/speaking-mocks');
const root=path.resolve(__dirname,'..');
for(const mobile of [false,true])test('Speaking mock Chrome '+(mobile?'mobile':'desktop')+': local headset check, audio lead-in and full preparation after playback',{timeout:90000},async t=>{
 const db=await database(t),directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-flow-browser-')),sample=bank.papers[0].questions.find(q=>q.type==='rs'),microphone=path.join(directory,'mic.wav');
 const source=path.join(root,'content',sample.audioSource.folder==='speaking'?'speaking-audio':'writing-audio',sample.audioSource.id+'.mp3');
 await run('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-i',source,'-ar','48000','-ac','1','-c:a','pcm_s16le',microphone]);
 let offset=0,uploads=0,created=0;const app=express();app.use(express.json());
 // A short verified recording keeps this a bounded media-flow test. The test
 // attempt uses its real duration; no production paper or provider is changed.
 app.get('/speaking-mock-audio/:id.mp3',(req,res)=>res.sendFile(source));
 app.use((req,res,next)=>{if(req.method==='POST'&&/\/recordings\//.test(req.path))uploads++;if(req.method==='POST'&&req.path==='/api/speaking-mocks/attempts')created++;next();});
 const service=installSpeakingMock(app,{pool:db.first,directory,now:()=>Date.now()+offset,verifyToken:token=>token==='alice'?'alice':null,getAccount:async()=>({}),azureAvailable:false,gradeResponse:async()=>{throw Error('The headset and timing checks must not invoke a paid assessment.');}});await service.store.initialise();
 app.use(express.static(path.join(root,'public'),{index:false}));
 app.get('/',(req,res)=>res.type('html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/portal-workspace.css"><link rel="stylesheet" href="/speaking-mock.css"><link rel="stylesheet" href="/mock-report-ui.css"></head><body style="margin:0"><main id="appShell"><section id="speakingMockPane" class="pane active"></section></main><script>window.currentUserId="alice";sessionStorage.setItem("pte_session_token","alice");window.__mockOffset=0;const realNow=Date.now;Date.now=()=>realNow()+window.__mockOffset;window.__examStarts=0;window.__examBytes=0;window.__promptPlays=0;const record=MediaRecorder.prototype.start;MediaRecorder.prototype.start=function(...args){if(!document.getElementById("sm-check-record")){window.__examStarts++;this.addEventListener("dataavailable",event=>{window.__examBytes+=event.data.size})}return record.apply(this,args)};const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(...args){if(this.src.includes("/speaking-mock-audio/"))window.__promptPlays++;return play.apply(this,args)};</script><script src="/portal-exam-mode.js"></script><script src="/speaking-start-cue.js"></script><script src="/speaking-images.js"></script><script src="/mock-report-ui.js"></script><script src="/speaking-mock-client.js"></script><script>SpeakingMock.open();</script></body></html>'));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));let browser;
 db.onClose(async()=>{await browser?.close();await service.waitForJobs();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
 browser=await puppeteer.launch({headless:true,...(process.env.FULL_MOCK_TEST_CHROME_PATH?{executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH}:{}),args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-file-for-fake-audio-capture='+microphone]});
 const page=await browser.newPage();await page.setViewport(mobile?{width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:1}:{width:1365,height:1000});page.setDefaultTimeout(15000);const errors=[],dialogs=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>{dialogs.push(dialog.message());dialog.dismiss();});
 await page.setRequestInterception(true);page.on('request',request=>request.url().startsWith('http://127.0.0.1:')||request.url().startsWith('blob:')||request.url().startsWith('data:')?request.continue():request.abort());
 const click=async selector=>{await page.$eval(selector,node=>node.scrollIntoView({block:'center'}));if(mobile)await page.tap(selector);else await page.click(selector);};
 const advance=async ms=>{offset+=ms;await page.evaluate(ms=>window.__mockOffset+=ms,ms);};
 try{
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('[data-sm="start"]');await click('[data-sm="start"]');
 await page.waitForSelector('#sm-check-record');assert.equal(created,0);assert.equal(uploads,0);assert(await page.$eval('#sm-check-begin',node=>node.disabled));
 await click('#sm-check-record');await page.waitForFunction(()=>!document.getElementById('sm-check-play').disabled);assert.equal(created,0);assert.equal(uploads,0);
 await click('#sm-check-play');await page.waitForFunction(()=>!document.getElementById('sm-check-heard').disabled);assert(await page.$eval('#sm-check-begin',node=>node.disabled));
 await click('#sm-check-heard');await click('#sm-check-begin');await page.waitForSelector('#sm-next');assert.equal(created,1);assert.equal(uploads,0);assert(await page.evaluate(()=>!!document.fullscreenElement));
 const [summary]=await service.store.list('alice'),attempt=await service.store.get('alice',summary.id),index=attempt.questions.findIndex(q=>q.type==='rts');
 await service.store.update('alice',attempt.id,a=>{a.index=index;a.questions[index].audioSeconds=sample.audioSeconds;delete a.questionStartedAt;delete a.questionTimingVersion;return a;});
 await page.evaluate(()=>SpeakingMock.open({history:true}));await page.waitForSelector('[data-sm="resume"]');await click('[data-sm="resume"]');await page.waitForSelector('#sm-audio-status');
 assert.equal(await page.evaluate(()=>window.__promptPlays),0);assert.match(await page.$eval('#sm-audio-status',node=>node.textContent),/Beginning in/);
 await page.waitForFunction(()=>window.__promptPlays===1);assert.equal(await page.evaluate(()=>window.__examStarts),0);
 await page.waitForFunction(()=>document.getElementById('sm-preparation-status').textContent.includes('0:10'));
 assert.equal(await page.evaluate(()=>window.__examStarts),0);await advance(9000);assert.equal(await page.evaluate(()=>window.__examStarts),0);
 await advance(1100);await page.waitForFunction(()=>window.__examStarts===1);assert.equal(await page.evaluate(()=>window.__promptPlays),1);
 await page.waitForFunction(()=>window.__examBytes>100);
 await click('#sm-next');await until(async()=>!!(await service.store.get('alice',attempt.id)).responses[index]?.recording,'Speaking response was not saved.');assert.equal(uploads,1);
 await page.evaluate(()=>{
   SpeakingMock.reset();
   document.getElementById('speakingMockPane').innerHTML=MockReportUI.frame({key:'contribution-layout',title:'Writing mock report',score:MockReportUI.hero({title:'Writing mock',overall:75,skills:[{name:'Writing',value:75}]})+MockReportUI.contributions({section:'writing',groups:[{type:'swt',total:8,maximum:9,count:1,marked:1},{type:'sst',total:6,maximum:12,count:1,marked:1},{type:'wfd',total:12,maximum:20,count:3,marked:3}]})});
 });
 assert.equal(await page.$$eval('[data-contribution-skill]',nodes=>nodes.length),2);
 await click('.ipr-contribution-details summary');assert.equal(await page.$$eval('.ipr-contribution-table tbody tr',nodes=>nodes.length),3);
 assert.deepEqual(dialogs,[]);assert.deepEqual(errors,[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 }catch(error){t.diagnostic('Screen: '+await page.$eval('body',node=>node.innerText.slice(-2000)));t.diagnostic('Requests: created='+created+' uploads='+uploads+'; page errors='+errors.join('; '));throw error;}
});
