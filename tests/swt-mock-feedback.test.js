'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const swt=require('../public/swt-mock-feedback');
const answer='Trees cool cities and improves air quality.';
const source='Trees cool cities and improve air quality, but their species need careful selection.';
const raw=()=>({scores:{content:3,form:1,grammar:1,vocabulary:2},maxima:{content:4},summary_assessment:{next_step:'Keep the benefits and add careful species selection.',relationship_explanation:'The recommendation requires a condition.',missing_dependencies:[{effect:'Trees cool cities',missing_context:'their species need careful selection.',explanation:'Keep the planting caution.'}],repair:'Trees cool cities and improve air quality, but their species need careful selection.'},feedback:{content:'The planting caution is missing.'},errors:[{phrase:'improves',correction:'improve',explanation:'Use the plural verb with trees.',affectsScore:true}],strengths:['The benefits are recognised.'],apiKey:'SECRET',provider:{credentials:'SECRET'}});
test('Submitted SWT projection keeps only teaching evidence and never mutates marks',()=>{
 const input=raw(),before=JSON.stringify(input),v=swt.project(input,{confirmed:true,answer,source});
 assert.equal(v.content.quote,'Trees cool cities');assert.equal(v.content.sourceQuote,'their species need careful selection.');assert.equal(v.language[0].required,true);assert.equal(v.form.valid,true);
 assert(!JSON.stringify(v).includes('SECRET'));assert.equal(JSON.stringify(input),before);assert(!Object.hasOwn(v,'scores'));assert(!Object.hasOwn(v,'provider'));
});
test('Unconfirmed, provisional and local feedback stays pending without invented weakness',()=>{
 for(const input of [{...raw(),score_provisional:true},{...raw(),needs_semantic_review:true},{...raw(),scoringMode:'local'}])assert.deepEqual(swt.project(input,{confirmed:true,answer,source}),{version:1,status:'pending'});
 assert.deepEqual(swt.project(raw(),{confirmed:false,answer,source}),{version:1,status:'pending'});
});
test('Historical quotes are verified and only marked corrections appear',()=>{
 const input=raw();input.summary_assessment.missing_dependencies[0].effect='invented learner quote';input.summary_assessment.missing_dependencies[0].missing_context='invented source quote';input.errors.push({phrase:'Trees',correction:'Urban trees',affectsScore:false});input.errors.push({phrase:'cities',correction:'urban areas'});
 const v=swt.project(input,{confirmed:true,answer,source});assert.equal(v.content.quote,'');assert.equal(v.content.sourceQuote,'');assert.equal(v.language.length,1);assert.equal(v.language[0].required,true);
});
test('Saved deletions remain actionable while missing replacements are excluded',()=>{
 const response='Trees cool cities and improve air quality, actually.';
 const input=raw();input.errors=[{phrase:', actually',correction:'',explanation:'Remove the unnecessary aside.',affectsScore:true},{phrase:'Trees',explanation:'No replacement was saved.'}];
 const before=JSON.stringify(input),v=swt.project(input,{confirmed:true,answer:response,source});
 assert.equal(v.language.length,1);assert.equal(v.language[0].fix,'');assert.equal(v.language[0].reason,'Remove the unnecessary aside.');
 const html=swt.render(v,response,'deletion');assert.match(html,/, actually → Delete this text/);assert.match(html,/Remove the unnecessary aside/);assert.match(html,/data-swt-mock-fix="0"/);assert(!html.includes('No exact language correction'));assert.equal(JSON.stringify(input),before);
});
test('Read-only report renderer escapes content and exposes no edit or submission controls',()=>{
 const input=raw();input.summary_assessment.missing_dependencies[0].explanation='<script>bad()</script>';
 input.summary_assessment.repair='…supply the entire legacy repair…';
 const html=swt.render(swt.project(input,{confirmed:true,answer,source}),answer,'fixture');
 assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>'));assert(!/<(?:input|textarea|select|form)\b/.test(html));assert(!/data-review-save|data-review-use|data-reattempt/.test(html));assert(html.includes('data-swt-mock-fix'));assert(html.includes('Grammar & vocabulary'));assert(html.includes('Form'));
 assert.doesNotMatch(html,/A possible repair|entire legacy repair/);
});
test('A content gate preserves diagnostic form; a flattened old gate does not invent form failure',()=>{
 const input={...raw(),gated:true,scores:{content:0,form:0},diagnosticScores:{content:0,form:1}};
 const v=swt.project(input,{confirmed:true,answer,source});assert.equal(v.form.valid,true);assert.equal(v.language.length,0);delete input.diagnosticScores;assert.equal(swt.project(input,{confirmed:true,answer,source}).form.valid,null);
});

test('Mock reports use the same source fragment and budget for a short verified edit',()=>{
 const input=raw(),submitted='Trees cool heavily developed cities and improve air quality.',revised='Trees cool cities and improve air quality.';
 const a=input.summary_assessment;
 a.content_edit={operation:'replace',target:'heavily developed cities',text:'cities',source_evidence:'cool cities',
  advice:'Replace “heavily developed cities” with “cities”.',original_word_count:9,revised_word_count:7,revised};
 a.repair=revised;
 const v=swt.project(input,{confirmed:true,answer:submitted,source});
 assert.equal(v.content.action,a.content_edit.advice);
 const html=swt.render(v,submitted);
 assert.match(html,/Keep this part of the passage<\/strong><q>cool cities<\/q>/);
 assert.match(html,/7 of 75 words after the edit · 2 words saved/);
 assert.match(html,/<details class="swt-mock-repair"><summary>See an example with this edit/);
 assert.doesNotMatch(html,/data-review-use|data-review-save/);

 const stale=swt.project(input,{confirmed:true,answer:submitted,source:'Plants can improve air quality.'});
 assert.equal(stale.content.repair,'');
 assert.doesNotMatch(swt.render(stale,submitted),/Keep this part|words after the edit|Replace “heavily/);
});

