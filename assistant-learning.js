'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const TASKS=new Set(['portal','swt','sst','essay','ra','rs','di','rl','rts','sgd','speaking','dropdown','wordbank','reorder','mcsa','mcma','hiw','hcs','wfd']);
const TOPICS=[
 ['pronunciation','Pronunciation and clarity',/pronun|accent|clarity|vowel|consonant|word stress/i],
 ['fluency','Fluency, pace and pauses',/fluen|hesitat|pace|pause|stutter|restart|filler/i],
 ['content','Main ideas and content selection',/content|main idea|supporting|key point|conclusion|relevant|which.*(?:line|sentence)|highlight/i],
 ['memory','Listening, retention and notes',/listen|remember|memory|retain|recall|note.?taking|notes|keyword/i],
 ['form','Form and length',/word count|length|how many words|form|one sentence|too long|too short/i],
 ['language','Grammar, vocabulary and spelling',/grammar|vocab|spell|tense/i],
 ['progress','Progress and study priorities',/progress|trend|improv|priorit|practi[cs]e next|weak|score|mark|study plan/i],
 ['method','Task method and structure',/template|structure|approach|how.*(?:attempt|start)|strategy|method/i],
 ['portal','Portal help',/button|record|microphone|audio|login|sync|skip|timer/i]
];
const clean=(v,n=1200)=>String(v??'').trim().slice(0,n);
function questionTopics(message){const hits=TOPICS.filter(([, ,re])=>re.test(clean(message,4000)));return hits.length?hits.map(([id,label])=>({id,label})).slice(0,3):[{id:'other',label:'Other questions'}];}
function feedbackPatterns(attempts,now=Date.now()) {
 const types=new Map(require('./content/speaking-bank').questions.map(q=>[q.id,q.type])),groups=new Map(),seen=new Set();
 for(const a of attempts||[]) {
  const at=Date.parse(a._updatedAt||a.startedAt),task=a.type||types.get(a.questionId),r=a.result;
  if(!r||a.status!=='submitted'||!TASKS.has(task)||!Number.isFinite(at)||at<now-90*86400000||seen.has(a.id))continue;
  seen.add(a.id);const labels=[];
  if(r.scoringMode==='ai'&&r.coverage?.some(c=>c.status==='missing'||c.status==='partial'))labels.push(task==='rts'?'Required situation points missing or incomplete':'Key ideas missing or incomplete');
  if(['ra','rs'].includes(task)&&r.changes?.some(c=>c.kind==='omission'))labels.push('Reference words missing in transcript');
  for(const label of labels){const key=task+':'+label;if(!groups.has(key))groups.set(key,{task,label,attempts:0});groups.get(key).attempts++;}
 }
 return [...groups.values()].filter(p=>p.attempts>=2);
}
function snapshot(profile,now){
 const cutoff=now-90*86400000;
 const areas=(profile?.areas||[]).filter(a=>TASKS.has(a.task)&&a.attempts>=2&&a.lastAt>=cutoff).slice(0,25).map(a=>({task:a.task,attempts:a.attempts,averagePct:a.averagePct,latestPct:a.latestPct,trend:a.trend,practiceAttempts:a.practiceAttempts,mockAttempts:a.mockAttempts}));
 const mistakes=(profile?.traitWeaknesses||[]).filter(t=>TASKS.has(t.taskCode)&&t.attempts>=2&&t.lastAt>=cutoff&&t.belowBenchmarkAttempts>=2&&t.averagePct<75&&areas.some(a=>a.task===t.taskCode)).map(t=>({task:t.taskCode,trait:clean(t.trait,80),averagePct:t.averagePct,attempts:t.attempts}));
 return {areas,mistakes,feedbackPatterns:(profile?.learningMistakes||[]).filter(p=>TASKS.has(p.task)&&p.attempts>=2).slice(0,25)};
}
function summarise(state,now=Date.now()){
 const cutoff=now-90*86400000,students=Object.entries(state.students||{}).filter(([,s])=>s.updatedAt>=cutoff);
 const topics=new Map(),areas=new Map(),mistakes=new Map(),feedback=new Map();
 for(const [uid,s] of students){
  for(const q of Object.values(s.questions||{}).filter(q=>q.at>=cutoff)){
   const key=q.task+':'+q.id;if(!topics.has(key))topics.set(key,{task:q.task,topic:q.label,studentDays:0,users:new Set()});const row=topics.get(key);row.studentDays++;row.users.add(uid);
  }
  for(const a of s.areas||[]){if(!areas.has(a.task))areas.set(a.task,{task:a.task,students:0,practiceAttempts:0,mockAttempts:0,averagePct:0,improving:0,declining:0,stable:0});const row=areas.get(a.task);row.students++;row.averagePct+=a.averagePct;row.practiceAttempts+=a.practiceAttempts||0;row.mockAttempts+=a.mockAttempts||0;if(['improving','declining','stable'].includes(a.trend))row[a.trend]++;}
  for(const p of s.feedbackPatterns||[]){const key=p.task+':'+p.label;if(!feedback.has(key))feedback.set(key,{task:p.task,label:p.label,students:0,attempts:0});const row=feedback.get(key);row.students++;row.attempts+=p.attempts;}
  for(const m of s.mistakes||[]){const key=m.task+':'+m.trait;if(!mistakes.has(key))mistakes.set(key,{task:m.task,trait:m.trait,students:0,averagePct:0});const row=mistakes.get(key);row.students++;row.averagePct+=m.averagePct;}
 }
 return {generatedAt:new Date(now).toISOString(),windowDays:90,observedStudents:students.length,
  topics:[...topics.values()].map(({users,...r})=>({...r,students:users.size})).sort((a,b)=>b.students-a.students),
  areas:[...areas.values()].map(r=>({...r,averagePct:Math.round(r.averagePct/r.students)})).sort((a,b)=>b.students-a.students),
  mistakes:[...mistakes.values()].map(r=>({...r,averagePct:Math.round(r.averagePct/r.students),label:'Repeated lower '+r.trait.toLowerCase()+' scores'})).sort((a,b)=>b.students-a.students),
  feedbackPatterns:[...feedback.values()].sort((a,b)=>b.students-a.students),
  guidance:state.guidance||[],updatedAt:state.updatedAt||null};
}
function createLearningStore(pool,directory,{clock=Date.now}={}){
 let ready,queue=Promise.resolve();const file=path.join(directory,'assistant-learning.json');
 async function init(){if(!ready)ready=(async()=>{if(pool)await pool.query("CREATE TABLE IF NOT EXISTS assistant_learning (id TEXT PRIMARY KEY, data JSONB NOT NULL)");else await fs.mkdir(directory,{recursive:true});})().catch(e=>{ready=null;throw e;});await ready;}
 const fresh=()=>({salt:crypto.randomBytes(32).toString('hex'),students:{},guidance:[]});
 async function mutate(fn){await init();if(pool){const client=await pool.connect();try{await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtextextended('assistant-learning',0))");const {rows}=await client.query("SELECT data FROM assistant_learning WHERE id='coaching' FOR UPDATE");const state=rows[0]?.data||fresh();const result=fn(state);await client.query("INSERT INTO assistant_learning(id,data) VALUES('coaching',$1) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data",[JSON.stringify(state)]);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}
  const task=queue.catch(()=>{}).then(async()=>{let state;try{state=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;state=fresh();}const result=fn(state),tmp=file+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(tmp,JSON.stringify(state),{mode:0o600});await fs.rename(tmp,file);return result;});queue=task.catch(()=>{});return task;
 }
 async function read(){await init();await queue;if(pool){const {rows}=await pool.query("SELECT data FROM assistant_learning WHERE id='coaching'");return rows[0]?.data||{students:{},guidance:[]};}try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return {students:{},guidance:[]};throw e;}}
 async function observe(uid,profile,{task='portal',message=''}={}){return mutate(state=>{const now=clock(),cutoff=now-90*86400000;
  for(const [key,s] of Object.entries(state.students))if(s.updatedAt<cutoff)delete state.students[key];
  const id=crypto.createHmac('sha256',state.salt).update(clean(uid,200).toLowerCase()).digest('hex');
  const prior=state.students[id]||{questions:{}};for(const [key,q] of Object.entries(prior.questions))if(q.at<cutoff)delete prior.questions[key];
  if(message)for(const topic of questionTopics(message)){const day=new Date(now).toISOString().slice(0,10);prior.questions[day+':'+task+':'+topic.id]={task:TASKS.has(task)?task:'portal',...topic,at:now};}
  state.students[id]={...prior,...snapshot(profile,now),updatedAt:now};
  const entries=Object.entries(state.students).sort((a,b)=>b[1].updatedAt-a[1].updatedAt);for(const [key] of entries.slice(5000))delete state.students[key];state.updatedAt=new Date(now).toISOString();
 });}
 async function saveGuidance(input){if(!TASKS.has(input.task))throw Object.assign(Error('Choose a supported task.'),{status:400});const title=clean(input.title,160),advice=clean(input.advice,1800);if(!title||!advice)throw Object.assign(Error('Enter a title and teaching guidance.'),{status:400});return mutate(state=>{const id=clean(input.id,80)||crypto.randomUUID(),index=state.guidance.findIndex(g=>g.id===id);if(index<0&&state.guidance.length>=100)throw Object.assign(Error('Maximum of 100 teaching notes.'),{status:400});const row={id,task:input.task,title,advice,enabled:input.enabled!==false,updatedAt:new Date(clock()).toISOString()};if(index<0)state.guidance.push(row);else state.guidance[index]=row;return row;});}
 async function context(task){const summary=summarise(await read(),clock());return {windowDays:90,topics:summary.topics.filter(r=>r.task===task&&r.students>=3).slice(0,3),feedbackPatterns:summary.feedbackPatterns.filter(r=>r.task===task&&r.students>=3).slice(0,3),patterns:summary.mistakes.filter(r=>r.task===task&&r.students>=3).slice(0,3),trends:summary.areas.filter(r=>r.task===task&&r.students>=3),teacherGuidance:summary.guidance.slice().sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)).filter(g=>g.enabled&&(g.task===task||g.task==='portal')).map(({task,title,advice})=>({task,title,advice})).slice(0,12)};}
 return {observe,saveGuidance,context,summary:async()=>summarise(await read(),clock())};
}
module.exports={TASKS,questionTopics,feedbackPatterns,snapshot,summarise,createLearningStore};
