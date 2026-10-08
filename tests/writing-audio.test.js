'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');
const express = require('express');
const { createNarration, installNarration, normalizeMp3, stretchMp3, createAmbiencePcm, prewarmNarration } = require('../writing-lab-audio');
const { validateWritingAudio, inspectMp3 } = require('../scripts/validate-writing-audio');
const bank = require('../content/writing-lab.json');
const predictions = require('../content/writing-predictions-sep-2026');
const userSst = require('../content/user-sst-predictions');
const userWfd = require('../content/user-wfd-predictions');
const directory = path.join(__dirname, '..', 'content', 'writing-audio');
const manifest = require('../content/writing-audio/manifest.json');
const run = promisify(execFile);
async function duration(file) {
  const { stdout } = await run('ffprobe', ['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',file]);
  return Number.parseFloat(stdout);
}
const questions = [...bank.spoken, ...(bank.dictation || []), ...bank.mocks.flatMap(m => m.questions), ...predictions.sst, ...predictions.wfd].filter(q => ['sst', 'wfd'].includes(q.type));
const bundledQuestions = questions.filter(q => q.audioMode !== 'runtime-neural');
const runtimeQuestions = questions.filter(q => q.audioMode === 'runtime-neural');
const runtimeSstQuestions = runtimeQuestions.filter(q => q.type === 'sst');
const runtimeWfdQuestions = runtimeQuestions.filter(q => q.type === 'wfd');

test('Every current lecture and dictation has a verified recording with the correct content and duration', () => {
  assert.equal(validateWritingAudio(), 126);
});

test('A cold cache and failed narration provider cannot prevent bundled audio playback', async t => {
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'bundled-audio-'));
  t.after(() => fs.rm(cache, { recursive: true, force: true }));
  const narration = createNarration(cache, () => { throw Error('Provider quota exhausted'); }, { bundledDirectory: directory });
  for (const q of bundledQuestions) assert.equal(await narration.get(q.id), path.join(directory, q.id + '.mp3'));
  assert.deepEqual(await fs.readdir(cache), []);
  await assert.rejects(narration.get('../../private'), { status: 404 });
});

test('The student audio endpoint serves real MP3 data and byte ranges for loading and resuming', async t => {
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-http-'));
  const app = express();
  const narration = installNarration(app, cache, { prewarm:false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(cache, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  for (const q of bundledQuestions) {
    const original = path.join(directory, q.id + '.mp3');
    const file = await narration.get(q.id);
    const bytes = await fs.readFile(file);
    if (q.type === 'sst' && manifest[q.id].seconds < 60) {
      assert.notEqual(file, original);
      if (manifest[q.id].seconds / 60 < 0.92) {
        assert.deepEqual(bytes, await fs.readFile(original), q.id + ' must preserve natural speech');
        assert(Math.abs(await duration(file) - manifest[q.id].seconds) < 0.05);
      } else {
        assert(Math.abs(await duration(file) - 60) < 0.25);
      }
      assert.equal(inspectMp3(bytes).valid, true);
    } else {
      assert.equal(file, original, 'Longer lectures and dictations must keep their original recording');
    }
    const url = base + '/writing-audio/' + q.id + '.mp3?v=' + bank.version;
    const full = await fetch(url);
    assert.equal(full.status, 200);
    assert.match(full.headers.get('content-type'), /audio\/mpeg/);
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);
    const partial = await fetch(url, { headers: { Range: 'bytes=1000-1999' } });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('content-range'), 'bytes 1000-1999/' + bytes.length);
    assert.deepEqual(Buffer.from(await partial.arrayBuffer()), bytes.subarray(1000, 2000));
  }
  // Loading media and seeking can exceed 30 requests from a shared classroom IP.
  for (let i=0; i<8; i++) {
    const head = await fetch(base + '/writing-audio/' + bundledQuestions[0].id + '.mp3', { method:'HEAD' });
    assert.equal(head.status, 200);
  }
  const missing = await fetch(base + '/writing-audio/missing.mp3');
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('cache-control'), 'no-store');
});


