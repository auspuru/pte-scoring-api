'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const canonical = user => String(user || '').trim().toLowerCase();
const allowed = user => ['pppp','mehakbir1','mahabir1','mahdis','sukhpal'].includes(canonical(user));
function gate(verify, check = allowed) {
  return async (req,res,next) => {
    res.set('Cache-Control','no-store');
    let user; try { user=verify(req.headers['x-session-token'] || ''); } catch {}
    if (!user) return res.status(401).json({error:'Please sign in to your practice account.'});
    try {
      if (!await check(user)) return res.status(403).json({error:'Speaking is not available for this account.'});
      next();
    } catch { res.status(503).json({error:'Speaking access could not be checked. Please retry.'}); }
  };
}
function install(app, { pool, directory, verify, getAccount, requireAdmin }) {
  let ready;
  function initialise() {
    if (!ready) ready = (pool ? pool.query(`CREATE TABLE IF NOT EXISTS speaking_access (
      username TEXT PRIMARY KEY REFERENCES accounts(username) ON DELETE CASCADE,
      enabled BOOLEAN NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`) : fs.mkdir(directory,{recursive:true}))
      .catch(error => { ready=null; throw error; });
    return ready;
  }
  const file = uid => path.join(directory,createHash('sha256').update(uid).digest('hex')+'.json');
  async function overrides() {
    await initialise();
    if (pool) return new Map((await pool.query('SELECT username, enabled FROM speaking_access')).rows.map(r=>[r.username,r.enabled]));
    const rows=await Promise.all((await fs.readdir(directory)).filter(n=>n.endsWith('.json')).map(async n=>JSON.parse(await fs.readFile(path.join(directory,n),'utf8'))));
    return new Map(rows.map(r=>[r.username,r.enabled]));
  }
  async function check(user) {
    const uid=canonical(user);await initialise();
    if (pool) { const row=(await pool.query('SELECT enabled FROM speaking_access WHERE username=$1',[uid])).rows[0];return row ? row.enabled : allowed(uid); }
    try { return JSON.parse(await fs.readFile(file(uid),'utf8')).enabled === true; }
    catch(error) { if(error.code==='ENOENT')return allowed(uid);throw error; }
  }
  app.get('/api/speaking-access',async(req,res)=>{
    res.set('Cache-Control','no-store');
    let uid;try { uid=verify(req.headers['x-session-token'] || ''); } catch {}
    if(!uid)return res.status(401).json({error:'Please sign in.'});
    try { const account=await getAccount(uid);res.json({enabled:!!account && !account.blocked && await check(uid)}); }
    catch { res.status(503).json({error:'Access could not be checked.'}); }
  });
  app.post('/api/admin/speaking-access',requireAdmin,async(req,res)=>{
    res.set('Cache-Control','no-store');
    const {username,enabled}=req.body || {};
    if(typeof username!=='string' || !username.trim() || username.length>254 || typeof enabled!=='boolean')return res.status(400).json({error:'Provide a username and speaking access setting.'});
    const uid=canonical(username);
    try {
      if(!await getAccount(uid))return res.status(404).json({error:'Login account not found.'});
      await initialise();
      if(pool)await pool.query('INSERT INTO speaking_access(username,enabled) VALUES($1,$2) ON CONFLICT(username) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=NOW()',[uid,enabled]);
      else {const target=file(uid),tmp=target+'.'+randomUUID()+'.tmp';await fs.writeFile(tmp,JSON.stringify({username:uid,enabled}),{mode:0o600});await fs.rename(tmp,target);}
      res.json({success:true,username:uid,speakingAccess:enabled});
    } catch {res.status(503).json({error:'Speaking access could not be saved. Please retry.'});}
  });
  return {allowed:check,decorate:async users=>{const values=await overrides();return users.map(u=>({...u,speakingAccess:u.hasAccount!==false && (values.has(u.username)?values.get(u.username):allowed(u.username))}));}};
}
module.exports={allowed,gate,install};
