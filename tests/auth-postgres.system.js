'use strict';
const test=require('node:test'),{randomUUID}=require('node:crypto'),{Pool}=require('pg'),{testDatabaseUrl}=require('./helpers/full-mock-systems'),{fixture}=require('./helpers/auth-server'),{acceptance}=require('./helpers/auth-acceptance-cases');
test('PostgreSQL real-server account, reset and private-media acceptance',{timeout:45000},async t=>{
 const base=testDatabaseUrl(process.env.FULL_MOCK_TEST_DATABASE_URL),schema='auth_acceptance_'+randomUUID().replaceAll('-',''),pool=new Pool({connectionString:base});await pool.query('CREATE SCHEMA '+schema);
 const connection=new URL(base);connection.searchParams.set('options','-c search_path='+schema);
 const f=await fixture(t,{databaseUrl:connection.toString(),afterStop:async()=>{await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();}});await acceptance(t,f);
});
