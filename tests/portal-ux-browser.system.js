'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),puppeteer=require('puppeteer');
const {fixture}=require('./helpers/auth-server');const root=path.resolve(__dirname,'..');
async function setup(t,extra={}){
 const f=await fixture(t),username='ux-browser',password='Synthetic-pass-123';await f.request('/api/auth/register',{username,password,email:'ux@example.test'});await f.request('/api/admin/speaking-access',{username,enabled:true},undefined,true);
 const login=(await f.request('/api/auth/login',{username,password})).body;
 const passages=(await f.request('/api/passages')).body.passages;const history=Array.from({length:43},(_,i)=>({text:'Saved synthetic summary number '+i+'.',timestamp:Date.now()-i*3600000,overall_score:80,trait_scores:{content:3,form:1,grammar:2,vocabulary:2}}));
 const grouped={};history.forEach((row,i)=>(grouped[passages[Math.floor(i/10)].id]??=[]).push(row));
 await f.request('/api/sync/'+username,{history:grouped,...extra},login.token);
 const browser=await puppeteer.launch({headless:true,...(process.env.FULL_MOCK_TEST_CHROME_PATH?{executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH}:{}),args:['--autoplay-policy=no-user-gesture-required']});t.after(()=>browser.close());const page=await browser.newPage();page.setDefaultTimeout(15000);await page.setViewport({width:1363,height:950});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(f.base);await page.type('#loginUsername',username);await page.type('#loginPassword',password);await page.locator('#loginSubmitBtn').click();await page.waitForSelector('.portal-layout-skills');return{f,page,errors,token:login.token,history};
}
test('UX libraries: fuzzy catalogue search, real progress chart, sortable/searchable history and exact saved response',{timeout:90000},async t=>{
 const {page,errors,history}=await setup(t);await page.locator('#nav-progress').click();await page.waitForSelector('.portal-ux-history:not([hidden]) .tabulator-row');await page.waitForFunction(()=>window.Chart&&Chart.getChart(document.querySelector('.portal-ux-chart canvas')));
 assert.equal(await page.$eval('.portal-ux-history .tabulator-row [tabulator-field=scoreText]',e=>e.textContent.trim()),'8 / 9');assert.equal(await page.$$eval('.portal-ux-history .tabulator-row',rows=>rows.length),20);assert.equal(await page.$eval('.portal-ux-history [role=status]',e=>e.textContent),'43 saved questions');
 await page.locator('.portal-ux-history-tools button').click();await page.waitForFunction(()=>document.querySelector('.progress-recent>.progress-attempts')?.hidden===false);assert.equal(await page.$$eval('.progress-recent>.progress-attempts [data-progress-attempt]',rows=>rows.length),20);
 await page.locator('.portal-ux-history-tools button').click();await page.waitForFunction(()=>document.querySelector('.progress-recent>.progress-attempts')?.hidden===true);await page.waitForSelector('.portal-ux-grid .tabulator-row');
 await page.type('.portal-ux-history input[type=search]','impossible-xzq');await page.waitForFunction(()=>document.querySelector('.portal-ux-history [role=status]').textContent==='0 of 43 saved questions');assert.equal(await page.$$eval('.portal-ux-history .tabulator-row',rows=>rows.length),0);
 await page.$eval('.portal-ux-history input',e=>{e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));});await page.waitForSelector('.portal-ux-history .tabulator-row');
 await page.locator('.portal-ux-grid [tabulator-field="dateValue"]').click();await page.waitForFunction(()=>document.querySelector('.portal-ux-grid [data-progress-attempt="42"]'));
 await fs.mkdir(path.join(root,'.cache'),{recursive:true});await page.screenshot({path:path.join(root,'.cache/portal-layout-ux-progress.png')});
 await page.locator('.portal-ux-grid [data-progress-attempt="42"]').click();await page.waitForFunction(text=>document.body.textContent.includes(text),{},history[42].text);
 assert.equal(await page.$eval('#nav-progress',e=>e.getAttribute('aria-current')),null,'Saved response opens through its original report route');
 await page.locator('#swtResultsScreen button[onclick="backToPractice()"]').click();
 await page.locator('[data-writing-return="swt"]').click();
 await page.waitForSelector('#swtQuestionLibrary.active',{visible:true});
 await page.locator('#nav-practice-hub').click();await page.locator('[data-layout-skill="speaking"]').click();await page.locator('[data-practice-route="speaking-rl"]').click();await page.waitForSelector('#speaking-search');await page.type('#speaking-search','neuronn');await page.waitForFunction(()=>document.querySelector('#speaking-library-list')?.textContent.toLowerCase().includes('neuron'));
 assert.equal(await page.$$eval('#speaking-library-list [data-speaking-question]',nodes=>nodes.length),1);await page.screenshot({path:path.join(root,'.cache/portal-layout-ux-search.png')});assert.deepEqual(errors,[]);
});
test('UX audio review uses the saved native player and releases it when leaving; optional assets fail safely',{timeout:90000},async t=>{
 const {f,page,errors,token}=await setup(t),id=require('node:crypto').randomUUID();
 assert.equal((await f.request('/api/speaking/attempts',{id,questionId:'ra-1'},token)).status,200);
 const audio=await fs.readFile(path.join(root,'content/speaking-audio/rs-1.mp3'));
 const saved=await fetch(f.base+'/api/speaking/attempts/'+id+'/recording',{method:'POST',headers:{'x-session-token':token,'content-type':'audio/mpeg'},body:audio});assert.equal(saved.status,200);
 await page.evaluate(id=>switchSection('speaking-ra',{speakingRequest:{attemptId:id,questionId:'ra-1'}}),id);await page.waitForSelector('#speaking-playback audio');
 // Resume and render can both load saved playback. Finish that initial media
 // loading before testing whether the optional waveform preserves the player.
 await page.waitForNetworkIdle({idleTime:100});
 await page.$eval('#speaking-playback audio',audio=>{window.__nativeReviewAudio=audio;});await page.locator('.portal-ux-wave summary').click();await page.waitForFunction(()=>document.querySelector('.portal-ux-waveform')?.querySelector('div')?.shadowRoot?.querySelector('canvas'));
 assert.equal(await page.evaluate(()=>document.querySelector('#speaking-playback audio')===window.__nativeReviewAudio),true);
 await page.$eval('#speaking-playback audio',audio=>audio.play());await page.waitForFunction(()=>window.__nativeReviewAudio.currentTime>0);await page.$eval('.portal-ux-wave input',slider=>{slider.value='2';slider.dispatchEvent(new Event('input',{bubbles:true}));});await page.waitForFunction(()=>window.__nativeReviewAudio.currentTime>=2);
 await page.screenshot({path:path.join(root,'.cache/portal-layout-ux-waveform.png')});
 await page.locator('[data-speaking-action="list"]').click();
 await page.waitForFunction(()=>window.__nativeReviewAudio.paused);
 await page.locator('#nav-progress').click();
 await page.waitForSelector('.portal-ux-history:not([hidden])');
 await page.locator('#nav-practice-hub').click();await page.evaluate(()=>{window.Chart=undefined;window.Tabulator=undefined;});await page.setRequestInterception(true);page.on('request',request=>request.url().includes('/vendor/chart.js/')||request.url().includes('/vendor/tabulator-tables/')?request.abort():request.continue());
 await page.reload();await page.waitForSelector('.portal-layout-skills');await page.locator('#nav-progress').click();await page.waitForSelector('.progress-attempts:not([hidden]) [data-progress-attempt]');
 // The native list renders before the deferred enhancements finish loading.
 // Wait for their rejected assets to settle before checking fallback content.
 await page.waitForFunction(()=>document.querySelector('.portal-ux-chart')?.hidden===true&&!document.querySelector('.portal-ux-history'));
 assert.match(await page.$eval('.portal-ux-chart-summary',node=>node.textContent),/\d+ \w+: \d+/);assert.deepEqual(errors,[]);
});
test('UX history keeps a focused saved response usable when the optional table finishes loading',{timeout:90000},async t=>{
 const {page,errors,history}=await setup(t);let release;const held=new Promise(resolve=>release=resolve);
 await page.setRequestInterception(true);page.on('request',request=>request.url().endsWith('/tabulator.min.js')?release(request):request.continue());
 await page.locator('#nav-progress').click();const request=await held;await page.focus('.progress-recent>.progress-attempts [data-progress-attempt="0"]');await request.continue();
 await page.waitForSelector('.portal-ux-history:not([hidden]) .portal-ux-history-tools button');
 assert.equal(await page.$eval('.progress-recent>.progress-attempts',node=>node.hidden),false);
 assert.equal(await page.evaluate(()=>document.activeElement.dataset.progressAttempt),'0');
 assert.equal(await page.$eval('.portal-ux-history-tools button',node=>node.textContent),'Table view');
 await page.keyboard.press('Enter');await page.waitForFunction(text=>document.getElementById('swtResultsScreen')?.textContent.includes(text),{},history[0].text);assert.deepEqual(errors,[]);
});

