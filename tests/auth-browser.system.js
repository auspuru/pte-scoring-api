'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),puppeteer=require('puppeteer'),{fixture}=require('./helpers/auth-server');
test('Duplicate-email sign-up remains recoverable through the real Forgot password screens',{timeout:60000},async t=>{
 const f=await fixture(t),username='email-browser',password='Original-pass-123';
 const original=(await f.request('/api/auth/register',{username,password,email:'email-browser@example.test'})).body;
 const browser=await puppeteer.launch({headless:true,...(process.env.FULL_MOCK_TEST_CHROME_PATH?{executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH}:{})});t.after(()=>browser.close());
 const page=await browser.newPage();await page.setViewport({width:390,height:900});await page.goto(f.base);await page.waitForSelector('#loginUsername',{visible:true});
 await page.evaluate(()=>toggleSignupMode(true));await page.type('#regUsername','duplicate-email-browser');await page.type('#regEmail','EMAIL-BROWSER@example.test');await page.type('#regPassword',password);await page.click('#regSubmitBtn');
 await page.waitForSelector('#registerError.show');assert.match(await page.$eval('#registerError',e=>e.textContent),/already uses this email.*Forgot password/);assert.equal(await page.$eval('#regSubmitBtn',e=>e.disabled),false);
 await page.evaluate(()=>toggleForgotPasswordMode(true));await page.type('#forgotUsername',username);await page.click('#forgotStep1Btn');
 await page.waitForFunction(()=>document.getElementById('forgotPasswordNotice')?.textContent.includes('check your email'));
 const link=(await f.mail()).text.match(/https?:\/\/\S+/)[0];await page.goto(link);await page.waitForSelector('#emailResetPassword',{visible:true});
 await page.type('#emailResetPassword','Recovered-pass-456');await page.type('#emailResetConfirm','Recovered-pass-456');await page.click('#emailResetSubmit');
 await page.waitForFunction(()=>document.getElementById('loginError')?.textContent.includes('Password updated'));
 assert.equal((await f.request('/api/auth/login',{username,password})).body.success,false);
 assert.equal((await f.request('/api/auth/login',{username,password:'Recovered-pass-456'})).body.success,true);
 assert.equal((await f.request('/api/sync/'+username,undefined,original.token)).status,401);
});
test('Password changes renew browser authentication, revoke older sessions and retain saved drafts',{timeout:60000},async t=>{
 const f=await fixture(t),username='password-browser',password='Original-pass-123';
 const registered=(await f.request('/api/auth/register',{username,password,email:'password-browser@example.test'})).body;
 await f.request('/api/sync/'+username,{essayDraft:{essayText:'A retained synthetic draft',updatedAt:Date.now()}},registered.token);
 const browser=await puppeteer.launch({headless:true,...(process.env.FULL_MOCK_TEST_CHROME_PATH?{executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH}:{})});t.after(()=>browser.close());
 const page=await browser.newPage();await page.setViewport({width:390,height:900});
 await page.goto(f.base);await page.waitForSelector('#loginUsername',{visible:true});await page.type('#loginUsername',username);await page.type('#loginPassword',password);await page.click('#loginSubmitBtn');
 const ready=()=>page.waitForFunction(()=>document.getElementById('appShell')?.style.display==='grid'&&document.getElementById('loadingVeil')?.classList.contains('hidden'));
 await ready();const old=await page.evaluate(()=>sessionToken);
 await page.evaluate(()=>openUserMenu());
 // Wait for the menu's scheduled accessibility focus before opening its form.
 // Opening both in one JS frame lets that focus interrupt password typing.
 await page.waitForFunction(()=>document.getElementById('userMenuModal').contains(document.activeElement));
 await page.locator('#userMenuModal button[onclick="changePassword()"]').click();
 await page.type('#changeCurrentPassword',password);await page.type('#changeNewPassword','Replacement-pass-456');await page.type('#changeConfirmPassword','Replacement-pass-456');
 assert.equal(await page.$eval('#changeCurrentPassword',(el,expected)=>el.value===expected,password),true,'The complete current password is entered');
 assert.equal(await page.$eval('#changeConfirmPassword',el=>el.value===document.getElementById('changeNewPassword').value),true,'The new password fields match');
 const changed=page.waitForResponse(r=>r.url().endsWith('/api/auth/change-password'));
 // The expanded mobile account form scrolls inside its modal. Use the
 // locator's stable, in-viewport click instead of a single moving coordinate.
 await page.locator('#changePasswordSubmit').click();
 const response=await changed.catch(async error=>{throw Error('Password submit did not reach the server: '+JSON.stringify(await page.evaluate(()=>({status:document.getElementById('changePasswordStatus')?.textContent,valid:document.getElementById('changePasswordForm')?.checkValidity(),lengths:['changeCurrentPassword','changeNewPassword','changeConfirmPassword'].map(id=>document.getElementById(id)?.value.length),visible:document.getElementById('userMenuModal')?.classList.contains('show')}))),{cause:error});});assert.equal(response.status(),200);
 await page.waitForFunction(previous=>sessionToken!==previous,{},old);
 const renewed=await page.evaluate(()=>({token:sessionToken,stored:getAuthStorageValue('pte_session_token')}));assert.equal(renewed.token,renewed.stored);
 assert.equal((await f.request('/api/sync/'+username,undefined,old)).status,401);
 assert.equal((await f.request('/api/sync/'+username,undefined,renewed.token)).body.data.essayDraft.essayText,'A retained synthetic draft');
 await page.reload();await ready();assert.equal(await page.evaluate(()=>currentUserId),username);
});
test('My Progress opens without a failure warning when Speaking access is intentionally disabled',{timeout:30000},async t=>{
 const f=await fixture(t),username='progress-restricted';await f.request('/api/auth/register',{username,password:'Original-pass-123',email:'progress-restricted@example.test'});
 const browser=await puppeteer.launch({headless:true,...(process.env.FULL_MOCK_TEST_CHROME_PATH?{executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH}:{})});t.after(()=>browser.close());
 const page=await browser.newPage();await page.goto(f.base);await page.waitForSelector('#loginUsername',{visible:true});await page.type('#loginUsername',username);await page.type('#loginPassword','Original-pass-123');await page.click('#loginSubmitBtn');
 await page.waitForFunction(()=>document.getElementById('appShell')?.style.display==='grid'&&document.getElementById('loadingVeil')?.classList.contains('hidden'));
 await page.evaluate(()=>switchSection('progress'));await page.waitForSelector('#progressPane .progress-empty',{visible:true});
 assert.equal(await page.$('#progressPane .progress-notice'),null);
});
test('Admins can set and extend portal access dates when granting access on desktop and mobile',{timeout:60000},async t=>{
 const f=await fixture(t),browser=await puppeteer.launch({headless:true,...(process.env.FULL_MOCK_TEST_CHROME_PATH?{executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH}:{})});t.after(()=>browser.close());
 const errors=[];
 for(const width of [390,1440]){
  const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
  const username='access-browser-'+width,password='Synthetic-pass-123';await f.request('/api/auth/register',{username,password,email:username+'@example.test'});
  await page.setViewport({width,height:900});await page.goto(f.base+'/admin');
  if(await page.$eval('#dashboard',e=>getComputedStyle(e).display==='none')){await page.type('#adminKeyInput','isolated-auth-test-admin');await page.click('#authCard > button');}
  await page.waitForSelector('#dashboard',{visible:true});await page.type('[aria-label="Search users"]',username);
  await page.click('[data-speaking-user="'+username+'"]');await page.waitForSelector('#accessDatesModal[open]',{visible:true});
  assert.equal(await page.$eval('#accessDatesUser',e=>e.textContent),username);
  assert.equal(await page.$eval('#accessStartsOn',e=>e.value),'');assert.equal(await page.$eval('#accessExpiresOn',e=>e.value),'');
  const box=await page.$eval('#accessDatesModal',e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,inside:e.scrollWidth<=e.clientWidth,active:e.contains(document.activeElement)};});
  assert.ok(box.left>=0&&box.right<=width&&box.inside&&box.active,'Accessible date dialog fits '+width+'px');
  assert.match(await page.$eval('#accessDatesHelp',e=>e.textContent),/Brisbane/);
  await page.$eval('#accessExpiresOn',e=>e.value='2000-01-01');
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/admin/access-dates')&&r.request().method()==='POST');await page.click('#accessDatesSave');assert.equal((await saved).status(),200);
  await page.waitForFunction(()=>!document.getElementById('accessDatesModal').open);
  assert.equal((await f.request('/api/auth/login',{username,password})).body.code,'PORTAL_ACCESS_EXPIRED');
  await page.reload();await page.waitForSelector('[data-access-dates-user="'+username+'"]');
  assert.match(await page.$eval('[data-access-dates-user="'+username+'"]',e=>e.closest('tr').textContent),/Expired.*Expires 2000-01-01/s);
  await page.click('[data-access-dates-user="'+username+'"]');assert.equal(await page.$eval('#accessExpiresOn',e=>e.value),'2000-01-01');
  await page.$eval('#accessExpiresOn',e=>e.value='');await page.click('#accessDatesSave');await page.waitForFunction(()=>!document.getElementById('accessDatesModal').open);
  assert.equal((await f.request('/api/auth/login',{username,password})).body.success,true,'Clearing expiry renews access');
  await page.click('[data-access-dates-user="'+username+'"]');await page.keyboard.press('Escape');assert.equal(await page.$eval('#accessDatesModal',e=>e.open),false);
  await page.close();
 }
 assert.deepEqual(errors,[]);
});
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
 await page.evaluate(()=>switchSection('swt'));await page.waitForSelector('#summaryInput',{visible:true});await page.type('#summaryInput','A recoverable first-account summary.');assert.equal(await page.$eval('#summaryInput',e=>e.value),'A recoverable first-account summary.');assert.equal(await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('pte_browser-alice_summaries')||'{}')).some(entry=>entry.text==='A recoverable first-account summary.')),true,'The draft is saved before expiry');
 await f.clock(31*24*60*60*1000);await page.evaluate(()=>refreshPracticeHistory({force:true}));await page.waitForFunction(()=>document.getElementById('loginScreen')?.style.display==='flex');
 await f.clock(0);await page.type('#loginUsername','browser-bob');await page.type('#loginPassword','Password123');await page.click('#loginSubmitBtn');await workspace('second account');
 await page.evaluate(()=>switchSection('swt'));await page.waitForSelector('#summaryInput',{visible:true});assert.equal(await page.$eval('#summaryInput',e=>e.value),'');
 await page.evaluate(()=>signOut());await page.type('#loginUsername','browser-alice');await page.type('#loginPassword','Password123');await page.click('#loginSubmitBtn');await workspace('original account recovery');await page.evaluate(()=>switchSection('swt'));await page.waitForSelector('#summaryInput',{visible:true});assert.equal(await page.$eval('#summaryInput',e=>e.value),'A recoverable first-account summary.');
});

