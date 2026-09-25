'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash, randomUUID } = require('node:crypto');
const run = promisify(execFile);
const bank = require('./content/writing-lab.json');
const predictions = require('./content/writing-predictions-sep-2026');
const RUNTIME_CACHE_VERSION = 'openai-tts1-hd-realism-v7';
const PREVIOUS_RUNTIME_CACHE_VERSIONS = [];
const SPEECH_CLEANUP_FILTER = [
  'highpass=f=60',
  'lowpass=f=18000',
  'acompressor=threshold=-20dB:ratio=1.6:attack=15:release=180:makeup=1.5',
  'loudnorm=I=-18:TP=-1.5:LRA=7',
  'alimiter=limit=0.95',
  'aresample=48000'
].join(',');
const OPENAI_RETRY_COOLDOWN_MS = 5 * 60 * 1000;

async function writeAtomic(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive:true });
  const tmp = file + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(tmp, bytes);
    await fs.rename(tmp, file);
  } finally {
    await fs.unlink(tmp).catch(()=>{});
  }
}

function wavFromPcm16(pcm, sampleRate=48000) {
  const dataBytes=pcm.byteLength;
  const header=Buffer.alloc(44);
  header.write('RIFF',0); header.writeUInt32LE(36+dataBytes,4); header.write('WAVE',8);
  header.write('fmt ',12); header.writeUInt32LE(16,16); header.writeUInt16LE(1,20);
  header.writeUInt16LE(1,22); header.writeUInt32LE(sampleRate,24);
  header.writeUInt32LE(sampleRate*2,28); header.writeUInt16LE(2,32); header.writeUInt16LE(16,34);
  header.write('data',36); header.writeUInt32LE(dataBytes,40);
  return Buffer.concat([header,Buffer.from(pcm.buffer,pcm.byteOffset,pcm.byteLength)]);
}

function createAmbiencePcm(seconds, effects, sampleRate=48000) {
  const count=Math.max(1,Math.ceil(seconds*sampleRate));
  const pcm=new Int16Array(count);
  let state=0x13579bdf;
  const rand=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/0xffffffff)*2-1;
  const add=(index,value)=>{ if(index>=0&&index<count) pcm[index]=Math.max(-32768,Math.min(32767,pcm[index]+Math.round(value))); };

  for(const effect of effects||[]) {
    if(effect.type==='room') {
      let smooth=0;
      for(let i=0;i<count;i++) {
        const white=rand();
        smooth=smooth*0.985+white*0.015;
        add(i,(smooth*70+white*8));
      }
    } else if(effect.type==='clock') {
      const start=Math.max(0,Number(effect.start||8));
      const end=Math.min(seconds,start+Math.max(1,Number(effect.duration||8)));
      for(let tick=start;tick<end;tick+=1) {
        const base=Math.floor(tick*sampleRate);
        const length=Math.floor(0.028*sampleRate);
        for(let j=0;j<length;j++) {
          const t=j/sampleRate, env=Math.exp(-t*115);
          add(base+j,env*(170*Math.sin(2*Math.PI*2300*t)+75*Math.sin(2*Math.PI*3450*t)));
        }
      }
    } else if(effect.type==='paper') {
      const at=Math.min(Math.max(0,Number(effect.at||12)),Math.max(0,seconds-0.8));
      const base=Math.floor(at*sampleRate), length=Math.floor(0.55*sampleRate);
      let previous=0;
      for(let j=0;j<length;j++) {
        const x=rand(), high=x-previous*0.72; previous=x;
        const p=j/length, env=Math.sin(Math.PI*Math.min(1,p))*Math.sin(Math.PI*Math.min(1,p));
        add(base+j,high*135*env);
      }
    }
  }
  return pcm;
}

