'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createAcademyClient,contentResult,deliveryResult,VERSION}=require('../visual-academy-client'),{hash}=require('../scoring-jobs');
test('Academy transport persists a verifiable receipt before sending audio and checks every result hash',async()=>{
  let prepared,metadata,failHash=false;const wav=Buffer.alloc(100,7),secret='test-service-secret',recording={hash:'b'.repeat(64),mime:'audio/webm',data:'saved'};
  const client=createAcademyClient({origin:'https://academy.test',secret,toWav:async()=>({wav,seconds:1}),request:async(url,args)=>{
    assert.equal(args.headers.Authorization,'Bearer '+secret);assert.equal(args.redirect,'error');
    if(args.method==='POST'){assert(prepared,'The durable receipt must be saved before any request');const {wav:encoded,...input}=JSON.parse(args.body);metadata=input;assert.equal(encoded,wav.toString('base64'));assert.equal(input.normalizedHash,hash(wav));assert.deepEqual(input.mapping.facts,['A verified image fact.']);assert.equal(input.version,VERSION);assert.equal(input.studentToken,undefined);return{ok:true,json:async()=>({id:input.id,version:VERSION,inputHash:hash(input)})};}
    return{ok:true,json:async()=>({id:metadata.id,version:VERSION,inputHash:hash(metadata),normalizedHash:failHash?'wrong':metadata.normalizedHash,recordingHash:recording.hash,status:'ready'})};
  }});
  const receipt=await client.submit({id:'a'.repeat(64),question:{type:'di',title:'Chart',facts:['A verified image fact.']},recording,transcript:'My words.',requested:['content','delivery'],onPrepared:async value=>{prepared=value;}});
  assert.deepEqual(receipt,prepared);assert.equal((await client.poll(receipt,recording.hash)).status,'ready');failHash=true;await assert.rejects(client.poll(receipt,recording.hash),/mismatch/);
});
test('native Academy marks retain provenance and reject unavailable content or an unapproved delivery rubric',()=>{
  assert.equal(contentResult({status:'source-limited',score:null,max:6}),null);const content=contentResult({status:'scored',score:6,max:6,reason:'Clear.',nextStep:'Keep the meaning.'},null);assert.equal(content.total,6);assert.equal(content.serviceVersion,VERSION);assert.equal(content.score_provisional,false);
  const delivery=deliveryResult({pronunciation:{score:5,rubricVersion:'obsolete'},fluency:{status:'scored',score:5,rubricVersion:'intelligibility-delivery-v5'}},'recording',()=>1);assert.equal(delivery.pronunciation,null);assert.equal(delivery.fluency.score,5);assert.equal(delivery.recordingHash,'recording');
  assert.equal(hash({z:1,a:{y:2,x:3}}),hash({a:{x:3,y:2},z:1}),'PostgreSQL JSONB key order cannot change job identity');
});
