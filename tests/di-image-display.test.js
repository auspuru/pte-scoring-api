'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const display=require('../di-image-display'),bank=require('../content/speaking-bank'),mock=require('../content/speaking-mocks');
test('every supplied original and all mock placements have a verified matching clear display file',()=>{
  assert.deepEqual(require('../scripts/verify-di-display').verify(),{images:115,mockPlacements:25,version:'di-display-2026-10-28.1'});
});
test('display variants do not alter saved questions, scorer references or answers shown before submission',()=>{
  for(const q of bank.questions.filter(q=>q.type==='di'&&q.imageUrl)){
    const before=JSON.stringify(q),shown=mock.publicQuestion(q),practice=require('../speaking-lab').question(q);
    assert.equal(shown.imageUrl,q.imageUrl);assert.equal(practice.imageUrl,q.imageUrl);assert(shown.displayImageUrl);assert.equal(shown.displayImageUrl,practice.displayImageUrl);
    assert.equal(shown.facts,undefined);assert.equal(shown.sample,undefined);assert.equal(JSON.stringify(q),before);
    assert.equal(require('../di-reference').referenceFor(q).source.sha256,display.manifest.entries[q.id].originalSha256);
  }
});
test('new and historical source guards fall back to the saved original instead of a mismatched clear file',()=>{
  const q=structuredClone(bank.questions.find(q=>q.id==='di-pred-3000411')),expected=display.forQuestion(q);
  delete q.imageReference;assert.deepEqual(display.forQuestion(q),expected);
  assert.deepEqual(display.forQuestion({...q,imageUrl:'/another.png'}),{});
  assert.deepEqual(display.forQuestion({...q,imageReference:{source:{kind:'image-sha256',sha256:'changed'}}}),{});
  assert.deepEqual(display.forQuestion({...q,id:'unknown'}),{});assert.deepEqual(display.forQuestion({...q,type:'rs'}),{});
  expected.imageLegend.push(['Mutated','#000000']);assert.deepEqual(display.forQuestion(q).imageLegend,[]);
});
test('verified chart renditions retain exact labels and values from the supplied originals',()=>{
  const historical=require('../content/di-display-history-20261117.json');
  const source=id=>fs.readFileSync(__dirname+'/../public'+historical.entries['di-pred-'+id].displayImageUrl,'utf8');
  const rainfall=source('3000186');for(const value of ['New York','Dallas','Phoenix','Honolulu','47.25','33.7','7.66','22.02'])assert(rainfall.includes(value));
  const table=source('3000422');for(const n of [385543,67,574129,65,49,572509,886052,55])assert(table.includes('data-value="'+n+'"'));
  for(const id of ['3000375','3000586','3000422'])assert(source(id).includes('data-source-sha256="'+display.manifest.entries['di-pred-'+id].originalSha256+'"'));
});

test('reviewed PNG displays retain exact original-source bindings and immutable history',()=>{
  const crypto=require('node:crypto'),history=require('../content/di-display-history-20261117.json');
  const review=require('../docs/di-enhanced-display-review-20261117.json');
  for(const row of review.records){
    const e=display.manifest.entries[row.questionId],old=history.entries[row.questionId];
    assert.equal(e.originalSha256,old.originalSha256);assert.equal(e.originalImageUrl,old.originalImageUrl);
    assert(fs.existsSync(__dirname+'/../public'+old.displayImageUrl));
    if(row.decision!=='approved-display'){assert.deepEqual(e,old);continue;}
    const bytes=fs.readFileSync(__dirname+'/../public'+e.displayImageUrl);
    assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),row.candidateSha256);
    assert.equal(e.enhancementReview.sourceSha256,row.originalSha256);
    assert.deepEqual([bytes.readUInt32BE(16),bytes.readUInt32BE(20)],e.displayDimensions);
  }
});
