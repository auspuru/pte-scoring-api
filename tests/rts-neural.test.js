'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),crypto=require('node:crypto'),path=require('node:path'),os=require('node:os');
const prompts=require('../rts-prompts'),bank=require('../content/speaking-bank'),manifest=require('../content/speaking-audio/rts-neural-manifest.json');
const {createPromptNarrator}=require('../speaking-practice-prompts');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
test('30 new RTS snapshots resolve immutable, approved-profile neural bytes without any narration call',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'rts-neural-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 let calls=0;const narrator=createPromptNarrator(directory,{render:async()=>{calls++;throw Error('No provider should be called');}});
 const originals=require('../content/rts-original-practice.json');assert.equal(Object.values(manifest).filter(e=>e.promptVersion===prompts.NEURAL_VERSION).length,originals.length);
 for(const source of originals){
  const q=bank.questions.find(q=>q.id===source.id),snapshot=structuredClone(q),key=q.id+'-prompt-20261104-2',entry=manifest[key];
  assert.equal(q.text,source.text);assert.equal(q.sample,source.sample);assert.deepEqual(q.facts,source.facts);
  assert.equal(q.promptAudioKey,key);assert.equal(q.promptVersion,prompts.NEURAL_VERSION);assert.equal(q.audioPrompt,true);
  assert.equal(q.preparation,10);assert.equal(q.seconds,40);assert.equal(entry.textSha256,sha(q.text));assert.equal(entry.questionId,q.id);
  assert.equal(entry.generation.voice,'marin');assert.equal(entry.generation.speed,0.95);assert(['constant-gain-only','approved-pilot-bytes-unchanged'].includes(entry.processing.kind));assert.equal(entry.processing.tempoProcessing,'none');assert.equal(entry.generator,'gpt-4o-mini-tts-2025-12-15');
  const audio=prompts.requestedAudio(q.id,key),bytes=await fs.readFile(audio.file);
  assert.equal(bytes.length,entry.bytes);assert.equal(sha(bytes),entry.audioSha256);assert.equal(await narrator(snapshot),audio.file);
  assert(entry.seconds>=5&&entry.seconds<=35);assert(entry.truePeakDbTP<=-1.5);assert(entry.loudnessLUFS>=-22&&entry.loudnessLUFS<=-16);
  // Gain-only delivery preserves natural dynamics; peak-capped clips may be quieter.
  if(entry.loudnessLUFS < -20)assert.equal(entry.processing.gainPeakConstrained,true);
  assert.equal(entry.transcription.audioSha256,entry.audioSha256);assert.equal(entry.auditoryReview.audioSha256,entry.audioSha256);assert(['unverified','pilot-approved'].includes(entry.auditoryReview.status));
  assert.match(entry.transcription.text,/what would you say to/i,'The final addressee question must be spoken');
  if(q.id.endsWith('-01'))assert.equal(entry.audioSha256,manifest[q.id+'-prompt-20261104-1'].audioSha256,'Keep the accepted first pilot bytes');
  if(q.id.endsWith('-09'))assert.equal(entry.audioSha256,sha(await fs.readFile(path.join(__dirname,'../review/rts-neural-20261104/q9-quality-repair/q9-pilot-speed-gain-only.mp3'))),'Use the exact cleaner clip accepted by the user');
  assert.equal(prompts.forAttempt({questionId:q.id,questionSnapshot:snapshot},{}),snapshot);
  const firstKey=q.id+'-prompt-20261104-1',first=manifest[firstKey],firstAudio=prompts.requestedAudio(q.id,firstKey);assert(firstAudio.versioned);assert.equal(sha(await fs.readFile(firstAudio.file)),first.audioSha256);
  const earlier={...snapshot,promptAudioKey:firstKey,promptVersion:first.promptVersion};assert.equal(prompts.forAttempt({questionId:q.id,questionSnapshot:earlier},q),earlier);assert.notEqual(prompts.publicAudio(earlier,'/speaking-audio').audioUrl,prompts.publicAudio(q,'/speaking-audio').audioUrl);
  const old=prompts.forAttempt({questionId:q.id},q);assert.equal(old.audioPrompt,false);assert.equal(old.promptAudioKey,undefined);assert.equal(prompts.publicAudio(old,'/speaking-audio'),null);
  await assert.rejects(narrator({...snapshot,text:q.text+' Changed.'}),e=>e.status===503);
 }
 assert.equal(calls,0);assert.deepEqual(await fs.readdir(directory),[]);
});
test('missing, mismatched or cross-question fixed media never fall back to local speech',async()=>{
 let calls=0;const narrator=createPromptNarrator('unused',{render:async()=>{calls++;}}),q=bank.questions.find(q=>q.id==='rts-original-20261024-01');
 for(const snapshot of [{...q,promptAudioKey:q.id+'-prompt-20990101-1'},{...q,promptAudioKey:'rts-1-prompt-20261028-1'},{...q,promptAudioKey:'../private'}]){
  await assert.rejects(narrator(snapshot),e=>e.status===503);
 }
 assert.equal(calls,0);assert.equal(prompts.requestedAudio(q.id,'../private'),null);
});
