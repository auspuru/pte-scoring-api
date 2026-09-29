const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const PLAN_STATUSES = new Set(['not_started','in_progress','ready_for_review','mastered','archived']);
const ITEM_KINDS = new Set(['video','question','practice','instruction','practice_set','message','swt_selection_trainer']);
const speakingBank = require('./content/speaking-bank');
const readingBank = require('./public/reading-bank.json');
const iptCoach = require('./ipt-coach');
const PRIORITIES = new Set(['high','normal','low']);

function canonical(value) { return String(value || '').trim().toLowerCase(); }
function clean(value, max = 1000) { return String(value == null ? '' : value).trim().slice(0, max); }
function iso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
function safeUrl(value) {
  const text = clean(value, 2000);
  if (!text) return '';
  try {
    const u = new URL(text);
    return ['http:','https:'].includes(u.protocol) ? u.toString() : '';
  } catch (_) { return ''; }
}
function sanitizeItem(input = {}, existing = null) {
  const kind = ITEM_KINDS.has(input.kind) ? input.kind : (existing?.kind || 'practice');
  const id = clean(input.id || existing?.id || crypto.randomUUID(), 120);
  const item = {
    id,
    kind,
    title: clean(input.title ?? existing?.title, 240) || 'Practice step',
    description: clean(input.description ?? existing?.description, 1200),
    url: safeUrl(input.url ?? existing?.url),
    engine: clean(input.engine ?? existing?.engine, 60),
    route: clean(input.route ?? existing?.route, 100),
    questionId: clean(input.questionId ?? existing?.questionId, 160),
    testId: clean(input.testId ?? existing?.testId, 160),
    passageId: clean(input.passageId ?? existing?.passageId, 160),
    practiceType: clean(input.practiceType ?? existing?.practiceType, 80),
    minimumAttempts: Math.max(0, Math.min(20, Number(input.minimumAttempts ?? existing?.minimumAttempts) || 0)),
    attemptProgress: (() => {
      const raw=input.attemptProgress ?? existing?.attemptProgress;
      if(!raw||typeof raw!=='object') return null;
      return {count:Math.max(0,Math.min(50,Number(raw.count)||0)),target:Math.max(0,Math.min(20,Number(raw.target)||0)),
        lastAt:iso(raw.lastAt)||null};
    })(),
    required: input.required === undefined ? (existing?.required !== false) : input.required !== false,
    requireNewAttempt: input.requireNewAttempt === undefined ? !!existing?.requireNewAttempt : !!input.requireNewAttempt,
    status: input.status === 'completed' ? 'completed' : (input.status === 'started' ? 'started' : (existing?.status || 'not_started')),
    startedAt: input.startedAt === null ? null : (iso(input.startedAt) || existing?.startedAt || null),
    completedAt: input.completedAt === null ? null : (iso(input.completedAt) || existing?.completedAt || null),
    completionSource: clean(input.completionSource ?? existing?.completionSource, 80),
    completionEvidence: clean(input.completionEvidence ?? existing?.completionEvidence, 240),
    exerciseCount: Math.max(0, Math.min(20, Number(input.exerciseCount ?? existing?.exerciseCount) || 0)),
    minimumToComplete: Math.max(0, Math.min(20, Number(input.minimumToComplete ?? existing?.minimumToComplete) || 0)),
    trainerProgress: (() => {
      const raw = input.trainerProgress ?? existing?.trainerProgress;
      if (!raw || typeof raw !== 'object') return null;
      const attemptedIds = [...new Set((Array.isArray(raw.attemptedIds)?raw.attemptedIds:[]).map(x=>clean(x,80)).filter(Boolean))].slice(0,20);
      const passedIds = [...new Set((Array.isArray(raw.passedIds)?raw.passedIds:[]).map(x=>clean(x,80)).filter(Boolean))].slice(0,20);
      const scores = {};
      for (const [k,v] of Object.entries(raw.scores||{}).slice(0,20)) scores[clean(k,80)] = Math.max(0,Math.min(100,Number(v)||0));
      return { attemptedIds, passedIds, scores };
    })()
  };
  if (item.status === 'completed' && !item.completedAt) item.completedAt = new Date().toISOString();
  return item;
}
function sanitizePlan(input = {}, existing = null, isNew = false) {
  const now = new Date().toISOString();
  const status = PLAN_STATUSES.has(input.status) ? input.status : (existing?.status || 'not_started');
  const itemsIn = Array.isArray(input.items) ? input.items.slice(0, 40) : (existing?.items || []);
  const priorById = new Map((existing?.items || []).map(item => [String(item.id), item]));
  return {
    id: clean(input.id || existing?.id || crypto.randomUUID(), 120),
    moduleCode: clean(input.moduleCode ?? existing?.moduleCode, 60),
    source: ['teacher','performance','student'].includes(input.source) ? input.source : (existing?.source || 'teacher'),
    area: clean(input.area ?? existing?.area, 80),
    task: clean(input.task ?? existing?.task, 120),
    weakness: clean(input.weakness ?? existing?.weakness, 200),
    title: clean(input.title ?? existing?.title, 240) || 'Your next step',
    reason: clean(input.reason ?? existing?.reason, 1200),
    teacherNote: clean(input.teacherNote ?? existing?.teacherNote, 1600),
    priority: PRIORITIES.has(input.priority) ? input.priority : (existing?.priority || 'normal'),
    dueAt: iso(input.dueAt) || (input.dueAt === '' ? null : existing?.dueAt || null),
    status,
    items: itemsIn.map(item => sanitizeItem(item, priorById.get(String(item?.id || '')))),
    assignedAt: existing?.assignedAt || iso(input.assignedAt) || now,
    updatedAt: now,
    readyReviewAt: status === 'ready_for_review' ? (existing?.readyReviewAt || iso(input.readyReviewAt) || now) : (status === 'in_progress' || status === 'not_started' ? null : existing?.readyReviewAt || null),
    masteredAt: status === 'mastered' ? (existing?.masteredAt || iso(input.masteredAt) || now) : (status === 'in_progress' || status === 'not_started' || status === 'ready_for_review' ? null : existing?.masteredAt || null),
    notificationUnread: input.notificationUnread === undefined ? (isNew ? true : !!existing?.notificationUnread) : !!input.notificationUnread
  };
}

