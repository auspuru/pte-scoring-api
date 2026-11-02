'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.js'), 'utf8');

test('audited essay prompts use question types that match their literal requirements', () => {
  assert.match(source, /title: "Parental Legal Responsibility"[\s\S]{0,500}?type: "opinion"/);
  assert.match(source, /title: "Maximum Wage for High-Paying Jobs"[\s\S]{0,500}?type: "opinion"/);
  assert.match(source, /title: "Laws and Human Behaviour"[\s\S]{0,500}?type: "opinion"/);
  assert.match(source, /title: "The Value of Humanities"[\s\S]{0,500}?type: "opinion"/);
  assert.match(source, /title: "Communication Methods in Modern Society"[\s\S]{0,500}?type: "advantages_disadvantages"/);
  assert.match(source, /title: "Youth Unemployment and Shorter Working Week"[\s\S]{0,600}?type: "advantages_disadvantages_scope"/);
});

test('advantages/disadvantages opinion guidance permits a balanced answer when the prompt permits it', () => {
  assert.doesNotMatch(source, /The conclusion must pick a winner/);
  assert.match(source, /A balanced conclusion is valid when the prompt allows it/);
});

test('Age Restrictions guidance requires one developed activity, minimum age and experience', () => {
  assert.match(source, /Choose ONE activity affected by an age restriction/);
  assert.match(source, /One well-developed example is enough/);
});

test('climate-study guidance does not invent a solutions requirement', () => {
  assert.doesNotMatch(source, /Give concrete examples and practical solutions for YOUR area only/);
  assert.match(source, /Do not invent a requirement to propose solutions/);
  assert.doesNotMatch(source, /examples\/solutions/);
  assert.match(source, /Examples &amp; research angles/);
});

test('the question explainer uses reviewed task roles even when the detected type is generic opinion',()=>{
  const data=require('../public/essay-guidance-data'),guide=require('../public/essay-guidance');
  const start=source.indexOf('const TYPE_EXPLANATIONS ='),end=source.indexOf('// ============================================================\n//  UNIVERSAL ESSAY STATE',start);
  assert(start>=0&&end>start);
  const context={window:{EssayGuide:guide},QUESTION_TYPES:{opinion:{}},escapeHtml:text=>String(text)};
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  const q=data.guides.find(q=>q.n===1),html=context.buildQuestionExplanationHtml({question:q.prompt},'opinion');
  assert.match(html,/Explain your opinion on mark deductions/);
  assert.match(html,/Suggest alternative actions and explain how they work/);
  assert.match(html,/A tiered deduction modifies a penalty/);
  const balance=data.guides.find(q=>q.n===27);
  assert.match(context.buildQuestionExplanationHtml({question:balance.prompt},'opinion'),/Explain why balance is difficult to achieve/);
  assert.doesNotMatch(source,/Forgetting the alternatives loses half the marks/);
});
