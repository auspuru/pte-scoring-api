'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {isNew}=require('../public/swt-new-question');
const q={id:940519,questionSet:'nov23-2026-swt',title:'Learning and Growing in Relationships'};
test('new for user who has not attempted this import',()=>assert.equal(isNew(q,{},new Set()),true));
test('draft alone does not count as an attempt',()=>assert.equal(isNew(q,{},new Set()),true));
test('submitted history hides NEW for that student',()=>assert.equal(isNew(q,{940519:[{text:'a summary'}]},new Set()),false));
test('saved attempted flag hides NEW when history unavailable',()=>assert.equal(isNew(q,{},new Set([940519])),false));
test('other student remains NEW independently',()=>assert.equal(isNew(q,{},new Set()),true));
test('older questions never display NEW label',()=>assert.equal(isNew({id:17}, {}, new Set()),false));

test('new standalone SWT displays NEW until submitted without entering prediction mocks', () => {
  const {passages, swt}=require('../content/user-swt-predictions');
  const added=passages.find(p=>p.id===910472);
  assert.equal(added.sourceNumber,472);
  assert.equal(isNew(added, {}, new Set()), true);
  assert.equal(isNew(added, {910472:[{text:'submitted'}]}, new Set()), false);
  assert(!swt.some(q=>q.text===added.text));
});