async function normalizeMp3(bytes, input={}) {
  const stem = path.join(os.tmpdir(), 'ipt-normalize-audio-' + randomUUID());
  const source = stem + '-source.wav', ambience = stem + '-ambience.wav', output = stem + '.mp3';
  try {
    await fs.writeFile(source, bytes);
    const effects=Array.isArray(input.ambience)?input.ambience:[];
    if(effects.length) {
      const { stdout }=await run('ffprobe',[
        '-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',source
      ],{timeout:15000,maxBuffer:1024*1024});
      const seconds=Math.max(1,Math.min(360,Number.parseFloat(stdout)||90));
      await fs.writeFile(ambience,wavFromPcm16(createAmbiencePcm(seconds,effects)));
      await run('ffmpeg', [
        '-loglevel','error','-y','-i',source,'-i',ambience,
        '-filter_complex',
        '[0:a]'+SPEECH_CLEANUP_FILTER+'[speech];[1:a]highpass=f=90,lowpass=f=12000[amb];[speech][amb]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95,aresample=48000[out]',
        '-map','[out]','-codec:a','libmp3lame','-b:a','192k','-ar','48000','-ac','1',output
      ], { timeout:120000, maxBuffer:10 * 1024 * 1024 });
    } else {
      await run('ffmpeg', [
        '-loglevel', 'error', '-y', '-i', source,
        '-af', SPEECH_CLEANUP_FILTER,
        '-codec:a', 'libmp3lame', '-b:a', '192k', '-ar', '48000', '-ac', '1', output
      ], { timeout:120000, maxBuffer:10 * 1024 * 1024 });
    }
    const normalized = await fs.readFile(output);
    if (normalized.length < 1000) throw Error('Normalized narration output was empty.');
    return normalized;
  } finally {
    await Promise.allSettled([fs.unlink(source), fs.unlink(ambience), fs.unlink(output)]);
  }
}

