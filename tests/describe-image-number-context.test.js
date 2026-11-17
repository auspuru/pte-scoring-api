'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const academy=require('../describe-image-academy');
const scoring=require('../speaking-scoring');

const question={type:'di',title:'Sales by country',facts:[
  'Australia has the highest sales at 80 million dollars.',
  'Canada has the lowest sales at 20 million dollars.'
]};

test('Mock and practice requests distinguish bare values from contextual comparisons',()=>{
  for(const text of [
    'The highest number is 80 and the lowest is 20.',
    'Australia leads in sales. Its figure is 80 million dollars.'
  ]){
    const prompts=[academy.request('fake-model',{question,transcript:text}).messages[0].content,scoring.prompt(question,text)];
    for(const prompt of prompts){
      assert(prompt.includes(text),'The full response remains available for contextual interpretation.');
      assert.match(prompt,/Do not borrow an unstated label from the image facts/);
      assert.match(prompt,/Do not use those bare figures as evidence of a developed category comparison/);
      assert.match(prompt,/across sentences and deserves the same credit/);
      assert.match(prompt,/A single unlinked number does not impose an automatic score cap/);
      assert.match(prompt,/Do not classify a correct but unidentified number as a factual contradiction/);
      assert.match(prompt,/non-numerical images/);
      assert.match(prompt,/Never invent a category or unit/);
    }
  }
});
