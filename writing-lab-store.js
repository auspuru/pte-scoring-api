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
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [namespace + ':' + id]);
        const { rows } = await client.query(`SELECT username, data FROM ${table} WHERE id=$1 FOR UPDATE`, [id]);
        if (rows.length && rows[0].username !== uid) throw Object.assign(Error('Attempt not found.'), { status: 404 });
        const value = await fn(rows[0]?.data || null);
        if (value) await client.query(`INSERT INTO ${table}(id,username,data) VALUES($1,$2,$3)
          ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data, updated_at=NOW()`, [id,uid,JSON.stringify(value)]);
        await client.query('COMMIT');
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
    let files;
    try { files = await fs.readdir(folder(uid)); } catch(e) { if(e.code === 'ENOENT') return []; throw e; }
    const entries = await Promise.all(files.filter(f => f.endsWith('.json')).map(f => fs.readFile(path.join(folder(uid),f),'utf8').then(JSON.parse)));
    return entries.sort((a,b) => b.startedAt-a.startedAt).slice(0,table === 'speaking_lab_attempts' ? 50 : 250);
  }
  return { update, list };
}
module.exports = { createStore };
