'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),puppeteer=require('puppeteer');
const {fixture}=require('./helpers/auth-server');
const readingQuestions=require('../public/practice-catalogue').readingLibraries(require('../public/reading-bank.json')).flatMap(library=>library.questions);
const speakingQuestions=require('../content/speaking-bank').questions;
const listeningQuestions=require('../writing-lab').individualQuestions;
const byKey=(questions,key,field='id')=>questions.find(q=>String(q[field])===key);

async function checkQuestionSearch(page, route){
 const library='[data-practice-library-task="'+route+'"]';
 const row=library+' [data-question-key]', search=library+' input[type="search"]';
 let key=await page.$eval(row,node=>node.dataset.questionKey),query,preview,remote=false;
 if(route.startsWith('reading-')){
  const q=byKey(readingQuestions,key,'uid');
  if(q.type==='reorder'){
   query=q.answers.map(id=>q.items.find(item=>item.key===id).text).join('\n\n');
   preview=q.items[0].text;
  }else{
   query=q.passage.replace(/\[\[(\d+)\]\]/g,(_,n)=>q.answers[n-1]);
   preview=q.passage.replace(/\[\[\d+\]\]/g,'_____');
  }
 }else if(route.startsWith('speaking-')){
  remote=true;
  if(route==='speaking-di'){
   const keys=await page.$$eval(row,nodes=>nodes.map(node=>node.dataset.questionKey));
   const q=speakingQuestions.find(q=>keys.includes(q.id)&&q.visual?.labels?.some(label=>typeof label==='string'&&!q.title.includes(label)));
   key=q.id;
   query=q.visual.labels.find(label=>typeof label==='string'&&!q.title.includes(label));
  }else{
   query=byKey(speakingQuestions,key).text;
   if(['speaking-ra','speaking-rts'].includes(route))preview=query;
  }
 }else if(route==='swt'||route==='practice'){
  query=await page.evaluate((route,id)=>route==='swt'?passages.find(p=>String(p.id)===id).text:essays.find(e=>e.id===id).question,route,key);
  preview=query;
 }else{
  remote=true;
  const q=byKey(listeningQuestions,key);
  query=q.passage||q.text;
  preview=q.passage?.replace(/\[\[\d+\]\]/g,'_____')||q.prompt;
 }
 assert.ok(query,route+' has searchable question text');
 const result=remote?page.waitForResponse(response=>response.url().endsWith('/api/practice-library/'+route+'/transcript-search')&&response.request().method()==='POST'):null;
 await page.$eval(search,(field,text)=>{
  const clipboardData=new DataTransfer();
  clipboardData.setData('text/plain',text+'\n');
  field.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}));
 },query);
 if(result){
  const response=await result;
  assert.equal(response.status(),200,route);
  const data=await response.json();
  assert.ok(data.matches.includes(key),route);
  if(!preview)assert.equal(data.previews[key],undefined,route);
 }
 const matched=row+'[data-question-key="'+key+'"]';
 await page.waitForSelector(matched,{visible:true});
 if(route.startsWith('reading-'))assert.deepEqual(await page.$$eval(row,nodes=>nodes.map(node=>node.dataset.questionKey)),[key],route);
 if(preview){
  await page.locator(matched+' .practice-library-passage summary').click();
  assert.equal(await page.$eval(matched+' .practice-library-passage-text',node=>node.textContent),preview,route);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,route);
 }else if(['dictation','speaking-rs','spoken-text'].includes(route)){
  assert.equal(await page.$(matched+' .practice-library-passage'),null,route);
 }
 await page.$eval(search,field=>{field.value='';field.dispatchEvent(new Event('input',{bubbles:true}));});
}

