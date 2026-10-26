'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
function createStore(pool, directory, { table = 'writing_lab_attempts' } = {}) {
  if (!['writing_lab_attempts','speaking_lab_attempts','speaking_mock_attempts'].includes(table)) throw Error('Invalid attempt table.');
  const namespace = table === 'writing_lab_attempts' ? 'writing-lab' : table==='speaking_mock_attempts'?'speaking-mock':'speaking-lab';
  const indexName = table === 'writing_lab_attempts' ? 'writing_lab_user_idx' : table==='speaking_mock_attempts'?'speaking_mock_user_idx':'speaking_lab_user_idx';
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
  const mockResultsProjection = `jsonb_set(data, '{responses}', COALESCE((
        SELECT jsonb_agg(CASE WHEN response ? 'recording'
          THEN jsonb_set(response, '{recording}', (response->'recording') - 'data')
          ELSE response END ORDER BY position)
        FROM jsonb_array_elements(data->'responses') WITH ORDINALITY AS items(response, position)
      ), '[]'::jsonb))`;
  async function get(uid, id, { omitMockAudio = false } = {}) {
    await initialise();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw Object.assign(Error('Invalid attempt.'), { status: 400 });
    const projected = omitMockAudio && table === 'speaking_mock_attempts';
    if (pool) {
      // Result polling needs marks and recording metadata, not every base64 clip.
      // Project in PostgreSQL so the full audio never crosses the DB connection.
      const data = projected ? mockResultsProjection : 'data';
      return (await pool.query(`SELECT ${data} AS data FROM ${table} WHERE id=$1 AND username=$2`, [id, uid])).rows[0]?.data || null;
    }
    await locks.get(uid + ':' + id)?.catch(() => {});
    try {
      const value = JSON.parse(await fs.readFile(path.join(folder(uid), id + '.json'), 'utf8'));
      if (projected) for (const response of value.responses || []) if (response?.recording) delete response.recording.data;
      return value;
    } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
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
  async function list(uid, { omitMockAudio = false } = {}) {
    await initialise();
    const projected=omitMockAudio&&table==='speaking_mock_attempts';
    if (pool) return (await pool.query(`SELECT ${projected?mockResultsProjection:table === 'speaking_lab_attempts' ? "data - 'recording'" : table==='speaking_mock_attempts'?"data - 'responses' - 'questions'":'data'} AS data FROM ${table} WHERE username=$1 ORDER BY updated_at DESC LIMIT ${table.startsWith('speaking_') ? 50 : 250}`, [uid])).rows.map(r => r.data);
    const dir = folder(uid), limit = table.startsWith('speaking_') ? 50 : 250;
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
    const values=entries.filter(Boolean);
    if(projected)for(const value of values)for(const response of value.responses||[])if(response?.recording)delete response.recording.data;
    return values;
  }
  async function getResponse(uid,id,index){
    await initialise();if(!Number.isInteger(index)||index<0||index>100)throw Error('Invalid answer index.');
    if(!pool){const a=await get(uid,id);return a?{question:a.questions?.[index],response:a.responses?.[index],profile:a.assessmentProfile}:null;}
    const row=(await pool.query(`SELECT data->'questions'->($3::int) AS question,data->'responses'->($3::int) AS response,data->'assessmentProfile' AS profile FROM ${table} WHERE username=$1 AND id=$2`,[uid,id,index])).rows[0];return row||null;
  }
  // Cursor scanning prevents a slow/held attempt from starving later mocks.
  async function scanForScoring(cursor='',limit=20){
    await initialise();if(table!=='speaking_mock_attempts')return[];
    if(pool)return(await pool.query(`SELECT username,${mockResultsProjection} AS data FROM ${table} WHERE id::text>$1 AND data->>'status' IN ('active','submitted') AND COALESCE(data->'assessment'->>'status','')<>'ready' AND (data->'assessmentProfile'->>'mode'='progressive-v1' OR data->'grading'->>'status' IN ('pending','processing')) ORDER BY id LIMIT $2`,[cursor,limit])).rows;
    const values=[];for(const dir of await fs.readdir(directory,{withFileTypes:true})){if(!dir.isDirectory())continue;for(const f of await fs.readdir(path.join(directory,dir.name))){if(!f.endsWith('.json')||f.slice(0,-5)<=cursor)continue;const a=JSON.parse(await fs.readFile(path.join(directory,dir.name,f),'utf8'));if(a.assessmentProfile?.owner&&a.grading?.status!=='complete')values.push({username:a.assessmentProfile.owner,data:a});}}
    return values.sort((a,b)=>a.data.id.localeCompare(b.data.id)).slice(0,limit);
  }
  return { update, get, list, initialise, getResponse, scanForScoring };
}
module.exports = { createStore };
