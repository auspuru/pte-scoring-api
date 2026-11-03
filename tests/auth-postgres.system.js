'use strict';
const test=require('node:test'),{randomUUID}=require('node:crypto'),{Pool}=require('pg'),{testDatabaseUrl}=require('./helpers/full-mock-systems'),{fixture}=require('./helpers/auth-server'),{acceptance}=require('./helpers/auth-acceptance-cases');
test('PostgreSQL email registration prevents concurrent duplicates and preserves legacy recovery',{timeout:30000},async t=>{
 const base=testDatabaseUrl(process.env.FULL_MOCK_TEST_DATABASE_URL),schema='auth_emails_'+randomUUID().replaceAll('-',''),pool=new Pool({connectionString:base});await pool.query('CREATE SCHEMA '+schema);
 const connection=new URL(base);connection.searchParams.set('options','-c search_path='+schema);
 const f=await fixture(t,{databaseUrl:connection.toString(),afterStop:async()=>{await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();}});
 await require('./helpers/duplicate-accounts-cases').duplicateAccounts(t,f);
});
test('Both file-to-PostgreSQL account import paths retain scheduled and expired access dates',{timeout:60000},async t=>{
 const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
 for(const populated of [false,true])await t.test(populated?'Legacy account merge':'Initial JSON migration',async t=>{
  const base=testDatabaseUrl(process.env.FULL_MOCK_TEST_DATABASE_URL),schema='auth_dates_'+randomUUID().replaceAll('-',''),pool=new Pool({connectionString:base});await pool.query('CREATE SCHEMA '+schema);
  if(populated){
   await pool.query('CREATE TABLE '+schema+'.accounts (username TEXT PRIMARY KEY,password_hash TEXT NOT NULL,secret_q TEXT,secret_a_hash TEXT,created_at TIMESTAMPTZ,last_login TIMESTAMPTZ,blocked BOOLEAN,role TEXT)');
   await pool.query('INSERT INTO '+schema+'.accounts(username,password_hash,blocked,role) VALUES($1,$2,false,$3)',['existing','synthetic-unused','user']);
  }
  const connection=new URL(base);connection.searchParams.set('options','-c search_path='+schema);
  const password='Migration-pass-123',baseAccount={passwordHash:createHash('sha256').update(password.toLowerCase()).digest('hex'),createdAt:new Date().toISOString(),blocked:false,role:'user',sessionVersion:3};
  const f=await fixture(t,{databaseUrl:connection.toString(),afterStop:async()=>{await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();},beforeStart:directory=>fs.writeFile(path.join(directory,'pte_data.json'),JSON.stringify({accounts:{expired:{...baseAccount,accessStartsOn:'2000-01-01',accessExpiresOn:'2000-01-02'},scheduled:{...baseAccount,accessStartsOn:'2099-01-01',accessExpiresOn:'2099-01-02'},unlimited:{...baseAccount}},users:{},global:{totalAttempts:0}}))});
  const users=(await f.request('/api/admin/users',undefined,null,true)).body;
  assert.equal((await pool.query('SELECT session_version FROM '+schema+'.accounts WHERE username=$1',['unlimited'])).rows[0].session_version,3,'JSON account imports preserve session revocations');
  assert.equal(users.find(u=>u.username==='expired').portalAccess.expiresOn,'2000-01-02');
  assert.equal(users.find(u=>u.username==='scheduled').portalAccess.startsOn,'2099-01-01');
  assert.equal((await f.request('/api/auth/login',{username:'expired',password})).body.code,'PORTAL_ACCESS_EXPIRED');
  assert.equal((await f.request('/api/auth/login',{username:'scheduled',password})).body.code,'PORTAL_ACCESS_SCHEDULED');
  assert.equal((await f.request('/api/auth/login',{username:'unlimited',password})).body.success,true);
 });
});
test('PostgreSQL real-server account, reset and private-media acceptance',{timeout:45000},async t=>{
 const base=testDatabaseUrl(process.env.FULL_MOCK_TEST_DATABASE_URL),schema='auth_acceptance_'+randomUUID().replaceAll('-',''),pool=new Pool({connectionString:base});await pool.query('CREATE SCHEMA '+schema);
 const connection=new URL(base);connection.searchParams.set('options','-c search_path='+schema);
 const f=await fixture(t,{databaseUrl:connection.toString(),afterStop:async()=>{await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();}});await acceptance(t,f);
});
