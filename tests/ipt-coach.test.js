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


test('IPT coach uses saved student performance without asking for known portal facts',()=>{
  const prompt=coach.buildPrompt({
    task:'portal',
    message:'Where are my marks slipping?',
    studentProfile:{
      weakestAreas:[{task:'swt',label:'Summarize Written Text',attempts:4,averagePct:58,latestPct:55,trend:'declining'}],
      recentMocks:[{title:'Writing Mock 2',engine:'writing',percent:63,breakdown:[{task:'Essay Writing',percent:72},{task:'Summarize Written Text',percent:49}]}],
      unfinished:[{kind:'Essay draft',title:'Communication Methods in Modern Society'}]
    }
  });
  assert.match(prompt,/STUDENT PERFORMANCE PROFILE/i);
  assert.match(prompt,/Summarize Written Text/);
  assert.match(prompt,/Writing Mock 2/);
  assert.match(prompt,/Communication Methods in Modern Society/);
  assert.match(prompt,/Do not ask the student which task/i);
  assert.match(prompt,/distinguish practice from mock performance/i);
});


test('IPT coach keeps SST separate from Retell Lecture and speaking delivery',()=>{
  const prompt=coach.buildPrompt({
    task:'sst',
    message:'How can I improve my Summarize Spoken Text?',
    studentProfile:{areas:[{task:'sst',label:'Summarize Spoken Text',attempts:3,averagePct:68}]}
  });
  assert.match(prompt,/MODALITY: Listening \+ Writing/i);
  assert.match(prompt,/TYPES a written summary/i);
  assert.match(prompt,/50–70 word written summary/i);
  assert.match(prompt,/Never describe SST as a speaking task/i);
  assert.match(prompt,/Retell Lecture is a different task/i);
  assert.match(prompt,/final response is spoken/i);
});