test('User SST predictions preserve verbatim source text while audio adds varied human delivery and restrained distractors', async t => {
  assert.equal(runtimeSstQuestions.length, 13);
  assert.equal(runtimeWfdQuestions.length, 33);
  assert.equal(runtimeQuestions.length, 46);
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-neural-audio-'));
  t.after(() => fs.rm(cache, { recursive: true, force: true }));
  const seen=[];
  const narration=createNarration(cache,async input=>{seen.push(input);return Buffer.alloc(2000,7);});
  const q=runtimeSstQuestions[0];
  await narration.get(q.id);
  assert.equal(seen.length,1);
  assert.equal(seen[0].input,q.narrationText);
  assert.equal(seen[0].model,'tts-1-hd');
  assert.equal(seen[0].response_format,'wav');
  assert(['nova','onyx','shimmer','echo'].includes(seen[0].voice));
  assert.equal(seen[0].speed,0.94);
  assert.equal(seen[0].instructions,'');
  assert.deepEqual(seen[0].ambience,q.audioAmbience);
  assert.equal(seen[0].requireNeural,true);
  assert.match(seen[0].input,/\n\n/);

  const ambienceTypes=new Set();
  for (const [index,item] of runtimeSstQuestions.entries()) {
    const edits=userSst.deliveryEdits[index] || [];
    assert(edits.length>=2 && edits.length<=4,item.id+' should have two to four natural delivery edits');
    let restored=item.narrationText;
    for (const [anchor,filler] of edits) {
      const spoken=filler+' '+anchor;
      assert(restored.includes(spoken),item.id+' should include its planned delivery edit');
      restored=restored.replace(spoken,anchor);
    }
    assert.equal(restored,userSst.naturalNarration(item.text),item.id+' must keep the supplied transcript unchanged beneath audio-only delivery edits');

    assert(Array.isArray(item.audioAmbience),item.id+' ambience must be explicit');
    assert(item.audioAmbience.length<=2,item.id+' should have at most two subtle environmental distractors');
    for(const effect of item.audioAmbience) ambienceTypes.add(effect.type);
  }
  assert(ambienceTypes.has('room'));
  assert(ambienceTypes.has('clock'));
  assert(ambienceTypes.has('paper'));
  assert(runtimeSstQuestions.some(item=>item.audioAmbience.length===0),'some lectures should stay acoustically clean');
});


test('User WFD predictions keep exact text and use runtime neural narration', async t => {
  assert.deepEqual(runtimeWfdQuestions.map(q=>q.text), userWfd.sentences);
  const cache=await fs.mkdtemp(path.join(os.tmpdir(),'runtime-wfd-audio-'));
  t.after(()=>fs.rm(cache,{recursive:true,force:true}));
  const seen=[];
  const narration=createNarration(cache,async input=>{seen.push(input);return Buffer.alloc(2000,7);});
  const q=runtimeWfdQuestions[1];
  await narration.get(q.id);
  assert.equal(seen.length,1);
  assert.equal(seen[0].input,q.narrationText);
  assert.equal(seen[0].model,'tts-1-hd');
  assert.equal(seen[0].response_format,'wav');
  assert.equal(seen[0].speed,0.95);
  assert.equal(seen[0].requireNeural,true);
  assert.equal(q.text,userWfd.sentences[1]);
  assert(q.narrationText.endsWith('.'));
});

test('A cache processing upgrade reuses the paid recording instead of calling the provider again', async t => {
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-cache-upgrade-'));
  t.after(() => fs.rm(cache, { recursive:true, force:true }));
  const q=runtimeQuestions[0];
  let providerCalls=0;
  const original=createNarration(cache,async()=>{providerCalls++;return Buffer.alloc(2000,7);});
  const legacyFile=await original.get(q.id);
  let processCalls=0;
  const upgraded=createNarration(cache,()=>{throw Error('Provider must not be called');},{
    cacheVersion:'test-processing-v1',
    postProcess:async bytes=>{processCalls++;return Buffer.concat([bytes,Buffer.from([8])]);}
  });
  const upgradedFile=await upgraded.get(q.id);
  assert.notEqual(upgradedFile,legacyFile);
  assert.equal(providerCalls,1);
  assert.equal(processCalls,1);
  assert.equal((await fs.readFile(upgradedFile)).length,2001);
  await upgraded.get(q.id);
  assert.equal(processCalls,1);
});

test('A named prior cache version is reprocessed without another TTS call', async t => {
  const cache=await fs.mkdtemp(path.join(os.tmpdir(),'runtime-version-migration-'));
  t.after(()=>fs.rm(cache,{recursive:true,force:true}));
  const q=runtimeQuestions[0];
  let providerCalls=0;
  const prior=createNarration(cache,async()=>{providerCalls++;return Buffer.alloc(2000,9);},{cacheVersion:'prior-v1'});
  const priorFile=await prior.get(q.id);
  let processCalls=0;
  const upgraded=createNarration(cache,()=>{throw Error('TTS must not be called during audio-only upgrade');},{
    cacheVersion:'clean-hd-v2',
    previousCacheVersions:['prior-v1'],
    postProcess:async bytes=>{processCalls++;return Buffer.concat([bytes,Buffer.from([10])]);}
  });
  const upgradedFile=await upgraded.get(q.id);
  assert.notEqual(upgradedFile,priorFile);
  assert.equal(providerCalls,1);
  assert.equal(processCalls,1);
  assert.equal((await fs.readFile(upgradedFile)).length,2001);
});

