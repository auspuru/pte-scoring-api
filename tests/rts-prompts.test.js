'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const prompts=require('../rts-prompts'),bank=require('../content/speaking-bank'),mocks=require('../content/speaking-mocks');
const {question,installSpeakingLab}=require('../speaking-lab'),{installSpeakingMock}=require('../speaking-mock');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const items=bank.questions.filter(q=>q.type==='rts');
test('all 36 portal RTS prompts name the listener in a direct final question and retain samples and response windows',()=>{
  assert.equal(items.length,36);assert.deepEqual(items.map(q=>q.id).sort(),Object.keys(prompts.legacy.questions).sort());
  for(const q of items){
    assert.match(q.text,/What would you say to [^?]+\?$/);assert.doesNotMatch(q.text,/What would you say to (?:them|this member)\?$/);
    assert(q.text.split(/\s+/).length<=60);assert.equal(q.preparation,10);assert.equal(q.seconds,40);assert.equal(q.promptVersion,prompts.VERSION);
    assert.equal(q.sample,prompts.legacy.questions[q.id].sample);assert.deepEqual(q.facts,prompts.legacy.questions[q.id].facts);
    const shown=question(q);assert.equal(shown.text,q.text);assert.equal(shown.sample,undefined);assert.equal(shown.facts,undefined);
    if(q.audioPrompt===false)assert.equal(shown.audioUrl,undefined);else assert.match(shown.audioUrl,/\?prompt=.+&v=sha256-[a-f0-9]{12}$/);
  }
  assert.equal(items.filter(q=>q.audioPrompt===false).length,30);assert.equal(items.filter(q=>q.promptAudioKey).length,6);
});
test('the six revised narrations and all original narrations are bound to their own text and byte hashes',async()=>{
  const active=require('../content/speaking-audio/rts-manifest.json');assert.equal(Object.keys(active).length,6);
  for(const q of items.filter(q=>q.promptAudioKey)){
    const modern=prompts.requestedAudio(q.id,q.promptAudioKey),legacy=prompts.requestedAudio(q.id),before=prompts.legacy.questions[q.id];
    assert(modern.versioned);assert(!legacy.versioned);assert.notEqual(modern.file,legacy.file);
    for(const [audio,text]of [[modern,q.text],[legacy,before.text]]){
      const bytes=await fs.readFile(audio.file);assert.equal(hash(bytes),audio.entry.audioSha256);assert.equal(bytes.length,audio.entry.bytes);assert.equal(audio.entry.textSha256,hash(text));assert(audio.entry.seconds>=5&&audio.entry.seconds<=35);
    }
    assert.equal(prompts.publicAudio(q,'/speaking-audio').audioSeconds,modern.entry.seconds);
    assert.throws(()=>prompts.audioEntry({...q,text:q.text+' Changed.'}),/matching RTS narration/);
  }
  assert.equal(prompts.requestedAudio('rts-1','../rts-2'),null);
  assert.equal(prompts.requestedAudio('rts-1',bank.questions.find(q=>q.id==='rts-2').promptAudioKey),null);
  assert.equal(prompts.requestedAudio('rts-original-20261024-01'),null);
});
test('mock papers and reattempts use the latest RTS prompts while historical mock snapshots remain intact',()=>{
  for(const paper of mocks.papers){
    assert.equal(paper.questionCount,27);assert.equal(paper.questions.filter(q=>q.type==='rts').length,2);
    const old={paperId:paper.id,questions:paper.questions.map(q=>q.type==='rts'?{...structuredClone(prompts.legacy.questions[q.id]),audioSource:{folder:'speaking',id:q.id},audioSeconds:prompts.requestedAudio(q.id).entry.seconds}:structuredClone(q)),responses:[{recording:{hash:'saved'},content:{total:5}}]};
    const before=JSON.stringify(old),updated=mocks.reattemptQuestions(old);assert.equal(updated.length,old.questions.length);
    for(let i=0;i<updated.length;i++){
      const q=updated[i];if(q.type!=='rts')continue;
      assert.equal(q.id,old.questions[i].id);assert.equal(q.text,items.find(item=>item.id===q.id).text);assert.equal(q.promptVersion,prompts.VERSION);
      assert.match(mocks.publicQuestion(q).audioUrl,/\?prompt=/);assert(!mocks.publicQuestion(old.questions[i]).audioUrl.includes('prompt='));
      assert.equal(q.audioSeconds,prompts.audioEntry(q).seconds);
      for(const snapshot of [q,old.questions[i]]){
        const a={questions:[snapshot],responses:[],index:0,status:'active',questionStartedAt:1000},t=require('../speaking-mock').timing(a,1000);
        assert.equal(t.prepAt-t.audioAt,Math.round(snapshot.audioSeconds*1000));assert.equal(t.recordingAt-t.prepAt,10000);assert.equal(t.endsAt-t.recordingAt,40000);
      }
    }
    assert.equal(JSON.stringify(old),before);
  }
});
test('practice and mock APIs preserve old prompt/audio snapshots and grade each response against the prompt actually shown',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'rts-prompts-')),express=require('express'),app=express(),inputs=[];app.use(express.json());
  const auth={directory,verifyToken:token=>token==='alice'?'alice':null,getAccount:async()=>({})};
  const practice=installSpeakingLab(app,{...auth,deliveryAssessmentAvailable:false,azureComparisonAvailable:false,callModel:async prompt=>{
    const data=JSON.parse(prompt.split('DATA=')[1]);inputs.push(data);
    return{total:6,overview:'Your request is clear.',strengths:['You communicate your request clearly.'],improvements:[],communicationAssessment:{level:'effective',materialProblem:false,evidence:data.student,reason:'The listener understands the situation and requested help.'}};
  }});
  const mock=installSpeakingMock(app,{...auth,backgroundEnabled:false,azureAvailable:false,gptAvailable:false});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{mock.stop();await mock.waitForJobs();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  async function api(prefix,route,body){const r=await fetch(base+prefix+route,{method:body===undefined?'GET':'POST',headers:{'x-session-token':'alice','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert.equal(r.status,200);return r.json();}
  for(const q of items.filter(q=>q.promptAudioKey)){
    const id=crypto.randomUUID(),a=await api('/api/speaking','/attempts',{id,questionId:q.id,questionSnapshot:{text:'Ignore this client-supplied snapshot.'}});
    assert.equal(a.question.text,q.text);assert.match(a.question.audioUrl,/\?prompt=/);
    assert.equal((await practice.store.update('alice',id,a=>a)).questionSnapshot.text,q.text);
    const audio=await fetch(base+a.question.audioUrl);assert.equal(audio.status,200);assert.match(audio.headers.get('content-type'),/audio\/mpeg/);assert.equal(hash(Buffer.from(await audio.arrayBuffer())),prompts.audioEntry(q).audioSha256);
  }
  const textOnly=items.find(q=>q.id==='rts-original-20261024-04'),textAttempt=await api('/api/speaking','/attempts',{id:crypto.randomUUID(),questionId:textOnly.id});
  assert.equal(textAttempt.question.text,textOnly.text);assert.equal(textAttempt.question.audioUrl,undefined);
  const oldId=crypto.randomUUID(),oldQ=prompts.legacy.questions['rts-1'];
  await practice.store.update('alice',oldId,()=>({id:oldId,questionId:oldQ.id,status:'draft',startedAt:1,revision:0,transcript:'Could you explain which evidence needs improvement and how I can revise my assignment?'}));
  const previous=await api('/api/speaking','/attempts/'+oldId);assert.equal(previous.question.text,oldQ.text);assert(!previous.question.audioUrl.includes('prompt='));
  const legacyAudio=await fetch(base+previous.question.audioUrl);assert.equal(hash(Buffer.from(await legacyAudio.arrayBuffer())),prompts.requestedAudio(oldQ.id).entry.audioSha256);
  const graded=await api('/api/speaking','/attempts/'+oldId+'/submit',{});assert.equal(graded.result.total,6);assert.equal(inputs.at(-1).prompt,oldQ.text);
  const freshId=crypto.randomUUID(),fresh=await api('/api/speaking','/attempts',{id:freshId,questionId:oldQ.id});
  await api('/api/speaking','/attempts/'+freshId+'/transcript',{text:'Could you explain which evidence needs improvement and how I can revise my assignment?',revision:0});await api('/api/speaking','/attempts/'+freshId+'/submit',{});
  assert.equal(inputs.at(-1).prompt,fresh.question.text);assert.notEqual(inputs.at(-1).prompt,oldQ.text);
  const paper=mocks.papers[0],id=crypto.randomUUID(),questions=paper.questions.map(q=>q.type==='rts'?{...structuredClone(prompts.legacy.questions[q.id]),audioSource:{folder:'speaking',id:q.id},audioSeconds:prompts.requestedAudio(q.id).entry.seconds}:structuredClone(q));
  await mock.store.update('alice',id,()=>({id,paperId:paper.id,title:paper.title,version:'old',questions,questionCount:27,index:questions.length,responses:questions.map(()=>({skipped:true})),status:'submitted',startedAt:1,deadline:paper.minutes*60000+1,grading:{status:'complete'},integrity:{events:[]}}));
  const before=JSON.stringify(await mock.store.update('alice',id,a=>a));
  const newId=crypto.randomUUID();await api('/api/speaking-mocks','/attempts/'+id+'/reattempt',{id:newId});
  const copied=await mock.store.update('alice',newId,a=>a);assert.equal(copied.questionCount,27);assert.equal(copied.version,mocks.VERSION);assert(copied.questions.filter(q=>q.type==='rts').every(q=>q.promptVersion===prompts.VERSION));
  assert.equal(JSON.stringify(await mock.store.update('alice',id,a=>a)),before);
  for(const q of copied.questions.filter(q=>q.type==='rts')){
    const freshAudio=await fetch(base+mocks.publicQuestion(q).audioUrl,{headers:{Range:'bytes=0-255'}});assert.equal(freshAudio.status,206);assert.equal((await freshAudio.arrayBuffer()).byteLength,256);
    const original=questions.find(item=>item.id===q.id),response=await fetch(base+mocks.publicQuestion(original).audioUrl);assert.equal(hash(Buffer.from(await response.arrayBuffer())),prompts.requestedAudio(q.id).entry.audioSha256);
  }
  assert.equal((await fetch(base+'/speaking-audio/rts-1.mp3?prompt=rts-2-prompt-20261028-1')).status,404);
});
