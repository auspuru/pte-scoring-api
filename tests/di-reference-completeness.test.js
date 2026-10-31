'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto'),express=require('express');
const bank=require('../content/speaking-bank'),refs=require('../di-reference'),history=require('../content/di-reference-history.json'),practice=require('../di-practice-references'),{hash}=require('../scoring-jobs'),{mapping}=require('../describe-image-feedback');
const question=id=>bank.questions.find(q=>q.id==='di-pred-'+id);
test('reviewed DI references cover the original legends and preserve the source image identity',()=>{
 const ids=['3000137','3000885','3000589','3000580','3000365','3001398'];
 for(const id of ids){const q=question(id),e=refs.manifest.entries[q.id],old=history.entries[q.id];assert.equal(hash(mapping(q)),e.mappingHash);assert.equal(e.referenceReview.sourceSha256,old.source.sha256);assert.deepEqual(e.source,old.source);assert.equal(q.imageUrl,old.portalImageUrl);assert.notEqual(e.mappingHash,old.mappingHash);assert(q.sample.split(/\s+/).length<=100);assert(practice.available(q));}
 assert.match(question('3000137').facts.join(' '),/northeast/);
 assert.match(question('3000885').facts.join(' '),/10–16.38/);
 assert.match(question('3000589').facts.join(' '),/six legend categories/);
 assert.match(question('3000580').facts.join(' '),/people per square kilometre/);
 assert.match(question('3000365').facts.join(' '),/101–500/);
 assert.match(question('3001398').title,/Foreign Country of Birth/);
 assert.match(question('3001398').facts.join(' '),/do not show annual births/);
});
test('legacy practice retains its original reference and new snapshot references are independent',()=>{
 for(const [id,entry] of Object.entries(history.entries)){
  const q=bank.questions.find(q=>q.id===id),before=structuredClone(q),old=practice.forAttempt({questionId:id,status:'submitted'},q);
  assert.equal(old.imageReference.version,history.version);assert.equal(hash(mapping(old)),entry.mappingHash);assert.equal(old.sample,entry.sample);assert.deepEqual(refs.referenceFor(old),old.imageReference);assert.deepEqual(q,before);
  const snapshot=structuredClone(q);snapshot.sample='Saved snapshot sample';assert.equal(practice.forAttempt({questionSnapshot:snapshot},q).sample,snapshot.sample);
  old.facts.push('A local mutation');assert.deepEqual(q,before);assert.deepEqual(history.entries[id],entry);
 }
});
test('all current Speaking mock DI slots have eligible source-bound references and retained Full Mocks keep their frozen mappings',()=>{
 for(const p of require('../content/speaking-mocks').papers)for(const q of p.questions.filter(q=>q.type==='di')){assert(practice.available(q),p.id+' '+q.id);assert.equal(hash(mapping(q)),refs.manifest.entries[q.id].mappingHash);}
 for(const version of [1,2]){const p=require('../content/full-mock/papers/full-mock-1.v'+version+'.json');for(const {question:q} of p.questions.filter(s=>s.question.type==='di')){assert.equal(hash(mapping(q)),q.imageReference.mappingHash);assert.deepEqual(q.imageReference.source,refs.manifest.entries[q.imageReference.questionId].source);}}
});
test('practice catalogue and direct starts hold unclear images while existing attempts remain readable and resumable',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'di-reference-api-')),app=express();app.use(express.json());
 const service=require('../speaking-lab').installSpeakingLab(app,{directory,verifyToken:token=>token==='alice'?'alice':null,getAccount:async()=>({blocked:false}),transcriptionAvailable:false,deliveryAssessmentAvailable:false,azureComparisonAvailable:false});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(async()=>{await service.waitForAssessments();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port+'/api/speaking';
 const request=async(route,body)=>{const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'x-session-token':'alice','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json()};};
 const catalogue=await request('/catalog');assert.equal(catalogue.status,200);assert.equal(catalogue.data.questions.filter(q=>q.type==='di').length,52);
 for(const id of ['3001061','3001369']){
  const qid='di-pred-'+id;assert(!catalogue.data.questions.some(q=>q.id===qid));
  const blocked=await request('/attempts',{id:randomUUID(),questionId:qid});assert.equal(blocked.status,422);assert.match(blocked.data.error,/clearer source/);
  const idOld=randomUUID(),savedResult={content:4,total:4,maximum:6,scoringMode:'ai',marker:'confirmed'};
  await service.store.update('alice',idOld,()=>({id:idOld,questionId:qid,status:'submitted',startedAt:1,transcript:'A retained answer.',revision:1,result:savedResult}));
  const old=await request('/attempts/'+idOld);assert.equal(old.status,200);assert.equal(old.data.question.sample,history.entries[qid].sample);
  assert.equal((await request('/attempts',{id:idOld,questionId:qid})).status,200);assert.deepEqual((await service.store.update('alice',idOld,a=>a)).result,savedResult);
 }
 const id=randomUUID(),newAttempt=await request('/attempts',{id,questionId:'di-pred-3000137'});assert.equal(newAttempt.status,200);assert.equal(newAttempt.data.question.sample,undefined);assert.equal(newAttempt.data.question.facts,undefined);
 const stored=await service.store.update('alice',id,a=>a);assert.equal(stored.questionSnapshot.imageReference.version,refs.manifest.version);assert.match(stored.questionSnapshot.facts.join(' '),/northeast/);
 const original=question('3000137').sample;question('3000137').sample='A later bank revision';try{await service.store.update('alice',id,a=>({...a,status:'submitted'}));assert.equal((await request('/attempts/'+id)).data.question.sample,original);}finally{question('3000137').sample=original;}
});
