'use strict';
// Explicit paid-model check. Uses the proxy without an account or progress writes.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const args=Object.fromEntries(process.argv.slice(2).map(x=>x.replace(/^--/,'').split('=')));
if(!args.url||!args.output)throw Error('Provide --url and --output. This invokes paid model calls.');
const root=path.resolve(args.root||path.join(__dirname,'..'));
const {createEssayGrader}=require(path.join(root,'essay-grading'));
const format=require(path.join(root,'essay-judge-format'));
const fixture=require(path.join(__dirname,'../tests/fixtures/essay-hometown-calibration.json'));
const origin=new URL(args.url).origin;
function post(body){return new Promise((resolve,reject)=>{
 const child=spawn('curl',['--fail-with-body','--silent','--show-error','--max-time','150',origin+'/api/claude','-H','Content-Type: application/json','--data-binary','@-']);
 let output='',stderr='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 child.stdout.on('data',s=>output+=s);child.stderr.on('data',s=>stderr+=s);child.on('error',reject);
 child.on('close',code=>{try{const data=JSON.parse(output);if(code)throw Error('Proxy request failed: '+(data.error?.message||data.error||stderr));resolve(data);}catch(e){reject(Error(e.message));}});
 child.stdin.on('error',reject);child.stdin.end(JSON.stringify(body));
});}
let calls=0;const events=[],candidates=[];
const grader=createEssayGrader(async(prompt,options)=>{
 calls++;const started=Date.now();const r=await post(format.request(prompt,args.model||'claude-haiku-4-5-20251001',options));
 console.log(JSON.stringify({stage:options?.stage,durationMs:Date.now()-started,stopReason:r.stop_reason}));
 const candidate=format.response(r,options);candidates.push({stage:options?.stage,candidate});return candidate;
},{onAttemptError:e=>{events.push(e);console.error(JSON.stringify(e));}});
(async()=>{
 const started=Date.now();
 try{
  const result=await grader.grade(fixture.question,fixture.essay,'9',{feedbackV3:true,includeSample:false});
  const report={question:fixture.question,essay:fixture.essay,provenance:fixture.provenance,latestRevisedEssayMock:fixture.latestRevisedEssayMock,calls,durationMs:Date.now()-started,events,candidates,result};
  fs.writeFileSync(args.output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({scores:result.scores,overallVerdict:result.overallVerdict,issues:result.feedbackIssues,calls}));
 }catch(error){fs.writeFileSync(args.output,JSON.stringify({error:error.message,events,calls,candidates},null,2)+'\n');console.error(error.message);process.exitCode=1;}
})();
