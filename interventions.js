const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const PLAN_STATUSES = new Set(['not_started','in_progress','ready_for_review','mastered','archived']);
const ITEM_KINDS = new Set(['video','question','practice','message']);
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
    required: input.required === undefined ? (existing?.required !== false) : input.required !== false,
    requireNewAttempt: input.requireNewAttempt === undefined ? !!existing?.requireNewAttempt : !!input.requireNewAttempt,
    status: input.status === 'completed' ? 'completed' : (input.status === 'started' ? 'started' : (existing?.status || 'not_started')),
    startedAt: input.startedAt === null ? null : (iso(input.startedAt) || existing?.startedAt || null),
    completedAt: input.completedAt === null ? null : (iso(input.completedAt) || existing?.completedAt || null)
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
  const { pool = null, directory, verifyToken, getAccount, requireAdmin } = options;
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

  app.get('/api/interventions', student, async (req, res) => {
    try {
      const plans = await store.list(req.interventionUser);
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
