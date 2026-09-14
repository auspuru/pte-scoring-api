'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const bank = require('./content/writing-lab.json');
function createNarration(directory, generate) {
  const pending = new Map();
  async function get(id) {
    const q = bank.spoken.find(item => item.id === id);
    if (!q) throw Object.assign(Error('Recording not found.'), { status: 404 });
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
    if(!process.env.OPENAI_API_KEY) throw Error('Narration is not configured.');
    const response=await fetch('https://api.openai.com/v1/audio/speech',{method:'POST',
      headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify(input),signal:AbortSignal.timeout(60000)});
    if(!response.ok) throw Error('Narration provider returned HTTP '+response.status);
    return Buffer.from(await response.arrayBuffer());
  });
  const rateLimit=require('express-rate-limit');
  app.get('/writing-audio/:id.mp3',rateLimit({windowMs:60000,max:30,standardHeaders:true,legacyHeaders:false,
    message:{error:'Please wait before requesting more recordings.'}}),async(req,res)=>{
    try {
      const file=await narration.get(req.params.id);
      res.type('audio/mpeg');res.set('Cache-Control','public, max-age=3600');res.sendFile(file);
    } catch(e) {
      console.warn('[writing-audio]',e.message);
      res.status(e.status||503).json({error:e.status?e.message:'The recording could not be loaded. Please retry shortly.'});
    }
  });
  return narration;
}
module.exports={createNarration,installNarration};
