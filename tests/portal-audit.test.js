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
  const tokensCss=read('public/ipt-tokens.css');
  const liquidCss=read('public/portal-liquid-glass.css');
  const homePracticeCss=read('public/portal-home-practice.css');
  const insightsCss=read('public/portal-insights.css');
  const vocabLibraryCss=read('public/portal-vocab-library.css');
  const portalShell=read('public/portal-shell.js');
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
  assert.match(portal,/function renderVocabFlashcardContainer\(\)/,'use the existing vocabulary flashcard flow');
  assert.match(portal,/function toggleFlashcardFlip\(\)/,'preserve the existing flashcard flip state');
  assert.match(portal,/function handleFlashcardAction\(gotIt\)/,'preserve saved vocabulary review actions');
  for(const [id,label] of [['f_intro','Introduction'],['f_bp1','Body paragraph 1'],['f_bp2','Body paragraph 2'],['f_concl','Conclusion']]) {
    assert.match(html,new RegExp('id="'+id+'"[^>]*aria-label="'+label+'"'));
  }
  assert.match(html,/<button[^>]+practice-shortcut-link[^>]*>Practise this question/);
  assert.match(html,/From your teacher/);
  assert(html.indexOf('id="portalResume"') < html.indexOf('id="nextStepsDashboardCard"'));
  assert(html.indexOf('id="nextStepsDashboardCard"') < html.indexOf('id="todayPlanCard"'));
  assert.match(html,/index\.min\.js/);
  assert(html.indexOf('auth-boot.js')<html.indexOf('index.min.js'));
  assert.match(html,/\/ipt-tokens\.css/);
  assert.match(html,/\/portal-liquid-glass\.css/);
  assert.match(html,/\/portal-home-practice\.css/);
  assert.match(html,/\/portal-insights\.css/);
  assert.match(html,/\/portal-vocab-library\.css/);
  assert.match(html,/\/portal-shell\.js/);
  assert(html.indexOf('/interventions.css') < html.indexOf('/ipt-tokens.css'),'IPT tokens load after legacy feature styles');
  assert(html.indexOf('/ipt-tokens.css') < html.indexOf('/portal-liquid-glass.css'),'Liquid Glass loads after tokens');
  assert(html.indexOf('/portal-liquid-glass.css') < html.indexOf('/portal-home-practice.css'),'Home and Practice styles load after the shell');
  assert(html.indexOf('/portal-home-practice.css') < html.indexOf('/portal-insights.css'),'Mock Teacher Progress styles load after Home and Practice');
  assert(html.indexOf('/portal-insights.css') < html.indexOf('/portal-vocab-library.css'),'Vocabulary and Library styles load after insights');
  assert.doesNotMatch(html,/data:image\//i,'production HTML must not embed a Base64 logo');

  for(const [name,source] of [['portal',portal],['reading',reading],['writing lab',lab]]){
    assert.doesNotMatch(source,/\bprompt\s*\(/,name+' must not use prompt()');
    assert.doesNotMatch(source,/\bconfirm\s*\(/,name+' must not use confirm()');
    assert.doesNotMatch(source,/font-size:\s*(?:[0-9]|1[01](?:\.\d+)?)px/,name+' generated UI must not use sub-12px text');
    assert.doesNotMatch(source,/#4f46e5|#5a51da|#6366f1|rgba\(99,\s*102,\s*241/i,name+' must not reintroduce the legacy indigo palette');
  }

  for(const [name,source] of [['index.css',css],['portal-workspace.css',workspaceCss],['ipt-tokens.css',tokensCss],['portal-liquid-glass.css',liquidCss],['portal-home-practice.css',homePracticeCss],['portal-insights.css',insightsCss],['portal-vocab-library.css',vocabLibraryCss]]){
    const sizes=[...source.matchAll(/@media\s*\((?:max|min)-width:\s*([0-9.]+)px\)/g)].map(m=>Number(m[1]));
    assert(sizes.every(n=>[640,900,1200].includes(n)),name+' uses only the three portal breakpoints');
    assert.doesNotMatch(source,/font-size:\s*(?:[0-9]|1[01](?:\.\d+)?)px/,name+' must not use sub-12px text');
    assert.doesNotMatch(source,/#4f46e5|#5a51da|#6366f1|rgba\(99,\s*102,\s*241/i,name+' must not reintroduce the legacy indigo palette');
  }

  assert.match(css,/--ink-mute:\s*#526174/);
  assert.match(css,/min-height:44px/);
  assert.match(tokensCss,/--ipt-blue-700:\s*#205080/);
  assert.match(tokensCss,/--ipt-red-600:\s*#c53030/i);
  assert.match(liquidCss,/backdrop-filter:\s*blur\(22px\)/);
  assert.match(liquidCss,/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(portalShell,/MutationObserver/);
  assert.match(portalShell,/ipt-nav-indicator/);
  assert.match(portalShell,/iptShellReady/);
  assert.doesNotMatch(portalShell,/\bprompt\s*\(|\bconfirm\s*\(/);
  const catalogue=read('public/practice-catalogue.js');
  assert.doesNotMatch(catalogue,/Tests per page/);
  assert.match(catalogue,/Integrated Reading & Listening Sectional Mock/);
  assert.match(catalogue,/Reading Practice Mock/);
  assert.match(catalogue,/Array\.from\(\{ length: 15 \}/);
  assert.match(catalogue,/minutes: 23/);
  assert.doesNotMatch(catalogue,/mock-catalogue-description/);
  assert.doesNotMatch(catalogue,/mock-catalogue-scope/);
  assert.doesNotMatch(catalogue,/Includes:/);
  assert.match(catalogue,/Last attempt/);
  assert.match(catalogue,/In progress/);
  assert.match(server,/max-age=31536000, immutable/);
  assert.match(build,/terser@5\.44\.0/);
  assert.match(build,/ipt-brisbane-logo\.webp/);
  assert.match(build,/ffmpeg/);
});
