'use strict';
const crypto=require('node:crypto');
const bank=require('./speaking-bank'),writing=require('./writing-lab.json');
const speakingAudio=require('./speaking-audio/manifest.json'),writingAudio=require('./writing-audio/manifest.json');
const VERSION='speaking-mock-2026-10-24.1';
const pick=id=>structuredClone(bank.questions.find(q=>q.id===id));
function source(q,folder,id=q.id){
  const manifest=folder==='speaking'?speakingAudio:writingAudio,entry=manifest[id];
  if(!entry||entry.textSha256!==crypto.createHash('sha256').update(q.text).digest('hex'))throw Error('Missing verified speaking mock audio: '+id);
  return {...q,audioSource:{folder,id},audioSeconds:entry.seconds};
}
const questions=[{id:'mock-introduction',type:'intro',name:'Personal Introduction',title:'Personal Introduction',preparation:25,seconds:30,
  instruction:'Read the introduction prompt. You will have 25 seconds to prepare and 30 seconds to speak. This introduction is not scored.',
  text:'Please introduce yourself. You could talk about your studies, interests and reasons for preparing for this test.'}];
questions.push(...bank.questions.filter(q=>q.type==='ra'));
const archive=writing.spoken.find(q=>q.id==='sst-digital-archives');
let passage='';for(const sentence of archive.text.split(/(?<=[.!?])\s+/u)){const candidate=(passage+' '+sentence).trim();if(candidate.split(/\s+/u).length>60)break;passage=candidate;}
questions.push({id:'mock-ra-archives',type:'ra',...bank.types.ra,title:'Preserving accessible records',text:passage,sourceId:archive.id});
questions.push(...bank.questions.filter(q=>q.type==='rs').map(q=>source(q,'speaking')));
for(const q of writing.dictation.slice(0,5))questions.push(source({id:'mock-rs-'+q.id,type:'rs',...bank.types.rs,title:'Repeat Sentence',text:q.text,sourceId:q.id},'writing',q.id));
questions.push(...[1,2,3,4,5].map(n=>pick('di-'+n)));
for(const type of ['rl','sgd','rts'])questions.push(...[1,2].map(n=>source(pick(type+'-'+n),'speaking')));
const scored=questions.filter(q=>q.type!=='intro');
const seconds=questions.reduce((sum,q)=>sum+3+(q.audioSeconds||0)+q.preparation+q.seconds,0);
const papers=[{id:'speaking-mock-1',title:'Speaking Mock 1',minutes:Math.ceil(seconds/60)+3,
  questionCount:scored.length,description:'A complete speaking practice paper using saved portal recordings, with an unscored introduction.',
  scope:'6 Read Aloud · 10 Repeat Sentence · 5 Describe Image · 2 Retell Lecture · 2 Group Discussion · 2 Respond to a Situation',
  questions}];
function publicQuestion(q,reveal=false){
  return {id:q.id,type:q.type,name:q.name,preparation:q.preparation,seconds:q.seconds,instruction:q.instruction,
    ...(['intro','ra','rts'].includes(q.type)?{text:q.text}:{}),
    ...(q.audioSource?{audioUrl:'/speaking-mock-audio/'+q.id+'.mp3?v='+VERSION,audioSeconds:q.audioSeconds}:{}),
    ...(q.imageUrl?{imageUrl:q.imageUrl}:q.visual?{imageUrl:'/speaking-image/'+q.id+'.svg'}:{}),
    ...(reveal?{title:q.title,reference:q.text,sample:q.sample,facts:q.facts}:{} )};
}
const catalogue=()=>papers.map(({questions,...paper})=>({...paper,tasks:Object.keys(bank.types).map(type=>({type,label:bank.types[type].name,count:questions.filter(q=>q.type===type).length}))}));
module.exports={VERSION,papers,catalogue,publicQuestion};
