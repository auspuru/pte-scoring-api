'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
test('both speaking entry points load the cue first and share its deferred request',async()=>{
 const js=fs.readFileSync(path.join(root,'public/index.js'),'utf8'),calls=[],window={},context={window,Promise,speakingRuntimeLoadPromise:null,loadDeferredScript:async url=>{
  calls.push(url);if(url.includes('speaking-start-cue'))window.SpeakingStartCue={};
  else if(url.includes('speaking-images'))window.SpeakingImages={};
  else if(url.includes('speaking-practice')){assert(window.SpeakingStartCue);assert(window.SpeakingImages);window.SpeakingPractice={};}
  else if(url.includes('speaking-mock-client')){assert(window.SpeakingStartCue);assert(window.SpeakingImages);window.SpeakingMock={};}
 }};
 const vm=require('node:vm');vm.createContext(context);vm.runInContext(js.slice(js.indexOf('let speakingCueLoadPromise='),js.indexOf('function ensureWritingLabRuntimeLoaded()')),context);
 await vm.runInContext('Promise.all([ensureSpeakingRuntimeLoaded(),ensureSpeakingMockRuntimeLoaded()])',context);
 assert.equal(calls.filter(url=>url.includes('speaking-start-cue')).length,1);assert(calls[0].includes('speaking-start-cue'));
 assert.equal(calls.filter(url=>url.includes('speaking-images')).length,1);
});

test('Speaking practice is deferred until a speaking route is opened', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'public', 'index.js'), 'utf8');

  assert.equal(html.includes('speaking-practice.js'), false);
  assert.match(js, /function ensureSpeakingRuntimeLoaded\(\)/);
  assert.match(js, /speaking-practice\.js\?v=[^\s\x27"]+/);
  assert.match(js, /Preparing Speaking practice/);
  assert.match(js, /data-speaking-load-retry/);
});

test('Speaking deferred-load failure can retry without losing the requested question', () => {
  const js = fs.readFileSync(path.join(root, 'public', 'index.js'), 'utf8');
  assert.match(js, /speaking\.open\(activeRoute\.speakingType, options\.speakingRequest\?\.questionId\)/);
  assert.match(js, /switchSection\(active, \{ \.\.\.options, history: 'replace' \}\)/);
});

test('Speaking styles and portal bundle are cache-busted with the delivery UI release', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const hash=require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,'public','speaking-practice.css'))).digest('hex').slice(0,12);
  assert(html.includes('speaking-practice.css?v=sha256-'+hash));
  assert.match(html, /index\.min\.js\?v=[^"\s]+/);
});


test('Speaking question counts remain visible in the Practice hub while the runtime stays lazy', () => {
  const js = fs.readFileSync(path.join(root, 'public', 'index.js'), 'utf8');
  assert.match(js, /\/api\/speaking\/catalog/);
  assert.match(js, /ra:'speaking-ra'.*rs:'speaking-rs'.*di:'speaking-di'.*rl:'speaking-rl'.*sgd:'speaking-sgd'.*rts:'speaking-rts'/s);
  assert.match(js, /result\.practice\[route\]\.count=count/);
  assert.match(js, /\/api\/speaking\/attempts/);
  assert.match(js, /setLatestPracticeMeta\(result\.practice,route,practiceLastTime\(attempt\)\)/);
});
