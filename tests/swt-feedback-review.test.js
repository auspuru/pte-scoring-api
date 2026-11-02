'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const review=require('../public/swt-feedback-review');
const data=()=>({trait_scores:{content:4,content_max:4,form:1,grammar:2,vocabulary:2},content_details:{full_content_eligible:true,summary_assessment:{relationships_clear:true,missing_dependencies:[],conclusion_status:'captured'}},grammar_details:{grammar_annotations:[]},vocabulary_details:{vocabulary_annotations:[]}});
const text='Trees cool cities and improves air quality.';
const passage={text:'Trees cool cities. They improve air quality.'};
test('Review quotes only real student/source evidence and escapes saved feedback',()=>{
 const d=data();d.trait_scores.content=3;d.content_details.summary_assessment={missing_dependencies:[{effect:'invented words',missing_context:'Invented source',explanation:'<img src=x onerror=bad()>'}],next_step:'<script>bad()</script>',repair:'Fix a selected relationship.'};
 const m=review.model(d,passage,text);assert.equal(m.quote,'');assert.equal(m.sourceQuote,'');
 const html=review.render(m);assert(!html.includes('<script>'));assert(!html.includes('<img'));assert(html.includes('&lt;script&gt;'));assert(!html.includes('<q>invented'));
});
test('Exact language annotations stay separate from optional style and stale quotes are ignored',()=>{
 const d=data();d.grammar_details.grammar_annotations=[{phrase:'improves',fix:'improve',affects_score:true,rationale:'Plural subject.'},{phrase:'Trees',fix:'Urban trees',affects_score:false},{phrase:'cities and',fix:'elsewhere',affects_score:true},{phrase:'not in answer',fix:'anything',affects_score:true}];
 const m=review.model(d,passage,text);assert.equal(m.annotations.length,3);assert.equal(m.annotations[1].optional,true);
 assert.equal(review.model({...d,score_provisional:true},passage,text).annotations.length,0);
 assert.equal(review.model({...d,ai_feedback_degraded:true},passage,text).repair,'');
});
test('Only complete saved repairs can be loaded; form failures and strong answers get no invented repair',()=>{
 const d=data();assert.equal(review.model(d,passage,text).repair,'');
 d.content_details.summary_assessment.repair='connect this cause';assert.equal(review.model(d,passage,text).usable,false);
 d.trait_scores.form=0;assert.equal(review.model(d,passage,text).repair,'');
 d.trait_scores.form=1;d.grammar_details.grammar_annotations=[{phrase:'improves',fix:'improve',affects_score:true,rationale:'Plural subject.'}];delete d.content_details.summary_assessment.repair;
 const m=review.model(d,passage,text);assert.equal(m.repair,'Trees cool cities and improve air quality.');assert.equal(m.usable,true);
});
test('Inline correction, draft undo and stale-account guards preserve the submitted answer',()=>{
 const {document,window}=parseHTML('<div id="annotatedSubmission"></div><div id="review"></div>');
 const target=document.getElementById('review'),original=document.getElementById('annotatedSubmission');original.textContent=text;
 const d=data();d.grammar_details.grammar_annotations=[{phrase:'improves',fix:'improve',affects_score:true,rationale:'Plural subject.'}];let current=true,saved=[];
 review.mount(target,d,passage,text,{isCurrent:()=>current,saveDraft:t=>{saved.push(t);return true;}});
 const click=s=>target.querySelector(s).dispatchEvent(new window.Event('click',{bubbles:true}));
 click('[data-review-fix]');assert.match(target.querySelector('#swtReviewCorrection').textContent,/improves.*improve/);
 click('[data-review-use]');assert.equal(target.querySelector('#swtReviewDraft').value,'Trees cool cities and improve air quality.');
 click('[data-review-undo]');assert.equal(target.querySelector('#swtReviewDraft').value,text);
 click('[data-review-save]');assert.deepEqual(saved,[text]);assert.equal(original.textContent,text);
 current=false;click('[data-review-save]');assert.equal(saved.length,1);
});
test('A pending report never renders repair, language judgement or a revision submit control',()=>{
 const m=review.model({...data(),score_provisional:true},passage,text),html=review.render(m);
 assert(!html.includes('data-review-use'));assert(!html.includes('data-review-edit'));assert(!html.includes('data-review-save'));assert(html.includes('no confirmed learning judgement'));
});


test('Repeated words use their validated word span and ambiguous historical quotes stay unmarked',()=>{
 const text='Trees cool cities and cool rivers.';const d=data();
 d.grammar_details.grammar_annotations=[{phrase:'cool',phrase_span:[5,5],fix:'shade',affects_score:true}];
 assert.equal(review.model(d,passage,text).annotations[0].start,text.lastIndexOf('cool'));
 delete d.grammar_details.grammar_annotations[0].phrase_span;
 assert.equal(review.model(d,passage,text).annotations.length,0);
});
