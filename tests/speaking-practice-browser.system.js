'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),express=require('express'),puppeteer=require('puppeteer'),run=require('node:util').promisify(require('node:child_process').execFile);
const {installSpeakingLab}=require('../speaking-lab'),{until}=require('./helpers/full-mock-systems');
const root=path.resolve(__dirname,'..');
for(const width of [1365,390])test('Speaking practice '+width+'px: RTS modes plus RL/SGD pre-audio buffer, ten-second preparation and recording cues',{timeout:60000},async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'speaking-modes-browser-')),source=path.join(root,'content/speaking-audio/rs-1.mp3'),clip=path.join(directory,'prompt.mp3'),mic=path.join(directory,'mic.wav');
 await run('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-i',source,'-t','2','-c:a','libmp3lame',clip]);await run('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-i',source,'-ar','48000','-ac','1','-c:a','pcm_s16le',mic]);
 const app=express();app.use(express.json());app.get('/speaking-audio/:id.mp3',(_,res)=>res.type('audio/mpeg').sendFile(clip));app.get('/practice-audio/:key.mp3',(_,res)=>res.type('audio/mpeg').sendFile(clip));const service=installSpeakingLab(app,{directory,verifyToken:token=>token==='fixture'?'fixture':null,getAccount:async()=>({}),transcriptionAvailable:true,transcribe:async()=> 'Could you help me submit my assignment another way?',deliveryAssessmentAvailable:false,azureComparisonAvailable:false,narratePrompt:async()=>clip});
 app.get('/',(_,res)=>res.type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/practice-studio.css"><link rel="stylesheet" href="/speaking-practice.css"><link rel="stylesheet" href="/question-navigation.css"><style>:root{--bg-card:white;--ink:#18242d;--ink-soft:#526371;--accent:#005c8b;--bg-hover:#f3f6f8;--line:#d9dfe4}body{margin:0;padding:12px;font-family:Arial}</style></head><body><main id="speakingPane"></main><script>window.currentUserId='fixture';localStorage.setItem('pte_session_token','fixture');window.__offset=0;const nativeNow=Date.now;Date.now=()=>nativeNow()+window.__offset;window.__records=0;window.__beeps=0;const nativeToneStart=OscillatorNode.prototype.start;OscillatorNode.prototype.start=function(...args){window.__beeps++;return nativeToneStart.apply(this,args)};window.__bytes=0;window.__plays=0;const nativeStart=MediaRecorder.prototype.start;MediaRecorder.prototype.start=function(...args){window.__records++;this.addEventListener('dataavailable',e=>window.__bytes+=e.data.size);return nativeStart.apply(this,args)};const nativePlay=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(...args){window.__plays++;return nativePlay.apply(this,args)};</script><script src="/practice-catalogue.js"></script><script src="/practice-studio.js"></script><script src="/speaking-start-cue.js"></script><script src="/speaking-images.js"></script><script src="/speaking-practice.js"></script><script>SpeakingPractice.open('rts');</script></body></html>`));app.use(express.static(path.join(root,'public'),{index:false}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));let browser;
 t.after(async()=>{await browser?.close();await service.waitForAssessments();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
 browser=await puppeteer.launch({headless:true,...(process.env.FULL_MOCK_TEST_CHROME_PATH?{executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH}:{}),args:['--autoplay-policy=no-user-gesture-required','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-file-for-fake-audio-capture='+mic]});
 const page=await browser.newPage();await page.setViewport({width,height:950});page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
 const click=async selector=>{await page.locator(selector).click();};
 await click('[data-speaking-mode="untimed"]');await click('[data-speaking-question="rts-original-20261024-01"]');
 await page.waitForFunction(()=>document.getElementById('speaking-phase')?.textContent==='Ready when you are');assert.equal(await page.evaluate(()=>__plays),1);assert.equal(await page.evaluate(()=>__records),0);
 await page.evaluate(()=>__offset+=120000);assert.equal(await page.$eval('#speaking-clock',e=>e.textContent),'Untimed');await click('#speaking-ready-start');await page.waitForFunction(()=>__bytes>100);
 await page.evaluate(()=>__offset+=120000);assert.equal(await page.$eval('#speaking-phase',e=>e.textContent),'● Recording');await click('#speaking-finish');
 await until(async()=>!!(await service.store.list('fixture'))[0]?.recording,'Untimed response did not save');await page.waitForFunction(()=>!document.querySelector('[data-speaking-action="list"]').disabled);await click('[data-speaking-action="list"]');
 await click('[data-speaking-mode="timed"]');await click('[data-speaking-question="rts-original-20261024-01"]');await page.waitForFunction(()=>document.getElementById('speaking-phase')?.textContent==='Audio starts in');assert.equal(await page.$eval('#speaking-clock',e=>e.textContent),'0:05');await page.evaluate(()=>__offset+=5001);await page.waitForFunction(()=>document.getElementById('speaking-phase')?.textContent==='Preparation');
 assert.equal(await page.$eval('#speaking-clock',e=>e.textContent),'0:10');assert.equal(await page.evaluate(()=>__records),1);await page.evaluate(()=>__offset+=9000);assert.equal(await page.evaluate(()=>__records),1);await page.evaluate(()=>__offset+=1100);await page.waitForFunction(()=>__records===2);
 const previousBytes=await page.evaluate(()=>__bytes);await page.waitForFunction(bytes=>__bytes>bytes+100,{},previousBytes);await page.evaluate(()=>__offset+=40001);await until(async()=>(await service.store.list('fixture')).filter(a=>a.recording).length===2,'Timed response did not stop and save');
 for(const [type,questionId,seconds] of [['rl','rl-1',40],['sgd','sgd-1',120]]){
  const before=await page.evaluate(()=>({records:__records,beeps:__beeps,plays:__plays}));
  await page.evaluate(type=>SpeakingPractice.open(type),type);await click('[data-speaking-question="'+questionId+'"]');
  await page.waitForFunction(()=>document.getElementById('speaking-phase')?.textContent==='Audio starts in');
  assert.equal(await page.$eval('#speaking-clock',e=>e.textContent),'0:05');assert.equal(await page.evaluate(()=>__plays),before.plays);
  await page.evaluate(()=>__offset+=4000);assert.equal(await page.evaluate(()=>__plays),before.plays);
  await page.evaluate(()=>__offset+=1100);await page.waitForFunction(n=>__plays===n,{},before.plays+1);
  await page.waitForFunction(()=>document.getElementById('speaking-phase')?.textContent==='Preparation');
  assert.equal(await page.$eval('#speaking-clock',e=>e.textContent),'0:10');
  await page.evaluate(()=>__offset+=9000);assert.equal(await page.evaluate(()=>__records),before.records);assert.equal(await page.evaluate(()=>__beeps),before.beeps);
  await page.evaluate(()=>__offset+=1100);await page.waitForFunction(n=>__records===n,{},before.records+1);
  assert.equal(await page.evaluate(()=>__beeps),before.beeps+1);
  const remaining=await page.$eval('#speaking-clock',e=>e.textContent.split(':').reduce((n,v)=>n*60+Number(v),0));assert(remaining>=seconds-1,'The beep must not consume the response window');
  const bytes=await page.evaluate(()=>__bytes);await page.waitForFunction(n=>__bytes>n+100,{},bytes);
  await page.evaluate(ms=>__offset+=ms,(seconds+1)*1000);
  await until(async()=>(await service.store.list('fixture')).some(a=>a.questionId===questionId&&a.recording),'Buffered response did not stop and save');
  await page.waitForFunction(()=>!document.querySelector('[data-speaking-action="list"]').disabled);await click('[data-speaking-action="list"]');
 }
 const attempts=await service.store.list('fixture');assert.equal(attempts.length,4);assert.deepEqual(attempts.filter(a=>a.questionId==='rts-original-20261024-01').map(a=>a.practiceMode).sort(),['timed','untimed']);await page.evaluate(()=>SpeakingPractice.open('rs'));await click('[data-speaking-question="rs-1"]');await page.waitForFunction(()=>document.getElementById('speaking-phase')?.textContent==='Audio starts in');
 const draft=(await service.store.list('fixture')).find(a=>a.questionId==='rs-1');await page.evaluate(()=>__offset+=2000);await click('[data-speaking-action="list"]');await click('[data-speaking-resume-question="rs-1"][data-speaking-attempt="'+draft.id+'"]');
 await page.waitForFunction(()=>document.getElementById('speaking-phase')?.textContent.includes('paused'));assert.equal((await service.store.list('fixture')).filter(a=>a.questionId==='rs-1').length,1);assert.match(await page.$eval('#speaking-clock',e=>e.textContent),/0:0[23]/);
 await click('#speaking-record');await page.evaluate(()=>__offset+=3500);await page.waitForFunction(()=>document.getElementById('speaking-phase')?.textContent==='Listening');assert.equal(await page.$eval('[data-speaking-action="reattempt"]',e=>e.disabled),false);assert.equal(await page.$eval('[data-speaking-move="1"]',e=>e.disabled),false);
 await click('[data-speaking-action="reattempt"]');await page.waitForFunction(()=>document.getElementById('speaking-phase')?.textContent==='Audio starts in');await page.waitForFunction(()=>document.querySelector('#speaking-question-history [data-speaking-attempt]'));
 assert.equal((await service.store.list('fixture')).filter(a=>a.questionId==='rs-1').length,2);assert(await page.$eval('#speaking-question-history',e=>e.textContent.includes('Previous attempts')));assert((await service.store.get('fixture',draft.id)));
 await fs.mkdir(path.join(root,'.cache'),{recursive:true});await page.screenshot({path:path.join(root,'.cache','practice-speaking-'+width+'.png')});
 assert.deepEqual(errors,[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
});


test('Local RTS narration produces playable audio without an external speech service',{timeout:20000},async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'rts-local-audio-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const {createPromptNarrator}=require('../speaking-practice-prompts'),file=await createPromptNarrator(directory)({type:'rts',text:'Please ask your tutor for help with your assignment.'});
 const {stdout}=await run('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',file]);assert(Number(stdout)>1);await run('ffmpeg',['-v','error','-i',file,'-f','null','-']);
});
