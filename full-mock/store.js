'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const fail = (message, status = 409) => Object.assign(Error(message), { status });
const hash = value => createHash('sha256').update(value).digest('hex');
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

// Filesystem revisions are claimed with an atomic hard link. Keeping old names
// (but pruning their payloads) prevents stale writers from claiming an old revision.
async function readVersion(directory) {
  let files;
  try { files = await fs.readdir(directory); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const names = files.filter(file => /^\d{12}\.json$/.test(file)).sort().reverse();
  for (const name of names.slice(0, 8)) {
    try { const bytes = await fs.readFile(path.join(directory, name), 'utf8'); if (bytes) return { revision: Number(name.slice(0, 12)), value: JSON.parse(bytes) }; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return null;
}
async function claimVersion(directory, revision, value) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, String(revision).padStart(12, '0') + '.json');
  const temporary = path.join(directory, randomUUID() + '.tmp');
  await fs.writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
  try { await fs.link(temporary, file); }
  catch (error) { if (error.code === 'EEXIST') return false; throw error; }
  finally { await fs.rm(temporary, { force: true }); }
  if (revision > 8) await fs.truncate(path.join(directory, String(revision - 8).padStart(12, '0') + '.json'), 0).catch(() => {});
  return true;
}
async function casFile(directory, transform) {
  for (let retry = 0; retry < 20; retry++) {
    const before = await readVersion(directory), original = JSON.stringify(before?.value ?? null);
    const next = await transform(before?.value ?? null);
    if (next === undefined || JSON.stringify(next) === original) return before?.value ?? null;
    if (await claimVersion(directory, (before?.revision || 0) + 1, next)) return next;
  }
  throw fail('This attempt is busy. Retry the saved action.', 503);
}
function createStore({ pool, directory }) {
  let ready;
  const ownerDirectory = uid => path.join(directory, hash(String(uid)));
  function attemptDirectory(uid, id) { if (!uuid(id)) throw fail('Invalid attempt.', 400); return pool ? null : path.join(ownerDirectory(uid), id); }
  async function initialise() {
    if (!ready) ready = (async () => {
      if (!pool) { await fs.mkdir(directory, { recursive: true, mode: 0o700 }); return; }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // IF NOT EXISTS does not serialize concurrent catalogue creation by
        // independent server processes. Keep startup DDL on one transaction.
        await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()::text), hashtext('full-mock-schema'))");
        await client.query(`CREATE TABLE IF NOT EXISTS full_mock_attempts (
        id UUID PRIMARY KEY, username TEXT NOT NULL REFERENCES accounts(username) ON DELETE CASCADE,
        paper JSONB NOT NULL, state JSONB NOT NULL, revision BIGINT NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
        CREATE UNIQUE INDEX IF NOT EXISTS full_mock_one_active_user ON full_mock_attempts(username) WHERE state->>'status'='active';
        CREATE INDEX IF NOT EXISTS full_mock_user_updated ON full_mock_attempts(username,updated_at DESC);
        CREATE TABLE IF NOT EXISTS full_mock_audio_chunks (
        attempt_id UUID NOT NULL REFERENCES full_mock_attempts(id) ON DELETE CASCADE,
        segment_id UUID NOT NULL, sequence INTEGER NOT NULL, sha256 TEXT NOT NULL, mime TEXT NOT NULL,
        payload BYTEA NOT NULL, PRIMARY KEY(attempt_id,segment_id,sequence));`);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
    })().catch(error => { ready = null; throw error; });
    return ready;
  }
  async function get(uid, id) {
    await initialise(); attemptDirectory(uid, id);
    if (pool) { const row = (await pool.query('SELECT paper,state FROM full_mock_attempts WHERE id=$1 AND username=$2', [id, uid])).rows[0]; return row || null; }
    const folder = attemptDirectory(uid, id), record = await readVersion(path.join(folder, 'state'));
    if (!record) return null;
    return { state: record.value, paper: JSON.parse(await fs.readFile(path.join(folder, 'paper.json'), 'utf8')) };
  }
  async function update(uid, id, transform) {
    await initialise(); attemptDirectory(uid, id);
    if (!pool) return casFile(path.join(attemptDirectory(uid, id), 'state'), state => {
      if (!state) throw fail('Attempt not found.', 404); return transform(state);
    });
    for (let retry = 0; retry < 20; retry++) {
      const row = (await pool.query('SELECT state,revision FROM full_mock_attempts WHERE id=$1 AND username=$2', [id, uid])).rows[0];
      if (!row) throw fail('Attempt not found.', 404);
      const original = JSON.stringify(row.state), state = await transform(row.state);
      if (state === undefined || JSON.stringify(state) === original) return row.state;
      const result = await pool.query('UPDATE full_mock_attempts SET state=$3,revision=revision+1,updated_at=NOW() WHERE id=$1 AND username=$2 AND revision=$4 RETURNING state', [id, uid, JSON.stringify(state), row.revision]);
      if (result.rows.length) return result.rows[0].state;
    }
    throw fail('This attempt is busy. Retry the saved action.', 503);
  }
  async function create(uid, id, paper, makeState, now) {
    await initialise(); attemptDirectory(uid, id);
    const existing = await get(uid, id); if (existing) return existing;
    if (pool) {
      const state = makeState(id, now);
      try { const row = (await pool.query('INSERT INTO full_mock_attempts(id,username,paper,state) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING paper,state', [id, uid, JSON.stringify(paper), JSON.stringify(state)])).rows[0]; if (row) return row; }
      catch (error) { if (error.code !== '23505') throw error; }
      const row = (await pool.query("SELECT paper,state FROM full_mock_attempts WHERE username=$1 AND (id=$2 OR state->>'status'='active') ORDER BY (id=$2) DESC LIMIT 1", [uid, id])).rows[0];
      if (!row) throw fail('Attempt not found.', 404); return row;
    }
    const indexDirectory = path.join(ownerDirectory(uid), 'index');
    const index = await casFile(indexDirectory, async old => {
      old ||= { owner: uid, ids: [], active: null };
      if (old.active) {
        const active = await readVersion(path.join(attemptDirectory(uid, old.active.id), 'state'));
        if (!active || active.value.status === 'active') return old;
      }
      old.ids = [...new Set([...old.ids, id])]; old.active = { id, createdAt: now, paperHash: hash(JSON.stringify(paper)) }; return old;
    });
    const active = index.active, folder = attemptDirectory(uid, active.id);
    if (active.paperHash && active.paperHash !== hash(JSON.stringify(paper)) && !await readVersion(path.join(folder, 'state'))) throw fail('The pending saved paper is unavailable. Your attempt has not been replaced.', 503);
    await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    const paperFile = path.join(folder, 'paper.json'), temporary = paperFile + '.' + randomUUID() + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(paper), { flag: 'wx', mode: 0o600 });
    try { await fs.link(temporary, paperFile); } catch (error) { if (error.code !== 'EEXIST') throw error; } finally { await fs.rm(temporary, { force: true }); }
    await claimVersion(path.join(folder, 'state'), 1, makeState(active.id, active.createdAt));
    return get(uid, active.id);
  }
  async function list(uid) {
    await initialise();
    if (pool) return (await pool.query('SELECT state FROM full_mock_attempts WHERE username=$1 ORDER BY updated_at DESC LIMIT 100', [uid])).rows.map(row => row.state);
    const index = await readVersion(path.join(ownerDirectory(uid), 'index')); if (!index) return [];
    const values = await Promise.all(index.value.ids.slice(-100).map(id => readVersion(path.join(attemptDirectory(uid, id), 'state'))));
    return values.filter(Boolean).map(row => row.value).sort((a, b) => b.createdAt - a.createdAt);
  }
  async function active(at = Date.now()) {
    await initialise();
    if (pool) return (await pool.query("SELECT username,state->>'id' AS id FROM full_mock_attempts WHERE state->>'status'='active' AND (state->'current'->>'endsAt')::numeric<=$1 ORDER BY updated_at LIMIT 500", [at])).rows.map(row => ({ uid: row.username, id: row.id }));
    const rows = [];
    for (const dir of await fs.readdir(directory, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const index = await readVersion(path.join(directory, dir.name, 'index'));
      if (index?.value.active) {
        const current = await readVersion(path.join(directory, dir.name, index.value.active.id, 'state'));
        if (current?.value.status === 'active' && current.value.current.endsAt <= at) rows.push({ uid: index.value.owner, id: index.value.active.id });
      }
    }
    return rows.slice(0, 500);
  }
  async function putChunk(uid, id, segment, sequence, mime, bytes) {
    if (!uuid(segment) || !Number.isInteger(sequence) || sequence < 0 || sequence > 255) throw fail('Invalid recording chunk.', 400);
    if (!await get(uid, id)) throw fail('Attempt not found.', 404);
    const sha256 = hash(bytes);
    if (pool) {
      await pool.query('INSERT INTO full_mock_audio_chunks(attempt_id,segment_id,sequence,sha256,mime,payload) SELECT id,$3,$4,$5,$6,$7 FROM full_mock_attempts WHERE id=$1 AND username=$2 ON CONFLICT DO NOTHING', [id, uid, segment, sequence, sha256, mime, bytes]);
      const row = (await pool.query('SELECT c.sha256,c.mime FROM full_mock_audio_chunks c JOIN full_mock_attempts a ON a.id=c.attempt_id WHERE a.id=$1 AND a.username=$2 AND c.segment_id=$3 AND c.sequence=$4', [id, uid, segment, sequence])).rows[0];
      if (!row || row.sha256 !== sha256 || row.mime !== mime) throw fail('A saved recording chunk cannot be replaced.');
    } else {
      const folder = path.join(attemptDirectory(uid, id), 'audio', segment); await fs.mkdir(folder, { recursive: true, mode: 0o700 });
      const file = path.join(folder, sequence + '.json'), temporary = file + '.' + randomUUID() + '.tmp';
      const value = { sha256, mime, data: bytes.toString('base64') }; await fs.writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
      try { await fs.link(temporary, file); } catch (error) { if (error.code !== 'EEXIST') throw error; } finally { await fs.rm(temporary, { force: true }); }
      const saved = JSON.parse(await fs.readFile(file, 'utf8')); if (saved.sha256 !== sha256 || saved.mime !== mime) throw fail('A saved recording chunk cannot be replaced.');
    }
    return { sha256, bytes: bytes.length };
  }
  async function getChunk(uid, id, segment, sequence) {
    await initialise(); attemptDirectory(uid, id);
    if (!uuid(segment) || !Number.isInteger(sequence) || sequence < 0 || sequence > 255) throw fail('Invalid recording chunk.', 400);
    if (pool) {
      const row = (await pool.query('SELECT c.sha256,c.mime,c.payload FROM full_mock_audio_chunks c JOIN full_mock_attempts a ON a.id=c.attempt_id WHERE a.id=$1 AND a.username=$2 AND c.segment_id=$3 AND c.sequence=$4', [id, uid, segment, sequence])).rows[0];
      return row ? { sha256: row.sha256, mime: row.mime, bytes: row.payload } : null;
    }
    try { const row = JSON.parse(await fs.readFile(path.join(attemptDirectory(uid, id), 'audio', segment, sequence + '.json'), 'utf8')); return { sha256: row.sha256, mime: row.mime, bytes: Buffer.from(row.data, 'base64') }; }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function assessmentQueue() {
    await initialise();
    if (pool) return (await pool.query(`SELECT username,state->>'id' AS id,state->'assessment'->>'status' AS status
      FROM full_mock_attempts WHERE state->>'status'='submitted' AND (
        state->'assessment'->>'status'='processing' OR (
          state->'assessment'->>'status'='needs-attention' AND EXISTS (
            SELECT 1 FROM jsonb_each(state->'assessment'->'items') AS job
            WHERE job.value->>'status'='pending' AND job.value->>'reason'='late-recording')))
      ORDER BY (state->'assessment'->>'status'='processing') DESC,updated_at LIMIT 100`)).rows.map(row => ({ uid:row.username, id:row.id, status:row.status }));
    const rows = [];
    for (const dir of await fs.readdir(directory, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const index = await readVersion(path.join(directory, dir.name, 'index'));
      if (!index) continue;
      for (const id of index.value.ids.slice(-100)) {
        const saved = await readVersion(path.join(directory, dir.name, id, 'state'));
        const assessment = saved?.value.assessment;
        if (saved?.value.status === 'submitted' && (assessment?.status === 'processing' || assessment?.status === 'needs-attention' && Object.values(assessment.items || {}).some(job => job.status === 'pending' && job.reason === 'late-recording'))) rows.push({ uid: index.value.owner, id, status:assessment.status });
      }
    }
    return rows.slice(0, 100);
  }
  return { initialise, create, get, update, list, active, putChunk, getChunk, assessmentQueue };
}
module.exports = { createStore, casFile, readVersion, hash, uuid, fail };
