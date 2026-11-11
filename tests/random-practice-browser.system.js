'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),puppeteer=require('puppeteer');
const {fixture}=require('./helpers/auth-server'),pool=require('../random-practice').pools().wfd;
for(const width of [1366,390])test('Random single-task sets select on the server, score dictation and restore saved results at '+width+'px',{timeout:90000},async t=>{
  const f=await fixture(t),username='practice-set-'+width,password='Synthetic-test-123';
  assert.equal((await f.request('/api/auth/register',{username,password,email:username+'@example.test'})).status,200);
  assert.equal((await f.request('/api/admin/speaking-access',{username,enabled:true},null,true)).status,200);
  const browser=await puppeteer.launch({headless:true,executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH||'/tmp/pte-test-google-chrome',args:['--autoplay-policy=no-user-gesture-required']});t.after(()=>browser.close());
  const page=await browser.newPage();await page.setViewport({width,height:950});page.setDefaultTimeout(20000);const errors=[],starts=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/writing-lab/attempts')starts.push(JSON.parse(request.postData()));});
  await page.evaluateOnNewDocument(()=>{const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(...args){this.playbackRate=8;return play.apply(this,args);};});
  let lastClick='';const click=async selector=>{lastClick=selector;return page.locator(selector).click();};
  try{
  await page.goto(f.base);await page.type('#loginUsername',username);await page.type('#loginPassword',password);await click('#loginSubmitBtn');await page.waitForFunction(name=>typeof currentUserId!=='undefined'&&currentUserId===name&&document.getElementById('loadingVeil')?.classList.contains('hidden')&&typeof passages!=='undefined'&&passages.length>1,{},username);
  await page.evaluate(()=>switchSection('practice-hub'));await click('[data-practice-set-mode]');await page.waitForSelector('#practice-set-type');
  assert.equal(await page.$$eval('#practice-set-type option',rows=>rows.length),7);assert.equal(await page.$eval('#practice-set-type',e=>e.multiple),false);assert.equal((await page.$$('#randomPracticePane input[type="checkbox"]')).length,0);
  await page.select('#practice-set-type','sgd');assert.deepEqual(await page.$$eval('#practice-set-count option',rows=>rows.map(r=>r.value)),['5','10','15']);
  await page.select('#practice-set-type','ra');await page.select('#practice-set-count','20');await click('#practice-set-start');await page.waitForSelector('#sm-check-record',{visible:true});assert.match(await page.$eval('#sm-check-begin',e=>e.textContent),/practice set/);
  await click('[data-sm="practice-sets"]');await page.waitForSelector('#practice-set-type');await page.select('#practice-set-type','wfd');await page.select('#practice-set-count','5');
  const creation=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/writing-lab/attempts'&&r.request().method()==='POST');
  await click('#practice-set-start');await page.waitForSelector('#confirm-ok',{visible:true});await click('#confirm-ok');await page.waitForSelector('#portal-exam-guard button.primary',{visible:true});await click('#portal-exam-guard button.primary');const begun=await(await creation).json();
  assert.deepEqual(starts[0].practiceSet,{type:'wfd',count:5});assert.equal(starts[0].questionIds,undefined);assert.equal(new Set(begun.questions.map(q=>q.id)).size,5);
  for(let index=0;index<5;index++){
    await page.waitForFunction(n=>document.querySelector('#lab .exam-strip')?.textContent.includes('Question '+(n+1)+' of 5'),{},index);
    if(index===0)await page.waitForFunction(()=>document.getElementById('audio-status')?.textContent.includes('Recording complete'));
    const text=pool.find(q=>q.id===begun.questions[index].id).text;
    await page.$eval('#answer',(node,value)=>{node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));},text);await click('#next');
  }
  await page.waitForFunction(()=>document.querySelector('#lab .ipr-overall strong')?.textContent==='90');assert.equal(await page.$$eval('#lab [data-mock-question-type="wfd"]',rows=>rows.length),5);
  await click('[data-random-practice]');await page.waitForSelector('[data-rp="resume"]');assert.match(await page.$eval('.rp-history',e=>e.textContent),/90/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await fs.mkdir(path.join(__dirname,'../.cache'),{recursive:true});await page.screenshot({path:path.join(__dirname,'../.cache','random-practice-'+width+'.png')});
  await click('[data-rp="resume"]');await page.waitForFunction(()=>document.querySelector('#lab .ipr-overall strong')?.textContent==='90');await page.reload();await page.waitForFunction(()=>document.querySelector('#lab .ipr-overall strong')?.textContent==='90');
  assert.equal(starts.length,1);const saved=await f.request('/api/writing-lab/attempts/'+begun.id,undefined,(await f.request('/api/auth/login',{username,password})).body.token);assert.deepEqual(saved.body.questions.map(q=>q.id),begun.questions.map(q=>q.id));assert.deepEqual(errors,[]);
  }catch(error){t.diagnostic(JSON.stringify({lastClick,url:page.url(),state:await page.evaluate(()=>({active:document.querySelector('.pane.active')?.id,text:document.querySelector('.pane.active')?.innerText.slice(0,1300)})),errors}));await fs.mkdir(path.join(__dirname,'../.cache'),{recursive:true});await page.screenshot({path:path.join(__dirname,'../.cache','random-practice-failed-'+width+'.png')});throw error;}
});
