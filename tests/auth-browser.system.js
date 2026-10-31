'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),puppeteer=require('puppeteer'),{fixture}=require('./helpers/auth-server');
test('Admin sign-in controls remain separate and usable in both themes at mobile and desktop sizes',{timeout:60000},async t=>{
 const f=await fixture(t);
 const browser=await puppeteer.launch({headless:true,...(process.env.FULL_MOCK_TEST_CHROME_PATH?{executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH}:{})});
 t.after(()=>browser.close());
 const page=await browser.newPage();
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
 for(const width of [320,390,768,1440]){
  await page.setViewport({width,height:900});
  for(const theme of ['dark','light']){
   await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:theme},{name:'prefers-reduced-motion',value:'reduce'}]);
   await page.goto(f.base+'/admin');
   await page.waitForSelector('#authCard .theme-toggle',{visible:true});
   const layout=await page.evaluate(()=>{
    const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
    return {theme:rect('#authCard .theme-toggle'),brand:rect('#authCard .admin-brand-lockup'),input:rect('#adminKeyInput'),eye:rect('.admin-key-toggle'),submit:rect('#authCard > button'),overflow:document.documentElement.scrollWidth>innerWidth,light:document.body.classList.contains('light-mode'),logoLoaded:document.querySelector('#authCard img').naturalWidth>0};
   });
   const context=width+'px '+theme;
   assert.equal(layout.overflow,false,context+' has no horizontal overflow');
   assert.equal(layout.light,theme==='light');assert.ok(layout.logoLoaded,context+' loads the original logo');
   assert.ok(layout.theme.width>=44&&layout.theme.width<=48,context+' compact theme target');
   assert.ok(layout.theme.left>=layout.brand.right,context+' theme does not cover brand or heading');
   assert.ok(layout.input.top>=Math.max(layout.brand.bottom,layout.theme.bottom),context+' header is above the field');
   assert.ok(layout.eye.width>=44&&layout.eye.height>=44,context+' usable key visibility target');
   assert.ok(layout.eye.right<=layout.input.right&&layout.eye.left>=layout.input.left,context+' visibility control is inside field');
   assert.ok(layout.submit.top>=layout.input.bottom,context+' submit is below field');
   await page.type('#adminKeyInput','synthetic-visual-check');
   await page.click('.admin-key-toggle');
   assert.equal(await page.$eval('#adminKeyInput',e=>e.type),'text');
   assert.equal(await page.$eval('.admin-key-toggle',e=>e.getAttribute('aria-label')),'Hide admin key');
   await page.keyboard.press('Space');
   assert.equal(await page.$eval('#adminKeyInput',e=>e.type),'password');
   assert.equal(await page.$eval('#adminKeyInput',e=>e.value),'synthetic-visual-check');
   await page.click('#authCard .theme-toggle');
   assert.equal(await page.$eval('body',e=>e.classList.contains('light-mode')),theme!=='light');
   await page.evaluate(()=>localStorage.removeItem('pte_theme'));
  }
 }
 assert.deepEqual(errors,[]);
});
test('AUTH-01/03/04: real login, keyboard double-submit and expired-session draft recovery',{timeout:60000},async t=>{
 const f=await fixture(t);await f.request('/api/auth/register',{username:'browser-alice',password:'Password123',email:'alice@example.test'});await f.request('/api/auth/register',{username:'browser-bob',password:'Password123',email:'bob@example.test'});
 const browser=await puppeteer.launch({headless:true,...(process.env.FULL_MOCK_TEST_CHROME_PATH?{executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH}:{})});t.after(()=>browser.close());const page=await browser.newPage();const diagnostics=[];page.on('pageerror',error=>diagnostics.push(error.message));page.on('response',async response=>{if(response.url().includes('/api/auth/')){try{const body=await response.json();diagnostics.push({status:response.status(),route:new URL(response.url()).pathname,success:body.success,error:body.error});}catch{}}});t.after(()=>{if(t.failed)console.error('Isolated auth browser diagnostics',JSON.stringify(diagnostics));});let logins=0;page.on('request',r=>{if(r.url().endsWith('/api/auth/login')&&r.method()==='POST')logins++;});
 async function workspace(stage){try{await page.waitForFunction(()=>document.getElementById('appShell')?.style.display==='grid'&&document.getElementById('loadingVeil')?.classList.contains('hidden'),{timeout:15000});}catch(error){const state=await page.evaluate(()=>({login:document.getElementById('loginScreen')?.style.display,shell:document.getElementById('appShell')?.style.display,error:document.getElementById('loginError')?.textContent,disabled:document.getElementById('loginSubmitBtn')?.disabled,loading:!document.getElementById('loadingVeil')?.classList.contains('hidden'),passwordLength:document.getElementById('loginPassword')?.value.length,user:document.getElementById('loginUsername')?.value}));throw Error(stage+': '+JSON.stringify({state,diagnostics}),{cause:error});}}
 await page.goto(f.base);await page.waitForSelector('#loginUsername');await page.type('#loginUsername','browser-alice');await page.type('#loginPassword','Wrong-pass-123');await page.click('#loginSubmitBtn');await page.waitForSelector('#loginError.show');assert.equal(await page.$eval('#loginSubmitBtn',e=>e.disabled),false);await page.$eval('#loginPassword',e=>e.value='');await page.type('#loginPassword','Password123');
 await page.evaluate(()=>{const form=document.getElementById('loginSubmitForm');form.dispatchEvent(new Event('submit',{cancelable:true}));form.dispatchEvent(new Event('submit',{cancelable:true}));});
 await workspace('first account');assert.equal(logins,2);
 await page.evaluate(()=>switchSection('swt'));await page.click('[data-swt-mode="summary"]');await page.waitForSelector('#summaryInput',{visible:true});await page.type('#summaryInput','A recoverable first-account summary.');assert.equal(await page.$eval('#summaryInput',e=>e.value),'A recoverable first-account summary.');assert.equal(await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('pte_browser-alice_summaries')||'{}')).some(entry=>entry.text==='A recoverable first-account summary.')),true,'The draft is saved before expiry');
 await f.clock(31*24*60*60*1000);await page.evaluate(()=>refreshPracticeHistory({force:true}));await page.waitForFunction(()=>document.getElementById('loginScreen')?.style.display==='flex');
 await f.clock(0);await page.type('#loginUsername','browser-bob');await page.type('#loginPassword','Password123');await page.click('#loginSubmitBtn');await workspace('second account');
 await page.evaluate(()=>switchSection('swt'));await page.click('[data-swt-mode="summary"]');await page.waitForSelector('#summaryInput',{visible:true});assert.equal(await page.$eval('#summaryInput',e=>e.value),'');
 await page.evaluate(()=>signOut());await page.type('#loginUsername','browser-alice');await page.type('#loginPassword','Password123');await page.click('#loginSubmitBtn');await workspace('original account recovery');await page.evaluate(()=>switchSection('swt'));await page.click('[data-swt-mode="summary"]');await page.waitForSelector('#summaryInput',{visible:true});assert.equal(await page.$eval('#summaryInput',e=>e.value),'A recoverable first-account summary.');
});