test('All five Reading tasks find pasted passages at 390px', {timeout:90000}, async t=>{
 const f=await fixture(t),username='reading-passage-mobile',password='Synthetic-pass-123';
 assert.equal((await f.request('/api/auth/register',{username,password,email:username+'@example.test'})).body.success,true);
 const browser=await puppeteer.launch({headless:true,executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH||undefined});
 t.after(()=>browser.close());
 const page=await browser.newPage();
 await page.setViewport({width:390,height:850});
 await page.setRequestInterception(true);
 page.on('request',request=>request.url().startsWith(f.base+'/')?request.continue():request.abort());
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(f.base,{waitUntil:'domcontentloaded'});
 await page.locator('#loginUsername').fill(username);
 await page.locator('#loginPassword').fill(password);
 await page.locator('#loginSubmitBtn').click();
 await page.waitForFunction(()=>document.getElementById('appShell')?.style.display==='grid'&&document.getElementById('loadingVeil')?.classList.contains('hidden'));
 const group=require('../public/practice-catalogue').groups.find(group=>group.id==='reading');
 for(const {route} of group.tasks){
  await page.evaluate(route=>switchSection(route),route);
  await page.waitForSelector('[data-practice-library-task="'+route+'"] [data-question-key]',{visible:true});
  await checkQuestionSearch(page,route);
 }
 assert.deepEqual(errors,[]);
});

