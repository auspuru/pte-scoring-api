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
    const input = { model:'tts-1', voice:q.voice, input:q.text, response_format:'mp3', speed:0.95 };
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
  const narration=createNarration(directory,async input=>{
    if(process.env.OPENAI_API_KEY) {
      try {
        const response=await fetch('https://api.openai.com/v1/audio/speech',{method:'POST',
          headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},
          body:JSON.stringify(input),signal:AbortSignal.timeout(60000)});
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
  return narration;
}
module.exports={createNarration,createLocalNarration,installNarration};
