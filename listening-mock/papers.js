'use strict';
const fs=require('node:fs'),path=require('node:path');
const {digest,deepFreeze}=require('../full-mock/paper');
const ROOT=path.resolve(__dirname,'..');
const COUNTS=Object.freeze({rs:10,rl:2,asq:5,sgd:2,sst:1,lmcma:2,lfi:2,hcs:2,lmcsa:2,smw:1,hiw:2,wfd:3});
const FORMAT='listening-skill-20261113.1';
function validate(paper){
 if(paper.module!=='listening'||paper.format!==FORMAT||!/^listening-mock-[1-9]\d*$/.test(paper.id)||paper.version!==1||!paper.skipIntroduction||paper.status!=='released'||paper.editorial?.studentReleaseApproved!==true)throw Error('Invalid Listening skill paper.');
 const types=Object.keys(COUNTS),ids=new Set(),audio=new Set();
 if(paper.questions.length!==34||types.some(type=>paper.questions.filter(c=>c.question.type===type).length!==COUNTS[type]))throw Error('Incomplete Listening skill paper.');
 if(paper.questions.slice(0,19).some(c=>!['rs','rl','asq','sgd'].includes(c.question.type))||paper.questions[19].question.type!=='sst')throw Error('Invalid Listening task order.');
 for(const c of paper.questions){
  const entry=c.audio?.entry,asset=paper.assets.find(a=>a.path===c.audio?.path);
  if(ids.has(c.id)||!entry||audio.has(entry.audioSha256)||!asset||asset.sha256!==entry.audioSha256||asset.bytes!==entry.bytes||!Number.isFinite(entry.seconds)||entry.seconds<=0)throw Error('Invalid or repeated Listening stimulus.');
  if(!/^content\/(?:full-mock|listening-skill)\/assets\/[a-f0-9]{64}\.mp3$/.test(asset.path))throw Error('Invalid Listening recording path.');
  ids.add(c.id);audio.add(entry.audioSha256);
 }
 if(paper.assets.length!==audio.size||paper.clockPolicy.sstSeconds!==600||paper.clockPolicy.listeningAfterSstSeconds!==1500)throw Error('Invalid Listening assets or clocks.');
 return true;
}
function registeredPapers(){
 const index=JSON.parse(fs.readFileSync(path.join(ROOT,'content/listening-skill/catalogue.json'),'utf8'));
 return index.papers.map(entry=>{
  if(!/^listening-mock-[1-9]\d*\.v1\.json$/.test(entry.file))throw Error('Invalid Listening catalogue entry.');
  const paper=JSON.parse(fs.readFileSync(path.join(ROOT,'content/listening-skill/papers',entry.file),'utf8'));
  if(paper.id!==entry.id||paper.version!==entry.version||digest(paper)!==entry.paperHash)throw Error('Listening paper integrity failed.');
  validate(paper);return deepFreeze(paper);
 });
}
function catalogue(){return registeredPapers().map(p=>({id:p.id,title:p.title,module:'listening',format:p.format,questionCount:p.questions.length,minutes:p.estimatedMinutes,tasks:Object.entries(COUNTS).map(([type,count])=>({type,label:require('../full-mock/blueprint').TASKS.find(t=>t.type===type).label,count}))}));}
module.exports={FORMAT,COUNTS,validate,registeredPapers,catalogue};
