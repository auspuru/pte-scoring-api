const test=require('node:test');
const assert=require('node:assert/strict');
const coach=require('../ipt-coach');

test('IPT coach prompt keeps institute-specific SWT method and scoring boundaries',()=>{
  const prompt=coach.buildPrompt({
    task:'swt',
    message:'How do I choose the important content?',
    history:[{role:'user',text:'I normally copy the first sentence.'}],
    latestScore:{scores:{content:2},maxima:{content:4}}
  });
  assert.match(prompt,/Repeated keywords often reveal the topic/i);
  assert.match(prompt,/What, Why and How/i);
  assert.match(prompt,/synthesize or compress/i);
  assert.match(prompt,/5–75 words/i);
  assert.match(prompt,/Do not impose an artificial 60–65 word target/i);
  assert.match(prompt,/I normally copy the first sentence/);
});

test('IPT coach prompt keeps speaking clarity rules without pretending transcript can assess delivery',()=>{
  const prompt=coach.buildPrompt({task:'speaking',message:'How can I improve my accent?',history:[]});
  assert.match(prompt,/Do not demand a native accent/i);
  assert.match(prompt,/listener can clearly understand/i);
  assert.match(prompt,/transcript text alone cannot prove pronunciation/i);
  assert.match(prompt,/shadowing/i);
});

test('IPT coach keeps only the most recent eight chat messages',()=>{
  const history=Array.from({length:12},(_,i)=>({role:i%2?'assistant':'user',text:'message '+i}));
  const cleaned=coach.cleanHistory(history);
  assert.equal(cleaned.length,8);
  assert.equal(cleaned[0].text,'message 4');
  assert.equal(cleaned.at(-1).text,'message 11');
});


test('IPT coach resolves student references from the current visible screen',()=>{
  const prompt=coach.buildPrompt({
    task:'portal',
    message:'What is wrong with this answer?',
    screenContext:'PAGE TITLE: Repeat Sentence\nVISIBLE STUDENT INPUTS:\nTranscript: renewable energy is becoming cheaper'
  });
  assert.match(prompt,/CURRENT SCREEN CONTEXT:/);
  assert.match(prompt,/Repeat Sentence/);
  assert.match(prompt,/renewable energy is becoming cheaper/);
  assert.match(prompt,/resolve that reference from CURRENT SCREEN CONTEXT/);
  assert.match(prompt,/page-aware study side panel/i);
});
