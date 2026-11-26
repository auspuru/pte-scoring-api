'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),express=require('express');
const audio=require('../approved-audio'),bank=require('../content/speaking-bank'),predictions=require('../content/writing-predictions-sep-2026');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
test('all 55 approved recordings resolve exact source and byte hashes, with six source-identical Listening aliases',async()=>{
 const rows=require('../review/audio-refresh-remaining-20261104/sources.json');assert.equal(Object.keys(audio.entries).length,55);
 for(const source of rows){const q=audio.current(source),entry=audio.entries[q.audioKey],found=audio.fileFor(q.audioKey);assert(q.audioKey);assert.equal(q.text,source.text);assert.deepEqual(q.answers,source.answers);assert.equal(entry.textSha256,sha(source.kind==='hiw'?source.audioText:source.text));const data=await fs.readFile(found.file);assert.equal(data.length,entry.bytes);assert.equal(sha(data),entry.audioSha256);assert.match(audio.publicAudio(q).audioUrl,/^\/practice-audio\/[a-z0-9-]+\.mp3\?v=sha256-/);assert.equal(audio.publicAudio(source),null);assert.throws(()=>audio.current({...source,text:'Changed.',...(source.kind==='hiw'?{audioText:'Changed.'}:{})}),/unavailable/);}
 for(const alias of require('../review/audio-refresh-remaining-20261104/shared-listening-hiw.json')){const source=predictions.sst.find(q=>q.id===alias.replacementCandidateId),q=audio.current({id:alias.consumerId,type:'hiw',audioId:source.id,text:source.text});assert.equal(q.audioKey,audio.current(source).audioKey);}
 assert.equal(audio.fileFor('../server.js'),null);assert.equal(audio.fileFor('__proto__'),null);
});
test('Speaking and Writing attempts preserve keyed media and serve newly imported recordings',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'approved-audio-')),app=express();app.use(express.json());
 const auth={directory,verifyToken:token=>['fixture','retell-fixture','booklet-discussion-fixture'].includes(token)?token:null,getAccount:async()=>({}),transcriptionAvailable:false,deliveryAssessmentAvailable:false,azureComparisonAvailable:false};
 const speaking=require('../speaking-lab').installSpeakingLab(app,auth),writing=require('../writing-lab').installWritingLab(app,{...auth,directory:path.join(directory,'writing'),speakingAllowed:async()=>true});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(async()=>{await speaking.waitForAssessments();await writing.stop();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(directory,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port;
 async function request(route,body,token='fixture'){const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','x-session-token':token},body:body===undefined?undefined:JSON.stringify(body)});assert.equal(r.status,200,await r.clone().text());return r.json();}
 const catalogSpeaking=await request('/api/speaking/catalog');
 const retellPredictions = require('../content/user-rl-20261123.json');
 const retellCatalogue = catalogSpeaking.questions.filter(q => q.type === 'rl');
 const bookletRetells = require('../content/user-rl-pte-nepal-20261122.json');
 assert.equal(retellCatalogue.length, 66 + bookletRetells.length);
 assert.deepEqual(retellCatalogue.filter(q => q.id.startsWith('rl-user-20261125-booklet-')).map(q => q.id), bookletRetells.map(q => q.id));
 const labeledRetells = retellCatalogue.filter(q => q.title.startsWith('New Questions · '));
 assert.deepEqual(labeledRetells.map(q => q.id), retellPredictions.map(q => q.id));
 const pavlov = retellPredictions.find(q => q.source.sourceId === 165);
 assert.equal(pavlov.source.contentStatus, 'adapted');
 assert.equal(labeledRetells.find(q => q.id === pavlov.id).title,
   'New Questions · Pavlov Experiment (adapted) · AI practice narration');
 for (const [index, lecture] of retellPredictions.entries()) {
   const id = crypto.randomUUID();
   const created = await request('/api/speaking/attempts', { id, questionId: lecture.id }, 'retell-fixture');
   const catalogueTitle = labeledRetells[index].title;
   assert.equal(catalogueTitle, `New Questions · ${lecture.title} · AI practice narration`);
   assert.equal(created.question.title, catalogueTitle);
   assert.equal(created.question.preparation, 10);
   assert.equal(created.question.seconds, 40);
   assert.equal(created.question.reference, undefined);
   assert.equal(new URL(created.question.audioUrl, base).pathname, `/speaking-audio/${lecture.id}.mp3`);
   const recording = await fetch(base + created.question.audioUrl, { headers: { Range: 'bytes=0-255' } });
   assert.equal(recording.status, 206);
   assert.equal(recording.headers.get('content-type'), 'audio/mpeg');
   assert.equal((await recording.arrayBuffer()).byteLength, 256);
   if (index === 0) {
     await request('/api/speaking/attempts/' + id + '/transcript', {
       text: lecture.sample, revision: created.revision,
     }, 'retell-fixture');
     const reopened = await request('/api/speaking/attempts/' + id, undefined, 'retell-fixture');
     assert.equal(reopened.transcript, lecture.sample);
   }
 }
 const novemberDiscussions = require('../content/user-sgd-20261123.json');
 const newDiscussions = require('../content/user-sgd-20261124.json');
 const imported = [...novemberDiscussions, ...newDiscussions];
 const labeled=catalogSpeaking.questions.filter(q=>q.type==='sgd'&&q.title.startsWith('New Questions · '));
 assert.deepEqual(labeled.map(q=>q.id),['sgd-user-20261030-06','sgd-user-20261030-08','sgd-user-20261030-09',...imported.map(q=>q.id)]);
 for(const source of bank.questions.filter(q=>q.type==='sgd')){
   const booklet=source.id.startsWith('sgd-user-20261125-booklet-');
   const token=booklet?'booklet-discussion-fixture':'fixture';
   const id=crypto.randomUUID(),created=await request('/api/speaking/attempts',{id,questionId:source.id},token);
   const updated=audio.current(source),stored=await speaking.store.update(token,id,a=>a);
   assert.equal(created.question.title,catalogSpeaking.questions.find(q=>q.id===source.id).title);
   assert.match(created.question.audioUrl,booklet||imported.some(q=>q.id===source.id)?/^\/speaking-audio\//:/^\/practice-audio\//);
   assert.equal(stored.questionSnapshot.audioKey,updated.audioKey);
   assert.equal(stored.questionSnapshot.text,source.text);
   const r=await fetch(base+created.question.audioUrl,{headers:{Range:'bytes=0-255'}});
   assert.equal(r.status,206);
   assert.equal((await r.arrayBuffer()).byteLength,256);
   if (source.id === novemberDiscussions[0].id || newDiscussions.some(q => q.id === source.id)) {
     assert.equal(created.question.preparation,10);
     assert.equal(created.question.seconds,120);
     const saved=await request('/api/speaking/attempts/'+id+'/transcript',{text:source.sample,revision:created.revision});
     assert.equal(saved.transcript,source.sample);
     const reopened=await request('/api/speaking/attempts/'+id);
     assert.equal(reopened.transcript,source.sample);
   }
 }
 const source=bank.questions.find(q=>q.id==='sgd-1'),oldId=crypto.randomUUID();await speaking.store.update('fixture',oldId,()=>({id:oldId,questionId:source.id,status:'submitted',startedAt:1,revision:0,transcript:'Saved answer.',result:{total:6,maximum:6,scoringMode:'ai'}}));
 const before=JSON.stringify(await speaking.store.update('fixture',oldId,a=>a)),old=await request('/api/speaking/attempts/'+oldId);assert.match(old.question.audioUrl,/^\/speaking-audio\/sgd-1/);assert.equal(old.result.total,6);assert.equal(JSON.stringify(await speaking.store.update('fixture',oldId,a=>a)),before);
 const catalog=await request('/api/writing-lab/catalog');assert.equal(catalog.spoken.filter(q=>q.audioUrl.startsWith('/practice-audio/')).length,17);assert.equal(catalog.dictation.filter(q=>q.audioUrl.startsWith('/practice-audio/')).length,3);
 const selected=[...predictions.sst.filter(q=>audio.entryFor(q)),...predictions.wfd.filter(q=>audio.entryFor(q))];
 for(const source of selected){const id=crypto.randomUUID(),created=await request('/api/writing-lab/attempts',{id,testId:source.id,mode:'practice'});assert.match(created.questions[0].audioUrl,/^\/practice-audio\//);const stored=await writing.store.update('fixture',id,a=>a);assert.equal(stored.questions[0].text,source.text);assert.equal(stored.questions[0].audioKey,audio.current(source).audioKey);}
 const legacyId=crypto.randomUUID(),q=predictions.sst[0];await writing.store.update('fixture',legacyId,()=>({id:legacyId,testId:q.id,title:q.title,kind:'sst',module:'listening',questions:[structuredClone(q)],index:0,mode:'practice',status:'ready',startedAt:1,deadline:null,answers:['Saved answer.'],results:[null],completed:[null],playback:[null],revisions:[1]}));const legacy=await request('/api/writing-lab/attempts/'+legacyId);assert.match(legacy.questions[0].audioUrl,/^\/writing-audio\//);assert.equal(legacy.answers[0],'Saved answer.');
 assert.equal((await fetch(base+'/practice-audio/unknown.mp3')).status,404);
});
test('Speaking mock reattempts adopt approved SGD recordings without relinking historical snapshots',()=>{
 const mocks=require('../content/speaking-mocks');for(const paper of mocks.papers.slice(0,5)){const old=structuredClone(paper);for(const q of old.questions.filter(q=>q.type==='sgd')){delete q.audioKey;delete q.audioVersion;q.audioSource={folder:'speaking',id:q.id};q.audioSeconds=require('../content/speaking-audio-manifest')()[q.id].seconds;}const saved=JSON.stringify(old),fresh=mocks.reattemptQuestions(old);for(const q of fresh.filter(q=>q.type==='sgd')){assert.match(mocks.publicQuestion(q).audioUrl,/^\/practice-audio\//);assert.equal(q.audioSeconds,audio.entries[q.audioKey].seconds);}for(const q of old.questions.filter(q=>q.type==='sgd'))assert.match(mocks.publicQuestion(q).audioUrl,/^\/speaking-mock-audio\//);assert.equal(JSON.stringify(old),saved);}
});
