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
 const html=review.render(m);assert(!html.includes('<script>'));assert(!html.includes('<img'));assert(html.includes('&lt;img'));assert(!html.includes('&lt;script&gt;'));assert(!html.includes('<q>invented'));
});
test('Exact language annotations stay separate from optional style and stale quotes are ignored',()=>{
 const d=data();d.grammar_details.grammar_annotations=[{phrase:'improves',fix:'improve',affects_score:true,rationale:'Plural subject.'},{phrase:'Trees',fix:'Urban trees',affects_score:false,rationale:'Specifies which trees.'},{phrase:'cities and',fix:'elsewhere',affects_score:true},{phrase:'not in answer',fix:'anything',affects_score:true}];
 const m=review.model(d,passage,text);assert.equal(m.annotations.length,3);assert.equal(m.annotations[1].optional,true);
 assert.equal(review.model({...d,score_provisional:true},passage,text).annotations.length,0);
 assert.equal(review.model({...d,ai_feedback_degraded:true},passage,text).repair,'');
});
test('Only checked Content edits and complete sets of required language corrections can be loaded',()=>{
 const d=data();assert.equal(review.model(d,passage,text).repair,'');
 d.content_details.summary_assessment.repair='connect this cause';assert.equal(review.model(d,passage,text).usable,false);
 d.trait_scores.form=0;assert.equal(review.model(d,passage,text).repair,'');
 d.trait_scores.form=1;d.grammar_details.grammar_annotations=[{phrase:'improves',fix:'improve',affects_score:true,rationale:'Plural subject.'}];delete d.content_details.summary_assessment.repair;
 const m=review.model(d,passage,text);assert.equal(m.repair,'');assert.equal(m.usable,false);
 assert.equal(m.languageDraft,'Trees cool cities and improve air quality.');
});

