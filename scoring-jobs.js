'use strict';
// Small, durable work records. Audio stays in the owning application's store.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>crypto.createHash('sha256').update(Buffer.isBuffer(value)||typeof value==='string'?value:JSON.stringify(canonical(value))).digest('hex');
function createJobs({pool,directory,table,now=Date.now}={}){
  if(!['speaking_answer_jobs','academy_di_jobs'].includes(table))throw Error('Invalid job namespace.');
  let ready,lock=Promise.resolve();
  const file=id=>path.join(directory,hash(id)+'.json');
  async function initialise(){return ready||=Promise.resolve().then(async()=>{
    if(pool)await pool.query(`CREATE TABLE IF NOT EXISTS ${table}(id TEXT PRIMARY KEY,owner TEXT NOT NULL ${table==='speaking_answer_jobs'?'REFERENCES accounts(username) ON DELETE CASCADE':''},group_id TEXT NOT NULL,input_hash TEXT NOT NULL,data JSONB NOT NULL,status TEXT NOT NULL DEFAULT 'pending',run_after BIGINT NOT NULL DEFAULT 0,lease_token TEXT,lease_until BIGINT NOT NULL DEFAULT 0,updated_at BIGINT NOT NULL);
      CREATE INDEX IF NOT EXISTS ${table}_due ON ${table}(status,run_after);
      CREATE INDEX IF NOT EXISTS ${table}_group ON ${table}(owner,group_id)`);
    else await fs.mkdir(directory,{recursive:true});
  }).catch(e=>{ready=null;throw e;});}
  async function serial(fn){const task=lock.catch(()=>{}).then(fn);lock=task;return task;}
  async function readFile(id){try{return JSON.parse(await fs.readFile(file(id),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
  async function write(row){const target=file(row.id),tmp=target+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(tmp,JSON.stringify(row),{mode:0o600});await fs.rename(tmp,target);return row;}
  async function enqueue({id,owner,groupId,inputHash,data}){
    await initialise();let row;
    if(pool){await pool.query(`INSERT INTO ${table}(id,owner,group_id,input_hash,data,updated_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING`,[id,owner,groupId,inputHash,JSON.stringify(data),now()]);row=await get(owner,id);}
    else row=await serial(async()=>{const old=await readFile(id);return old||write({id,owner,group_id:groupId,input_hash:inputHash,data,status:'pending',run_after:0,lease_until:0,updated_at:now()});});
    if(!row||row.owner!==owner||row.input_hash!==inputHash)throw Object.assign(Error('Job identity was reused with different input.'),{status:409});return row;
  }
  async function get(owner,id){await initialise();const row=pool?(await pool.query(`SELECT * FROM ${table} WHERE id=$1 AND owner=$2`,[id,owner])).rows[0]:await readFile(id);return row?.owner===owner?row:null;}
  async function list(owner,groupId){await initialise();if(pool)return(await pool.query(`SELECT * FROM ${table} WHERE owner=$1 AND group_id=$2 ORDER BY id`,[owner,groupId])).rows;
    await lock.catch(()=>{});const rows=await Promise.all((await fs.readdir(directory)).filter(f=>f.endsWith('.json')).map(async f=>JSON.parse(await fs.readFile(path.join(directory,f),'utf8'))));return rows.filter(r=>r.owner===owner&&r.group_id===groupId);}
  async function claim(){await initialise();const token=crypto.randomUUID(),time=now();
    if(pool)return(await pool.query(`WITH due AS (SELECT id FROM ${table} WHERE (status IN ('pending','retry_wait') AND run_after <= $1) OR (status='running' AND lease_until < $1) ORDER BY run_after,updated_at LIMIT 1 FOR UPDATE SKIP LOCKED) UPDATE ${table} j SET status='running',lease_token=$2,lease_until=$3,updated_at=$1 FROM due WHERE j.id=due.id RETURNING j.*`,[time,token,time+180000])).rows[0]||null;
    return serial(async()=>{for(const name of await fs.readdir(directory)){if(!name.endsWith('.json'))continue;const r=JSON.parse(await fs.readFile(path.join(directory,name),'utf8'));if((['pending','retry_wait'].includes(r.status)&&r.run_after<=time)||(r.status==='running'&&r.lease_until<time))return write({...r,status:'running',lease_token:token,lease_until:time+180000,updated_at:time});}return null;});
  }
  async function save(row,data,{status='running',runAfter=0}={}){const time=now();
    if(pool){const r=await pool.query(`UPDATE ${table} SET data=$3,status=$4,run_after=$5,lease_until=$6,updated_at=$7 WHERE id=$1 AND lease_token=$2 AND status='running' RETURNING id`,[row.id,row.lease_token,JSON.stringify(data),status,runAfter,time+180000,time]);if(!r.rows.length)throw Error('Job lease lost.');}
    else await serial(async()=>{const r=await readFile(row.id);if(r.lease_token!==row.lease_token||r.status!=='running')throw Error('Job lease lost.');await write({...r,data,status,run_after:runAfter,lease_until:time+180000,updated_at:time});});
  }
  async function heartbeat(row){if(pool)await pool.query(`UPDATE ${table} SET lease_until=$3 WHERE id=$1 AND lease_token=$2 AND status='running'`,[row.id,row.lease_token,now()+180000]);else await serial(async()=>{const r=await readFile(row.id);if(r?.lease_token===row.lease_token&&r.status==='running')await write({...r,lease_until:now()+180000});});}
  async function retry(owner,id,{stages,operation,acknowledgeUncertain=false}={}){
    if(!Array.isArray(stages)||!stages.length||stages.length>6||stages.some(s=>typeof s!=='string'||!/^[a-z]{1,24}$/.test(s))||typeof operation!=='string'||!/^[a-zA-Z0-9:_-]{1,120}$/.test(operation))throw Object.assign(Error('Invalid repair scope.'),{status:400});
    const change=row=>{if(!row||row.owner!==owner)throw Object.assign(Error('Job not found.'),{status:404});if(row.data.repairs?.some(r=>r.operation===operation))return null;if(row.status!=='needs_attention')throw Object.assign(Error('This job is not held for repair.'),{status:409});
      const data=structuredClone(row.data);for(const name of stages){const prior=data.stages?.[name];if(prior?.status!=='needs_attention')throw Object.assign(Error('Only held stages can be repaired.'),{status:409});if(prior.failure==='uncertain_provider_outcome'&&!acknowledgeUncertain)throw Object.assign(Error('Inspect provider usage and acknowledge the uncertain call before retrying.'),{status:409});data.stages[name]={status:'pending',attempts:0};}
      data.repairs=[...(data.repairs||[]).slice(-19),{operation,stages,at:now(),acknowledgeUncertain:!!acknowledgeUncertain}];return data;};
    if(pool){const row=await get(owner,id),data=change(row);if(!data)return row;const result=await pool.query(`UPDATE ${table} SET data=$3,status='pending',run_after=0,lease_token=NULL,lease_until=0,updated_at=$4 WHERE id=$1 AND owner=$2 AND status='needs_attention' AND lease_token IS NOT DISTINCT FROM $5 RETURNING id`,[id,owner,JSON.stringify(data),now(),row.lease_token]);if(!result.rows.length)throw Object.assign(Error('Job changed during repair.'),{status:409});return get(owner,id);}
    return serial(async()=>{const row=await readFile(id),data=change(row);return data?write({...row,data,status:'pending',run_after:0,lease_until:0,lease_token:null,updated_at:now()}):row;});
  }
  return{initialise,enqueue,get,list,claim,save,heartbeat,retry};
}
function createWorker({store,run,onSettled=async()=>{},concurrency=2,intervalMs=2000,now=Date.now}={}){
  const active=new Set();let timer,stopped=false,pumping;
  async function execute(row){let data=structuredClone(row.data),writes=Promise.resolve();
    const ctx={row,get data(){return data;},save(fn){writes=writes.then(async()=>{fn(data);await store.save(row,data);});return writes;}};
    const heartbeat=setInterval(()=>store.heartbeat(row).catch(()=>{}),30000);heartbeat.unref?.();
    try{const final=await run(ctx);await writes;await store.save(row,data,final||{status:'ready'});if(final?.status==='needs_attention')console.warn('[scoring-job]',JSON.stringify({id:row.id,status:'needs_attention',failures:Object.entries(data.stages||{}).filter(([,s])=>s.status==='needs_attention').map(([stage,s])=>({stage,code:s.failure}))}));}
    catch(error){await writes.catch(()=>{});await store.save(row,data,{status:'retry_wait',runAfter:now()+30000}).catch(()=>{});console.warn('[scoring-job]',JSON.stringify({id:row.id,code:'worker_interrupted'}));}
    finally{clearInterval(heartbeat);await onSettled(row).catch(()=>{});}
  }
  async function wake(){if(stopped)return;if(pumping)return pumping;
    pumping=(async()=>{while(!stopped&&active.size<concurrency){const row=await store.claim();if(!row)break;const task=execute(row);active.add(task);task.finally(()=>{active.delete(task);if(!stopped)setImmediate(()=>wake().catch(()=>{}));});}})().finally(()=>{pumping=null;});return pumping;
  }
  function start(){stopped=false;if(!timer){timer=setInterval(()=>wake().catch(()=>console.warn('[scoring-job] queue temporarily unavailable')),intervalMs);timer.unref?.();}return wake();}
  async function wait(){for(let n=0;n<100;n++){await wake();if(!active.size)return;await Promise.allSettled([...active]);}}
  async function stop(){stopped=true;clearInterval(timer);await pumping;await Promise.allSettled([...active]);}
  return{wake,start,wait,stop};
}
// Record the paid-call boundary before sending. An expired in-flight call is
// held for staff investigation, rather than silently charging for it twice.
async function stage(ctx,name,call,{valid=()=>true,accept=()=>{},now=Date.now,maxAttempts=3}={}){
  const state=ctx.data.stages?.[name];if(state?.status==='ready')return state.value;
  if(state?.status==='calling'){await ctx.save(d=>{d.stages[name]={...state,status:'needs_attention',failure:'uncertain_provider_outcome'};});return;}
  if(state?.status==='needs_attention'||state?.nextAt>now())return;
  const attempts=(state?.attempts||0)+1;
  await ctx.save(d=>{d.stages||={};d.stages[name]={status:'calling',attempts,startedAt:now()};});
  try{const value=await call();await ctx.save(d=>{accept(d,value);d.stages[name]={status:valid(value,d)?'ready':attempts>=maxAttempts?'needs_attention':'retry_wait',attempts,...(valid(value,d)?{value}:{failure:'validation',nextAt:now()+15000*attempts})};});return value;}
  catch(error){const code=error?.uncertain?'uncertain_provider_outcome':error?.httpStatus||error?.providerStatus||error?.status||'provider';
    const terminal=error?.uncertain||[400,401,403,404,413,422].includes(code)||attempts>=maxAttempts;
    const safe=v=>typeof v==='string'&&/^[A-Za-z0-9_:-]{1,80}$/.test(v)?v:undefined;
    const detail={...(safe(error?.code)?{code:error.code}:{}),...(safe(error?.recognitionStatus)?{recognitionStatus:error.recognitionStatus}:{}),...(safe(error?.audioValidationCode)?{validation:error.audioValidationCode}:{})};
    await ctx.save(d=>{d.stages[name]={status:terminal?'needs_attention':'retry_wait',attempts,failure:code,...(Object.keys(detail).length?{detail}:{}),nextAt:now()+Math.min(120000,15000*2**(attempts-1))};});}
}
function disposition(data,ready,now=Date.now){if(ready)return{status:'ready'};const values=Object.values(data.stages||{});if(values.some(s=>s.status==='needs_attention'))return{status:'needs_attention'};return{status:'retry_wait',runAfter:Math.max(now()+2000,Math.min(...values.filter(s=>s.status==='retry_wait').map(s=>s.nextAt||now()+5000),now()+5000))};}
module.exports={createJobs,createWorker,stage,disposition,hash};
