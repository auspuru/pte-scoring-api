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


test('admin presentation uses IPT branding without changing authorization',()=>{
  const html=fs.readFileSync(path.join(root,'public','admin.html'),'utf8');
  const css=fs.readFileSync(path.join(root,'public','admin-liquid-glass.css'),'utf8');
  const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
  const interventions=fs.readFileSync(path.join(root,'public','admin-interventions.js'),'utf8');

  assert.match(html,/\/admin-liquid-glass\.css\?v=20260928-admin-a11y/);
  assert.match(html,/ipt-brisbane-logo\.webp/);
  assert.match(html,/aria-label="Search users"/);
  assert.match(html,/class="admin-table-scroll"/);
  assert.doesNotMatch(html,/fonts\.googleapis\.com|fonts\.gstatic\.com/);

  const sizes=[...css.matchAll(/@media\s*\((?:max|min)-width:\s*([0-9.]+)px\)/g)].map(m=>Number(m[1]));
  assert(sizes.every(n=>[640,900,1200].includes(n)),'Admin presentation uses approved portal breakpoints');
  assert.doesNotMatch(css,/font-size:\s*(?:[0-9]|1[01](?:\.\d+)?)px/);
  assert.doesNotMatch(css,/#4f46e5|#5a51da|#6366f1|rgba\(99,\s*102,\s*241/i);
  assert.match(css,/#2d6ca5/i);
  assert.match(css,/#c53030/i);
  assert.match(css,/prefers-reduced-motion:\s*reduce/);

  assert.match(interventions,/font-size:12px/);
  assert.doesNotMatch(interventions,/font-size:11px|rgba\(0,92,139|#0b6b92|@media\(max-width:800px\)/);

  assert.match(server,/function requireAdmin\(req, res, next\)/);
  assert.match(server,/if \(!ADMIN_KEY\) return res\.status\(503\)/);
  assert.match(server,/req\.headers\['x-admin-key'\]/);
  assert.match(server,/if \(key !== ADMIN_KEY\) return res\.status\(403\)/);
});


test('admin bulk deletion protects progress-only records',()=>{
  const html=fs.readFileSync(path.join(root,'public','admin.html'),'utf8');
  const server=fs.readFileSync(path.join(root,'server.js'),'utf8');

  assert.match(html,/\.user-select:not\(:disabled\)/);
  assert.equal((html.match(/\.user-select:checked:not\(:disabled\)/g)||[]).length,2);
  assert.match(server,/SELECT username FROM accounts WHERE username = ANY\(\$1::text\[\]\) FOR UPDATE/);
  assert.match(server,/const accountIds = existing\.rows\.map\(row => row\.username\)/);
  assert.match(server,/DELETE FROM user_data WHERE username = ANY\(\$1::text\[\]\)'\, \[accountIds\]/);
  assert.match(server,/DELETE FROM accounts WHERE username = ANY\(\$1::text\[\]\) RETURNING username'\, \[accountIds\]/);
  assert.doesNotMatch(server,/DELETE FROM user_data WHERE username = ANY\(\$1::text\[\]\)'\, \[ids\]/);
});

test('admin tab switching tolerates removed optional passage tabs',()=>{
  const html=fs.readFileSync(path.join(root,'public','admin.html'),'utf8');
  assert.match(html,/const tabPassages = document\.getElementById\('tabPassages'\)/);
  assert.match(html,/if \(tabPassages\) tabPassages\.classList\.toggle/);
  assert.match(html,/if \(panelPassages\) panelPassages\.classList\.toggle/);
  assert.match(html,/name === 'passages' && panelPassages && allPassages\.length === 0/);
});
