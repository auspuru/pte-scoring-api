'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const inventory=require('../content/retell-nov23-screenshot-review.json');
test('retell source has 61 screenshots and 58 distinct questions',()=>{
 assert.equal(inventory.imageCaptureCount,61);
 assert.equal(inventory.uniqueQuestionCount,58);
 assert.equal(inventory.captures.length,61);
 assert.equal(inventory.questions.length,58);
});
test('duplicate source IDs are isolated before import',()=>{
 const keys=new Set();
 for(const q of inventory.questions){
  assert.equal(Number.isSafeInteger(q.sourceQuestionNumber),true);
  assert.equal(typeof q.title,'string');
  const key=q.sourceQuestionNumber+':'+q.title.toLowerCase();
  assert.equal(keys.has(key),false);
  keys.add(key);
 }
 assert.equal(inventory.captures.filter(x=>x.disposition==='duplicate_capture').length,3);
});
test('review data cannot be mistaken for playable Retell Lecture questions',()=>{
 assert.equal(inventory.publicationStatus,'REVIEW_ONLY_NOT_IMPORTED');
 for(const q of inventory.questions){
  assert.equal(q.originalAudio,'missing_from_screenshot_archive');
  assert.equal(q.transcriptStatus.includes('not yet proofread'),true);
  assert.equal(q.historicalReportCount,null);
  assert.equal(Object.hasOwn(q,'audio'),false);
  assert.equal(Object.hasOwn(q,'sample'),false);
 }
});
test('candidate classifications stay conservative',()=>{
 const total=inventory.countsByStatus;
 assert.equal(total.new_candidate_unverified,36);
 assert.equal(total.possible_existing_question,21);
 assert.equal(total.manual_semantic_duplicate_review,1);
});