async function createLocalNarration(input) {
  const stem = path.join(os.tmpdir(), 'ipt-writing-audio-' + randomUUID());
  const wav = stem + '.wav', mp3 = stem + '.mp3';
  const rate = Math.max(125, Math.min(185, Math.round(160 * Number(input.speed || 1))));
  try {
    await run('espeak', ['-v', 'en-us', '-s', String(rate), '-w', wav, String(input.input || '')], {
      timeout: 60000, maxBuffer: 10 * 1024 * 1024
    });
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '64k', mp3], {
      timeout: 60000, maxBuffer: 10 * 1024 * 1024
    });
    const bytes = await fs.readFile(mp3);
    if (bytes.length < 1000) throw Error('Local narration output was empty.');
    return bytes;
  } finally {
    await Promise.allSettled([fs.unlink(wav), fs.unlink(mp3)]);
  }
}
async function createEdgeNarration(input) {
  const mp3 = path.join(os.tmpdir(), 'ipt-edge-audio-' + randomUUID() + '.mp3');
  const executable = path.join(__dirname, '.edge-tts', 'bin', 'edge-tts');
  try {
    await run(executable, [
      '--voice', input.edgeVoice || 'en-AU-NatashaNeural',
      '--rate=-5%',
      '--text', String(input.input || ''),
      '--write-media', mp3
    ], { timeout: 90000, maxBuffer: 2 * 1024 * 1024 });
    const bytes = await fs.readFile(mp3);
    if (bytes.length < 1000) throw Error('Edge neural narration output was empty.');
    const { stdout } = await run('ffprobe', [
      '-v','error','-select_streams','a:0',
      '-show_entries','stream=sample_rate,bit_rate',
      '-of','json',mp3
    ], { timeout:15000, maxBuffer:1024*1024 });
    const stream = JSON.parse(stdout || '{}')?.streams?.[0] || {};
    const sampleRate = Number(stream.sample_rate || 0);
    const bitRate = Number(stream.bit_rate || 0);
    if (sampleRate !== 48000 || bitRate < 180000) {
      throw Error('Edge neural source is not native HD ('+sampleRate+' Hz / '+bitRate+' bps).');
    }
    console.log('[writing-audio] Edge native HD source: '+sampleRate+' Hz / '+bitRate+' bps.');
    return bytes;
  } finally {
    await fs.unlink(mp3).catch(()=>{});
  }
}
function createNarration(directory, generate, { bundledDirectory, cacheVersion, previousCacheVersions=[], postProcess } = {}) {
  const pending = new Map();
  let manifest;
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,16);
  const usable = async file => {
    try { return (await fs.stat(file)).size > 1000; }
    catch(error) { if(error.code === 'ENOENT') return false; throw error; }
  };
  async function get(id) {
    const q = [...bank.spoken, ...(bank.dictation || []), ...bank.mocks.flatMap(mock => mock.questions), ...(predictions.sst || []), ...(predictions.wfd || [])].find(item => item.id === id && ['sst', 'wfd'].includes(item.type));
    if (!q) throw Object.assign(Error('Recording not found.'), { status: 404 });
    if (bundledDirectory) {
      manifest ||= JSON.parse(await fs.readFile(path.join(bundledDirectory, 'manifest.json'), 'utf8'));
      const entry = manifest[id], bundledFile = path.resolve(bundledDirectory, id + '.mp3');
      // Content hashes prevent an edited lecture from using an old recording.
      if (entry?.textSha256 === createHash('sha256').update(q.text).digest('hex') && entry.bytes > 1000) {
        try { if ((await fs.stat(bundledFile)).size === entry.bytes) return bundledFile; }
        catch(error) { if(error.code !== 'ENOENT') throw error; }
      }
    }
    const neural = q.audioMode === 'runtime-neural';
    const input = { model:q.ttsModel || 'tts-1', voice:q.voice, edgeVoice:q.edgeVoice, input:q.narrationText || q.text, response_format:neural ? 'wav' : 'mp3', speed:q.audioSpeed || 0.95, instructions:q.audioInstructions || '', ambience:q.audioAmbience || [], requireNeural:neural };
    const legacyHash = digest(input);
    const hash = digest(cacheVersion ? { ...input, cacheVersion } : input);
    const file = path.resolve(directory, id + '-' + hash + '.mp3');
    if(await usable(file)) return file;
    if(!pending.has(file)) {
      const task=(async()=>{
        // A processing-only cache upgrade reuses an already-generated recording.
        // Search both the pre-version cache key and explicitly supported prior
        // processing versions so cleanup/encoding upgrades never spend TTS again.
        const candidateHashes = [
          legacyHash,
          ...previousCacheVersions.map(version => digest({ ...input, cacheVersion:version }))
        ];
        let sourceFile = null;
        for (const candidateHash of candidateHashes) {
          const candidate = path.resolve(directory, id + '-' + candidateHash + '.mp3');
          if (candidate !== file && await usable(candidate)) { sourceFile = candidate; break; }
        }
        let bytes = sourceFile ? await fs.readFile(sourceFile) : await generate(input);
        if(postProcess) bytes=await postProcess(bytes, input);
        if(!Buffer.isBuffer(bytes) || bytes.length<1000 || bytes.length>8*1024*1024) throw Error('Invalid narration response.');
        await writeAtomic(file,bytes);
        return file;
      })();
      pending.set(file,task);task.finally(()=>pending.delete(file)).catch(()=>{});
    }
    return pending.get(file);
  }
  return { get };
}
async function prewarmNarration(narration, ids, { attempts=3, baseDelayMs=1000, sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)), logger=console } = {}) {
  const failed=[];
  let succeeded=0;
  for(const id of ids) {
    let lastError;
    for(let attempt=1; attempt<=attempts; attempt++) {
      try {
        await narration.get(id);
        logger.log('[writing-audio] Prewarmed '+id);
        succeeded++;
        lastError=null;
        break;
      } catch(error) {
        lastError=error;
        if(attempt<attempts) {
          logger.warn('[writing-audio] Prewarm retry '+attempt+'/'+attempts+' for '+id+': '+error.message);
          await sleep(baseDelayMs * 2 ** (attempt - 1));
        }
      }
    }
    if(lastError) {
      failed.push(id);
      logger.warn('[writing-audio] Prewarm failed for '+id+'; continuing: '+lastError.message);
    }
  }
  logger.log('[writing-audio] Prewarm complete: '+succeeded+'/'+ids.length+' cached'+(failed.length ? '; failed: '+failed.join(', ') : ''));
  return { total:ids.length, succeeded, failed };
}
function installNarration(app, directory, { prewarm=true } = {}) {
  let openAiNeuralRetryAt = 0;
  const narration=createNarration(directory,async input=>{
    if(input.preferLocal) return createLocalNarration(input);
    if(input.requireNeural) {
      if(process.env.OPENAI_API_KEY && Date.now() >= openAiNeuralRetryAt) {
        try {
          const response=await fetch('https://api.openai.com/v1/audio/speech',{method:'POST',
            headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},
            body:JSON.stringify({
              model:input.model,
              voice:input.voice,
              input:input.input,
              response_format:input.response_format,
              speed:input.speed,
              ...(input.instructions && !/^tts-1(?:-hd)?$/.test(input.model) ? {instructions:input.instructions} : {})
            }),signal:AbortSignal.timeout(60000)});
          if(response.ok) {
            openAiNeuralRetryAt=0;
            console.log('[writing-audio] OpenAI quality-optimized HD master generated audio.');
            return Buffer.from(await response.arrayBuffer());
          }
          let detail='HTTP '+response.status, code='';
          try {
            const payload=await response.json();
            code=String(payload?.error?.code || payload?.error?.type || '');
            detail+=' '+code.slice(0,80)+' '+String(payload?.error?.message || '').slice(0,180);
          } catch (_) {}
          if([401,403].includes(response.status) || (response.status===429 && /credit_balance_exhausted|insufficient_quota/.test(code)))
            openAiNeuralRetryAt=Date.now()+OPENAI_RETRY_COOLDOWN_MS;
          console.warn('[writing-audio] OpenAI HD master unavailable:',detail.trim());
        } catch(error) {
          console.warn('[writing-audio] OpenAI HD master failed:',String(error.message || error).slice(0,240));
        }
      }
      throw Error('Natural HD narration is temporarily unavailable. Please retry shortly.');
    }
    if(process.env.OPENAI_API_KEY) {
      try {
        const response=await fetch('https://api.openai.com/v1/audio/speech',{method:'POST',
          headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},
          body:JSON.stringify({model:input.model,voice:input.voice,input:input.input,response_format:input.response_format,speed:input.speed,...(input.instructions?{instructions:input.instructions}:{})}),signal:AbortSignal.timeout(60000)});
        if(response.ok) return Buffer.from(await response.arrayBuffer());
        console.warn('[writing-audio] Remote narration returned HTTP '+response.status+'; using local narrator.');
      } catch (error) {
        console.warn('[writing-audio] Remote narration failed; using local narrator:', error.message);
      }
    }
    return createLocalNarration(input);
  }, {
    bundledDirectory:path.join(__dirname, 'content', 'writing-audio'),
    cacheVersion:RUNTIME_CACHE_VERSION,
    previousCacheVersions:PREVIOUS_RUNTIME_CACHE_VERSIONS,
    postProcess:normalizeMp3
  });
  // Bundled files have no synthesis cost. Range requests and students sharing a
  // classroom IP must not consume the old narration-generation request quota.
  app.get('/writing-audio/:id.mp3',async(req,res)=>{
    try {
      const file=await narration.get(req.params.id);
      res.type('audio/mpeg');res.set('Cache-Control','public, max-age=3600');res.sendFile(file);
    } catch(e) {
      console.warn('[writing-audio]',e.message);
      res.set('Cache-Control','no-store');
      res.status(e.status||503).json({error:e.status?e.message:'The recording could not be loaded. Please retry shortly.'});
    }
  });
  const runtimeIds=(predictions.sst||[]).filter(q=>q.audioMode==='runtime-neural').map(q=>q.id);
  if(prewarm) setImmediate(()=>prewarmNarration(narration,runtimeIds).catch(error=>
    console.warn('[writing-audio] Prewarm task failed:',error.message)));
  return narration;
}
module.exports={createNarration,createLocalNarration,createEdgeNarration,normalizeMp3,createAmbiencePcm,wavFromPcm16,prewarmNarration,installNarration};
