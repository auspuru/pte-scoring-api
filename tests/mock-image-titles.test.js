'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const bank=require('../content/speaking-mocks'),{loadPaper,questionForPlayer}=require('../full-mock/paper');
const {renderQuestion}=require('../public/full-mock-client'),images=require('../public/speaking-images');
test('All 15 Speaking mock image titles reach the player without revealing reference answers',()=>{
 let count=0;
 for(const paper of bank.papers)for(const q of paper.questions){
  const before=JSON.stringify(q),shown=bank.publicQuestion(q);
  if(q.type==='di'){
   count++;assert.equal(typeof q.title,'string');assert(q.title.trim());assert.equal(shown.title,q.title);
   assert(images.image(shown).includes('alt="'+q.title.replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'"'));
  }else assert.equal(shown.title,undefined);
  for(const key of ['sample','facts','reference'])assert.equal(shown[key],undefined);
  assert.equal(JSON.stringify(q),before);
 }
 assert.equal(count,15);
});
test('Current and retained Full Mock image titles appear above their original images',()=>{
 for(const version of [1,2]){
  const paper=loadPaper('full-mock-1',version),before=JSON.stringify(paper);
  const visual=paper.questions.filter(c=>c.question.type==='di');assert.equal(visual.length,5);
  for(const candidate of visual){
   const q=questionForPlayer(candidate);assert(q.title.trim());assert.equal(q.title,candidate.question.title);
   const html=renderQuestion(q);assert(html.includes('class="fm-image-title"'));assert(html.indexOf('fm-image-title')<html.indexOf('id="fm-image"'));
   for(const key of ['sample','facts','answer','reference'])assert.equal(q[key],undefined);
  }
  assert.equal(JSON.stringify(paper),before);
 }
});
test('Image captions escape supplied titles and do not invent a title for unknown legacy images',()=>{
 const title='<img src=x onerror="bad()"> & chart',q={type:'di',title,image:{id:'image'}};
 const html=renderQuestion(q);assert(html.includes('&lt;img'));assert(!html.includes('<img src=x'));assert(html.includes('&amp; chart'));
 assert(!renderQuestion({...q,title:''}).includes('fm-image-title'));
 assert.equal(bank.publicQuestion({type:'di',visual:{title:'Retained image title'}}).title,'Retained image title');
});
