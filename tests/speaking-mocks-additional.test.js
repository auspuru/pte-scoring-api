'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const bank=require('../content/speaking-mocks'),manifest=require('../docs/speaking-mocks-4-5-manifest.json');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
test('new selectable papers preserve all old paper snapshots and use ten distinct internet originals',()=>{
 for(const p of bank.papers.slice(0,3))assert.equal(hash(JSON.stringify(p)),manifest.existingPaperHashes[p.id]);
 const seen=new Set(),sourceIds=new Set();
 for(const p of bank.papers){for(const q of p.questions.filter(q=>q.type==='di')){
  const bytes=fs.readFileSync(path.join(__dirname,'../public',q.imageUrl)),sha=hash(bytes);assert(!seen.has(sha),'Repeated image '+q.id);seen.add(sha);
  if(p.id==='speaking-mock-4'||p.id==='speaking-mock-5'){
   assert.equal(sha,q.contentOrigin.sha256);assert.equal(bytes.length,q.contentOrigin.bytes);assert.match(q.contentOrigin.sourceUrl,/^https:\/\//);assert(!sourceIds.has(q.contentOrigin.sourceUrl));sourceIds.add(q.contentOrigin.sourceUrl);
   assert.deepEqual(require('../di-reference').referenceFor(q).source,{kind:'image-sha256',sha256:sha});const display=require('../di-image-display'),entry=display.manifest.entries[q.id];assert.equal(display.forQuestion(q).displayImageUrl,entry.displayImageUrl);assert.equal(hash(fs.readFileSync(path.join(__dirname,'../public',entry.displayImageUrl))),entry.displaySha256);
  }
 }}
 assert.equal(sourceIds.size,10);
 for(const p of bank.papers.slice(3)){
  assert(bank.catalogue().find(row=>row.id===p.id));assert.equal(p.minutes,40);assert.equal(p.questions.filter(q=>q.type==='di'&&q.imageCategory==='line').length,1);
  const before=JSON.stringify(p.questions);assert.deepEqual(bank.reattemptQuestions({paperId:p.id,questions:p.questions}),p.questions);assert.equal(JSON.stringify(p.questions),before);
  const normalized=p.questions.filter(q=>q.type!=='intro').map(q=>q.imageUrl||q.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' '));assert.equal(new Set(normalized).size,27);
  for(const q of p.questions.filter(q=>q.audioSource)){
   const s=q.audioSource,approved=s.folder==='approved'?require('../approved-audio').fileFor(s.id):null;
   const entry=approved?.entry||(s.folder==='speaking'?require('../content/speaking-audio-manifest')():require('../content/writing-audio/manifest.json'))[s.id];
   const file=approved?.file||path.join(__dirname,'../content',s.folder+'-audio',s.id+'.mp3');assert.equal(hash(fs.readFileSync(file)),entry.audioSha256);assert.equal(hash(q.text),entry.textSha256);
  }
 }
});

test('new papers serve every exact public prompt recording, including supplied situations',async t=>{
 const express=require('express'),os=require('node:os'),{randomUUID}=require('node:crypto'),app=express();app.use(express.json());
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'new-speaking-prompts-'));
 const service=require('../speaking-mock').installSpeakingMock(app,{directory,verifyToken:token=>token==='alice'?'alice':null,getAccount:async()=>({}),backgroundEnabled:false,azureAvailable:false,gptAvailable:false});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{await service.stop();await service.waitForJobs();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port;
 for(const p of bank.papers.slice(3)){
  const response=await fetch(base+'/api/speaking-mocks/attempts',{method:'POST',headers:{'Content-Type':'application/json','x-session-token':'alice'},body:JSON.stringify({id:randomUUID(),paperId:p.id})});assert.equal(response.status,200);const a=await response.json();assert.equal(a.paperId,p.id);assert.equal(a.questionCount,27);assert.equal(a.deadline-a.startedAt,40*60000);
  for(const q of p.questions.filter(q=>q.audioSource)){
   const shown=bank.publicQuestion(q),r=await fetch(base+shown.audioUrl);assert.equal(r.status,200,q.id);assert.match(r.headers.get('content-type'),/audio\/mpeg/);
   const source=q.audioSource,entry=source.folder==='approved'?require('../approved-audio').fileFor(source.id).entry:(source.folder==='speaking'?require('../content/speaking-audio-manifest')():require('../content/writing-audio/manifest.json'))[source.id];assert.equal(hash(Buffer.from(await r.arrayBuffer())),entry.audioSha256,q.id);
  }
 }
 const bad=await fetch(base+'/speaking-mock-audio/mock-rts-user-20261110-lecture.mp3?prompt=unrecognised');assert.equal(bad.status,404);
});

