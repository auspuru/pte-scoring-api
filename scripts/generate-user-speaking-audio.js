'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..','content','speaking-audio'),hash=data=>crypto.createHash('sha256').update(data).digest('hex');
async function main(){
 let manifest={};const file=path.join(root,'user-manifest.json');try{manifest=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 for(const q of require('../content/user-speaking-oct24.json')){
  const target=path.join(root,q.id+'.mp3'),textHash=hash(q.text);let bytes;try{bytes=await fs.readFile(target);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(bytes&&manifest[q.id]?.textSha256===textHash&&manifest[q.id]?.audioSha256===hash(bytes)){console.log(q.id,'verified');continue;}
  if(!process.env.OPENAI_API_KEY)throw Error('Narration API is not configured.');
  const response=await fetch('https://api.openai.com/v1/audio/speech',{method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},signal:AbortSignal.timeout(90000),body:JSON.stringify({model:'tts-1',voice:'alloy',input:q.text,response_format:'mp3',speed:1+parseInt(q.audioRate,10)/100})});
  if(!response.ok)throw Error('Narration failed: HTTP '+response.status);
  bytes=Buffer.from(await response.arrayBuffer());await fs.writeFile(target,bytes);
  const seconds=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',target],{encoding:'utf8'}));
  const bounds=q.type==='rl'?[45,90]:[5,35];if(!Number.isFinite(seconds)||seconds<bounds[0]||seconds>bounds[1])throw Error(q.id+' duration '+seconds+' outside '+bounds.join('–'));
  execFileSync('ffmpeg',['-v','error','-i',target,'-f','null','-']);
  manifest[q.id]={textSha256:textHash,audioSha256:hash(bytes),bytes:bytes.length,seconds:Math.round(seconds*1000)/1000,voices:['openai:tts-1:alloy']};await fs.writeFile(file,JSON.stringify(manifest,null,2)+'\n');console.log(q.id,seconds.toFixed(2),'seconds');
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
