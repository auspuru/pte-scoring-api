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
test('Historical quotes are verified; optional and unclassified suggestions stay distinct',()=>{
 const input=raw();input.summary_assessment.missing_dependencies[0].effect='invented learner quote';input.summary_assessment.missing_dependencies[0].missing_context='invented source quote';input.errors.push({phrase:'Trees',correction:'Urban trees',affectsScore:false});input.errors.push({phrase:'cities',correction:'urban areas'});
 const v=swt.project(input,{confirmed:true,answer,source});assert.equal(v.content.quote,'');assert.equal(v.content.sourceQuote,'');assert.equal(v.language[1].optional,true);assert.equal(v.language[2].optional,false);assert.equal(v.language[2].required,false);
});
test('Read-only report renderer escapes content and exposes no edit or submission controls',()=>{
 const input=raw();input.summary_assessment.repair='<script>bad()</script>';const html=swt.render(swt.project(input,{confirmed:true,answer,source}),answer,'fixture');
 assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>'));assert(!/<(?:input|textarea|select|form)\b/.test(html));assert(!/data-review-save|data-review-use|data-reattempt/.test(html));assert(html.includes('data-swt-mock-fix'));assert(html.includes('Grammar & spelling'));assert(html.includes('Form'));
});
test('A content gate preserves diagnostic form; a flattened old gate does not invent form failure',()=>{
 const input={...raw(),gated:true,scores:{content:0,form:0},diagnosticScores:{content:0,form:1}};
 const v=swt.project(input,{confirmed:true,answer,source});assert.equal(v.form.valid,true);assert.equal(v.language.length,0);delete input.diagnosticScores;assert.equal(swt.project(input,{confirmed:true,answer,source}).form.valid,null);
});
