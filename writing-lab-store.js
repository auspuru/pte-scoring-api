'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
function createStore(pool, directory, { table = 'writing_lab_attempts' } = {}) {
  if (!['writing_lab_attempts','speaking_lab_attempts'].includes(table)) throw Error('Invalid attempt table.');
  const namespace = table === 'writing_lab_attempts' ? 'writing-lab' : 'speaking-lab';
  const indexName = table === 'writing_lab_attempts' ? 'writing_lab_user_idx' : 'speaking_lab_user_idx';
  let ready;
  const locks = new Map();
  async function initialise() {
    if (!ready) ready = (async () => {
      if (pool) await pool.query(`CREATE TABLE IF NOT EXISTS ${table} (
        id UUID PRIMARY KEY, username TEXT NOT NULL REFERENCES accounts(username) ON DELETE CASCADE,
        data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW());
        CREATE INDEX IF NOT EXISTS ${indexName} ON ${table}(username, updated_at DESC)`);
      else await fs.mkdir(directory, { recursive: true });
    })().catch(e => { ready = null; throw e; });
    return ready;
  }
  const folder = uid => path.join(directory, createHash('sha256').update(uid).digest('hex'));
  async function update(uid, id, fn) {
    await initialise();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw Object.assign(Error('Invalid attempt.'), { status: 400 });
    if (pool) {
      const perfStart = Date.now(), perf = {};
      const connectAt = Date.now();
      const client = await pool.connect();
      perf.connectMs = Date.now() - connectAt;
      try {
        let phase = Date.now();
        await client.query('BEGIN');
        perf.beginMs = Date.now() - phase;

        phase = Date.now();
        let { rows } = await client.query(`SELECT username, data FROM ${table} WHERE id=$1 FOR UPDATE`, [id]);
        perf.rowLockMs = Date.now() - phase;
        perf.created = !rows.length;
        if (!rows.length) {
          // Existing attempts are already serialized by FOR UPDATE. The advisory
          // lock is only needed for the creation race, where no row exists yet.
          phase = Date.now();
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [namespace + ':' + id]);
          perf.advisoryMs = Date.now() - phase;
          phase = Date.now();
          ({ rows } = await client.query(`SELECT username, data FROM ${table} WHERE id=$1 FOR UPDATE`, [id]));
          perf.recheckMs = Date.now() - phase;
        }
        if (rows.length && rows[0].username !== uid) throw Object.assign(Error('Attempt not found.'), { status: 404 });

        phase = Date.now();
        const value = await fn(rows[0]?.data || null);
        perf.transformMs = Date.now() - phase;
        if (value) {
          phase = Date.now();
          await client.query(`INSERT INTO ${table}(id,username,data) VALUES($1,$2,$3)
            ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data, updated_at=NOW()`, [id,uid,JSON.stringify(value)]);
          perf.writeMs = Date.now() - phase;
        }
        phase = Date.now();
        await client.query('COMMIT');
        perf.commitMs = Date.now() - phase;
        perf.totalMs = Date.now() - perfStart;
        if (perf.totalMs >= 300) console.info('[attempt-store-perf]', JSON.stringify({ namespace, ...perf }));
        return value;
      } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
      finally { client.release(); }
    }
    const key = uid + ':' + id, previous = locks.get(key) || Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      const dir = folder(uid), file = path.join(dir, id + '.json');
      let existing = null;
      try { existing = JSON.parse(await fs.readFile(file,'utf8')); } catch(e) { if (e.code !== 'ENOENT') throw e; }
      const value = await fn(existing);
      if (value) {
        await fs.mkdir(dir, { recursive: true });
        const tmp = file + '.' + randomUUID() + '.tmp';
        await fs.writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
        await fs.rename(tmp, file);
      }
      return value;
    });
    locks.set(key, task);
    try { return await task; } finally { if (locks.get(key) === task) locks.delete(key); }
  }
  async function list(uid) {
    await initialise();
    if (pool) return (await pool.query(`SELECT ${table === 'speaking_lab_attempts' ? "data - 'recording'" : 'data'} AS data FROM ${table} WHERE username=$1 ORDER BY updated_at DESC LIMIT ${table === 'speaking_lab_attempts' ? 50 : 250}`, [uid])).rows.map(r => r.data);
    const dir = folder(uid), limit = table === 'speaking_lab_attempts' ? 50 : 250;
    let files;
    try { files = await fs.readdir(dir); } catch(e) { if(e.code === 'ENOENT') return []; throw e; }
    // Match the PostgreSQL path's "most recently updated" semantics without
    // reading every JSON payload into memory. Stat metadata is cheap; only the
    // newest bounded set is parsed.
    const metadata = (await Promise.all(files.filter(f => f.endsWith('.json')).map(async file => {
      try {
        const stat = await fs.stat(path.join(dir, file));
        return { file, mtimeMs: stat.mtimeMs };
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    }))).filter(Boolean).sort((a,b) => b.mtimeMs-a.mtimeMs).slice(0,limit);
    const entries = await Promise.all(metadata.map(async ({ file }) => {
      try { return JSON.parse(await fs.readFile(path.join(dir,file),'utf8')); }
      catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    }));
    return entries.filter(Boolean);
  }
  return { update, list };
}
module.exports = { createStore };
