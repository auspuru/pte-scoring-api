'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),tools=require('../public/reading-mock-tools'),catalogue=require('../public/practice-catalogue'),bank=require('../public/reading-bank.json');
function harness(){
 const events=[],media=[],timers=new Map();let serial=0,synthesis=0;
 const env={setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),localStorage:{getItem:()=>null,setItem(){}},Audio:class{constructor(url){this.url=url;this.paused=true;media.push(this);}play(){this.paused=false;return Promise.resolve();}pause(){this.paused=true;}},speechSynthesis:{speak(){synthesis++;throw Error('Fixed recordings must not use device speech');},cancel(){}}};
 const speaker=tools.createSpeaker(env,(...e)=>events.push(e));return{env,events,media,timers,speaker,synthesis:()=>synthesis};
}
test('all 20 fresh HIW library questions use fixed files without changing text or answer coordinates',()=>{
 const rows=catalogue.readingLibraries(bank).find(l=>l.id==='hiw').questions;assert.equal(rows.length,20);
 for(const q of rows){assert.equal(q.fixedAudio,true);assert.match(q.audioUrl,/^\/practice-audio\//);const original=[...bank.audioQuestionBank,...bank.mixedMock.audioQuestions,...bank.practiceLibraries.flatMap(l=>l.questions)].find(v=>v.id===q.id);assert.equal(q.audioText,original.audioText);assert.equal(q.passage,original.passage);assert.deepEqual(q.answers,original.answers);assert.equal(tools.audioPlayback(q).variant,'single');assert.equal(tools.audioPlayback(q).fixedAudio,true);}
 const historical=structuredClone(bank.practiceLibraries.find(l=>l.id==='hiw').questions[0]);assert.equal(tools.prepareQuestion(historical).fixedAudio,undefined);assert.equal(tools.audioPlayback(historical).variant,'mixed');
});
test('fixed HIW only completes after actual playback, supports volume/replay, and rejects stale completion',async()=>{
 const h=harness(),q=catalogue.readingLibraries(bank).find(l=>l.id==='hiw').questions[0],options=tools.audioPlayback(q);
 h.speaker.play(q.uid,q.audioText,options);assert.equal(h.events.at(-1)[1],'loading');const first=h.media[0];assert.equal(first.url,q.audioUrl);assert.equal(h.synthesis(),0);
 first.onplaying();assert.equal(h.events.at(-1)[1],'playing');h.speaker.setVolume(.4);assert.equal(first.volume,.4);assert(!h.events.some(e=>e[1]==='complete'));
 first.onended();assert.equal(h.events.at(-1)[1],'complete');assert(first.paused);
 h.speaker.play(q.uid,q.audioText,options);const second=h.media[1];second.onplaying();const late=second.onended;h.speaker.cancel();const count=h.events.length;late();assert.equal(h.events.length,count);assert(second.paused);assert.equal(h.synthesis(),0);
});
test('missing and failed fixed audio stays retryable without switching to browser speech',async()=>{
 const h=harness(),q=catalogue.readingLibraries(bank).find(l=>l.id==='hiw').questions[0];h.speaker.play(q.uid,q.audioText,{fixedAudio:true,audioUrl:null});assert.equal(h.events.at(-1)[1],'error');assert.equal(h.media.length,0);
 h.speaker.play(q.uid,q.audioText,tools.audioPlayback(q));h.media[0].onerror();assert.equal(h.events.at(-1)[1],'error');assert(!h.events.some(e=>e[1]==='complete'));assert.equal(h.synthesis(),0);
 const changed=tools.approvedQuestion({...bank.practiceLibraries.find(l=>l.id==='hiw').questions[0],audioText:'A changed script.'});assert(changed.fixedAudio&&changed.audioUnavailable);assert.equal(changed.audioUrl,null);
});
test('account sync retains fixed audio identity and does not relink historical Reading snapshots',()=>{
 const progress=require('../public/account-progress'),fresh=catalogue.readingLibraries(bank).find(l=>l.id==='hiw').questions[0],old=structuredClone(bank.practiceLibraries.find(l=>l.id==='hiw').questions[1]);
 const session=q=>({id:q.id,questions:[q],index:0,answers:{[q.uid]:[q.answers[0]]},times:{[q.uid]:2}});
 const restored=progress.unpackReading(progress.packReading({session:session(fresh),history:[session(old)],drafts:[]}));
 assert.equal(restored.session.questions[0].audioKey,fresh.audioKey);assert.equal(restored.session.questions[0].audioUrl,fresh.audioUrl);assert.equal(restored.history[0].questions[0].audioKey,undefined);assert.deepEqual(restored.session.answers,session(fresh).answers);
});