function createStore(pool, directory) {
  const file = path.join(directory, 'student-interventions.json');
  let ready;
  async function initialise() {
    if (ready) return ready;
    ready = (async () => {
      if (pool) {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS student_interventions (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            data JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS student_interventions_user_idx
            ON student_interventions(username, updated_at DESC);
        `);
      } else {
        await fs.mkdir(directory, { recursive: true });
        try { await fs.access(file); }
        catch (_) { await fs.writeFile(file, JSON.stringify({ users: {} }, null, 2)); }
      }
    })();
    return ready;
  }
  async function readJson() {
    await initialise();
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (_) { return { users: {} }; }
  }
  async function writeJson(data) {
    await fs.mkdir(directory, { recursive: true });
    const tmp = file + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.rename(tmp, file);
  }
  async function list(username) {
    username = canonical(username); await initialise();
    if (pool) {
      const { rows } = await pool.query('SELECT data FROM student_interventions WHERE username=$1 ORDER BY updated_at DESC', [username]);
      return rows.map(r => r.data);
    }
    const data = await readJson();
    return Array.isArray(data.users?.[username]) ? data.users[username] : [];
  }
  async function put(username, plan) {
    username = canonical(username); await initialise();
    if (pool) {
      await pool.query(`
        INSERT INTO student_interventions (id, username, data, created_at, updated_at)
        VALUES ($1,$2,$3::jsonb,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username, data=EXCLUDED.data, updated_at=NOW()
      `, [plan.id, username, JSON.stringify(plan)]);
      return plan;
    }
    const data = await readJson(); data.users ||= {}; data.users[username] ||= [];
    const index = data.users[username].findIndex(p => p.id === plan.id);
    if (index >= 0) data.users[username][index] = plan; else data.users[username].push(plan);
    await writeJson(data); return plan;
  }
  async function update(username, id, mutate) {
    username = canonical(username); await initialise();
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query('SELECT data FROM student_interventions WHERE username=$1 AND id=$2 FOR UPDATE', [username, id]);
        if (!rows[0]) { const e = new Error('Plan not found'); e.status = 404; throw e; }
        const next = await mutate(rows[0].data);
        await client.query('UPDATE student_interventions SET data=$3::jsonb, updated_at=NOW() WHERE username=$1 AND id=$2', [username, id, JSON.stringify(next)]);
        await client.query('COMMIT');
        return next;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally { client.release(); }
    }
    const data = await readJson(); const plans = data.users?.[username] || [];
    const index = plans.findIndex(p => p.id === id);
    if (index < 0) { const e = new Error('Plan not found'); e.status = 404; throw e; }
    plans[index] = await mutate(plans[index]); await writeJson(data); return plans[index];
  }
  return { initialise, list, put, update };
}

function installInterventions(app, options = {}) {
  const { pool = null, directory, verifyToken, getAccount, getProgress, getPassages, getPassage, requireAdmin, callCoachModel } = options;
  if (!directory || typeof verifyToken !== 'function' || typeof getAccount !== 'function' || typeof requireAdmin !== 'function') {
    throw new Error('Interventions require directory, verifyToken, getAccount and requireAdmin.');
  }
  const store = createStore(pool, directory);

  async function student(req, res, next) {
    try {
      const username = canonical(verifyToken(req.headers['x-session-token'] || ''));
      if (!username) return res.status(401).json({ error: 'Please sign in.' });
      const account = await getAccount(username);
      if (!account || account.blocked) return res.status(403).json({ error: 'This account is unavailable.' });
      req.interventionUser = username; next();
    } catch (_) { res.status(503).json({ error: 'Your account could not be checked.' }); }
  }
  const active = p => !['mastered','archived'].includes(p.status);
  const sendError = (res, e) => res.status(e.status || 500).json({ error: e.status ? e.message : 'This action could not be completed.' });
  const when = value => {
    if (value == null) return 0;
    const n = Number(value);
    if (Number.isFinite(n) && n > 100000000000) return n;
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : 0;
  };
  const afterAssignment = (plan, at, required) => !required || (when(at) && when(at) >= when(plan.assignedAt));
  const speakingTypeByQuestion = new Map((speakingBank.questions||[]).map(q=>[String(q.id),String(q.type)]));
  const readingTypeByUid = (() => {
    const map=new Map();
    for(const lib of (readingBank.practiceLibraries||[])) for(const q of (lib.questions||[])) {
      const uid=q.uid || ('pte:'+q.id); map.set(String(uid),String(lib.id||q.type||''));
    }
    for(const set of (readingBank.sets||[])) for(const q of (set.questions||[])) {
      map.set(String(q.uid || (set.id+':'+q.id)),String(q.type||''));
    }
    for(const q of [...(readingBank.audioQuestionBank||[]),...(readingBank.mixedMock?.audioQuestions||[])]) {
      map.set(String(q.uid || ('audio:'+q.id)),String(q.type||''));
    }
    return map;
  })();
  function practiceSetAttempts(plan,item,all) {
    const newer=at=>afterAssignment(plan,at,true), type=item.practiceType;
    if(item.engine==='speaking') return all.speaking.filter(a=>a.status==='submitted'
      && speakingTypeByQuestion.get(String(a.questionId))===type && newer(a._updatedAt||a.startedAt));
    if(item.engine==='writing-lab') return all.writing.filter(a=>a.status==='submitted'
      && String(a.kind||a.questions?.[0]?.type||'')===type && newer(a.finishedAt||a._updatedAt||a.startedAt));
    if(item.engine==='reading') {
      return Object.entries(all.progress?.readingProgress?.practiceResults||{}).filter(([uid,result])=>
        readingTypeByUid.get(String(uid))===type && newer(result?.finishedAt)).map(([uid,result])=>({id:uid,...result,_matchedAt:result.finishedAt}));
    }
    if(item.engine==='swt') return Object.entries(all.progress?.history||{}).flatMap(([passageId,attempts])=>
      (attempts||[]).filter(a=>newer(a.timestamp)).map(a=>({id:passageId+':'+String(a.timestamp),...a})));
    if(item.engine==='essay') return (Array.isArray(all.progress?.practiceHistory)?all.progress.practiceHistory:[])
      .filter(a=>newer(a.date||a.updatedAt));
    return [];
  }
  async function evidence(username) {
    const progress = typeof getProgress === 'function' ? await getProgress(username).catch(() => ({})) : {};
    let speaking = [], writing = [];
    if (pool) {
      try {
        const { rows } = await pool.query("SELECT data, updated_at FROM speaking_lab_attempts WHERE username=$1 ORDER BY updated_at DESC LIMIT 150", [username]);
        speaking = rows.map(r => ({ ...(r.data || {}), _updatedAt:r.updated_at }));
      } catch (_) {}
      try {
        const { rows } = await pool.query("SELECT data, updated_at FROM writing_lab_attempts WHERE username=$1 ORDER BY updated_at DESC LIMIT 300", [username]);
        writing = rows.map(r => ({ ...(r.data || {}), _updatedAt:r.updated_at }));
      } catch (_) {}
    }
    return { progress: progress || {}, speaking, writing };
  }
  function matchingAttempt(plan, item, all) {
    const newer = at => afterAssignment(plan, at, !!item.requireNewAttempt);
    if (item.engine === 'speaking') {
      return all.speaking.find(a => String(a.questionId) === String(item.questionId) && a.status === 'submitted' && newer(a._updatedAt || a.startedAt));
    }
    if (item.engine === 'writing-lab') {
      return all.writing.find(a => String(a.testId) === String(item.testId || item.questionId) && a.status === 'submitted' && newer(a.finishedAt || a._updatedAt || a.startedAt));
    }
    if (item.engine === 'reading') {
      const result = all.progress?.readingProgress?.practiceResults?.[item.questionId];
      return result && newer(result.finishedAt) ? { ...result, _matchedAt:result.finishedAt } : null;
    }
    if (item.engine === 'swt') {
      const attempts = all.progress?.history?.[item.passageId || item.questionId] || [];
      return attempts.find(a => newer(a.timestamp));
    }
    if (item.engine === 'essay') {
      const attempts = Array.isArray(all.progress?.practiceHistory) ? all.progress.practiceHistory : [];
      return attempts.find(a => String(a.questionId || '') === String(item.questionId) && newer(a.date || a.updatedAt));
    }
    return null;
  }
  async function reconcile(username) {
    let plans = await store.list(username);
    const changed = new Map();
    const contentIntent = /important|main idea|central|key (?:point|idea|line|sentence|phrase)|which (?:line|sentence)|select|highlight|content|too much detail|what to include|what is important|improve content/i;
    const catalogue = await modules();
    const trainerModule = catalogue.find(m=>m.code==='SWT-CONTENT-01');

    // Old self-help SWT content cards are upgraded to the interactive trainer.
    if (trainerModule) {
      for (const plan of plans.filter(active)) {
        if (plan.source!=='student' || !['SWT-01','CP-01','CP-02'].includes(plan.moduleCode)
            || (plan.items||[]).some(i=>i.kind==='swt_selection_trainer') || !contentIntent.test(plan.reason||'')) continue;
        const next = await store.update(username, plan.id, current => sanitizePlan({
          ...current,moduleCode:trainerModule.code,title:trainerModule.title+' · IPT Assistant Beta',area:trainerModule.area,task:trainerModule.task,
          weakness:trainerModule.weakness,items:trainerModule.items,status:'in_progress'
        },current));
        changed.set(plan.id,next);
      }
      if (changed.size) plans=plans.map(p=>changed.get(p.id)||p);
    }

    // Any older module that still contains placeholder "practice" items is refreshed
    // from the current catalogue, where practice is either real portal practice or an instruction.
    for (const plan of plans.filter(active)) {
      if (!(plan.items||[]).some(i=>i.kind==='practice')) continue;
      const module=catalogue.find(m=>m.code===plan.moduleCode);
      if(!module || (module.items||[]).some(i=>i.kind==='practice')) continue;
      const items=(module.items||[]).map(template=>{
        const previous=(plan.items||[]).find(i=>(template.url&&i.url===template.url)||(i.title===template.title));
        return previous ? {...template,id:previous.id,status:previous.status,startedAt:previous.startedAt,completedAt:previous.completedAt} : template;
      });
      const next=await store.update(username,plan.id,current=>sanitizePlan({...current,items,status:current.status==='ready_for_review'?'in_progress':current.status},current));
      changed.set(plan.id,next);
    }
    if(changed.size) plans=plans.map(p=>changed.get(p.id)||p);

    const candidates = plans.filter(active).filter(p => (p.items || []).some(i =>
      (i.kind === 'question' || i.kind === 'practice_set') && i.status !== 'completed'));
    if (!candidates.length) return plans;
    const all = await evidence(username);

    for (const plan of candidates) {
      const nextItems = (plan.items || []).map(item => {
        if(item.status==='completed') return item;
        if(item.kind==='question') {
          const hit = matchingAttempt(plan, item, all);
          if (!hit) return item;
          const at = hit.finishedAt || hit._matchedAt || hit.timestamp || hit.date || hit._updatedAt || Date.now();
          return { ...item, status:'completed', startedAt:item.startedAt || iso(at) || new Date().toISOString(),
            completedAt:iso(at) || new Date().toISOString(), completionSource:'attempt_sync',
            completionEvidence:'Automatically matched to a submitted portal attempt.' };
        }
        if(item.kind==='practice_set') {
          const hits=practiceSetAttempts(plan,item,all);
          const target=item.minimumAttempts||1;
          const last=hits.map(a=>a.finishedAt||a._matchedAt||a.timestamp||a.date||a.updatedAt||a._updatedAt).sort((a,b)=>when(b)-when(a))[0]||null;
          const status=hits.length>=target?'completed':hits.length?'started':item.status;
          return {...item,status,startedAt:hits.length?(item.startedAt||plan.assignedAt):item.startedAt,
            completedAt:hits.length>=target?(item.completedAt||iso(last)||new Date().toISOString()):null,
            completionSource:hits.length>=target?'attempt_sync':'',
            completionEvidence:hits.length>=target?('Completed '+hits.length+' qualifying portal attempt'+(hits.length===1?'':'s')+'.'):'',
            attemptProgress:{count:hits.length,target,lastAt:iso(last)}};
        }
        return item;
      });
      if (nextItems.some((item, i) => item.status !== plan.items[i]?.status || item.completedAt !== plan.items[i]?.completedAt
          || item.attemptProgress?.count !== plan.items[i]?.attemptProgress?.count)) {
        const next = await store.update(username, plan.id, current => sanitizePlan({
          ...current, items:nextItems, status:current.status === 'not_started' ? 'in_progress' : current.status
        }, current));
        changed.set(plan.id, next);
      }
    }
    return plans.map(p => changed.get(p.id) || p);
  }

  const TRAIT_MAX = {
    swt:{content:4,form:1,grammar:2,vocabulary:2},
    sst:{content:4,form:2,grammar:2,vocabulary:2,spelling:2},
    essay:{content:6,form:2,grammar:2,vocabulary:2,spelling:2,linguistic:6,coherence:6}
  };
  const TRAIT_LABEL = {content:'Content',form:'Form',grammar:'Grammar',vocabulary:'Vocabulary',spelling:'Spelling',
    linguistic:'General linguistic range',coherence:'Development, structure & coherence'};
  const TASK_MODULE = {
    swt:'SWT-01',sst:'SST-01',essay:'ESSAY-01',
    ra:'RA-01',rs:'MEM-01',rl:'RL-01',di:'CP-04',rts:'REG-01',sgd:'NT-03',
    speaking:'PR-01'
  };
  const TASK_NAME = {
    swt:'Summarize Written Text',sst:'Summarize Spoken Text',essay:'Essay Writing',
    ra:'Read Aloud',rs:'Repeat Sentence',rl:'Retell Lecture',di:'Describe Image',
    rts:'Respond to a Situation',sgd:'Summarize Group Discussion',speaking:'General Speaking'
  };
  const SELF_HELP_TASKS = new Set(Object.keys(TASK_MODULE));
  function latestScore(task, all) {
    if (task === 'swt') {
      const entries = Object.values(all.progress?.history || {}).flat().filter(Boolean)
        .sort((a,b)=>when(b.timestamp)-when(a.timestamp));
      const a = entries[0]; if (!a) return null;
      return { at:a.timestamp, scores:a.trait_scores || {}, maxima:TRAIT_MAX.swt };
    }
    if (task === 'sst') {
      const a = all.writing.filter(x => (x.kind === 'sst' || x.questions?.[0]?.type === 'sst') && x.status === 'submitted')
        .sort((x,y)=>when(y.finishedAt || y._updatedAt)-when(x.finishedAt || x._updatedAt))[0];
      const r = a?.results?.find(Boolean); if (!r) return null;
      return { at:a.finishedAt || a._updatedAt, scores:r.scores || {}, maxima:r.maxima || TRAIT_MAX.sst };
    }
    if (task === 'essay') {
      const a = (Array.isArray(all.progress?.practiceHistory) ? all.progress.practiceHistory : [])
        .slice().sort((x,y)=>when(y.date || y.updatedAt)-when(x.date || x.updatedAt))[0];
      if (!a) return null;
      return { at:a.date || a.updatedAt, scores:a.scores || {}, maxima:TRAIT_MAX.essay };
    }
    if (['ra','rs','rl','di','rts','sgd','speaking'].includes(task)) {
      const entries = all.speaking.filter(a => a.status === 'submitted' && a.result
          && (task === 'speaking' || speakingTypeByQuestion.get(String(a.questionId)) === task))
        .sort((x,y)=>when(y._updatedAt || y.startedAt)-when(x._updatedAt || x.startedAt));
      const a=entries[0],r=a?.result;
      if(!a || !Number.isFinite(Number(r?.total)) || !Number.isFinite(Number(r?.maximum))) return null;
      return { at:a._updatedAt || a.startedAt, scores:{content:Number(r.total)}, maxima:{content:Number(r.maximum)}, contentOnly:true };
    }
    return null;
  }

  const PROFILE_LABEL = {
    swt:'Summarize Written Text',essay:'Essay Writing',sst:'Summarize Spoken Text',wfd:'Write From Dictation',
    ra:'Read Aloud',rs:'Repeat Sentence',di:'Describe Image',rl:'Retell Lecture',sgd:'Summarize Group Discussion',rts:'Respond to a Situation',
    dropdown:'Reading Blanks (Dropdown)',mcma:'Reading Multiple Answers',reorder:'Reorder Paragraphs',
    wordbank:'Reading Blanks (Drag & Drop)',mcsa:'Reading Single Answer',hcs:'Highlight Correct Summary',hiw:'Highlight Incorrect Words'
  };
  const PROFILE_MAX = {
    swt:{content:4,form:1,grammar:2,vocabulary:2},
    essay:{content:6,form:2,grammar:2,vocabulary:2,spelling:2,linguistic:6,coherence:6},
    sst:{content:4,form:2,grammar:2,vocabulary:2,spelling:2}
  };
  const profileNumber = value => {
    if(value===null||value===undefined||value===''||typeof value==='boolean') return null;
    const n=Number(value);
    return Number.isFinite(n)?n:null;
  };
  const profileRatio = (value,maximum) => {
    const v=profileNumber(value),m=profileNumber(maximum);
    return v!==null&&m!==null&&m>0?Math.max(0,Math.min(1,v/m)):null;
  };
  const PROFILE_MIN_RATIO = 0.05;
  const usableProfileRatio = ratio => ratio !== null && Number.isFinite(ratio) && ratio > PROFILE_MIN_RATIO;
  function studentProfile(all) {
    const points=[],recentMocks=[],unfinished=[],traitValues=new Map();
    const addTrait=(task,key,value,maximum,at)=>{
      const ratio=profileRatio(value,maximum);
      if(ratio===null)return;
      const id=task+':'+key, list=traitValues.get(id)||[];
      list.push({ratio,at:when(at)});
      traitValues.set(id,list);
    };
    const addPoint=(task,value,at,source='practice',detail=null)=>{
      if(!task)return false;
      const ratio=profileNumber(value);
      if(!usableProfileRatio(ratio))return false;
      points.push({task,label:PROFILE_LABEL[task]||task,value:Math.max(0,Math.min(1,ratio)),at:when(at),source,detail:detail||undefined});
      return true;
    };
    const progress=all.progress||{};

    for(const attempts of Object.values(progress.history||{})) for(const a of (attempts||[])) {
      const traits=a?.trait_scores||{}, maxima=PROFILE_MAX.swt;
      const vals=Object.keys(maxima).map(k=>profileNumber(traits[k]));
      let ratio=null;
      if(vals.every(v=>v!==null)) ratio=vals.reduce((n,v)=>n+v,0)/Object.values(maxima).reduce((n,v)=>n+v,0);
      else ratio=profileRatio(a?.overall_score,90);
      const included=addPoint('swt',ratio,a?.timestamp,'practice',{traits});
      if(included) for(const [k,max] of Object.entries(maxima)) addTrait('swt',k,traits[k],max,a?.timestamp);
    }

    for(const a of (Array.isArray(progress.practiceHistory)?progress.practiceHistory:[])) {
      const scores=a?.scores||{};
      let ratio=profileRatio(scores.total,26);
      if(ratio===null) {
        const keys=Object.keys(PROFILE_MAX.essay), vals=keys.map(k=>profileNumber(scores[k]));
        if(vals.every(v=>v!==null)) ratio=vals.reduce((n,v)=>n+v,0)/Object.values(PROFILE_MAX.essay).reduce((n,v)=>n+v,0);
      }
      const included=addPoint('essay',ratio,a?.date||a?.updatedAt,'practice',{scores});
      if(included) for(const [k,max] of Object.entries(PROFILE_MAX.essay)) addTrait('essay',k,scores[k],max,a?.date||a?.updatedAt);
    }

    const reading=progress.readingProgress||{};
    for(const [uid,result] of Object.entries(reading.practiceResults||{})) {
      const task=readingTypeByUid.get(String(uid))||clean(result?.type,40);
      const ratio=profileRatio(result?.earned??result?.total,result?.gradedPossible??result?.possible??result?.maximum);
      addPoint(task,ratio,result?.finishedAt,'practice');
    }
    const readingSessions=[...(Array.isArray(reading.history)?reading.history:[]),reading.session,...(Array.isArray(reading.drafts)?reading.drafts:[])].filter(Boolean);
    const seenReading=new Set();
    for(const session of readingSessions) {
      if(seenReading.has(session.id))continue;seenReading.add(session.id);
      if(!session.done) {
        unfinished.push({kind:session.practiceUid?'Reading practice':'Reading mock',title:clean(session.name||'Reading session',160),at:session.updatedAt||session.startedAt||null});
        continue;
      }
      if(session.practiceUid)continue;
      const breakdown=[];
      for(const row of (Array.isArray(session.rows)?session.rows:[])) {
        const task=clean(row?.type,40), ratio=profileRatio(row?.earned,row?.gradedPossible??row?.possible);
        if(addPoint(task,ratio,session.finishedAt||session.startedAt,'mock')) {
          breakdown.push({task:PROFILE_LABEL[task]||task,percent:Math.round(ratio*100)});
        }
      }
      const totalRatio=profileRatio(session.earned??session.total,session.possible??session.maximum);
      const fallbackPercent=profileNumber(session.percent);
      const mockRatio=totalRatio===null?(fallbackPercent===null?null:Math.max(0,Math.min(1,fallbackPercent/100))):totalRatio;
      if(usableProfileRatio(mockRatio)||breakdown.length) recentMocks.push({
        title:clean(session.name||'Reading mock',160),engine:'reading',at:session.finishedAt||session.startedAt||null,
        percent:usableProfileRatio(mockRatio)?Math.round(mockRatio*100):null,
        breakdown
      });
    }

    for(const a of (Array.isArray(all.speaking)?all.speaking:[])) {
      const task=clean(a?.type,40)||speakingTypeByQuestion.get(String(a?.questionId))||'speaking';
      if(a?.status!=='submitted'||!a?.result) {
        unfinished.push({kind:'Speaking practice',title:PROFILE_LABEL[task]||clean(a?.title,120)||'Speaking practice',at:a?._updatedAt||a?.startedAt||null});
        continue;
      }
      const ratio=profileRatio(a.result.total,a.result.maximum);
      addPoint(task,ratio,a._updatedAt||a.startedAt,'practice',{contentOnly:true});
    }

    for(const a of (Array.isArray(all.writing)?all.writing:[])) {
      const kind=clean(a?.kind||a?.questions?.[0]?.type,40);
      if(kind==='mock') {
        if(a?.status!=='submitted') {
          unfinished.push({kind:'Writing mock',title:clean(a?.title||'Writing mock',160),at:a?._updatedAt||a?.startedAt||null});
          continue;
        }
        const breakdown=[];
        for(const group of (Array.isArray(a.byType)?a.byType:[])) {
          if(group?.marked!==group?.count)continue;
          const ratio=profileRatio(group.total,group.maximum);
          if(!addPoint(clean(group.type,40),ratio,a.finishedAt||a._updatedAt||a.startedAt,'mock'))continue;
          breakdown.push({task:PROFILE_LABEL[group.type]||group.type,percent:Math.round(ratio*100)});
        }
        const mockRatio=profileRatio(a.total,a.maximum);
        if(usableProfileRatio(mockRatio)||breakdown.length) recentMocks.push({
          title:clean(a.title||'Writing mock',160),engine:'writing',at:a.finishedAt||a._updatedAt||a.startedAt||null,
          percent:usableProfileRatio(mockRatio)?Math.round(mockRatio*100):null,
          score90:profileNumber(a.score90),
          breakdown
        });
        continue;
      }
      if(a?.status!=='submitted') {
        unfinished.push({kind:'Writing practice',title:clean(a?.title||(kind==='sst'?'Summarize Spoken Text':kind==='wfd'?'Write From Dictation':'Writing practice'),160),at:a?._updatedAt||a?.startedAt||null});
        continue;
      }
      if(['sst','wfd'].includes(kind)) {
        const included=addPoint(kind,profileRatio(a.total,a.maximum),a.finishedAt||a._updatedAt||a.startedAt,'practice');
        if(included) for(const r of (Array.isArray(a.results)?a.results:[])) {
          const maxima=r?.maxima||PROFILE_MAX[kind]||{};
          for(const [k,max] of Object.entries(maxima)) addTrait(kind,k,r?.scores?.[k],max,a.finishedAt||a._updatedAt||a.startedAt);
        }
      }
    }

    if(progress.essayDraft && typeof progress.essayDraft==='object') unfinished.push({
      kind:'Essay draft',title:clean(progress.essayDraft.title||progress.essayDraft.prompt||'Essay draft',160),at:progress.essayDraft.updatedAt||null
    });

    const byTask=new Map();
    for(const p of points) {
      if(!byTask.has(p.task))byTask.set(p.task,[]);
      byTask.get(p.task).push(p);
    }
    const areas=[...byTask.entries()].map(([task,list])=>{
      list.sort((a,b)=>a.at-b.at);
      const values=list.map(x=>x.value), recent=values.slice(-5);
      const avg=values.reduce((n,v)=>n+v,0)/values.length;
      const delta=recent.length>1?recent.at(-1)-recent[0]:null;
      const averagePct=Math.round(avg*100),latestPct=Math.round(values.at(-1)*100);
      const recentPcts=recent.map(v=>Math.round(v*100));
      return {
        task,label:PROFILE_LABEL[task]||task,attempts:list.length,
        practiceAttempts:list.filter(x=>x.source==='practice').length,
        mockAttempts:list.filter(x=>x.source==='mock').length,
        averagePct,latestPct,
        recentLowPct:recentPcts.length?Math.min(...recentPcts):null,
        recentHighPct:recentPcts.length?Math.max(...recentPcts):null,
        performanceBand:averagePct>=75?'strong':averagePct>=50?'developing':'weak',
        evidenceStrength:list.length>=5?'high':list.length>=2?'moderate':'limited',
        trend:delta===null?'not enough data':Math.abs(delta)<.02?'stable':delta>0?'improving':'declining',
        trendPct:delta===null?null:Math.round(delta*100),
        lastAt:list.at(-1)?.at||0
      };
    }).sort((a,b)=>b.lastAt-a.lastAt);

    const recurring=areas.filter(a=>a.attempts>=2);
    const weakest=recurring.slice().sort((a,b)=>a.averagePct-b.averagePct).slice(0,3);
    const strongest=recurring.slice().sort((a,b)=>b.averagePct-a.averagePct).slice(0,3);
    const areaByTask=new Map(areas.map(a=>[a.task,a]));
    const traits=[...traitValues.entries()].map(([id,list])=>{
      list.sort((a,b)=>a.at-b.at);
      const [task,key]=id.split(':');
      const recent=list.slice(-5),avg=recent.reduce((n,x)=>n+x.ratio,0)/recent.length;
      const averagePct=Math.round(avg*100),latestPct=Math.round(list.at(-1).ratio*100);
      const area=areaByTask.get(task)||null;
      const gapFromOverallPct=area?averagePct-area.averagePct:null;
      let interpretation='monitor';
      if(area?.performanceBand==='strong') interpretation='relative_improvement_area';
      else if(area && averagePct<=area.averagePct-8) interpretation='possible_score_contributor';
      else if(area) interpretation='not_primary_driver';
      return {
        task:PROFILE_LABEL[task]||task,taskCode:task,trait:TRAIT_LABEL[key]||key,
        attempts:list.length,averagePct,latestPct,
        taskAveragePct:area?.averagePct??null,taskLatestPct:area?.latestPct??null,
        taskPerformanceBand:area?.performanceBand||'unknown',
        taskEvidenceStrength:area?.evidenceStrength||'unknown',
        gapFromOverallPct,interpretation
      };
    }).filter(x=>x.attempts>=1).sort((a,b)=>a.averagePct-b.averagePct).slice(0,6);

    const recentPractice=points.filter(p=>p.source==='practice').sort((a,b)=>b.at-a.at).slice(0,10)
      .map(p=>({task:p.label,percent:Math.round(p.value*100),at:p.at,detail:p.detail}));
    recentMocks.sort((a,b)=>when(b.at)-when(a.at));
    unfinished.sort((a,b)=>when(b.at)-when(a.at));
    return {
      generatedAt:new Date().toISOString(),
      interpretationPolicy:{
        overallBeforeTraits:true,
        strongTaskThresholdPct:75,
        highEvidenceAttempts:5,
        rule:'Use overall task performance to decide whether marks are materially slipping. Trait scores explain relative improvement areas and must not override a strong overall task pattern on their own.'
      },
      filterPolicy:{unattemptedExcluded:true,extremeLowExcluded:true,excludedAtOrBelowPct:Math.round(PROFILE_MIN_RATIO*100)},
      totals:{practiceResults:points.filter(p=>p.source==='practice').length,mockTaskResults:points.filter(p=>p.source==='mock').length,completedMocks:recentMocks.length},
      weakestAreas:weakest,
      strongestAreas:strongest,
      traitWeaknesses:traits,
      areas,
      recentPractice,
      recentMocks:recentMocks.slice(0,5),
      unfinished:unfinished.slice(0,6)
    };
  }

  function betaAdvice(task, problem, all) {
    const text = clean(problem, 1000).toLowerCase();
    const score = latestScore(task, all);
    const suggestions = [];
    const push = (moduleCode, title, reason, action='') => {
      if (!moduleCode || suggestions.some(s => s.moduleCode === moduleCode)) return;
      suggestions.push({ moduleCode, title, reason, action });
    };
    const taskName = TASK_NAME[task] || 'PTE practice';
    const methodIntent=/how|attempt|approach|structure|format|template|start|begin|method|strategy/.test(text) || !text;
    const speakingIntent=/pronun|fluency|accent|clear|confidence|mechanical|hesitat|filler|intonation|pace|natural|speak/.test(text);
    const noteIntent=/note|taking notes|keyword|remember|recall|listen/.test(text);
    const contentIntent=/main idea|content|key point|supporting|idea|detail|turning point|conclusion|relevant|what to include/.test(text);

    const swtContentIntent = task === 'swt' && /important|main idea|central|key (?:point|idea|line|sentence|phrase)|which (?:line|sentence)|select|highlight|content|too much detail|what to include|what is important/.test(text);
    if (swtContentIntent) {
      push('SWT-CONTENT-01','SWT Content Selection — Highlight Trainer',
        'Your question is about deciding what belongs in the summary, so practise selecting the important information before writing full summaries.',
        'Use the passage trainer to highlight the important words and phrases that carry the main topic, important support and turning points. Avoid examples, repeated information and unnecessary detail.');
    }

    if (task === 'speaking') {
      push('PR-01','Pronunciation & Fluency — English Foundation',
        'Start with clear, understandable and natural English speech before pushing harder on task content.',
        'Follow the four-video playlist in order, then use the short daily routine: shadow, speak clearly, record yourself, and spend regular time with enjoyable natural English.');
    } else if (task === 'ra') {
      if (methodIntent || /fast|slow|pause|comma|punct|word.?by.?word/.test(text))
        push('RA-01','Read Aloud — Natural Pace & Pausing','Your description points to pace, pausing or mechanical delivery.',
          'Use a moderate pace, pause naturally at punctuation and focus on words being clearly understandable rather than speaking as fast as possible.');
      if (speakingIntent) push('PR-01','Pronunciation & Fluency Foundation','Clear pronunciation and natural fluency support every Read Aloud response.',
        'Use the English pronunciation/fluency playlist and daily shadowing routine alongside portal practice.');
    } else if (task === 'rs') {
      if (methodIntent || contentIntent || /memory|difficult|hard|forget|partial/.test(text))
        push('MEM-01','Repeat Sentence — Capture More Correct Content','Your priority is to reproduce more of the sentence accurately.',
          'Do not give up after a few words. Practise challenging sentences and aim to increase correct content without adding random guesses.');
      if (speakingIntent) push('PR-01','Pronunciation & Fluency Foundation','If the words are hard to understand, improve delivery as well as recall.',
        'Use the pronunciation/fluency playlist and record yourself so clarity improves without rushing.');
    } else if (task === 'rl') {
      if (methodIntent || contentIntent || noteIntent)
        push('RL-01','Retell Lecture — Main Idea to Conclusion','Build the retell around the topic, important supporting ideas and the ending.',
          'Capture the main topic, about two strong supporting ideas and the conclusion where one exists. Reconstruct fragmented notes into meaningful spoken ideas.');
      if (noteIntent) push('NT-01','Note-Taking — Useful Meaning','Your notes should support listening rather than replace it.',
        'Use short keywords if you can reconstruct ideas; use longer meaningful phrases if you depend heavily on your notes.');
      if (speakingIntent) push('PR-01','Pronunciation & Fluency Foundation','Confident, understandable delivery matters after the content is selected.');
    } else if (task === 'di') {
      push('CP-04','Describe Image — Topic, Key Features & Trends',
        contentIntent||methodIntent?'Focus on the image type, topic and strongest reportable features rather than trying to describe everything.':'Use a flexible image-description structure.',
        'Introduce the image and topic, then cover the strongest features: highest/lowest, major comparisons or trends. Mention axes only when useful; a separate conclusion is optional.');
      if (speakingIntent) push('PR-01','Pronunciation & Fluency Foundation','Keep the description clear, natural and confident rather than mechanical.');
    } else if (task === 'rts') {
      push('REG-01','Respond to a Situation — Natural First-Person Response',
        'The response should match the listener and communication goal rather than repeat the prompt mechanically.',
        'Choose an appropriate greeting, explain the situation in first person, add a realistic relevant detail, make the required request or suggestion, and close politely.');
      if (speakingIntent) push('PR-01','Pronunciation & Fluency Foundation','Use natural pauses and clear speech so the response sounds like real communication.');
    } else if (task === 'sgd') {
      push('NT-03','SGD — Speaker Tracking & Third-Person Summary',
        'Keep each speaker\'s ideas separate and report the discussion in third person.',
        'Capture the overall topic and about 2–3 useful ideas per speaker where available. Group each speaker together rather than reproducing the original back-and-forth.');
      if (noteIntent || /mix|speaker|handwriting|fragment/.test(text)) push('NT-01','Note-Taking — Useful Meaning','Keep listening and capture usable notes without stopping to perfect every phrase.',
        'Use separate S1/S2/S3 areas, keep handwriting readable and turn keywords into complete ideas after the audio.');
      if (speakingIntent) push('PR-01','Pronunciation & Fluency Foundation','Speak at a natural pace and avoid excessive fillers while reporting the speakers.');
    } else if (task === 'sst') {
      if (methodIntent || contentIntent || noteIntent) push('SST-01','SST — Understand First, Then Note',
        'Low content often begins with listening or note-taking rather than sentence writing.',
        'Listen for the topic, about two important supporting ideas and the conclusion. Use note length that matches your memory, then repair fragmented notes before writing.');
    } else if (task === 'swt' && methodIntent && !swtContentIntent) {
      push('SWT-01','SWT — Main Idea, Support & Synthesis','Use the IPT method instead of a fixed template.',
        'Find the topic, ask What/Why/How, keep relevant support and turning points, preserve meaning, then connect the ideas. Compress wording rather than deleting an important idea.');
    } else if (task === 'essay' && methodIntent) {
      push('ESSAY-01','Essay Writing — Core Method','Use the existing essay scoring and Claude feedback to identify prompt coverage, development and organisation.',
        'Analyse exactly what the prompt asks, plan relevant body ideas, write the response, then use the scored feedback for your next attempt.');
    }

    if (['swt','sst','essay'].includes(task)) {
      if (/grammar|sentence|connect|punct|run.?on/.test(text)) push('GR-01','Grammar and sentence building','Focus on accurate sentence construction and logical connections.');
      if (/vocab|word|collocation|phrase/.test(text)) push('VOC-02','Vocabulary and collocations','Build useful word combinations and context-appropriate vocabulary.');
      if (/spell/.test(text)) push('SP-02','Spelling accuracy','Use a personal error log and targeted retesting.');
    }
    if (/time|slow|finish/.test(text) && !['ra','speaking'].includes(task)) push('TIME-01','Timing and preparation','Practise the method untimed, then reduce preparation time gradually.');

    if (score) {
      const weak = Object.entries(score.scores || {}).filter(([k,v]) => Number.isFinite(Number(v)) && Number.isFinite(Number(score.maxima?.[k])))
        .map(([k,v]) => ({k,v:Number(v),max:Number(score.maxima[k]),ratio:Number(v)/Number(score.maxima[k])}))
        .filter(x=>x.ratio<0.8).sort((a,b)=>a.ratio-b.ratio);
      for (const t of weak.slice(0,3)) {
        if (t.k === 'content') {
          const code = task === 'essay' ? 'ESSAY-01' : task === 'swt' ? 'SWT-CONTENT-01' : TASK_MODULE[task];
          push(code, 'Content', `Your most recent ${taskName} content result was ${t.v}/${t.max}. Work on the task-specific content method before simply adding more practice.`,
            task==='swt'?'Use the highlight trainer to practise selecting central phrases without writing a full summary.'
              :task==='rs'?'Aim to reproduce more correct words from challenging sentences.'
              :task==='sgd'?'Keep speaker attribution clear and turn notes into complete third-person ideas.'
              :task==='rl'?'Build the retell around the topic, support and conclusion.'
              :task==='di'?'Describe the topic and strongest features rather than listing everything.'
              :task==='rts'?'Make sure the response actually completes the communication goal.'
              :'Target the task-specific content method before harder practice.');
        } else if (t.k === 'form') push(TASK_MODULE[task], TRAIT_LABEL[t.k], `Your most recent Form result was ${t.v}/${t.max}. Review the task format and word/sentence requirements.`);
        else if (t.k === 'grammar') push('GR-01', TRAIT_LABEL[t.k], `Your most recent Grammar result was ${t.v}/${t.max}. Prioritise sentence accuracy and control.`);
        else if (t.k === 'vocabulary') push('VOC-02', TRAIT_LABEL[t.k], `Your most recent Vocabulary result was ${t.v}/${t.max}. Practise precise wording and useful collocations.`);
        else if (t.k === 'spelling') push('SP-02', TRAIT_LABEL[t.k], `Your most recent Spelling result was ${t.v}/${t.max}. Target repeated spelling errors.`);
        else if (t.k === 'linguistic' || t.k === 'coherence') push('ESSAY-01', TRAIT_LABEL[t.k], `Your most recent ${TRAIT_LABEL[t.k]} result was ${t.v}/${t.max}. Strengthen development and organisation.`);
      }
    }
    if (!suggestions.length) push(TASK_MODULE[task], taskName + ' — Core method', 'Review the IPT task method, complete targeted practice, then compare your next result.');
    return {
      task, problem:clean(problem,1000), beta:true,
      latestScore: score ? { at:score.at, scores:score.scores, maxima:score.maxima, contentOnly:!!score.contentOnly } : null,
      suggestions:suggestions.slice(0,3)
    };
  }
  let moduleCache = null;
  async function modules() {
    if (moduleCache) return moduleCache;
    try {
      const raw = await fs.readFile(path.join(__dirname,'public','improvement-modules.json'),'utf8');
      moduleCache = JSON.parse(raw).modules || [];
    } catch (_) { moduleCache = []; }
    return moduleCache;
  }

  const swtTrainer = require('./swt-selection-trainer');
  async function trainerCatalog(limit=15) {
    if (typeof getPassages !== 'function') return [];
    const all = await getPassages();
    return swtTrainer.makeCatalog(all,{limit});
  }
  async function trainerPassage(id) {
    if (typeof getPassage !== 'function') return null;
    return await getPassage(id);
  }
  async function trainerItem(username, planId, itemId) {
    const plans = await store.list(username);
    const plan = plans.find(p=>String(p.id)===String(planId));
    if (!plan) { const e=new Error('Plan not found'); e.status=404; throw e; }
    const item=(plan.items||[]).find(i=>String(i.id)===String(itemId));
    if (!item || item.kind!=='swt_selection_trainer') { const e=new Error('SWT selection trainer not found'); e.status=404; throw e; }
    return {plan,item};
  }

  app.get('/api/interventions/swt-selection/practice/:passageId', student, async (req,res) => {
    try {
      const p=await trainerPassage(clean(req.params.passageId,80));
      if(!p)return res.status(404).json({error:'Passage not found.'});
      if(!swtTrainer.eligible(p))return res.status(422).json({error:'Content-selection training is not available for this passage yet.'});
      res.set('Cache-Control','no-store');
      res.json({exercise:swtTrainer.exercise(p)});
    } catch(e){sendError(res,e);}
  });

  app.post('/api/interventions/swt-selection/practice/:passageId/check', student, async (req,res) => {
    try {
      const p=await trainerPassage(clean(req.params.passageId,80));
      if(!p)return res.status(404).json({error:'Passage not found.'});
      if(!swtTrainer.eligible(p))return res.status(422).json({error:'Content-selection training is not available for this passage yet.'});
      res.set('Cache-Control','no-store');
      res.json({success:true,result:swtTrainer.grade(p,req.body?.selected||[])});
    } catch(e){sendError(res,e);}
  });

  app.get('/api/interventions/:id/items/:itemId/swt-selection', student, async (req,res) => {
    try {
      const {plan,item}=await trainerItem(req.interventionUser,req.params.id,req.params.itemId);
      const limit=item.exerciseCount||15, catalog=await trainerCatalog(limit);
      if (!catalog.length) return res.status(503).json({error:'SWT selection exercises are unavailable right now.'});
      const progress=item.trainerProgress||{attemptedIds:[],passedIds:[],scores:{}};
      const requested=clean(req.query?.passageId,80);
      const nextMeta=(requested?catalog.find(x=>x.id===requested):null)
        || catalog.find(x=>!progress.attemptedIds.includes(x.id))
        || catalog[0];
      const p=await trainerPassage(nextMeta.id);
      if(!p)return res.status(404).json({error:'Passage not found.'});
      res.set('Cache-Control','no-store');
      res.json({
        exercise:swtTrainer.exercise(p),catalog,
        progress:{attemptedIds:progress.attemptedIds||[],passedIds:progress.passedIds||[],scores:progress.scores||{},
          attempted:(progress.attemptedIds||[]).length,passed:(progress.passedIds||[]).length,
          minimumToComplete:item.minimumToComplete||10,total:catalog.length},
        planId:plan.id,itemId:item.id
      });
    } catch(e){sendError(res,e);}
  });

  app.post('/api/interventions/:id/items/:itemId/swt-selection/check', student, async (req,res) => {
    try {
      const {item}=await trainerItem(req.interventionUser,req.params.id,req.params.itemId);
      const passageId=clean(req.body?.passageId,80);
      const p=await trainerPassage(passageId);
      if(!p)return res.status(404).json({error:'Passage not found.'});
      const catalog=await trainerCatalog(item.exerciseCount||15);
      if(!catalog.some(x=>x.id===String(passageId)))return res.status(400).json({error:'This passage is not part of the assigned exercise set.'});
      const result=swtTrainer.grade(p,req.body?.selected||[]);
      const plan=await store.update(req.interventionUser,req.params.id,current=>{
        const items=(current.items||[]).map(x=>{
          if(String(x.id)!==String(req.params.itemId))return x;
          const progress=x.trainerProgress||{attemptedIds:[],passedIds:[],scores:{}};
          const attemptedIds=[...new Set([...(progress.attemptedIds||[]),String(passageId)])].slice(0,20);
          const passed=result.ideaRecall.percent>=75 && result.selectionPrecision.percent>=60;
          const passedIds=passed?[...new Set([...(progress.passedIds||[]),String(passageId)])].slice(0,20):(progress.passedIds||[]).filter(id=>id!==String(passageId));
          const scores={...(progress.scores||{}),[String(passageId)]:result.score};
          const required=x.minimumToComplete||10;
          const complete=attemptedIds.length>=required;
          return sanitizeItem({...x,trainerProgress:{attemptedIds,passedIds,scores},
            status:complete?'completed':'started',startedAt:x.startedAt||new Date().toISOString(),
            completedAt:complete?(x.completedAt||new Date().toISOString()):null,
            completionSource:complete?'trainer_sync':'',
            completionEvidence:complete?('Completed '+attemptedIds.length+' SWT content-selection exercises; '+passedIds.length+' met the target accuracy.'):''
          },x);
        });
        return sanitizePlan({...current,items,status:current.status==='not_started'?'in_progress':current.status},current);
      });
      const updated=(plan.items||[]).find(x=>String(x.id)===String(req.params.itemId));
      res.json({success:true,result,plan,item:updated,
        progress:{attemptedIds:updated.trainerProgress?.attemptedIds||[],passedIds:updated.trainerProgress?.passedIds||[],scores:updated.trainerProgress?.scores||{},
          attempted:(updated.trainerProgress?.attemptedIds||[]).length,passed:(updated.trainerProgress?.passedIds||[]).length,
          minimumToComplete:updated.minimumToComplete||10,total:catalog.length}});
    } catch(e){sendError(res,e);}
  });

  app.get('/api/interventions', student, async (req, res) => {
    try {
      const plans = await reconcile(req.interventionUser);
      plans.sort((a,b) => Number(active(b))-Number(active(a)) || Date.parse(b.updatedAt||0)-Date.parse(a.updatedAt||0));
      res.set('Cache-Control','no-store'); res.json({ plans });
    } catch (e) { sendError(res,e); }
  });

  app.post('/api/interventions/:id/items/:itemId', student, async (req, res) => {
    try {
      const action = req.body?.action;
      if (!['start','complete','uncomplete'].includes(action)) return res.status(400).json({ error: 'Invalid item action.' });
      const plan = await store.update(req.interventionUser, req.params.id, current => {
        if (['mastered','archived'].includes(current.status)) { const e=new Error('This plan is closed.'); e.status=409; throw e; }
        const items = (current.items || []).map(item => {
          if (String(item.id) !== String(req.params.itemId)) return item;
          const next = { ...item };
          if (action === 'start') {
            if (!next.startedAt) next.startedAt = new Date().toISOString();
            if (next.status !== 'completed') next.status = 'started';
          } else if (action === 'complete') {
            next.startedAt ||= new Date().toISOString(); next.completedAt = new Date().toISOString(); next.status = 'completed';
          } else {
            next.completedAt = null; next.status = next.startedAt ? 'started' : 'not_started';
          }
          return next;
        });
        if (!items.some(i => String(i.id) === String(req.params.itemId))) { const e=new Error('Step not found'); e.status=404; throw e; }
        return sanitizePlan({ ...current, items, status: current.status === 'not_started' ? 'in_progress' : current.status, notificationUnread:false }, current);
      });
      res.json({ success:true, plan });
    } catch (e) { sendError(res,e); }
  });

  app.post('/api/interventions/:id/ready', student, async (req, res) => {
    try {
      const plan = await store.update(req.interventionUser, req.params.id, current => {
        if ((current.items || []).some(item => item.required !== false && item.status !== 'completed')) {
          const e = new Error('Complete the required steps before sending this plan for review.'); e.status=409; throw e;
        }
        return sanitizePlan({ ...current, status:'ready_for_review', notificationUnread:false }, current);
      });
      res.json({ success:true, plan });
    } catch (e) { sendError(res,e); }
  });

  app.post('/api/interventions/:id/notification-read', student, async (req, res) => {
    try {
      const plan = await store.update(req.interventionUser, req.params.id, current => sanitizePlan({ ...current, notificationUnread:false }, current));
      res.json({ success:true, plan });
    } catch (e) { sendError(res,e); }
  });

  app.post('/api/interventions/reconcile', student, async (req,res) => {
    try { res.json({ success:true, plans:await reconcile(req.interventionUser) }); }
    catch (e) { sendError(res,e); }
  });


  function invalidCoachReply(task, reply, profile=null) {
    const text=clean(reply,6000).toLowerCase();
    if(!text)return false;
    if(task==='sst' && /\bspeaking task\b|\bspoken response\b|\boral (?:response|delivery)\b|\bspeak (?:naturally|continuously|clearly|confidently)\b|\bpronunciation\b|\bfluency\b|\bintonation\b|\bmicrophone\b|\bpaus(?:e|es|ing)\b/.test(text)) return true;

    const area=(profile?.areas||[]).find(x=>x?.task===task);
    if(area?.evidenceStrength==='high' && (/\blimited (?:data|evidence)\b/.test(text) || /\bnot enough data\b/.test(text))) return true;

    if(area?.performanceBand==='strong') {
      const relative=(profile?.traitWeaknesses||[]).filter(x=>x?.taskCode===task && x?.interpretation==='relative_improvement_area');
      for(const trait of relative) {
        const name=clean(trait?.trait,80).toLowerCase();
        if(!name)continue;
        if(text.includes(name+' weakness') || text.includes('weakness in '+name) || text.includes('weakness is '+name)
            || text.includes('main '+name+' weakness') || text.includes('primary '+name+' weakness')) return true;
      }
    }
    return false;
  }

  async function callValidatedCoach(task, prompt, profile=null) {
    let result=await callCoachModel(prompt);
    let text=clean(result&&typeof result==='object'?result.text:result,6000);
    let source=clean(result&&typeof result==='object'?result.source:'claude',40)||'claude';
    if(invalidCoachReply(task,text,profile)) {
      const area=(profile?.areas||[]).find(x=>x?.task===task);
      const correction=[
        prompt,
        '',
        'CRITICAL TASK CORRECTION — COACHING EVIDENCE:',
        task==='sst'
          ? 'Keep SST as Listening + Writing: the student listens and TYPES a 50–70 word written summary.'
          : 'Keep the named task contract unchanged.',
        area
          ? 'Reconcile overall task evidence first: '+area.attempts+' usable attempts, '+area.averagePct+'% average, '+area.latestPct+'% latest, performanceBand='+area.performanceBand+', evidenceStrength='+area.evidenceStrength+'.'
          : 'Re-check the overall task evidence before discussing traits.',
        'If overall task performance is strong, a lower trait is a relative improvement area, not automatically the main reason marks are being lost.',
        'Do not call the evidence limited when there are 5 or more usable attempts.',
        'Regenerate the answer from scratch using that hierarchy.'
      ].join('\n');
      result=await callCoachModel(correction);
      text=clean(result&&typeof result==='object'?result.text:result,6000);
      source=clean(result&&typeof result==='object'?result.source:'claude',40)||'claude';
    }
    if(invalidCoachReply(task,text,profile)) {
      const area=(profile?.areas||[]).find(x=>x?.task===task);
      if(area?.performanceBand==='strong') {
        text='Your overall '+(area.label||'task')+' performance is strong across '+area.attempts+' usable attempts (about '+area.averagePct+'% average, latest '+area.latestPct+'%). A lower trait can still be worth polishing, but it should be treated as a relative improvement area rather than the main reason your marks are slipping.';
      } else if(task==='sst') {
        text='For Summarize Spoken Text, focus on the listening and the written summary: identify the main topic, capture the strongest supporting ideas, then type a connected 50–70 word summary.';
      } else {
        text='I can see a possible improvement area, but I should not label one trait as the main weakness without reconciling it with your overall task scores first.';
      }
      source='guardrail';
    }
    return {text,source};
  }

  app.post('/api/interventions/help', student, async (req,res) => {
    try {
      const task = SELF_HELP_TASKS.has(req.body?.task) ? req.body.task : '';
      if (!task) return res.status(400).json({error:'Choose a supported PTE task or General Speaking.'});
      const problem = clean(req.body?.problem, 4000);
      const all = await evidence(req.interventionUser);
      const scripted = betaAdvice(task, problem, all);
      const profile = studentProfile(all);
      let coachReply = '', coachSource = 'scripted';
      if (typeof callCoachModel === 'function') {
        try {
          const prompt = iptCoach.buildPrompt({
            task,
            message: problem || 'How should I improve at this task?',
            history: req.body?.history,
            latestScore: scripted.latestScore,
            studentProfile: profile
          });
          const validated = await callValidatedCoach(task, prompt, profile);
          coachReply = validated.text;
          if (coachReply) coachSource = validated.source || 'ai';
        } catch (_) {
          // The scripted recommendations below remain available when Claude is unavailable.
        }
      }
      res.json({...scripted,coachReply,coachSource,personalized:true});
    } catch (e) { sendError(res,e); }
  });

  app.post('/api/interventions/screen-help', student, async (req,res) => {
    try {
      const requestedTask = clean(req.body?.task, 40);
      const task = SELF_HELP_TASKS.has(requestedTask) ? requestedTask : 'portal';
      const message = clean(req.body?.message, 4000);
      const screenContext = clean(req.body?.screenContext, 12000);
      if (!message) return res.status(400).json({error:'Ask the AI Assistant a question.'});
      if (!screenContext) return res.status(400).json({error:'The current page context is unavailable.'});
      if (typeof callCoachModel !== 'function') return res.status(503).json({error:'The AI Assistant is unavailable right now.'});
      const all = await evidence(req.interventionUser);
      const score = task !== 'portal' ? latestScore(task, all) : null;
      const profile = studentProfile(all);
      const prompt = iptCoach.buildPrompt({
        task,
        message,
        history:req.body?.history,
        latestScore:score,
        screenContext,
        studentProfile:profile
      });
      const validated = await callValidatedCoach(task, prompt, profile);
      const reply = validated.text;
      const source = validated.source;
      if (!reply) return res.status(503).json({error:'The AI Assistant could not produce a response.'});
      res.json({reply,source,task,screenAware:true,personalized:true});
    } catch (e) { sendError(res,e); }
  });

  app.post('/api/interventions/self-plan', student, async (req,res) => {
    try {
      let code = clean(req.body?.moduleCode,60);
      const selectedTask=SELF_HELP_TASKS.has(req.body?.task)?req.body.task:'';
      const problem = clean(req.body?.problem,1000);
      const contentIntent=/important|main idea|central|key (?:point|idea|line|sentence|phrase)|which (?:line|sentence)|select|highlight|content|too much detail|what to include|what is important|improve content/i;
      if(selectedTask==='swt' && ['CP-01','CP-02','SWT-01'].includes(code) && contentIntent.test(problem)) code='SWT-CONTENT-01';
      const catalogue = await modules();
      const module = catalogue.find(m => m.code === code);
      if (!module) return res.status(400).json({error:'That suggested plan is unavailable.'});
      const existing = await store.list(req.interventionUser);
      if (existing.filter(active).length >= 3) return res.status(409).json({error:'You already have 3 active focus areas. Finish one before adding another.'});
      const plan = sanitizePlan({
        moduleCode:module.code, source:'student', area:module.area, task:TASK_NAME[selectedTask] || module.task, weakness:module.weakness,
        title:module.title + ' · IPT Assistant Beta',
        reason:problem ? 'You asked for help with: ' + problem : module.reason,
        priority:'normal', items:module.items || [], notificationUnread:false, status:'not_started'
      }, null, true);
      await store.put(req.interventionUser, plan);
      res.json({success:true, plan});
    } catch (e) { sendError(res,e); }
  });

  app.get('/api/admin/interventions/:username', requireAdmin, async (req, res) => {
    try { res.set('Cache-Control','no-store'); res.json({ plans:await store.list(req.params.username) }); }
    catch (e) { sendError(res,e); }
  });

  app.post('/api/admin/interventions/:username', requireAdmin, async (req, res) => {
    try {
      const username = canonical(req.params.username);
      const account = await getAccount(username);
      if (!account) return res.status(404).json({ error:'No such user.' });
      const existing = await store.list(username);
      if (existing.filter(active).length >= 3) return res.status(409).json({ error:'This student already has 3 active focus areas. Complete or archive one before assigning another.' });
      const plan = sanitizePlan({ ...req.body, source:req.body?.source || 'teacher', status:'not_started', notificationUnread:req.body?.notify !== false }, null, true);
      await store.put(username, plan);
      res.json({ success:true, plan });
    } catch (e) { sendError(res,e); }
  });

  app.post('/api/admin/interventions/:username/:id', requireAdmin, async (req, res) => {
    try {
      const plan = await store.update(req.params.username, req.params.id, current => sanitizePlan({
        ...current,
        ...req.body,
        items: Array.isArray(req.body?.items) ? req.body.items : current.items,
        notificationUnread: req.body?.notify === true ? true : (req.body?.notificationUnread ?? current.notificationUnread)
      }, current));
      res.json({ success:true, plan });
    } catch (e) { sendError(res,e); }
  });

  return { store };
}

module.exports = { installInterventions, createStore, sanitizePlan, sanitizeItem };