test('A 74-word full Content result keeps optional language edits out of Content and accounts for the word limit',()=>{
 const {document,window}=parseHTML('<div id="review"></div>'),target=document.getElementById('review');
 const d=data(),answer='Parks shade streets and improve air quality, '+Array(67).fill('especially').join(' ')+'.';
 const a=d.content_details.summary_assessment;
 a.repair='…the streets… and …the air quality…';
 a.synthesis={quality:'partial',explanation:'Old synthesis note.'};
 d.grammar_details.grammar_annotations=[
  {phrase:'streets',fix:'the streets',affects_score:false,rationale:'Specifies the streets discussed.'},
  {phrase:'air quality,',fix:'the local air quality,',affects_score:false,rationale:'Limits the scope to one area.'}
 ];
 const before=JSON.stringify(d),m=review.mount(target,d,passage,answer);
 assert.equal(m.wordCount,74);assert.equal(m.annotations.length,1);assert.equal(m.languageDraft,'');
 assert.match(target.querySelector('#swtReviewContent').textContent,/Full Content marks/);
 assert.doesNotMatch(target.querySelector('#swtReviewContent').textContent,/the streets|air quality|Old synthesis note/);
 assert.equal(target.querySelector('[data-review-use]'),null);
 target.querySelector('[data-review-fix]').dispatchEvent(new window.Event('click',{bubbles:true}));
 assert.match(target.querySelector('#swtReviewCorrection').textContent,/the streets.*Specifies the streets discussed.*75 of 75 words after this change alone/);
 assert.doesNotMatch(target.querySelector('#swtReviewLanguage').textContent,/the local air quality/);
 assert.equal(JSON.stringify(d),before);
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

test('A checked SWT edit leads with the source fragment, shows the new word count and keeps the full example optional',()=>{
 const d=data(),answer='Trees cool heavily developed cities and improve air quality.',revised='Trees cool cities and improve air quality.';
 d.trait_scores.content=3;
 const a=d.content_details.summary_assessment;
 a.content_edit={operation:'replace',target:'heavily developed cities',text:'cities',source_evidence:'cool cities',
  advice:'Replace “heavily developed cities” with “cities”.',original_word_count:9,revised_word_count:7,revised};
 a.repair=revised;
 const m=review.model(d,passage,answer),html=review.render(m);
 assert.equal(m.action,a.content_edit.advice);
 assert.match(html,/Keep this part of the passage<\/strong><q>cool cities<\/q>/);
 assert.match(html,/7 of 75 words after the edit · 2 words saved/);
 assert.match(html,/<details class="swt-review-suggestion"><summary>See an example with this edit/);
 assert.equal(m.usable,true);

 const overflow='Trees '+Array(74).fill('cool').join(' ')+' cities.';
 a.content_edit.revised=overflow;
 a.content_edit.revised_word_count=76;
 a.repair=overflow;
 const invalid=review.model(d,passage,answer),invalidHtml=review.render(invalid);
 assert.equal(invalid.repair,'');
 assert.equal(invalid.usable,false);
 assert.doesNotMatch(invalidHtml,/data-review-use|words after the edit|Replace “heavily/);
});

test('The Form panel explains the maximum and how many words an over-limit response needs to cut',()=>{
 const answer=n=>'Trees '+Array(n-2).fill('cool').join(' ')+' cities.';
 assert.match(review.render(review.model(data(),passage,answer(75))),/75 is the maximum\. A shorter summary can earn full marks\./);
 const d=data();d.trait_scores.form=0;
 assert.match(review.render(review.model(d,passage,answer(77))),/Cut at least 2 words\. Start with repeated points or optional examples\./);
});

test('The response review shows the checked correction, exact anchor and reason as plain text', async () => {
  const {document} = parseHTML('<div id="review"></div>');
  const target = document.getElementById('review');
  const result = {corrected:'Trees cool cities and improve air quality.',
    change:'Keep “Trees” and use the plural verb “improve” <img src=x>.', anchor:'Trees cool cities'};
  const pending = review.model({...data(), score_provisional:true}, passage, text);
  await review.mountCorrection(target, pending, {available:true, isCurrent:()=>true, load:async()=>result});
  assert.equal(target.hidden,false);
  assert.equal(target.querySelector('[data-example-corrected]').textContent,result.corrected);
  assert.equal(target.querySelector('q').textContent,result.anchor);
  assert.equal(target.querySelector('[data-example-change]').textContent,result.change);
  assert.equal(target.querySelector('img'),null);
  assert.equal(target.querySelector('[data-review-save]'),null);
});

test('Wording feedback for an unchanged response explains its strength and ignores any extra generated sample', async () => {
  const {document} = parseHTML('<div id="review"></div>');
  const target = document.getElementById('review'), answer = 'Trees cool cities and improve air quality.';
  const m = review.model(data(), passage, answer), extraSample = 'This alternative sentence should never appear.';
  await review.mountCorrection(target, m, {available:true, isCurrent:()=>true, load:async()=>({
    corrected:answer, anchor:'improve air quality', change:'This phrase states the second benefit clearly.', sample:extraSample })});
  assert.match(target.textContent,/What works in your response/);
  assert.match(target.textContent,/improve air quality/);
  assert.match(target.textContent,/second benefit clearly/);
  assert.equal(target.querySelector('[data-example-corrected]'),null);
  assert.equal(target.textContent.includes(extraSample),false);
});

test('A correction cannot overwrite a later answer or reveal coaching from a different passage', async () => {
  const {document} = parseHTML('<div id="review"></div>');
  const target = document.getElementById('review'), m = review.model(data(), passage, text);
  let current = true, finish;
  const request = review.mountCorrection(target, m, {available:true, isCurrent:()=>current, load:()=>new Promise(resolve=>{finish=resolve;})});
  current = false;
  await review.mountCorrection(target, m, {available:false, isCurrent:()=>true, load:()=>assert.fail('Source mismatch')});
  finish({corrected:'Trees cool cities and improve air quality.', change:'Earlier feedback.', anchor:'Trees'});
  await request;
  assert.equal(target.hidden,true);
  assert.equal(target.textContent,'');
});

test('A temporary failure offers retry and the saved edit without relabelling a passage sample', async () => {
  const {document} = parseHTML('<div id="review"></div>');
  const target = document.getElementById('review'), d = data();
  d.grammar_details.grammar_annotations = [{phrase:'improves',fix:'improve',affects_score:true}];
  const m = review.model(d, passage, text);
  const options = {available:true, isCurrent:()=>true, load:async()=>{throw Object.assign(Error(),{status:503});}};
  await review.mountCorrection(target, m, options);
  assert.ok(target.querySelector('[data-example-retry]'));
  assert.ok(target.textContent.includes(m.languageDraft));
  assert.equal(target.querySelector('[data-example-sample]'),null);
  await review.mountCorrection(target, m, {...options, load:async()=>{throw Object.assign(Error(),{status:422});}});
  assert.equal(target.querySelector('[data-example-retry]'),null);
  assert.match(target.textContent,/could not be verified/);
});

test('Post-submission highlights carry the Darwin story and preserve the full source verbatim',()=>{
 const source=require('../passages.json').find(p=>p.title==='Darwin and the Origin of Species');
 const ideas=review.passageIdeas(source);
 const {document}=parseHTML('<main>'+review.highlightedPassage(source)+'</main>');
 const marked=[...document.querySelectorAll('mark')].map(el=>el.textContent);
 assert.equal(document.querySelector('main').textContent,source.text);
 assert.equal(marked.length,6);
 assert.deepEqual(marked,ideas.flatMap(item=>item.phrases));
 assert(marked.includes('observing numerous signs that species were not fixed'));
 assert(marked.includes('still has scientific value more than 150 years after its publication'));
 assert(!marked.some(phrase=>phrase.includes('cuidado')||phrase.includes('copies sold')));
 assert.equal(review.passageIdeas({...source,text:source.text.replace('1859','1860')}).length,0);
});

test('Passage rendering escapes markup and does not highlight incidental matches',()=>{
 const source={text:'<script>bad()</script> Trees cool cities and shade people.',studyGuide:{items:[
  {label:'Main idea',phrases:['Trees cool cities'],idea:'Trees cool cities and shade people.'},
  {label:'Background',phrases:['shade people'],idea:'Trees offer shade on hot days.'}
 ]}};
 const {document}=parseHTML('<main>'+review.highlightedPassage(source)+'</main>');
 assert.equal(document.querySelector('main').textContent,source.text);
 assert.equal(document.querySelector('script'),null);
 assert.deepEqual([...document.querySelectorAll('mark')].map(el=>el.textContent),['Trees cool cities and shade people.']);
});

test('Every bundled SWT passage has revision-matched highlights and plain-English explanations',()=>{
 const {studentPassage}=require('../swt-reference');
 const sources=require('../passages.json').map(studentPassage);
 for(const source of sources){
  const {document}=parseHTML('<main>'+review.highlightedPassage(source)+'</main>');
  const main=document.querySelector('main'), marks=[...main.querySelectorAll('mark')];
  assert.equal(main.textContent,source.text,source.title);
  assert(marks.length>=2,source.title);
  assert(review.passageIdeas(source).every(item=>item.idea&&item.phrases.every(phrase=>source.text.includes(phrase))),source.title);
 }
});

test('A catalogue excerpt is dropped when the saved text does not contain it',()=>{
 const {studentPassage}=require('../swt-reference');
 const source=studentPassage(require('../passages.json')[0]);
 const phrase=review.passageIdeas(source)[0].phrases[0];
 const stale={...source,text:source.text.replace(phrase,'')};
 const {document}=parseHTML('<main>'+review.highlightedPassage(stale)+'</main>');
 assert.equal(document.querySelector('main').textContent,stale.text);
 assert(![...document.querySelectorAll('mark')].some(el=>el.textContent===phrase));
});