test('SST pacing reuses existing neural masters without new speech, repeated processing or speeding up longer recordings', async t => {
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-sst-pacing-'));
  t.after(() => fs.rm(cache, { recursive:true, force:true }));
  const short = bundledQuestions.find(q => q.type === 'sst');
  const long = bundledQuestions.find(q => q.type === 'sst' && manifest[q.id].seconds > 60);
  const shortFile = path.join(cache,'short-master.mp3');
  await run('ffmpeg', ['-v','error','-y','-i',path.join(directory,short.id+'.mp3'),'-t','35','-codec:a','libmp3lame',shortFile]);
  const sourceBytes = await Promise.all([shortFile,path.join(directory,long.id+'.mp3')].map(file => fs.readFile(file)));
  const ids = runtimeSstQuestions.slice(0,2).map(q => q.id);
  let providerCalls = 0;
  const prior = createNarration(cache, async () => sourceBytes[providerCalls++], { cacheVersion:'current-hd' });
  const originalFiles = [];
  for (const id of ids) originalFiles.push(await prior.get(id));
  const paced = createNarration(cache, () => { throw Error('Pacing must reuse the existing speech'); }, {
    cacheVersion:'current-hd', minimumSstSeconds:60,
    postProcess:() => { throw Error('An existing master must not be normalized or mixed again'); }
  });
  const [file,sameFile] = await Promise.all([paced.get(ids[0]),paced.get(ids[0])]);
  assert.equal(file,sameFile,'Concurrent requests must reuse the same processed recording');
  assert.notEqual(file,originalFiles[0]);
  assert.deepEqual(await fs.readFile(file),sourceBytes[0],'Short speech must retain its original pace');
  const bytes = await fs.readFile(file);
  assert.equal(await paced.get(ids[0]),file);
  assert.deepEqual(await fs.readFile(file),bytes,'Repeat playback must not stretch the recording again');
  assert.deepEqual(await fs.readFile(await paced.get(ids[1])),sourceBytes[1],'Longer speech must not be accelerated');
  assert.equal(providerCalls,2);
});

test('Lecture ambience stays subtle and mixes into a valid HD master', async () => {
  const room=createAmbiencePcm(5,[{type:'room'},{type:'clock',start:1,duration:2},{type:'paper',at:3}]);
  const peak=room.reduce((max,value)=>Math.max(max,Math.abs(value)),0);
  assert(peak<600,'background effects must remain far below normal speech peaks');

  const q=bundledQuestions.find(item=>item.type==='wfd');
  const sourceBytes=await fs.readFile(path.join(directory,q.id+'.mp3'));
  const mixed=await normalizeMp3(sourceBytes,{ambience:[{type:'clock',start:1,duration:2},{type:'paper',at:3}]});
  const inspected=inspectMp3(mixed);
  assert.equal(inspected.valid,true);
  assert.equal(inspected.sampleRate,48000);
  assert.equal(inspected.bitrate,192000);
});

test('Runtime narration cleanup returns a clean HD speech MP3', async () => {
  const q=bundledQuestions.find(item=>item.type==='wfd');
  const normalized=await normalizeMp3(await fs.readFile(path.join(directory,q.id+'.mp3')));
  const inspected=inspectMp3(normalized);
  assert.equal(inspected.valid,true);
  assert.equal(inspected.sampleRate,48000);
  assert.equal(inspected.bitrate,192000);
});

test('Prewarming retries a failed item and continues through the remaining recordings', async () => {
  const calls={}, messages=[];
  const narration={get:async id=>{
    calls[id]=(calls[id]||0)+1;
    if(id==='retry' && calls[id]===1) throw Error('temporary');
    if(id==='broken') throw Error('still unavailable');
    return id;
  }};
  const result=await prewarmNarration(narration,['retry','broken','last'],{
    attempts:2,baseDelayMs:0,sleep:async()=>{},
    logger:{log:value=>messages.push(value),warn:value=>messages.push(value)}
  });
  assert.deepEqual(result,{total:3,succeeded:2,failed:['broken']});
  assert.deepEqual(calls,{retry:2,broken:2,last:1});
  assert(messages.some(message=>message.includes('continuing')));
  assert(messages.some(message=>message.includes('2/3 cached')));
});