test('SWT practice submits with the signed-in session after login and reload',{timeout:60000},async t=>{
 const f=await fixture(t);
 const browser=await puppeteer.launch({headless:true,...(process.env.FULL_MOCK_TEST_CHROME_PATH?{executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH}:{})});t.after(()=>browser.close());
 for(const [width,reload] of [[1365,false],[390,true]]){
  const username='swt-browser-'+width,password='Synthetic-pass-123';
  await f.request('/api/auth/register',{username,password,email:username+'@example.test'});
  const context=await browser.createBrowserContext();
  const page=await context.newPage();await page.setViewport({width,height:900});
  const receipts={};await page.exposeFunction('__swtTestReceipt',(route,body)=>{receipts[route]=body;});
  // Observe actual JSON in the browser instead of retrieving a response body
  // from CDP after auth-boot reloads the document. Keep the receipt in Node
  // across both the automatic login reload and the explicit mobile reload.
  await page.evaluateOnNewDocument(()=>{
   const original=window.fetch;
   window.fetch=async function(...args){
    const response=await original.apply(this,args),path=new URL(args[0] instanceof Request?args[0].url:String(args[0]),location.href).pathname;
    if(['/api/auth/login','/api/grade'].includes(path))await window.__swtTestReceipt(path,await response.clone().json());
    return response;
   };
  });
  await page.goto(f.base);await page.waitForSelector('#loginUsername',{visible:true});
  await page.type('#loginUsername',username);await page.type('#loginPassword',password);
  const signedIn=page.waitForResponse(r=>r.url().endsWith('/api/auth/login')&&r.request().method()==='POST');
  await page.click('#loginSubmitBtn');assert.equal((await signedIn).status(),200);
  const ready=()=>page.waitForFunction(()=>document.getElementById('appShell')?.style.display==='grid'&&document.getElementById('loadingVeil')?.classList.contains('hidden'));
  await ready();const login=receipts['/api/auth/login'];assert.equal(login.success,true);
  if(reload){await page.reload();await ready();}
  await page.evaluate(()=>switchSection('swt'));await page.waitForSelector('#summaryInput',{visible:true});
  // Two sentences exercise the real server's deterministic form gate after
  // authentication, without any external scoring provider or mocked HTTP reply.
  const text='Bees support plants. Flowers grow.';await page.type('#summaryInput',text);
  const assessed=page.waitForResponse(r=>r.url().endsWith('/api/grade')&&r.request().method()==='POST');
  await page.click('#scoreBtn');const response=await assessed;
  assert.equal(response.status(),200);assert.equal(response.request().headers()['x-session-token']===login.token,true,'SWT transports the same signed session used by login');
  await page.waitForSelector('#swtResultsScreen.active',{visible:true});
  const grade=receipts['/api/grade'];assert.equal(grade.form_gate_triggered,true);assert.equal(grade.llm_used,false);
  assert.equal(await page.evaluate(()=>document.getElementById('appShell').style.display),'grid');
  assert.equal(await page.evaluate((uid,responseText)=>Object.values(JSON.parse(localStorage.getItem('pte_'+uid+'_history')||'{}')).some(attempts=>attempts.some(a=>a.text===responseText)),username,text),true,'The authenticated response is saved');
  await context.close();
 }
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
test('Staff releases a final failed RS or ASQ with one explicit exclusion on mobile and desktop',{timeout:90000},async t=>{
 const f=await fixture(t),username='rs-release-browser';await f.request('/api/auth/register',{username,password:'Synthetic-pass-123',email:'rs-release@example.test'});
 const browser=await puppeteer.launch({headless:true,...(process.env.FULL_MOCK_TEST_CHROME_PATH?{executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH}:{})});t.after(()=>browser.close());
 for(const mode of ['delivery','transcription'])for(const width of [390,1440]){
  const transcription=mode==='transcription',number=transcription?28:16,qid=transcription?'saved-asq-28':'saved-rs-16',action=transcription?'[data-full-exclude-transcription]':'[data-full-exclude-delivery]',confirmation=transcription?'[data-full-transcription-confirm]':'[data-full-instructor-confirm]';
  const page=await browser.newPage();await page.setViewport({width,height:900});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const id='006d4971-2ad3-4f14-8e2a-0ea3ed450bdd',route='/api/admin/full-mocks/'+username+'/'+id+'/scoring',posts=[];let released=false;
  await page.setRequestInterception(true);page.on('request',async req=>{
   const pathname=new URL(req.url()).pathname;
   if(pathname===route||pathname===route+(transcription?'/exclude-audio':'/exclude-delivery')){
    if(req.method()==='POST'){posts.push(JSON.parse(req.postData()));released=true;}
    return req.respond({status:200,contentType:'application/json',body:JSON.stringify({owner:username,attemptId:id,ready:released,assessedCount:64,excludedCount:released?1:0,accountedFor:released?65:64,total:65,recovery:{status:released?'complete':'scheduled'},evidenceHash:'a'.repeat(64),responsesHash:'unchanged-responses',confirmedHash:'unchanged-64-marks',questions:released?[]:[{id:qid,number,type:transcription?'asq':'rs',status:'failed',eligible:transcription,deliveryEligible:!transcription,transcriptionEligible:transcription,reason:transcription?'transcription-unavailable':'delivery-unavailable'}]})});
   }
   await req.continue();
  });
  await page.goto(f.base+'/admin');if(await page.$eval('#dashboard',e=>getComputedStyle(e).display==='none')){await page.type('#adminKeyInput','isolated-auth-test-admin');await page.click('#authCard > button');}
  await page.waitForSelector('#dashboard',{visible:true});await page.type('[aria-label="Search users"]',username);await page.click('button[onclick="viewUser(\''+username+'\')"]');
  await page.waitForSelector('[data-full-attempt]',{visible:true});await page.type('[data-full-attempt]',id);await page.click('[data-full-inspect]');await page.waitForSelector(action,{visible:true});
  assert.match(await page.$eval(action,e=>e.textContent),new RegExp('Question '+number));assert.equal(await page.$('[data-full-reviewed]'),null);
  await page.click(action);assert.equal(posts.length,0,'An explicit instructor confirmation is required');
  await page.click(confirmation);await page.focus(action);await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('[data-full-notice]')?.textContent.startsWith('Result ready.'));
  assert.equal(posts.length,1);assert.deepEqual(posts[0].questionIds,[qid]);assert.equal(posts[0].confirmInstructorExclusion,true);assert.equal(posts[0].confirmUnusableAudio,undefined);if(transcription)assert.equal(posts[0].mode,'failed-transcription');
  assert.match(await page.$eval('[data-full-diagnostics]',e=>e.textContent),/64 assessed · 1 excluded · 65\/65 accounted for/);assert.match(await page.$eval('[data-full-notice]',e=>e.textContent),/completed marks are unchanged/);
  assert.equal(await page.$eval('#fullMockRecoveryPanel',e=>e.scrollWidth<=e.clientWidth+1),true);assert.deepEqual(errors,[]);await page.close();
 }
});
