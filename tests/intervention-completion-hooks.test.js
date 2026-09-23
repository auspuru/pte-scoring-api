const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

function source(path){ return fs.readFileSync(require.resolve('../'+path),'utf8'); }

test('practice engines emit assignment-completion events only after submitted work is persisted',()=>{
  const speaking=source('public/speaking-practice.js');
  assert.match(speaking,/pte:attempt-completed/);
  assert.match(speaking,/engine:'speaking'/);

  const writing=source('public/writing-lab-client.js');
  assert.match(writing,/value\.status==='submitted'.*pte:attempt-completed/s);
  assert.match(writing,/engine:'writing-lab'/);

  const reading=source('public/reading-practice.js');
  assert.match(reading,/syncHistory\(s\); persist\(\);.*pte:attempt-completed/s);
  assert.match(reading,/engine:'reading'/);

  const portal=source('public/index.js');
  assert.match(portal,/await flushSync\(\).*pte:attempt-completed/s);
  assert.match(portal,/engine:'swt'/);
  assert.match(portal,/await saving;.*pte:attempt-completed/s);
  assert.match(portal,/engine:'essay'/);
});

test('student intervention UI treats exact questions as synchronised rather than manually completed',()=>{
  const client=source('public/interventions-client.js');
  assert.match(client,/Completion syncs after you submit it/);
  assert.match(client,/completionSource==='attempt_sync'/);
  assert.match(client,/pte:attempt-completed/);
});

test('new learning resources are present in the V2 module catalogue',()=>{
  const data=JSON.parse(source('public/improvement-modules.json'));
  const byCode=Object.fromEntries(data.modules.map(m=>[m.code,m]));
  assert.equal(data.version,2);
  assert(byCode['SST-01'].items.some(i=>String(i.url).includes('XUYKyqNpdrw')));
  assert(byCode['REG-01'].items.some(i=>String(i.url).includes('p-LV9crN3ZA')));
  assert(byCode['REG-01'].items.some(i=>String(i.url).includes('QZB_XvsBsTU')));
  assert(byCode['ESSAY-01']);
  assert.match(byCode['SWT-01'].items.map(i=>i.description).join(' '),/5.?75 words/i);
});
