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
    return bytes;
  } finally {
    await fs.unlink(mp3).catch(()=>{});
  }
}
function createNarration(directory, generate, { bundledDirectory } = {}) {
  const pending = new Map();
  let manifest;
  async function get(id) {
    const q = [...bank.spoken, ...(bank.dictation || []), ...bank.mocks.flatMap(mock => mock.questions), ...(predictions.sst || []), ...(predictions.wfd || [])].find(item => item.id === id && ['sst', 'wfd'].includes(item.type));
    if (!q) throw Object.assign(Error('Recording not found.'), { status: 404 });
    if (bundledDirectory) {
      manifest ||= JSON.parse(await fs.readFile(path.join(bundledDirectory, 'manifest.json'), 'utf8'));
      const entry = manifest[id], bundledFile = path.resolve(bundledDirectory, id + '.mp3');
      // Content hashes prevent an edited lecture from using an old recording.
      if (entry?.textSha256 === createHash('sha256').update(q.text).digest('hex') &&
          entry.bytes > 1000 && (await fs.stat(bundledFile)).size === entry.bytes) return bundledFile;
    }
    const input = { model:q.ttsModel || 'tts-1', voice:q.voice, edgeVoice:q.edgeVoice, input:q.narrationText || q.text, response_format:'mp3', speed:q.audioSpeed || 0.95, instructions:q.audioInstructions || '', requireNeural:q.audioMode === 'runtime-neural' };
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0,16);
    const file = path.resolve(directory, id + '-' + hash + '.mp3');
    try { if((await fs.stat(file)).size > 1000) return file; } catch(e) { if(e.code !== 'ENOENT') throw e; }
    if(!pending.has(id)) {
      const task=(async()=>{
        const bytes=await generate(input);
        if(!Buffer.isBuffer(bytes) || bytes.length<1000 || bytes.length>8*1024*1024) throw Error('Invalid narration response.');
        await fs.mkdir(directory,{recursive:true});
        const tmp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(tmp,bytes);await fs.rename(tmp,file);
        return file;
      })();
      pending.set(id,task);task.finally(()=>pending.delete(id)).catch(()=>{});
    }
    return pending.get(id);
  }
  return { get };
}
function installNarration(app, directory) {
  let openAiNeuralUnavailable = false;
  const narration=createNarration(directory,async input=>{
    if(input.preferLocal) return createLocalNarration(input);
    if(input.requireNeural) {
      if(process.env.OPENAI_API_KEY && !openAiNeuralUnavailable) {
        try {
          const response=await fetch('https://api.openai.com/v1/audio/speech',{method:'POST',
            headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},
            body:JSON.stringify({model:input.model,voice:input.voice,input:input.input,response_format:input.response_format,speed:input.speed,...(input.instructions?{instructions:input.instructions}:{})}),signal:AbortSignal.timeout(60000)});
          if(response.ok) return Buffer.from(await response.arrayBuffer());
          let detail='HTTP '+response.status, code='';
          try {
            const payload=await response.json();
            code=String(payload?.error?.code || payload?.error?.type || '');
            detail+=' '+code.slice(0,80)+' '+String(payload?.error?.message || '').slice(0,180);
          } catch (_) {}
          if(response.status===429 && /credit_balance_exhausted|insufficient_quota/.test(code)) openAiNeuralUnavailable=true;
          console.warn('[writing-audio] OpenAI neural narration unavailable:',detail.trim());
        } catch(error) {
          console.warn('[writing-audio] OpenAI neural narration failed:',String(error.message || error).slice(0,240));
        }
      }
      try {
        const bytes=await createEdgeNarration(input);
        console.log('[writing-audio] Edge neural fallback generated audio.');
        return bytes;
      } catch(error) {
        console.warn('[writing-audio] Edge neural fallback failed:',String(error.message || error).slice(0,240));
        throw Error('Natural narration is temporarily unavailable. Please retry shortly.');
      }
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
  }, { bundledDirectory: path.join(__dirname, 'content', 'writing-audio') });
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
  setImmediate(async()=>{
    for(const id of runtimeIds) {
      try {
        await narration.get(id);
        console.log('[writing-audio] Prewarmed '+id);
      } catch(error) {
        console.warn('[writing-audio] Prewarm stopped at '+id+': '+error.message);
        break;
      }
    }
  });
  return narration;
}
module.exports={createNarration,createLocalNarration,createEdgeNarration,installNarration};
