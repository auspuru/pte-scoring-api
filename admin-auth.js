'use strict';
const crypto=require('node:crypto');
const security=require('./account-security');
const COOKIE='ipt_staff_admin', TTL=8*60*60*1000;
function createAdminAuth({authenticate,getAccount,verifyPassword,secret,staffUsers=()=>'',now=Date.now}) {
  const sign=value=>crypto.createHmac('sha256',secret()).update('staff-admin:'+value).digest('hex');
  const allowed=(username,account)=>!!account&&!account.blocked&&(account.role==='admin'||String(staffUsers()).split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).includes(username));
  const stamp=account=>sign(JSON.stringify([account.passwordHash,account.sessionVersion||0,account.createdAt]));
  const options={httpOnly:true,sameSite:'strict',path:'/api/admin',maxAge:TTL};
  function sameOrigin(req){return req.get('origin')===security.resetOrigin(req);}
  async function login(req,res){
    res.set('Cache-Control','no-store');
    if(!sameOrigin(req))return res.status(403).json({error:'Open the admin portal to sign in.'});
    const {username,password}=req.body||{};
    if(security.credentialsError(username,password))return res.status(400).json({error:'Enter your staff username and password.'});
    try{
      const uid=username.trim().toLowerCase(),result=await authenticate(uid,password);
      const account=result?.success?await getAccount(uid):null;
      if(!result?.success||!allowed(uid,account)||(result.sessionVersion||0)!==(account.sessionVersion||0)||!verifyPassword(password,account))return res.status(401).json({error:'Invalid staff username or password.'});
      const issued=now(),value=Buffer.from(JSON.stringify({purpose:'staff-admin',username:uid,stamp:stamp(account),issued,expires:issued+TTL})).toString('base64url');
      res.cookie(COOKIE,value+'.'+sign(value),{...options,secure:security.resetOrigin(req).startsWith('https:')}).json({success:true,username:uid});
    }catch{res.status(503).json({error:'Staff sign-in is temporarily unavailable. Please try again.'});}
  }
  async function verify(req){
    const cookies=String(req.headers.cookie||'');if(cookies.length>8192)return null;
    const values=cookies.split(';').map(x=>x.trim()).filter(x=>x.startsWith(COOKIE+'='));
    if(values.length!==1)return null;
    const parts=security.signedParts(values[0].slice(COOKIE.length+1));
    if(!parts||!security.signatureMatches(parts[1],sign(parts[0])))return null;
    let data;try{data=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));}catch{return null;}
    if(data.purpose!=='staff-admin'||typeof data.username!=='string'||!Number.isFinite(data.issued)||data.issued>now()||data.expires!==data.issued+TTL||data.expires<=now())return null;
    const account=await getAccount(data.username);
    if(!allowed(data.username,account)||!security.signatureMatches(data.stamp,stamp(account)))return null;
    if(!['GET','HEAD','OPTIONS'].includes(req.method)&&!sameOrigin(req))return null;
    return {username:data.username,method:'staff'};
  }
  function logout(req,res){
    if(!sameOrigin(req))return res.status(403).json({error:'Open the admin portal to sign out.'});
    res.set('Cache-Control','no-store').clearCookie(COOKIE,{...options,maxAge:undefined,secure:security.resetOrigin(req).startsWith('https:')}).json({success:true});
  }
  return {login,verify,logout};
}
module.exports={createAdminAuth};
