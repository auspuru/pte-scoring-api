'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const speaking=require('./content/speaking-bank'),mocks=require('./content/speaking-mocks'),writing=require('./content/writing-lab.json');
const approved=require('./approved-audio'),speakingAudio=require('./content/speaking-audio-manifest')(),writingAudio=require('./content/writing-audio/manifest.json');
const VERSION='random-single-task-2026-11-11.1',COUNTS=Object.freeze([5,10,15,20]);
const TYPES=Object.freeze({...Object.fromEntries(Object.entries(speaking.types).map(([id,q])=>[id,q.name])),wfd:'Write From Dictation'});
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
function audio(q){
  const current=approved.current(structuredClone(q));
  if(current.audioKey){const file=approved.fileFor(current.audioKey);return file?{...current,audioSource:{folder:'approved',id:current.audioKey},audioSeconds:current.audioSeconds}:null;}
  const folder=q.audioSource?.folder||'speaking',id=q.audioSource?.id||q.promptAudioKey||q.id;
  const entry=(folder==='writing'?writingAudio:speakingAudio)[id];
  if(!entry||entry.textSha256!==hash(q.text||'')||!fs.existsSync(path.join(__dirname,'content',folder+'-audio',id+'.mp3')))return null;
  return {...current,audioSource:{folder,id},audioSeconds:entry.seconds};
}
let cached;
function pools(){
  if(cached)return cached;
  const result=Object.fromEntries(Object.keys(TYPES).map(type=>[type,[]]));
  const sources=[...mocks.papers.slice(3).flatMap(p=>p.questions),...mocks.papers.slice(0,3).flatMap(p=>p.questions),...speaking.questions];
  for(const source of sources){
    if(!Object.hasOwn(speaking.types,source.type))continue;
    let q=structuredClone(source);
    if(q.type==='di'&&(!mocks.suppliedMockImage(q)||!require('./di-practice-references').available(q)))continue;
    if(q.type==='rs'&&q.text.trim().split(/\s+/u).length>12)continue;
    if(['rs','rl','sgd','rts'].includes(q.type)){q=audio(q);if(!q)continue;}
    result[q.type].push(q);
  }
  for(const source of writing.dictation){
    const entry=writingAudio[source.id];if(!entry||entry.textSha256!==hash(source.text))continue;
    result.wfd.push({...structuredClone(source),minutes:2});
    if(source.text.trim().split(/\s+/u).length<=12){
      const q=audio({...speaking.types.rs,type:'rs',id:'practice-rs-'+source.id,title:'Repeat Sentence',text:source.text,sample:source.text,sourceId:source.id,audioSource:{folder:'writing',id:source.id}});
      if(q)result.rs.push(q);
    }
  }
  for(const type of Object.keys(result)){
    const seen=new Set();result[type]=result[type].filter(q=>{
      const key=type==='di'?q.imageReference?.source.sha256||q.imageUrl:String(q.text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
      if(!key||seen.has(key))return false;seen.add(key);return true;
    });
  }
  return cached=result;
}
function options(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['type','count'].includes(key))||typeof input.type!=='string'||!Object.hasOwn(TYPES,input.type)||!Number.isInteger(input.count)||!COUNTS.includes(input.count))throw fail('Choose one question type and 5, 10, 15 or 20 questions.');
  if(input.count>pools()[input.type].length)throw fail('Only '+pools()[input.type].length+' different '+TYPES[input.type]+' questions are available. Choose a smaller set.',422);
  return {type:input.type,count:input.count};
}
const settings=value=>options({type:value.type,count:value.count});
function catalogue(canSpeak=true){return Object.entries(TYPES).filter(([type])=>canSpeak||type==='wfd').map(([type,label])=>({type,label,available:pools()[type].length,counts:COUNTS.filter(n=>n<=pools()[type].length)}));}
function shuffled(rows,randomInt){const copy=rows.slice();for(let i=copy.length-1;i>0;i--){const j=randomInt(i+1);[copy[i],copy[j]]=[copy[j],copy[i]];}return copy;}
function select(config,previous=[],randomInt=crypto.randomInt){
  const {type,count}=settings(config),seen=new Set(previous.filter(a=>a.practiceSet?.type===type).flatMap(a=>(a.questions||[]).map(q=>q.id)));
  const available=pools()[type],fresh=shuffled(available.filter(q=>!seen.has(q.id)),randomInt),reused=shuffled(available.filter(q=>seen.has(q.id)),randomInt);
  return [...fresh,...reused].slice(0,count).map(q=>structuredClone(q));
}
function make(config,previous=[],randomInt){
  const selected=settings(config),questions=select(selected,previous,randomInt),{type,count}=selected;
  if(type==='wfd')questions.forEach(q=>{delete q.timeGroup;});
  const seconds=questions.reduce((n,q)=>n+(type==='wfd'?q.minutes*60:3+(q.audioSeconds||0)+q.preparation+q.seconds+(q.startCueMs||0)/1000),0);
  return {id:'practice-set-'+type+'-'+count,title:TYPES[type]+' · '+count+'-question practice set',questionCount:count,minutes:Math.ceil(seconds/60)+(type==='wfd'?0:1),questions,
    module:type==='wfd'?'listening':'speaking',practiceSet:{version:VERSION,...selected,poolSize:pools()[type].length}};
}
function audioQuestion(id){return Object.values(pools()).flat().find(q=>q.id===id&&q.audioSource);}
function registerSpeaking(app,store){(app.locals.randomPracticeStores||={}).speaking=store;}
function install(app,{writingStore,verifyToken,getAccount,speakingAllowed}){
  const registry=app.locals.randomPracticeStores||={};registry.writing=writingStore;
  const router=require('express').Router();
  router.use(async(req,res,next)=>{try{const owner=verifyToken(req.headers['x-session-token']||''),account=owner&&await getAccount(owner);if(!account||account.blocked)return res.status(401).json({error:'Please sign in to your practice account.'});req.practiceOwner=owner;res.set('Cache-Control','no-store');next();}catch{res.status(503).json({error:'Your account could not be checked. Please retry.'});}});
  router.get('/catalog',async(req,res)=>{try{res.json({version:VERSION,types:catalogue(await speakingAllowed(req.practiceOwner))});}catch{res.status(503).json({error:'Practice sets could not load. Please retry.'});}});
  router.get('/attempts',async(req,res)=>{try{
    const canSpeak=await speakingAllowed(req.practiceOwner),rows=[];
    const stores=[['writing',registry.writing],...(canSpeak&&registry.speaking?[['speaking',registry.speaking]]:[])];
    for(const [engine,store] of stores)for(const a of await store.list(req.practiceOwner,{omitMockAudio:true})){
      if(!a.practiceSet)continue;
      const shown=engine==='speaking'?require('./speaking-mock').present(a,Date.now(),{completeOnly:a.assessmentProfile?.mode==='progressive-v1'}):require('./writing-lab').present(a);
      const score=engine==='speaking'?shown.speakingReport?.azure?.overallScore:shown.report?.score90;
      rows.push({id:a.id,engine,type:a.practiceSet.type,count:a.practiceSet.count,title:a.title,startedAt:a.startedAt,status:shown.status,ready:a.status==='submitted'&&(engine==='speaking'?shown.resultsReady!==false&&shown.speakingReport?.azure?.status==='assessed':shown.report?.complete===true),score90:a.status==='submitted'?score??null:null});
    }
    res.json(rows.sort((a,b)=>Number(b.startedAt)-Number(a.startedAt)));
  }catch{res.status(503).json({error:'Saved practice sets could not load. Please retry.'});}});
  app.use('/api/practice-sets',router);
}
module.exports={VERSION,COUNTS,TYPES,pools,options,settings,catalogue,select,make,audioQuestion,registerSpeaking,install};
