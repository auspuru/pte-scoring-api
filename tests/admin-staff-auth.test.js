'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/auth-server');
test('Staff login rejects a password changed while authentication was in flight',async()=>{
 let status=200,cookie=false;
 const auth=require('../admin-auth').createAdminAuth({authenticate:async()=>({success:true,sessionVersion:0}),getAccount:async()=>({role:'admin',passwordHash:'changed-password',sessionVersion:0}),verifyPassword:(password,account)=>password===account.passwordHash,secret:()=>Buffer.from('isolated-test-secret')});
 const req={body:{username:'staff',password:'old-password'},get:key=>key==='host'?'127.0.0.1:45678':'http://127.0.0.1:45678'};
 const res={set(){return this;},status(value){status=value;return this;},json(){return this;},cookie(){cookie=true;return this;}};
 await auth.login(req,res);assert.equal(status,401);assert.equal(cookie,false);
});
test('Staff login binds HttpOnly access to approved accounts and current credentials',{timeout:45000},async t=>{
  const f=await fixture(t,{staffUsers:'staff'}),password='Isolated-staff-pass-123';
  for(const username of ['staff','student'])assert.equal((await f.request('/api/auth/register',{username,password,email:username+'@example.test',role:'admin'})).body.success,true);
  async function req(route,body,{cookie='',origin=f.base}={}){
    return fetch(f.base+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{}),...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  }
  assert.equal((await req('/api/admin/users')).status,403);
  assert.equal((await req('/api/admin/login',{username:'student',password})).status,401);
  assert.equal((await req('/api/admin/login',{username:'staff',password:'wrong'})).status,401);
  assert.equal((await req('/api/admin/login',{username:'staff',password},{origin:'https://other.example'})).status,403);
  const login=await req('/api/admin/login',{username:' STAFF ',password}),setCookie=login.headers.get('set-cookie'),cookie=setCookie.split(';')[0];
  assert.equal(login.status,200);assert.deepEqual(await login.json(),{success:true,username:'staff'});
  for(const attribute of ['HttpOnly','SameSite=Strict','Path=/api/admin'])assert.ok(setCookie.includes(attribute));
  assert.equal((await req('/api/admin/users',undefined,{cookie})).status,200);
  assert.deepEqual(await (await req('/api/admin/session',undefined,{cookie})).json(),{authenticated:true,username:'staff',method:'staff'});
  assert.equal((await req('/api/admin/users',undefined,{cookie:cookie+'0'})).status,403);
  assert.equal((await req('/api/admin/block-user',{username:'student',blocked:true},{cookie,origin:'https://other.example'})).status,403);
  assert.equal((await req('/api/admin/block-user',{username:'student',blocked:true},{cookie,origin:''})).status,403);
  assert.equal((await req('/api/admin/block-user',{username:'student',blocked:true},{cookie})).status,200);
  const normal=(await f.request('/api/auth/login',{username:'staff',password})).body;
  assert.equal((await f.request('/api/admin/users',undefined,normal.token)).status,403);
  assert.equal((await f.request('/api/auth/change-password',{oldPassword:password,newPassword:'Changed-staff-pass-456'},normal.token)).body.success,true);
  assert.equal((await req('/api/admin/users',undefined,{cookie})).status,403);
  const second=await req('/api/admin/login',{username:'staff',password:'Changed-staff-pass-456'}),nextCookie=second.headers.get('set-cookie').split(';')[0];
  assert.equal(second.status,200);
  await f.request('/api/admin/block-user',{username:'staff',blocked:true},undefined,true);
  assert.equal((await req('/api/admin/users',undefined,{cookie:nextCookie})).status,403);
  await f.request('/api/admin/block-user',{username:'staff',blocked:false},undefined,true);
  await f.clock(8*60*60*1000+1000);
  assert.equal((await req('/api/admin/users',undefined,{cookie:nextCookie})).status,403);
  await f.clock(0);
  const logout=await req('/api/admin/logout',{}, {cookie:nextCookie});
  assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Expires=Thu, 01 Jan 1970/);
  assert.equal((await req('/api/admin/users')).status,403);
});
