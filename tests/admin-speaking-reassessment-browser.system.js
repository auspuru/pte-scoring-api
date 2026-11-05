'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),express=require('express'),puppeteer=require('puppeteer');
const {fixture,raw,content}=require('./helpers/speaking-reassessment-fixture');
test('Admin Speaking selected and whole-mock resends publish automatically on mobile and desktop',{timeout:90000},async t=>{
 const browser=await puppeteer.launch({headless:true,executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH||'/usr/bin/chromium'});t.after(()=>browser.close());
 for(const width of [390,1440])await t.test(String(width),async t=>{
  let calls=0;const requireAdmin=(req,res,next)=>req.headers['x-admin-key']==='synthetic-admin'?next():res.sendStatus(403);
  const f=await fixture(t,{requireAdmin,deliveryReassessment:{assess:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,35));return raw;},gradeContent:async q=>content(q)}}),app=f.app;
  app.get('/api/admin/users',requireAdmin,(req,res)=>res.json([{username:f.owner,hasAccount:true,createdAt:new Date().toISOString()}]));
  app.get('/api/admin/user-data/:username',requireAdmin,(req,res)=>res.json({account:{username:f.owner},progress:{}}));
  app.get('/api/admin/speaking-mocks/:owner/:id/scoring',requireAdmin,async(req,res)=>res.json(await f.service.progressive.diagnostics(req.params.owner,req.params.id)));
  app.get('/admin',(req,res)=>res.sendFile(path.resolve('public/admin.html')));app.use(express.static(path.resolve('public')));
  const posts=[];const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/delivery/send'))posts.push(JSON.parse(request.postData()));});t.after(()=>page.close());await page.setViewport({width,height:900});
  await page.goto('http://127.0.0.1:'+server.address().port+'/admin');await page.type('#adminKeyInput','synthetic-admin');await page.click('#authCard > button');await page.waitForSelector('#dashboard',{visible:true});
  await page.click('button[onclick="viewUser(\''+f.owner+'\')"]');await page.waitForSelector('[data-mock-list]',{visible:true});await page.locator('[data-mock-list]').click();await page.waitForSelector('[data-mock-select]');await page.select('[data-mock-select]',f.id);await page.locator('[data-mock-inspect]').click();await page.waitForSelector('#mockRecoveryPanel [data-delivery-load]');await page.locator('#mockRecoveryPanel [data-delivery-load]').click();await page.waitForSelector('#mockRecoveryPanel [data-delivery-send-all]');
  assert.equal(await page.$$eval('#mockRecoveryPanel [data-delivery-question]',inputs=>inputs.length),27);
  if(width===390)await page.locator('#mockRecoveryPanel [data-delivery-send-all]').click();else{
   const boxes=await page.$$('#mockRecoveryPanel [data-delivery-question]');await boxes[0].click();await boxes[1].click();await page.locator('#mockRecoveryPanel [data-delivery-send-selected]').click();
  }
  await page.waitForFunction(()=>document.querySelector('[data-mock-notice]').textContent.startsWith('Replacement scores published.'),{timeout:30000});
  assert.equal(posts.length,1);assert.equal(posts[0].autoPublish,true);assert.equal(posts[0].questionIds.length,width===390?27:2);assert.equal(calls,width===390?27:2);
  const a=await f.store.get(f.owner,f.id);assert.equal(Object.values(a.deliveryReassessments)[0].status,'published');assert.equal(require('../speaking-mock').present(a).scoreChanges[0].changes.length,calls);
  assert.equal(await page.$eval('#mockRecoveryPanel',el=>el.scrollWidth<=el.clientWidth+1),true);assert.deepEqual(errors,[]);
  await page.screenshot({path:'.cache/admin-speaking-reassessment-'+width+'.png',fullPage:true});
 });
});