for(const width of [1366,1920])test('Unified practice library '+width+'px: all 21 tasks fill the desktop and fresh responses preserve saved work',{timeout:150000},async t=>{
 const f=await fixture(t),username='library-review',password='Synthetic-pass-123';
 const registration=await f.request('/api/auth/register',{username,password,email:username+'@example.test'});assert.equal(registration.body.success,true);
 assert.equal((await f.request('/api/admin/speaking-access',{username,enabled:true},null,true)).status,200);
 const browser=await puppeteer.launch({headless:true,executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH||undefined});t.after(()=>browser.close());
 const page=await browser.newPage();await page.setViewport({width,height:900});page.setDefaultTimeout(30000);const errors=[],grades=[];
 page.on('pageerror',e=>{errors.push(e.message);console.error('browser error',e.message);});page.on('request',r=>{if(r.method()==='POST'&&/\/(?:grade|score)(?:\/|$)/.test(new URL(r.url()).pathname))grades.push(r.url());});
 await page.setRequestInterception(true);
 page.on('request',request=>request.url().startsWith(f.base+'/')?request.continue():request.abort());
 await page.goto(f.base,{waitUntil:'domcontentloaded',timeout:45000});await page.type('#loginUsername',username);await page.type('#loginPassword',password);await page.locator('#loginSubmitBtn').click();await page.waitForFunction(()=>document.getElementById('appShell')?.style.display==='grid'&&document.getElementById('loadingVeil')?.classList.contains('hidden'));
 const tasks=require('../public/practice-catalogue').groups.flatMap(g=>g.tasks);
 for(const task of tasks){
  await page.evaluate(route=>switchSection(route),task.route);
  await page.waitForFunction(()=>[...document.querySelectorAll('.pane.active .practice-question-library')].some(n=>n.getBoundingClientRect().height>0&&n.querySelector('.practice-library-row')));
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));document.querySelectorAll('.pane.active').forEach(n=>n.getAnimations({subtree:true}).forEach(a=>a.finish()));});
  const shape=await page.evaluate(()=>{const library=[...document.querySelectorAll('.pane.active .practice-question-library')].find(n=>n.getBoundingClientRect().height>0),search=library.querySelector('input[type=search]'),select=library.querySelector('.practice-library-filters select'),row=library.querySelector('.practice-library-row'),button=row.querySelector('button'),s=search.getBoundingClientRect(),f=select.getBoundingClientRect();return{libraryWidth:library.getBoundingClientRect().width,viewport:innerWidth,heading:library.querySelector('h2').textContent,labels:[...library.querySelectorAll('.practice-library-filters>label')].map(n=>n.firstChild.textContent),horizontal:Math.abs(s.top-f.top)<3,meta:row.querySelector('small').textContent,title:!!row.querySelector('h3').textContent,action:button.textContent.trim(),buttonHeight:button.getBoundingClientRect().height,listeningModes:library.closest('.pane').querySelectorAll('[data-listening-mode]').length,rowFont:getComputedStyle(row.querySelector('h3')).fontSize,rowsHeight:getComputedStyle(library.querySelector('.practice-library-rows')).maxHeight,extraHeading:[...library.closest('.pane').querySelectorAll('.studio-heading')].some(n=>n.getBoundingClientRect().height>0),rowsOverflow:getComputedStyle(library.querySelector('.practice-library-rows')).overflowY,overflow:document.documentElement.scrollWidth>innerWidth};});
  const fonts=await page.evaluate(()=> {
   const library=[...document.querySelectorAll('.pane.active .practice-question-library')].find(node=>node.getBoundingClientRect().height>0);
   return ['h2','h3','input[type="search"]','select','[data-library-view]','[data-library-flag="report"]','[data-library-flag="bookmark"]']
    .map(selector=>[selector,getComputedStyle(library.querySelector(selector)).fontFamily]);
  });
  for(const [selector,family] of fonts)assert.equal(family,'system-ui, sans-serif',task.route+' '+selector);
  const timerShape=await page.$eval('.pane.active .practice-question-library [role="switch"]',node=>{
   const css=getComputedStyle(node,node.matches('button')?'::before':null);
   return {kind:node.tagName,appearance:css.appearance,width:css.width,height:css.height};
  });
  assert.equal(timerShape.width,'30px',task.route);
  assert.equal(timerShape.height,'18px',task.route);
  assert.equal(timerShape.kind,task.route.startsWith('speaking-')?'BUTTON':'INPUT',task.route);
  if(timerShape.kind==='INPUT')assert.equal(timerShape.appearance,'none',task.route);
  const newSwitch=await page.$eval('.pane.active .practice-question-library [data-library-new-only]',node=>{
   const css=getComputedStyle(node,'::before');
   return {label:node.textContent,role:node.getAttribute('role'),checked:node.getAttribute('aria-checked'),width:css.width,height:css.height};
  });
  assert.deepEqual(newSwitch,{label:'New only',role:'switch',checked:'false',width:'30px',height:'18px'},task.route);
  if(['swt','speaking-ra','speaking-sgd','reading-dropdown','spoken-text','practice'].includes(task.route)){const fs=require('node:fs/promises');await fs.mkdir(require('node:path').join(__dirname,'../.cache'),{recursive:true});await page.screenshot({path:require('node:path').join(__dirname,'../.cache/practice-library-'+task.route+'.png')});}
  assert(shape.libraryWidth>=shape.viewport-100,task.route+' library must fill the desktop '+JSON.stringify(shape));assert.deepEqual(shape.labels,['Find a question','Show'],task.route);assert.equal(shape.horizontal,true,task.route);assert.equal(shape.meta,'#1',task.route);assert.equal(shape.title,true);assert.equal(shape.action,'Practise →',task.route);assert(shape.buttonHeight>=44,task.route+' '+JSON.stringify(shape));assert.equal(shape.rowsOverflow,'auto',task.route);assert.equal(shape.rowFont,'16px',task.route);assert.equal(shape.rowsHeight,'585px',task.route);assert.equal(shape.extraHeading,false,task.route);assert(shape.listeningModes<=2,task.route+' has duplicate mode controls');assert.equal(shape.overflow,false,task.route);
  await checkQuestionSearch(page,task.route);
 }
 // Default Essay entry is the list. Practise is fresh and Resume draft is explicit.
 await page.evaluate(()=>switchSection('practice'));await page.waitForSelector('[data-essay-open]',{visible:true});assert.equal(await page.$('#practiceStartBtn'),null);const essayId=await page.$eval('[data-essay-open]',e=>e.dataset.essayOpen);
 async function startEssay(){await page.locator('[data-essay-open="'+essayId+'"]').click();if(await page.$('#essay-guide[open]'))await page.locator('.essay-guide-skip').click();await page.waitForSelector('#practiceEssayInput',{visible:true});}
 await startEssay();await page.type('#practiceEssayInput','An unfinished essay response stays recoverable.');await page.locator('[data-writing-return="essay"]').click();await page.waitForSelector('[data-essay-resume="'+essayId+'"]',{visible:true});await startEssay();assert.equal(await page.$eval('#practiceEssayInput',e=>e.value),'');await page.locator('[data-writing-return="essay"]').click();await page.waitForSelector('[data-essay-resume="'+essayId+'"]',{visible:true});await page.locator('[data-essay-resume="'+essayId+'"]' ).click();await page.waitForSelector('#practiceEssayInput',{visible:true});assert.equal(await page.$eval('#practiceEssayInput',e=>e.value),'An unfinished essay response stays recoverable.');
 // A fresh SWT response follows the library switch. A resumed draft keeps its earlier clock.
 await page.evaluate(()=>switchSection('swt'));
 const swtOpen='#swtQuestionLibrary.active [data-swt-open="1"]';
 const timedSwitch='#swtLibraryTimed';
 await page.waitForSelector(swtOpen,{visible:true});
 assert.equal(await page.$eval(timedSwitch,node=>node.checked),false);
 await page.focus(timedSwitch);
 await page.keyboard.press('Space');
 await page.waitForFunction(selector=>getComputedStyle(document.querySelector(selector)).backgroundColor==='rgb(52, 101, 90)',{},timedSwitch);
 await page.locator(swtOpen).click();
 await page.waitForSelector('#summaryInput',{visible:true});
 assert.equal(await page.$eval('#timerToggle',node=>node.getAttribute('aria-pressed')),'true');
 await page.waitForFunction(()=>/^09:/.test(document.getElementById('timerDisplay')?.textContent||''));
 await page.type('#summaryInput','An unfinished summary remains recoverable.');
 await page.locator('[data-writing-return="swt"]').click();
 await page.waitForSelector(swtOpen,{visible:true});
 await page.locator(timedSwitch).click();
 await page.locator(swtOpen).click();
 await page.waitForSelector('#summaryInput',{visible:true});
 assert.equal(await page.$eval('#summaryInput',node=>node.value),'');
 assert.equal(await page.$eval('#timerToggle',node=>node.getAttribute('aria-pressed')),'false');
 assert.equal(await page.$eval('#timerDisplay',node=>node.textContent),'—');
 await page.locator('[data-writing-return="swt"]').click();
 const resume='[data-swt-resume="1"]';
 await page.waitForSelector(resume,{visible:true});
 await page.locator(resume).click();
 await page.waitForSelector('#summaryInput',{visible:true});
 assert.equal(await page.$eval('#summaryInput',node=>node.value),'An unfinished summary remains recoverable.');
 assert.equal(await page.$eval('#timerToggle',node=>node.getAttribute('aria-pressed')),'true');
 assert.match(await page.$eval('#timerDisplay',node=>node.textContent),/^09:/);
 // Reading times fresh launches and restores the draft even if the switch changes.
 await page.evaluate(()=>switchSection('reading-dropdown'));
 const readingTimed='#readingPane [data-reading-library-timed]';
 const readingOpen='#readingPane [data-practice-uid]';
 const readingClock='#readingPane [data-timer]';
 await page.waitForSelector(readingOpen,{visible:true});
 assert.equal(await page.$eval(readingTimed,node=>node.checked),false);
 await page.locator(readingTimed).click();
 const readingUid=await page.$eval(readingOpen,node=>node.dataset.practiceUid);
 await page.locator(readingOpen).click();
 const readingSnapshot=()=>page.evaluate(()=>AccountProgress.unpackReading(JSON.parse(localStorage.getItem(ReadingPractice.storageKey(currentUserId)))));
 await page.waitForSelector('#readingPane .reading-practice-dock');
 const timedReading=(await readingSnapshot()).session;
 assert.equal(timedReading.practiceUid,readingUid);
 assert.equal(timedReading.deadline-timedReading.startedAt,120000);
 assert.match(await page.$eval(readingClock,node=>node.textContent),/^(01:|02:00)/);
 await page.locator('#readingPane .reading-practice-dock [data-action="home"]').click();
 await page.waitForSelector(readingTimed,{visible:true});
 await page.locator(readingTimed).click();
 await page.locator('[data-reading-resume="'+timedReading.id+'"]').click();
 await page.waitForSelector('#readingPane .reading-practice-dock');
 assert.equal((await readingSnapshot()).session.id,timedReading.id);
 assert.match(await page.$eval(readingClock,node=>node.textContent),/^(01:|02:00)/);

 // Listening uses the practice clock without taking away replay or the saved mode.
 await page.evaluate(()=>switchSection('dictation'));
 const listeningTimed='#listeningTimed', listeningOpen='[data-listening-open]';
 await page.waitForSelector(listeningOpen,{visible:true});
 assert.equal(await page.$eval(listeningTimed,node=>node.checked),false);
 await page.locator(listeningTimed).click();
 const created=page.waitForResponse(response=>response.url().endsWith('/api/writing-lab/attempts')&&response.request().method()==='POST');
 await page.locator(listeningOpen).click();
 const timedListening=await (await created).json();
 assert.equal(timedListening.mode,'practice');
 assert.equal(timedListening.timedPractice,true);
 await page.waitForSelector('#audio-replay',{visible:true});
 assert.match(await page.$eval('.listening-practice-dock',node=>node.textContent),/Timed practice/);
 await page.locator('.listening-practice-dock [data-tab="wfd"]').click();
 await page.waitForSelector(listeningTimed,{visible:true});
 await page.locator(listeningTimed).click();
 await page.locator('[data-listening-attempt="'+timedListening.id+'"]').click();
 await page.waitForSelector('#audio-replay',{visible:true});
 assert.match(await page.$eval('.listening-practice-dock',node=>node.textContent),/Timed practice/);
 assert.deepEqual(errors,[]);assert.deepEqual(grades,[]);
});