test('Staff recovery inspects one owned attempt and retries only its missing content',{timeout:60000},async t=>{
 const f=await fixture(t),username='recovery-browser';await f.request('/api/auth/register',{username,password:'Synthetic-pass-123',email:'recovery@example.test'});
 const browser=await puppeteer.launch({headless:true,...(process.env.FULL_MOCK_TEST_CHROME_PATH?{executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH}:{})});t.after(()=>browser.close());
 const page=await browser.newPage();await page.setViewport({width:390,height:900});
 const id='006d4971-2ad3-4f14-8e2a-0ea3ed450bdd',path='/api/admin/speaking-mocks/'+username+'/'+id+'/scoring',repairs=[];let queued=false;
 await page.setRequestInterception(true);page.on('request',async req=>{
  const pathname=new URL(req.url()).pathname;
  if(pathname===path)return req.respond({status:200,contentType:'application/json',body:JSON.stringify({attemptId:id,status:queued?'ready':'delayed',ready:queued,accountedFor:queued?27:26,total:27,jobs:queued?[]:[{id:'job',index:19,status:'needs_attention',stages:{content:{status:'needs_attention',code:'validation'},azure:{status:'ready'}}}]})});
  if(pathname===path+'/retry'){repairs.push(JSON.parse(req.postData()));queued=true;return req.respond({status:200,contentType:'application/json',body:JSON.stringify({status:'queued',jobId:'job'})});}
  await req.continue();
 });
 await page.goto(f.base+'/admin');await page.type('#adminKeyInput','isolated-auth-test-admin');await page.click('#authCard > button');await page.waitForSelector('#dashboard',{visible:true});
 await page.type('[aria-label="Search users"]',username);
 const view=await page.$('button[onclick="viewUser(\''+username+'\')"]');await view.click();
 await page.waitForSelector('[data-mock-attempt]',{visible:true});await page.type('[data-mock-attempt]',id);await page.click('[data-mock-inspect]');await page.waitForSelector('[data-mock-stage="content"]');
 assert.equal(await page.$$eval('[data-mock-stage]',els=>els.length),1);await page.click('[data-mock-stage="content"]');
 await page.waitForFunction(()=>document.querySelector('[data-mock-notice]')?.textContent.includes('Recovery queued'));
 assert.equal(repairs.length,1);assert.equal(repairs[0].stage,'content');assert.equal(repairs[0].acknowledgeUncertain,false);
 await page.click('[data-mock-inspect]');await page.waitForFunction(()=>document.querySelector('[data-mock-notice]')?.textContent.includes('complete report is ready'));
 assert.equal(await page.$$eval('[data-mock-stage]',els=>els.length),0);
});
