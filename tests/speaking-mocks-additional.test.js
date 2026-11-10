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
   assert.deepEqual(require('../di-reference').referenceFor(q).source,{kind:'image-sha256',sha256:sha});assert.equal(require('../di-image-display').forQuestion(q).displayImageUrl,q.imageUrl);
  }
 }}
 assert.equal(sourceIds.size,10);
 for(const p of bank.papers.slice(3)){
  assert(bank.catalogue().find(row=>row.id===p.id));assert.equal(p.minutes,40);assert.equal(p.questions.filter(q=>q.type==='di'&&q.imageCategory==='line').length,4);
  const before=JSON.stringify(p.questions);assert.deepEqual(bank.reattemptQuestions({paperId:p.id,questions:p.questions}),p.questions);assert.equal(JSON.stringify(p.questions),before);
  const normalized=p.questions.filter(q=>q.type!=='intro').map(q=>q.imageUrl||q.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' '));assert.equal(new Set(normalized).size,27);
  for(const q of p.questions.filter(q=>q.audioSource)){
   const s=q.audioSource,approved=s.folder==='approved'?require('../approved-audio').fileFor(s.id):null;
   const entry=approved?.entry||(s.folder==='speaking'?require('../content/speaking-audio-manifest')():require('../content/writing-audio/manifest.json'))[s.id];
   const file=approved?.file||path.join(__dirname,'../content',s.folder+'-audio',s.id+'.mp3');assert.equal(hash(fs.readFileSync(file)),entry.audioSha256);assert.equal(hash(q.text),entry.textSha256);
  }
 }
});
