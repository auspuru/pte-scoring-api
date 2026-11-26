'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const express=require('express'),puppeteer=require('puppeteer'),run=require('node:util').promisify(require('node:child_process').execFile);
const {database,until}=require('./helpers/full-mock-systems'),{installSpeakingMock}=require('../speaking-mock'),bank=require('../content/speaking-mocks');
const root=path.resolve(__dirname,'..');
for(const [mobile,paperIndex] of [[false,0],[true,0],[false,3],[true,4]])test('Speaking mock '+(paperIndex+1)+' Chrome '+(mobile?'mobile':'desktop')+': local headset check, audio lead-in and full preparation after playback',{timeout:90000},async t=>{
 const db=await database(t),directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-flow-browser-')),sample=bank.papers[paperIndex].questions.find(q=>q.type==='rs'),microphone=path.join(directory,'mic.wav');
 const source=path.join(root,'content',sample.audioSource.folder==='speaking'?'speaking-audio':'writing-audio',sample.audioSource.id+'.mp3');
 await run('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-i',source,'-ar','48000','-ac','1','-c:a','pcm_s16le',microphone]);
 let offset=0,uploads=0,created=0;const app=express();app.use(express.json());
 // A short verified recording keeps this a bounded media-flow test. The test
 // attempt uses its real duration; no production paper or provider is changed.
 app.get('/speaking-mock-audio/:id.mp3',(req,res)=>res.sendFile(source));
 app.use((req,res,next)=>{if(req.method==='POST'&&/\/recordings\//.test(req.path))uploads++;if(req.method==='POST'&&req.path==='/api/speaking-mocks/attempts')created++;next();});
 const service=installSpeakingMock(app,{pool:db.first,directory,now:()=>Date.now()+offset,verifyToken:token=>token==='alice'?'alice':null,getAccount:async()=>({}),azureAvailable:false,gradeResponse:async()=>{throw Error('The headset and timing checks must not invoke a paid assessment.');}});await service.store.initialise();
 app.use(express.static(path.join(root,'public'),{index:false}));
 app.get('/',(req,res)=>res.type('html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/portal-workspace.css"><link rel="stylesheet" href="/portal-exam-mode.css"><link rel="stylesheet" href="/speaking-mock.css"><link rel="stylesheet" href="/mock-report-ui.css"></head><body style="margin:0"><main id="appShell"><section id="speakingMockPane" class="pane active"></section></main><script>window.currentUserId="alice";sessionStorage.setItem("pte_session_token","alice");window.__mockOffset=0;const realNow=Date.now;Date.now=()=>realNow()+window.__mockOffset;window.__examStarts=0;window.__examBytes=0;window.__promptPlays=0;const record=MediaRecorder.prototype.start;MediaRecorder.prototype.start=function(...args){if(!document.getElementById("sm-check-record")){window.__examStarts++;this.addEventListener("dataavailable",event=>{window.__examBytes+=event.data.size})}return record.apply(this,args)};const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(...args){if(this.src.includes("/speaking-mock-audio/"))window.__promptPlays++;return play.apply(this,args)};</script><script src="/portal-exam-mode.js"></script><script src="/speaking-start-cue.js"></script><script src="/speaking-images.js"></script><script src="/mock-impact-feedback.js"></script><script src="/mock-report-ui.js"></script><script src="/speaking-mock-client.js"></script><script>SpeakingMock.open();</script></body></html>'));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));let browser;
 db.onClose(async()=>{await browser?.close();await service.waitForJobs();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
 browser=await puppeteer.launch({headless:true,...(process.env.FULL_MOCK_TEST_CHROME_PATH?{executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH}:{}),args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-file-for-fake-audio-capture='+microphone]});
 const page=await browser.newPage();await page.setViewport(mobile?{width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:1}:{width:1365,height:1000});page.setDefaultTimeout(15000);const errors=[],dialogs=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>{dialogs.push(dialog.message());dialog.dismiss();});
 await page.setRequestInterception(true);page.on('request',request=>request.url().startsWith('http://127.0.0.1:')||request.url().startsWith('blob:')||request.url().startsWith('data:')?request.continue():request.abort());
 const click=async selector=>{await page.$eval(selector,node=>node.scrollIntoView({block:'center'}));if(mobile)await page.tap(selector);else await page.click(selector);};
 const advance=async ms=>{offset+=ms;await page.evaluate(ms=>window.__mockOffset+=ms,ms);};
 try{
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('[data-sm="start"]');await click('[data-sm="start"][data-paper="'+bank.papers[paperIndex].id+'"]');
 await page.waitForSelector('#sm-check-record');assert.equal(created,0);assert.equal(uploads,0);assert(await page.$eval('#sm-check-begin',node=>node.disabled));
 await click('#sm-check-record');await page.waitForFunction(()=>!document.getElementById('sm-check-play').disabled);assert.equal(created,0);assert.equal(uploads,0);
 await click('#sm-check-play');await page.waitForFunction(()=>!document.getElementById('sm-check-heard').disabled);assert(await page.$eval('#sm-check-begin',node=>node.disabled));
 await click('#sm-check-heard');await click('#sm-check-begin');await page.waitForSelector('#sm-next');await page.waitForFunction(()=>/^(40:00|39:\d{2})$/.test(document.getElementById('sm-overall-time')?.textContent||''));assert.equal(created,1);assert(await page.$eval('#sm-next',node=>node.getBoundingClientRect().bottom<=innerHeight),'Next is inside the protected viewport');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Speaking header overflows the viewport');await fs.mkdir(path.join(root,'.cache'),{recursive:true});await page.screenshot({path:path.join(root,'.cache','speaking-mock-timer-'+(paperIndex+1)+'-'+(mobile?'mobile':'desktop')+'.png')});assert.equal(uploads,0);assert(await page.evaluate(()=>!!document.fullscreenElement));
 const [summary]=await service.store.list('alice'),attempt=await service.store.get('alice',summary.id),index=attempt.questions.findIndex(q=>q.type==='rts');
 assert.equal(attempt.paperId,bank.papers[paperIndex].id);
 await service.store.update('alice',attempt.id,a=>{a.index=index;a.questions[index].audioSeconds=sample.audioSeconds;delete a.questionStartedAt;delete a.questionTimingVersion;return a;});
 await page.evaluate(()=>SpeakingMock.open({history:true}));await page.waitForSelector('[data-sm="resume"]');await click('[data-sm="resume"]');await page.waitForSelector('#sm-audio-status');
 assert.equal(await page.evaluate(()=>window.__promptPlays),0);assert.match(await page.$eval('#sm-audio-status',node=>node.textContent),/Beginning in/);
 await page.waitForFunction(()=>window.__promptPlays===1);assert.equal(await page.evaluate(()=>window.__examStarts),0);
 await page.waitForFunction(()=>document.getElementById('sm-preparation-status').textContent.includes('0:10'));
 assert.equal(await page.evaluate(()=>window.__examStarts),0);await advance(9000);assert.equal(await page.evaluate(()=>window.__examStarts),0);
 await advance(1100);await page.waitForFunction(()=>window.__examStarts===1);assert.equal(await page.evaluate(()=>window.__promptPlays),1);
 await page.waitForFunction(()=>window.__examBytes>100);
 await click('#sm-next');await until(async()=>!!(await service.store.get('alice',attempt.id)).responses[index]?.recording,'Speaking response was not saved.');assert.equal(uploads,1);
 await page.waitForFunction(item=>document.querySelector('.sm-exam-header')?.textContent.includes('Item '+item+' of'),{},index+2);
 const imageIndex=attempt.questions.findIndex(q=>q.type==='di'),image=attempt.questions[imageIndex];
 await service.store.update('alice',attempt.id,a=>{a.index=imageIndex;delete a.questionStartedAt;delete a.questionTimingVersion;return a;});
 await page.evaluate(()=>SpeakingMock.open({history:true}));await page.waitForSelector('[data-sm="resume"]');await click('[data-sm="resume"]');
 await page.waitForSelector('.sm-image-title',{visible:true});assert.equal(await page.$eval('.sm-image-title',node=>node.textContent),image.title);
 assert.equal(await page.$eval('.sm-exam-image img',node=>node.alt),image.title);
 assert(await page.evaluate(()=>document.querySelector('.sm-image-title').getBoundingClientRect().bottom<=document.querySelector('.sm-exam-image').getBoundingClientRect().top),'Image title is above the image');
 const imageViewport=page.viewport();await page.setViewport({...imageViewport,height:420});
 await page.$eval('.sm-exam-main',node=>{node.scrollTop=0;});await page.mouse.move(160,220);await page.mouse.wheel({deltaY:800});
 await page.waitForFunction(()=>document.querySelector('.sm-exam-main').scrollTop>0);await page.mouse.wheel({deltaY:-4000});
 await page.waitForFunction(()=>document.querySelector('.sm-exam-main').scrollTop===0);await page.setViewport(imageViewport);
 await click('.sm-image-enlarge');await page.waitForSelector('#sm-image-dialog[open]');
 assert.equal(await page.$eval('#sm-image-dialog h3',node=>node.textContent),image.title);await click('[data-image-action="close"]');
 await page.evaluate(()=>{
   SpeakingMock.reset();
   PortalExamMode.set('speaking-mock',false,document.getElementById('speakingMockPane'));
   document.getElementById('speakingMockPane').innerHTML=MockReportUI.frame({key:'contribution-layout',title:'Writing mock report',feedback:MockReportUI.impactFeedback(MockImpactFeedback.build({scope:'writing',groups:[{type:'essay',label:'Write Essay',count:1,earned:13,possible:26,complete:true}],profiles:{writing:{weights:{essay:31}}}})),score:MockReportUI.hero({title:'Writing mock',overall:75,skills:[{name:'Writing',value:75}]})+MockReportUI.contributions({section:'writing',groups:[{type:'swt',total:8,maximum:9,count:1,marked:1},{type:'sst',total:6,maximum:12,count:1,marked:1},{type:'wfd',total:12,maximum:20,count:3,marked:3}]})});
 });
 assert.equal(await page.$$eval('[data-contribution-skill]',nodes=>nodes.length),2);
 await click('.ipr-contribution-details summary');assert.equal(await page.$$eval('.ipr-contribution-table tbody tr',nodes=>nodes.length),3);
 await click('[data-mock-tab="feedback"]');await page.waitForSelector('[data-mock-panel="feedback"]:not([hidden]) [data-impact-profile="writing"]');
 assert.match(await page.$eval('.ipr-impact-feedback',node=>node.textContent),/Write Essay/);
 assert.deepEqual(dialogs,[]);assert.deepEqual(errors,[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 }catch(error){t.diagnostic('Screen: '+await page.$eval('body',node=>node.innerText.slice(-2000)));t.diagnostic('Requests: created='+created+' uploads='+uploads+'; page errors='+errors.join('; '));throw error;}
});

test('Speaking Mock 6 loads its prompts, fits all five images and reports the saved question references',{timeout:90000},async t=>{
 const paper=bank.papers.find(candidate=>candidate.id==='speaking-mock-6');
 assert(paper,'Mock 6 is available to start');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-mock-6-browser-'));
 let offset=0,browser;
 const app=express();app.use(express.json());
 const service=installSpeakingMock(app,{directory,now:()=>Date.now()+offset,verifyToken:token=>token==='alice'?'alice':null,getAccount:async()=>({}),azureAvailable:true,
   gradeResponse:async q=>{
     const maximum=require('../speaking-mock-report').contentMaximum(q);
     return {transcript:'Saved answer for '+q.id,content:{scoringMode:'ai',total:maximum,maximum},azure:{status:'assessed',pronunciation:{score:4},fluency:{score:4}}};
   }});
 await service.store.initialise();
 app.use(express.static(path.join(root,'public'),{index:false}));
 const styles=(await fs.readFile(path.join(root,'public','index.html'),'utf8')).match(/<link rel="stylesheet" href="(?!https?:|\/\/)[^"]+"[^>]*>/g).join('');
 app.get('/',(req,res)=>res.type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
 ${styles}</head>
 <body style="margin:0"><main id="appShell"><section id="speakingMockPane" class="pane active"></section></main>
 <script>window.currentUserId="alice";sessionStorage.setItem("pte_session_token","alice");window.__mockOffset=0;const realNow=Date.now;Date.now=()=>realNow()+window.__mockOffset;</script>
 <script src="/portal-exam-mode.js"></script><script src="/speaking-start-cue.js"></script><script src="/speaking-images.js"></script><script src="/mock-impact-feedback.js"></script><script src="/mock-report-ui.js"></script>
 <script>
 // The tests above cover native fullscreen. Keep its viewport styling here while independently exercising all Mock 6 questions.
 const examSet=PortalExamMode.set;
 PortalExamMode.set=(owner,enabled,pane)=>examSet(owner,enabled,pane);
 PortalExamMode.prepare=async(owner,pane)=>{examSet(owner,true,pane);return true;};
 </script>
 <script src="/speaking-mock-client.js"></script><script>SpeakingMock.open({history:true});</script></body></html>`));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{await browser?.close();await service.waitForJobs();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port,id=require('node:crypto').randomUUID();
 const request=async(route,body)=>{
   const recording=Buffer.isBuffer(body),reply=await fetch(base+'/api/speaking-mocks'+route,{method:body===undefined?'GET':'POST',headers:{'x-session-token':'alice','Content-Type':recording?'audio/webm':'application/json'},body:recording?body:JSON.stringify(body)});
   const result=await reply.json();
   assert(reply.ok,route+': '+JSON.stringify(result));
   return result;
 };
 assert((await request('/catalog')).papers.some(candidate=>candidate.id===paper.id));
 const attempt='/attempts/'+id;
 let active=await request('/attempts',{id,paperId:paper.id});
 assert.equal(active.deadline-active.startedAt,40*60000);
 browser=await puppeteer.launch({headless:true,...(process.env.FULL_MOCK_TEST_CHROME_PATH?{executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH}:{}),args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 const page=await browser.newPage();
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 page.setDefaultTimeout(8000);
 const images=[];
 for(const [index,question] of paper.questions.entries()){
   assert.equal(active.question.id,question.id);
   const {audioUrl,imageUrl,displayImageUrl}=active.question;
   for(const [url,type] of [[audioUrl,'audio/'],[imageUrl,'image/'],[displayImageUrl,'image/']]){
     if(!url)continue;
     const media=await fetch(base+url);
     assert(media.ok&&media.headers.get('content-type')?.startsWith(type),question.id+' failed to load '+url);
     assert((await media.arrayBuffer()).byteLength>100,question.id+' has an empty media file');
   }
   if(question.type==='di'){
     images.push({index,question});
     await page.setViewport({width:1366,height:768});
     await page.goto(base);
     await page.evaluate(ms=>window.__mockOffset=ms,offset);
     await page.waitForSelector('[data-sm="resume"]');
     await page.click('[data-sm="resume"]');
     await page.waitForFunction(title=>document.querySelector('.sm-exam-image img')?.naturalWidth>0&&document.querySelector('.sm-image-title')?.textContent===title,{},question.title).catch(async error=>{t.diagnostic(await page.$eval('body',node=>node.innerText.slice(-1400)));throw error;});
     for(const viewport of [{width:1280,height:720},{width:1366,height:768},{width:1440,height:900}]){
       await page.setViewport(viewport);
       const dimensions=await page.$eval('.sm-exam-image img',img=>{
         const rect=img.getBoundingClientRect(),area=document.querySelector('.sm-exam-main').getBoundingClientRect();
         return {width:rect.width,height:rect.height,ratio:img.naturalWidth/img.naturalHeight,scale:rect.width/img.naturalWidth,fits:rect.top>=area.top&&rect.bottom<=area.bottom&&rect.left>=area.left&&rect.right<=area.right,objectFit:getComputedStyle(img).objectFit};
       });
       assert(dimensions.fits&&dimensions.width>=260&&dimensions.height>=180,question.id+' viewport '+JSON.stringify(dimensions));
       assert(Math.abs(dimensions.width/dimensions.height-dimensions.ratio)<.02,question.id+' image aspect ratio');
       assert(dimensions.scale<=1.01&&dimensions.objectFit==='contain',question.id+' image scaling');
       await page.click('.sm-image-enlarge');
       await page.waitForSelector('#sm-image-dialog[open] img');
       assert.equal(await page.$eval('#sm-image-dialog h3',node=>node.textContent),question.title);
       await page.click('[data-image-action="in"]');
       assert.equal(await page.$eval('[data-image-scale]',node=>node.textContent),'125%');
       await page.click('[data-image-action="close"]');
     }
     await page.goto('about:blank');
   }
   active=await request(attempt+'/begin',{index});
   offset+=Math.max(0,active.timing.recordingAt-Date.now()-offset+500);
   await request(attempt+'/recordings/'+index,Buffer.alloc(200,index+1));
   active=await request(attempt+'/next',{index});
 }
 assert.equal(images.length,5);
 assert.equal(active.status,'submitted');
 await service.waitForJobs();
 const outcome=await request(attempt),saved=await service.store.get('alice',id);
 assert.equal(outcome.grading.status,'complete');
 for(const [index,question] of paper.questions.entries()){
   assert.equal(saved.responses[index].recording.hash,require('node:crypto').createHash('sha256').update(Buffer.alloc(200,index+1)).digest('hex'));
   assert.equal(outcome.responses[index].question.id,question.id);
   assert.equal(outcome.responses[index].question.sample,question.sample);
   assert.deepEqual(outcome.responses[index].question.facts,question.facts);
 }
 await page.goto(base);await page.waitForSelector('[data-sm="resume"]');await page.click('[data-sm="resume"]');await page.waitForSelector('#sm-report');
 await page.click('#sm-tab-answers');await page.select('#sm-task-picker','di');
 for(const {index,question} of images){
   await page.select('#sm-question-picker',String(index));
   assert.equal(await page.$eval('#sm-review-heading',node=>node.textContent),question.title);
   await page.click('#sm-response-tab-sample');
   assert.equal(await page.$eval('.sm-sample-response p:not(.sm-eyebrow)',node=>node.textContent),question.sample);
 }
 assert.deepEqual(errors,[]);
});