test('Essay and SWT question lists show the newest score and recognise a legacy prompt identity',{timeout:90000},async t=>{
 const f=await fixture(t),username='question-list-scores',password='Synthetic-pass-123';const registration=await f.request('/api/auth/register',{username,password,email:username+'@example.test'});
 const browser=await puppeteer.launch({headless:true,executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH||undefined});t.after(()=>browser.close());const page=await browser.newPage();await page.setViewport({width:1366,height:900});
 await page.goto(f.base);await page.type('#loginUsername',username);await page.type('#loginPassword',password);await page.locator('#loginSubmitBtn').click();await page.waitForFunction(()=>document.getElementById('appShell')?.style.display==='grid'&&document.getElementById('loadingVeil')?.classList.contains('hidden'));
 await page.evaluate(()=>{
  const q=essays.find(e=>e.question?.trim()),date=Date.now();
  savePracticeHistory([{id:'older-high-score',date:date-2000,questionId:q.id,questionTitle:q.title,questionText:q.question,essayText:'An older synthetic answer.',scores:{total:26}},{id:'newer-legacy-score',date:date-1000,questionId:'previous-library-id',questionTitle:q.title,questionText:q.question,essayText:'The latest synthetic answer.',scores:{total:0}}]);
  switchSection('practice');
 });
 await page.waitForSelector('#practiceQuestionPicker .practice-library-score');const row=await page.$eval('#practiceQuestionPicker .practice-library-row',node=>node.textContent);assert.match(row,/Completed · 2 saved attempts/);assert.match(row,/Latest score: 0 \/ 26/);assert(!row.includes('Not attempted'));
 await require('node:fs/promises').mkdir(require('node:path').join(__dirname,'../.cache'),{recursive:true});await page.screenshot({path:require('node:path').join(__dirname,'../.cache/practice-library-latest-essay-score.png')});
 await page.select('#essayQuestionStatus','done');await page.waitForFunction(()=>document.querySelectorAll('#practiceQuestionPicker .practice-library-row').length===1);await page.select('#essayQuestionStatus','new');await page.waitForFunction(()=>!document.querySelector('#practiceQuestionPicker .practice-library-score'));
 // Feed saved SWT history through normal account sync, then open its question list.
 const passage=(await f.request('/api/passages')).body.passages[0],timestamp=Date.now();
 await f.request('/api/sync/'+username,{history:{[passage.id]:[{timestamp:timestamp-1000,text:'An older synthetic summary.',trait_scores:{content:3,form:1,grammar:2,vocabulary:2},overall_score:80},{timestamp,text:'A newer synthetic summary.',trait_scores:{content:0,form:0,grammar:0,vocabulary:0},overall_score:0}]}},registration.body.token);
 await page.reload();await page.waitForFunction(()=>document.getElementById('loadingVeil')?.classList.contains('hidden'));await page.evaluate(()=>switchSection('swt'));await page.waitForSelector('#swtQuestionRows .practice-library-score');
 const swt=await page.$eval('#swtQuestionRows .practice-library-score',node=>node.textContent);assert.match(swt,/Latest score: 0 \/ 9/);
});
