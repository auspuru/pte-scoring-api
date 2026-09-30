'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createLearningStore,questionTopics}=require('../assistant-learning');
const {buildPrompt}=require('../ipt-coach');
const profile=now=>({areas:[{task:'swt',attempts:5,lastAt:now,averagePct:60,latestPct:65,trend:'improving',practiceAttempts:3,mockAttempts:2}],traitWeaknesses:[{taskCode:'swt',trait:'Content',lastAt:now,attempts:5,belowBenchmarkAttempts:3,averagePct:50}]});
test('Learning snapshots deduplicate users and questions, persist without raw student content and expire',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'learning-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));let now=Date.now();const store=createLearningStore(null,directory,{clock:()=>now});
 await Promise.all(Array.from({length:6},()=>store.observe('alice@example.com',profile(now),{task:'swt',message:'Which main idea should I include? Private raw text.'})));
 let s=await store.summary();assert.equal(s.observedStudents,1);assert.equal(s.topics[0].students,1);assert.equal(s.topics[0].studentDays,1);assert.equal(s.areas[0].practiceAttempts,3);assert.equal(s.mistakes[0].students,1);assert.equal((await store.context('swt')).patterns.length,0);
 for(const uid of ['bob','charlie'])await store.observe(uid,profile(now),{task:'swt',message:'I need help with content'});
 assert.equal((await store.context('swt')).patterns[0].students,3);
 const file=await fs.readFile(path.join(directory,'assistant-learning.json'),'utf8');assert(!file.includes('alice@example.com'));assert(!file.includes('Private raw text'));
 const restarted=createLearningStore(null,directory,{clock:()=>now});assert.equal((await restarted.summary()).observedStudents,3);
 now+=91*86400000;assert.equal((await restarted.summary()).observedStudents,0);assert.equal((await restarted.context('swt')).patterns.length,0);
});
test('Teaching guidance is task scoped, editable and disabled guidance leaves the prompt context',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'learning-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const store=createLearningStore(null,directory);
 const row=await store.saveGuidance({task:'swt',title:'Content selection',advice:'Pick the main topic and linked support.'});assert.equal((await store.context('sst')).teacherGuidance.length,0);assert.equal((await store.context('swt')).teacherGuidance.length,1);
 await store.saveGuidance({...row,enabled:false});assert.equal((await store.context('swt')).teacherGuidance.length,0);assert.equal((await store.summary()).guidance.length,1);
 await assert.rejects(store.saveGuidance({task:'unknown',title:'x',advice:'x'}),/supported task/);
 const prompt=buildPrompt({task:'swt',message:'What should I improve?',cohortLearning:{patterns:[{trait:'Content',students:4}],teacherGuidance:[{advice:'Pick main topic'}]}});assert.match(prompt,/Pick main topic/);assert.match(prompt,/not diagnoses of this student/);assert.match(prompt,/Never infer pronunciation or fluency from text/);
 assert(questionTopics('I pause too often').some(t=>t.id==='fluency'));
});
test('A single lower score, stale task or strong recent trait cannot create a recurring mistake',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'learning-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const store=createLearningStore(null,directory),p=profile(Date.now());p.traitWeaknesses[0].belowBenchmarkAttempts=1;
 await store.observe('alice',p);assert.equal((await store.summary()).mistakes.length,0);
 p.areas[0].lastAt=Date.now()-91*86400000;p.traitWeaknesses[0].belowBenchmarkAttempts=3;await store.observe('alice',p);assert.equal((await store.summary()).areas.length,0);assert.equal((await store.summary()).mistakes.length,0);
});

test('Recurring content and omission patterns use distinct scored attempts and skip fallback speculation',()=>{
 const {feedbackPatterns}=require('../assistant-learning'),now=Date.now();
 const a={id:'1',questionId:'rts-1',status:'submitted',startedAt:new Date(now).toISOString(),result:{scoringMode:'ai',coverage:[{status:'missing'}]}};
 assert.equal(feedbackPatterns([a,a],now).length,0);
 assert.deepEqual(feedbackPatterns([a,{...a,id:'2'}],now),[{task:'rts',label:'Required situation points missing or incomplete',attempts:2}]);
 assert.equal(feedbackPatterns([a,{...a,id:'2',result:{...a.result,scoringMode:'local'}}],now).length,0);
});
