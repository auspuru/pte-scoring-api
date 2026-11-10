'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {registeredPapers,loadPaper,digest,questionForPlayer,validatePaper}=require('../full-mock/paper'),{hash}=require('../full-mock/audit');
const speaking=require('../content/speaking-mocks'),refs=require('../content/di-reference-manifest.json'),display=require('../di-image-display');
const graph=new Set(['bar','line','pie','mixed']);
function composition(questions,nonGraph='map'){const types=questions.map(q=>refs.entries[q.sourceId||q.id].mapping.category);assert.equal(types.filter(t=>graph.has(t)).length,4);assert.equal(types.filter(t=>t===nonGraph).length,1);}
test('Selectable mocks have four graphs and one source-bound map or diagram, with source-bound clear images',()=>{
 for(const p of speaking.papers){composition(p.questions.filter(q=>q.type==='di'),p.id==='speaking-mock-4'?'process':p.id==='speaking-mock-5'?'diagram':'map');for(const q of p.questions.filter(q=>q.type==='di')){assert(speaking.suppliedMockImage(q));assert(display.forQuestion(q).displayImageUrl);}}
 for(const p of registeredPapers({activeOnly:true})){
  composition(p.questions.filter(c=>c.question.type==='di').map(c=>c.question));
  for(const c of p.questions.filter(c=>c.image)){
   const entry=display.manifest.entries[c.question.sourceId];assert.equal(c.image.sha256,entry.originalSha256);assert.equal(c.displayImage.originalSha256,c.image.sha256);assert.equal(c.displayImage.sha256,entry.displaySha256);
   assert.equal(hash(fs.readFileSync(path.join(__dirname,'..',c.displayImage.path))),entry.displaySha256);assert.equal(questionForPlayer(c).image.id,entry.displaySha256);
  }
 }
});
test('Historical paper digests and original image delivery remain intact; display assets cannot drift',()=>{
 for(const entry of require('../content/full-mock/papers/catalogue.json').papers){const p=loadPaper(entry.id,entry.version);assert.equal(digest(p),entry.sha256);for(const c of p.questions.filter(c=>c.image&&!c.displayImage))assert.equal(questionForPlayer(c).image.id,c.image.sha256);}
 const p=structuredClone(loadPaper());const c=p.questions.find(c=>c.displayImage);c.displayImage.sha256='0'.repeat(64);assert(validatePaper(p).some(s=>/Unpinned asset|display-image-integrity/.test(s)));
});
