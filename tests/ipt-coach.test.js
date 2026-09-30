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


test('IPT coach prioritizes overall performance before trait weakness labels',()=>{
  const prompt=coach.buildPrompt({
    task:'sst',
    message:'Where am I losing scores in SST?',
    studentProfile:{
      areas:[{task:'sst',label:'Summarize Spoken Text',attempts:24,averagePct:84,latestPct:83,recentLowPct:78,recentHighPct:100,performanceBand:'strong',evidenceStrength:'high',trend:'stable'}],
      traitWeaknesses:[{task:'Summarize Spoken Text',taskCode:'sst',trait:'Grammar',attempts:24,averagePct:60,latestPct:50,taskAveragePct:84,taskLatestPct:83,taskPerformanceBand:'strong',taskEvidenceStrength:'high',interpretation:'relative_improvement_area'}]
    }
  });
  assert.match(prompt,/OVERALL TASK PERFORMANCE first/i);
  assert.match(prompt,/relative improvement area/i);
  assert.match(prompt,/must not override a strong overall task pattern/i);
  assert.match(prompt,/Never say the student has "limited data".*5 or more usable attempts/i);
  assert.match(prompt,/"performanceBand":"strong"/);
  assert.match(prompt,/"interpretation":"relative_improvement_area"/);
});


test('IPT coach stops over-prioritising Reading once mocks are sufficient for the stated target',()=>{
  const prompt=coach.buildPrompt({
    task:'portal',
    message:'I only need around 70 and my Reading mocks are usually 72 to 85. What should I focus on now?',
    history:[{role:'user',text:'My target is around 70.'}],
    studentProfile:{
      areas:[
        {task:'dropdown',label:'Reading Blanks (Dropdown)',attempts:10,averagePct:66,latestPct:64,trend:'stable'},
        {task:'swt',label:'Summarize Written Text',attempts:8,averagePct:61,latestPct:58,trend:'declining'}
      ],
      recentMocks:[
        {title:'Reading Mock 4',engine:'reading',percent:78,breakdown:[]},
        {title:'Reading Mock 3',engine:'reading',percent:74,breakdown:[]}
      ]
    }
  });
  assert.match(prompt,/TARGET-AWARE PRIORITY FRAMEWORK/i);
  assert.match(prompt,/consistently meeting or comfortably exceeding the student’s stated target/i);
  assert.match(prompt,/Reading as maintenance/i);
  assert.match(prompt,/Fill in the Blanks and Reorder Paragraphs/i);
  assert.match(prompt,/mock module scores/i);
  assert.match(prompt,/Do not ask for a target score when the student has already stated it/i);
  assert.match(prompt,/not an official Pearson score-conversion claim/i);
});


test('IPT coach resolves Band 6, Band 7, Band 8 and 485 targets from the stored target library',()=>{
  const prompt=coach.buildPrompt({
    task:'portal',
    message:'I am aiming for Band 8 now, but my friend only needs a 485 visa score.',
    history:[]
  });
  assert.match(prompt,/TARGET PROFILE LIBRARY/i);
  assert.match(prompt,/Band 6.*Listening 47.*Reading 48.*Writing 51.*Speaking 54/i);
  assert.match(prompt,/Band 7.*Listening 58.*Reading 59.*Writing 69.*Speaking 76/i);
  assert.match(prompt,/Band 8.*Listening 69.*Reading 70.*Writing 85.*Speaking 88/i);
  assert.match(prompt,/subclass 485.*Overall 55.*Listening 40.*Reading 42.*Writing 41.*Speaking 39/i);
  assert.match(prompt,/never summarise the requirement as "55 overall only"/i);
  assert.match(prompt,/do not invent a score requirement from the visa number alone/i);
});

test('IPT coach keeps portal mock percentages separate from official PTE thresholds',()=>{
  const prompt=coach.buildPrompt({
    task:'portal',
    message:'My Reading mock is 78% and I need Band 8. Have I met Reading?',
    studentProfile:{
      recentMocks:[{title:'Integrated Reading Mock',engine:'reading',percent:78}]
    }
  });
  assert.match(prompt,/Never compare a portal percentage or native-mark total directly to an official PTE 10–90 threshold/i);
  assert.match(prompt,/percent":78/);
  assert.match(prompt,/Band 8.*Reading 70/i);
});
