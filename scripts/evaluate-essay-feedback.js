'use strict';
// Run only against an explicitly provided isolated review service.
// Store the disposable test session in memory; never print it or a password.
const fs=require('node:fs/promises'),{randomBytes}=require('node:crypto');
const {cases}=require('../tests/essay-feedback-cases');
async function main() {
 const base=process.env.ESSAY_REVIEW_URL;
 if(!base || !process.env.ESSAY_REVIEW_OUTPUT)throw Error('Provide ESSAY_REVIEW_URL and ESSAY_REVIEW_OUTPUT for the isolated review service.');
 const username='feedbackqa_'+Date.now();
 async function post(path,body,token) {const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(token?{'x-session-token':token}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(240000)});const value=await r.json();if(!r.ok)throw Error(r.status+' '+(value.error||'Request failed'));return value;}
 const auth=await post('/api/auth/register',{username,password:randomBytes(24).toString('base64url')});
 if(!auth.token)throw Error('Review service did not issue a test session.');
 const selected=cases.filter(c=>!process.env.ESSAY_REVIEW_CASES || process.env.ESSAY_REVIEW_CASES.split(',').includes(c.id));
 const results=[];
 for(const c of selected)for(let run=0;run<(c.repeat?2:1);run++) {
  const essay=run?c.essay.replace(/\n\n/g,'\n\n\n'):c.essay;
  const started=Date.now();
  try {
   const a=await post('/api/essay/grade',{question:c.question,essay,includeSample:false,attemptId:c.id+'_'+run},auth.token);
   const issues=a.feedbackIssues||[],reqs=a.promptRequirements||[],errors=[];
   if(!a.feedbackVersion)errors.push('New contract was not enabled.');
   if(c.expectMissingKind && !reqs.some(r=>r.kind===c.expectMissingKind && a.promptCoverage.some(v=>v.requirementId===r.id && v.status!=='addressed')))errors.push('Expected missing '+c.expectMissingKind);
   if(c.forbidMissingKind && reqs.some(r=>r.kind===c.forbidMissingKind && a.promptCoverage.some(v=>v.requirementId===r.id && v.status!=='addressed')))errors.push('Invented compulsory '+c.forbidMissingKind);
   if(c.expectCodes && !issues.some(i=>c.expectCodes.includes(i.code)))errors.push('Expected substantive issue: '+c.expectCodes.join('/'));
   if(c.forbidCodes && issues.some(i=>c.forbidCodes.includes(i.code)))errors.push('Prohibited criticism survived.');
   if(c.expectMaterial && !issues.some(i=>i.priority==='major' && i.affectsScore))errors.push('A material weakness was missed.');
   if(issues.some(i=>i.evidence.essayQuote && !essay.includes(i.evidence.essayQuote)))errors.push('Invalid quotation.');
   results.push({case:c.id,run,latencyMs:Date.now()-started,passed:!errors.length,errors,assessment:a});
  }catch(error){results.push({case:c.id,run,latencyMs:Date.now()-started,passed:false,errors:[error.message]});}
  await fs.writeFile(process.env.ESSAY_REVIEW_OUTPUT,JSON.stringify({service:base,username,results},null,2));
  console.log(c.id+' run '+(run+1)+': '+(results.at(-1).passed?'PASS':'FAIL')+' ('+results.at(-1).latencyMs+' ms)');
 }
 if(results.some(r=>!r.passed))process.exitCode=1;
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
