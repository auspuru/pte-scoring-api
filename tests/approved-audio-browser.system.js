'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),express=require('express'),puppeteer=require('puppeteer');
const audio=require('../approved-audio'),bank=require('../public/reading-bank.json');
test('Desktop HIW plays the complete fixed recording without device synthesis and persists the volume lifecycle',{timeout:90000},async t=>{
 const app=express();audio.install(app);app.use(express.static(path.join(__dirname,'../public'),{index:false}));app.get('/',(_,res)=>res.type('html').send('<!doctype html><html><body><button id="play">Play audio</button><div id="state"></div><script src="/reading-mock-tools.js"></script></body></html>'));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;t.after(async()=>{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
 browser=await puppeteer.launch({headless:true,...(process.env.FULL_MOCK_TEST_CHROME_PATH?{executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH}:{}),args:['--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage();await page.setViewport({width:1365,height:900});await page.goto('http://127.0.0.1:'+server.address().port);
 const q=bank.practiceLibraries.flatMap(l=>l.questions).find(q=>q.id==='hiw-15');assert(q);
 await page.evaluate(q=>{window.__events=[];window.__media=[];window.__synthesis=0;const NativeAudio=window.Audio;window.Audio=function(...args){const value=new NativeAudio(...args);window.__media.push(value);return value;};speechSynthesis.speak=()=>{window.__synthesis++;throw Error('Unexpected device speech');};window.__question=ReadingMockTools.approvedQuestion(q);window.__speaker=ReadingMockTools.createSpeaker(window,(key,state,message)=>{window.__events.push({key,state,message});document.getElementById('state').textContent=state;});document.getElementById('play').onclick=()=>__speaker.play(__question.uid||__question.id,__question.audioText,ReadingMockTools.audioPlayback(__question));},q);
 await page.locator('#play').click();await page.waitForFunction(()=>__events.some(e=>e.state==='playing'));
 await page.evaluate(()=>__speaker.setVolume(.4));assert.equal(await page.evaluate(()=>__media[0].volume),.4);
 await page.waitForFunction(()=>__events.some(e=>e.state==='complete'),{timeout:70000});const result=await page.evaluate(()=>({calls:__synthesis,events:__events,rate:__media[0].playbackRate,duration:__media[0].duration,current:__media[0].currentTime}));
 assert.equal(result.calls,0);assert.equal(result.rate,1);assert.equal(result.events.filter(e=>e.state==='complete').length,1);assert(!result.events.some(e=>e.state==='error'));assert(Math.abs(result.duration-audio.entryFor(q).seconds)<.1);assert(Math.abs(result.current-result.duration)<.1);
});
