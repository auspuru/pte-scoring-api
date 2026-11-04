'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const manifest=require('./content/approved-audio-20261104.json');
const entries=manifest.entries,byId=new Map(Object.entries(entries).map(([key,e])=>[e.questionId,{key,...e}]));
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const fail=(status=503)=>Object.assign(Error('This recording is unavailable. Please retry shortly.'),{status});
function sourceText(q){return q.type==='hiw'&&typeof q.audioText==='string'?q.audioText:q.text;}
function entryFor(q){
 if(!q)return null;
 const e=byId.get(q.id)||(q.type==='hiw'&&q.audioId?byId.get(q.audioId):null);
 if(!e)return null;
 if(e.type!==q.type&&!(q.type==='hiw'&&e.type==='sst'&&q.audioId===e.questionId))return null;
 if(typeof sourceText(q)!=='string'||sha(sourceText(q))!==e.textSha256)throw fail();
 return e;
}
function current(q){
 if(q?.audioKey)return q;
 const e=entryFor(q);return e?{...q,audioKey:e.key,audioVersion:manifest.version,audioSeconds:e.seconds}:q;
}
function publicAudio(q){
 if(!q?.audioKey)return null;
 const e=entries[q.audioKey];
 if(!e||e.questionId!==(q.audioId||q.id)||sha(sourceText(q)||'')!==e.textSha256)throw fail();
 return{audioUrl:'/practice-audio/'+q.audioKey+'.mp3?v=sha256-'+e.audioSha256.slice(0,12),audioSeconds:e.seconds};
}
function fileFor(key){
 const e=Object.hasOwn(entries,key)&&entries[key];if(!e)return null;
 const file=path.resolve(__dirname,e.file),relative=path.relative(__dirname,file);
 if(!relative.startsWith('review/audio-refresh-remaining-20261104/')||relative.split(path.sep).includes('..'))throw fail();
 return{file,entry:e};
}
const installed=new WeakSet(),verified=new Map();
function install(app){
 if(installed.has(app))return;installed.add(app);
 app.get('/practice-audio/:key.mp3',async(req,res)=>{
  try{
   const found=fileFor(req.params.key);if(!found)throw fail(404);
   const stat=await fs.stat(found.file),signature=stat.size+':'+stat.mtimeMs;
   if(verified.get(found.file)!==signature){
    const bytes=await fs.readFile(found.file);
    if(bytes.length!==found.entry.bytes||sha(bytes)!==found.entry.audioSha256)throw fail();
    verified.set(found.file,signature);
   }
   res.type('audio/mpeg').set('Cache-Control','public,max-age=31536000,immutable').set('X-Content-Type-Options','nosniff').sendFile(found.file);
  }catch(error){res.set('Cache-Control','no-store').status(error.status||503).json({error:'This recording is unavailable. Please retry shortly.'});}
 });
}
module.exports={VERSION:manifest.version,entries,entryFor,current,publicAudio,fileFor,install};