test('Progress table and list show submitted essay scores and exclude the unfinished draft',{timeout:90000},async t=>{
 const stamp=Date.now(),{page,errors}=await setup(t,{practiceHistory:[{id:'essay-new',date:stamp+2,questionTitle:'Newest essay score',questionText:'Discuss the topic.',essayText:'A saved synthetic essay.',scores:{total:21}},{id:'essay-old',date:stamp+1,questionTitle:'Earlier zero score',questionText:'Discuss the topic.',essayText:'Another saved synthetic essay.',scores:{total:0}}],essayDraft:{essayText:'A synthetic unfinished response.',updatedAt:stamp+3}});
 await page.locator('#nav-progress').click();await page.waitForSelector('.portal-ux-history:not([hidden]) .tabulator-row');
 const entries=await page.$$eval('.portal-ux-grid .tabulator-row',rows=>rows.map(row=>({title:row.querySelector('[tabulator-field=title]').textContent.trim(),score:row.querySelector('[tabulator-field=scoreText]').textContent.trim()})));
 assert.equal(entries.find(r=>r.title==='Newest essay score').score,'21 / 26');assert.equal(entries.find(r=>r.title==='Earlier zero score').score,'0 / 26');assert.equal(entries.some(r=>r.title==='Write Essay'||r.score==='Not scored'),false);
 await fs.mkdir(path.join(root,'.cache'),{recursive:true});await page.$eval('.progress-recent',node=>node.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(root,'.cache/portal-layout-ux-scores.png')});
 await page.locator('.portal-ux-history-tools button').click();await page.waitForFunction(()=>document.querySelector('.progress-recent>.progress-attempts')?.hidden===false);
 const text=await page.$eval('.progress-recent>.progress-attempts',node=>node.textContent);assert.match(text,/Score: 21 \/ 26/);assert.match(text,/Score: 0 \/ 26/);assert.doesNotMatch(text,/Saved draft|Not scored|Continue response/);assert.deepEqual(errors,[]);
});
