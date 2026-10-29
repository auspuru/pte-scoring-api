'use strict';
const express = require('express');
const path = require('node:path');
const fs = require('node:fs/promises');
const { loadPaper, digest, assertReleased } = require('./paper');
const { createStore, fail } = require('./store');
const session = require('./session');
const reports = require('./report');

function installFullMock(app, { pool, directory, verifyToken, getAccount, canPreview = ({ account }) => account.role === 'admin', now = Date.now, paper = loadPaper(), assessment } = {}) {
  const store = createStore({ pool, directory }), router = express.Router();
  const assessor = assessment ? require('./assessment').createEngine({ store, now, paper, ...assessment }) : null;
  let sweep;
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(error => res.status(error.status || 503).json({ error: error.status ? error.message : 'This action could not finish. Your saved responses are retained; retry when connected.' }));
  router.use(wrap(async (req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' });
    const token = req.headers['x-session-token'] || '', uid = verifyToken(token), account = uid && await getAccount(uid);
    if (!account || account.blocked) throw fail('Please sign in to your practice account.', 401);
    req.fullMock = { uid, preview: !!await canPreview({ account, token, uid, req }) };
    if (req.is('application/json') && JSON.stringify(req.body || {}).length > 20000) throw fail('This request is too large.', 413);
    next();
  }));
  router.use(require('express-rate-limit')({ windowMs: 60000, max: 360, keyGenerator: req => req.fullMock.uid,
    standardHeaders: true, legacyHeaders: false, message: { error: 'Please wait briefly before retrying.' } }));
  function available(context) { if (context.preview) return true; try { assertReleased(paper); return true; } catch { return false; } }
  async function settle(record, uid) {
    if (assessor && record.state.status === 'submitted') {
      try {
        if (record.state.assessment?.status === 'not-requested') record.state = await assessor.request(uid, record.state.id);
        else if (['needs-attention','complete'].includes(record.state.assessment?.status)) record.state = await assessor.wakeMedia(uid, record.state.id) || record.state;
      } catch (error) { if (error.status !== 409) throw error; record.state.assessment = { ...record.state.assessment, displayStatus: 'version-mismatch' }; }
    }
    return record;
  }
  async function read(uid, id, context) {
    const record = await store.get(uid, id); if (!record) throw fail('Attempt not found.', 404);
    if (context && record.state.preview && !context.preview) throw fail('This draft attempt is restricted to authorised preview users.', 403);
    if (digest(record.paper) !== record.state.paperHash) throw fail('The saved paper could not be verified. Your responses are retained.', 503);
    record.state = await store.update(uid, id, state => session.reconcile(state, record.paper, now()));
    return settle(record, uid);
  }
  const view = record => session.present(record.state, record.paper, now());
  async function change(req, transform, { controlling = true } = {}) {
    const record = await read(req.fullMock.uid, req.params.id, req.fullMock);
    record.state = await store.update(req.fullMock.uid, req.params.id, state => {
      session.reconcile(state, record.paper, now());
      if (controlling) session.control(state, req.headers['x-full-mock-control'], now());
      transform(state, record.paper); return state;
    });
    return settle(record, req.fullMock.uid);
  }
  router.get('/catalog', wrap(async (req, res) => res.json({ available: available(req.fullMock), preview: paper.status !== 'released',
    papers: available(req.fullMock) ? [{ id: paper.id, version: paper.version, title: paper.title, questionCount: 65, taskTypeCount: 22, preview: paper.status !== 'released' }] : [] })));
  router.get('/attempts', wrap(async (req, res) => {
    const saved = (await store.list(req.fullMock.uid)).filter(state => !state.preview || req.fullMock.preview).sort((a, b) => b.createdAt - a.createdAt);
    const rows = [];
    for (const state of saved) {
      const record = await read(req.fullMock.uid, state.id, req.fullMock);
      rows.push(reports.summary(record.paper, record.state, now()));
    }
    res.json(rows);
  }));
  router.post('/attempts', wrap(async (req, res) => {
    if (!available(req.fullMock)) throw fail('Full Mock 1 is not available for student attempts yet.', 403);
    if (req.body?.paperId !== paper.id || req.body?.checks?.microphone !== true || req.body?.checks?.playback !== true) throw fail('Complete the microphone and playback checks first.', 400);
    const make = (id, at) => session.create(id, paper, at, { preview: paper.status !== 'released' && req.fullMock.preview, assessmentSnapshot: assessor?.snapshot });
    let record = await store.create(req.fullMock.uid, req.body.id, paper, make, now());
    record = await read(req.fullMock.uid, record.state.id, req.fullMock);
    if (record.state.status === 'submitted' && record.state.id !== req.body.id) record = await store.create(req.fullMock.uid, req.body.id, paper, make, now());
    res.json(view(record));
  }));
  router.get('/attempts/:id', wrap(async (req, res) => res.json(view(await read(req.fullMock.uid, req.params.id, req.fullMock)))));
  router.post('/attempts/:id/assessment', wrap(async (req, res) => {
    if (!assessor) throw fail('Assessment is not enabled.', 503);
    await read(req.fullMock.uid, req.params.id, req.fullMock);
    const state = await assessor.request(req.fullMock.uid, req.params.id, { retry: req.body?.retry === true });
    res.status(202).json({ id: state.id, status: state.assessment.status });
  }));
  router.get('/attempts/:id/results', wrap(async (req, res) => {
    await read(req.fullMock.uid, req.params.id, req.fullMock);
    if (!assessor) throw fail('Assessment is not enabled.', 503);
    res.json(await assessor.results(req.fullMock.uid, req.params.id));
  }));
  router.get('/attempts/:id/report', wrap(async (req, res) => {
    const record = await read(req.fullMock.uid, req.params.id, req.fullMock);
    res.json(reports.buildReport(record.paper, record.state, now()));
  }));
  router.get('/attempts/:id/review/:questionId/media/:asset', wrap(async (req, res) => {
    const record = await read(req.fullMock.uid, req.params.id, req.fullMock);
    const { candidate } = reports.reviewItem(record.paper, record.state, req.params.questionId);
    const descriptor = candidate.audio?.entry.audioSha256 === req.params.asset ? candidate.audio : candidate.image?.sha256 === req.params.asset ? candidate.image : null;
    const asset = descriptor && record.paper.assets.find(value => value.path === descriptor.path && value.sha256 === req.params.asset);
    if (!asset) throw fail('Review media not found.', 404);
    const bytes = await fs.readFile(path.join(__dirname, '..', asset.path));
    if (require('./store').hash(bytes) !== asset.sha256) throw fail('Review media failed verification.', 503);
    res.type(asset.mime).send(bytes);
  }));
  router.get('/attempts/:id/review/:questionId/recordings/:segment', wrap(async (req, res) => {
    const record = await read(req.fullMock.uid, req.params.id, req.fullMock);
    const { response } = reports.reviewItem(record.paper, record.state, req.params.questionId);
    const audio = await reports.recordingBytes(req.fullMock.uid, req.params.id, response, req.params.segment, store.getChunk);
    res.type(audio.mime).send(audio.bytes);
  }));
  router.post('/attempts/:id/claim', wrap(async (req, res) => res.json(view(await change(req, state => session.claim(state, req.body || {}, now()), { controlling: false })))));
  router.post('/attempts/:id/pulse', wrap(async (req, res) => res.json(view(await change(req, () => {})))));
  router.post('/attempts/:id/draft', wrap(async (req, res) => res.json(view(await change(req, (state, savedPaper) => session.saveDraft(state, savedPaper, req.body || {}))))));
  router.post('/attempts/:id/next', wrap(async (req, res) => res.json(view(await change(req, (state, savedPaper) => session.next(state, savedPaper, req.body || {}, now()))))));
  router.post('/attempts/:id/recover', wrap(async (req, res) => res.json(view(await change(req, (state, savedPaper) => session.recover(state, savedPaper, req.body || {}, now()), { controlling: false })))));
  router.post('/attempts/:id/segments', wrap(async (req, res) => res.json(view(await change(req, (state, savedPaper) => {
    const response = state.responses.find(value => value.token === req.body?.itemToken);
    if (response?.permit?.id !== req.body?.segmentId || response.permit.token !== req.body.segmentToken) session.control(state, req.headers['x-full-mock-control'], now());
    session.openSegment(state, savedPaper, req.body || {}, now());
  }, { controlling: false })))));
  router.post('/attempts/:id/end', wrap(async (req, res) => {
    if (req.body?.confirm !== true) throw fail('Confirm final submission.', 400);
    res.json(view(await change(req, (state, savedPaper) => session.end(state, savedPaper, now()))));
  }));
  router.put('/attempts/:id/segments/:segment/:sequence', express.raw({ type: ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/mpeg'], limit: '512kb' }), wrap(async (req, res) => {
    const sequence = Number(req.params.sequence), bytes = req.body, token = req.headers['x-full-mock-item'], secret = req.headers['x-full-mock-segment'];
    if (!Buffer.isBuffer(bytes) || !bytes.length || !Number.isInteger(sequence) || sequence < 0 || sequence > 255) throw fail('Invalid recording chunk.', 400);
    const record = await read(req.fullMock.uid, req.params.id, req.fullMock);
    const { segment } = session.findSegment(record.state, token, req.params.segment, secret, now());
    const mime = req.get('Content-Type').split(';')[0]; if (segment.mime !== mime) throw fail('Recording format changed.', 400);
    if (segment.finished && !segment.chunks[sequence]) throw fail('This recording is already finalised.');
    const { hash } = require('./store'), metadata = { sha256: hash(bytes), bytes: bytes.length, stored: false };
    // Reserve quota before writing bytes. A failed write remains pending and an
    // identical retry can finish it; simultaneous uploads cannot bypass limits.
    await store.update(req.fullMock.uid, req.params.id, state => { session.registerChunk(state, token, req.params.segment, secret, sequence, metadata, now()); return state; });
    await store.putChunk(req.fullMock.uid, req.params.id, req.params.segment, sequence, mime, bytes);
    await store.update(req.fullMock.uid, req.params.id, state => { const { segment: saved } = session.findSegment(state, token, req.params.segment, secret, now()); saved.chunks[sequence].stored = true; return state; });
    res.json({ saved: true, ...metadata, stored: true });
  }));
  router.post('/attempts/:id/segments/:segment/finish', wrap(async (req, res) => res.json(view(await change(req, state => session.finishSegment(state, req.body.itemToken, req.params.segment, req.body.segmentToken, req.body.chunks, now()), { controlling: false })))));
  router.post('/attempts/:id/events', wrap(async (req, res) => {
    const allowed = ['tab-hidden', 'window-blur', 'media-failure', 'microphone-interrupted', 'recording-resumed', 'local-storage-failure',
      'fullscreen-exit', 'fullscreen-required', 'external-paste-blocked', 'external-drop-blocked'];
    if (!allowed.includes(req.body?.reason)) throw fail('Invalid event.', 400);
    await change(req, state => { if (state.events.length < 500) state.events.push({ reason: req.body.reason, receivedAt: now(), index: state.index }); }, { controlling: false });
    res.json({ saved: true });
  }));
  router.get('/attempts/:id/media/:asset', wrap(async (req, res) => {
    const record = await read(req.fullMock.uid, req.params.id, req.fullMock), state = record.state;
    if (state.status !== 'active') throw fail('Question media is not available.', 404);
    const candidate = session.item(record.paper, state.index);
    const descriptor = candidate.audio?.entry.audioSha256 === req.params.asset ? candidate.audio : candidate.image?.sha256 === req.params.asset ? candidate.image : null;
    if (!descriptor || descriptor === candidate.audio && now() >= state.current.promptEndsAt) throw fail('Question media is not available.', 404);
    const asset = record.paper.assets.find(value => value.path === descriptor.path && value.sha256 === req.params.asset);
    if (!asset) throw fail('Question media is not available.', 404);
    const bytes = await fs.readFile(path.join(__dirname, '..', asset.path));
    const { hash } = require('./store'); if (hash(bytes) !== asset.sha256) throw fail('Question media failed verification.', 503);
    res.type(asset.mime).send(bytes);
  }));
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(error.status || 503).json({ error: error.status === 413 ? 'This recording chunk is too large.' : 'This request could not be read. Retry the saved action.' });
  });
  app.use('/api/full-mocks', router);
  async function reconcileAll() {
    for (const value of await store.active(now())) { try { await read(value.uid, value.id); } catch { /* A transient failure retains the existing attempt. */ } }
  }
  function start() { assessor?.start(); if (!sweep) { sweep = setInterval(() => reconcileAll().catch(() => {}), 10000); sweep.unref?.(); } }
  function stop() { clearInterval(sweep); sweep = null; return assessor?.stop(); }
  return { store, assessor, start, stop, reconcileAll };
}
module.exports = { installFullMock };
