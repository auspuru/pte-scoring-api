'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),puppeteer=require('puppeteer');
const {fixture}=require('./helpers/auth-server');const root=path.resolve(__dirname,'..');
for(const width of [1363,1920,390,320])test('Approved layout '+width+'px: native navigation, question controls and unchanged IPT-branded report',{timeout:90000},async t=>{
 const f=await fixture(t),username='portal-layout-browser',password='Synthetic-pass-123';await f.request('/api/auth/register',{username,password,email:'layout@example.test'});await f.request('/api/admin/speaking-access',{username,enabled:true},undefined,true);
 const browser=await puppeteer.launch({headless:true,...(process.env.FULL_MOCK_TEST_CHROME_PATH?{executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH}:{}),args:['--autoplay-policy=no-user-gesture-required','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});t.after(()=>browser.close());
 const page=await browser.newPage();await page.setViewport({width,height:950});await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);const errors=[],grades=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&/\/(?:grade|score|submit)(?:\/|$)/.test(new URL(r.url()).pathname))grades.push(r.url());});
 async function screenshot(label, expanded=false){
 const header=await page.$eval('.portal-layout-header',element=>getComputedStyle(element).display);
 assert.equal(header==='none',expanded,label+': workspace navigation visibility');
 if(width>=1000){
  const geometry=await page.evaluate(()=>{
   const pane=[...document.querySelectorAll('#portalContent>.pane')].find(e=>!e.hidden&&getComputedStyle(e).display!=='none');
   return {viewport:document.documentElement.clientWidth,documentWidth:document.documentElement.scrollWidth,header:document.querySelector('.portal-layout-header-inner').getBoundingClientRect().width,pane:pane?.getBoundingClientRect().width};
  });
  assert(geometry.documentWidth<=width+1,label+': no horizontal overflow');
  assert(Math.abs(geometry.header-(expanded?0:geometry.viewport))<=1,label+': expected desktop header width');
  assert(Math.abs(geometry.pane-geometry.viewport)<=20,label+': pane fills desktop (allow scrollbar)');
 }
await fs.mkdir(path.join(root,'.cache'),{recursive:true});await page.screenshot({path:path.join(root,'.cache','portal-layout-'+width+'-'+label+'.png')});}
 await page.setRequestInterception(true);
 page.on('request',request=>new URL(request.url()).origin===f.base?request.continue():request.abort());
 await page.goto(f.base);await page.type('#loginUsername',username);await page.type('#loginPassword',password);await page.locator('#loginSubmitBtn').click();await page.waitForFunction(()=>document.getElementById('appShell')?.style.display==='grid'&&document.getElementById('loadingVeil')?.classList.contains('hidden')&&document.querySelector('.portal-layout-skills'));
 assert.equal(await page.$$eval('.portal-layout-primary button',n=>n.length),4);await page.locator('#portalMenuToggle').click();await page.waitForFunction(()=>document.body.classList.contains('portal-menu-open'));assert.equal(await page.evaluate(()=>document.activeElement.id),'nav-vocab');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.body.classList.contains('portal-menu-open'));assert.equal(await page.evaluate(()=>document.activeElement.id),'portalMenuToggle');await page.locator('[data-layout-skill="speaking"]').click();await screenshot('practice');
 assert.equal(await page.$$eval('#practiceHubPane .practice-banner:not([hidden])',n=>n.length),1);
 await page.locator('[data-practice-route="speaking-rts"]').click();await page.waitForSelector('#speaking-library-list [data-speaking-question]');await page.waitForFunction(()=>document.getElementById('speakingPane').classList.contains('portal-layout-library'));await screenshot('questions');
 await page.locator('#nav-progress').click();await page.waitForSelector('#progressPane:not([hidden])');assert.equal(await page.$eval('#nav-progress',e=>e.getAttribute('aria-current')),'page');assert.equal(await page.$eval('#nav-saved-results',e=>e.getAttribute('aria-current')),null);await page.locator('#nav-saved-results').click();await page.waitForSelector('[data-saved-route="reading"]');assert.equal(await page.$eval('#nav-saved-results',e=>e.getAttribute('aria-current')),'page');assert.equal(await page.$eval('#nav-progress',e=>e.getAttribute('aria-current')),null);await screenshot('results');await page.locator('[data-saved-route="reading"]').click();await page.waitForSelector('[data-reading-recent-results],#readingPane .reading-attempt-section');
 await page.locator('#nav-mock-tests').click();await page.waitForSelector('#catalogue-board article');await page.waitForFunction(()=>getComputedStyle(document.querySelector('#mockTestsPane .catalogue-heading h2')).display==='none');assert.deepEqual(await page.$eval('.mock-catalogue-card',e=>({radius:getComputedStyle(e).borderRadius,background:getComputedStyle(e).backgroundImage})),{radius:'0px',background:'none'});await screenshot('mocks');
 if(width===390){
  await page.evaluate(()=>switchSection('dictation'));
  await page.locator('[data-listening-open]').click();
  await page.waitForSelector('.listening-practice-dock');
  await screenshot('listening-question',true);
  // This layout test only needs the browser playback acknowledgement.
  await page.evaluate(()=>{HTMLMediaElement.prototype.play=()=>Promise.resolve();});
  await page.locator('#audio-start').click();
  await page.waitForFunction(()=>document.querySelector('#answer:enabled'));
  await page.type('#answer','A synthetic dictation response.');
  await page.locator('#next').click();
  await page.waitForSelector('#writingLabScreen .results',{visible:true});
  await screenshot('listening-feedback',true);
  assert.equal(await page.$$eval('.listening-practice-dock .practice-question-actions button',
   buttons=>buttons.every(button=>button.scrollWidth<=button.clientWidth+1)),true,'Mobile toolbar labels fit inside their buttons');
  await page.locator('.listening-practice-dock [data-tab="wfd"]').click();
  await page.waitForSelector('[data-listening-open]',{visible:true});
  assert.equal(await page.$eval('.portal-layout-header',e=>getComputedStyle(e).display),'block');
 }
 await page.locator('#nav-practice-hub').click();await page.locator('[data-layout-skill="speaking"]').click();await page.locator('[data-practice-route="speaking-rts"]').click();await page.waitForSelector('[data-speaking-mode="untimed"]');await page.locator('[data-speaking-mode="untimed"]').click();await page.waitForFunction(()=>document.querySelector('.practice-timed-switch')?.getAttribute('aria-checked')==='false');await page.locator('#speaking-library-list [data-speaking-question]').click();await page.waitForSelector('.speaking-exam-panel');await page.waitForFunction(()=>document.getElementById('speakingPane').classList.contains('portal-layout-question'));await screenshot('question',true);
 if(width>=1000){const gap=await page.evaluate(()=>document.getElementById('speakingPane').clientWidth-document.querySelector('#speakingPane .speaking-workspace').getBoundingClientRect().width);assert(gap<=80,'Speaking workspace fills the pane with only edge gutters');}

 await page.evaluate(()=>{SpeakingPractice.leave();const host=document.getElementById('speakingPane');host.innerHTML='<section class="speaking-workspace" data-practice-question><div class="speaking-result-card">'+MockReportUI.hero({title:'Retained report — synthetic test',overall:70,skills:[{name:'Speaking',value:70}]})+'</div></section>';PortalLayout.install(window).refresh();});
 await page.waitForFunction(()=>document.getElementById('speakingPane').classList.contains('portal-layout-report'));await page.evaluate(()=>document.fonts.ready);await page.$eval('.ipr-logo',img=>img.decode());
 const measure=()=>page.evaluate(()=>[...document.querySelector('.ipr-score-report').querySelectorAll('*'),document.querySelector('.ipr-score-report')].map(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return{tag:e.tagName,classes:e.className,width:Math.round(r.width*10)/10,height:Math.round(r.height*10)/10,css:Object.fromEntries(['color','backgroundColor','fontSize','fontFamily','fontWeight','lineHeight','borderRadius','borderTopWidth','borderTopColor','paddingTop','paddingRight','paddingBottom','paddingLeft','display','gap','gridTemplateColumns'].map(k=>[k,s[k]]))};}));
 const current=await measure();await screenshot('report',true);
 // Compare native report styling at the same available width: the desktop pane intentionally grew.
 const reportWidth=await page.$eval('.ipr-score-report',e=>e.getBoundingClientRect().width);
 await page.evaluate((reportWidth)=>{document.body.classList.remove('portal-layout');{const report=document.querySelector('.ipr-score-report');report.style.width=reportWidth+'px';report.style.maxWidth='none';report.style.boxSizing='border-box';}},reportWidth);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const original=await measure();assert.deepEqual(current,original,'The existing report must retain its typography, colours, spacing, logo dimensions and geometry');
 assert.equal(await page.$eval('.ipr-logo',e=>new URL(e.src).pathname),'/assets/ipt-brisbane-logo.png');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);if(width===390){
  assert.equal(grades.length,1);
  assert.match(new URL(grades[0]).pathname,/^\/api\/writing-lab\/attempts\/[^/]+\/score\/0$/);
 }else assert.deepEqual(grades,[]);
 assert.deepEqual(errors,[]);
});

