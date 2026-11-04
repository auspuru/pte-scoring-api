'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),express=require('express'),puppeteer=require('puppeteer');
const {installSpeakingLab}=require('../speaking-lab'),prompts=require('../rts-prompts'),bank=require('../content/speaking-bank');
test('Desktop plays the complete served neural RTS recording at normal speed without runtime narration',{timeout:45000},async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'rts-neural-desktop-')),app=express();app.use(express.json());let narrationCalls=0;
 const service=installSpeakingLab(app,{directory,verifyToken:t=>t==='fixture'?'fixture':null,getAccount:async()=>({}),transcriptionAvailable:false,deliveryAssessmentAvailable:false,azureComparisonAvailable:false,narratePrompt:async()=>{narrationCalls++;throw Error('No runtime narration');}});
 app.get('/',(_,res)=>res.type('html').send('<!doctype html><html><body><audio id="prompt" controls></audio></body></html>'));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
 t.after(async()=>{await browser?.close();await service.waitForAssessments();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(directory,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port,q=bank.questions.find(q=>q.id==='rts-original-20261024-01'),entry=prompts.audioEntry(q);
 const created=await fetch(base+'/api/speaking/attempts',{method:'POST',headers:{'Content-Type':'application/json','x-session-token':'fixture'},body:JSON.stringify({id:crypto.randomUUID(),questionId:q.id,practiceMode:'timed'})});assert.equal(created.status,200);const attempt=await created.json();
 const response=await fetch(base+attempt.question.audioUrl);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/immutable/);assert.equal(crypto.createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'),entry.audioSha256);
 browser=await puppeteer.launch({headless:true,...(process.env.FULL_MOCK_TEST_CHROME_PATH?{executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH}:{}),args:['--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage();await page.setViewport({width:1365,height:900});await page.goto(base);
 const result=await page.evaluate(async url=>{
  const audio=document.getElementById('prompt');audio.src=url;
  await new Promise((resolve,reject)=>{audio.addEventListener('loadedmetadata',resolve,{once:true});audio.addEventListener('error',()=>reject(Error('Audio load failed')),{once:true});});
  const ended=new Promise((resolve,reject)=>{audio.addEventListener('ended',resolve,{once:true});audio.addEventListener('error',()=>reject(Error('Playback failed')),{once:true});});
  await audio.play();await ended;return {duration:audio.duration,time:audio.currentTime,ended:audio.ended,rate:audio.playbackRate};
 },attempt.question.audioUrl);
 assert(result.ended);assert.equal(result.rate,1);assert(Math.abs(result.duration-entry.seconds)<0.1);assert(Math.abs(result.time-result.duration)<0.1);assert.equal(narrationCalls,0);
});
