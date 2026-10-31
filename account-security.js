'use strict';
const crypto=require('node:crypto');
const passwordError=value=>typeof value!=='string'||value.length<8||value.length>1024?'Password must be 8 to 1024 characters.':null;
function credentialsError(username,password,{register=false,email}={}){
 if(typeof username!=='string'||!username.trim()||username.length>100||/[\u0000-\u001f|]/u.test(username))return 'Enter a valid username of up to 100 characters.';
 if(typeof password!=='string'||!password||password.length>1024)return 'Enter a valid password of up to 1024 characters.';
 if(register){if(/\s/u.test(username.trim()))return 'Choose a username without spaces.';const error=passwordError(password);if(error)return error;if(typeof email!=='string'||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())||email.trim().toLowerCase().endsWith('@ptewriting.com'))return 'Enter a valid email address.';}
 return null;
}
function signedParts(token){if(typeof token!=='string'||token.length>4096)return null;const parts=token.split('.');return parts.length===2&&parts[0]&&/^[a-f0-9]{64}$/.test(parts[1])?parts:null;}
function signatureMatches(signature,expected){return typeof signature==='string'&&/^[a-f0-9]{64}$/.test(signature)&&crypto.timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(expected,'hex'));}
const credentialVersion=hash=>crypto.createHash('sha256').update(String(hash)).digest('hex');
function resetOrigin(req,env=process.env){
 const configured=env.PORTAL_PUBLIC_URL||(env.RAILWAY_PUBLIC_DOMAIN?'https://'+env.RAILWAY_PUBLIC_DOMAIN:'');
 if(configured){try{const url=new URL(configured);if(url.protocol==='https:'&&!url.username&&!url.password)return url.origin;}catch{}}
 const host=req.get('host');if(env.NODE_ENV!=='production'&&/^(?:127\.0\.0\.1|localhost):\d+$/.test(host))return 'http://'+host;
 return 'https://swt.up.railway.app';
}
function createSerialQueue(){let pending=Promise.resolve();return operation=>{const task=pending.catch(()=>{}).then(operation);pending=task;return task;};}
module.exports={passwordError,credentialsError,signedParts,signatureMatches,credentialVersion,resetOrigin,createSerialQueue};
