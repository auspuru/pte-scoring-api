'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises'),express=require('express'),puppeteer=require('puppeteer');
const {fixture,secondRecording}=require('./helpers/delivery-reassessment-fixture');
const result={version:'synthetic-continuous',pronunciation:{score:3,raw:75},fluency:{score:2,raw:60}};
test('Admin real HTTP clicks queue selected and whole-mock audio, show progress and publish atomically on mobile and desktop',{timeout:60000},async t=>{
 const browser=await puppeteer.launch({headless:true,executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH||'/usr/bin/chromium'});t.after(()=>browser.close());
 for(const width of [390,1440])await t.test(String(width),async t=>{
  const f=await fixture(t,async()=>result);await secondRecording(f);const before=(await f.store.get(f.owner,f.id)).state;
  const app=express(),posts=[];app.use(express.json());
  const requireAdmin=(req,res,next)=>req.headers['x-admin-key']==='isolated-auth-test-admin'?next():res.sendStatus(403);
  app.get('/api/admin/users',requireAdmin,(req,res)=>res.json([{username:f.owner,hasAccount:true,createdAt:new Date().toISOString()}]));
  app.get('/api/admin/user-data/:username',requireAdmin,(req,res)=>res.json({account:{username:f.owner},progress:{}}));
  app.use((req,res,next)=>{if(req.method==='POST'&&req.path.endsWith('/delivery/send'))posts.push(req.body);next();});
  let calls=0;
  require('../full-mock/api').installFullMock(app,{directory:f.directory,assessment:{},verifyToken:()=>null,getAccount:async username=>username===f.owner?{username}:null,requireAdmin,deliveryReassessment:{assess:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,80));return result;}}});
  app.get('/admin',(req,res)=>res.sendFile(path.resolve('public/admin.html')));app.use(express.static(path.resolve('public')));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));t.after(()=>page.close());await page.setViewport({width,height:900});
  await page.goto('http://127.0.0.1:'+server.address().port+'/admin');await page.type('#adminKeyInput','isolated-auth-test-admin');await page.click('#authCard > button');await page.waitForSelector('#dashboard',{visible:true});
  await page.click('button[onclick="viewUser(\''+f.owner+'\')"]');await page.waitForSelector('[data-full-list]',{visible:true});await page.click('[data-full-list]');await page.waitForSelector('[data-full-select]');await page.select('[data-full-select]',f.id);await page.click('[data-full-inspect]');await page.waitForSelector('[data-delivery-load]');await page.click('[data-delivery-load]');await page.waitForSelector('[data-delivery-send-all]');
  assert.equal(await page.$$eval('[data-delivery-question]',inputs=>inputs.length),2);
  if(width===390)await page.locator('[data-delivery-send-all]').click();else{await page.locator('[data-delivery-select-all]').click();assert.equal(await page.$$eval('[data-delivery-question]',inputs=>inputs.filter(input=>input.checked).length),2);await page.locator('[data-delivery-send-selected]').click();}
  await page.waitForFunction(()=>document.querySelector('[data-full-notice]').textContent.includes('Azure reassessment:'));
  await page.waitForFunction(()=>document.querySelector('[data-full-notice]').textContent.startsWith('Replacement scores published.'),{timeout:15000});
  assert.equal(posts.length,1);assert.equal(posts[0].questionIds.length,2);assert.equal(posts[0].autoPublish,true);assert.equal(calls,2);
  await fs.mkdir('.cache',{recursive:true});await page.screenshot({path:'.cache/admin-azure-batch-'+width+'.png',fullPage:true});
  const after=(await f.store.get(f.owner,f.id)).state;assert.equal(after.assessment.items[f.q.id].result.scores.fluency,2);assert.deepEqual(after.responses,before.responses);assert.equal(await page.$eval('#fullMockRecoveryPanel',el=>el.scrollWidth<=el.clientWidth+1),true);assert.deepEqual(errors,[]);
 });
});
