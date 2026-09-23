const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');

test('admin page inline scripts remain syntactically valid',()=>{
  const html=fs.readFileSync(path.join(root,'public','admin.html'),'utf8');
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(x=>x.trim());
  assert(scripts.length>=2);
  for(const code of scripts) new Function(code);
});

test('admin lists both login accounts and progress-only student records',()=>{
  const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'public','admin.html'),'utf8');
  const interventions=fs.readFileSync(path.join(root,'public','admin-interventions.js'),'utf8');
  assert.match(server,/Object\.keys\(data\.accounts \|\| \{\}\)/);
  assert.match(server,/Object\.keys\(data\.users \|\| \{\}\)/);
  assert.match(server,/hasAccount: !!a/);
  assert.match(html,/Progress only/);
  assert.match(html,/login accounts/);
  assert.match(html,/data-has-account/);
  assert.match(interventions,/row\.dataset\.hasAccount==='false'/);
});
