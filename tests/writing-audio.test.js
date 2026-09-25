'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createNarration, installNarration, normalizeMp3, prewarmNarration } = require('../writing-lab-audio');
const { validateWritingAudio, inspectMp3 } = require('../scripts/validate-writing-audio');
const bank = require('../content/writing-lab.json');
const predictions = require('../content/writing-predictions-sep-2026');
const directory = path.join(__dirname, '..', 'content', 'writing-audio');
const questions = [...bank.spoken, ...(bank.dictation || []), ...bank.mocks.flatMap(m => m.questions), ...predictions.sst, ...predictions.wfd].filter(q => ['sst', 'wfd'].includes(q.type));
const bundledQuestions = questions.filter(q => q.audioMode !== 'runtime-neural');
const runtimeQuestions = questions.filter(q => q.audioMode === 'runtime-neural');

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
  installNarration(app, cache, { prewarm:false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(cache, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  for (const q of bundledQuestions) {
    const bytes = await fs.readFile(path.join(directory, q.id + '.mp3'));
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


test('User SST predictions keep verbatim source text while audio adds only light human hesitations', async t => {
  assert.equal(runtimeQuestions.length, 13);
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-neural-audio-'));
  t.after(() => fs.rm(cache, { recursive: true, force: true }));
  const seen=[];
  const narration=createNarration(cache,async input=>{seen.push(input);return Buffer.alloc(2000,7);});
  const q=runtimeQuestions[0];
  await narration.get(q.id);
  assert.equal(seen.length,1);
  assert.equal(seen[0].input,q.narrationText);
  assert.equal(seen[0].model,'gpt-4o-mini-tts');
  assert(['marin','cedar'].includes(seen[0].voice));
  assert(['en-AU-NatashaNeural','en-AU-WilliamNeural'].includes(seen[0].edgeVoice));
  assert.equal(seen[0].speed,0.94);
  assert.match(seen[0].instructions,/natural academic lecture/);
  assert.match(seen[0].instructions,/occasional um or uh hesitation/);
  assert.match(seen[0].instructions,/do not add any other words/);
  assert.equal(seen[0].requireNeural,true);
  assert.match(seen[0].input,/\n\n/);

  const tokens=value=>String(value).match(/[\p{L}\p{N}]+/gu) || [];
  for (const item of runtimeQuestions) {
    const narrationTokens=tokens(item.narrationText);
    const fillers=narrationTokens.filter(token=>/^(?:um|uh)$/i.test(token));
    assert(fillers.length>=1 && fillers.length<=2,item.id+' should have only one or two human hesitations');
    assert.deepEqual(
      narrationTokens.filter(token=>!/^(?:um|uh)$/i.test(token)),
      tokens(item.text),
      item.id+' narration must preserve every supplied transcript word in order'
    );
  }
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


test('Neural SST fallback remains Edge neural rather than robotic local speech', async () => {
  const source=await fs.readFile(require.resolve('../writing-lab-audio'),'utf8');
  assert.match(source,/createEdgeNarration/);
  assert.match(source,/edge-tts/);
  assert.match(source,/--rate=-5%/);
  assert.match(source,/OpenAI neural narration unavailable/);
  assert.match(source,/Edge neural fallback generated audio/);
  assert.match(source,/openAiNeuralRetryAt/);
  assert.doesNotMatch(source,/openAiNeuralUnavailable\s*=\s*true/);
  const neuralBlock=source.slice(source.indexOf('if(input.requireNeural)'),source.indexOf("if(process.env.OPENAI_API_KEY)",source.indexOf('if(input.requireNeural)')+1));
  assert.doesNotMatch(neuralBlock,/createLocalNarration/);
});