test('current revision starts with short repeat sentences and preserves historical prompt playback',()=>{
 const revision=require('../docs/speaking-mocks-4-5-revision-2.json');
 for(const p of bank.papers.slice(3)){
  const rs=p.questions.filter(q=>q.type==='rs');assert.equal(p.contentVersion,3);assert.equal(rs.length,10);assert(rs.slice(0,8).every(q=>q.text.split(/\s+/).length<=8));assert(rs.every(q=>q.text.split(/\s+/).length<=12));
  for(const q of rs.slice(0,8)){assert.equal(q.contentOrigin.kind,'instructor-requested-short-adaptation');assert(q.audioSeconds>=2&&q.audioSeconds<=9);}
  const original=revision.previousQuestions[p.id],before=structuredClone(original),updated=bank.reattemptQuestions({paperId:p.id,questions:original});
  assert.deepEqual(updated.filter(q=>q.type==='rs'),rs);assert.deepEqual(original,before);
  for(const q of original.filter(q=>q.audioSource))assert(bank.audioQuestions.some(saved=>saved.id===q.id&&saved.text===q.text),'Lost historical prompt '+q.id);
 }
 assert.deepEqual(bank.papers[3].questions.filter(q=>q.type==='di').map(q=>q.imageCategory),['pie','bar','bar','line','process']);
});

test('targeted media revision has distinct clean RS files, static then comparison bars, and unchanged final images',()=>{
 const audio=require('../content/speaking-audio-manifest')(),writing=require('../content/writing-audio/manifest.json'),ids=new Set(),texts=new Set(),hashes=new Set();
 for(const [offset,p] of bank.papers.slice(3).entries()){
  const images=p.questions.filter(q=>q.type==='di');assert.deepEqual(images.map(q=>q.imageCategory),['pie','bar','bar','line',offset?'diagram':'process']);
  assert.equal(images[1].id,offset?'mock-di-reference-20261111-classical-music-britain':'mock-di-reference-20261111-pop-music');
  assert.equal(images[2].id,offset?'mock-di-reference-20261111-asian-elephants-comparison':'mock-di-reference-20261111-transport');
  assert.equal(images[4].id,offset?'mock-di-web-20261110-solar-system-sizes':'mock-di-reference-20261111-tomato-cycle');
  for(const q of p.questions.filter(q=>q.type==='rs')){
   assert(!ids.has(q.id));assert(!texts.has(q.text));ids.add(q.id);texts.add(q.text);
   const e=audio[q.id],previous=bank.audioQuestions.find(row=>row.id===q.audioRevision.replacesId);assert(previous);assert.equal(previous.text,q.text);
   const oldEntry=(previous.audioSource.folder==='writing'?writing:audio)[previous.audioSource.id];assert.notEqual(e.audioSha256,oldEntry.audioSha256);
   assert.equal(e.generator,'tts-1-hd');assert.equal(e.speed,1);assert.equal(e.normalization.clippedSamples,0);assert(e.normalization.decodedPeakDb<=-1);assert.equal(e.normalization.sampleRate,24000);assert(q.audioSeconds>=2&&q.audioSeconds<=9);
   assert(!hashes.has(e.audioSha256));hashes.add(e.audioSha256);
  }
 }
 assert.equal(ids.size,20);
});
