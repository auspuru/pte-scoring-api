'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const {render}=require('../public/swt-trait-review');
const maxima={content:4,form:1,grammar:2,vocabulary:2};
const scores={content:3,form:1,grammar:1,vocabulary:2};
test('SWT trait tiles preserve exact marks, use the awarded total and escape saved explanations',()=>{
 const {document}=parseHTML(render({scores,maxima,total:6,details:{grammar:'<script>bad()</script>'}}));
 assert.equal(document.querySelectorAll('details').length,4);
 assert.equal(document.querySelector('script'),null);
 assert.match(document.body?.textContent||document.toString(),/1 point to gain/);
 assert.equal(document.querySelector('.total .swt-trait-value').textContent,'6 / 9');
 assert.match(document.querySelectorAll('details')[2].textContent,/<script>bad\(\)<\/script>/);
});
test('Pending results show no invented score and item gates avoid diagnosing every trait',()=>{
 assert.doesNotMatch(render({scores,maxima,pending:true}),/3 \/ 4|7 \/ 9/);
 assert.match(render({scores,maxima,gated:true}),/Item rule applied/);
 assert.doesNotMatch(render({scores,maxima,gated:true}),/point to gain/);
});
