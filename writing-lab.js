'use strict';
const express = require('express');
const { createStore } = require('./writing-lab-store');
const scoring = require('./writing-lab-scoring');
const bank = require('./content/writing-lab.json');
const bad = (message, status = 400) => Object.assign(Error(message), { status });
function advance(a, at, reason) {
  a.completed[a.index] = { at, reason };
  if (a.index === a.questions.length - 1) { a.status = 'submitted'; a.finishedAt = at; a.deadline = null; }
  else { a.index++; a.deadline = at + a.questions[a.index].minutes * 60000; }
}
function reconcile(a, now = Date.now()) {
  while (a.status === 'active' && now >= a.deadline) advance(a, a.deadline, 'Time expired');
  return a;
}
function present(a) {
  const result = { ...a, serverNow: Date.now() };
  result.questions = a.questions.map((q,i) => ({ id:q.id, type:q.type, title:q.title, minutes:q.minutes,
    ...(a.status === 'submitted' || i <= a.index ? { text:q.type === 'sst' && a.status !== 'submitted' ? '' : q.text } : {}),
    ...(q.type === 'sst' ? { audioUrl:'/writing-audio/' + q.id + '.mp3' } : {}),
    ...(a.status === 'submitted' ? { sample:q.sample, keyPoints:q.keyPoints } : {}) }));
  return result;
}
function installWritingLab(app, { pool, directory, verifyToken, getAccount, callModel }) {
  const router = express.Router(), store = createStore(pool, directory), pending = new Map();
  const route = fn => async (req,res) => { try { await fn(req,res); } catch(e) {
    console.warn('[writing-lab]', e.status || 503, e.message);
    res.status(e.status || 503).json({ error:e.status ? e.message : 'This action could not be completed. Your saved answers are safe. Please retry.' });
  } };
  const identify = async req => {
    const uid = verifyToken(req.headers['x-session-token'] || '');
    if (!uid) return null;
    const account = await getAccount(uid);
    return account && !account.blocked ? uid : null;
  };
  router.get('/catalog', (req,res) => res.json({ version:bank.version,
    spoken:bank.spoken.map(q => ({ id:q.id,title:q.title,topic:q.topic,minutes:q.minutes,audioUrl:'/writing-audio/'+q.id+'.mp3' })),
    mocks:bank.mocks.map(m => ({ id:m.id,title:m.title,description:m.description,minutes:40,questionCount:3 })) }));
  router.get('/session', route(async(req,res) => { res.set('Cache-Control','no-store'); res.json({ username:await identify(req) }); }));
  router.use(async(req,res,next) => {
    try {
      req.labUser = await identify(req);
      if (!req.labUser) return res.status(401).json({error:'Please sign in to your existing account to practise.'});
      next();
    } catch (_) { res.status(503).json({error:'Your account could not be checked. Please retry.'}); }
  });
  const rateLimit = require('express-rate-limit');
  router.post('/attempts', rateLimit({windowMs:600000,max:15,standardHeaders:true,legacyHeaders:false,
    message:{error:'Please wait before starting another attempt.'}}));
  router.post('/attempts/:id/score/:index', rateLimit({windowMs:60000,max:20,standardHeaders:true,legacyHeaders:false,
    message:{error:'Please wait a minute before requesting more scores.'}}));
  router.get('/attempts', route(async(req,res) => {
    const all = await store.list(req.labUser);
    const entries = [];
    for (const a of all) {
      const current = await store.update(req.labUser,a.id, value => reconcile(value));
      entries.push({ id:current.id,title:current.title,kind:current.kind,status:current.status,startedAt:current.startedAt,
        completed:current.completed.filter(Boolean).length,questions:current.questions.length,
        total:current.results.every(Boolean) ? current.results.reduce((n,r) => n+r.total,0) : null,
        maximum:current.questions.reduce((n,q) => n+Object.values(scoring.MAXIMA[q.type]).reduce((x,y)=>x+y,0),0) });
    }
    res.set('Cache-Control','no-store'); res.json(entries);
  }));
  router.post('/attempts', route(async(req,res) => {
    const { id, testId } = req.body || {};
    const mock = bank.mocks.find(m => m.id === testId), spoken = bank.spoken.find(q => q.id === testId);
    if (!mock && !spoken) throw bad('Question set not found.',404);
    const q = structuredClone(mock ? mock.questions : [spoken]);
    const a = await store.update(req.labUser, id, existing => {
      if (existing) return reconcile(existing);
      return { id,testId,title:mock?.title || spoken.title,kind:mock ? 'mock' : 'sst',questions:q,index:0,
        status:mock ? 'active' : 'ready',startedAt:Date.now(),deadline:mock ? Date.now()+q[0].minutes*60000 : null,
        answers:q.map(()=>''),notes:'',revisions:q.map(()=>0),completed:q.map(()=>null),results:q.map(()=>null) };
    });
    res.json(present(a));
  }));
  router.get('/attempts/:id', route(async(req,res) => {
    const a = await store.update(req.labUser,req.params.id,value => { if (!value) throw bad('Attempt not found.',404); return reconcile(value); });
    res.set('Cache-Control','no-store'); res.json(present(a));
  }));
  router.post('/attempts/:id/begin', route(async(req,res) => {
    const a = await store.update(req.labUser,req.params.id,value => {
      if (!value) throw bad('Attempt not found.',404);
      if(value.status === 'ready') { value.status='active'; value.startedAt=Date.now(); value.deadline=Date.now()+600000; }
      return reconcile(value);
    });
    res.json(present(a));
  }));
  router.post('/attempts/:id/answer', route(async(req,res) => {
    const { index,text,revision,next,notes } = req.body || {};
    if (!Number.isInteger(index) || typeof text !== 'string' || text.length>20000 || !Number.isSafeInteger(revision) || revision<1 || (notes != null && (typeof notes !== 'string' || notes.length>10000))) throw bad('Invalid answer.');
    const a = await store.update(req.labUser,req.params.id,value => {
      if(!value) throw bad('Attempt not found.',404);
      reconcile(value);
      // A repeated Next request returns the new state without skipping another item.
      if(value.status !== 'active' || index !== value.index) return value;
      if(revision <= value.revisions[index]) return value;
      value.answers[index]=text; value.revisions[index]=revision;
      if(typeof notes === 'string') value.notes=notes;
      if(next === true) advance(value,Date.now(),'Submitted');
      return value;
    });
    res.json(present(a));
  }));
  router.post('/attempts/:id/score/:index', route(async(req,res) => {
    const a = await store.update(req.labUser,req.params.id,value => { if(!value) throw bad('Attempt not found.',404); return reconcile(value); });
    const index=Number(req.params.index);
    if(a.status !== 'submitted') throw bad('Finish the attempt before viewing scores.',409);
    if(!Number.isInteger(index) || !a.questions[index]) throw bad('Question not found.',404);
    if(a.results[index]) return res.json(a.results[index]);
    const key=req.labUser+':'+a.id+':'+index;
    if(!pending.has(key)) {
      const task=(async()=>{
        const result=await scoring.grade(a.questions[index],a.answers[index],callModel);
        const updated=await store.update(req.labUser,a.id,value=>{ if(!value) throw bad('Attempt not found.',404); value.results[index] ||= result; return value; });
        return updated.results[index];
      })();
      pending.set(key,task); task.finally(()=>pending.delete(key)).catch(()=>{});
    }
    res.json(await pending.get(key));
  }));
  app.use('/api/writing-lab', router);
  return { store };
}
module.exports = { installWritingLab, advance, reconcile, present };
