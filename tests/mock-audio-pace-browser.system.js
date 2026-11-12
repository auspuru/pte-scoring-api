'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),puppeteer=require('puppeteer');
const audio=require('../mock-audio-pace'),entries=require('../content/mock-audio-pace.json').entries;
test('Desktop and mobile play each normal mock task through native audio at rate one and receive its end event',{timeout:60000},async t=>{
 const app=express();audio.install(app);app.get('/',(_,res)=>res.send('<!doctype html><button id="play">Play</button><audio id="audio" controls></audio>'));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
 t.after(async()=>{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
 browser=await puppeteer.launch({headless:true,...(process.env.FULL_MOCK_TEST_CHROME_PATH?{executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH}:{})});
 for(const width of [390,1440]){
  const page=await browser.newPage();await page.setViewport({width,height:800});await page.goto('http://127.0.0.1:'+server.address().port);
  for(const type of audio.TYPES){
   const entry=Object.entries(entries).find(([key,e])=>key.startsWith(type+'-')&&e.publicMockPlayback)[1];
   await page.evaluate(src=>{const a=document.getElementById('audio');window.ended=false;a.onended=()=>window.ended=true;a.src=src;document.getElementById('play').onclick=()=>a.play();},'/mock-audio/'+entry.audioSha256+'.mp3');
   await page.click('#play');await page.waitForFunction(()=>document.getElementById('audio').currentTime>.02);
   const metadata=await page.$eval('#audio',a=>({rate:a.playbackRate,duration:a.duration}));
   assert.equal(metadata.rate,1);assert(Math.abs(metadata.duration-entry.seconds)<.1,type);
   await page.$eval('#audio',a=>{a.currentTime=a.duration-.08;});await page.waitForFunction(()=>window.ended===true);
  }await page.close();
 }
});
