'use strict';
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('Writing motion keeps native cursor and does not track pointer movement',()=>{
  const js=read('public/portal-writing-motion.js');
  const css=read('public/portal-writing-motion.css');
  assert.match(js,/new Set\(\['practice', 'swt'\]\)/);
  assert.match(js,/prefers-reduced-motion: reduce/);
  assert.match(js,/requestAnimationFrame/);
  assert.doesNotMatch(js,/pointermove|clientX|clientY|ensureCursor|renderCursor|pressCursor/);
  assert.doesNotMatch(js,/ipt-writing-cursor-(?:dot|halo|enabled)/);
  assert.doesNotMatch(css,/ipt-writing-cursor-(?:dot|halo|enabled)|cursor:\s*none/);
  assert.doesNotMatch(js,/speakingPane|speaking-[a-z]+/i);
});

test('Writing transitions preserve the existing practice DOM contract',()=>{
  const js=read('public/portal-writing-motion.js');
  const portal=read('public/index.js');
  assert.match(js,/MutationObserver/);
  assert.match(js,/document\.getElementById\('practiceContent'\)/);
  assert.match(js,/node\.animate\(/);
  assert.doesNotMatch(js,/\.innerHTML\s*=/,'motion helper must not rebuild task DOM');
  assert.match(portal,/function renderPracticeMain\(\)/);
  assert.match(portal,/savePortalEssayDraft\(\)/);
  assert.match(portal,/startPracticeTimerInterval\(\)/);
});

test('Writing visual layer is lazy, responsive and text-safe',()=>{
  const css=read('public/portal-writing-motion.css');
  const shell=read('public/portal-shell.js');
  const html=read('public/index.html');
  assert.match(shell,/portal-writing-motion\.css\?v=20260929-native-cursor/);
  assert.doesNotMatch(html,/<link[^>]+portal-writing-motion\.css/);
  assert.match(html,/portal-writing-motion\.js\?v=20260929-native-cursor/);
  assert.match(css,/@media \(max-width: 900px\)/);
  assert.match(css,/@media \(max-width: 640px\)/);
  assert.match(css,/@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css,/font-size:\s*(?:[0-9]|1[01](?:\.\d+)?)px/);
  assert.doesNotMatch(css,/#4f46e5|#5a51da|#6366f1|rgba\(99,\s*102,\s*241/i);
});
