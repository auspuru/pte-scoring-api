'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const express=require('express'),{randomUUID}=require('node:crypto');
const scoring=require('../writing-lab-scoring'),{installWritingLab}=require('../writing-lab');
const {POLICY_VERSION}=require('../swt-scoring-policy');
const fixture=require('./swt-meaning-fixtures.json')[1];
const q={type:'swt',text:fixture.passage,keyPoints:['main idea']};
function judgment(quality='effective'){
 const a=structuredClone(fixture.assessment);
 a.synthesis={quality,evidence:quality==='effective'?'':a.main_idea_evidence,explanation:'The selected ideas are connected; the expression can be condensed.'};
 return {content_score:4,grammar_score:2,vocabulary_score:2,cohesion:'strong',summary_assessment:a,grammar_annotations:[],vocabulary_annotations:[],consistency_reviewed:true};
}
test('The mock adapter preserves the shared Content judgment and independent language traits',async()=>{
 for(const [quality,content] of [['effective',4],['partial',3],['limited',2]]){
  const result=await scoring.gradeUnifiedSwt(q,fixture.summary,async(question,text)=>{assert.equal(question,q);assert.equal(text,fixture.summary);return judgment(quality);});
  assert.equal(result.version,POLICY_VERSION);assert.equal(result.scores.content,content);
  assert.equal(result.scores.grammar,2);assert.equal(result.scores.vocabulary,2);
  assert.equal(result.total,content+5);assert.equal(result.maximum,9);
  assert.equal(result.score_provisional,false);assert.equal(result.consistency_reviewed,true);
  assert.equal(result.full_content_eligible,quality==='effective');
 }
});
test('Invalid form bypasses the grader, while an unreviewed primary stays provisional',async()=>{
 const zero=await scoring.gradeUnifiedSwt(q,'',()=>{throw Error('Must not call');});
 assert.equal(zero.total,0);assert.equal(zero.gated,true);
 const result=await scoring.gradeUnifiedSwt(q,fixture.summary,async()=>({...judgment(),consistency_reviewed:false}));
 assert.equal(result.score_provisional,true);assert.equal(result.scoringMode,'local');assert.equal(result.full_content_eligible,false);
});
test('Writing Mock SWT submissions share the standalone grader and persist one confirmed result',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'writing-shared-swt-'));
 const app=express();app.use(express.json());let calls=0;
 const {store}=installWritingLab(app,{directory:dir,verifyToken:token=>token==='tester'?'tester':null,getAccount:async()=>({}),
  callModel:async()=>{throw Error('The generic mock scorer must not grade SWT');},
  swtGrader:async(question,text)=>{calls++;assert.equal(question.text,q.text);assert.equal(text,fixture.summary);await Promise.resolve();return judgment('partial');}});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port+'/api/writing-lab';
 const headers={'Content-Type':'application/json','x-session-token':'tester'},id=randomUUID();
 let response=await fetch(base+'/attempts',{method:'POST',headers,body:JSON.stringify({id,testId:'writing-mock-1'})});assert.equal(response.status,200);
 await store.update('tester',id,a=>{a.status='submitted';a.questions[0]={...a.questions[0],...q};a.completed[0]=Date.now();a.answers[0]=fixture.summary;return a;});
 const results=await Promise.all([1,2].map(async()=>{const r=await fetch(base+'/attempts/'+id+'/score/0',{method:'POST',headers,body:'{}'});assert.equal(r.status,200);return r.json();}));
 assert.equal(calls,1);assert.deepEqual(results[0],results[1]);
 assert.equal(results[0].assessmentType,'Unified SWT practice assessment');assert.equal(results[0].version,POLICY_VERSION);
 assert.equal(results[0].scores.content,3);assert.equal(results[0].score_provisional,false);
 const again=await fetch(base+'/attempts/'+id+'/score/0',{method:'POST',headers,body:'{}'});assert.equal(again.status,200);assert.equal(calls,1);
 await store.update('tester',id,a=>{a.results[0]={score_provisional:true,needs_semantic_review:true,scoringMode:'local',scores:{content:0},total:0};return a;});
 const retry=await fetch(base+'/attempts/'+id+'/score/0',{method:'POST',headers,body:'{}'});assert.equal(retry.status,200);
 const repaired=await retry.json();assert.equal(calls,2);assert.equal(repaired.score_provisional,false);assert.equal(repaired.scores.content,3);
});
