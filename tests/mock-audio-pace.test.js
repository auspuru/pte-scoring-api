'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const express=require('express'),audio=require('../mock-audio-pace'),manifest=require('../content/mock-audio-pace.json');
const {loadPaper,registeredPapers,digest}=require('../full-mock/paper'),{createNarration}=require('../writing-lab-audio');
const root=path.resolve(__dirname,'..'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
test('All normal mock assets retain verified source bytes, exact transcript identity and an acceleration-only derivation',async()=>{
 for(const [key,e]of Object.entries(manifest.entries)){
  assert.equal(key.split('-').slice(1).join('-'),e.textSha256);
  assert.equal(sha(await fs.readFile(path.join(root,e.path))),e.audioSha256,key);
  assert.equal(sha(await fs.readFile(path.join(root,e.derivation.sourcePath))),e.derivation.sourceAudioSha256,key);
  assert.equal(e.bytes,(await fs.stat(path.join(root,e.path))).size);
  assert(e.derivation.tempo>=1);assert.equal(e.derivation.speechAdded,false);
  assert(e.wordsPerMinuteIncludingPauses>=143,key+' is too slow');
 }
});
test('New frozen mocks change only the audio and keep all retained paper questions, keys and clocks intact',()=>{
 for(const paper of registeredPapers({activeOnly:true})){
  const old=loadPaper(paper.id,paper.version-1);
  assert.equal(paper.questions.length,65);assert.deepEqual(paper.clockPolicy,old.clockPolicy);
  assert.deepEqual(paper.questions.map(c=>c.question),old.questions.map(c=>c.question));
  assert.deepEqual(paper.questions.map(c=>({id:c.id,image:c.image,displayImage:c.displayImage})),old.questions.map(c=>({id:c.id,image:c.image,displayImage:c.displayImage})));
  assert.equal(paper.audioPacePolicy.sourcePaperHash,digest(old));
  for(const c of paper.questions)if(audio.TYPES.has(c.question.type)){
   const entry=audio.entryFor(c.question);
   if(entry)assert.equal(c.audio.entry.pacingVersion,audio.VERSION);
   else assert.deepEqual(c.audio,old.questions.find(row=>row.id===c.id).audio);
  }
  const sst=paper.questions.find(c=>c.question.type==='sst');assert(sst.audio.entry.seconds<60);assert.equal(sst.question.minutes,10);
 }
});
test('Only new mock snapshots use the normal recording; historical and practice questions keep their audio',()=>{
 const mocks=require('../content/speaking-mocks'),approved=require('../approved-audio');
 for(const paper of mocks.papers)for(const q of paper.questions.filter(q=>['rl','sgd'].includes(q.type))){
  if(audio.entryFor(q))assert.match(mocks.publicQuestion(q).audioUrl,/^\/mock-audio\//);
  const old=structuredClone(q);delete old.mockAudioKey;delete old.mockAudioPace;
  assert.doesNotMatch(mocks.publicQuestion(old).audioUrl,/^\/mock-audio\//);
 }
 const practice=approved.current(require('../content/writing-predictions-sep-2026').sst.find(q=>q.id==='pred26-sst-01'));
 assert.equal(audio.publicAudio(practice),null);assert.match(approved.publicAudio(practice).audioUrl,/^\/practice-audio\//);
 const current=audio.current(practice),changed={...current,text:current.text+' changed'};
 assert.throws(()=>audio.publicAudio(changed),/source changed/);
});
test('Runtime mock narration has exact original text at speed 1, no added effects, no minimum stretch and an isolated reused cache',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mock-normal-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const q=require('../content/user-sst-predictions').sst[12],bytes=await fs.readFile(path.join(root,Object.values(manifest.entries).find(e=>e.pacingVersion).path)),calls=[];
 const narration=createNarration(directory,async input=>{calls.push(input);return bytes;},{cacheVersion:'test-normal',minimumSstSeconds:60});
 const first=await narration.get(q.id,{normalMock:true});await narration.get(q.id,{normalMock:true});
 assert.equal(calls.length,1);assert.equal(calls[0].speed,1);assert.equal(calls[0].input,q.text);assert.deepEqual(calls[0].ambience,[]);
 assert.deepEqual(await fs.readFile(first),bytes);assert.equal(calls[0].mockPace,audio.VERSION);
 const legacy=await narration.get(q.id);assert.notEqual(first,legacy);assert.equal(calls[1].speed,q.audioSpeed);
 assert.equal(calls[1].input,q.narrationText);assert.equal(q.audioSpeed,.83);
 await assert.rejects(narration.get('missing',{normalMock:true}),{status:404});
 await assert.rejects(narration.get(q.id,{normalMock:true,sourceHash:'0'.repeat(64)}),{status:409});
});
test('Normal mock audio URLs serve the pinned bytes, byte ranges and immutable caching',async t=>{
 const app=express();audio.install(app);const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(()=>new Promise(r=>server.close(r)));const entry=Object.values(manifest.entries).find(e=>e.publicMockPlayback),base='http://127.0.0.1:'+server.address().port;
 const result=await fetch(base+'/mock-audio/'+entry.audioSha256+'.mp3',{headers:{Range:'bytes=0-255'}});
 assert.equal(result.status,206);assert.match(result.headers.get('cache-control'),/immutable/);
 assert.deepEqual(Buffer.from(await result.arrayBuffer()),(await fs.readFile(path.join(root,entry.path))).subarray(0,256));
 assert.equal((await fetch(base+'/mock-audio/unknown.mp3')).status,404);
 const privateOnly=Object.values(manifest.entries).find(e=>!e.publicMockPlayback&&!Object.values(manifest.entries).some(other=>other.publicMockPlayback&&other.audioSha256===e.audioSha256));
 if(privateOnly)assert.equal((await fetch(base+'/mock-audio/'+privateOnly.audioSha256+'.mp3')).status,404,'Full Mock-only recordings retain the existing protected media route');
});
