'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { previewUsers, createPreviewAccess, checkPreviewAccounts } = require('../full-mock/access');
test('Named Full Mock preview access is exact and leaves ordinary student roles unchanged', () => {
  const can = createPreviewAccess({users:' Mahabir1, MAHABIR1 ',verifyImpersonation:token => token === 'staff-view' ? 'other' : null});
  const account = {role:'user'};
  assert.equal(can({account,uid:'mahabir1',token:'session'}),true);
  assert.equal(can({account,uid:'MAHABIR1',token:'session'}),true);
  for (const uid of ['pppp','mehakbir1','mahabir10','mahabir1.other','other']) assert.equal(can({account,uid,token:'session'}),false,uid);
  assert.equal(can({account,uid:'other',token:'staff-view'}),true);
  assert.equal(can({account,uid:'different',token:'staff-view'}),false);
  assert.equal(can({account:{role:'admin'},uid:'staff'}),true);
  assert.deepEqual(account,{role:'user'});
});
test('Empty configuration keeps Full Mock admin-only; missing and blocked accounts cannot preview', () => {
  const can = createPreviewAccess({users:'mahabir1'});
  assert.equal(createPreviewAccess()({account:{role:'user'},uid:'mahabir1'}),false);
  for (const account of [null,{role:'user',blocked:true},{role:'admin',blocked:true}]) assert.equal(can({account,uid:'mahabir1'}),false);
  assert.equal(can({account:{role:'admin'},uid:''}),false);
  assert.deepEqual(previewUsers(''),[]);
  for (const users of ['*','mahabir*','mahabir1 other']) assert.throws(() => previewUsers(users),/exact usernames/);
});
test('Deployment account verification is read-only and rejects missing or blocked configured users', async () => {
  const queries = [];
  const query = async (...args) => {queries.push(args);return {rows:[{username:'mahabir1',blocked:false}]};};
  assert.deepEqual(await checkPreviewAccounts(['mahabir1'],query),{configured:1,verified:1});
  assert.equal(queries.length,1); assert.match(queries[0][0],/^SELECT /); assert.deepEqual(queries[0][1],[['mahabir1']]);
  await assert.rejects(checkPreviewAccounts(['missing'],query),/missing or blocked/);
  await assert.rejects(checkPreviewAccounts(['mahabir1'],async () => ({rows:[{username:'mahabir1',blocked:true}]})),/missing or blocked/);
  assert.deepEqual(await checkPreviewAccounts([],() => {throw Error('Should not query');}),{configured:0,verified:0});
});
test('Everyone mode permits every existing unblocked account while preserving sign-in and block checks', async () => {
  const can = createPreviewAccess({all:'true'});
  for (const uid of ['mahabir1','student','new-student','pppp']) assert.equal(can({uid,account:{role:'user'}}),true);
  for (const account of [null,{role:'user',blocked:true},{role:'admin',blocked:true}]) assert.equal(can({uid:'student',account}),false);
  assert.equal(can({uid:'',account:{role:'user'}}),false);
  for (const all of ['false','yes','*',false]) assert.equal(createPreviewAccess({all})({uid:'student',account:{role:'user'}}),false);
  const queries = [];
  assert.deepEqual(await checkPreviewAccounts([],async sql => {queries.push(sql);return {rows:[]};},{all:true}),{mode:'all-signed-in',database:'verified'});
  assert.deepEqual(queries,['SELECT 1 FROM accounts LIMIT 0']);
});
