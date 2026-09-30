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
      const perfStart = Date.now(), perf = { conflicts: 0 };
      const connectAt = Date.now();
      const client = await pool.connect();
      perf.connectMs = Date.now() - connectAt;
      try {
        const maxAttempts = 4;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          let phase = Date.now();
          const { rows } = await client.query(
            `SELECT username, data, xmin::text AS version FROM ${table} WHERE id=$1`,
            [id]
          );
          perf.readMs = (perf.readMs || 0) + (Date.now() - phase);

          if (!rows.length) {
            phase = Date.now();
            const value = await fn(null);
            perf.transformMs = (perf.transformMs || 0) + (Date.now() - phase);
            if (!value) return value;

            phase = Date.now();
            const created = await client.query(
              `INSERT INTO ${table}(id,username,data) VALUES($1,$2,$3)
               ON CONFLICT(id) DO NOTHING
               RETURNING xmin::text AS version`,
              [id, uid, JSON.stringify(value)]
            );
            perf.writeMs = (perf.writeMs || 0) + (Date.now() - phase);
            if (created.rows.length) {
              perf.created = true;
              perf.attempts = attempt + 1;
              perf.totalMs = Date.now() - perfStart;
              if (perf.totalMs >= 300) console.info('[attempt-store-perf]', JSON.stringify({ namespace, ...perf }));
              return value;
            }
            perf.conflicts++;
            continue;
          }

          if (rows[0].username !== uid) throw Object.assign(Error('Attempt not found.'), { status: 404 });
          const version = String(rows[0].version || '');
          const beforeJson = JSON.stringify(rows[0].data);

          phase = Date.now();
          const value = await fn(rows[0].data);
          perf.transformMs = (perf.transformMs || 0) + (Date.now() - phase);
          if (!value) return value;

          const nextJson = JSON.stringify(value);
          if (nextJson === beforeJson) {
            perf.attempts = attempt + 1;
            perf.totalMs = Date.now() - perfStart;
            if (perf.totalMs >= 300) console.info('[attempt-store-perf]', JSON.stringify({ namespace, ...perf }));
            return value;
          }

          phase = Date.now();
          const updated = await client.query(
            `UPDATE ${table}
               SET data=$3, updated_at=NOW()
               WHERE id=$1 AND username=$2 AND xmin::text=$4
               RETURNING xmin::text AS version`,
            [id, uid, nextJson, version]
          );
          perf.writeMs = (perf.writeMs || 0) + (Date.now() - phase);
          if (updated.rows.length) {
            perf.attempts = attempt + 1;
            perf.totalMs = Date.now() - perfStart;
            if (perf.totalMs >= 300) console.info('[attempt-store-perf]', JSON.stringify({ namespace, ...perf }));
            return value;
          }
          perf.conflicts++;
        }
        throw Object.assign(Error('Attempt changed while saving. Please retry.'), { status: 503 });
      } finally {
        client.release();
      }
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
