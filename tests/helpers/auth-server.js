'use strict';
const {spawn}=require('node:child_process'),{once}=require('node:events'),fs=require('node:fs/promises'),net=require('node:net'),os=require('node:os'),path=require('node:path');
const {releaseEnvironment}=require('../../scripts/verify-release');
async function fixture(t,{databaseUrl='',afterStop=async()=>{}}={}){
 const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pte-auth-test-'));
 const child=spawn(process.execPath,['--require',path.join(__dirname,'auth-test-mail.cjs'),'server.js'],{cwd:path.resolve(__dirname,'../..'),env:{...releaseEnvironment(process.env),PORT:String(port),PGURL:databaseUrl,RAILWAY_VOLUME_MOUNT_PATH:directory,SKIP_PUPPETEER_WARMUP:'1',DISABLE_EXTERNAL_SPELLCHECK:'1',ADMIN_KEY:'isolated-auth-test-admin',SESSION_SECRET:'isolated-auth-test-session',GMAIL_USER:'sink@example.test',GMAIL_APP_PASSWORD:'sink-never-connects',AUTH_TEST_DIRECTORY:directory},stdio:'ignore'});
 t.after(async()=>{if(child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);await done;clearTimeout(timer);}await fs.rm(directory,{recursive:true,force:true});await afterStop();});
 const base='http://127.0.0.1:'+port;
 let ready=false;for(let i=0;i<240;i++){try{const r=await fetch(base+'/api/ready');if(r.ok){ready=true;break;}}catch{}if(child.exitCode!==null)throw Error('Isolated auth server exited');await new Promise(resolve=>setTimeout(resolve,50));}
 if(!ready)throw Error('Isolated auth server did not become ready');
 async function request(route,body,token,admin=false){const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{'x-session-token':token}:{}),...(admin?{'x-admin-key':'isolated-auth-test-admin'}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,body:await r.json()};}
 return{base,directory,request,mail:async()=>JSON.parse(await fs.readFile(path.join(directory,'mail.json'),'utf8')),clock:async offset=>fs.writeFile(path.join(directory,'clock.json'),JSON.stringify(offset))};
}
module.exports={fixture};
