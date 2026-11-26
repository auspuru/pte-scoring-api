'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto'),express=require('express');
const {createStore}=require('../writing-lab-store'),{createRecovery}=require('../writing-lab-recovery'),policy=require('../mock-recovery-policy');
async function setup(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'unattended-mocks-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return {directory,store:createStore(null,directory)};}
const saved=()=>({id:randomUUID(),kind:'mock',module:'writing',status:'submitted',startedAt:1000,finishedAt:1000,questions:[{type:'essay',text:'Discuss public transport.'}],answers:['A saved response.'],completed:[{at:1000}],results:[null]});
test('Durable assessment leases prevent duplicates across workers and hold uncertain expired calls',async t=>{
 const {store}=await setup(t),a=saved();await store.update('alice',a.id,()=>a);let at=1000;
 const one=createRecovery({store,now:()=>at,isConfirmed:(a,i)=>!!a.results[i]}),two=createRecovery({store,now:()=>at,isConfirmed:(a,i)=>!!a.results[i]});
 const [first,second]=await Promise.all([one.claim('alice',a.id,0),two.claim('alice',a.id,0)]);assert.equal([first,second].filter(Boolean).length,1);
 at+=180001;assert.equal(await two.claim('alice',a.id,0),undefined);
 assert.equal((await store.get('alice',a.id)).assessmentRecovery[0].status,'calling');
 at+=120000;assert.equal(await two.claim('alice',a.id,0),undefined);
 const held=await store.get('alice',a.id);assert.equal(held.assessmentRecovery[0].status,'held');assert.equal(held.assessmentRecovery[0].uncertain,true);
 assert.deepEqual(held.answers,a.answers);assert.deepEqual(held.results,[null]);
});
test('Restart resumes only a due failed stage and preserves confirmed answers and zero scores',async t=>{
 const {store}=await setup(t),a=saved();a.questions.push({type:'wfd',text:'Keep this answer.'});a.answers.push('');a.completed.push({at:1000});a.results.push({total:0,maximum:3});await store.update('alice',a.id,()=>a);let at=1000;
 const worker=createRecovery({store,now:()=>at,isConfirmed:(a,i)=>!!a.results[i]});const receipt=await worker.claim('alice',a.id,0);await worker.fail('alice',a.id,0,receipt,{status:503});
 assert.equal(await worker.claim('alice',a.id,0),undefined);at+=30000;
 const restarted=createRecovery({store,now:()=>at,isConfirmed:(a,i)=>!!a.results[i]});const next=await restarted.claim('alice',a.id,0);assert.equal(next.attempts,2);
 await restarted.save('alice',a.id,0,next,{total:20,maximum:26});assert.equal(await restarted.claim('alice',a.id,0),undefined);
 const after=await store.get('alice',a.id);assert.deepEqual(after.results[1],a.results[1]);assert.deepEqual(after.answers,a.answers);
});
test('Recovery budgets stop auth, billing and uncertain calls and back off temporary failures',()=>{
 for(const error of [{status:401},{code:'insufficient_quota'},{uncertain:true},{name:'TimeoutError'},{name:'APIConnectionTimeoutError'},{status:429,code:'insufficient_quota'}])assert.equal(policy.retryState(error,1,1000).status,'held');
 assert.equal(policy.retryState({status:429},1,1000).nextAt,31000);assert.equal(policy.retryState({status:503},9,1000).status,'exhausted');
});
test('Writing and Listening finish assessments without a browser and retry only the missing response after restart',async t=>{
 const {directory}=await setup(t);let at=1000,calls=0;
 const options={directory,verifyToken:()=>null,getAccount:async()=>({}),now:()=>at,essayGrader:{grade:async()=>{if(++calls===1)throw Object.assign(Error('Temporary provider outage'),{status:503});return{scores:{total:20}};}}};
 const app=express(),service=require('../writing-lab').installWritingLab(app,options),a=saved();a.questions[0].minutes=20;
 a.questions.push({type:'wfd',text:'Keep this original sentence.',minutes:2});a.answers.push('Keep this original sentence.');a.completed.push({at:1000});a.results.push(null);
 await service.store.update('alice',a.id,()=>a);await service.recover();await service.waitForJobs();
 const before=await service.store.get('alice',a.id);assert.equal(calls,1);assert(before.results[1]);assert.equal(before.results[0],null);
 const restarted=require('../writing-lab').installWritingLab(express(),options);at+=30001;await restarted.recover();await restarted.waitForJobs();
 const after=await restarted.store.get('alice',a.id);assert.equal(calls,2);assert.equal(after.results[0].total,20);assert.deepEqual(after.results[1],before.results[1]);assert.deepEqual(after.answers,a.answers);
 await restarted.recover();await restarted.waitForJobs();assert.equal(calls,2);
 // A listening mock's objective saved answer uses the same scanner and requires no paid call.
 const listening={...saved(),module:'listening',questions:[a.questions[1]],answers:[a.answers[1]],results:[null]};await restarted.store.update('bob',listening.id,()=>listening);
 await restarted.recover();await restarted.recover();await restarted.waitForJobs();assert.equal((await restarted.store.get('bob',listening.id)).results[0].total,4);assert.equal(calls,2);
});

test('Available-mark policy is exactly pinned and its legacy adapter projects to the prior native grader',()=>{
 const read=name=>require('node:fs').readFileSync(require.resolve('../'+name),'utf8'),sha=s=>require('node:crypto').createHash('sha256').update(s).digest('hex');
 const baseline=require('../content/full-mock/unattended-recovery-compatible-sources.json');
 let source=read('full-mock/adapters.js');
 // This user-requested policy changes new-attempt completion only. Pin the
 // entire new source, then remove only the explicit policy branches and verify
 // that the historical adapter is exactly the previously deployed revision.
 assert.equal(sha(source),require('../content/full-mock/scoring-lock.json').snapshot.files['full-mock/adapters.js'].sha256);
 const project=(from,to='')=>{assert(source.includes(from),'Expected available-marks projection');source=source.replace(from,to);};
 const beforeSwt=require('../content/full-mock/swt-policy-previous-sources.json').files;
 // The new SWT-only paths must leave the exact prior native adapter recoverable.
 project(`  if (q.type === 'swt' && raw.itemScore90 === 10 && raw.gated && value.total === 0 && raw.maximum === value.maximum) {
    return { ...value, gated: true, reason: raw.reasons?.[0] || 'Native Content/Form gate' };
  }
`);
 project(', legacySwt = false');
 project(`    if (q.type === 'swt' && !legacySwt && !writing.formFor('swt', text).score) {
      return { ...normalise(q, await writing.gradeUnifiedSwt(q, text, swtGrader)), stages };
    }
`);
 project(', swtGrader, {legacy:legacySwt}', ', swtGrader');
 assert.equal(sha(source),beforeSwt['full-mock/adapters.js'].sha256);
 // Strip only the reviewed DI policy-routing additions before checking the
 // exact deployed adapter and the older delivery/completion projections below.
 project("gradeSpeaking = (q, text, call, contentPolicy) => q.type==='di' ? require('../describe-image-academy').grade(q,text,call,{contentPolicy}) : speech.grade(q, text, call, { academyDescribeImage: true })",
   "gradeSpeaking = (q, text, call) => speech.grade(q, text, call, { academyDescribeImage: true })");
 project(', describeImagePolicy','');
 project('gradeSpeaking(q, transcript, contentModel, describeImagePolicy)','gradeSpeaking(q, transcript, contentModel)');
 assert.equal(sha(source),require('../content/full-mock/di-number-context-previous-sources.json').files['full-mock/adapters.js'].sha256);
 const whole=require('../content/full-mock/whole-recording-upgrade-pins.json');
 project(`  assessDelivery = require('../azure-continuous-delivery').assessRecording,
  assessLegacyDelivery = assessDelivery === require('../azure-continuous-delivery').assessRecording
    ? require('../speaking-delivery').assessRecording : assessDelivery,`,"  assessDelivery = require('../speaking-delivery').assessRecording,");
 project(', legacyDelivery = false','');
 project(`        try {
          raw = legacyDelivery
            ? await assessLegacyDelivery(recording, { question: q, transcript, transcribe: async () => transcript, contentIndependent: true, bandPolicy:deliveryPolicy })
            : require('../speaking-delivery').reband(await assessDelivery(recording), { questionType:q.type, bandPolicy:deliveryPolicy });
        }`,`        try { raw = await assessDelivery(recording, { question: q, transcript, transcribe: async () => transcript, contentIndependent: true, bandPolicy:deliveryPolicy }); }`);
 project("{ score: trait.score, ...(Number.isFinite(trait.raw)?{raw:trait.raw}:{}), evidence: trait.evidence || [], version: raw.deliveryVersion || raw.version, provider: raw.deliveryProvider || 'azure',",
   "{ score: trait.score, evidence: trait.evidence || [], version: raw.deliveryVersion, provider: raw.deliveryProvider,");
 assert.equal(sha(source),whole.oldAdapter);
 project(`// The assembly path creates canonical 16-bit mono WAV. Only classify an almost
// silent signal; unknown formats and merely short responses are not silence.
function quietRecording(recording) {
  if (recording?.mime!=='audio/wav' || typeof recording.data!=='string') return false;
  const wav=Buffer.from(recording.data,'base64');
  if(wav.length<46||wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE'||wav.toString('ascii',12,16)!=='fmt '
    ||wav.readUInt16LE(20)!==1||wav.readUInt16LE(22)!==1||wav.readUInt16LE(34)!==16||wav.toString('ascii',36,40)!=='data')return false;
  const size=wav.readUInt32LE(40);if(size<2||size%2||size+44!==wav.length)return false;
  for(let offset=44;offset<wav.length;offset+=2)if(Math.abs(wav.readInt16LE(offset))>32)return false;
  return true;
}
`);
 // The revised delivery policy is carried to Azure but does not change the
 // frozen legacy adapter once the new argument is projected away.
 project(', deliveryPolicy, contentOnly = false', ', contentOnly = false');
 project(', bandPolicy:deliveryPolicy','');
 project(', completionPolicy, contentOnly = false','');
 project(" && completionPolicy !== require('./aggregation').COMPLETION_POLICY",'');
 project(`      if(completionPolicy===require('./aggregation').COMPLETION_POLICY&&stages.transcription?.status!=='complete'&&quietRecording(recording)){
        stages.transcription={status:'failed',attemptedRun:run,uncertain:false,failureCode:'quiet_audio'};
        return failed('transcription-unavailable');
      }
`);
 project(`      if (contentOnly) {
        const limits=maxima(q);
        return {status:'assessed',version:VERSION,scores:{content:content.total,pronunciation:null,fluency:null},maxima:limits,
          total:content.total,maximum:limits.content,unavailableTraits:['pronunciation','fluency'],partialDelivery:completionPolicy,nativeVersion:content.version,stages};
      }
`);
 project(`      if (stages.delivery?.status !== 'complete') {
        if (completionPolicy !== require('./aggregation').COMPLETION_POLICY) return failed('delivery-unavailable');
        const traits = stages.delivery?.traits || {}, unavailableTraits = ['pronunciation','fluency'].filter(key => traits[key] == null);
        const limits = maxima(q), scores = {content:content.total, pronunciation:traits.pronunciation?.score ?? null, fluency:traits.fluency?.score ?? null};
        const included = Object.keys(limits).filter(key => scores[key] != null);
        return {status:'assessed',version:VERSION,scores,maxima:limits,total:included.reduce((n,key)=>n+scores[key],0),
          maximum:included.reduce((n,key)=>n+limits[key],0),unavailableTraits,partialDelivery:completionPolicy,nativeVersion:content.version,stages};
      }`,"      if (stages.delivery?.status !== 'complete') return failed('delivery-unavailable');");
 project('VERSION, SPOKEN, quietRecording, maxima','VERSION, SPOKEN, maxima');
 assert.equal(sha(source),require('../content/full-mock/available-marks-compatible-sources.json').files['full-mock/adapters.js'].sha256);
 // Remove only the reviewed empty-recognition classification and quality
 // receipt. The remaining adapter must match its exact previous revision
 // before projecting the older recovery metadata below.
 source=source.replace(`const transcript = await stage('transcription', async () => {
        const value = await transcribe(recording);
        // A successful recogniser response containing no words is audio evidence,
        // unlike a network, account or malformed-provider-response failure.
        if (typeof value === 'string' && !value.trim()) throw Object.assign(Error('No intelligible speech was recognised.'), { code:'unintelligible_audio' });
        return value;
      }, value => typeof value === 'string' && !!value.trim());`, "const transcript = await stage('transcription', () => transcribe(recording), value => typeof value === 'string' && !!value.trim());");
 source=source.replace(", ...(!error&&raw?.deliveryEvidence?.sufficient===false?{audioQuality:'insufficient-speech'}:{})",'');
 assert.equal(sha(source),require('../content/full-mock/unclear-audio-compatible-sources.json').files['full-mock/adapters.js'].sha256);
 source=source.replace("uncertain: require('../mock-recovery-policy').failure(error).uncertain, failureCode:require('../mock-recovery-policy').failure(error).code, recoveryBlocked:require('../mock-recovery-policy').failure(error).blocked",'uncertain: !!error.uncertain');
 source=source.replace("uncertain: error ? require('../mock-recovery-policy').failure(error).uncertain : false, ...(error?{failureCode:require('../mock-recovery-policy').failure(error).code,recoveryBlocked:require('../mock-recovery-policy').failure(error).blocked}:{})",'uncertain: !!error?.uncertain');
 assert.equal(sha(source),baseline.files['full-mock/adapters.js'].sha256);
 assert.equal(sha(read('server.js')),require('../content/full-mock/scoring-lock.json').snapshot.files['server.js'].sha256);
 source=read('public/writing-lab-report.js');
 project(`  function itemEstimate(question, result) {
    if (question?.type === 'swt' && Number.isFinite(result?.itemScore90)) return result.itemScore90;
    return score90(result?.total, result?.maximum);
  }
`);
 project("    const singleSwtItem = attempt.kind !== 'mock' && questions.length === 1 && questions[0].type === 'swt';\n");
 project(`    const byType = Object.values(groups).map(g => ({ ...g,
      score90: g.marked !== g.count ? null : singleSwtItem ? itemEstimate(questions[0], results[0]) : score90(g.total, g.maximum)
    }));`, '    const byType = Object.values(groups).map(g => ({ ...g, score90: g.marked === g.count ? score90(g.total, g.maximum) : null }));');
 project('    const estimate = singleSwtItem ? byType[0].score90 : score90(total, maximum);\n');
 project('score90: complete ? estimate : null', 'score90: complete ? score90(total, maximum) : null');
 project(', score90, itemEstimate, minutesFor', ', score90, minutesFor');
 assert.equal(sha(source),beforeSwt['public/writing-lab-report.js'].sha256);
 project("(attempt.kind!=='mock' || !needsReview(r,q))",'(!weighted || !needsReview(r,q))');
 assert.equal(sha(source),baseline.files['public/writing-lab-report.js'].sha256);
 assert.equal(sha(read('full-mock/profiles.js')),baseline.files['full-mock/profiles.js'].sha256);
 const rtsUpgrade=require('../content/full-mock/rts-content-upgrade-pins.json');
 const scoringLock=require('../content/full-mock/scoring-lock.json').snapshot;
 assert.deepEqual(rtsUpgrade.previousFiles['speaking-scoring.js'],baseline.files['speaking-scoring.js']);
 assert.equal(sha(read('speaking-scoring.js')),scoringLock.files['speaking-scoring.js'].sha256);
 assert.equal(sha(read('situation-content-policy.js')),baseline.files['situation-content-policy.js'].sha256);
 source=read('writing-lab-scoring.js').replace(`  // SST permits several sentences. An answer containing a substantial
  // punctuated sentence cannot be entirely short, disconnected fragments.
  if (q.type === 'sst' && form.score > 0 && raw.formInvalid
    && text.split(/[.!?;]+/u).some(sentence => wordCount(sentence) >= 8))
    throw Error('Unsupported SST form gate: a substantial sentence is present; assess grammar and content separately');
`, '');
 project("    ...(q.type === 'sst' && raw.scoringProvider === 'openai' ? {scoringProvider:raw.scoringProvider,scoringModel:raw.scoringModel} : {}),\n");
 project('  let raw, assessment;\n  try {\n    raw = await judge(q,text,{legacy});','  let assessment;\n  try {\n    const raw = await judge(q,text,{legacy});');
 project("scoringMode:raw.source === 'openai' ? 'openai' : 'claude'", "scoringMode:'claude'");
 project(String.raw`async function grade(q, text, call, { propagateProviderErrors = false } = {}) {
  const objective = require('./listening-scoring').grade(q,text);
  if(objective)return objective;
  if (q.type === 'essay') return gradeUnifiedEssay(q, text, call);
  if (q.type === 'wfd') return gradeDictation(q, text);
  const form = formFor(q.type, text);
  if (!form.score) return zeroResult(q.type, text, form.reasons);
  let error;
  for (let i = 0; i < 2; i++) {
    const prompt = buildPrompt(q, text) + (i ? '\nVALIDATION RETRY: '+error.message+'. Return all required fields with valid exact response quotations. For SWT, one complete sentence within 5–75 words earns FULL Form 1/1; never require multiple sentences.' : '');
    let raw;
    try { raw = await call(prompt); }
    catch (e) { if (propagateProviderErrors) throw e; error = e; continue; }
    try { return normalize(q, text, raw); }
    catch (e) { error = e; }
  }
  return localGrade(q, text, { reason: error?.message || 'AI assessment unavailable' });
}
`,
   String.raw`async function grade(q, text, call) {
  const objective = require('./listening-scoring').grade(q,text);
  if(objective)return objective;
  if (q.type === 'essay') return gradeUnifiedEssay(q, text, call);
  if (q.type === 'wfd') return gradeDictation(q, text);
  const form = formFor(q.type, text);
  if (!form.score) return zeroResult(q.type, text, form.reasons);
  let error;
  for (let i = 0; i < 2; i++) {
    try { return normalize(q, text, await call(buildPrompt(q, text) + (i ? '\nVALIDATION RETRY: '+error.message+'. Return all required fields with valid exact response quotations. For SWT, one complete sentence within 5–75 words earns FULL Form 1/1; never require multiple sentences.' : ''))); }
    catch (e) { error = e; }
  }
  return localGrade(q, text, { reason: error?.message || 'AI assessment unavailable' });
}
`);
 assert.equal(sha(source),'e5e716589a9388f431420c9676aa3c93f78cceea20a664c339ad1f0e3f5a339f');
 assert.equal(sha(read('speaking-delivery.js')),require('../content/full-mock/scoring-lock.json').snapshot.files['speaking-delivery.js'].sha256);
 assert.equal(baseline.files['speaking-delivery.js'].sha256,require('../content/full-mock/delivery-bands-compatible-sources.json').files['speaking-delivery.js'].sha256);
 assert.equal(sha(read('full-mock/session.js')),require('../content/full-mock/scoring-lock.json').snapshot.files['full-mock/session.js'].sha256); // Reviewed integrated Listening transport; historical clocks remain pinned below.
 assert.equal(require('../content/full-mock/listening-skill-compatible-sources.json').previous.files['full-mock/session.js'].sha256,'42ce3ff414bb37fbfcb8e7ca4917a44ff83a3e07d90597c85856d69aaeef486e');
 assert.equal(require('../content/full-mock/pause-previous-sources.json').files['full-mock/session.js'].sha256,'35d81a57f61193d1a94c22ae74cd31cae2cde56e861fd20ec66ae2a050ab5e58');
 // Explicit instructor exclusions have separate ownership/integrity and
 // denominator tests. Their exact source is pinned; native graders and the
 // original profile weights remain byte-identical above.
 assert.equal(sha(read('full-mock/aggregation.js')),require('../content/full-mock/scoring-lock.json').snapshot.files['full-mock/aggregation.js'].sha256);
});

test('Full Mock failure checkpoints retain auth and uncertainty evidence without inventing marks',async()=>{
 for(const error of [{status:401},{name:'TimeoutError'},{name:'APIConnectionTimeoutError'},{status:429,code:'insufficient_quota'}]){
  let calls=0;const adapter=require('../full-mock/adapters').createAdapters({transcribe:async()=>{calls++;throw error;}});
  const value=await adapter.assess({type:'rs'},{sealed:true,segments:[]},{recording:{}});
  assert.equal(value.status,'failed');assert.equal(value.stages.transcription.recoveryBlocked,true);assert.equal(calls,1);
 }
 const provisional={score_provisional:true,total:8,maximum:12};
 assert.equal(require('../public/writing-lab-report').summarize([{type:'sst'}],[provisional],{kind:'mock',module:'listening'}).complete,false);
});
