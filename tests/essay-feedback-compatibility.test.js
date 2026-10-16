'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),express=require('express');
const P=require('../public/essay-scoring'),{createEssayGrader,essayResultForClient}=require('../essay-grading'),{createEssayGradeHandler}=require('../essay-feedback-handler');
const example=require('../public/essay-feedback-preview.json').examples.find(x=>x.id==='reasons_or_experience').assessment;
function completed(){return {...structuredClone(example),sampleStatus:'not-requested',sampleKind:'not-requested',sampleResponse:'',sampleSourceIdeas:[],sampleWordCount:0,sampleBand:'9',sampleNote:'Request an optional learning sample when you need one.'};}

// The pre-rollout validator accepts these three statuses, while its rubric
// VERSION is the same as today's. A version header alone cannot distinguish it.
function cachedClient(raw,essay){
 if(!['ready','needs-ideas','unavailable'].includes(raw.sampleStatus))throw Object.assign(Error('Unsupported sample status'),{code:'sample_status'});
 return P.normalizeResult(raw,essay);
}
test('An already-open client receives its supported sample status without changing or regenerating scores',()=>{
 const a=completed();assert.throws(()=>cachedClient(a,a.essayText),{code:'sample_status'});
 const compatible=essayResultForClient(a,P.VERSION);
 assert.equal(compatible.sampleStatus,'unavailable');assert.match(compatible.sampleNote,/has not been requested/);
 assert.deepEqual(cachedClient(compatible,a.essayText).scores,a.scores);
 assert.deepEqual(compatible.feedbackIssues,a.feedbackIssues);assert.deepEqual(compatible.promptCoverage,a.promptCoverage);
 assert.equal(a.sampleStatus,'not-requested');
 assert.equal(essayResultForClient(a,P.VERSION,P.SAMPLE_CONTRACT_VERSION),a);
 assert.equal(essayResultForClient(a,P.VERSION,'unknown-future-contract').sampleStatus,'unavailable');
});

test('The real grading route negotiates the sample contract separately from the rubric version',async t=>{
 const app=express();app.use(express.json());let calls=0;
 app.post('/grade',createEssayGradeHandler({env:{ESSAY_FEEDBACK_V3:'true',ESSAY_FEEDBACK_V3_PERCENT:'100'},verifyToken:()=> 'synthetic-student',getUserData:async()=>({practiceHistory:[]}),grader:{grade:async()=>{calls++;return completed();}}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 async function post(contract){const r=await fetch('http://127.0.0.1:'+server.address().port+'/grade',{method:'POST',headers:{'content-type':'application/json','x-essay-scoring-version':P.VERSION,...(contract?{'x-essay-sample-contract':contract}:{})},body:JSON.stringify({question:example.questionText,essay:example.essayText,includeSample:false,attemptId:'same-attempt'})});assert.equal(r.status,200);return r.json();}
 const old=await post(),current=await post(P.SAMPLE_CONTRACT_VERSION);
 assert.equal(old.sampleStatus,'unavailable');assert.equal(current.sampleStatus,'not-requested');
 assert.deepEqual(cachedClient(old,example.essayText).scores,P.normalizeResult(current,example.essayText).scores);assert.equal(calls,2);
});

test('A zero-Form submission remains displayable when the optional sample has not been requested',async()=>{
 let calls=0;const grader=createEssayGrader(async()=>{calls++;throw Error('No paid assessment is needed for deterministic zero Form.');});
 const essay='This response is too short.';
 const a=await grader.grade('Discuss public transport.',essay,'9',{feedbackV3:true,includeSample:false});
 assert.equal(a.scoreGate.status,'zero_form');assert.equal(a.sampleStatus,'unavailable');assert.equal(P.normalizeResult(a,essay).scores.total,0);assert.equal(calls,0);
});

test('Immutable essay assets change their URLs when their contents change',()=>{
 const root=path.join(__dirname,'..');
 const assets=new Map(['public/essay-scoring.js','public/portal-workspace.js','essay-attempt-sync.js','public/essay-feedback.js','public/essay-next-steps.js','public/writing-lab-client.js'].map(file=>[path.basename(file),file]));
 let checked=0;
 for(const page of ['public/index.html','public/writing-lab.html','public/essay-feedback-preview.html']){
  const html=fs.readFileSync(path.join(root,page),'utf8');
  for(const match of html.matchAll(/<script[^>]+src="([^"?]+)\?v=([^"]+)"/g)){
   const name=path.basename(match[1]),file=assets.get(name);
   if(file){const hash=createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex').slice(0,12);assert.equal(match[2],'sha256-'+hash,page+' must invalidate cached '+name);checked++;}
   if(name==='index.min.js'){const hash=createHash('sha256').update(fs.readFileSync(path.join(root,'public/index.js'))).digest('hex').slice(0,12);assert.equal(match[2],'source-sha256-'+hash);}
  }
 }
 assert.equal(checked,10);
});