for(const [width,height] of [[1280,720],[1366,768],[1920,1080],[1024,768]])test('PC SWT keeps passage, editor and controls in view '+width+'x'+height,{timeout:60000},async t=>{
 const f=await fixture(t),username='desktop-swt-'+width,password='Synthetic-pass-123';await f.request('/api/auth/register',{username,password,email:username+'@example.test'});
 const browser=await puppeteer.launch({headless:true,...(process.env.FULL_MOCK_TEST_CHROME_PATH?{executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH}:{})});t.after(()=>browser.close());const page=await browser.newPage();await page.setViewport({width,height});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setRequestInterception(true);
 page.on('request',request=>{
  if(new URL(request.url()).origin!==f.base)return request.abort();
  if(request.method()!=='POST'||request.url()!==f.base+'/api/grade')return request.continue();
  return request.respond({status:200,contentType:'application/json',body:JSON.stringify({
   overall_score:79,trait_scores:{content:3,form:1,grammar:2,vocabulary:2}
  })});
 });
 await page.goto(f.base+'/#/swt');await page.type('#loginUsername',username);await page.type('#loginPassword',password);await page.locator('#loginSubmitBtn').click();await page.waitForSelector('[data-swt-open]',{visible:true});await page.locator('[data-swt-open="1"]').click();await page.waitForFunction(()=>document.body.classList.contains('portal-swt-workspace')&&document.getElementById('loadingVeil')?.classList.contains('hidden')&&document.getElementById('passageBody').textContent.length>100);await page.evaluate(()=>document.fonts.ready);
 // Native shell/SWT entrance animations must finish before exact scroll geometry is compared.
 await page.evaluate(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await Promise.all(['swtPane','swtPracticeScreen'].flatMap(id=>document.getElementById(id).getAnimations()).map(animation=>animation.finished.catch(()=>{})));});
 await fs.mkdir(path.join(root,'.cache'),{recursive:true});await page.screenshot({path:path.join(root,'.cache')+'/portal-layout-swt-'+width+'-'+height+'.png'});
 const geometry=await page.evaluate(()=>({docHeight:document.documentElement.scrollHeight,viewport:innerHeight,docWidth:document.documentElement.scrollWidth,rects:Object.fromEntries(['portalContent','swtPane','swtPracticeScreen','swtPracticeGrid','passageBody','summaryInput','scoreBtn','navNext','timerToggle'].map(id=>{const n=document.getElementById(id),r=n.getBoundingClientRect(),s=getComputedStyle(n);return[id,{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,scrollHeight:n.scrollHeight,clientHeight:n.clientHeight,display:s.display,overflow:s.overflow}]}))}));
 assert(geometry.docHeight<=height+1,'The PC page must fit the viewport');assert(geometry.docWidth<=width+1,'The PC page must fit horizontally');assert(await page.$eval('#swtPracticeScreen>.swt-heading',e=>e.getBoundingClientRect().height)<=60,'The SWT heading must leave room for reading and writing');for(const id of ['summaryInput','scoreBtn','navNext','timerToggle','passageBody']){assert(geometry.rects[id].bottom<=height+1,id+' bottom must be visible');assert(geometry.rects[id].height>0,id+' must be visible');}assert(geometry.rects.passageBody.x<geometry.rects.summaryInput.x,'Passage and editor must sit side by side');
 const submitTop=await page.$eval('#scoreBtn',e=>e.getBoundingClientRect().top);await page.$eval('#passageBody',e=>{e.scrollTop=e.scrollHeight;});assert.equal(await page.$eval('#scoreBtn',e=>e.getBoundingClientRect().top),submitTop);assert.equal(await page.evaluate(()=>document.scrollingElement.scrollTop),0);
 await page.type('#summaryInput','A preserved desktop summary with one complete sentence.');await page.evaluate(()=>{window.__desktopEditor=document.getElementById('summaryInput');window.__desktopEditor.setSelectionRange(8,17);});await page.locator('#tabPlan').click();await page.type('#scratchInput','Preserved PC planning notes.');await page.locator('#tabWrite').click();await page.locator('#timerToggle').click();await page.waitForFunction(()=>document.getElementById('timerToggle').getAttribute('aria-pressed')==='true');
 assert.equal(await page.$eval('.portal-layout-header',e=>getComputedStyle(e).display),'none');
 assert.equal(await page.evaluate(()=>document.body.classList.contains('portal-exam-active')),false);
 assert.equal(await page.evaluate(()=>document.getElementById('summaryInput')===window.__desktopEditor),true);
 assert.equal(await page.$eval('#summaryInput',e=>e.value),'A preserved desktop summary with one complete sentence.');
 assert.equal(await page.$eval('#scratchInput',e=>e.value),'Preserved PC planning notes.');
 await page.locator('#navNext').click();await page.waitForFunction(()=>document.getElementById('navCurrent').textContent==='02');await page.locator('#navPrev').click();await page.waitForFunction(()=>document.getElementById('summaryInput').value==='A preserved desktop summary with one complete sentence.');
 await page.locator('#scoreBtn').click();
 await page.waitForSelector('#swtResultsScreen.active',{visible:true});
 await page.waitForFunction(()=>!document.body.classList.contains('portal-swt-workspace'));
 assert.equal(await page.$eval('.portal-layout-header',e=>getComputedStyle(e).display),'none');
 assert.equal(await page.$eval('#swtPane',e=>e.classList.contains('portal-layout-question')),false);
 await page.locator('#swtResultsScreen button[onclick="backToPractice()"]').click();
 await page.locator('[data-writing-return="swt"]').click();
 await page.waitForSelector('#swtQuestionLibrary.active');
 assert.equal(await page.$eval('.portal-layout-header',e=>getComputedStyle(e).display),'block');
 await page.locator('#nav-progress').click();await page.waitForFunction(()=>document.body.dataset.section==='progress'&&!document.body.classList.contains('portal-swt-workspace'));assert.equal(await page.$eval('#nav-progress',e=>e.getAttribute('aria-current')),'page');await page.locator('#nav-saved-results').click();await page.waitForFunction(()=>document.body.dataset.section==='saved-results');assert.equal(await page.$eval('#nav-saved-results',e=>e.getAttribute('aria-current')),'page');assert.deepEqual(errors,[]);
});
