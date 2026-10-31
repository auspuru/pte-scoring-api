'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const VERSION='rts-practice-local-narration-2026-10-31.1';
// Only a saved server-side question reaches this renderer. No client text or
// shell interpolation can become a narration command or a cache pathname.
function createPromptNarrator(directory,{render=async(text,file)=>{
 const bytes=await require('./writing-lab-audio').createLocalNarration({input:text,speed:1});await fs.writeFile(file,bytes);
}}={}){
 const pending=new Map();let active=0;
 return async question=>{
  if(question?.type!=='rts'||typeof question.text!=='string'||!question.text.trim()||question.text.length>6000)throw Object.assign(Error('Situation audio is unavailable.'),{status:404});
  const hash=createHash('sha256').update(VERSION+'\n'+question.text).digest('hex'),file=path.join(directory,hash+'.mp3');
  try{if((await fs.stat(file)).size>1000)return file;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(pending.has(hash))return pending.get(hash);
  if(active>=3)throw Object.assign(Error('Prompt audio is busy. Please retry in a moment.'),{status:503});
  const task=(async()=>{
   active++;const temporary=path.join(directory,hash+'-'+randomUUID()+'.mp3');
   try{await fs.mkdir(directory,{recursive:true});await render(question.text,temporary);if((await fs.stat(temporary)).size<=1000)throw Error('Empty narration');await fs.rename(temporary,file);return file;}
   catch{throw Object.assign(Error('The situation audio could not be prepared. Please retry.'),{status:503});}
   finally{active--;await fs.unlink(temporary).catch(()=>{});}
  })();pending.set(hash,task);try{return await task;}finally{pending.delete(hash);}
 };
}
module.exports={VERSION,createPromptNarrator};
