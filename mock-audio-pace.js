'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const manifest=require('./content/mock-audio-pace.json');
const VERSION=manifest.version,TYPES=new Set(['rl','sgd','sst','hiw','wfd']);
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const textFor=q=>q.type==='hiw'&&q.audioText?q.audioText:q.text;
function entryFor(q){return TYPES.has(q?.type)?manifest.entries[q.type+'-'+sha(textFor(q)||'')]:null;}
function current(q){
 const entry=entryFor(q);
 if(entry)return {...q,mockAudioKey:q.type+'-'+entry.textSha256,mockAudioPace:VERSION,audioSeconds:entry.seconds};
 // Runtime sources use an isolated normal-pace cache. Ordinary practice and
 // already saved attempts retain their original narration and cache identity.
 return ['sst','wfd'].includes(q.type)&&q.audioMode==='runtime-neural'?{...q,mockAudioPace:VERSION}:q;
}
function publicAudio(q){
 if(q.mockAudioKey){
  const entry=manifest.entries[q.mockAudioKey];
  if(!entry||q.mockAudioKey!==q.type+'-'+sha(textFor(q)||''))throw Error('Mock recording source changed.');
  return {audioUrl:'/mock-audio/'+entry.audioSha256+'.mp3',audioSeconds:entry.seconds};
 }
 if(q.mockAudioPace===VERSION&&['sst','wfd'].includes(q.type))return{audioUrl:'/writing-audio/'+encodeURIComponent(q.audioId||q.id)+'.mp3?mockPace='+VERSION+'&source='+sha(textFor(q)||'')};
 return null;
}
const installed=new WeakSet(),byHash=new Map(Object.values(manifest.entries).filter(e=>e.publicMockPlayback).map(e=>[e.audioSha256,e])),verified=new Map();
function install(app){
 if(installed.has(app))return;installed.add(app);
 app.get('/mock-audio/:hash.mp3',(req,res)=>{
  try{
   const entry=byHash.get(req.params.hash);if(!entry)return res.status(404).json({error:'Recording not found.'});
   if(entry.path!=='content/full-mock/assets/'+entry.audioSha256+'.mp3')throw Error('Invalid recording path.');
   const file=path.join(__dirname,entry.path),stat=fs.statSync(file),signature=stat.size+':'+stat.mtimeMs;
   if(verified.get(file)!==signature){const bytes=fs.readFileSync(file);if(bytes.length!==entry.bytes||sha(bytes)!==entry.audioSha256)throw Error('Recording integrity failed.');verified.set(file,signature);}
   res.type('audio/mpeg').set('Cache-Control','public,max-age=31536000,immutable').set('X-Content-Type-Options','nosniff').sendFile(file);
  }catch{res.set('Cache-Control','no-store').status(503).json({error:'This recording is unavailable.'});}
 });
}
module.exports={VERSION,TYPES,entryFor,current,publicAudio,install};
