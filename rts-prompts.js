'use strict';
const path=require('node:path'),crypto=require('node:crypto');
const legacy=require('./content/rts-prompt-legacy.json');
const VERSION='rts-prompt-2026-10-28.1';
const sha=text=>crypto.createHash('sha256').update(text).digest('hex');
function current(q){
  if(q.type!=='rts')return q;
  // Retain the supplied transcript in its source file and archive; standardise
  // the authored portal prompt without overwriting the production recording.
  const text=q.id==='rts-user-tom-book'?q.text.replace('What will you say to Tom?','What would you say to Tom?'):q.text;
  return{...q,text,promptVersion:VERSION,...(q.audioPrompt===false?{}:{promptAudioKey:q.id+'-prompt-20261028-1'})};
}
function forAttempt(attempt,currentQuestion){
  return attempt.questionSnapshot||(Object.hasOwn(legacy.questions,attempt.questionId)?legacy.questions[attempt.questionId]:currentQuestion);
}
function audioEntry(q){
  if(!q.promptAudioKey)return null;
  const entry=require('./content/speaking-audio/rts-manifest.json')[q.promptAudioKey];
  if(!entry||entry.questionId!==q.id||entry.textSha256!==sha(q.text))throw Error('Missing matching RTS narration: '+q.id);
  return entry;
}
function publicAudio(q,prefix){
  const entry=audioEntry(q);if(!entry)return null;
  return{audioUrl:prefix+'/'+encodeURIComponent(q.id)+'.mp3?prompt='+encodeURIComponent(q.promptAudioKey)+'&v=sha256-'+entry.audioSha256.slice(0,12),audioSeconds:entry.seconds};
}
function requestedAudio(id,key){
  let entry,asset;
  if(key===undefined){
    if(!Object.hasOwn(legacy.questions,id))return null;
    const q=legacy.questions[id];if(q.audioPrompt===false)return null;
    entry=require('./content/speaking-audio-manifest')()[id];asset=id;
    if(!entry||entry.textSha256!==sha(q.text))return null;
  }else{
    if(typeof key!=='string'||!/^rts-[a-z0-9-]+-prompt-\d{8}-\d+$/.test(key))return null;
    entry=require('./content/speaking-audio/rts-manifest.json')[key];asset=key;
    if(!entry||entry.questionId!==id)return null;
  }
  return{file:path.join(__dirname,'content/speaking-audio',asset+'.mp3'),entry,versioned:key!==undefined};
}
module.exports={VERSION,legacy,current,forAttempt,audioEntry,publicAudio,requestedAudio};
