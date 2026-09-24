'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('portal accessibility and delivery audit stays clean',()=>{
  const html=read('public/index.html');
  const css=read('public/index.css');
  const workspaceCss=read('public/portal-workspace.css');
  const portal=read('public/index.js');
  const reading=read('public/reading-practice.js');
  const lab=read('public/writing-lab-client.js');
  const server=read('server.js');
  const build=read('scripts/build-frontend.js');

  assert.equal((html.match(/<h1\b/g)||[]).length,1,'keep one application-level h1');
  assert.doesNotMatch(html,/<iframe\b/i);
  assert.doesNotMatch(html,/\sstyle="/i);
  assert.doesNotMatch(html,/Material\+Symbols|material-symbols-outlined|Fraunces|Plus\+Jakarta|Plus Jakarta/i);
  assert.match(html,/writing-lab-portal\.css/);
  assert.match(html,/writing-lab-client\.js/);
  assert.doesNotMatch(lab,/<h1\b/,'Writing Lab uses the application page title instead of nested H1s');
  assert.doesNotMatch(portal,/<h1 class="essay-title">/,'Essay preview must not add a second application H1');
  for(const [id,label] of [['f_intro','Introduction'],['f_bp1','Body paragraph 1'],['f_bp2','Body paragraph 2'],['f_concl','Conclusion']]) {
    assert.match(html,new RegExp('id="'+id+'"[^>]*aria-label="'+label+'"'));
  }
  assert.match(html,/<button[^>]+practice-shortcut-link[^>]*>Practise this question/);
  assert.match(html,/From your teacher/);
  assert(html.indexOf('id="portalResume"') < html.indexOf('id="nextStepsDashboardCard"'));
  assert(html.indexOf('id="nextStepsDashboardCard"') < html.indexOf('id="todayPlanCard"'));
  assert.match(html,/index\.min\.js/);
  assert(html.indexOf('auth-boot.js')<html.indexOf('index.min.js'));

  for(const [name,source] of [['portal',portal],['reading',reading],['writing lab',lab]]){
    assert.doesNotMatch(source,/\bprompt\s*\(/,name+' must not use prompt()');
    assert.doesNotMatch(source,/\bconfirm\s*\(/,name+' must not use confirm()');
    assert.doesNotMatch(source,/font-size:\s*(?:[0-9]|1[01](?:\.\d+)?)px/,name+' generated UI must not use sub-12px text');
    assert.doesNotMatch(source,/#4f46e5|#5a51da|#6366f1|rgba\(99,\s*102,\s*241/i,name+' must not reintroduce the legacy indigo palette');
  }

  for(const [name,source] of [['index.css',css],['portal-workspace.css',workspaceCss]]){
    const sizes=[...source.matchAll(/@media\s*\((?:max|min)-width:\s*([0-9.]+)px\)/g)].map(m=>Number(m[1]));
    assert(sizes.every(n=>[640,900,1200].includes(n)),name+' uses only the three portal breakpoints');
    assert.doesNotMatch(source,/font-size:\s*(?:[0-9]|1[01](?:\.\d+)?)px/,name+' must not use sub-12px text');
    assert.doesNotMatch(source,/#4f46e5|#5a51da|#6366f1|rgba\(99,\s*102,\s*241/i,name+' must not reintroduce the legacy indigo palette');
  }

  assert.match(css,/--ink-mute:\s*#526174/);
  assert.match(css,/min-height:44px/);
  const catalogue=read('public/practice-catalogue.js');
  assert.doesNotMatch(catalogue,/Tests per page/);
  assert.match(catalogue,/Repeated prediction items are marked Revision/);
  assert.match(catalogue,/Integrated Reading & Listening Sectional Mock/);
  assert.match(catalogue,/Summarise Written Text/);
  assert.match(catalogue,/Highlight Incorrect Words/);
  assert.match(catalogue,/Highlight Correct Summary/);
  assert.match(catalogue,/Last attempt/);
  assert.match(catalogue,/In progress/);
  assert.match(server,/max-age=31536000, immutable/);
  assert.match(build,/terser@5\.44\.0/);
  assert.match(build,/ipt-brisbane-logo\.webp/);
  assert.match(build,/ffmpeg/);
});