test('User SST masters use OpenAI quality-optimized HD TTS and never robotic local speech', async () => {
  const source=await fs.readFile(require.resolve('../writing-lab-audio'),'utf8');
  assert.match(source,/OpenAI quality-optimized HD master generated audio/);
  assert.match(source,/Natural HD narration is temporarily unavailable/);
  assert.match(source,/\^tts-1\(\?:-hd\)\?\$/);
  const neuralStart=source.indexOf('if(input.requireNeural)');
  const openAiCall=source.indexOf('if(process.env.OPENAI_API_KEY',neuralStart);
  assert(openAiCall>neuralStart,'OpenAI HD must be the runtime-neural provider');
  const neuralEnd=source.indexOf('\n    }\n    if(process.env.OPENAI_API_KEY)',openAiCall);
  const neuralBlock=source.slice(neuralStart,neuralEnd);
  assert.doesNotMatch(neuralBlock,/createLocalNarration/);
  assert.doesNotMatch(neuralBlock,/createEdgeNarration/);
});


test('Near-minute SST speech permits only a small pitch-preserving pace adjustment', async t => {
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'sst-near-minute-'));
  t.after(() => fs.rm(cache, { recursive:true, force:true }));
  const short = path.join(cache, '57-seconds.mp3');
  await run('ffmpeg', ['-v','error','-y','-i',path.join(directory,'sst-food-waste.mp3'),'-t','57','-codec:a','libmp3lame',short]);
  const bytes = await fs.readFile(short);
  const paced = path.join(cache, 'paced.mp3');
  await fs.writeFile(paced, await stretchMp3(bytes, 60));
  assert(Math.abs(await duration(paced) - 60) < 0.25);
});

test('Old stretched caches are bypassed while intact long caches and retained masters avoid paid regeneration', async t => {
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'sst-legacy-repair-'));
  t.after(() => fs.rm(cache, { recursive:true, force:true }));
  const ids = runtimeSstQuestions.slice(0,2).map(q => q.id);
  const shortMaster = path.join(cache,'short-master.mp3');
  await run('ffmpeg', ['-v','error','-y','-i',path.join(directory,'sst-food-waste.mp3'),'-t','35','-codec:a','libmp3lame',shortMaster]);
  const originals = await Promise.all([shortMaster,path.join(directory,'sst-food-waste.mp3')].map(file => fs.readFile(file)));
  const oldShort = path.join(cache,'stretched.mp3');
  await run('ffmpeg', ['-v','error','-y','-i',shortMaster,'-af','atempo='+await duration(shortMaster)/60,'-codec:a','libmp3lame',oldShort]);
  for (const [index,id] of ids.entries()) {
    const q = runtimeSstQuestions[index];
    const input = { model:q.ttsModel || 'tts-1', voice:q.voice, edgeVoice:q.edgeVoice, input:q.narrationText || q.text, response_format:'wav', speed:q.audioSpeed || 0.95, instructions:q.audioInstructions || '', ambience:q.audioAmbience || [], requireNeural:true, cacheVersion:'old-hd', minimumSeconds:60 };
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0,16);
    await fs.writeFile(path.join(cache,id+'-'+hash+'.mp3'), index === 0 ? await fs.readFile(oldShort) : originals[index]);
  }
  let calls = 0, processing = 0;
  const fixed = createNarration(cache, async () => { calls++; return originals[0]; }, {
    cacheVersion:'old-hd', minimumSstSeconds:60,
    postProcess:async bytes => { processing++; return bytes; }
  });
  for (const [index,id] of ids.entries()) {
    assert.deepEqual(await fs.readFile(await fixed.get(id)), originals[index]);
  }
  assert.equal(calls,1,'Only the recording with no intact master should be generated again');
  assert.equal(processing,1,'The intact long cache must not be mixed or normalized again');
  const unpaced = createNarration(cache, () => { throw Error('Retained master must avoid paid synthesis'); }, { cacheVersion:'old-hd' });
  for (const [index,id] of ids.entries()) assert.deepEqual(await fs.readFile(await unpaced.get(id)), originals[index]);
});

test('Short prediction SST masters are recorded natively for at least one minute with unchanged transcript hashes', () => {
  const native = predictions.sst.filter(q => q.audioMode !== 'runtime-neural');
  assert.equal(native.length,17);
  for (const q of native) {
    const entry = manifest[q.id];
    assert(entry.seconds >= 60 && entry.seconds <= 70,q.id+' must be about one minute');
    assert.equal(entry.pacing,'native-neural-rate');
    assert.equal(entry.textSha256,createHash('sha256').update(q.text).digest('hex'));
  }
});
