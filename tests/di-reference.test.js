'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {manifest,apply,referenceFor}=require('../di-reference'),{hash}=require('../scoring-jobs');
const bank=require('../content/speaking-bank'),mock=require('../content/speaking-mocks'),mapping=require('../describe-image-feedback').mapping;
test('every practice and mock DI reference is bound to its source image, optional facts and spoken sample',()=>{
  assert.equal(require('../scripts/verify-di-reference-sync').verify().questions,54);
  const items=mock.papers.flatMap(p=>p.questions.filter(q=>q.type==='di'));assert.equal(items.length,15);
  for(const q of items){const entry=manifest.entries[q.id];assert.equal(hash(mapping(q)),entry.mappingHash);assert.deepEqual(q.imageReference.source,entry.source);}
  const rainfall=bank.questions.find(q=>q.id==='di-pred-3000411');assert.match(rainfall.facts.join(' '),/October/);assert.match(rainfall.sample,/October/);assert(!/November|autumn/.test(rainfall.sample));
  const population=bank.questions.find(q=>q.id==='di-pred-3000375');assert.match(population.facts.join(' '),/10000/);assert.match(population.sample,/10,000/);
  assert.deepEqual(bank.questions.find(q=>q.id==='di-pred-3000461').optionalFactIndices,[5]);
  assert.deepEqual(bank.questions.find(q=>q.id==='di-3').optionalFactIndices,[4]);
  const bonds=bank.questions.find(q=>q.id==='di-pred-3000601');assert.match(bonds.facts[0],/counts, not percentages/);assert.match(bonds.facts.at(-1),/14, the smallest count/);
});
test('a changed asset or inconsistent saved reference fails before provider submission',async()=>{
  const q=structuredClone(bank.questions.find(q=>q.id==='di-pred-3000411'));
  assert.throws(()=>apply({...q,imageUrl:'/assets/di-predictions-20260930/3000375.png'}),/image changed/);
  assert.throws(()=>apply({...q,id:'di-pred-unknown'}),/Missing verified/);
  const native=bank.questions.find(q=>q.id==='di-3');assert.throws(()=>apply({...native,visual:{...native.visual,values:[0]}}),/structured image changed/);
  q.facts=['A changed incoming fact.'];let calls=0,converted=0;
  const client=require('../visual-academy-client').createAcademyClient({origin:'https://academy.test',secret:'test',toWav:async()=>{converted++;return{wav:Buffer.alloc(100)};},request:async()=>{calls++;}});
  await assert.rejects(client.submit({id:'a'.repeat(64),question:q,recording:{hash:'b'.repeat(64)},requested:['content'],transcript:'Words.'}),/reference does not match/);
  assert.equal(calls,0);assert.equal(converted,0);
});
test('new reference descriptors travel with a durable receipt while legacy request bodies stay compatible',async()=>{
  const q=bank.questions.find(q=>q.id==='di-pred-3000411'),wav=Buffer.alloc(100,7);let prepared,body;
  const client=require('../visual-academy-client').createAcademyClient({origin:'https://academy.test',secret:'test',toWav:async()=>({wav}),request:async(url,args)=>{
    body=JSON.parse(args.body);assert(prepared);const {wav:_,...input}=body;assert.equal(prepared.inputHash,hash(input));return{ok:true,json:async()=>({id:body.id,version:body.version,inputHash:hash(input)})};
  }});
  const args={id:'a'.repeat(64),question:q,recording:{hash:'b'.repeat(64)},transcript:'Rainfall peaks in October.',requested:['content'],onPrepared:async r=>{prepared=r;}};
  const receipt=await client.submit(args);assert.deepEqual(body.reference,referenceFor(q));assert.deepEqual(receipt,prepared);
  const legacy=structuredClone(q);delete legacy.imageReference;prepared=null;await client.submit({...args,question:legacy});assert.equal(Object.hasOwn(body,'reference'),false);
  const content=require('../visual-academy-client').contentResult({status:'scored',score:6,max:6,imageReference:referenceFor(q)},null);assert.deepEqual(content.imageReference,referenceFor(q));
});
