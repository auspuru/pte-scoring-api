'use strict';
const crypto=require('node:crypto');
const bank=require('./speaking-bank'),writing=require('./writing-lab.json');
const speakingAudio=require('./speaking-audio/manifest.json'),writingAudio=require('./writing-audio/manifest.json');
const VERSION='speaking-mock-2026-10-26.2';
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
// Original prediction assets reviewed for readable labels and matching samples.
// Saved attempts and their reattempts retain their own original snapshots.
questions.push(...['3000411','3000392','3000375','3000469','3000561'].map(id=>pick('di-pred-'+id)));
for(const type of ['rl','sgd','rts'])questions.push(...[1,2].map(n=>source(pick(type+'-'+n),'speaking')));
function paper(number,items){
  for(const q of items.filter(q=>q.type==='di')){
    if(!/^\/assets\/di-predictions-\d{8}\/[^/]+\.png$/.test(q.imageUrl||'')||!q.predictionSource?.sourceId||!q.sample||!q.facts?.length)throw Error('Speaking mocks require a sourced prediction image and matching sample: '+q.id);
  }
  const seconds=items.reduce((sum,q)=>sum+3+(q.audioSeconds||0)+q.preparation+q.seconds,0);
  return {id:'speaking-mock-'+number,title:'Speaking Mock '+number,minutes:Math.ceil(seconds/60)+3,
    questionCount:items.filter(q=>q.type!=='intro').length,description:'A complete speaking practice paper using saved portal recordings, with an unscored introduction.',
    scope:'6 Read Aloud · 10 Repeat Sentence · 5 Describe Image · 2 Retell Lecture · 2 Group Discussion · 2 Respond to a Situation',questions:items};
}
function readAloud(q){
  let text='';for(const sentence of q.text.split(/(?<=[.!?])\s+/u)){const candidate=(text+' '+sentence).trim();if(candidate.split(/\s+/u).length>60)break;text=candidate;}
  if(!text)throw Error('No complete Read Aloud passage: '+q.id);
  return {id:'mock-ra-'+q.id,type:'ra',...bank.types.ra,title:q.title,text,sample:text,sourceId:q.id};
}
function repeatSentence(q){return source({id:'mock-rs-'+q.id,type:'rs',...bank.types.rs,title:'Repeat Sentence',text:q.text,sample:q.text,sourceId:q.id},'writing',q.id);}
const images=bank.questions.filter(q=>q.type==='di'&&q.imageUrl);
const sentences=writing.dictation.filter(q=>writingAudio[q.id]?.seconds>=3&&writingAudio[q.id]?.seconds<=9);
const papers=[paper(1,questions)];
for(const [number,passages,sentenceStart,imageStart,lectureIds,discussionIds,situationIds] of [
  [2,writing.spoken.slice(0,6),5,0,['rl-3','rl-4'],['sgd-3','sgd-4'],['rts-3','rts-4']],
  [3,[...writing.spoken.slice(6,9),...writing.spoken.slice(10,13)],15,5,['rl-5','rl-2'],['sgd-5','sgd-1'],['rts-5','rts-1']]
]){
  const items=[structuredClone(questions[0]),...passages.map(readAloud),...sentences.slice(sentenceStart,sentenceStart+10).map(repeatSentence),
    ...structuredClone(images.slice(imageStart,imageStart+5)),...[...lectureIds,...discussionIds,...situationIds].map(id=>source(pick(id),'speaking'))];
  if(items.length!==28||new Set(items.map(q=>q.id)).size!==28)throw Error('Incomplete speaking mock '+number);
  papers.push(paper(number,items));
}
function publicQuestion(q,reveal=false){
  return {id:q.id,type:q.type,name:q.name,preparation:q.preparation,seconds:q.seconds,instruction:q.instruction,
    ...(['intro','ra','rts'].includes(q.type)?{text:q.text}:{}),
    ...(q.audioSource?{audioUrl:'/speaking-mock-audio/'+q.id+'.mp3?v='+VERSION,audioSeconds:q.audioSeconds}:{}),
    ...(q.imageUrl?{imageUrl:q.imageUrl}:q.visual?{imageUrl:'/speaking-image/'+q.id+'.svg'}:{}),
    ...(reveal?{title:q.title,reference:q.text,sample:q.sample,facts:q.facts}:{} )};
}
const catalogue=()=>papers.map(({questions,...paper})=>({...paper,tasks:Object.keys(bank.types).map(type=>({type,label:bank.types[type].name,count:questions.filter(q=>q.type===type).length}))}));
module.exports={VERSION,papers,catalogue,publicQuestion};
