'use strict';
const express = require('express');
const { createStore } = require('./writing-lab-store');
const scoring = require('./writing-lab-scoring');
const report = require('./public/writing-lab-report');
const bank = require('./content/writing-lab.json');
const predictions = require('./content/writing-predictions-sep-2026');
const AUDIO_VERSION = '20260924-neural126';
const clone = value => structuredClone(value);
function roundRobinPairs(items) {
  if (items.length < 2) return [];
  const slots = items.slice();
  if (slots.length % 2) slots.push(null);
  const fixed = slots[0], rotating = slots.slice(1), pairs = [];
  for (let round = 0; round < slots.length - 1; round++) {
    const order = [fixed, ...rotating];
    for (let i = 0; i < order.length / 2; i++) {
      const a = order[i], b = order[order.length - 1 - i];
      if (a && b) pairs.push([a, b]);
    }
    rotating.unshift(rotating.pop());
  }
  return pairs;
}
const predictionSwtPairs = roundRobinPairs(predictions.swt);
// Prediction essays stay unchanged. Every non-essay task comes only from the
// current September 2026 prediction bank; generic practice pools are not used.
const predictionMocks = (bank.predictionEssays || []).map((essay, index) => {
  const number = Number.isInteger(essay.predictionNumber) ? essay.predictionNumber : index + 1;
  const id = 'writing-prediction-mock-' + String(number).padStart(2, '0');
  const swt = (predictionSwtPairs[index] || predictionSwtPairs[index % predictionSwtPairs.length]).map(clone);
  const sst = clone(predictions.sst[(index * 5 + 2) % predictions.sst.length]);
  const wfd = [0, 13, 26].map(offset => {
    const q = clone(predictions.wfd[(index * 3 + offset) % predictions.wfd.length]);
    q.minutes = 4;
    q.timeGroup = 'dictation';
    return q;
  });
  return {
    id,
    title: 'Writing Prediction Mock ' + String(number).padStart(2, '0'),
    category: 'prediction',
    predictionNumber: number,
    predictionSource: predictions.source,
    questions: [
      swt[0],
      swt[1],
      clone({ ...essay, id: id + '-essay', type: 'essay', minutes: 20 }),
      sst,
      ...wfd
    ]
  };
});
const allMocks = [...bank.mocks, ...predictionMocks];
const dictation = [...new Map([...bank.mocks.flatMap(m => m.questions.filter(q => q.type === 'wfd')), ...(bank.dictation || [])].map(q => [q.id, q])).values()];
const bad = (message, status = 400) => Object.assign(Error(message), { status });
function advance(a, at, reason) {
  const previous = a.questions[a.index];
  a.completed[a.index] = { at, reason };
  if (a.index === a.questions.length - 1) { a.status = 'submitted'; a.finishedAt = at; a.deadline = null; }
  else {
    a.index++; a.notes = '';
    const next = a.questions[a.index];
    if (!next.timeGroup || next.timeGroup !== previous.timeGroup) a.deadline = at + next.minutes * 60000;
  }
}
function reconcile(a, now = Date.now()) {
  while (a.status === 'active' && now >= a.deadline) advance(a, a.deadline, 'Time expired');
  return a;
}
function present(a) {
  const result = { ...a, serverNow: Date.now(), report: a.status === 'submitted' ? report.summarize(a.questions, a.results) : null };
  if (a.status !== 'submitted') result.results = a.questions.map(() => null);
  result.questions = a.questions.map((q,i) => ({ id:q.id, type:q.type, title:q.title, minutes:q.minutes, timeGroup:q.timeGroup,
    ...(q.predictionSource ? { predictionSource:q.predictionSource } : {}),
    ...(a.status === 'submitted' || i <= a.index ? { text:['sst','wfd'].includes(q.type) && a.status !== 'submitted' ? '' : q.text } : {}),
    ...(['sst','wfd'].includes(q.type) && (i <= a.index || a.status === 'submitted') ? { audioUrl:'/writing-audio/' + q.id + '.mp3?v=' + AUDIO_VERSION } : {}),
    ...(a.status === 'submitted' ? { sample:q.sample, keyPoints:q.keyPoints } : {}) }));
  return result;
}
function installWritingLab(app, { pool, directory, verifyToken, getAccount, callModel }) {
  const router = express.Router(), store = createStore(pool, directory), pending = new Map();
  // A submitted answer is immutable. Assess outside the answer-save transaction,
  // and share the same job with the results page to avoid duplicate model calls.
  const queue = [], failedAt = new Map();
  let running = 0;
  function drain() {
    while (running < 2 && queue.length) {
      const run = queue.shift(); running++;
      run().finally(() => { running--; drain(); });
    }
  }
  function assess(uid, a, index) {
    if (a.results[index]) return Promise.resolve(a.results[index]);
    const key = uid + ':' + a.id + ':' + index;
    if (pending.has(key)) return pending.get(key);
    const task = new Promise((resolve, reject) => {
      queue.push(async () => {
        try {
          // Reload after waiting in the queue: a review request may have saved it.
          const current = await store.update(uid, a.id, value => {
            if (!value) throw bad('Attempt not found.', 404);
            return value;
          });
          if (!current.completed[index]) throw bad('Submit this answer first.', 409);
          const result = current.results[index] || await scoring.grade(current.questions[index], current.answers[index], callModel);
          const updated = await store.update(uid, a.id, value => {
            if (!value) throw bad('Attempt not found.', 404);
            value.results[index] ||= result;
            return value;
          });
          failedAt.delete(key); resolve(updated.results[index]);
        } catch (error) { failedAt.set(key, Date.now()); reject(error); }
        finally { pending.delete(key); }
      });
    });
    pending.set(key, task); drain();
    return task;
  }
  function assessSubmitted(uid, a) {
    a.questions.forEach((q, index) => {
      const key = uid + ':' + a.id + ':' + index;
      if (a.completed[index] && !a.results[index] && Date.now() - (failedAt.get(key) || 0) > 60000)
        assess(uid, a, index).catch(error => console.warn('[writing-lab] background assessment', error.message));
    });
  }
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
    predictionBank:{source:predictions.source,mockCount:predictionMocks.length,unique:{swt:predictions.swt.length,sst:predictions.sst.length,wfd:predictions.wfd.length}},
    spoken:bank.spoken.map(q => ({ id:q.id,title:q.title,topic:q.topic,minutes:q.minutes,audioUrl:'/writing-audio/'+q.id+'.mp3?v='+AUDIO_VERSION })),
    dictation:dictation.map(q => ({ id:q.id,title:q.title,minutes:q.minutes,audioUrl:'/writing-audio/'+q.id+'.mp3?v='+AUDIO_VERSION })),
    mocks:allMocks.map(m => ({ id:m.id,title:m.title,category:m.category || 'special',predictionNumber:m.predictionNumber || null,predictionSource:m.predictionSource || null,minutes:report.minutesFor(m.questions),questionCount:m.questions.length,
      tasks:Object.entries(report.labels).flatMap(([type,label]) => {
        const questions=m.questions.filter(q=>q.type===type);
        return questions.length ? [{type,label,count:questions.length,minutes:questions[0].minutes,shared:!!questions[0].timeGroup}] : [];
      }) })) }));
  router.get('/session', route(async(req,res) => { res.set('Cache-Control','no-store'); res.json({ username:await identify(req) }); }));
  router.use(async(req,res,next) => {
    try {
      req.labUser = await identify(req);
      if (!req.labUser) return res.status(401).json({error:'Please sign in to your existing account to practise.'});
      next();
    } catch (_) { res.status(503).json({error:'Your account could not be checked. Please retry.'}); }
  });
  const rateLimit = require('express-rate-limit');
  router.post('/attempts', rateLimit({windowMs:600000,max:120,keyGenerator:req=>req.labUser,standardHeaders:true,legacyHeaders:false,
    message:{error:'Please wait before starting another attempt.'}}));
  router.post('/attempts/:id/score/:index', rateLimit({windowMs:60000,max:20,standardHeaders:true,legacyHeaders:false,
    message:{error:'Please wait a minute before requesting more scores.'}}));
  router.get('/attempts', route(async(req,res) => {
    const all = await store.list(req.labUser);
    const entries = [];
    for (const a of all) {
      const current = a.status==='active' && Date.now()>=a.deadline ? await store.update(req.labUser,a.id, value => reconcile(value)) : a;
      const summary = report.summarize(current.questions, current.results);
      entries.push({ id:current.id,testId:current.testId,title:current.title,kind:current.kind,status:current.status,startedAt:current.startedAt,
        index:current.index, completed:current.completed.filter(Boolean).length,questions:current.questions.length,
        questionIds:current.questions.map(q=>q.id),
        total:summary.complete ? summary.total : null, maximum:summary.maximum, score90:summary.score90 });
    }
    res.set('Cache-Control','no-store'); res.json(entries);
  }));
  router.post('/attempts', route(async(req,res) => {
    const { id, testId } = req.body || {};
    const mock = allMocks.find(m => m.id === testId), individual = [...bank.spoken, ...dictation].find(q => q.id === testId);
    if (!mock && !individual) throw bad('Question set not found.',404);
    const q = structuredClone(mock ? mock.questions : [individual]);
    if (!mock) delete q[0].timeGroup;
    const a = await store.update(req.labUser, id, existing => {
      if (existing) return reconcile(existing);
      return { id,testId,title:mock?.title || individual.title,kind:mock ? 'mock' : individual.type,questions:q,index:0,
        status:mock ? 'active' : 'ready',startedAt:Date.now(),deadline:mock ? Date.now()+q[0].minutes*60000 : null,
        answers:q.map(()=>''),notes:'',revisions:q.map(()=>0),completed:q.map(()=>null),results:q.map(()=>null),playback:q.map(()=>null) };
    });
    assessSubmitted(req.labUser, a);
    res.json(present(a));
  }));
  router.get('/attempts/:id', route(async(req,res) => {
    const a = await store.update(req.labUser,req.params.id,value => { if (!value) throw bad('Attempt not found.',404); return reconcile(value); });
    assessSubmitted(req.labUser, a);
    res.set('Cache-Control','no-store'); res.json(present(a));
  }));
  router.post('/attempts/:id/begin', route(async(req,res) => {
    const a = await store.update(req.labUser,req.params.id,value => {
      if (!value) throw bad('Attempt not found.',404);
      if(value.status === 'ready') { value.status='active'; value.startedAt=Date.now(); value.deadline=value.startedAt+value.questions[0].minutes*60000; }
      return reconcile(value);
    });
    assessSubmitted(req.labUser, a);
    res.json(present(a));
  }));
  router.post('/attempts/:id/answer', route(async(req,res) => {
    const { index,text,revision,next,notes,playback } = req.body || {};
    if (!Number.isInteger(index) || typeof text !== 'string' || text.length>20000 || !Number.isSafeInteger(revision) || revision<1 || (notes != null && (typeof notes !== 'string' || notes.length>10000))) throw bad('Invalid answer.');
    if (playback != null && (!Number.isFinite(playback.position) || playback.position < 0 || playback.position > 600 || typeof playback.finished !== 'boolean')) throw bad('Invalid playback position.');
    const a = await store.update(req.labUser,req.params.id,value => {
      if(!value) throw bad('Attempt not found.',404);
      reconcile(value);
      // A repeated Next request returns the new state without skipping another item.
      if(value.status !== 'active' || index !== value.index) return value;
      if(revision <= value.revisions[index]) return value;
      value.answers[index]=text; value.revisions[index]=revision;
      if(typeof notes === 'string') value.notes=notes;
      if (playback && ['sst','wfd'].includes(value.questions[index].type)) {
        value.playback ||= value.questions.map(()=>null);
        const old = value.playback[index];
        // Earlier browser-speech failures could save a finished flag at zero seconds.
        // A recording that never played must remain available to the student.
        value.playback[index] = {position:Math.max(old?.position || 0, playback.position),
          finished:(!!old?.finished && old.position > 0) || (playback.finished && playback.position > 0)};
      }
      if(next === true) advance(value,Date.now(),'Submitted');
      return value;
    });
    assessSubmitted(req.labUser, a);
    res.json(present(a));
  }));
  router.post('/attempts/:id/score/:index', route(async(req,res) => {
    const a = await store.update(req.labUser,req.params.id,value => { if(!value) throw bad('Attempt not found.',404); return reconcile(value); });
    const index=Number(req.params.index);
    if(a.status !== 'submitted') throw bad('Finish the attempt before viewing scores.',409);
    if(!Number.isInteger(index) || !a.questions[index]) throw bad('Question not found.',404);
    if(a.results[index]) return res.json(a.results[index]);
    res.json(await assess(req.labUser, a, index));
  }));
  app.use('/api/writing-lab', router);
  return { store };
}
module.exports = { installWritingLab, advance, reconcile, present, predictionMocks };
