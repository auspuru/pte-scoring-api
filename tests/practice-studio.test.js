'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const {createHash} = require('node:crypto');
const studio = require('../public/practice-studio'), catalogue = require('../public/practice-catalogue');
const workspace = require('../public/portal-workspace');
const source = fs.readFileSync(path.join(__dirname, '../public/index.js'), 'utf8');

test('Task navigation uses the catalogue routes and identifies exactly one current task', () => {
  for (const group of catalogue.groups) for (const task of group.tasks) {
    const html = studio.navigation(group.id, task.route);
    assert.deepEqual([...html.matchAll(/data-studio-route="([^"]+)"/g)].map(m => m[1]), ['practice-hub', ...group.tasks.map(t => t.route)]);
    assert.equal([...html.matchAll(/aria-current="page"/g)].length, 1);
    assert(html.includes('data-studio-route="'+task.route+'" aria-current="page"'));
    assert(workspace.routes[task.route], task.route);
    assert.doesNotMatch(html, /data-studio-route="mock/);
  }
});

test('Delegated navigation reaches the actual portal dispatcher, including all speaking and reading lazy routes', async () => {
  const calls = [], nodes = new Map(), listeners = {};
  const doc = {querySelectorAll: () => [], addEventListener: (name, fn) => {listeners[name] = fn;}, getElementById: id => {
    if (!nodes.has(id)) nodes.set(id, {innerHTML:''}); return nodes.get(id);
  }};
  let active;
  const context = {speakingAccessUser:'pppp',speakingAccessEnabled:true,currentUserId:'pppp', PortalWorkspace: workspace, window:{}, document:doc, savePortalEssayDraft(){},
    portalWorkspace:{activate(route){active=route;return route;},current:()=>active},
    ensureReadingRuntimeLoaded:async()=>({open:request=>calls.push(['reading',request.libraryId])}),
    ensureSpeakingRuntimeLoaded:async()=>({open:type=>calls.push(['speaking',type])}),
    openPractice:()=>calls.push(['essay']), portalCatalogue:{openPractice:()=>calls.push(['hub'])}, toast(error){throw Error(error);}};
  vm.createContext(context);
  const start=source.indexOf('function switchSection('),end=source.indexOf('\n}\n',start);
  const helper=source.indexOf('function canUseSpeaking(');
  vm.runInContext(source.slice(helper,source.indexOf('\n',helper))+'\n'+source.slice(start,end+2),context);
  studio.install({document:doc,switchSection:route=>context.switchSection(route)});
  for (const group of catalogue.groups.filter(g=>g.id!=='listening')) for (const task of group.tasks) {
    const button={disabled:false,dataset:{studioRoute:task.route}};
    listeners.click({target:{closest:()=>button}});
    await new Promise(resolve=>setImmediate(resolve));
    if(group.id==='speaking') assert.deepEqual(calls.at(-1),['speaking',workspace.routes[task.route].speakingType]);
    else if(group.id==='reading') assert.deepEqual(calls.at(-1),['reading',task.type]);
    else if(task.route==='practice') assert.deepEqual(calls.at(-1),['essay']);
    else assert.equal(active,'swt');
  }
});

test('Recording locks disable task buttons; delegated clicks reject disabled and unknown routes', () => {
  const locked=studio.navigation('speaking','speaking-ra',{disabled:true});
  assert.equal([...locked.matchAll(/ disabled/g)].length,7);
  const calls=[],listeners={},node={dataset:{studioNavigation:'writing',studioActive:'swt'}};
  const doc={querySelectorAll:()=>[node],addEventListener:(name,fn)=>{listeners[name]=fn;}};
  const env={document:doc,switchSection:route=>calls.push(route)};
  studio.install(env); const listener=listeners.click; studio.install(env);
  assert.equal(listener,listeners.click);assert.match(node.innerHTML,/data-studio-route="swt" aria-current/);
  for(const button of [{disabled:true,dataset:{studioRoute:'speaking-rs'}},{disabled:false,dataset:{studioRoute:'invalid'}},{disabled:false,dataset:{studioRoute:'practice'}}]) listener({target:{closest:()=>button}});
  assert.deepEqual(calls,['practice']);
  assert.doesNotMatch(studio.heading('Writing','<img src=x>','A & B'),/<img/);
});

test('Task chooser starts collapsed and closes on selection or Escape without trapping focus', () => {
  const html = studio.navigation('reading', 'reading-dropdown');
  assert.match(html, /<details class="practice-studio-switcher"><summary>Change task<\/summary>/);
  const calls = [], listeners = {};
  let focused = false;
  const chooser = {open:true, querySelector: () => ({focus(){focused=true;}})};
  const button = {dataset:{studioRoute:'reading-wordbank'}, closest:()=>chooser};
  studio.install({document:{querySelectorAll:()=>[],addEventListener:(type,fn)=>{listeners[type]=fn;}},switchSection:route=>calls.push(route)});
  listeners.click({target:{closest:()=>button}});
  assert.equal(chooser.open,false); assert.deepEqual(calls,['reading-wordbank']);
  chooser.open=true;
  listeners.keydown({key:'Tab',target:{closest:()=>chooser}});
  assert.equal(chooser.open,true);
  listeners.keydown({key:'Escape',target:{closest:()=>chooser}});
  assert.equal(chooser.open,false); assert.equal(focused,true);
});

test('Essay optional panels preserve the saved response, word counter and scoring control outside disclosures', () => {
  const start=source.indexOf('function writeView()'), end=source.indexOf('\nfunction setQuestionSource(',start);
  const context={practiceState:{writeStep:2,essayText:'My saved response & example',questionText:'A < B',sampleBand:'8'},
    PRACTICE_TIMER_LIMIT_MIN:20,escapeHtml:s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;'),practiceSampleBand:v=>v};
  vm.createContext(context); vm.runInContext(source.slice(start,end),context);
  const html=context.writeView(), panels=[...html.matchAll(/<details\b[^>]*>[\s\S]*?<\/details>/g)].map(m=>m[0]);
  assert.equal(panels.length,2);
  assert(panels.every(p=>!/<details[^>]*\bopen\b/.test(p)));
  assert(panels.some(p=>p.includes('id="practiceSampleBand"')));
  assert(panels.some(p=>p.includes('id="practiceTemplateOverlapGuidance"')));
  const main=panels.reduce((remaining,p)=>remaining.replace(p,''),html);
  assert.match(main,/id="practiceEssayInput"[^>]*>My saved response &amp; example<\/textarea>/);
  assert.match(main,/id="practiceWordCount"/); assert.match(main,/id="practiceSubmitBtn"/);
  assert.match(main,/A &lt; B/);
});

test('Shared UI and deferred practice runtimes are fingerprinted and loaded in dependency order', () => {
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  for(const name of ['practice-studio.js','practice-studio.css','reading-practice.js','speaking-practice.js','speaking-mock-client.js','speaking-mock.css','portal-calm.css']) {
    const hash=createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../public',name))).digest('hex').slice(0,12);
    assert((name.startsWith('practice-studio')||name.endsWith('.css')?html:source).includes(name+'?v=sha256-'+hash),name+' must invalidate older immutable browser copies');
  }
  assert(html.indexOf('practice-catalogue.js?')<html.indexOf('practice-studio.js?'));
  assert(html.indexOf('practice-studio.js?')<html.indexOf('index.min.js?'));
});
