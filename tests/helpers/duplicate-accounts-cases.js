'use strict';
const assert=require('node:assert/strict');
async function duplicateAccounts(t,f){
 const password='Synthetic-pass-123',create=(username,email)=>f.request('/api/auth/register',{username,password,email});
 const original=await create('email-original','  Shared@Example.test  ');assert.equal(original.body.success,true);
 await f.request('/api/sync/email-original',{essayDraft:{essayText:'Keep the original saved work',updatedAt:Date.now()}},original.body.token);
 for(const email of ['shared@example.test','SHARED@EXAMPLE.TEST',' shared@example.test ']){
  const result=await create('email-copy',email);assert.equal(result.body.success,false);assert.equal(result.body.code,'EMAIL_IN_USE');assert.equal(result.body.token,undefined);
 }
 assert.equal((await f.request('/api/sync/email-original',undefined,original.body.token)).body.data.essayDraft.essayText,'Keep the original saved work');
 const raced=await Promise.all([create('email-race-a','racing@example.test'),create('email-race-b','RACING@example.test')]);
 assert.equal(raced.filter(r=>r.body.success).length,1);assert.equal(raced.filter(r=>r.body.code==='EMAIL_IN_USE').length,1);
 // Retained historical duplicates must never make email recovery select an arbitrary account.
 const legacy=await create('email-legacy','legacy@example.test');
 await f.request('/api/sync/email-legacy',{email:' SHARED@example.test '},legacy.body.token);
 await f.request('/api/auth/email-reset/request',{identifier:'shared@example.test'});
 await assert.rejects(f.mail(),e=>e.code==='ENOENT');
 await f.request('/api/auth/email-reset/request',{identifier:'email-legacy'});
 const message=await f.mail(),token=new URL(message.text.match(/https?:\/\/\S+/)[0]).searchParams.get('reset');
 assert.equal((await f.request('/api/auth/email-reset/complete',{token,newPassword:'Recovered-pass-456'})).body.success,true);
 assert.equal((await f.request('/api/auth/login',{username:'email-original',password})).body.success,true);
 assert.equal((await f.request('/api/auth/login',{username:'email-legacy',password:'Recovered-pass-456'})).body.success,true);
}
module.exports={duplicateAccounts};
