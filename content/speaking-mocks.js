'use strict';
const crypto=require('node:crypto');
const bank=require('./speaking-bank'),writing=require('./writing-lab.json');
const references=require('../di-reference'),supplied=new Map(require('./di-user-predictions.json').map(q=>[q.id,q]));
const speakingAudio=require('./speaking-audio-manifest')(),writingAudio=require('./writing-audio/manifest.json'),rtsPrompts=require('../rts-prompts');
const approvedAudio=require('../approved-audio');
const VERSION='speaking-mock-2026-11-04.2';
const OVERALL_MINUTES=40;
const webImages=require('./speaking-mocks-web-images.json');
const mock5Images=require('./speaking-mock-5-web-images-20261111.json');
const replacementImages=[...require('./speaking-mock-4-user-images-20261111.json'),...mock5Images],easySentences=require('./speaking-mocks-easy-rs-20261111.json');
const pick=id=>structuredClone(bank.questions.find(q=>q.id===id));
function suppliedMockImage(q){
  const original=supplied.get(q.id),entry=references.manifest.entries[q.id];
  const web=[...webImages,...replacementImages].find(item=>item.id===q.id);
  if(web)return web.imageUrl===q.imageUrl&&entry?.source.sha256===web.contentOrigin.sha256&&entry.mapping.category!=='photo';
  return !!(original?.predictionSource?.suppliedFile&&original.imageUrl===q.imageUrl&&entry?.source.kind==='image-sha256'
    &&entry.mapping.category!=='photo'&&/^\/assets\/di-predictions-\d{8}\/\d+\.png$/.test(q.imageUrl||''));
}
function source(q,folder,id=q.id){
  if(folder==='speaking'&&q.type==='sgd'){
    const current=approvedAudio.current(q);
    if(current.audioKey)return{...current,audioSource:{folder:'approved',id:current.audioKey},audioSeconds:current.audioSeconds};
  }
  if(folder==='speaking'&&q.promptAudioKey)id=q.promptAudioKey;
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
// Saved attempts retain their own snapshots; new papers exclude photographs.
questions.push(...['3000186','3000375','3000586','3000881','3000365'].map(id=>pick('di-pred-'+id)));
for(const type of ['rl','sgd','rts'])questions.push(...[1,2].map(n=>source(pick(type+'-'+n),'speaking')));
function paper(number,items){
  for(const q of items.filter(q=>q.type==='di')){
    if(!suppliedMockImage(q)||!q.sample||!q.facts?.length)throw Error('Speaking mocks require a supplied original chart or diagram and matching sample: '+q.id);
  }
  return {id:'speaking-mock-'+number,title:'Speaking Mock '+number,minutes:OVERALL_MINUTES,
    questionCount:items.filter(q=>q.type!=='intro').length,description:'A complete speaking practice paper using saved portal recordings, with an unscored introduction.',
    scope:'6 Read Aloud · 10 Repeat Sentence · 5 Describe Image · 2 Retell Lecture · 2 Group Discussion · 2 Respond to a Situation',questions:items};
}
function readAloud(q){
  let text='';for(const sentence of q.text.split(/(?<=[.!?])\s+/u)){const candidate=(text+' '+sentence).trim();if(candidate.split(/\s+/u).length>60)break;text=candidate;}
  if(!text)throw Error('No complete Read Aloud passage: '+q.id);
  return {id:'mock-ra-'+q.id,type:'ra',...bank.types.ra,title:q.title,text,sample:text,sourceId:q.id};
}
function repeatSentence(q){return source({id:'mock-rs-'+q.id,type:'rs',...bank.types.rs,title:'Repeat Sentence',text:q.text,sample:q.text,sourceId:q.id},'writing',q.id);}
const sentences=writing.dictation.filter(q=>writingAudio[q.id]?.seconds>=3&&writingAudio[q.id]?.seconds<=9);
const papers=[paper(1,questions)];
for(const [number,passages,sentenceStart,imageIds,lectureIds,discussionIds,situationIds] of [
  [2,writing.spoken.slice(0,6),5,['3000587','3000664','3001366','3001386','3000137'],['rl-3','rl-4'],['sgd-3','sgd-4'],['rts-3','rts-4']],
  [3,[...writing.spoken.slice(6,9),...writing.spoken.slice(10,13)],15,['3000370','3000481','3000601','3001403','3000349'],['rl-5','rl-2'],['sgd-5','sgd-1'],['rts-5','rts-1']]
]){
  const items=[structuredClone(questions[0]),...passages.map(readAloud),...sentences.slice(sentenceStart,sentenceStart+10).map(repeatSentence),
    ...imageIds.map(id=>pick('di-pred-'+id)),...[...lectureIds,...discussionIds,...situationIds].map(id=>source(pick(id),'speaking'))];
  if(items.length!==28||new Set(items.map(q=>q.id)).size!==28)throw Error('Incomplete speaking mock '+number);
  papers.push(paper(number,items));
}
// Fixed selections from the two supplied student booklets and existing recorded banks.
const pdfPassages=require('./speaking-mocks-pdf-read-aloud.json');
const userSituations=require('./speaking-mocks-user-situations.json');
for(const [number,offset,lectures,discussions,situations] of [
  [4,0,['rl-user-20261104-us-economic-strength','rl-user-20261104-earth-mars'],['sgd-user-20261030-07','sgd-user-20261030-01'],userSituations],
  [5,1,['rl-user-20261104-neuron-intensity','rl-user-20261104-science-scientist'],['sgd-user-20261030-03','sgd-user-20261030-04'],['rts-original-20261024-23','rts-original-20261024-12'].map(pick)]
]){
  const items=[structuredClone(questions[0]),...pdfPassages[offset].map(q=>({...bank.types.ra,...structuredClone(q)})),
    ...sentences.slice(25+offset*10,35+offset*10).map(repeatSentence),
    ...webImages.slice(offset*5,offset*5+5).map(q=>references.apply({...bank.types.di,...structuredClone(q)})),
    ...[...lectures,...discussions].map(id=>source(pick(id),'speaking')),
    ...situations.map(q=>source({...bank.types.rts,...structuredClone(q)},'speaking'))];
  if(items.length!==28||new Set(items.map(q=>q.id)).size!==28)throw Error('Incomplete speaking mock '+number);
  const next=paper(number,items);next.description='Speaking paper based on supplied student booklet '+(offset+1)+', with distinct published charts and recorded portal prompts.';
  papers.push(next);
}
// Retain old prompt identities for audio links in immutable saved attempts.
const historicalQuestions=papers.flatMap(p=>p.questions);
for(const [offset,number,lastIds] of [[0,4,['wfd-practice-26','wfd-practice-27']],[1,5,['wfd-practice-36','wfd-practice-37']]]){
  const current=papers.find(p=>p.id==='speaking-mock-'+number);
  const repeats=[...easySentences.slice(offset*8,offset*8+8).map(q=>source({...bank.types.rs,...structuredClone(q)},'speaking')),
    ...lastIds.map(id=>repeatSentence(writing.dictation.find(q=>q.id===id)))];
  const imageIds=number===4?[replacementImages[0],replacementImages[1],replacementImages[2],webImages[0],replacementImages[3]]:null;
  let rs=0,di=0;
  current.questions=current.questions.map(q=>q.type==='rs'?repeats[rs++]:q.type==='di'&&imageIds?references.apply({...bank.types.di,...structuredClone(imageIds[di++])}):q);
  current.contentVersion=2;
}
// The previous revision remains addressable by saved attempts and audio URLs.
const revisionTwoQuestions=papers.flatMap(p=>p.questions),clearSentences=require('./speaking-mocks-clear-rs-20261111.json');
for(const [offset,number] of [[0,4],[1,5]]){
  const current=papers.find(p=>p.id==='speaking-mock-'+number),repeats=clearSentences.slice(offset*10,offset*10+10).map(q=>source({...bank.types.rs,...structuredClone(q)},'speaking'));
  const images=number===4?[replacementImages[0],replacementImages[2],replacementImages[1],webImages[0],replacementImages[3]]:[...mock5Images,webImages[5],webImages[9]];
  let rs=0,di=0;
  current.questions=current.questions.map(q=>q.type==='rs'?repeats[rs++]:q.type==='di'?references.apply({...bank.types.di,...structuredClone(images[di++])}):q);
  current.contentVersion=3;
}
const audioQuestions=[...new Map([...historicalQuestions,...revisionTwoQuestions,...papers.flatMap(p=>p.questions)].filter(q=>q.audioSource).map(q=>[q.id,q])).values()];
function publicQuestion(q,reveal=false){
  return {id:q.id,type:q.type,name:q.name,preparation:q.preparation,seconds:q.seconds,instruction:q.instruction,
    ...(q.type==='di'?{title:q.title||q.visual?.title||''}:{}),
    ...(['intro','ra','rts'].includes(q.type)?{text:q.text}:{}),
    ...(q.audioSource?(approvedAudio.publicAudio(q)||rtsPrompts.publicAudio(q,'/speaking-mock-audio')||{audioUrl:'/speaking-mock-audio/'+q.id+'.mp3?v='+VERSION,audioSeconds:q.audioSeconds}):{}),
    ...(q.imageUrl?{imageUrl:q.imageUrl,...require('../di-image-display').forQuestion(q)}:q.visual?{imageUrl:'/speaking-image/'+q.id+'.svg'}:{}),
    ...(reveal?{title:q.title,reference:q.text,sample:q.sample,facts:q.facts}:{} )};
}
const catalogue=()=>papers.map(({questions,...paper})=>({...paper,tasks:Object.keys(bank.types).map(type=>({type,label:bank.types[type].name,count:questions.filter(q=>q.type===type).length}))}));
function reattemptQuestions(original){
  const current=papers.find(p=>p.id===original.paperId)||papers[0],images=current.questions.filter(q=>q.type==='di'),repeats=current.questions.filter(q=>q.type==='rs');let imageIndex=0,repeatIndex=0;
  return original.questions.map(q=>{
    if(q.type==='sgd'){
      const current=bank.questions.find(item=>item.id===q.id&&item.type==='sgd');
      return current?source(structuredClone(current),'speaking'):structuredClone(q);
    }
    if(q.type==='rts'){
      const current=bank.questions.find(item=>item.id===q.id&&item.type==='rts');
      return current?(current.audioPrompt===false?structuredClone(current):source(structuredClone(current),'speaking')):structuredClone(q);
    }
    if(q.type==='rs')return{...structuredClone(current.contentVersion>=2?repeats[repeatIndex++]:q),startCueMs:bank.types.rs.startCueMs,instruction:bank.types.rs.instruction};
    if(q.type!=='di')return structuredClone(q);
    const replacement=images[imageIndex++%images.length];
    return structuredClone(replacement);
  });
}
module.exports={VERSION,OVERALL_MINUTES,papers,audioQuestions,catalogue,publicQuestion,suppliedMockImage,reattemptQuestions};
