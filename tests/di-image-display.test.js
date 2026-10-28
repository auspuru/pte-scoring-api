'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const display=require('../di-image-display'),bank=require('../content/speaking-bank'),mock=require('../content/speaking-mocks');
test('every supplied original and all mock placements have a verified matching clear display file',()=>{
  assert.deepEqual(require('../scripts/verify-di-display').verify(),{images:49,mockPlacements:15,version:'di-display-2026-10-28.1'});
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
  const source=id=>fs.readFileSync(__dirname+'/../public'+display.manifest.entries['di-pred-'+id].displayImageUrl,'utf8');
  const rainfall=source('3000186');for(const value of ['New York','Dallas','Phoenix','Honolulu','47.25','33.7','7.66','22.02'])assert(rainfall.includes(value));
  const table=source('3000422');for(const n of [385543,67,574129,65,49,572509,886052,55])assert(table.includes('data-value="'+n+'"'));
  for(const id of ['3000375','3000586','3000422'])assert(source(id).includes('data-source-sha256="'+display.manifest.entries['di-pred-'+id].originalSha256+'"'));
});
