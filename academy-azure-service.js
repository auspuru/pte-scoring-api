'use strict';
const crypto=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path');
const express=require('express'),azure=require('./speaking-delivery');
const {createJobs,createWorker,stage,disposition,hash}=require('./scoring-jobs');
const VERSION='academy-azure-delivery-v1',OWNER='visual-academy';
const valid=result=>result?.deliveryProvider==='azure-speech-pronunciation'&&result.deliveryEvidence?.sufficient!==false&&['pronunciation','fluency'].every(name=>Number.isInteger(result[name]?.score)&&result[name].score>=0&&result[name].score<=5);
function installAcademyAzure(app,{pool,directory,secret='',assess=azure.assessRecording,transcribe,available=azure.isConfigured(),now=Date.now}={}){
  const jobs=createJobs({pool,directory:path.join(directory,'jobs'),table:'academy_azure_jobs',now});let timer;
  const audioPath=id=>path.join(directory,'audio',id+'.wav');
  async function initialise(){await jobs.initialise();if(pool)await pool.query('CREATE TABLE IF NOT EXISTS academy_azure_audio(id TEXT PRIMARY KEY REFERENCES academy_azure_jobs(id) ON DELETE CASCADE,bytes BYTEA NOT NULL,created_at BIGINT NOT NULL)');else await fs.mkdir(path.join(directory,'audio'),{recursive:true});}
  async function audio(id){if(pool)return(await pool.query('SELECT bytes FROM academy_azure_audio WHERE id=$1',[id])).rows[0]?.bytes||null;try{return await fs.readFile(audioPath(id));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
  const worker=createWorker({store:jobs,concurrency:2,now,run:async ctx=>{
    const bytes=await audio(ctx.row.id);if(!bytes)return{status:'retry_wait',runAfter:now()+5000};
    await stage(ctx,'azure',()=>assess({mime:'audio/wav',data:Buffer.from(bytes).toString('base64'),hash:ctx.data.recordingHash},{question:{type:'di'},transcript:ctx.data.transcript,transcribe,contentIndependent:true,chunkCache:ctx.data.chunks||{},checkpointChunk:(key,value)=>ctx.save(data=>{data.chunks||={};data.chunks[key]={...data.chunks[key],...value};})}),{now,valid,accept:(data,value)=>{if(valid(value))data.delivery=value;}});
    return disposition(ctx.data,valid(ctx.data.delivery),now);
  }});
  const router=express.Router();
  router.use((req,res,next)=>{const supplied=Buffer.from(String(req.headers.authorization||'')),expected=Buffer.from('Bearer '+secret);res.set('Cache-Control','no-store');if(secret.length<32||supplied.length!==expected.length||!crypto.timingSafeEqual(supplied,expected))return res.status(401).json({error:'Service authentication required.'});next();});
  const wrap=fn=>(req,res)=>Promise.resolve(fn(req,res)).catch(error=>res.status(error.status||503).json({error:error.status?error.message:'Azure assessment service is temporarily unavailable.'}));
  router.get('/capabilities',(_,res)=>res.json({version:VERSION,provider:'azure',ready:available}));
  router.post('/jobs',wrap(async(req,res)=>{
    if(!available)throw Object.assign(Error('Azure speech assessment is not configured.'),{status:503});
    const input=req.body;if(input?.version!==VERSION||!/^[a-f0-9]{64}$/.test(input.id||'')||!/^[a-f0-9]{64}$/.test(input.recordingHash||'')||typeof input.transcript!=='string'||!input.transcript.trim()||input.transcript.length>6000||typeof input.wav!=='string'||input.wav.length>4200000)throw Object.assign(Error('Invalid Azure assessment request.'),{status:400});
    const bytes=Buffer.from(input.wav,'base64'),seconds=azure.wavSeconds(bytes);
    if(bytes.length>3*1024*1024||hash(bytes)!==input.recordingHash||seconds<=0||seconds>45)throw Object.assign(Error('A verified PCM recording of up to 45 seconds is required.'),{status:400});
    const inputHash=hash({version:VERSION,recordingHash:input.recordingHash,transcript:input.transcript});
    await jobs.enqueue({id:input.id,owner:OWNER,groupId:input.id,inputHash,data:{version:VERSION,recordingHash:input.recordingHash,transcript:input.transcript,stages:{}}});
    if(pool)await pool.query('INSERT INTO academy_azure_audio(id,bytes,created_at) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[input.id,bytes,now()]);else try{await fs.writeFile(audioPath(input.id),bytes,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
    res.status(202).json({id:input.id,inputHash,version:VERSION});worker.wake().catch(()=>console.warn('[academy-azure] Queue scan will resume.'));
  }));
  router.post('/jobs/:id/retry',wrap(async(req,res)=>{
    if(!/^[a-f0-9]{64}$/.test(req.params.id))throw Object.assign(Error('Assessment not found.'),{status:404});
    const row=await jobs.retry(OWNER,req.params.id,{stages:['azure'],operation:req.body?.operation,acknowledgeUncertain:req.body?.acknowledgeUncertain===true});
    res.status(202).json({id:row.id,status:row.status});worker.wake().catch(()=>console.warn('[academy-azure] Repair queue scan will resume.'));
  }));
  router.get('/jobs/:id',wrap(async(req,res)=>{
    if(!/^[a-f0-9]{64}$/.test(req.params.id))throw Object.assign(Error('Assessment not found.'),{status:404});
    const row=await jobs.get(OWNER,req.params.id);if(!row)throw Object.assign(Error('Assessment not found.'),{status:404});
    res.json({id:row.id,version:VERSION,inputHash:row.input_hash,recordingHash:row.data.recordingHash,status:row.status,inputReady:!!await audio(row.id),delivery:row.data.delivery||null,failures:Object.entries(row.data.stages||{}).filter(([,s])=>s.status==='needs_attention').map(([name,s])=>({stage:name,code:s.failure}))});
  }));
  app.use('/internal/v1/academy-azure',router);
  return{jobs,async start(){await initialise();await worker.start();timer=setInterval(async()=>{if(!pool)return;try{await pool.query('DELETE FROM academy_azure_audio a USING academy_azure_jobs j WHERE a.id=j.id AND ((j.status IN (\'ready\',\'needs_attention\') AND j.updated_at<$1) OR a.created_at<$2)',[now()-86400000,now()-3*86400000]);await pool.query('DELETE FROM academy_azure_jobs WHERE updated_at<$1',[now()-90*86400000]);}catch{console.warn('[academy-azure] Audio cleanup will retry.');}},3600000);timer.unref?.();},async stop(){clearInterval(timer);await worker.stop();},wait:worker.wait};
}
module.exports={VERSION,valid,installAcademyAzure};