test('The mock Form panel gives word-budget guidance for full-length and over-limit responses',()=>{
 const saved={version:1,status:'complete',form:{valid:true}};
 const answer=n=>'Trees '+Array(n-2).fill('cool').join(' ')+' cities.';
 assert.match(swt.render(saved,answer(75)),/75 is the maximum\. A shorter summary can earn full marks\./);
 assert.match(swt.render({...saved,form:{valid:false}},answer(76)),/Cut at least 1 word\. Start with repeated points or optional examples\./);
});

test('Full Content omits optional wording in earlier saved mock feedback',()=>{
 const response='Trees cool cities and improve air quality, '+Array(67).fill('sometimes').join(' ')+'.';
 const input=raw();input.scores.content=4;
 input.errors=[
  {phrase:'cities',correction:'the cities',explanation:'Specifies which cities.',affectsScore:false},
  {phrase:'air quality,',correction:'the local air quality,',explanation:'Specifies where air improves.',affectsScore:false}
 ];
 const before=JSON.stringify(input),value=swt.project(input,{confirmed:true,answer:response,source});
 assert.equal(value.content.full,true);assert.equal(value.content.repair,'');assert.equal(value.content.action,'');
 const html=swt.render(value,response);
 assert.match(html,/Full Content marks/);assert.doesNotMatch(html,/planting caution|the local air quality|A possible repair/);
 assert.doesNotMatch(html,/Optional refinement|Specifies which cities/);
 assert.equal(JSON.stringify(input),before);
});

test('Current SWT mock feedback shows only verified corrections that cost marks',()=>{
 const input={...raw(),version:'20.3.18'};
 input.errors.push(
  {phrase:'Trees',correction:'Urban trees',explanation:'Give more detail.',affectsScore:false},
  {phrase:'cities',correction:'urban areas',explanation:'Try a synonym.'}
 );
 const v=swt.project(input,{confirmed:true,answer,source});
 assert.equal(v.language.length,1);
 const html=swt.render(v,answer);
 assert.match(html,/Grammar & vocabulary/);
 assert.match(html,/improves → improve/);
 assert.match(html,/Use the plural verb with trees\./);
 assert.doesNotMatch(html,/Urban trees|urban areas|Optional refinement/);
});

test('Submitted SWT review puts the complete passage, marks, three answers, and corrections in reading order',()=>{
 const {parseHTML}=require('linkedom'),traits=require('../public/swt-trait-review');
 const original='Trees cool cities and improves air quality.';
 const passage='First paragraph.\n\nSecond paragraph <kept>.';
 const input={...raw(),scores:{content:4,form:1,grammar:1,vocabulary:2},version:'20.3.18'};
 const feedback=swt.project(input,{confirmed:true,answer:original,source:passage});
 const sample='Street trees can cool cities and improve air quality.';
 const scoreHtml=traits.render({key:'test',scores:input.scores,maxima:{content:4,form:1,grammar:2,vocabulary:2},details:{}});
 const {document}=parseHTML(swt.render(feedback,original,'test',{passage,sample,traits:scoreHtml}));
 const layout=document.querySelector('.swt-submitted-review');
 assert.equal(layout.children[0].querySelector('.swt-submitted-text').textContent,passage);
 assert.match(layout.children[1].textContent,/Total/);
 const cards=layout.children[2].querySelectorAll('.swt-submitted-card');
 assert.equal(cards.length,3);
 assert.equal(cards[0].querySelector('.swt-submitted-text').textContent,original);
 assert.match(cards[1].textContent,/Saved grammar and vocabulary corrections only/);
 assert.equal(cards[1].querySelector('.swt-submitted-text').textContent,'Trees cool cities and improve air quality.');
 assert.equal(cards[2].querySelector('.swt-submitted-text').textContent,sample);
 assert.equal(layout.children[3].querySelectorAll('[data-swt-mock-correction]').length,1);
});

test('Repeated error spans are highlighted independently and an unresolved match never creates a corrected summary',()=>{
 const response='Trees does cool streets and trees does clean air.';
 const errors=[
  {phrase:'does',correction:'do',phraseSpan:[2,2],trait:'grammar',affectsScore:true,explanation:'Trees means more than one.'},
  {phrase:'does',correction:'do',phraseSpan:[7,7],trait:'grammar',affectsScore:true,explanation:'Use do with more than one tree.'}
 ];
 const input={...raw(),errors};
 const options={confirmed:true,answer:response,source};
 let html=swt.render(swt.project(input,options),response,'positions',{passage:source});
 assert.equal((html.match(/data-swt-mock-fix=/g)||[]).length,2);
 assert.match(html,/Trees do cool streets and trees do clean air\./);
 delete errors[1].phraseSpan;
 html=swt.render(swt.project(input,options),response,'unverified',{passage:source});
 assert.equal((html.match(/data-swt-mock-correction=/g)||[]).length,2);
 assert.match(html,/No checked revision is available/);
});
