const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const crypto = require('crypto');
const fsSync = require('fs');
const fs = require('fs').promises;
const path = require('path');

// v19.10: Optional Postgres support. The 'pg' module is loaded lazily so that
// installations without a database URL still work (local dev, JSON-file fallback).
//
// Connection URL precedence (v19.10.1):
//   1. PGURL              — explicit override, wins over everything
//   2. DATABASE_PUBLIC_URL — Railway's public proxy host (*.proxy.rlwy.net),
//                            reachable from anywhere. Preferred because the
//                            private host (postgres.railway.internal) only
//                            resolves when Railway private networking is fully
//                            active, which is not guaranteed on every project.
//   3. DATABASE_URL       — Railway's default (often the private internal host)
//
// Whichever is chosen, the JSON-file StorageAPI is replaced with the Postgres
// adapter. With none of them set, the server falls back to the JSON file.
let Pool = null;
try { Pool = require('pg').Pool; } catch (_) { /* pg not installed — JSON fallback only */ }
const DATABASE_URL =
      process.env.PGURL
   || process.env.DATABASE_PUBLIC_URL
   || process.env.DATABASE_URL
   || '';
// Record which env var won, for the boot log + /api/health diagnostic.
const DATABASE_URL_SOURCE =
      process.env.PGURL ? 'PGURL'
    : process.env.DATABASE_PUBLIC_URL ? 'DATABASE_PUBLIC_URL'
    : process.env.DATABASE_URL ? 'DATABASE_URL'
    : 'none';
const USE_POSTGRES = !!(DATABASE_URL && Pool);

const app = express();
const PORT = process.env.PORT || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// ─── SERVE STATIC FILES (Railway deployment) ─────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));

let anthropic = null;
if (ANTHROPIC_API_KEY && ANTHROPIC_API_KEY.startsWith('sk-ant-')) {
  anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
}

// ─── STORAGE ─────────────────────────────────────────────────────────────────
// Data storage: Railway volume > local ./data > /tmp fallback
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || (process.env.NODE_ENV === 'production' ? '/app/data' : './data');
const STORAGE_FILE = path.join(DATA_DIR, 'pte_data.json');
const PASSAGES_FILE = path.join(DATA_DIR, 'pte_passages.json');
// Default passages bundled with the build — used as seed/fallback if the volume
// has no pte_passages.json yet (fresh deploy, dev, etc.). The file in the volume
// always wins after first write so admin edits persist across restarts.
const DEFAULT_PASSAGES_FILE = path.join(__dirname, 'passages.json');

async function ensureDataDir() {
  try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch (e) { /* ok */ }
}

// ─── DIAGNOSTIC: BOOT SNAPSHOT ──────────────────────────────────────────────
// v19.9: Capture a snapshot of the storage file at process start so /api/health
// can later compare boot state to current state. If the snapshot is empty but
// the volume is supposedly persistent, OR if the snapshot doesn't match what's
// in the volume on a known-stable file, the volume isn't being mounted right.
//
// We record: instance ID (random per process), boot time, the storage path,
// whether the volume env var was set, whether the file existed at boot,
// its size, mtime, and user count.
const INSTANCE_ID = Math.random().toString(36).slice(2, 10);
const BOOT_TIME = new Date().toISOString();
let BOOT_SNAPSHOT = null;
async function captureBootSnapshot() {
  const snap = {
    instance_id: INSTANCE_ID,
    boot_time: BOOT_TIME,
    storage_path: STORAGE_FILE,
    data_dir: DATA_DIR,
    using_railway_volume_env: !!process.env.RAILWAY_VOLUME_MOUNT_PATH,
    railway_volume_env_value: process.env.RAILWAY_VOLUME_MOUNT_PATH || null,
    node_env: process.env.NODE_ENV || null,
    // The "fallback" path used when no volume env var is set. If the active
    // DATA_DIR equals the fallback, you're writing to ephemeral disk.
    fallback_path_if_no_volume: process.env.NODE_ENV === 'production' ? '/app/data' : './data',
    // Probe the file's existence and metadata at boot.
    file_existed_at_boot: false,
    file_size_at_boot: 0,
    file_mtime_at_boot: null,
    user_count_at_boot: 0,
  };
  try {
    const stat = await fs.stat(STORAGE_FILE);
    snap.file_existed_at_boot = true;
    snap.file_size_at_boot = stat.size;
    snap.file_mtime_at_boot = stat.mtime.toISOString();
    try {
      const parsed = JSON.parse(await fs.readFile(STORAGE_FILE, 'utf8'));
      snap.user_count_at_boot = Object.keys(parsed.users || {}).length;
    } catch (_) { /* corrupt file? leave user_count = 0 */ }
  } catch (_) {
    // File doesn't exist — that's the smoking gun if the volume should have it.
  }
  BOOT_SNAPSHOT = snap;
}

// ─── DIAGNOSTIC: WRITE PROBE ────────────────────────────────────────────────
// Tests whether we can write to the data dir AND whether the write persists
// across the probe call. Useful for distinguishing "can write at all" from
// "writes survive container restart".
async function writeProbe() {
  await ensureDataDir();
  const probePath = path.join(DATA_DIR, '.write-probe.json');
  const now = new Date().toISOString();
  const result = { can_write: false, can_read_back: false, written_at: null, read_value: null, error: null };
  try {
    await fs.writeFile(probePath, JSON.stringify({ ts: now, instance: INSTANCE_ID }));
    result.can_write = true;
    result.written_at = now;
    try {
      const back = JSON.parse(await fs.readFile(probePath, 'utf8'));
      result.can_read_back = true;
      result.read_value = back;
    } catch (e) { result.error = 'readback_failed: ' + e.message; }
    // Leave the probe file in place — its mtime on the next deploy tells you
    // whether the volume actually persisted across deploys.
  } catch (e) {
    result.error = 'write_failed: ' + e.message;
  }
  return result;
}

// ─── ATOMIC FILE WRITE ──────────────────────────────────────────────────────
// Writes via temp + rename so a crash mid-write can never corrupt the target.
// Also keeps a .bak copy of the previous version. Used by every persistent
// store so admin edits and student progress are safe across restarts.
async function safeWriteJSON(filePath, data) {
  await ensureDataDir();
  const json = JSON.stringify(data, null, 2);
  const tmp  = filePath + '.tmp';
  const bak  = filePath + '.bak';
  await fs.writeFile(tmp, json);
  // Best-effort backup of the existing file before overwriting it.
  try {
    const existing = await fs.readFile(filePath);
    await fs.writeFile(bak, existing);
  } catch (_) { /* no prior file — fine */ }
  await fs.rename(tmp, filePath);
}

// ─── POSTGRES POOL & ADAPTER (v19.10) ───────────────────────────────────────
// When DATABASE_URL is present, this replaces the JSON-file StorageAPI with
// a Postgres-backed implementation that has the same method signatures. The
// route handlers below remain unchanged.
//
// Schema (auto-created on first boot):
//   accounts(username PK, password_hash, secret_q, secret_a_hash,
//            created_at, last_login, blocked, role)
//   user_data(username PK, data JSONB)         -- attempted/summaries/scores/history/stats
//   passages(id INT PK, payload JSONB)
//   global_stats(id INT PK = 1, total_attempts BIGINT)
//
// The "data" JSONB column keeps the same shape the JSON file used, so the
// API surface (getUserData, setUserData, etc.) returns identical payloads.
let pgPool = null;
if (USE_POSTGRES) {
  // SSL decision. Railway's Postgres needs SSL on every connection path —
  // internal (*.railway.internal), public proxy (*.proxy.rlwy.net), and the
  // older *.railway.app hosts. Rather than enumerate hostnames (the previous
  // bug — the list was incomplete), default to SSL-ON for any host that isn't
  // local, and let PGSSL=disable explicitly turn it off for local Postgres.
  //   - PGSSL=disable           -> no SSL (use for local dev Postgres)
  //   - PGSSL=require (or unset) -> SSL with rejectUnauthorized:false
  // A localhost / unix-socket / 127.0.0.1 connection string also defaults to
  // no SSL since local Postgres typically isn't configured for it.
  const isLocalDb = /(\blocalhost\b|127\.0\.0\.1|@\/|host=\/)/.test(DATABASE_URL);
  const sslDisabled = process.env.PGSSL === 'disable' || (isLocalDb && process.env.PGSSL !== 'require');
  pgPool = new Pool({
    connectionString: DATABASE_URL,
    ssl: sslDisabled ? false : { rejectUnauthorized: false },
    max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000,
  });
  pgPool.on('error', (err) => { console.error('Postgres pool error:', err.message); });
  console.log(`🐘 Postgres pool created — SSL ${sslDisabled ? 'disabled (local)' : 'enabled'}, URL from ${DATABASE_URL_SOURCE}`);
}

async function pgInitSchema() {
  if (!pgPool) return;
  const ddl = `
    CREATE TABLE IF NOT EXISTS accounts (
      username       TEXT PRIMARY KEY,
      password_hash  TEXT NOT NULL,
      secret_q       TEXT DEFAULT '',
      secret_a_hash  TEXT DEFAULT '',
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      last_login     TIMESTAMPTZ,
      blocked        BOOLEAN DEFAULT FALSE,
      role           TEXT DEFAULT 'user'
    );
    CREATE TABLE IF NOT EXISTS user_data (
      username       TEXT PRIMARY KEY,
      data           JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at     TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS passages (
      id             INTEGER PRIMARY KEY,
      payload        JSONB NOT NULL,
      updated_at     TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS global_stats (
      id             INTEGER PRIMARY KEY DEFAULT 1,
      total_attempts BIGINT DEFAULT 0,
      CONSTRAINT global_stats_singleton CHECK (id = 1)
    );
    INSERT INTO global_stats (id, total_attempts) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
  `;
  await pgPool.query(ddl);
}

// v19.11.1: passages first-boot seed. If the Postgres passages table is EMPTY,
// seed it from the bundled passages.json so a fresh deployment isn't passage-
// less. If the table already has rows, never touch it — the admin's edits are
// the source of truth from that point on.
//
// This function is the safety counterpart to the previous data loss: as long
// as a deploy keeps Postgres connected, this will not overwrite the admin's
// passages, ever. The only time it writes is the very first time the table is
// empty after this code lands.
async function pgSeedPassagesIfEmpty() {
  if (!pgPool) return { seeded: false, reason: 'no_pg_pool' };
  const { rows } = await pgPool.query('SELECT COUNT(*)::int AS n FROM passages');
  if (rows[0].n > 0) {
    return { seeded: false, reason: 'passages_already_populated', existing: rows[0].n };
  }
  // Empty table — seed from the bundled file.
  let raw;
  try { raw = await fs.readFile(DEFAULT_PASSAGES_FILE, 'utf8'); }
  catch (e) { return { seeded: false, reason: 'bundled_file_not_found' }; }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { return { seeded: false, reason: 'bundled_json_parse_failed' }; }
  if (!Array.isArray(parsed) || !parsed.length) {
    return { seeded: false, reason: 'bundled_file_empty' };
  }
  // Use the same insert path the runtime uses. Transactional — all or nothing.
  const client = await pgPool.connect();
  let count = 0;
  try {
    await client.query('BEGIN');
    for (const p of parsed) {
      const cleaned = sanitizePassage(p);
      if (!cleaned.id) continue;
      await client.query(
        'INSERT INTO passages (id, payload, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO NOTHING',
        [cleaned.id, cleaned]
      );
      count++;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    return { seeded: false, reason: 'insert_failed', error: e.message };
  } finally {
    client.release();
  }
  return { seeded: true, count };
}

// One-time JSON → Postgres migration. Runs at boot if the volume still has a
// pte_data.json AND the accounts table is empty. Idempotent and safe to re-run
// — it skips any row whose primary key already exists.
async function pgMigrateFromJsonIfNeeded() {
  if (!pgPool) return { migrated: false, reason: 'no_pg_pool' };
  const { rows: countRow } = await pgPool.query('SELECT COUNT(*)::int AS n FROM accounts');
  if (countRow[0].n > 0) return { migrated: false, reason: 'accounts_already_populated', existing_accounts: countRow[0].n };
  let raw;
  try { raw = await fs.readFile(STORAGE_FILE, 'utf8'); }
  catch { return { migrated: false, reason: 'no_json_file_to_migrate' }; }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { return { migrated: false, reason: 'json_parse_failed' }; }

  const accounts = parsed.accounts || {};
  const users = parsed.users || {};
  let importedAccounts = 0, importedUserData = 0;
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    for (const [uid, acct] of Object.entries(accounts)) {
      await client.query(
        `INSERT INTO accounts (username, password_hash, secret_q, secret_a_hash, created_at, last_login, blocked, role)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (username) DO NOTHING`,
        [uid, acct.passwordHash || '', acct.secretQ || '', acct.secretAHash || '',
         acct.createdAt || new Date().toISOString(), acct.lastLogin || null,
         !!acct.blocked, acct.role || 'user']
      );
      importedAccounts++;
    }
    for (const [uid, u] of Object.entries(users)) {
      await client.query(
        `INSERT INTO user_data (username, data) VALUES ($1, $2::jsonb) ON CONFLICT (username) DO NOTHING`,
        [uid, JSON.stringify({
          attempted: u.attempted || [], summaries: u.summaries || {},
          scores: u.scores || {}, history: u.history || {},
          stats: u.stats || { totalAttempts: 0, averageScore: 0 }
        })]
      );
      importedUserData++;
    }
    if (parsed.global?.totalAttempts) {
      await client.query(
        `UPDATE global_stats SET total_attempts = $1 WHERE id = 1`,
        [parsed.global.totalAttempts]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return { migrated: true, accounts: importedAccounts, user_data: importedUserData };
}

// ─── POSTGRES STORAGE ADAPTER ───────────────────────────────────────────────
// Same method names as JsonStorage below, but reads/writes through pgPool.
// All methods are async and use parameterised queries (no SQL injection risk).
const PgStorage = {
  async _allAccounts() {
    const { rows } = await pgPool.query('SELECT * FROM accounts');
    const out = {};
    for (const r of rows) {
      out[r.username] = {
        username: r.username, passwordHash: r.password_hash,
        secretQ: r.secret_q, secretAHash: r.secret_a_hash,
        createdAt: r.created_at ? r.created_at.toISOString() : null,
        lastLogin: r.last_login ? r.last_login.toISOString() : null,
        blocked: r.blocked, role: r.role || 'user'
      };
    }
    return out;
  },
  async _allUserData() {
    const { rows } = await pgPool.query('SELECT * FROM user_data');
    const out = {};
    for (const r of rows) out[r.username] = r.data || {};
    return out;
  },
  async _getAccount(uid) {
    const { rows } = await pgPool.query('SELECT * FROM accounts WHERE username = $1', [uid]);
    if (!rows.length) return null;
    const r = rows[0];
    return {
      username: r.username, passwordHash: r.password_hash,
      secretQ: r.secret_q, secretAHash: r.secret_a_hash,
      createdAt: r.created_at ? r.created_at.toISOString() : null,
      lastLogin: r.last_login ? r.last_login.toISOString() : null,
      blocked: r.blocked, role: r.role || 'user'
    };
  },
  async _saveAccount(acct) {
    await pgPool.query(
      `INSERT INTO accounts (username, password_hash, secret_q, secret_a_hash, created_at, last_login, blocked, role)
       VALUES ($1,$2,$3,$4,COALESCE($5::timestamptz, NOW()),$6::timestamptz,$7,$8)
       ON CONFLICT (username) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         secret_q = EXCLUDED.secret_q,
         secret_a_hash = EXCLUDED.secret_a_hash,
         last_login = EXCLUDED.last_login,
         blocked = EXCLUDED.blocked,
         role = EXCLUDED.role`,
      [acct.username, acct.passwordHash, acct.secretQ || '', acct.secretAHash || '',
       acct.createdAt || null, acct.lastLogin || null, !!acct.blocked, acct.role || 'user']
    );
  },
  async _deleteAccount(uid) {
    await pgPool.query('DELETE FROM accounts WHERE username = $1', [uid]);
    await pgPool.query('DELETE FROM user_data WHERE username = $1', [uid]);
  },

  // ── readData / writeData — emulate the JSON shape for any code that still
  //    uses the old whole-blob interface. AuthAPI uses this pattern, so we
  //    keep it working for backwards compatibility.
  async readData() {
    const [accounts, users, globalStats] = await Promise.all([
      this._allAccounts(),
      this._allUserData(),
      pgPool.query('SELECT total_attempts FROM global_stats WHERE id = 1')
    ]);
    return {
      accounts, users,
      global: { totalAttempts: Number(globalStats.rows[0]?.total_attempts || 0) }
    };
  },
  // writeData is the "everything" write path. We split it into per-row updates
  // inside a transaction so a partial write doesn't corrupt the store.
  async writeData(data) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      for (const [uid, acct] of Object.entries(data.accounts || {})) {
        await client.query(
          `INSERT INTO accounts (username, password_hash, secret_q, secret_a_hash, created_at, last_login, blocked, role)
           VALUES ($1,$2,$3,$4,COALESCE($5::timestamptz, NOW()),$6::timestamptz,$7,$8)
           ON CONFLICT (username) DO UPDATE SET
             password_hash = EXCLUDED.password_hash, secret_q = EXCLUDED.secret_q,
             secret_a_hash = EXCLUDED.secret_a_hash, last_login = EXCLUDED.last_login,
             blocked = EXCLUDED.blocked, role = EXCLUDED.role`,
          [uid, acct.passwordHash || '', acct.secretQ || '', acct.secretAHash || '',
           acct.createdAt || null, acct.lastLogin || null, !!acct.blocked, acct.role || 'user']
        );
      }
      for (const [uid, u] of Object.entries(data.users || {})) {
        await client.query(
          `INSERT INTO user_data (username, data, updated_at) VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (username) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
          [uid, JSON.stringify(u)]
        );
      }
      if (data.global?.totalAttempts != null) {
        await client.query(
          `INSERT INTO global_stats (id, total_attempts) VALUES (1, $1)
           ON CONFLICT (id) DO UPDATE SET total_attempts = EXCLUDED.total_attempts`,
          [data.global.totalAttempts]
        );
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  },

  async saveProgress(userId, passageId, summary, scoreData) {
    const data = await this.readData();
    if (!data.users[userId]) data.users[userId] = { attempted: [], summaries: {}, scores: {}, history: {}, stats: { totalAttempts: 0, averageScore: 0 } };
    const u = data.users[userId];
    if (!u.attempted) u.attempted = [];
    if (!u.attempted.includes(passageId)) u.attempted.push(passageId);
    if (!u.summaries) u.summaries = {};
    u.summaries[passageId] = { text: summary, timestamp: new Date().toISOString(), score: scoreData?.overall_score || 0 };
    if (!u.scores) u.scores = {};
    u.scores[passageId] = scoreData;
    if (!u.history) u.history = {};
    if (!u.history[passageId]) u.history[passageId] = [];
    u.history[passageId].unshift({
      text: summary, timestamp: new Date().toISOString(),
      overall_score: scoreData?.overall_score || 0, band: scoreData?.band || 'Band 5',
      trait_scores: scoreData?.trait_scores || {}, word_count: scoreData?.word_count || 0,
      feedback: scoreData?.feedback || '', content_details: scoreData?.content_details || {},
      skill_contributions: scoreData?.skill_contributions || null,
      scoring_version: scoreData?.scoring_version || 'unknown'
    });
    if (u.history[passageId].length > 10) u.history[passageId] = u.history[passageId].slice(0, 10);
    let total = 0, count = 0;
    Object.values(u.history).forEach(arr => { if (Array.isArray(arr)) arr.forEach(a => { total += (a.overall_score || 0); count++; }); });
    u.stats = { totalAttempts: count, averageScore: count > 0 ? Math.round(total / count) : 0 };
    // Persist this single user's data + bump global stats — focused write, not whole-blob.
    await pgPool.query(
      `INSERT INTO user_data (username, data, updated_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (username) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [userId, JSON.stringify(u)]
    );
    await pgPool.query(`UPDATE global_stats SET total_attempts = total_attempts + 1 WHERE id = 1`);
    return { success: true, userStats: u.stats };
  },
  async getUserData(userId) {
    const { rows } = await pgPool.query('SELECT data FROM user_data WHERE username = $1', [userId]);
    if (!rows.length) return { attempted: [], summaries: {}, scores: {}, history: {}, stats: { totalAttempts: 0, averageScore: 0 } };
    const u = rows[0].data || {};
    return { attempted: u.attempted || [], summaries: u.summaries || {}, scores: u.scores || {}, history: u.history || {}, stats: u.stats || {} };
  },
  async setUserData(userId, userData) {
    // Replicate the merge logic from JsonStorage exactly so behavior is identical.
    const { rows } = await pgPool.query('SELECT data FROM user_data WHERE username = $1', [userId]);
    const existing = rows[0]?.data || {};
    const clientHistory = userData.history || {};
    const serverHistory = existing.history || {};
    const mergedHistory = {};
    const allPassageIds = new Set([...Object.keys(clientHistory), ...Object.keys(serverHistory)]);
    for (const pid of allPassageIds) {
      const all = [...(clientHistory[pid] || []), ...(serverHistory[pid] || [])];
      const seen = new Set();
      const merged = all.filter(a => { const key = a.timestamp + '|' + (a.text || '').substring(0, 50); if (seen.has(key)) return false; seen.add(key); return true; });
      merged.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      mergedHistory[pid] = merged.slice(0, 10);
    }
    const u = {
      attempted: [...new Set([...(existing.attempted || []), ...(userData.attempted || [])])],
      summaries: { ...(existing.summaries || {}), ...(userData.summaries || {}) },
      scores: { ...(existing.scores || {}), ...(userData.scores || {}) },
      history: mergedHistory
    };
    let total = 0, count = 0;
    Object.values(u.history).forEach(arr => { if (Array.isArray(arr)) arr.forEach(a => { total += (a.overall_score || 0); count++; }); });
    u.stats = { totalAttempts: count, averageScore: count > 0 ? Math.round(total / count) : 0 };
    await pgPool.query(
      `INSERT INTO user_data (username, data, updated_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (username) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [userId, JSON.stringify(u)]
    );
    return { success: true, stats: u.stats, passageCount: u.attempted.length, attemptCount: count };
  },
  async getProgress(userId) { return this.getUserData(userId); },
  async getLeaderboard(limit = 10) {
    const { rows } = await pgPool.query(
      `SELECT username, (data->'stats'->>'averageScore')::int AS avg_score,
              (data->'stats'->>'totalAttempts')::int AS total
       FROM user_data
       ORDER BY (data->'stats'->>'averageScore')::int DESC NULLS LAST
       LIMIT $1`, [limit]
    );
    return rows.map(r => ({ userId: r.username, averageScore: r.avg_score || 0, totalAttempts: r.total || 0 }));
  }
};

const JsonStorage = {
  async readData() {
    try { return JSON.parse(await fs.readFile(STORAGE_FILE, 'utf8')); }
    catch { return { users: {}, global: { totalAttempts: 0 } }; }
  },
  async writeData(data) { await safeWriteJSON(STORAGE_FILE, data); },
  
  // Save individual attempt (called after each verify)
  async saveProgress(userId, passageId, summary, scoreData) {
    const data = await this.readData();
    if (!data.users[userId]) data.users[userId] = { attempted: [], summaries: {}, scores: {}, history: {}, stats: { totalAttempts: 0, averageScore: 0 } };
    const u = data.users[userId];
    
    // Update attempted
    if (!u.attempted) u.attempted = [];
    if (!u.attempted.includes(passageId)) u.attempted.push(passageId);
    
    // Update summaries (latest only)
    if (!u.summaries) u.summaries = {};
    u.summaries[passageId] = { text: summary, timestamp: new Date().toISOString(), score: scoreData?.overall_score || 0 };
    
    // Update scores
    if (!u.scores) u.scores = {};
    u.scores[passageId] = scoreData;
    
    // Update history (newest first, max 10 per passage)
    if (!u.history) u.history = {};
    if (!u.history[passageId]) u.history[passageId] = [];
    u.history[passageId].unshift({
      text: summary, timestamp: new Date().toISOString(),
      overall_score: scoreData?.overall_score || 0, band: scoreData?.band || 'Band 5',
      trait_scores: scoreData?.trait_scores || {}, word_count: scoreData?.word_count || 0,
      feedback: scoreData?.feedback || '', content_details: scoreData?.content_details || {},
      skill_contributions: scoreData?.skill_contributions || null,
      scoring_version: scoreData?.scoring_version || 'unknown'
    });
    if (u.history[passageId].length > 10) u.history[passageId] = u.history[passageId].slice(0, 10);
    
    // Update stats
    let total = 0, count = 0;
    Object.values(u.history).forEach(arr => { if (Array.isArray(arr)) arr.forEach(a => { total += (a.overall_score || 0); count++; }); });
    u.stats = { totalAttempts: count, averageScore: count > 0 ? Math.round(total / count) : 0 };
    
    data.global.totalAttempts++;
    await this.writeData(data);
    return { success: true, userStats: u.stats };
  },
  
  // Get full user data (for sync on login)
  async getUserData(userId) {
    const data = await this.readData();
    const u = data.users[userId];
    if (!u) return { attempted: [], summaries: {}, scores: {}, history: {}, stats: { totalAttempts: 0, averageScore: 0 } };
    return { attempted: u.attempted || [], summaries: u.summaries || {}, scores: u.scores || {}, history: u.history || {}, stats: u.stats || {} };
  },
  
  // Push full user data from client (for bulk sync)
  async setUserData(userId, userData) {
    const data = await this.readData();
    if (!data.users[userId]) data.users[userId] = {};
    const u = data.users[userId];
    
    // Merge: keep server data if newer, accept client data if newer
    const clientHistory = userData.history || {};
    const serverHistory = u.history || {};
    
    // Merge histories per passage — combine and deduplicate by timestamp
    const mergedHistory = {};
    const allPassageIds = new Set([...Object.keys(clientHistory), ...Object.keys(serverHistory)]);
    for (const pid of allPassageIds) {
      const clientAttempts = clientHistory[pid] || [];
      const serverAttempts = serverHistory[pid] || [];
      const all = [...clientAttempts, ...serverAttempts];
      // Deduplicate by timestamp
      const seen = new Set();
      const merged = all.filter(a => { const key = a.timestamp + '|' + (a.text || '').substring(0, 50); if (seen.has(key)) return false; seen.add(key); return true; });
      // Sort newest first, keep max 10
      merged.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      mergedHistory[pid] = merged.slice(0, 10);
    }
    
    // Use client's latest summaries (they're the most recent by definition)
    u.attempted = [...new Set([...(u.attempted || []), ...(userData.attempted || [])])];
    u.summaries = { ...(u.summaries || {}), ...(userData.summaries || {}) };
    u.scores = { ...(u.scores || {}), ...(userData.scores || {}) };
    u.history = mergedHistory;
    
    // Recalculate stats
    let total = 0, count = 0;
    Object.values(u.history).forEach(arr => { if (Array.isArray(arr)) arr.forEach(a => { total += (a.overall_score || 0); count++; }); });
    u.stats = { totalAttempts: count, averageScore: count > 0 ? Math.round(total / count) : 0 };
    
    await this.writeData(data);
    return { success: true, stats: u.stats, passageCount: u.attempted.length, attemptCount: count };
  },
  
  async getProgress(userId) { return this.getUserData(userId); },
  
  async getLeaderboard(limit = 10) {
    const data = await this.readData();
    return Object.entries(data.users)
      .map(([id, u]) => ({ userId: id, averageScore: (u.stats||{}).averageScore||0, totalAttempts: (u.stats||{}).totalAttempts||0 }))
      .sort((a, b) => b.averageScore - a.averageScore).slice(0, limit);
  }
};

// v19.10: Pick the active storage backend. Postgres when DATABASE_URL is set,
// JSON file otherwise. Every consumer (AuthAPI, route handlers) uses StorageAPI
// — they don't need to know which backend is active.
const StorageAPI = USE_POSTGRES ? PgStorage : JsonStorage;

// ═══════════════════════════════════════════════════════════════════════════════
// PASSAGE STORAGE — admin-editable, persisted to the Railway volume
// ═══════════════════════════════════════════════════════════════════════════════
// Passage storage. Two backends, same interface — selected at boot based on
// whether Postgres is available. ALL writes go to the chosen backend.
//
// v19.11.1 — CRITICAL FIX: until this version, PassageAPI was file-only. On
// Railway, the file lived on the container's ephemeral filesystem, which is
// wiped on every deploy. Users lost edits and any passages they added beyond
// the bundled defaults. This refactor moves passages to Postgres on Railway
// while keeping the file backend for local/dev use.
//
// The shared in-memory cache (`_cache` + `_cacheLoaded`) is kept on the selector
// so callers like the admin UI see fresh data immediately after a write.
const JsonPassageAPI = {
  _cache: null,
  _cacheLoaded: false,

  async _loadFromDisk() {
    // Try the volume file first
    try {
      const txt = await fs.readFile(PASSAGES_FILE, 'utf8');
      const arr = JSON.parse(txt);
      if (Array.isArray(arr)) return arr;
    } catch (_) { /* fall through */ }
    // Seed from bundled defaults
    try {
      const txt = await fs.readFile(DEFAULT_PASSAGES_FILE, 'utf8');
      const arr = JSON.parse(txt);
      if (Array.isArray(arr)) {
        // Persist a copy to the volume on first read so admin edits have
        // somewhere to live. Atomic write — no risk of corruption on a partial.
        try { await safeWriteJSON(PASSAGES_FILE, arr); } catch (_) { /* ok */ }
        return arr;
      }
    } catch (e) {
      console.error('Failed to load default passages:', e.message);
    }
    return [];
  },

  async readAll() {
    if (!this._cacheLoaded) {
      this._cache = await this._loadFromDisk();
      this._cacheLoaded = true;
    }
    return this._cache;
  },

  async writeAll(passages) {
    if (!Array.isArray(passages)) throw new Error('passages must be an array');
    await safeWriteJSON(PASSAGES_FILE, passages);
    this._cache = passages;
    this._cacheLoaded = true;
    return passages;
  },

  async getById(id) {
    const all = await this.readAll();
    return all.find(p => p.id === Number(id)) || null;
  },

  async upsert(passage) {
    if (!passage || typeof passage !== 'object') throw new Error('passage required');
    const all = await this.readAll();
    const idx = all.findIndex(p => p.id === Number(passage.id));
    const cleaned = sanitizePassage(passage);
    if (idx >= 0) {
      cleaned.id = all[idx].id;
      all[idx] = cleaned;
    } else {
      if (!cleaned.id) cleaned.id = (all.reduce((m, p) => Math.max(m, p.id || 0), 0) + 1);
      all.push(cleaned);
    }
    all.sort((a, b) => (a.id || 0) - (b.id || 0));
    await this.writeAll(all);
    return cleaned;
  },

  async remove(id) {
    const all = await this.readAll();
    const next = all.filter(p => p.id !== Number(id));
    if (next.length === all.length) return false;
    await this.writeAll(next);
    return true;
  }
};

// Postgres-backed passages. The `passages` table is created at boot (in the
// existing DDL block). Each row stores its full payload as JSONB so the schema
// can evolve without migrations. Caching mirrors the JSON backend: read once,
// invalidate on every write.
const PgPassageAPI = {
  _cache: null,
  _cacheLoaded: false,

  async readAll() {
    if (this._cacheLoaded) return this._cache;
    const { rows } = await pgPool.query('SELECT id, payload FROM passages ORDER BY id ASC');
    // The id is also stored inside payload; the column is the source of truth.
    this._cache = rows.map(r => ({ ...(r.payload || {}), id: r.id }));
    this._cacheLoaded = true;
    return this._cache;
  },

  async writeAll(passages) {
    // Bulk replace — used by the JSON→Postgres seed path on first boot, and by
    // any caller that has constructed the full list. Wrapped in a transaction so
    // a failure mid-write doesn't leave the table half-populated.
    if (!Array.isArray(passages)) throw new Error('passages must be an array');
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM passages');
      for (const p of passages) {
        const cleaned = sanitizePassage(p);
        if (!cleaned.id) continue;
        await client.query(
          'INSERT INTO passages (id, payload, updated_at) VALUES ($1, $2, NOW())',
          [cleaned.id, cleaned]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    this._cache = passages.map(p => sanitizePassage(p));
    this._cacheLoaded = true;
    return this._cache;
  },

  async getById(id) {
    // Don't read the whole table when the cache is hot — but if it isn't, a
    // single-row fetch is still cheaper than loading everything.
    if (this._cacheLoaded) return this._cache.find(p => p.id === Number(id)) || null;
    const { rows } = await pgPool.query('SELECT id, payload FROM passages WHERE id = $1', [Number(id)]);
    if (!rows.length) return null;
    return { ...(rows[0].payload || {}), id: rows[0].id };
  },

  async upsert(passage) {
    if (!passage || typeof passage !== 'object') throw new Error('passage required');
    const cleaned = sanitizePassage(passage);
    // If no id, assign one (next available).
    if (!cleaned.id) {
      const { rows } = await pgPool.query('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM passages');
      cleaned.id = rows[0].next;
    }
    // Single-row upsert — the FULL REPLACE semantic (no merging with old) is
    // achieved naturally because Postgres ON CONFLICT … DO UPDATE SET payload =
    // EXCLUDED.payload replaces the whole JSONB blob with the new one. Same
    // intent as the JSON backend's full-replace.
    await pgPool.query(
      `INSERT INTO passages (id, payload, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
      [cleaned.id, cleaned]
    );
    // Invalidate cache — simplest correct behaviour. Re-reads pick up the change.
    this._cacheLoaded = false;
    this._cache = null;
    return cleaned;
  },

  async remove(id) {
    const r = await pgPool.query('DELETE FROM passages WHERE id = $1', [Number(id)]);
    this._cacheLoaded = false;
    this._cache = null;
    return r.rowCount > 0;
  }
};

const PassageAPI = USE_POSTGRES ? PgPassageAPI : JsonPassageAPI;

// Shared sanitizer used by both backends — pulled out so it stays consistent.
function sanitizePassage(p) {
  const out = {
    id: Number(p.id) || 0,
    title: String(p.title || '').trim().slice(0, 200),
    category: String(p.category || '').trim().slice(0, 100),
    text: String(p.text || '').trim(),
    keyElements: {},
    sampleResponse: String(p.sampleResponse || '').trim(),
    sampleNotes: String(p.sampleNotes || '').trim()
  };
  const ke = p.keyElements || {};
  // Accept both new (what/why/how/result) and legacy (topic/pivot/conclusion) fields
  ['what','why','how','result','topic','pivot','conclusion'].forEach(k => {
    if (ke[k] && typeof ke[k] === 'string') out.keyElements[k] = ke[k].trim();
  });
  if (p.keyElementsRationale && typeof p.keyElementsRationale === 'object') {
    const r = p.keyElementsRationale;
    const rOut = {};
    if (typeof r.topic === 'string')      rOut.topic = r.topic.trim().slice(0, 2000);
    if (typeof r.importance === 'string') rOut.importance = r.importance.trim().slice(0, 2000);
    if (r.elements && typeof r.elements === 'object') {
      rOut.elements = {};
      ['what','why','how','result','topic','pivot','conclusion'].forEach(k => {
        if (typeof r.elements[k] === 'string') rOut.elements[k] = r.elements[k].trim().slice(0, 1000);
      });
      if (!Object.keys(rOut.elements).length) delete rOut.elements;
    }
    if (Object.keys(rOut).length) out.keyElementsRationale = rOut;
  }
  if (p.extractionMeta && typeof p.extractionMeta === 'object') {
    const em = p.extractionMeta;
    const emOut = {};
    if (em.framework === 'tpc' || em.framework === 'wwhr') emOut.framework = em.framework;
    if (['high','medium','low'].includes(em.confidence)) emOut.confidence = em.confidence;
    if (typeof em.framework_reason === 'string') emOut.framework_reason = em.framework_reason.trim().slice(0, 500);
    if (typeof em.extractedAt === 'string') emOut.extractedAt = em.extractedAt.slice(0, 40);
    if (Object.keys(emOut).length) out.extractionMeta = emOut;
  }
  return out;
}

// Convenience: the admin API used to call PassageAPI._sanitize directly in a
// couple of places. Map it to the shared function for backwards compatibility.
PassageAPI._sanitize = sanitizePassage;

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER-SIDE AUTH
// ═══════════════════════════════════════════════════════════════════════════════
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin123'; // Set in Railway env vars

function hashPw(pw) { return crypto.createHash('sha256').update(pw.toLowerCase().trim()).digest('hex'); }

const AuthAPI = {
  async readAccounts() {
    const data = await StorageAPI.readData();
    if (!data.accounts) data.accounts = {};
    if (!data.users) data.users = {};
    return data;
  },
  async register(username, password, secretQ, secretA) {
    const uid = username.toLowerCase().trim();
    if (password.length < 4) return { success: false, error: 'Password min 4 chars' };
    // v19.10: Postgres fast path — single account lookup + single insert.
    if (USE_POSTGRES) {
      const existing = await PgStorage._getAccount(uid);
      if (existing) return { success: false, error: 'Username taken' };
      await PgStorage._saveAccount({
        username: uid, passwordHash: hashPw(password),
        secretQ: secretQ || '', secretAHash: secretA ? hashPw(secretA) : '',
        createdAt: new Date().toISOString(), lastLogin: null,
        blocked: false, role: 'user'
      });
      // Seed an empty user_data row so subsequent getUserData returns the same
      // shape JsonStorage would return for a brand-new user.
      await pgPool.query(
        `INSERT INTO user_data (username, data) VALUES ($1, $2::jsonb) ON CONFLICT (username) DO NOTHING`,
        [uid, JSON.stringify({ attempted: [], summaries: {}, scores: {}, history: {}, stats: { totalAttempts: 0, averageScore: 0 } })]
      );
      return { success: true, user: { username: uid, role: 'user' } };
    }
    // JSON fallback (unchanged)
    const data = await this.readAccounts();
    if (data.accounts[uid]) return { success: false, error: 'Username taken' };
    data.accounts[uid] = {
      username: uid, passwordHash: hashPw(password),
      secretQ: secretQ || '', secretAHash: secretA ? hashPw(secretA) : '',
      createdAt: new Date().toISOString(), lastLogin: null,
      blocked: false, role: 'user'
    };
    if (!data.users[uid]) data.users[uid] = { attempted: [], summaries: {}, scores: {}, history: {}, stats: { totalAttempts: 0, averageScore: 0 } };
    await StorageAPI.writeData(data);
    return { success: true, user: { username: uid, role: 'user' } };
  },
  async login(username, password) {
    const uid = username.toLowerCase().trim();
    if (USE_POSTGRES) {
      const acct = await PgStorage._getAccount(uid);
      if (!acct) return { success: false, error: 'User not found' };
      if (acct.blocked) return { success: false, error: 'Account blocked. Contact admin.' };
      if (acct.passwordHash !== hashPw(password)) return { success: false, error: 'Wrong password' };
      // Stamp lastLogin without rewriting any other field.
      await pgPool.query('UPDATE accounts SET last_login = NOW() WHERE username = $1', [uid]);
      return { success: true, user: { username: uid, role: acct.role || 'user' } };
    }
    const data = await this.readAccounts();
    const acct = data.accounts[uid];
    if (!acct) return { success: false, error: 'User not found' };
    if (acct.blocked) return { success: false, error: 'Account blocked. Contact admin.' };
    if (acct.passwordHash !== hashPw(password)) return { success: false, error: 'Wrong password' };
    acct.lastLogin = new Date().toISOString();
    await StorageAPI.writeData(data);
    return { success: true, user: { username: uid, role: acct.role || 'user' } };
  },
  async changePassword(username, oldPw, newPw) {
    const uid = username.toLowerCase().trim();
    if (USE_POSTGRES) {
      const acct = await PgStorage._getAccount(uid);
      if (!acct) return { success: false, error: 'User not found' };
      if (acct.passwordHash !== hashPw(oldPw)) return { success: false, error: 'Wrong current password' };
      if (newPw.length < 4) return { success: false, error: 'Min 4 chars' };
      await pgPool.query('UPDATE accounts SET password_hash = $1 WHERE username = $2', [hashPw(newPw), uid]);
      return { success: true };
    }
    const data = await this.readAccounts();
    const acct = data.accounts[uid];
    if (!acct) return { success: false, error: 'User not found' };
    if (acct.passwordHash !== hashPw(oldPw)) return { success: false, error: 'Wrong current password' };
    if (newPw.length < 4) return { success: false, error: 'Min 4 chars' };
    acct.passwordHash = hashPw(newPw);
    await StorageAPI.writeData(data);
    return { success: true };
  },
  async resetPassword(username, secretA, newPw) {
    const data = await this.readAccounts();
    const uid = username.toLowerCase().trim();
    const acct = data.accounts[uid];
    if (!acct) return { success: false, error: 'User not found' };
    if (!acct.secretAHash || acct.secretAHash !== hashPw(secretA)) return { success: false, error: 'Wrong answer' };
    if (newPw && newPw.length >= 4) { acct.passwordHash = hashPw(newPw); await StorageAPI.writeData(data); return { success: true }; }
    return { success: true, verified: true, secretQ: acct.secretQ };
  },
  async getSecretQ(username) {
    const data = await this.readAccounts();
    const uid = username.toLowerCase().trim();
    const acct = data.accounts[uid];
    if (!acct || !acct.secretQ) return { success: false, error: 'No secret question set' };
    return { success: true, secretQ: acct.secretQ };
  },
  // ── Admin functions ──
  async listUsers() {
    const data = await this.readAccounts();
    return Object.values(data.accounts).map(a => ({
      username: a.username, createdAt: a.createdAt, lastLogin: a.lastLogin,
      blocked: a.blocked || false, role: a.role || 'user',
      stats: (data.users[a.username] || {}).stats || { totalAttempts: 0, averageScore: 0 }
    }));
  },
  async deleteUser(username) {
    const data = await this.readAccounts();
    const uid = username.toLowerCase().trim();
    if (!data.accounts[uid]) return { success: false, error: 'User not found' };
    delete data.accounts[uid];
    delete data.users[uid];
    await StorageAPI.writeData(data);
    return { success: true };
  },
  async blockUser(username, blocked) {
    const data = await this.readAccounts();
    const uid = username.toLowerCase().trim();
    if (!data.accounts[uid]) return { success: false, error: 'User not found' };
    data.accounts[uid].blocked = blocked;
    await StorageAPI.writeData(data);
    return { success: true, blocked };
  },
  async adminResetPassword(username, newPw) {
    const data = await this.readAccounts();
    const uid = username.toLowerCase().trim();
    if (!data.accounts[uid]) return { success: false, error: 'User not found' };
    data.accounts[uid].passwordHash = hashPw(newPw);
    await StorageAPI.writeData(data);
    return { success: true };
  },
  async getUserData(username) {
    const data = await this.readAccounts();
    const uid = username.toLowerCase().trim();
    return { account: data.accounts[uid] || null, progress: data.users[uid] || null };
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// SPELL CHECKER — Edit distance only (no dictionary file needed)
// ═══════════════════════════════════════════════════════════════════════════════
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const m = a.length, n = b.length;
  const dp = Array.from({length: m + 1}, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function checkSpelling(studentText, passageText) {
  const passageLower = passageText.toLowerCase().replace(/[^\w\s'-]/g, '');
  const passageWords = new Set(passageLower.split(/\s+/).filter(w => w.length > 2));
  const passageExpanded = new Set(passageWords);
  for (const w of passageWords) {
    for (const suf of ['s','ed','ing','ly','er','est','tion','ment','ness','ity','ive','ful','less','ous','al','ial','able','ible']) passageExpanded.add(w + suf);
    if (w.endsWith('ing')) passageExpanded.add(w.slice(0, -3));
    if (w.endsWith('ed')) passageExpanded.add(w.slice(0, -2));
    if (w.endsWith('s') && w.length > 3) passageExpanded.add(w.slice(0, -1));
    if (w.endsWith('ly')) passageExpanded.add(w.slice(0, -2));
    if (w.endsWith('e')) { passageExpanded.add(w.slice(0,-1)+'ing'); passageExpanded.add(w.slice(0,-1)+'ed'); passageExpanded.add(w.slice(0,-1)+'ation'); }
    if (w.endsWith('y') && w.length>=4) { const stem=w.slice(0,-1); passageExpanded.add(stem+'ies'); passageExpanded.add(stem+'ied'); passageExpanded.add(stem+'ily'); }
    // British/American variants
    if (w.endsWith('ize')) passageExpanded.add(w.replace(/ize$/, 'ise'));
    if (w.endsWith('ise')) passageExpanded.add(w.replace(/ise$/, 'ize'));
    if (w.endsWith('ization')) passageExpanded.add(w.replace(/ization$/, 'isation'));
    if (w.endsWith('isation')) passageExpanded.add(w.replace(/isation$/, 'ization'));
    if (w.endsWith('ized')) passageExpanded.add(w.replace(/ized$/, 'ised'));
    if (w.endsWith('ised')) passageExpanded.add(w.replace(/ised$/, 'ized'));
    // Also handle z↔s anywhere in word
    if (w.includes('z')) passageExpanded.add(w.replace(/z/g, 's'));
    if (w.includes('s') && w.length > 5) passageExpanded.add(w.replace(/s(?=ation|ise|ised)/g, 'z'));
  }
  // Add de-hyphenated forms from passage
  const hyphenated = passageText.match(/\w+-\w+/g) || [];
  hyphenated.forEach(h => passageExpanded.add(h.replace(/-/g, '').toLowerCase()));
  // Common function words that are never typos
  const SAFE = new Set(['though','although','through','throughout','therefore','however','moreover','furthermore','nevertheless','consequently','additionally','whereas','whereby','thereby','therein','thereof','nonetheless','meanwhile','otherwise','likewise','similarly','accordingly','subsequently','alternatively','simultaneously','approximately','predominantly','significantly','substantially','considerably','particularly','specifically','essentially','fundamentally','traditionally','potentially','previously','currently','recently','apparently','ultimately','worldwide','nationwide','otherwise']);

  // v19.7.2: pairs of irregular-verb forms that share lemma but differ at
  // edit-distance 1 (e.g., "became"/"become", "begun"/"begin"). When the
  // student types one form and the passage uses the other, the basic edit-
  // distance check would false-flag it as a typo. We map each form to its
  // common alternates so the inflection check below can recognize the pair
  // and skip the typo flag.
  const IRREGULAR_VERB_PAIRS = {
    'became':  ['become','becomes','becoming'],
    'become':  ['became','becomes','becoming'],
    'begun':   ['begin','began','begins','beginning'],
    'began':   ['begin','begun','begins','beginning'],
    'begin':   ['began','begun','begins','beginning'],
    'broke':   ['break','breaks','broken','breaking'],
    'broken':  ['break','breaks','broke','breaking'],
    'chose':   ['choose','chooses','chosen','choosing'],
    'chosen':  ['choose','chooses','chose','choosing'],
    'drove':   ['drive','drives','driven','driving'],
    'driven':  ['drive','drives','drove','driving'],
    'fell':    ['fall','falls','fallen','falling'],
    'fallen':  ['fall','falls','fell','falling'],
    'flew':    ['fly','flies','flew','flown','flying'],
    'flown':   ['fly','flies','flew','flying'],
    'gave':    ['give','gives','given','giving'],
    'given':   ['give','gives','gave','giving'],
    'grew':    ['grow','grows','grown','growing'],
    'grown':   ['grow','grows','grew','growing'],
    'held':    ['hold','holds','holding'],
    'hold':    ['held','holds','holding'],
    'knew':    ['know','knows','known','knowing'],
    'known':   ['know','knows','knew','knowing'],
    'rose':    ['rise','rises','risen','rising'],
    'risen':   ['rise','rises','rose','rising'],
    'shook':   ['shake','shakes','shaken','shaking'],
    'spoke':   ['speak','speaks','spoken','speaking'],
    'spoken':  ['speak','speaks','spoke','speaking'],
    'stole':   ['steal','steals','stolen','stealing'],
    'stolen':  ['steal','steals','stole','stealing'],
    'swam':    ['swim','swims','swum','swimming'],
    'swum':    ['swim','swims','swam','swimming'],
    'took':    ['take','takes','taken','taking'],
    'taken':   ['take','takes','took','taking'],
    'threw':   ['throw','throws','thrown','throwing'],
    'thrown':  ['throw','throws','threw','throwing'],
    'wore':    ['wear','wears','worn','wearing'],
    'worn':    ['wear','wears','wore','wearing'],
    'wrote':   ['write','writes','written','writing'],
    'written': ['write','writes','wrote','writing'],
    'went':    ['go','goes','gone','going'],
    'gone':    ['go','goes','went','going'],
    'saw':     ['see','sees','seen','seeing'],
    'seen':    ['see','sees','saw','seeing'],
    'made':    ['make','makes','making'],
    'make':    ['made','makes','making'],
    'said':    ['say','says','saying'],
    'told':    ['tell','tells','telling'],
    'tell':    ['told','tells','telling'],
    'sold':    ['sell','sells','selling'],
    'sell':    ['sold','sells','selling'],
    'left':    ['leave','leaves','leaving'],
    'leave':   ['left','leaves','leaving'],
    'felt':    ['feel','feels','feeling'],
    'feel':    ['felt','feels','feeling'],
    'heard':   ['hear','hears','hearing'],
    'paid':    ['pay','pays','paying'],
    'pay':     ['paid','pays','paying'],
    'lay':     ['lie','lies','lying','lain'],
    'lain':    ['lie','lies','lay','lying'],
    'sat':     ['sit','sits','sitting'],
    'stood':   ['stand','stands','standing'],
    'stand':   ['stood','stands','standing'],
    'won':     ['win','wins','winning'],
    'lost':    ['lose','loses','losing'],
    'lose':    ['lost','loses','losing'],
    'caught':  ['catch','catches','catching'],
    'taught':  ['teach','teaches','teaching'],
    'bought':  ['buy','buys','buying'],
    'brought': ['bring','brings','bringing'],
    'thought': ['think','thinks','thinking'],
    'fought':  ['fight','fights','fighting'],
    'sought':  ['seek','seeks','seeking'],
  };
  
  const studentWords = studentText.replace(/[^\w\s'-]/g, '').split(/\s+/).filter(w => w.length > 2);
  const errors = [];
  const checked = new Set();
  for (const word of studentWords) {
    const lower = word.toLowerCase();
    if (checked.has(lower)) continue;
    checked.add(lower);
    if (passageExpanded.has(lower)) continue;
    if (SAFE.has(lower)) continue;
    if (/^\d/.test(word) || /^[A-Z]{2,}$/.test(word) || word.includes("'")) continue;
    if (lower.length <= 5) continue;
    // Only flag edit distance EXACTLY 1 from a passage word (very tight — catches real typos only)
    // But skip if the word is a valid derived form (suffix/prefix of a passage word)
    let isTypo = false, closestWord = '';
    let isDerived = false;
    for (const pw of passageWords) {
      // Skip if one contains the other (derived form, not a typo)
      if (pw.includes(lower) || lower.includes(pw)) { isDerived = true; break; }
      // Skip if they share a stem of 4+ chars (e.g., "enhance" vs "enhances" vs "enhanced")
      const minLen = Math.min(pw.length, lower.length);
      if (minLen >= 5) {
        const sharedPrefix = pw.substring(0, minLen-2) === lower.substring(0, minLen-2);
        if (sharedPrefix) { isDerived = true; break; }
      }
    }
    if (isDerived) continue;
    // v19.7.2: irregular verb pairs (e.g., "became"/"become") are at edit
    // distance 1 but are NOT typos — they're inflections. If the student's
    // word has a known alternate form that appears in the passage, skip.
    const irregularAlts = IRREGULAR_VERB_PAIRS[lower];
    if (irregularAlts && irregularAlts.some(alt => passageWords.has(alt))) continue;
    for (const pw of passageWords) {
      if (Math.abs(pw.length - lower.length) > 1) continue;
      const dist = editDistance(lower, pw);
      if (dist === 1) { isTypo = true; closestWord = pw; break; }
    }
    if (isTypo) errors.push({ word, suggestion: closestWord });
  }
  return { errors: errors.map(e => e.word), suggestions: errors.map(e => ({ misspelled: e.word, suggestion: e.suggestion })), count: errors.length };
}

const BAND_MAP = { 0:'Band 5',1:'Band 5',2:'Band 6',3:'Band 6.5',4:'Band 7',5:'Band 7.5',6:'Band 8',7:'Band 9' };
const RAW_TO_PTE = { 0:10,1:15,2:28,3:38,4:50,5:62,6:76,7:90 };

// ─── HELPERS: Count the number of key elements on a passage ─────────────────
// The strict content gate (v19.4) treats each key element as one "band". A
// passage with 4 elements has content_score 0–4; a passage with 3 elements
// has content_score 0–3. This function reports the total — accepting both
// the new (what/why/how/result) and legacy (topic/pivot/conclusion) schemas.
function countKeyElements(keyElements) {
  if (!keyElements || typeof keyElements !== 'object') return 0;
  const newCount = ['what','why','how','result'].filter(k => typeof keyElements[k] === 'string' && keyElements[k].trim()).length;
  if (newCount > 0) return newCount;
  return ['topic','pivot','conclusion'].filter(k => typeof keyElements[k] === 'string' && keyElements[k].trim()).length;
}

// Continuous raw-to-PTE mapping — supports decimal raw scores via linear interpolation
// (legacy 0–7 scale; preserved for callers that haven't been updated to the dynamic version)
function rawToPTE(raw) {
  raw = Math.max(0, Math.min(7, raw));
  const lo = Math.floor(raw);
  const hi = Math.min(7, lo + 1);
  if (lo === hi || raw === lo) return RAW_TO_PTE[lo];
  const frac = raw - lo;
  return Math.round(RAW_TO_PTE[lo] + frac * (RAW_TO_PTE[hi] - RAW_TO_PTE[lo]));
}
function rawToBand(raw) {
  const r = Math.max(0, Math.min(7, Math.round(raw)));
  return BAND_MAP[r];
}

// ─── DYNAMIC RAW → PTE / BAND ───────────────────────────────────────────────
// v19.4: content_score now scales with the number of key elements (0–N where
// N is 3 or 4). Raw score therefore scales 0–(N+5). These functions linearly
// interpolate so that raw=0 → PTE 10 and raw=maxRaw → PTE 90, with band labels
// proportional to the raw/maxRaw ratio.
function rawToPTEDynamic(raw, maxRaw) {
  if (!maxRaw || maxRaw <= 0) return rawToPTE(raw); // legacy fallback
  raw = Math.max(0, Math.min(maxRaw, raw));
  if (raw === 0) return 10;
  return Math.round(10 + (raw / maxRaw) * 80);
}
function rawToBandDynamic(raw, maxRaw) {
  if (!maxRaw || maxRaw <= 0) return rawToBand(raw);
  const r = maxRaw > 0 ? raw / maxRaw : 0;
  if (r >= 0.93) return 'Band 9';
  if (r >= 0.79) return 'Band 8';
  if (r >= 0.64) return 'Band 7.5';
  if (r >= 0.50) return 'Band 7';
  if (r >= 0.36) return 'Band 6.5';
  if (r >= 0.21) return 'Band 6';
  return 'Band 5';
}
// Inverse of rawToPTEDynamic — given a PTE cap, what raw cap does that imply?
function pteToRaw(pte, maxRaw) {
  if (!maxRaw || maxRaw <= 0) return 0;
  return Math.max(0, (pte - 10) * maxRaw / 80);
}

const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','by',
  'is','are','was','were','be','been','have','has','had','will','would','could',
  'should','may','might','can','this','that','these','those','it','they','them',
  'their','there','then','than','as','so','also','about','up','out','down','off',
  'over','under','again','here','why','how','all','any','both','each','few',
  'more','most','other','some','such','no','nor','not','only','own','same','too',
  'very','just','because','while','through','during','before','after','above',
  'below','despite','without','within','between','into','from','its','our','we',
  'which','what','who','whom','whose','when','where','much','many','says','said',
  'asks','asked','states','stated','reports','reported','according','notes','noted',
  'being','become','became','does','did','done','going','went','gone','like','even'
]);

const NUMBER_WORD_MAP = {
  'zero':'0','one':'1','two':'2','three':'3','four':'4','five':'5',
  'six':'6','seven':'7','eight':'8','nine':'9','ten':'10','eleven':'11',
  'twelve':'12','thirteen':'13','fourteen':'14','fifteen':'15','sixteen':'16',
  'seventeen':'17','eighteen':'18','nineteen':'19','twenty':'20','thirty':'30',
  'forty':'40','fifty':'50','sixty':'60','seventy':'70','eighty':'80','ninety':'90',
  'hundred':'100','thousand':'1000','million':'1000000','billion':'1000000000'
};

// ═══════════════════════════════════════════════════════════════════════════════
// MEANING-SAFE SYNONYM MAP
// Each key is a word from the passage; values are synonyms that PRESERVE meaning.
// Student gets credit ONLY for swaps in this map.
// ═══════════════════════════════════════════════════════════════════════════════
const SAFE_SYNONYMS = {
  // Verbs
  'made':['opted','chose','decided','selected','undertook'],
  'make':['create','produce','generate','establish','form'],
  'choice':['decision','selection','option'],
  'exchange':['swap','trade','switch','replace'],
  'knew':['understood','recognised','recognized','acknowledged','realised','realized'],
  'familiar':['acquainted','aware','knowledgeable','experienced','accustomed'],
  'persuade':['convince','urge','encourage','argue'],
  'became':['transformed','evolved','developed','emerged','turned'],
  'surpassed':['overtaken','exceeded','outpaced','outperformed','eclipsed'],
  'shows':['demonstrates','reveals','indicates','illustrates','highlights'],
  'said':['stated','argued','claimed','noted','emphasized','declared','mentioned'],
  'important':['significant','crucial','critical','essential','vital'],
  'problem':['challenge','issue','concern','difficulty','obstacle'],
  'good':['beneficial','advantageous','positive','favorable','valuable','worthwhile'],
  'bad':['detrimental','negative','adverse','harmful','unfavorable','poor'],
  'big':['substantial','significant','considerable','major','enormous','large'],
  'small':['minor','modest','minimal','slight','marginal'],
  'increase':['rise','growth','surge','expansion','escalation','gain'],
  'decrease':['decline','drop','reduction','fall','contraction'],
  'cause':['lead','result','trigger','generate','produce'],
  'help':['assist','facilitate','enable','support','contribute'],
  'change':['shift','transition','transformation','alteration','modification'],
  'grow':['expand','develop','increase','rise','flourish'],
  // Academic vocabulary — bidirectional
  'enhance':['improve','strengthen','bolster','augment','elevate'],
  'ensure':['guarantee','safeguard','secure','verify','confirm'],
  'promote':['foster','encourage','advance','champion','facilitate'],
  'develop':['cultivate','advance','evolve','progress','mature'],
  'address':['tackle','resolve','confront','handle','manage'],
  'require':['necessitate','demand','mandate','entail','warrant'],
  'maintain':['sustain','preserve','uphold','retain','continue'],
  'implement':['execute','deploy','carry','enact','operationalise'],
  'demonstrate':['illustrate','show','reveal','exhibit','display'],
  'achieve':['attain','accomplish','realize','secure','obtain'],
  'integrate':['combine','incorporate','merge','unify','blend'],
  'establish':['create','found','institute','set','build'],
  'enable':['facilitate','empower','allow','permit','equip'],
  'transform':['convert','restructure','reshape','revolutionise','overhaul'],
  'embed':['incorporate','integrate','instil','ingrain','entrench'],
  'cultivate':['foster','nurture','develop','encourage','promote'],
  'encompass':['include','comprise','incorporate','cover','embrace'],
  'facilitate':['enable','assist','expedite','streamline','simplify'],
  'adopt':['embrace','implement','employ','utilise','accept'],
  'align':['harmonise','coordinate','synchronise','reconcile','calibrate'],
  'leverage':['utilise','exploit','harness','capitalise','maximise'],
  'mitigate':['reduce','alleviate','diminish','lessen','curtail'],
  'necessitate':['require','demand','mandate','compel','warrant'],
  'optimise':['improve','enhance','refine','maximise','streamline'],
  'prioritise':['emphasise','focus','highlight','favour','concentrate'],
  'yield':['produce','generate','deliver','furnish','provide'],
  'characterise':['define','describe','distinguish','typify','denote'],
  'transcend':['surpass','exceed','go beyond','outstrip','eclipse'],
  'need':['require','necessitate','demand'],
  'use':['utilize','employ','apply','leverage'],
  'show':['demonstrate','reveal','indicate','display','exhibit'],
  'think':['believe','consider','regard','view','deem'],
  'start':['begin','commence','initiate','launch'],
  'end':['conclude','finish','terminate','cease'],
  'give':['provide','offer','supply','grant','deliver'],
  'take':['acquire','obtain','receive','accept'],
  'find':['discover','identify','detect','uncover','locate'],
  'keep':['maintain','retain','preserve','sustain'],
  'try':['attempt','endeavour','strive','seek'],
  'build':['construct','create','develop','establish'],
  'cut':['reduce','decrease','lower','diminish'],
  'run':['operate','manage','conduct','administer'],
  'move':['relocate','shift','transfer','migrate'],
  'reach':['achieve','attain','accomplish'],
  'spend':['invest','allocate','devote'],
  'face':['confront','encounter','experience'],
  'warn':['caution','alert','advise'],
  'rise':['increase','grow','climb','surge','escalate'],
  'fall':['decline','drop','decrease','diminish','plunge'],
  'affect':['impact','influence','alter'],
  'suggest':['propose','recommend','indicate','imply'],
  'claim':['assert','maintain','contend','argue'],
  'reveal':['disclose','expose','uncover','show'],
  'establish':['create','found','set up','institute'],
  'reduce':['decrease','lower','diminish','cut','minimize'],
  // Adjectives
  'many':['numerous','several','various','multiple','diverse'],
  'difficult':['challenging','complex','arduous','demanding'],
  'easy':['straightforward','simple','uncomplicated','manageable'],
  'fast':['rapid','swift','quick','accelerated'],
  'slow':['gradual','steady','moderate','incremental'],
  'smooth':['seamless','steady','unhindered','effortless'],
  'new':['novel','recent','modern','emerging','innovative'],
  'old':['ancient','longstanding','established','traditional'],
  'high':['elevated','substantial','considerable','significant'],
  'low':['minimal','reduced','modest','limited'],
  'strong':['robust','powerful','substantial','significant'],
  'weak':['fragile','vulnerable','insufficient','inadequate'],
  'clear':['evident','obvious','apparent','distinct'],
  'large':['extensive','substantial','considerable','vast','enormous'],
  'huge':['massive','enormous','vast','immense','colossal'],
  'growing':['increasing','expanding','rising','escalating'],
  'serious':['severe','critical','grave','significant'],
  'major':['significant','substantial','considerable','key','primary'],
  'main':['primary','principal','chief','key','central'],
  // Nouns (only generic ones — domain nouns must NOT be changed)
  'people':['individuals','persons','population','citizens'],
  'country':['nation','state','territory'],
  'city':['metropolis','urban centre','municipality'],
  'money':['capital','funds','resources','finances'],
  'work':['employment','occupation','labour','profession'],
  'area':['region','zone','sector','domain'],
  'way':['method','approach','manner','means'],
  'part':['portion','segment','component','section'],
  'world':['globe','planet'],
  'place':['location','site','venue','position'],
  'group':['collection','cluster','band','assembly'],
  'system':['framework','structure','network','mechanism'],
  'cost':['expense','expenditure','price','outlay'],
  'result':['outcome','consequence','effect','finding'],
  'level':['degree','extent','magnitude'],
  'rate':['pace','speed','frequency','proportion'],
  'risk':['danger','threat','hazard','peril'],
  'impact':['effect','influence','consequence'],
  'issue':['problem','concern','challenge','matter'],
  'advantage':['benefit','merit','strength','asset'],
  'disadvantage':['drawback','downside','limitation','shortcoming'],
};

// ═══════════════════════════════════════════════════════════════════════════════
// MEANING-DANGER MAP — Antonyms / meaning-reversing substitutions
// If student uses one of these instead of the original, it CHANGES meaning → penalize
// ═══════════════════════════════════════════════════════════════════════════════
const MEANING_DANGER = {
  'minor':['major','significant','serious','critical','substantial','severe','enormous','huge'],
  'major':['minor','small','trivial','insignificant','negligible','slight'],
  'many':['few','rare','scarce','limited','hardly any'],
  'few':['many','numerous','abundant','countless','plenty'],
  'advantages':['disadvantages','drawbacks','problems','negatives','downsides','flaws'],
  'disadvantages':['advantages','benefits','positives','strengths','merits','assets'],
  'smooth':['rough','turbulent','difficult','troubled','rocky','bumpy'],
  'increase':['decrease','decline','drop','fall','reduction','shrinkage','contraction'],
  'decrease':['increase','rise','growth','surge','gain','expansion','improvement'],
  'high':['low','minimal','reduced','negligible'],
  'low':['high','elevated','substantial','significant','considerable'],
  'good':['bad','poor','terrible','awful','negative','harmful'],
  'bad':['good','great','excellent','positive','beneficial'],
  'success':['failure','defeat','collapse','disaster'],
  'failure':['success','achievement','triumph','victory'],
  'rise':['fall','decline','drop','decrease','collapse','plunge'],
  'fall':['rise','increase','growth','surge','climb'],
  'positive':['negative','adverse','harmful','detrimental'],
  'negative':['positive','beneficial','favorable','advantageous'],
  'strong':['weak','fragile','vulnerable','feeble'],
  'weak':['strong','robust','powerful','resilient'],
  'expensive':['cheap','affordable','inexpensive','economical'],
  'cheap':['expensive','costly','premium','dear'],
  'large':['small','tiny','minimal','negligible'],
  'small':['large','huge','enormous','vast','massive'],
  'fast':['slow','gradual','sluggish','leisurely'],
  'slow':['fast','rapid','swift','quick','accelerated'],
  'growth':['decline','contraction','shrinkage','recession','stagnation','reduction','decrease'],
  'decline':['growth','expansion','rise','increase','boom'],
  'profit':['loss','deficit','debt'],
  'loss':['profit','gain','surplus','revenue','growth','rise','improvement','benefit'],
  'safe':['dangerous','risky','hazardous','unsafe','perilous'],
  'dangerous':['safe','secure','harmless','benign'],
  'accept':['reject','refuse','decline','deny'],
  'reject':['accept','approve','embrace','adopt'],
  'support':['oppose','resist','undermine','hinder'],
  'oppose':['support','endorse','back','champion'],
  'include':['exclude','omit','remove','eliminate'],
  'exclude':['include','incorporate','embrace','encompass'],
  'agree':['disagree','dispute','contest','deny'],
  'disagree':['agree','concur','approve','accept'],
  'improve':['worsen','deteriorate','decline','degrade'],
  'worsen':['improve','enhance','ameliorate','better'],
  'most':['least','fewest','minimal'],
  'least':['most','greatest','maximum'],
  'always':['never','rarely','seldom'],
  'never':['always','constantly','perpetually'],
  'all':['none','zero','no'],
  'none':['all','every','each','complete'],
  'before':['after','following','subsequent'],
  'after':['before','preceding','prior'],
  'above':['below','under','beneath'],
  'below':['above','over','exceeding'],
};

// ═══════════════════════════════════════════════════════════════════════════════
// THESAURUS — Datamuse API (free, no key required)
// Docs: https://www.datamuse.com/api/
// ═══════════════════════════════════════════════════════════════════════════════
const thesaurusCache = new Map();
const THESAURUS_CACHE_MAX = 500;

async function fetchDatamuseSynonyms(word) {
  const key = word.toLowerCase().trim();
  if (thesaurusCache.has(key)) return thesaurusCache.get(key);
  try {
    const url = `https://api.datamuse.com/words?rel_syn=${encodeURIComponent(key)}&max=10`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const data = await res.json();
    // Keep only single clean words, filter out the original
    const synonyms = data
      .filter(w => w.word !== key && w.word.length >= 3 && /^[a-z]+(-[a-z]+)?$/.test(w.word))
      .map(w => w.word)
      .slice(0, 7);
    thesaurusCache.set(key, synonyms);
    if (thesaurusCache.size > THESAURUS_CACHE_MAX) {
      thesaurusCache.delete(thesaurusCache.keys().next().value);
    }
    return synonyms;
  } catch { return []; }
}

// Identify verbatim passage words in student text that would benefit from swapping
function identifySwapCandidates(studentText, passageText, alreadySwapped = []) {
  const swappedSet = new Set(alreadySwapped.map(w => w.toLowerCase()));
  const passageWords = passageText.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length >= 5 && !STOP_WORDS.has(w));
  const passageSet = new Set(passageWords);
  const studentWords = studentText.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
  
  // Score each candidate: prefer longer words, content-rich words
  const seen = new Set();
  const candidates = [];
  for (const word of studentWords) {
    if (word.length < 5) continue;
    if (STOP_WORDS.has(word)) continue;
    if (swappedSet.has(word)) continue;
    if (seen.has(word)) continue;
    if (!passageSet.has(word)) continue;
    seen.add(word);
    candidates.push(word);
    if (candidates.length >= 6) break;
  }
  return candidates;
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════
function normaliseNumbers(text) {
  let t = text.toLowerCase();
  for (const [word, digit] of Object.entries(NUMBER_WORD_MAP))
    t = t.replace(new RegExp(`\\b${word}\\b`, 'g'), digit);
  return t;
}

function stripHtml(text) {
  return (text || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();
}

function extractConcepts(text) {
  if (!text) return [];
  const concepts = [];
  const numbers = text.match(/\$?\d+(?:\.\d+)?(?:\s*(?:billion|million|trillion|percent))?%?/gi) || [];
  concepts.push(...numbers.map(n => n.toLowerCase().trim()).filter(n => n.length > 0));
  const words = text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
  concepts.push(...new Set(words));
  return [...new Set(concepts)];
}

function fuzzyNumberMatch(keyNums, studentNums) {
  for (const kn of keyNums) {
    const kVal = parseFloat(kn); if (isNaN(kVal)) continue;
    for (const sn of studentNums) {
      const sVal = parseFloat(sn); if (isNaN(sVal)) continue;
      if (kVal === sVal || Math.abs(kVal - sVal) <= 1) return true;
      if (kVal > 10 && Math.abs(kVal - sVal) / kVal <= 0.10) return true;
    }
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHECK KEY POINT — content detection
// ═══════════════════════════════════════════════════════════════════════════════
function checkKeyPoint(studentText, keyPointText) {
  const student = stripHtml(studentText).toLowerCase().replace(/[^\w\s$%]/g, ' ');
  const studentNorm = normaliseNumbers(student);
  const keyPoint = stripHtml(keyPointText).toLowerCase();
  const keyConcepts = extractConcepts(normaliseNumbers(keyPoint));

  // v19.5: tightened thresholds — old values (0.18 / 0.22) caused false positives
  // when student summaries shared generic vocabulary with the passage but did
  // not actually convey the idea. Stricter thresholds + a critical-term gate
  // for short ideas keep the local fallback honest when Claude is unavailable.
  const isLong = keyConcepts.length > 15;
  const thresholds = { concept: isLong ? 0.30 : 0.45, critical: isLong ? 0.35 : 0.50 };

  let matchedConcepts = 0;
  const matched = [];
  for (const c of keyConcepts) {
    if (studentNorm.includes(c)) { matchedConcepts++; matched.push(c); }
  }
  const matchRate = keyConcepts.length > 0 ? matchedConcepts / keyConcepts.length : 0;

  const numberTerms = (keyPoint.match(/\$?\d+(?:\.\d+)?(?:\s*(?:billion|million|trillion))?%?/gi) || []).map(t => t.toLowerCase().trim());
  const longWords = keyPoint.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length >= 5 && !STOP_WORDS.has(w)).map(w => w.toLowerCase());
  const criticalTerms = [...new Set([...numberTerms, ...longWords])].filter(t => t.length > 0);

  let matchedCritical = 0;
  const matchedCriticalTerms = [];
  for (const t of criticalTerms) { if (studentNorm.includes(t)) { matchedCritical++; matchedCriticalTerms.push(t); } }
  const criticalRate = criticalTerms.length > 0 ? matchedCritical / criticalTerms.length : 0;

  const keyNums = keyPoint.match(/\d+(?:\.\d+)?/g) || [];
  const studentNums = studentNorm.match(/\d+(?:\.\d+)?/g) || [];
  const numberMatched = keyNums.length > 0 ? fuzzyNumberMatch(keyNums, studentNums) : true;

  // PRESENCE DECISION (v19.5 — stricter than v19.4)
  // An idea is "present" when:
  //   - critical-term match >= threshold (preferred — content words specific to this idea), AND
  //   - either: numbers matched (when present in the key point), OR concept match >= 0.30
  // This prevents false positives where student shares only generic words.
  // For short key points (<=15 concepts), critical match is mandatory.
  const conceptPass = matchRate >= thresholds.concept;
  const criticalPass = criticalRate >= thresholds.critical;
  const minCritical = matchedCritical >= 3; // was 2 — 3 specific terms required
  const strongConcept = matchRate >= 0.50;  // was 0.35

  // Two paths to "present":
  //   Path A: critical-term match passes the threshold AND numbers (if any) match
  //   Path B: very strong concept overlap (≥0.50) AND number match
  // Otherwise: not present.
  const isPresent = (
    (criticalPass || minCritical) && (numberMatched || strongConcept)
  ) || (
    strongConcept && numberMatched && conceptPass
  );

  return {
    present: isPresent, matchRate: Math.round(matchRate * 100), criticalRate: Math.round(criticalRate * 100),
    matchedConcepts: matched.slice(0, 8), totalConcepts: keyConcepts.length,
    matchedCritical, matchedCriticalTerms: matchedCriticalTerms.slice(0, 8), totalCritical: criticalTerms.length,
    numberMatched, strongConceptFallback: strongConcept, thresholdUsed: thresholds
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// VERBATIM DETECTION
// ═══════════════════════════════════════════════════════════════════════════════
function detectVerbatim(studentText, passageText) {
  const student = studentText.toLowerCase().replace(/[^\w\s]/g, '');
  const passage = passageText.toLowerCase().replace(/[^\w\s]/g, '');
  const studentWords = student.split(/\s+/).filter(w => w.length > 3);
  if (studentWords.length === 0) return { verbatimRate: 0, isVerbatim: false, longestRun: 0, verbatimPhrases: [] };

  const matchedWords = new Set();
  const verbatimPhrases = [];
  for (let len = 5; len >= 3; len--) {
    for (let i = 0; i <= studentWords.length - len; i++) {
      if (matchedWords.has(i)) continue;
      const phrase = studentWords.slice(i, i + len).join(' ');
      if (passage.includes(phrase)) {
        for (let j = i; j < i + len; j++) matchedWords.add(j);
        if (len >= 4) verbatimPhrases.push(phrase);
        i += len - 1;
      }
    }
  }
  for (let i = 0; i < studentWords.length; i++) {
    if (!matchedWords.has(i) && studentWords[i].length >= 4 && passage.includes(studentWords[i])) matchedWords.add(i);
  }

  let longestRun = 0, cur = 0;
  for (let i = 0; i < studentWords.length; i++) { if (matchedWords.has(i)) { cur++; longestRun = Math.max(longestRun, cur); } else cur = 0; }

  return {
    verbatimRate: Math.round((matchedWords.size / studentWords.length) * 100),
    isVerbatim: (matchedWords.size / studentWords.length) > 0.90,
    longestRun, verbatimPhrases: [...new Set(verbatimPhrases)].slice(0, 5)
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FIRST-PERSON DETECTION
// ═══════════════════════════════════════════════════════════════════════════════
function detectFirstPerson(studentText, passageText) {
  const sl = studentText.toLowerCase();
  const pl = passageText.toLowerCase();
  const passageHasFirstPerson = /\b(i |i'|my |me |we |our |us )\b/i.test(pl);

  const patterns = [
    { pattern: /\bI made\b/i, type: 'copied-i' }, { pattern: /\bI knew\b/i, type: 'copied-i' },
    { pattern: /\bI was\b/i, type: 'copied-i' }, { pattern: /\bI had\b/i, type: 'copied-i' },
    { pattern: /\bI live\b/i, type: 'copied-i' }, { pattern: /\bI feel\b/i, type: 'copied-i' },
    { pattern: /\bmy wife\b/i, type: 'personal' }, { pattern: /\bmy young wife\b/i, type: 'personal' },
  ];

  const shiftPatterns = [
    /\bthe (author|narrator|speaker|writer|passage|text|article)\b/i,
    /\b(he|she) (made|knew|was|had|explained|discussed|argued|stated|noted|mentioned|opted|chose|decided|acknowledged)\b/i,
  ];

  const hasPerspectiveShift = shiftPatterns.some(p => p.test(sl));
  const issues = [];
  for (const { pattern, type } of patterns) {
    if (pattern.test(sl)) issues.push({ match: sl.match(pattern)[0], type });
  }
  const isProblematic = passageHasFirstPerson && issues.length > 0 && !hasPerspectiveShift;

  return {
    detected: issues.length > 0, isProblematic, issues, hasPerspectiveShift, passageHasFirstPerson,
    suggestion: isProblematic ? 'Change "I made" → "The author opted". Always use third-person.' : null
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// PARAPHRASING ANALYSIS (word swaps + structural changes + vocab suggestions)
// ═══════════════════════════════════════════════════════════════════════════════
function analyzeSwaps(studentText, passageText) {
  const studentWords = studentText.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2);
  const passageWordSet = new Set(passageText.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2));
  const studentWordSet = new Set(studentWords);
  const novelWords = studentWords.filter(w => !passageWordSet.has(w) && !STOP_WORDS.has(w) && w.length >= 3);

  const safeSwaps = [];
  for (const [original, synonyms] of Object.entries(SAFE_SYNONYMS)) {
    if (passageWordSet.has(original)) {
      for (const syn of synonyms) {
        if (studentWordSet.has(syn) && !passageWordSet.has(syn)) safeSwaps.push({ original, replacement: syn, type: 'safe' });
      }
    }
  }

  const structuralChanges = [];
  const passageSentences = passageText.split(/[.!?]+/).filter(s => s.trim().length > 20);
  const studentLower = studentText.toLowerCase();
  let ideasCombined = 0;
  for (const sent of passageSentences) {
    const kw = sent.toLowerCase().replace(/[^\w\s]/g,'').split(/\s+/).filter(w => w.length >= 5 && !STOP_WORDS.has(w)).slice(0, 3);
    if (kw.length >= 2 && kw.some(k => studentLower.includes(k))) ideasCombined++;
  }
  if (ideasCombined >= 3) structuralChanges.push({ type: 'combining', detail: 'Combined ' + ideasCombined + ' passage ideas into one sentence' });

  const pCW = passageText.toLowerCase().replace(/[^\w\s]/g,'').split(/\s+/).filter(w => w.length > 3 && !STOP_WORDS.has(w));
  const sCW = studentText.toLowerCase().replace(/[^\w\s]/g,'').split(/\s+/).filter(w => w.length > 3 && !STOP_WORDS.has(w));
  if (sCW.length / Math.max(1, pCW.length) < 0.40) structuralChanges.push({ type: 'condensing', detail: 'Condensed to ' + Math.round((sCW.length / Math.max(1, pCW.length))*100) + '% of passage' });

  const uniqueNovel = [...new Set(novelWords)];
  if (uniqueNovel.length >= 3) structuralChanges.push({ type: 'novel_phrasing', detail: uniqueNovel.length + ' novel words introduced' });

  const totalParaphraseCredit = safeSwaps.length + structuralChanges.length;

  const dangerousSwaps = [];
  // ── Build a set of "polarity pairs already in passage" to suppress false positives ──
  // If the passage discusses BOTH "advantages" AND "disadvantages" (or any opposing pair),
  // a student using either word's antonym is legitimately referring to the other side,
  // not reversing meaning. Don't flag in that case.
  const passageContainsBothSides = (original, antonyms) => {
    // Check if passage contains the original AND any of its listed antonyms
    return passageWordSet.has(original) && antonyms.some(a => passageWordSet.has(a));
  };
  for (const [original, antonyms] of Object.entries(MEANING_DANGER)) {
    if (passageWordSet.has(original) && !studentWordSet.has(original)) {
      // SUPPRESS if passage discusses both polarities — student is using antonym for the other side
      if (passageContainsBothSides(original, antonyms)) continue;
      for (const ant of antonyms) {
        if (studentWordSet.has(ant) && !passageWordSet.has(ant)) {
          dangerousSwaps.push({ original, replacement: ant, type: 'dangerous' });
        }
      }
    }
  }

  const ACADEMIC = new Set(['consequently','furthermore','moreover','nevertheless','predominantly','significantly','substantially','fundamentally','paradigm','phenomenon','discourse','implications','framework','methodology','synthesis','analysis','correlation','demonstrated','facilitated','implemented','necessitate','acknowledges','encompasses','illustrates','transition','transformation','evolution','proliferation','emergence','contemporary','comprehensive','opted','acknowledged','advocated','cultivated','elucidated','emphasized','exemplified','highlighted','posited','contended','beneficial','detrimental','pivotal','instrumental','paramount','imperative','multifaceted']);
  const academicWordsUsed = [...new Set(studentWords.filter(w => ACADEMIC.has(w)))];

  return { safeSwaps, structuralChanges, dangerousSwaps, safeSwapCount: safeSwaps.length, structuralCount: structuralChanges.length, totalParaphraseCredit, dangerousSwapCount: dangerousSwaps.length, academicWordsUsed, novelWords: uniqueNovel.slice(0, 10), novelWordRate: Math.round((uniqueNovel.length / Math.max(1, studentWords.length)) * 100) };
}

const VOCAB_UPGRADES = {'good':['beneficial','advantageous','favorable'],'bad':['detrimental','adverse','harmful'],'big':['substantial','significant','considerable'],'small':['minimal','marginal','modest'],'important':['crucial','pivotal','paramount'],'problem':['challenge','impediment','obstacle'],'problems':['challenges','impediments','obstacles'],'change':['transformation','transition','evolution'],'changes':['transformations','transitions','developments'],'use':['utilize','employ','leverage'],'show':['demonstrate','illustrate','reveal'],'shows':['demonstrates','illustrates','reveals'],'help':['facilitate','enable','bolster'],'helps':['facilitates','enables','promotes'],'need':['necessitate','require','demand'],'think':['contend','posit','argue'],'make':['generate','produce','establish'],'get':['obtain','acquire','attain'],'give':['provide','furnish','yield'],'said':['stated','asserted','articulated'],'told':['informed','conveyed','communicated'],'asked':['inquired','questioned','probed'],'many':['numerous','myriad','abundant'],'lot':['considerable amount','substantial quantity','abundance'],'very':['exceedingly','remarkably','substantially'],'really':['genuinely','fundamentally','considerably'],'also':['furthermore','additionally','moreover'],'but':['however','nevertheless','conversely'],'because':['owing to','due to','attributable to'],'so':['consequently','therefore','hence'],'about':['approximately','regarding','concerning'],'like':['such as','including','analogous to'],'enough':['sufficient','adequate','ample'],'old':['longstanding','established','time-honored'],'new':['novel','innovative','cutting-edge'],'fast':['rapid','expeditious','swift'],'slow':['gradual','incremental','protracted'],'hard':['challenging','arduous','formidable'],'easy':['straightforward','feasible','manageable'],'wrong':['erroneous','flawed','fallacious'],'start':['commence','initiate','embark upon'],'end':['conclude','terminate','culminate'],'stop':['cease','discontinue','curtail'],'grow':['escalate','proliferate','expand'],'growing':['escalating','proliferating','intensifying'],'fall':['decline','diminish','plummet'],'rise':['surge','escalate','soar'],'cause':['trigger','precipitate','engender'],'causes':['triggers','precipitates','catalyzes'],'affect':['impact','influence','alter'],'affects':['impacts','influences','alters'],'people':['individuals','citizens','populace'],'country':['nation','sovereign state','jurisdiction'],'world':['globe','international arena','global landscape'],'money':['capital','financial resources','revenue'],'work':['employment','occupation','labor'],'place':['location','domain','environment'],'way':['approach','methodology','mechanism'],'part':['component','facet','dimension'],'area':['domain','sphere','sector'],'clear':['evident','apparent','manifest'],'keep':['maintain','sustain','preserve'],'lead':['catalyze','precipitate','engender'],'leads':['catalyzes','precipitates','gives rise to'],'different':['diverse','disparate','distinct'],'same':['identical','equivalent','analogous'],'main':['primary','principal','predominant'],'increase':['escalation','surge','amplification'],'decrease':['reduction','decline','contraction'],'happen':['occur','transpire','materialize'],'try':['endeavor','strive','undertake'],'lack':['deficiency','dearth','paucity'],'spread':['disseminate','propagate','proliferate'],'improve':['enhance','ameliorate','augment'],'reduce':['mitigate','diminish','alleviate'],'support':['substantiate','corroborate','bolster'],'create':['establish','engender','cultivate'],'result':['consequence','outcome','ramification'],'results':['consequences','outcomes','ramifications']};

function generateVocabSuggestions(studentText) {
  const words = studentText.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
  const suggestions = []; const seen = new Set();
  for (const word of words) {
    if (VOCAB_UPGRADES[word] && !seen.has(word)) { seen.add(word); suggestions.push({ original: word, upgrades: VOCAB_UPGRADES[word] }); }
  }
  return suggestions.slice(0, 8);
}



// FORM VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════
function validateForm(text) {
  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  const wc = words.length;
  if (wc < 5)  return { valid: false, score: 0, reason: 'Too short (min 5 words)', wc, overflow_penalty: 0 };
  if (wc > 75) return { valid: false, score: 0, reason: `Too long (${wc} words, max 75) — form fails, PTE 10`, wc, overflow_penalty: 0 };
  if (!/[.!?]$/.test(text.trim())) return { valid: false, score: 0, reason: 'Must end with period', wc, overflow_penalty: 0 };
  const clean = text.replace(/\b(?:Dr|Mrs|Mr|Ms|Prof|Jr|Sr|St|etc|vs|approx|govt|Inc|Corp|Ltd|Vol|No|Fig)\./gi, '##')
                     .replace(/\b(?:U\.K|U\.S|i\.e|e\.g|a\.m|p\.m)\b\.?/gi, '##');
  const sentences = (clean.match(/[.!?](\s|$)/g) || []).length;
  if (sentences !== 1) return { valid: false, score: 0, reason: `Must be exactly one sentence (found ${sentences})`, wc, overflow_penalty: 0 };

  return { valid: true, score: 1, reason: 'Valid', wc, overflow_penalty: 0, warning: null };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GRAMMAR CHECK
// ═══════════════════════════════════════════════════════════════════════════════
function checkGrammar(text, passageText) {
  const lower = text.toLowerCase();
  let score = 2;
  const issues = [];

  const connectorPatterns = [
    { word:'however',type:'contrast' },{ word:'although',type:'contrast' },{ word:'though',type:'contrast' },
    { word:'whereas',type:'contrast' },{ word:'while',type:'contrast' },{ word:'nevertheless',type:'contrast' },
    { word:'despite',type:'contrast' },{ word:'therefore',type:'result' },{ word:'consequently',type:'result' },
    { word:'thus',type:'result' },{ word:'hence',type:'result' },{ word:'moreover',type:'addition' },
    { word:'furthermore',type:'addition' },{ word:'additionally',type:'addition' },
  ];

  let foundType = null, connectorUsed = null;
  for (const { word, type } of connectorPatterns) {
    if (lower.includes(word)) { foundType = type; connectorUsed = word; break; }
  }
  const hasConnector = foundType !== null;
  const hasSemicolon = /;\s*(however|therefore|moreover|furthermore|consequently|thus|although|though|nevertheless|whereas|additionally|hence)/i.test(text);

  if (!hasConnector) { score = Math.min(score, 1); issues.push('No connector — use however, therefore, moreover, furthermore'); }
  else if (!hasSemicolon) { score = Math.min(score, 1); issues.push(`Found "${connectorUsed}" but missing semicolon. Use: "; ${connectorUsed},"`); }

  if (!/^[A-Z0-9$"'"]/.test(text.trim())) { issues.push('Start with a capital letter'); score = Math.min(score, 1); }

  const svErrors = [
    { pattern: /(people|they|countries|nations|workers|students|researchers)\s+(is|was|has)\b/i, msg: 'Plural subject + singular verb' },
    { pattern: /(he|she|it|the author|the speaker|the narrator)\s+(are|were|have)\b/i, msg: 'Singular subject + plural verb' },
  ];
  for (const { pattern, msg } of svErrors) { if (pattern.test(text)) { issues.push(msg); score = Math.min(score, 0); } }

  if (/\b(\w+)\s+\1\b/i.test(text)) {
    const m = text.match(/\b(\w+)\s+\1\b/i);
    if (m && !['that','had','was'].includes(m[1].toLowerCase())) { issues.push(`Repeated word: "${m[1]}"`); score = Math.min(score, 1); }
  }

  const firstPerson = detectFirstPerson(text, passageText || '');

  return {
    score, has_connector: hasConnector, connector_used: connectorUsed,
    connector_type: foundType || 'none',
    connector_quality: hasConnector && hasSemicolon ? 'perfect' : hasConnector ? 'partial' : 'missing',
    has_semicolon_before_connector: hasSemicolon, grammar_issues: issues, first_person: firstPerson
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// VOCABULARY SCORING v2 — Two methods to full marks:
//
// VERBATIM METHOD: copy passage lines + connect with however/moreover/etc → 2/2
// PARAPHRASED METHOD: 4+ appropriate synonym swaps → 2/2
//
// Penalties:
// - Heavy verbatim WITHOUT connectors (lazy lifting) → cap at 1/2
// - Meaning-reversing synonym → 0/2
// - LLM-flagged inappropriate synonym → -0.5
// - First-person not shifted → -0.5 (was hard cap at 1)
// ═══════════════════════════════════════════════════════════════════════════════
function scoreVocabulary(verbatimData, swapData, firstPersonData, grammarData, llmJudgment) {
  const { verbatimRate } = verbatimData;
  const { safeSwaps, structuralChanges, dangerousSwaps, safeSwapCount, structuralCount, totalParaphraseCredit, dangerousSwapCount, academicWordsUsed } = swapData;
  const perspectiveShifted = firstPersonData.hasPerspectiveShift;
  // ── Effective credit for the 4-swap rule = ACTUAL word swaps only ──
  // Structural changes (combining, condensing) happen in every summary and
  // shouldn't count as "swap credits" for the paraphrased-vs-verbatim distinction.
  const wordSwapCredit = safeSwapCount;
  const effectiveCredit = wordSwapCredit + structuralCount; // for total recognition only
  const hasConnector = grammarData?.has_connector || false;

  let score = 2; // Default: copy is FINE
  let notes = [];
  let suggestion = null;
  let meaningChanged = false;
  let inappropriateCount = 0;

  // ── Hard penalty: meaning-reversing synonyms → V:0 ──
  if (dangerousSwapCount > 0) {
    meaningChanged = true; score = 0;
    notes.push(`⚠ MEANING REVERSED: ${dangerousSwaps.map(s => `"${s.original}" → "${s.replacement}"`).join('; ')}`);
    suggestion = 'Synonym changed the meaning. Choose substitutes that preserve sense ("minor" → "small" OK; "minor" → "major" WRONG).';
  }

  // ── LLM-detected meaning damage (highest priority after dangerous swaps) ──
  if (!meaningChanged && llmJudgment?.synonym_appropriateness === 'meaning_changed') {
    meaningChanged = true; score = 0;
    notes.push('⚠ Synonym altered passage meaning (AI judge)');
    if (llmJudgment.synonym_issues?.length) {
      suggestion = llmJudgment.synonym_issues.slice(0, 2).join('; ');
    }
  } else if (!meaningChanged && llmJudgment?.synonym_appropriateness === 'some_inappropriate') {
    inappropriateCount = (llmJudgment.synonym_issues?.length || 1);
    score = Math.max(0, score - 0.5);
    notes.push(`⚠ ${inappropriateCount} inappropriate synonym${inappropriateCount > 1 ? 's' : ''}: ${(llmJudgment.synonym_issues || []).slice(0,2).join('; ')}`);
  }

  // ── Verbatim Method check: lifting only counts if connectors are present ──
  // Use wordSwapCredit (actual word substitutions), not effectiveCredit, because
  // structural changes like "combining" and "condensing" happen in every summary.
  const isHeavyVerbatim = verbatimRate >= 80 && wordSwapCredit < 2;
  if (!meaningChanged && isHeavyVerbatim) {
    if (!hasConnector) {
      score = Math.min(score, 1);
      notes.push('⚠ Heavy verbatim without connectors — add ; however, / ; moreover, / ; therefore, to connect clauses');
      if (!suggestion) suggestion = 'Verbatim is fine BUT clauses must be glued with connectors.';
    } else {
      notes.push('✓ Verbatim Method — passage lines properly connected');
    }
  }

  // ── First-person not shifted → soft -0.5 (was hard cap at 1) ──
  if (!meaningChanged && firstPersonData.isProblematic) {
    score = Math.max(0, score - 0.5);
    notes.push('⚠ First-person not shifted — change "I made" → "the author made"');
    if (!suggestion) suggestion = 'Convert "I/my/we" to "the author/his/their" for academic register.';
  }

  // ── Recognition notes (informational) ──
  // For "Paraphrased Method" recognition, require 2+ word swaps (was 4) — students
  // who lift key phrases (rather than full sentences) and apply 2–3 academic upgrades
  // deserve full vocabulary credit per the v19.2 rubric.
  if (wordSwapCredit >= 2) notes.push(`✓ ${wordSwapCredit} synonym swap${wordSwapCredit > 1 ? 's' : ''} — Paraphrased Method`);
  else if (wordSwapCredit === 1) notes.push('1 synonym swap (target: 2–3 academic upgrades for full marks)');
  else if (!meaningChanged && verbatimRate >= 70) notes.push('Verbatim style — ensure strong connectors');

  if (perspectiveShifted) notes.push('✓ Third-person perspective');
  if (academicWordsUsed.length >= 2) notes.push(`✓ Academic vocabulary: ${academicWordsUsed.slice(0, 3).join(', ')}`);
  if (safeSwaps.length > 0 && !meaningChanged) notes.push(`Swaps: ${safeSwaps.slice(0, 4).map(s => `"${s.original}" → "${s.replacement}"`).join(', ')}`);
  if (structuralChanges.length > 0 && !meaningChanged) notes.push(`Structural: ${structuralChanges.map(s => s.detail).join(', ')}`);

  // Method tag — five paths, all of which can lead to high marks if executed cleanly:
  //   paraphrased    : 2+ academic word swaps (was 4 in v19.1)
  //   verbatim       : ≥70% lifted text + connectors (Verbatim Method)
  //   verbatim_weak  : ≥70% lifted text but no connectors (lazy lifting)
  //   phrase_picking : low verbatim + content covered + connectors — student
  //                    selected key phrases and stitched them; legitimate path.
  //   hybrid         : doesn't fit cleanly into any of the above
  let method;
  if (wordSwapCredit >= 2) method = 'paraphrased';
  else if (verbatimRate >= 70 && hasConnector) method = 'verbatim';
  else if (verbatimRate >= 70) method = 'verbatim_weak';
  else if (verbatimRate < 70 && hasConnector) method = 'phrase_picking';
  else method = 'hybrid';

  if (!suggestion && score >= 2) {
    suggestion = wordSwapCredit >= 2
      ? 'Strong vocabulary — keep using academic synonyms.'
      : 'Replace 2–3 common words with academic synonyms (e.g., made→opted, good→beneficial, important→crucial) to lift Reading skill.';
  }

  return {
    score, verbatim_rate: verbatimRate,
    safe_swaps: safeSwaps, structural_changes: structuralChanges, dangerous_swaps: dangerousSwaps,
    safe_swap_count: safeSwapCount, structural_count: structuralCount,
    effective_credit: effectiveCredit, total_paraphrase_credit: effectiveCredit,
    dangerous_swap_count: dangerousSwapCount,
    inappropriate_count: inappropriateCount,
    meaning_changed: meaningChanged,
    academic_words: academicWordsUsed, perspective_shifted: perspectiveShifted,
    method,
    notes, suggestion,
    breakdown: {
      verbatim_penalty: isHeavyVerbatim && !hasConnector ? 'no_connectors' : 'none',
      swap_status: effectiveCredit >= 4 ? 'excellent' : effectiveCredit >= 1 ? 'partial' : 'none',
      meaning_danger: meaningChanged
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SKILL CONTRIBUTIONS v2
//
// Reading skill ceiling rule (per real exam feedback):
//   "For good Reading scores, correct idea selection AND academic synonyms is must."
// → contentScore=0 caps Reading at PTE 15 (heavy penalty for wrong ideas)
// → contentScore=2 + no academic synonyms caps Reading around 55–65 (verbatim path)
// → contentScore=2 + academic synonyms can reach Reading 90 (paraphrased path)
//
// Writing skill: tracks form + grammar + vocab + length-band
// ═══════════════════════════════════════════════════════════════════════════════
function estimateSkillContributions(rawScore, contentScore, grammarScore, vocabScore, swapData, llmJudgment, contentMax, maxRaw) {
  const academicCount = (swapData?.academicWordsUsed?.length || 0)
    + ((llmJudgment?.academic_register === true) ? 2 : 0);
  const swapCredit = swapData?.totalParaphraseCredit || 0;
  // v19.2: 2+ swaps now counts as "academic synonyms used" (was 4)
  const hasAcademicSynonyms = academicCount >= 2 || swapCredit >= 2;
  const cohesionStrong = llmJudgment?.cohesion === 'strong';
  const cohesionWeak = llmJudgment?.cohesion === 'weak';

  // v19.4: ratio-based content tier so 0–N scoring works for any N
  const cMax = contentMax > 0 ? contentMax : 2;
  const rMax = maxRaw > 0 ? maxRaw : 7;
  const contentRatio = contentScore / cMax;        // 0..1
  const rawRatio     = rawScore / rMax;            // 0..1
  const contentFull    = contentScore >= cMax;
  const contentPartial = contentScore > 0 && contentScore < cMax;
  const contentNone    = contentScore === 0;

  // ── READING ──
  // Rubric (v19.2): Reading 90 requires correct ideas + (academic synonyms OR
  // phrase-picking with strong cohesion). Pure verbatim still caps moderately
  // because Pearson's Reading skill rewards lexical resourcefulness, but the
  // ceiling is no longer locked unless the student also nails cohesion.
  let reading;
  if (contentNone) {
    reading = 15; // Wrong ideas — cap heavily
  } else if (contentPartial) {
    // v19.4: partial coverage scales with how much of the passage was actually captured.
    if (contentRatio >= 0.75) reading = hasAcademicSynonyms ? 70 : 60;
    else if (contentRatio >= 0.5) reading = hasAcademicSynonyms ? 55 : 45;
    else reading = hasAcademicSynonyms ? 42 : 32;
  } else { // contentFull
    if (academicCount >= 3 || swapCredit >= 3) reading = 90;
    else if (hasAcademicSynonyms) reading = 82;            // 2+ swaps now reaches 82 (was 79)
    else if (cohesionStrong && swapCredit >= 1) reading = 79; // phrase-picking + 1 swap + strong cohesion
    else if (swapCredit >= 1) reading = 70;
    else if (cohesionStrong) reading = 65;                 // pure verbatim but well-connected
    else reading = 55; // verbatim with no swaps and no strong cohesion signal
  }
  // Cohesion penalty — weak cohesion should knock Reading down even with content
  if (cohesionWeak && reading > 50) reading = Math.max(50, reading - 15);

  // ── WRITING ── (ratio-based on dynamic maxRaw)
  let writing;
  if (rawRatio >= 0.93) writing = 88;
  else if (rawRatio >= 0.85) writing = 82;
  else if (rawRatio >= 0.71) writing = 70;
  else if (rawRatio >= 0.57) writing = 58;
  else if (rawRatio >= 0.43) writing = 45;
  else if (rawRatio >= 0.29) writing = 30;
  else writing = 15;

  return {
    reading: {
      estimate: reading,
      components: { content: contentScore, content_max: cMax, academic_synonyms: academicCount, swap_credit: swapCredit, has_academic_synonyms: hasAcademicSynonyms },
      note: (() => {
        if (contentNone) return 'Wrong ideas — Reading skill heavily impacted';
        if (cohesionWeak) return 'Ideas present but weakly connected — cohesion limits Reading skill';
        if (contentFull && hasAcademicSynonyms) return 'Strong — correct ideas + academic synonyms';
        if (contentFull) return 'All ideas captured — replace 2–3 common words with academic synonyms to push Reading higher';
        return `${contentScore}/${cMax} main ideas captured — add the missing one${cMax - contentScore > 1 ? 's' : ''} to lift Reading further`;
      })()
    },
    writing: {
      estimate: writing,
      components: { grammar: grammarScore, vocabulary: vocabScore, form: 1, raw: rawScore, max_raw: rMax },
      note: rawRatio >= 0.85 ? 'Strong production' : rawRatio >= 0.57 ? 'Moderate production' : 'Production needs work'
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FEEDBACK & TIPS
// ═══════════════════════════════════════════════════════════════════════════════
function generateFeedback(coverage, grammar, vocab, firstPerson) {
  const presentCount = coverage.filter(c => c.present).length;
  const missing = coverage.filter(c => !c.present).map(c => c.type);
  const parts = [];

  if (presentCount === 3) parts.push('All 3 key ideas captured — excellent comprehension.');
  else if (presentCount === 2) parts.push(`2/3 key ideas found. Missing: ${missing[0]}.`);
  else if (presentCount === 1) parts.push(`Only 1/3 key ideas found. Missing: ${missing.join(' and ')}.`);
  else parts.push('No key ideas detected. Use TOPIC → PIVOT → CONCLUSION structure.');

  if (grammar.score === 2) parts.push('Grammar excellent with proper connector.');
  else if (!grammar.has_connector) parts.push('Add a connector with semicolon for full grammar marks.');
  else parts.push(grammar.grammar_issues[0] || 'Minor grammar issue.');

  if (vocab.meaning_changed) parts.push('⚠️ CRITICAL: Your synonyms changed the meaning of the passage!');
  else if (vocab.score === 2) parts.push(`Vocabulary excellent (${vocab.total_paraphrase_credit} safe synonym swaps).`);
  else if (vocab.total_paraphrase_credit < 4) parts.push(`Need ${4 - vocab.total_paraphrase_credit} more synonym swaps for full vocab marks.`);

  if (firstPerson.isProblematic) parts.push('⚠️ First-person language — shift to "The author/narrator".');

  return parts.join(' ');
}

function generateImprovementTips(rawScore, contentScore, grammarScore, vocabScore, grammar, vocab) {
  const tips = [];
  if (contentScore < 2) tips.push('CONTENT: Identify Topic (what is it about?), Pivot (but/however), Conclusion (so what?)');
  if (grammarScore < 2) {
    if (!grammar.has_connector) tips.push('GRAMMAR: Add "; however," or "; therefore," with semicolon');
    else if (!grammar.has_semicolon_before_connector) tips.push(`GRAMMAR: Write "; ${grammar.connector_used}," not just "${grammar.connector_used}"`);
  }
  if (vocab.meaning_changed) {
    tips.push('VOCABULARY: Your synonym CHANGED the meaning! "minor"→"small" is OK, "minor"→"major" is WRONG. Always check the synonym preserves the original idea.');
  } else if (vocabScore < 2 && vocab.total_paraphrase_credit < 4) {
    tips.push(`VOCABULARY: Need ${4 - vocab.total_paraphrase_credit} more synonym swaps. Replace verbs (made→opted, knew→acknowledged) and adjectives (good→beneficial, many→numerous) but keep nouns.`);
  }
  if (rawScore >= 6 && rawScore < 7) tips.push('ALMOST BAND 9: One small fix could push you to 90.');
  return tips.join(' | ');
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── SPELL CHECK — Datamuse sp= (general English dictionary) ─────────────────
// Complements the passage-relative checkSpelling() which only catches
// words within edit-distance-1 of a passage word. This catches misspellings
// of synonym words the student introduces themselves.

const spellCache = new Map();
const SPELL_CACHE_MAX = 1000;

// Returns top suggestion for a misspelled word, or null if word looks correct
// ─── HEADLINE RESCUE (v19.7.2) ──────────────────────────────────────────────
// When Claude awards 0.5 to an idea, the most common reason in practice is that
// the key element itself contains TWO clauses joined by " and ", " ; ", a comma
// before "and", or "; moreover/furthermore" — i.e., it's overstuffed. If the
// student captures the FIRST clause (the headline) but omits the secondary
// clause, Claude reports partial credit even though by PTE rubric they have
// fully captured the idea.
//
// This rescue extracts the headline from each key element (the substring before
// the first joining conjunction) and checks whether the student's text contains
// the distinctive content tokens of that headline. If yes → upgrade 0.5 → 1.0.
// Conservative thresholds: requires ≥60% of headline content tokens to match,
// and at least 2 distinctive terms. Never downgrades — only upgrades.

const HEADLINE_STOP = new Set([
  'the','a','an','and','or','but','of','to','for','from','with','by','in','on',
  'at','as','is','are','was','were','be','been','have','has','had','will','would',
  'could','should','may','might','can','this','that','these','those','it','its',
  'their','they','them','there','then','than','so','also','about','up','out','down',
  'off','i','you','he','she','we','his','her','our','your','my'
]);

function extractHeadline(keyElementText) {
  if (!keyElementText) return '';
  const t = String(keyElementText).trim();
  // Splitters kept in sync with condenseKeyElement() to ensure the rescue
  // sees the same headline that was sent to Claude in the prompt.
  const splitters = [
    /,\s+such\s+as\s+/i,
    /\s+such\s+as\s+/i,               // no-comma variant
    /,\s+including\s+/i,
    /,\s+like\s+/i,
    /,\s+for\s+example\b/i,
    /,\s+e\.?g\.?\s+/i,
    /,\s+with\s+/i,
    /;\s*moreover\b/i,
    /;\s*furthermore\b/i,
    /;\s*and\b/i,
    /,\s+and\s+/i,
    /\s+;\s+/,
  ];
  for (const re of splitters) {
    const m = t.match(re);
    if (m && m.index > 20) return t.slice(0, m.index).trim();
  }
  return t;
}

function tokenizeForHeadline(s) {
  return String(s || '').toLowerCase()
    .replace(/[^\w\s$%]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !HEADLINE_STOP.has(w));
}

// Returns true when the student's text contains enough of the headline's
// distinctive tokens that we're confident they captured it.
// Common paraphrase pairs that PTE students use. When the headline contains
// any of these, students often substitute the alternate form — the matcher
// should treat them as equivalent. Asymmetric: directional, lookup by headline
// token. Each entry's array is the set of common student substitutions.
const HEADLINE_SYNONYMS = {
  familiar:     ['aware','conscious','acquainted','knowledgeable','knew'],
  aware:        ['familiar','conscious','acquainted','knowledgeable','knew'],
  disadvantages:['downsides','drawbacks','limitations','negatives','cons','disadvantage'],
  disadvantage: ['downside','drawback','limitation','negative','con'],
  advantages:   ['benefits','upsides','positives','pros','perks','advantage'],
  advantage:    ['benefit','upside','positive','pro','perk'],
  persuaded:    ['convinced','swayed','induced','urged','tried'],
  persuade:     ['convince','sway','induce','urge','try'],
  altered:      ['changed','transformed','modified','reshaped','revolutionised','revolutionized'],
  alter:        ['change','transform','modify','reshape','revolutionise','revolutionize'],
  overtaken:    ['surpassed','exceeded','outpaced','eclipsed','outstripped'],
  surpassed:    ['overtaken','exceeded','outpaced','eclipsed'],
  generates:    ['produces','creates','yields','delivers','contributes'],
  generate:     ['produce','create','yield','deliver','contribute'],
  catalyst:     ['driver','facilitator','agent','spur'],
  invented:     ['created','devised','developed','originated','pioneered'],
  invent:       ['create','devise','develop','originate','pioneer'],
  frustrated:   ['dissatisfied','annoyed','irritated','displeased'],
  rivals:       ['competitors','counterparts','peers'],
  rival:        ['competitor','counterpart','peer'],
  smooth:       ['easy','steady','straightforward','seamless','effortless'],
  decision:     ['choice','selection','determination'],
  choice:       ['decision','selection','determination'],
  scientist:    ['researcher','academic','scholar','expert'],
  exchange:     ['swap','trade','substitute','replace'],
  exchanged:    ['swapped','traded','substituted','replaced'],
  exchanging:   ['swapping','trading','substituting','replacing'],
  expensive:    ['costly','pricey','dear','high-priced'],
  big:          ['large','huge','massive','substantial','significant'],
  huge:         ['large','big','massive','substantial','significant'],
  large:        ['big','huge','massive','substantial','significant'],
  many:         ['numerous','various','several','multiple','plenty'],
  several:      ['multiple','many','various','numerous'],
  reduce:       ['lower','decrease','diminish','cut'],
  reduces:      ['lowers','decreases','diminishes','cuts'],
};

function headlineCapturedInText(headline, studentText) {
  const headlineTokens = tokenizeForHeadline(headline);
  const studentTokens = new Set(tokenizeForHeadline(studentText));
  if (headlineTokens.length < 2) return { captured: false, ratio: 0, hits: 0, total: 0, matched: [] };
  let hits = 0;
  const matched = [];
  for (const tok of headlineTokens) {
    // Direct match
    if (studentTokens.has(tok)) { hits++; matched.push(tok); continue; }
    // Fuzzy stem (e.g., "overtaken" vs "overtake")
    const stem = tok.length > 5 ? tok.slice(0, tok.length - 2) : tok;
    let stemHit = false;
    if (stem.length >= 4) {
      for (const st of studentTokens) {
        if (st.startsWith(stem)) { hits++; matched.push(tok + '→' + st); stemHit = true; break; }
      }
    }
    if (stemHit) continue;
    // v19.8.1: synonym-aware fallback
    const synonyms = HEADLINE_SYNONYMS[tok];
    if (synonyms) {
      for (const syn of synonyms) {
        if (studentTokens.has(syn)) { hits++; matched.push(tok + '⇄' + syn); break; }
        const synStem = syn.length > 5 ? syn.slice(0, syn.length - 2) : syn;
        if (synStem.length >= 4) {
          let synHit = false;
          for (const st of studentTokens) {
            if (st.startsWith(synStem)) { hits++; matched.push(tok + '⇄' + st); synHit = true; break; }
          }
          if (synHit) break;
        }
      }
    }
  }
  const ratio = hits / headlineTokens.length;
  return { captured: ratio >= 0.55 && hits >= 2, ratio, hits, total: headlineTokens.length, matched };
}

// Apply the rescue to a per_idea_scores object. Returns the rescue audit so
// it can be surfaced in content_details for transparency / debugging.
function applyHeadlineRescue(perIdeaScores, keyElements, studentText) {
  if (!perIdeaScores || !keyElements) return { applied: [], skipped: [] };
  const audit = { applied: [], skipped: [] };
  for (const label of Object.keys(perIdeaScores)) {
    const score = perIdeaScores[label];
    if (score >= 1) continue;          // already full — nothing to do
    const keyText = keyElements[label];
    if (!keyText) continue;
    const headline = extractHeadline(keyText);
    // If headline equals the whole key element, no overstuffing detected →
    // accept Claude's verdict.
    if (headline.length >= keyText.length - 5) {
      audit.skipped.push({ label, reason: 'no_dual_clause_pattern' });
      continue;
    }
    const result = headlineCapturedInText(headline, studentText);
    // v19.8.1: rescue 0.5 and 0.0 cases — but use stricter threshold for 0.0
    // since Claude was more confident the idea was missing.
    const wasMissing = score === 0;
    const threshold = wasMissing ? 0.65 : 0.55;
    const minHits = wasMissing ? 3 : 2;
    if (result.ratio >= threshold && result.hits >= minHits) {
      perIdeaScores[label] = 1;
      audit.applied.push({
        label, headline, hits: result.hits, total: result.total,
        ratio: +result.ratio.toFixed(2),
        matched: result.matched.slice(0, 6),
        was: wasMissing ? 'missing' : 'partial'
      });
    } else {
      audit.skipped.push({ label, reason: 'headline_not_captured', ratio: +result.ratio.toFixed(2), hits: result.hits, total: result.total });
    }
  }
  return audit;
}

// ─── INLINE SPELLING ENRICHMENT (v19.6) ─────────────────────────────────────
// `checkSpelling` is fast but conservative: it only catches typos within edit
// distance 1 of words that *already appear in the passage*, with length diff
// ≤ 1. That misses common transpositions ("excahnge" → "exchange" is distance
// 2 in pure Levenshtein) and any typo of a paraphrased word that isn't in the
// passage at all ("decsion" → "decision" when the passage says "choice").
//
// This helper takes the existing checkSpelling result and asks Datamuse about
// remaining candidate words. Datamuse's `sp=` endpoint returns words spelled
// similarly; if the top result is the queried word, it's correctly spelled.
// Otherwise we treat it as a typo and use the top suggestions.
//
// Bounded concurrency (8 in flight max) + per-call timeout (already in
// datamouseSpellCheck) keep the overall added latency under ~1 second even
// for sloppy summaries with many candidates.
async function enrichSpellingWithDatamuse(localResult, studentText) {
  if (!studentText || typeof studentText !== 'string') return localResult;
  // Words already flagged by the passage checker — skip them in Datamuse to
  // avoid double-counting. Compare lower-cased so "Athur" (capitalised) and
  // "athur" both dedupe.
  const localFlagged = new Set((localResult?.suggestions || []).map(s => (s.misspelled || '').toLowerCase()));
  const candidates = spellCheckCandidates(studentText)
    .filter(w => !localFlagged.has(w.toLowerCase()))
    .slice(0, 12); // hard cap to bound latency

  if (candidates.length === 0) return localResult;

  // Run lookups in parallel with a soft overall budget. Any individual
  // datamouseSpellCheck call has its own 3s timeout already.
  let datamuseHits = [];
  try {
    const lookups = candidates.map(async (w) => {
      const suggestions = await datamouseSpellCheck(w);
      return suggestions ? { word: w, suggestions } : null;
    });
    const overallTimeout = new Promise(resolve => setTimeout(() => resolve('timeout'), 4500));
    const settled = await Promise.race([Promise.all(lookups), overallTimeout]);
    if (settled === 'timeout') return localResult; // network slow — keep local-only result
    datamuseHits = settled.filter(Boolean);
  } catch (_) { return localResult; }

  if (datamuseHits.length === 0) return localResult;

  // Merge: existing errors + new Datamuse errors. Each Datamuse error keeps
  // the word's top suggestion as the canonical "suggestion" field for
  // downstream UI compatibility.
  const newErrors = datamuseHits.map(h => ({ misspelled: h.word, suggestion: h.suggestions[0], suggestions: h.suggestions, source: 'dictionary' }));
  const existingSuggestions = (localResult?.suggestions || []).map(s => ({ ...s, source: s.source || 'passage' }));
  return {
    errors: [...(localResult?.errors || []), ...newErrors.map(e => e.misspelled)],
    suggestions: [...existingSuggestions, ...newErrors],
    count: (localResult?.count || 0) + newErrors.length
  };
}

async function datamouseSpellCheck(word) {
  const key = word.toLowerCase().trim();
  if (spellCache.has(key)) return spellCache.get(key);
  try {
    // sp= returns words spelled similarly; if the exact word comes back top-ranked it's correct
    const url = `https://api.datamuse.com/words?sp=${encodeURIComponent(key)}&max=5`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const results = await res.json();
    if (!results.length) { spellCache.set(key, null); return null; }
    // If the top result exactly matches the query, the word is spelled correctly
    if (results[0].word === key) { spellCache.set(key, null); return null; }
    const suggestions = results.map(r => r.word).filter(w => w !== key).slice(0, 4);
    const result = suggestions.length ? suggestions : null;
    if (spellCache.size >= SPELL_CACHE_MAX) spellCache.delete(spellCache.keys().next().value);
    spellCache.set(key, result);
    return result;
  } catch { return null; }
}

// Tokenise text into unique candidate words worth spell-checking
function spellCheckCandidates(text) {
  const words = text.replace(/[^\w\s'-]/g, ' ').split(/\s+/);
  const seen = new Set();
  return words.filter(w => {
    const lower = w.toLowerCase();
    if (w.length < 4) return false;                       // too short to bother
    if (/^\d/.test(w)) return false;                      // numbers
    if (/^[A-Z]{2,}$/.test(w)) return false;              // acronyms
    if (w.includes("'")) return false;                     // contractions
    if (seen.has(lower)) return false;                     // deduplicate
    seen.add(lower);
    return true;
  });
}

app.post('/api/spellcheck', async (req, res) => {
  const { text, passageText } = req.body || {};
  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Missing text' });

  // Run the fast passage-relative check first (synchronous)
  const passageResult = passageText ? checkSpelling(text, passageText) : { suggestions: [] };
  const passageFlagged = new Set(passageResult.suggestions.map(s => s.misspelled.toLowerCase()));

  // Then run Datamuse on words NOT already flagged by the passage checker
  const candidates = spellCheckCandidates(text).filter(w => !passageFlagged.has(w.toLowerCase()));
  const datamouseErrors = [];

  // Limit parallel calls to 8 words to avoid flooding Datamuse
  const toCheck = candidates.slice(0, 8);
  const checkResults = await Promise.all(toCheck.map(async w => ({ word: w, suggestions: await datamouseSpellCheck(w) })));

  for (const { word, suggestions } of checkResults) {
    if (suggestions) datamouseErrors.push({ misspelled: word, suggestions });
  }

  // Merge: passage-relative errors (single suggestion) + Datamuse errors (multiple suggestions)
  const allErrors = [
    ...passageResult.suggestions.map(s => ({ misspelled: s.misspelled, suggestions: [s.suggestion], source: 'passage' })),
    ...datamouseErrors.map(e => ({ misspelled: e.misspelled, suggestions: e.suggestions, source: 'dictionary' }))
  ];

  res.json({ errors: allErrors, count: allErrors.length });
});

// ─── THESAURUS LOOKUP (proxies Datamuse — cached server-side) ────────────────
app.get('/api/thesaurus/:word', async (req, res) => {
  const word = (req.params.word || '').toLowerCase().replace(/[^a-z'-]/g, '').slice(0, 30);
  if (!word || word.length < 2) return res.status(400).json({ error: 'Invalid word' });
  try {
    const synonyms = await fetchDatamuseSynonyms(word);
    res.json({ word, synonyms });
  } catch (e) {
    res.status(500).json({ error: 'Thesaurus lookup failed' });
  }
});

app.get('/api/health', async (req, res) => {
  // Snapshot current state of the storage file
  const current = {
    file_exists_now: false,
    file_size_now: 0,
    file_mtime_now: null,
    user_count_now: 0,
  };
  try {
    const stat = await fs.stat(STORAGE_FILE);
    current.file_exists_now = true;
    current.file_size_now = stat.size;
    current.file_mtime_now = stat.mtime.toISOString();
    try {
      const parsed = JSON.parse(await fs.readFile(STORAGE_FILE, 'utf8'));
      current.user_count_now = Object.keys(parsed.users || {}).length;
    } catch (_) {}
  } catch (_) {}

  // Probe write capability + persistence
  let probe = { skipped: 'use ?probe=1 to run a write probe' };
  if (req.query.probe === '1') probe = await writeProbe();

  // Check the previous write probe's age — if it exists, that's a survivor file
  // from a previous boot. Its mtime tells us whether the volume persisted.
  let prevProbeFile = null;
  try {
    const probePath = path.join(DATA_DIR, '.write-probe.json');
    const stat = await fs.stat(probePath);
    const data = JSON.parse(await fs.readFile(probePath, 'utf8'));
    prevProbeFile = {
      mtime: stat.mtime.toISOString(),
      from_previous_instance: data.instance !== INSTANCE_ID,
      from_instance: data.instance,
      written_at: data.ts,
      age_minutes: Math.round((Date.now() - new Date(data.ts).getTime()) / 60000)
    };
  } catch (_) {
    prevProbeFile = { exists: false, note: 'No probe file from any previous boot — volume may be ephemeral' };
  }

  // v19.10: When Postgres is active, query DB stats instead of JSON file.
  let pgStatus = null;
  if (USE_POSTGRES && pgPool) {
    pgStatus = { connected: false, accounts: 0, user_data_rows: 0, error: null };
    try {
      const { rows: a } = await pgPool.query('SELECT COUNT(*)::int AS n FROM accounts');
      const { rows: u } = await pgPool.query('SELECT COUNT(*)::int AS n FROM user_data');
      pgStatus.connected = true;
      pgStatus.accounts = a[0].n;
      pgStatus.user_data_rows = u[0].n;
    } catch (e) {
      pgStatus.error = e.message;
    }
  }

  // Verdict: piece it all together
  const usingVolume = !!process.env.RAILWAY_VOLUME_MOUNT_PATH;
  const writingToEphemeral = !USE_POSTGRES && !usingVolume && (DATA_DIR === '/app/data' || DATA_DIR === './data');
  let verdict;
  if (USE_POSTGRES) {
    verdict = pgStatus?.connected
      ? `✓ Postgres backend active — ${pgStatus.accounts} accounts, ${pgStatus.user_data_rows} user records. Data persists across deploys.`
      : `⚠ Postgres configured but not reachable: ${pgStatus?.error || 'unknown error'}`;
  } else if (usingVolume) {
    verdict = '✓ Volume env var set — writes should persist';
  } else if (writingToEphemeral) {
    verdict = '⚠ NO VOLUME AND NO DATABASE_URL — writing to ephemeral disk. Data will be wiped on every deploy.';
  } else {
    verdict = '? Unknown — manually check the storage path';
  }

  res.json({
    status: 'ok',
    version: '19.10.0',
    anthropicConfigured: !!anthropic,
    verdict,
    runtime: {
      instance_id: INSTANCE_ID,
      boot_time: BOOT_TIME,
      uptime_seconds: Math.round(process.uptime()),
      node_version: process.version,
    },
    storage: {
      backend: USE_POSTGRES ? 'postgres' : 'json_file',
      postgres: pgStatus,
      data_dir: DATA_DIR,
      storage_file: STORAGE_FILE,
      passages_file: PASSAGES_FILE,
      using_railway_volume_env: usingVolume,
      railway_volume_env_value: process.env.RAILWAY_VOLUME_MOUNT_PATH || null,
      // v19.10.1: report which env var supplied the connection URL, and the
      // host it points at (credentials stripped) so a bad host is obvious.
      database_url_source: DATABASE_URL_SOURCE,
      database_url_host: (() => {
        if (!DATABASE_URL) return null;
        try { return new URL(DATABASE_URL).host; }
        catch (_) { const m = DATABASE_URL.match(/@([^/?]+)/); return m ? m[1] : 'unparseable'; }
      })(),
      database_public_url_present: !!process.env.DATABASE_PUBLIC_URL,
      database_url_present: !!process.env.DATABASE_URL,
      node_env: process.env.NODE_ENV || null,
      writing_to_ephemeral_disk: writingToEphemeral,
    },
    boot_snapshot: BOOT_SNAPSHOT,
    current_snapshot: current,
    previous_probe_file: prevProbeFile,
    write_probe: probe,
    hints: USE_POSTGRES ? [
      'Postgres backend is active. Data persists across deploys and is not affected by Railway volume issues.',
      'If verdict shows the connection error, check that DATABASE_URL points to a reachable Postgres service.',
      'To migrate from a previous JSON-file deployment, restart the server — pgMigrateFromJsonIfNeeded runs on every boot and is idempotent.'
    ] : [
      'Hit /api/health?probe=1 to test write+read on the data dir',
      'Compare boot_snapshot.user_count_at_boot vs current_snapshot.user_count_now — if boot starts at 0 after every deploy, the volume is not persisting',
      'previous_probe_file.from_previous_instance should be true if the volume persists across deploys',
      'For a permanent fix, provision a Postgres service on Railway — set DATABASE_URL and redeploy'
    ]
  });
});

app.post('/api/progress/:userId', async (req, res) => {
  try {
    const { passageId, summary, scoreData } = req.body;
    res.json(await StorageAPI.saveProgress(req.params.userId, passageId, summary, scoreData));
  } catch (e) { res.status(500).json({ error: 'Failed to save progress' }); }
});

app.get('/api/progress/:userId', async (req, res) => {
  try { res.json(await StorageAPI.getProgress(req.params.userId)); }
  catch (e) { res.status(500).json({ error: 'Failed to get progress' }); }
});

app.get('/api/leaderboard', async (req, res) => {
  try { res.json(await StorageAPI.getLeaderboard(parseInt(req.query.limit) || 10)); }
  catch (e) { res.status(500).json({ error: 'Failed to get leaderboard' }); }
});

// ═══ SYNC ENDPOINTS ═══
// Pull: get full user data from server (called on login)
app.get('/api/sync/:userId', async (req, res) => {
  try { res.json({ success: true, data: await StorageAPI.getUserData(req.params.userId) }); }
  catch (e) { res.status(500).json({ error: 'Sync pull failed' }); }
});

// Push: send full user data to server (called on login + after verify)
app.post('/api/sync/:userId', async (req, res) => {
  try { res.json(await StorageAPI.setUserData(req.params.userId, req.body)); }
  catch (e) { res.status(500).json({ error: 'Sync push failed' }); }
});

// ═══ AUTH ROUTES ═══
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, secretQ, secretA } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    res.json(await AuthAPI.register(username, password, secretQ, secretA));
  } catch (e) { res.status(500).json({ error: 'Registration failed' }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    res.json(await AuthAPI.login(username, password));
  } catch (e) { res.status(500).json({ error: 'Login failed' }); }
});

app.post('/api/auth/change-password', async (req, res) => {
  try {
    const { username, oldPassword, newPassword } = req.body;
    res.json(await AuthAPI.changePassword(username, oldPassword, newPassword));
  } catch (e) { res.status(500).json({ error: 'Password change failed' }); }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { username, secretAnswer, newPassword } = req.body;
    res.json(await AuthAPI.resetPassword(username, secretAnswer, newPassword));
  } catch (e) { res.status(500).json({ error: 'Reset failed' }); }
});

app.get('/api/auth/secret-question/:username', async (req, res) => {
  try { res.json(await AuthAPI.getSecretQ(req.params.username)); }
  catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/auth/check/:username', async (req, res) => {
  // Session-validation endpoint. Used by the frontend on page load to decide
  // whether a saved session is still valid (account exists AND is not blocked).
  // No password — this only confirms the account is still in good standing.
  try {
    const uid = String(req.params.username || '').toLowerCase().trim();
    if (!uid) return res.json({ exists: false, blocked: false, valid: false });
    let acct = null;
    if (USE_POSTGRES) {
      // Fast path — single-row lookup instead of reading the whole store.
      acct = await PgStorage._getAccount(uid);
    } else {
      const data = await StorageAPI.readData();
      acct = (data.accounts && data.accounts[uid]) || null;
    }
    const exists = !!acct;
    const blocked = !!(acct && acct.blocked);
    res.json({ exists, blocked, valid: exists && !blocked, role: acct ? (acct.role || 'user') : null });
  } catch (e) {
    res.json({ exists: false, blocked: false, valid: false });
  }
});

// ═══ ADMIN ROUTES (require ADMIN_KEY) ═══
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key !== ADMIN_KEY) return res.status(403).json({ error: 'Invalid admin key' });
  next();
}

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try { res.json(await AuthAPI.listUsers()); }
  catch (e) { res.status(500).json({ error: 'Failed to list users' }); }
});

app.post('/api/admin/delete-user', requireAdmin, async (req, res) => {
  try { res.json(await AuthAPI.deleteUser(req.body.username)); }
  catch (e) { res.status(500).json({ error: 'Delete failed' }); }
});

app.post('/api/admin/block-user', requireAdmin, async (req, res) => {
  try { res.json(await AuthAPI.blockUser(req.body.username, req.body.blocked)); }
  catch (e) { res.status(500).json({ error: 'Block failed' }); }
});

app.post('/api/admin/reset-password', requireAdmin, async (req, res) => {
  try { res.json(await AuthAPI.adminResetPassword(req.body.username, req.body.newPassword)); }
  catch (e) { res.status(500).json({ error: 'Reset failed' }); }
});

app.get('/api/admin/user-data/:username', requireAdmin, async (req, res) => {
  try { res.json(await AuthAPI.getUserData(req.params.username)); }
  catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ─── v19.11: ADMIN IMPERSONATION ("Open Portal as User") ─────────────────────
// Lets an admin view a student's portal in a new tab. Security model:
//   1. Admin (authenticated by ADMIN_KEY) requests a token for one username.
//   2. The token is an HMAC-signed string: base64(username|expiry).signature
//      — signed with a secret derived from ADMIN_KEY, valid ~5 minutes.
//   3. The student portal sends the token back; the server validates the
//      signature + expiry and returns that user's data.
// A student cannot forge a token (no ADMIN_KEY), and the token cannot be reused
// for a different username (the username is inside the signed payload).
const IMPERSONATION_TTL_MS = 5 * 60 * 1000;  // 5 minutes
function _impersonationSecret() {
  // Derive a signing secret from ADMIN_KEY so it rotates if the admin key changes.
  return crypto.createHash('sha256').update('impersonation:' + ADMIN_KEY).digest();
}
function mintImpersonationToken(username) {
  const payload = username.toLowerCase().trim() + '|' + (Date.now() + IMPERSONATION_TTL_MS);
  const sig = crypto.createHmac('sha256', _impersonationSecret()).update(payload).digest('hex');
  return Buffer.from(payload).toString('base64') + '.' + sig;
}
function verifyImpersonationToken(token) {
  // Returns the username if valid, or null.
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [b64, sig] = token.split('.');
  let payload;
  try { payload = Buffer.from(b64, 'base64').toString('utf8'); }
  catch (e) { return null; }
  const expectedSig = crypto.createHmac('sha256', _impersonationSecret()).update(payload).digest('hex');
  // Constant-time comparison
  if (sig.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
  const sep = payload.lastIndexOf('|');
  if (sep < 0) return null;
  const username = payload.slice(0, sep);
  const expiry = Number(payload.slice(sep + 1));
  if (!username || !expiry || Date.now() > expiry) return null;
  return username;
}

// Admin mints an impersonation token for a username. Requires ADMIN_KEY.
app.get('/api/admin/impersonate/:username', requireAdmin, async (req, res) => {
  try {
    const uid = req.params.username.toLowerCase().trim();
    if (!uid) return res.status(400).json({ error: 'username required' });
    // Confirm the account exists before minting a token for it.
    const userData = await StorageAPI.getUserData(uid);
    const account = await (USE_POSTGRES
      ? PgStorage._getAccount(uid)
      : (async () => { const d = await StorageAPI.readData(); return d.accounts && d.accounts[uid]; })());
    if (!account) return res.status(404).json({ error: 'No such user' });
    const token = mintImpersonationToken(uid);
    res.json({ success: true, username: uid, token, expiresInMs: IMPERSONATION_TTL_MS });
  } catch (e) {
    console.error('Impersonate mint failed:', e.message);
    res.status(500).json({ error: 'Impersonate failed' });
  }
});

// The student portal redeems an impersonation token. No ADMIN_KEY here — the
// token itself is the credential. Returns the impersonated user's data.
app.get('/api/impersonate/redeem', async (req, res) => {
  try {
    const token = req.query.token;
    const username = verifyImpersonationToken(token);
    if (!username) {
      return res.status(403).json({ error: 'Invalid or expired impersonation token' });
    }
    const userData = await StorageAPI.getUserData(username);
    res.json({ success: true, username, data: userData, impersonated: true });
  } catch (e) {
    console.error('Impersonate redeem failed:', e.message);
    res.status(500).json({ error: 'Redeem failed' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PASSAGE ENDPOINTS — public read, admin write
// ═══════════════════════════════════════════════════════════════════════════════
// Public: list all passages (frontend loads these instead of using its hardcoded
// fallback array). Admin: full CRUD via /api/admin/passages.
app.get('/api/passages', async (req, res) => {
  try {
    const all = await PassageAPI.readAll();
    res.json({ passages: all, count: all.length });
  } catch (e) {
    console.error('Read passages failed:', e.message);
    res.status(500).json({ error: 'Failed to load passages', details: e.message });
  }
});

app.get('/api/passages/:id', async (req, res) => {
  try {
    const p = await PassageAPI.getById(req.params.id);
    if (!p) return res.status(404).json({ error: 'Passage not found' });
    res.json(p);
  } catch (e) { res.status(500).json({ error: 'Read failed', details: e.message }); }
});

app.get('/api/admin/passages', requireAdmin, async (req, res) => {
  try {
    const all = await PassageAPI.readAll();
    res.json({ passages: all, count: all.length });
  } catch (e) { res.status(500).json({ error: 'Read failed', details: e.message }); }
});

app.post('/api/admin/passages', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.title || !body.text) return res.status(400).json({ error: 'title and text are required' });
    if (!body.keyElements || typeof body.keyElements !== 'object') {
      return res.status(400).json({ error: 'keyElements object is required' });
    }
    const saved = await PassageAPI.upsert(body);
    res.json({ success: true, passage: saved });
  } catch (e) {
    console.error('Save passage failed:', e.message);
    res.status(500).json({ error: 'Save failed', details: e.message });
  }
});

// v19.11: Detect when a key element has captured an EXAMPLE instead of the
// general idea. Returns an array of { element, issue } warnings for admin review.
// Non-blocking — some passages legitimately reference a proper noun. The point is
// to make a leaked example impossible to MISS, not impossible to save.
function detectExampleLeakage(keyElements) {
  const warnings = [];
  if (!keyElements || typeof keyElements !== 'object') return warnings;

  // Words that are capitalised mid-sentence but are NOT proper nouns — ignore these
  // so we don't false-positive on ordinary sentence-initial capitals.
  const COMMON = new Set(['The','A','An','This','That','These','Those','It','In','On',
    'After','Before','When','While','Each','Some','Many','Most','All','No','Their',
    'Its','As','By','For','With','From','Until','Since','If','But','And','Or','So']);

  for (const [slot, value] of Object.entries(keyElements)) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const v = value.trim();
    const issues = [];

    // 1. Explicit example markers
    if (/\b(for example|for instance|such as|in the case of|e\.g\.)\b/i.test(v)) {
      issues.push('contains an example marker ("for example"/"such as"/etc.)');
    }
    // 2. A year — almost always a specific dated event
    if (/\b(1[5-9]\d\d|20\d\d)\b/.test(v)) {
      issues.push('contains a year — likely a specific dated event, not a general idea');
    }
    // 3. A proper-noun run: 2+ capitalised tokens in sequence. Catches
    //    "Mount St. Helens", "Saturn V", and all-caps acronyms ("NASA").
    //    A token is capitalised if it starts with a capital (Helens, V) or is
    //    all-caps (NASA, SO2 is excluded as a unit below).
    const tokens = v.split(/\s+/);
    let runStart = -1, flaggedProper = null;
    for (let i = 0; i <= tokens.length; i++) {
      const tok = (tokens[i] || '').replace(/[.,;:]$/, '');
      const isCap = /^[A-Z][a-z]+$/.test(tok)        // Helens
                 || /^[A-Z]{2,}$/.test(tok)          // NASA
                 || /^[A-Z]$/.test(tok);             // V (designator)
      const isConnector = /^(of|the|and)$/i.test(tok);
      if (isCap || (runStart >= 0 && isConnector)) {
        if (runStart < 0) runStart = i;
      } else {
        if (runStart >= 0 && i - runStart >= 2) {
          const run = tokens.slice(runStart, i).join(' ');
          const first = tokens[runStart].replace(/[.,;:]$/, '');
          if (!COMMON.has(first)) { flaggedProper = run; break; }
        }
        runStart = -1;
      }
    }
    if (flaggedProper) {
      issues.push('names a specific entity (' + flaggedProper + ') — a key idea should state the general principle, not the example');
    }

    if (issues.length) {
      warnings.push({ element: slot, issue: issues.join('; '), value: v });
    }
  }
  return warnings;
}

// v19.11: Key-element extraction — Claude drafts framework + key ideas for a
// passage. Returns a DRAFT for admin review; does NOT save. The admin reviews
// the draft in the UI and saves via the normal POST /api/admin/passages.
// Body: { text: string (required), title: string (optional) }
//   OR: { id: number }  — extract for an existing passage by id
app.post('/api/admin/passages/extract', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    let text = typeof body.text === 'string' ? body.text.trim() : '';
    let title = typeof body.title === 'string' ? body.title.trim() : '';

    // If an id is given, pull the passage text from storage
    if (!text && body.id != null) {
      const existing = await PassageAPI.getById(body.id);
      if (!existing) return res.status(404).json({ error: 'Passage not found' });
      text = (existing.text || '').trim();
      title = title || (existing.title || '');
    }
    if (!text || text.length < 40) {
      return res.status(400).json({ error: 'Passage text is required (min 40 characters)' });
    }
    if (!anthropic) {
      return res.status(503).json({ error: 'Claude is not configured on this server — cannot auto-extract. Author key elements manually.' });
    }

    const draft = await extractKeyElementsWithClaude(text, title);
    if (!draft) {
      return res.status(502).json({ error: 'Extraction failed — Claude was unavailable or returned an unusable response. Try again or author manually.' });
    }
    // Package the draft with extraction metadata so the admin UI can show
    // Claude's framework choice + confidence, and save it straight through.
    draft.extractionMeta = {
      framework: draft.framework,
      confidence: draft.confidence,
      framework_reason: draft.framework_reason,
      extractedAt: new Date().toISOString()
    };
    // Safety net: scan each key element for signs it captured an EXAMPLE rather
    // than the general idea (a named event, a year, "for example"/"such as", a
    // run of capitalised proper-noun words). These are warnings for the admin to
    // review — they do NOT block saving, since some passages legitimately need a
    // proper noun. The admin sees them next to the draft.
    draft.warnings = detectExampleLeakage(draft.keyElements);
    res.json({ success: true, draft });
  } catch (e) {
    console.error('Extraction endpoint failed:', e.message);
    res.status(500).json({ error: 'Extraction failed', details: e.message });
  }
});

// v19.11: Map an extraction draft onto the passage fields that get saved.
// Mirrors the admin UI's applyDraft(): tpc topic/pivot/conclusion fold onto
// what/why/result (how left blank for tpc); wwhr maps 1:1.
function draftToPassageFields(existing, draft) {
  const ke = draft.keyElements || {};
  const keyElements = {};
  if (draft.framework === 'tpc') {
    if (ke.topic)      keyElements.what   = ke.topic;
    if (ke.pivot)      keyElements.why    = ke.pivot;
    if (ke.conclusion) keyElements.result = ke.conclusion;
  } else {
    if (ke.what)   keyElements.what   = ke.what;
    if (ke.why)    keyElements.why    = ke.why;
    if (ke.how)    keyElements.how    = ke.how;
    if (ke.result) keyElements.result = ke.result;
  }
  const out = {
    id: existing.id,
    title: existing.title,
    category: existing.category || '',
    text: existing.text,
    keyElements,
    sampleResponse: draft.sampleResponse || existing.sampleResponse || '',
    sampleNotes: existing.sampleNotes || ''
  };
  if (draft.keyElementsRationale && Object.keys(draft.keyElementsRationale).length) {
    out.keyElementsRationale = draft.keyElementsRationale;
  }
  if (draft.extractionMeta) out.extractionMeta = draft.extractionMeta;
  return out;
}

// v19.11: BULK extraction — full auto. Extracts every passage, applies and saves
// each result immediately (no review gate). Returns a per-passage report so the
// admin can SEE afterward what happened — especially which passages tripped the
// example-leakage detector. The report does not block anything; it is a receipt.
// Body: { onlyMissing: bool }  — if true, skip passages that already have rationale
app.post('/api/admin/passages/extract-all', requireAdmin, async (req, res) => {
  if (!anthropic) {
    return res.status(503).json({ error: 'Claude is not configured — cannot auto-extract.' });
  }
  try {
    const onlyMissing = !!(req.body && req.body.onlyMissing);
    const all = await PassageAPI.readAll();
    const report = { total: all.length, updated: 0, skipped: 0, failed: 0,
                     flagged: 0, items: [] };

    for (const p of all) {
      const text = (p.text || '').trim();
      const item = { id: p.id, title: p.title || ('Passage ' + p.id) };

      if (onlyMissing && p.keyElementsRationale &&
          (p.keyElementsRationale.topic || p.keyElementsRationale.importance)) {
        item.status = 'skipped'; item.reason = 'already has rationale';
        report.skipped++; report.items.push(item); continue;
      }
      if (text.length < 40) {
        item.status = 'failed'; item.reason = 'passage text too short';
        report.failed++; report.items.push(item); continue;
      }

      let draft = null;
      try {
        draft = await extractKeyElementsWithClaude(text, p.title || '');
      } catch (e) {
        draft = null; item.reason = e.message;
      }
      if (!draft) {
        item.status = 'failed';
        item.reason = item.reason || 'Claude returned an unusable response';
        report.failed++; report.items.push(item); continue;
      }

      draft.extractionMeta = {
        framework: draft.framework,
        confidence: draft.confidence,
        framework_reason: draft.framework_reason,
        extractedAt: new Date().toISOString()
      };
      const warnings = detectExampleLeakage(draft.keyElements);

      // Full auto: apply + save immediately.
      try {
        const fields = draftToPassageFields(p, draft);
        await PassageAPI.upsert(fields);
        item.status = 'updated';
        item.framework = draft.framework;
        item.confidence = draft.confidence;
        item.warnings = warnings;
        if (warnings.length) report.flagged++;
        report.updated++;
      } catch (e) {
        item.status = 'failed'; item.reason = 'save failed: ' + e.message;
        report.failed++;
      }
      report.items.push(item);
    }

    console.log(`📋 Bulk extraction: ${report.updated} updated, ${report.flagged} flagged, ${report.failed} failed, ${report.skipped} skipped`);
    res.json({ success: true, report });
  } catch (e) {
    console.error('Bulk extraction failed:', e.message);
    res.status(500).json({ error: 'Bulk extraction failed', details: e.message });
  }
});

app.delete('/api/admin/passages/:id', requireAdmin, async (req, res) => {
  try {
    const ok = await PassageAPI.remove(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Passage not found' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Delete failed', details: e.message }); }
});

// Bulk import (used to migrate from hardcoded → server-managed in one go)
app.post('/api/admin/passages/bulk', requireAdmin, async (req, res) => {
  try {
    const arr = Array.isArray(req.body?.passages) ? req.body.passages : null;
    if (!arr) return res.status(400).json({ error: 'passages array required' });
    const cleaned = arr.map(p => PassageAPI._sanitize(p));
    await PassageAPI.writeAll(cleaned);
    res.json({ success: true, count: cleaned.length });
  } catch (e) { res.status(500).json({ error: 'Bulk import failed', details: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// KEY-ELEMENT EXTRACTION (v19.11) — Claude drafts the framework + key ideas
// for a passage. Runs ONCE at authoring time (admin action), not per submission.
// The output is a DRAFT — the admin reviews and approves before it goes live.
//
// Returns:
//   {
//     framework: 'wwhr' | 'tpc',
//     framework_reason: string,
//     confidence: 'high' | 'medium' | 'low',
//     keyElements: { what,why,how,result }  OR  { topic,pivot,conclusion },
//     keyElementsRationale: { topic, importance, elements:{...} },
//     sampleResponse: string,
//     source: 'claude'
//   }
// Returns null if Claude is unavailable or the response can't be parsed.
// ═══════════════════════════════════════════════════════════════════════════════
async function extractKeyElementsWithClaude(passageText, passageTitle, timeoutMs = 25000) {
  if (!anthropic) return null;
  const title = (passageTitle || '').trim();
  const text = (passageText || '').trim();
  if (text.length < 40) return null;

  const prompt = `You are an expert PTE Academic item writer. Your job: read a passage and identify the KEY IDEAS a student must capture to write a high-scoring one-sentence Summarize Written Text (SWT) response.

PASSAGE${title ? ' — "' + title + '"' : ''}:
"""
${text}
"""

STEP 1 — CHOOSE THE FRAMEWORK.
Decide which of two structures the passage actually has:

• "tpc" (Topic / Pivot / Conclusion) — use ONLY if the passage HINGES ON A TURN: an
  argument that reverses or complicates itself. Signals: "but", "however", "despite",
  "once thought ... now", "although". The pivot IS the point of the passage.
  3 key ideas: topic (the initial position), pivot (the turn/complication),
  conclusion (where it lands).

• "wwhr" (What / Why / How / Result) — use for EXPOSITORY passages that BUILD rather
  than turn: present a thing, explain its importance, describe the mechanism, state
  the outcome. Most science, business, and process passages.
  4 key ideas: what (central claim), why (reason/evidence it matters),
  how (mechanism/process), result (consequence/implication).

Pick the one that loses the LEAST meaning. State which and why.

STEP 2 — EXTRACT THE KEY IDEAS.

Each key idea must STAY CLOSE TO THE PASSAGE'S OWN WORDING. Do NOT freely paraphrase
or re-express the idea in your own words. Find the sentence (or the part of a
sentence) in the passage that states the idea, and use that wording — lightly
trimmed, not rewritten.

HOW to phrase each key element:
- Locate the passage sentence that carries the idea.
- Quote its substance using the passage's own words and phrasing.
- You MAY trim it: drop a lead-in clause, drop a trailing example, cut it to the
  load-bearing core. You may NOT swap in synonyms or restructure it.
- The result should read like a faithful condensation of a real passage sentence,
  not a fresh sentence you wrote. If you re-extracted the same passage twice, both
  results should be nearly identical because both are anchored to the same text.

CRITICAL RULES:
- A key idea is a GENERAL claim the summary would be WRONG or INCOMPLETE without.
- Quotes, rhetorical questions, and vivid statistics that merely ILLUSTRATE a claim
  already counted are DECORATION — do not make them key ideas.

- NEVER let an EXAMPLE be the key idea. A passage states a general principle and then
  ILLUSTRATES it with a specific case — a named event, a dated incident, a particular
  study, a single person or place. The KEY IDEA is the general principle.
  This is the ONE case where you trim rather than copy whole: if the passage sentence
  is "After the 1980 Mount St. Helens eruption, monitoring of seismic energy, tilt and
  SO2 enabled accurate prediction", you KEEP the general clause in the passage's words
  — "monitoring of seismic energy, tilt and SO2 enables accurate prediction" — and
  DROP only the dated-example lead-in. You are still using the passage's wording; you
  are just cutting the example clause out of it.
  If you find a year, a place name, a person's name, or "for example / for instance /
  such as / in the case of" inside a key idea, cut that clause — but keep the rest of
  the sentence verbatim. Do not rewrite the surviving part.
  A student who summarises the general principle WITHOUT naming the specific example
  must score full marks for that element.

- The test: "if a reader had ONLY these key ideas, would they understand the passage's
  actual argument?" — not "would they find it interesting", and not "do they know
  the specific examples".

STEP 3 — JUSTIFY.
For each key idea, give one sentence explaining why it is load-bearing AND, where
relevant, which competing sentence (or which example) it was chosen OVER.

STEP 4 — RATE YOUR CONFIDENCE.
"high" = the structure is unambiguous. "medium" = reasonable editors might carve it
slightly differently. "low" = genuinely murky — flag for careful human review.

STEP 5 — WRITE A MODEL ANSWER.
One sentence, 30-50 words, that captures every key idea using academic connectors
(however / moreover / therefore). This is the Band-90 sample.

Respond with ONLY this JSON, no other text:
{
  "framework": "wwhr" OR "tpc",
  "framework_reason": "one sentence on why this framework fits",
  "confidence": "high" OR "medium" OR "low",
  "keyElements": {
    // if wwhr: "what","why","how","result"  — if tpc: "topic","pivot","conclusion"
    "what": "short phrase naming the idea"
  },
  "keyElementsRationale": {
    "topic": "2-3 sentences: what the passage is about and how it is structured",
    "importance": "2-3 sentences: why THESE sentences are load-bearing and which kinds of sentences in this passage are decoration",
    "elements": {
      // same keys as keyElements; each value = one sentence on why that element matters
      "what": "why this element is load-bearing, and what it was chosen over"
    }
  },
  "sampleResponse": "one-sentence Band-90 model answer, 30-50 words"
}`;

  try {
    const callPromise = anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    });
    const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error('extraction timeout')), timeoutMs));
    const response = await Promise.race([callPromise, timeoutPromise]);
    const raw = response.content?.[0]?.text || '';
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);

    // ── Validate + normalise ──
    const framework = (parsed.framework === 'tpc') ? 'tpc' : 'wwhr';
    const validKeys = framework === 'tpc'
      ? ['topic','pivot','conclusion']
      : ['what','why','how','result'];

    const ke = {};
    for (const k of validKeys) {
      if (parsed.keyElements && typeof parsed.keyElements[k] === 'string' && parsed.keyElements[k].trim()) {
        ke[k] = parsed.keyElements[k].trim();
      }
    }
    // If Claude returned the wrong-schema keys, the extraction is unusable.
    if (Object.keys(ke).length < (framework === 'tpc' ? 3 : 4)) {
      console.error('Extraction: incomplete keyElements for framework', framework, '— got', Object.keys(ke));
      return null;
    }

    const rationale = {};
    const pr = parsed.keyElementsRationale || {};
    if (typeof pr.topic === 'string')      rationale.topic = pr.topic.trim().slice(0, 2000);
    if (typeof pr.importance === 'string') rationale.importance = pr.importance.trim().slice(0, 2000);
    if (pr.elements && typeof pr.elements === 'object') {
      rationale.elements = {};
      for (const k of validKeys) {
        if (typeof pr.elements[k] === 'string') rationale.elements[k] = pr.elements[k].trim().slice(0, 1000);
      }
    }

    return {
      framework,
      framework_reason: typeof parsed.framework_reason === 'string' ? parsed.framework_reason.trim() : '',
      confidence: ['high','medium','low'].includes(parsed.confidence) ? parsed.confidence : 'medium',
      keyElements: ke,
      keyElementsRationale: rationale,
      sampleResponse: typeof parsed.sampleResponse === 'string' ? parsed.sampleResponse.trim() : '',
      source: 'claude'
    };
  } catch (e) {
    console.error('Key-element extraction failed:', e.message);
    return null;
  }
}


// Per real-exam feedback: content (correct idea selection) is THE primary
// determinant. Wrong ideas → severe ceiling. Correct ideas + academic synonyms
// → reach Band 9 / PTE 90. Verbatim with good connectors stays at Writing 90
// but caps Reading around 55–65 unless academic synonyms are added.
// ═══════════════════════════════════════════════════════════════════════════════
// ─── KEY ELEMENT CONDENSER (v19.8.1) ────────────────────────────────────────
// PTE passages often have key elements written as full sentences with
// supporting context: "He was familiar with the minor disadvantages of country
// living such as uncertain water supply and lack of central heating."
//
// The capture-worthy part — the headline — is "He was familiar with the minor
// disadvantages of country living". The "such as ... and ..." tail is supporting
// detail. A student capturing only the headline should earn full credit, but
// Claude tends to judge against the full text and report "missing" when the
// tail isn't conveyed.
//
// This helper extracts just the headline by splitting on the FIRST joining
// marker that introduces supporting context. The full original text is also
// retained and shown to Claude as supporting context — Claude judges against
// the HEADLINE only.
function condenseKeyElement(text) {
  if (!text) return { headline: '', full: '', wasCondensed: false };
  const t = String(text).trim();
  // Order matters: more specific markers first. Patterns that introduce
  // examples or supporting detail vs patterns joining two co-equal clauses.
  const splitters = [
    /,\s+such\s+as\s+/i,              // "X, such as Y" → headline = X
    /\s+such\s+as\s+/i,               //  "X such as Y" (no comma) → same
    /,\s+including\s+/i,
    /,\s+like\s+/i,
    /,\s+for\s+example\b/i,
    /,\s+e\.?g\.?\s+/i,
    /,\s+with\s+/i,                   // "X, with Y" (e.g., "smooth, with setbacks like...")
    /;\s*moreover\b/i,
    /;\s*furthermore\b/i,
    /;\s*and\b/i,
    /,\s+and\s+/i,                    // Oxford-comma joining two clauses
    /\s+;\s+/,
  ];
  for (const re of splitters) {
    const m = t.match(re);
    if (m && m.index > 20) {
      return { headline: t.slice(0, m.index).trim(), full: t, wasCondensed: true };
    }
  }
  return { headline: t, full: t, wasCondensed: false };
}

function formatKeyElementsHint(keyElements) {
  if (!keyElements) return '';
  const parts = [];
  const fieldOrder = [
    ['what','What'], ['why','Why'], ['how','How'], ['result','Result'],
    ['topic','Topic'], ['pivot','Pivot'], ['conclusion','Conclusion']
  ];
  // Only emit fields the passage actually has, deduping the new + legacy schemas
  const seen = new Set();
  for (const [k, label] of fieldOrder) {
    if (!keyElements[k]) continue;
    if (k === 'topic'      && (keyElements.what    || seen.has('what')))   continue;
    if (k === 'pivot'      && (keyElements.why     || seen.has('why')))    continue;
    if (k === 'conclusion' && (keyElements.result  || seen.has('result'))) continue;
    seen.add(k);
    const c = condenseKeyElement(stripHtml(keyElements[k]));
    if (c.wasCondensed) {
      // Show HEADLINE prominently + the supporting detail in parentheses, so
      // Claude knows what's required (headline) vs what's optional (detail).
      parts.push(`- ${label}: ${c.headline}\n    (supporting detail in passage — not required for capture: ${c.full.slice(c.headline.length).replace(/^[,;\s]+/, '')})`);
    } else {
      parts.push(`- ${label}: ${c.full}`);
    }
  }
  return parts.join('\n');
}

async function judgeContentWithClaude(studentText, passageText, keyElements, timeoutMs = 12000) {
  if (!anthropic) return null;
  const kpHint = formatKeyElementsHint(keyElements);
  const totalIdeas = countKeyElements(keyElements);

  const prompt = `You are a strict but fair PTE Academic Summarize Written Text scorer. Score this one-sentence summary across three dimensions AND suggest context-appropriate vocabulary swaps.

PASSAGE:
${passageText}

STUDENT SUMMARY:
${studentText}

${kpHint ? 'KEY IDEAS THE PASSAGE CONVEYS (this passage has exactly ' + totalIdeas + ' key idea' + (totalIdeas !== 1 ? 's' : '') + '):\n' + kpHint + '\n' : ''}
EVALUATE:
1. CONTENT COVERAGE — For each of the ${totalIdeas} key ideas, judge how well the student conveyed its CORE meaning. This produces a per-idea score that sums to content_score.
2. SYNONYM APPROPRIATENESS — If the student replaced words from the passage, are substitutes meaning-preserving and register-appropriate? VERBATIM COPYING IS ACCEPTABLE — do NOT penalise it. PHRASE-LIFTING IS ALSO ACCEPTABLE — students may select key phrases from the passage (rather than full sentences) and stitch them together with their own connectors. Do NOT penalise this style; judge purely on whether the resulting summary is coherent and faithful to the passage.
3. COHESION — BE STRICT. Ideas must connect logically through proper connectors (however/moreover/therefore/furthermore/consequently). Listed-out facts with no logical glue is "weak" cohesion even if commas separate them. Connectors must signal the actual relationship: "however" only for contrast, "moreover/furthermore" only for addition, "therefore/consequently" only for cause-effect. A misused connector → "weak". Two clauses jammed with "and" or comma-spliced → "weak". Only "strong" when each connective genuinely reflects the relationship between the ideas it links.

CONTENT SCORING — binary capture per idea (PTE Pearson rubric):

For EACH key idea above, assign a per-idea score:
  • 1.0  — CAPTURED. The student's summary conveys the central claim/headline of this idea. Paraphrasing IS capture. Omitting supporting detail (dates, names, examples, secondary clauses) is fine — the headline is what counts.
  • 0.0  — MISSING. The idea is not conveyed at all, or has been replaced by unrelated/fabricated content.

Use 1.0 generously when the student has clearly attempted the idea, even if the wording differs from the passage. PTE does NOT use partial credit — it's binary. When in doubt, score 1.0.

Then content_score = SUM of per-idea scores (range 0–${totalIdeas}).

CAPTURE PHILOSOPHY — read this carefully:
The KEY IDEAS above are written as full sentences with headline + supporting context. A student who captures the HEADLINE earns 1.0 even without the supporting context. Examples of captured (1.0):
  • Key idea: "Progress was not entirely smooth, with setbacks like the South Sea Bubble of 1720"
    Student wrote: "the progress was not completely smooth"  →  1.0 (headline captured; the date is supporting detail).
  • Key idea: "He was familiar with the minor disadvantages of country living such as uncertain water supply and lack of central heating"
    Student wrote: "he was aware of the minor downsides of country living"  →  1.0 (headline captured; the examples are supporting detail).
  • Key idea: "He has altered the way people think as well as the way they live, like other revolutionary scientists"
    Student wrote: "has changed the world more than anyone in the past century"  →  1.0 (same headline meaning).
  • Key idea: "He persuaded his wife that exchanging the town house for a farm cottage on a lower income was a good idea"
    Student wrote: "he tried to convince his wife that exchanging town house for farm cottage was a good idea"  →  1.0 ("tried to convince" = "persuaded"; same idea).
  • Key idea: "The UK's financial hub has overtaken New York rivals in funds managed and holds 70% of bond markets"
    Student wrote: "the United Kingdom's financial hub has overtaken their New York rivals in terms of funds managed"  →  1.0 (headline captured; the 70% figure is supporting detail).
  • Key idea: "Tourism employs a large proportion of women, minority groups and young people"
    Student wrote: "the sector employs many women, minority groups and young people"  →  1.0.

Examples of missing (0.0):
  • Key idea: "The financial hub has overtaken New York rivals in funds managed"
    Student wrote: nothing about overtaking NY or financial dominance  →  0.0.
  • Student replaces an idea with fabricated content not in the passage  →  0.0.

OUTPUT REQUIREMENTS:
- per_idea_scores: object mapping each idea label (what/why/how/result OR topic/pivot/conclusion) to its score (1.0 or 0.0).
- ideas_captured: labels with score 1.0.
- ideas_missing: labels with score 0.0.
- length(ideas_captured) + length(ideas_missing) MUST equal ${totalIdeas}.
- content_score: SUM of per_idea_scores values (this equals length(ideas_captured)).

CRITICAL RULES (do not break these):
1. An idea is "captured" (1.0) when its CORE/HEADLINE meaning is present — paraphrasing is fine, omitting supporting detail is fine. Be generous: when in doubt, score 1.0.
2. If the student replaces a passage idea with different content (even if grammatically fluent), score 0.0 — fluency does not rescue missing content.
3. If the summary is off-topic or gibberish, every per_idea_score is 0.0.

- synonym_appropriateness "appropriate": all swaps preserve meaning and academic register, OR no swaps were made (verbatim).
- synonym_appropriateness "some_inappropriate": one or more swaps are awkward, wrong register, or shift connotation.
- synonym_appropriateness "meaning_changed": a swap reverses or significantly alters the passage meaning.
- synonym_appropriateness "no_swaps": pure verbatim with zero substitution (still acceptable).
- academic_register: true if the summary uses 2+ recognisably academic/formal words (e.g., consequently, substantial, demonstrate, comprehensive).

VOCABULARY SWAP SUGGESTIONS (recommended_swaps) — VERY IMPORTANT, ALWAYS REQUIRED:
You MUST return 7 to 8 word/phrase suggestions from the STUDENT SUMMARY. This is not
optional and not conditional on the summary's quality — EVERY summary, however
strong, has 7-8 words whose register or precision can be varied. Returning fewer
than 7 is a failure of this task. Returning an empty list is never acceptable.

How to always find 7-8:
- Scan the summary left to right. For EVERY verb, common noun, adjective, and
  adverb, ask "is there an academic synonym that fits this exact context?" — there
  almost always is.
- This includes words that are ALREADY reasonably academic. Offering a lateral
  alternative (e.g. "achieved" → "attained / reached", "shows" → "demonstrates /
  indicates / reveals", "reduce" → "lower / curtail / cut") still helps the student.
- A heavily passage-lifted summary still qualifies: suggest swaps for the lifted
  words so the student learns to paraphrase rather than copy.

The CONTEXT MUST FIT — re-read the sentence with each synonym mentally; only include
synonyms that read fluently and preserve meaning exactly.

Rules for each suggested word:
- It can be ANY word the student used (verb, noun, adjective, adverb).
- Skip ONLY: proper nouns, dates, numbers, domain-fixed technical terms, fixed
  multi-word phrases, connectors already in use, and articles/prepositions.
- Provide 2 to 5 academic synonyms per word — the student picks which fits best.
- Each synonym MUST fit the EXACT context of the sentence.

GOOD examples (context-appropriate):
- "made a lifestyle choice" → word: "made", synonyms: ["opted for", "chose", "selected"] ✓
- "wanted information in one place" → word: "wanted", synonyms: ["sought", "needed", "required"] ✓
- "many advantages" → word: "many", synonyms: ["numerous", "several", "multiple"] ✓
- "good idea" → word: "good", synonyms: ["beneficial", "sound", "sensible", "prudent"] ✓
- "big problem" → word: "big", synonyms: ["significant", "substantial", "considerable"] ✓
- "AI has achieved high accuracy" → word: "achieved", synonyms: ["attained", "reached"] ✓
- "growing concerns" → word: "growing", synonyms: ["mounting", "rising", "increasing"] ✓
- "show that" → word: "show", synonyms: ["demonstrate", "indicate", "reveal"] ✓
- "reduce costs" → word: "reduce", synonyms: ["lower", "cut", "curtail"] ✓

BAD examples to AVOID:
- "wanted information" → DO NOT suggest ["hot", "cherished", "treasured"] — wrong register
- "make a choice" → DO NOT suggest ["create"] for "make" — different sense
- DO NOT suggest synonyms that are too rare, archaic, or jarring in academic English
- DO NOT suggest a synonym that subtly shifts meaning

TARGET: exactly 7-8 word suggestions, each with 2-5 fitting synonyms. If you think
you can only find 4, look again at the verbs and adjectives you skipped.


Respond ONLY with valid JSON, no other text. Use this exact structure:
{
  "per_idea_scores": { "what": 1.0, "why": 1.0, "how": 1.0, "result": 0.0 },
  "content_score": 3,
  "content_reason": "one short sentence summarising overall coverage",
  "ideas_captured": ["what", "why", "how"],
  "ideas_missing": ["result"],
  "synonym_appropriateness": "appropriate",
  "synonym_issues": [],
  "cohesion": "strong",
  "academic_register": false,
  "feedback_note": "one short sentence of actionable feedback",
  "recommended_swaps": [
    { "word": "made", "context": "made a lifestyle choice", "synonyms": ["opted for", "decided on", "selected"], "rationale": "Academic register lifts Reading skill" }
  ]
}

Notes on the schema:
- per_idea_scores keys: only the labels actually present in the KEY IDEAS above (what/why/how/result OR topic/pivot/conclusion).
- per_idea_scores values: ONLY 1.0 (captured) or 0.0 (missing). Do NOT use 0.5 or other fractional values.
- content_score: SUM of per_idea_scores values (equals length(ideas_captured)).
- ideas_captured / ideas_missing: lengths must sum to ${totalIdeas}.`;

  try {
    const callPromise = anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1400,
      messages: [{ role: 'user', content: prompt }]
    });
    const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error('Claude judge timeout')), timeoutMs));
    const response = await Promise.race([callPromise, timeoutPromise]);
    const text = response.content?.[0]?.text || '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    parsed.source = 'claude';
    // Sanity-clamp content_score
    if (typeof parsed.content_score !== 'number' || parsed.content_score < 0 || parsed.content_score > 2) {
      parsed.content_score = 1;
    }
    return parsed;
  } catch (e) {
    console.error('Claude content judge failed:', e.message);
    return null;
  }
}

function judgeContentLocal(studentText, passageText, keyElements, grammarHint) {
  // Build field list from whichever schema is present
  const fields = [];
  if (keyElements?.what)       fields.push({ name: 'what',       text: stripHtml(keyElements.what) });
  if (keyElements?.why)        fields.push({ name: 'why',        text: stripHtml(keyElements.why) });
  if (keyElements?.how)        fields.push({ name: 'how',        text: stripHtml(keyElements.how) });
  if (keyElements?.result)     fields.push({ name: 'result',     text: stripHtml(keyElements.result) });
  if (fields.length === 0) {
    if (keyElements?.topic)      fields.push({ name: 'topic',      text: stripHtml(keyElements.topic) });
    if (keyElements?.pivot)      fields.push({ name: 'pivot',      text: stripHtml(keyElements.pivot) });
    if (keyElements?.conclusion) fields.push({ name: 'conclusion', text: stripHtml(keyElements.conclusion) });
  }

  // ── v19.5: heuristic cohesion detection for local mode ──
  // Cohesion was always 'moderate' in v19.4, which meant the cohesion gate
  // never fired without Claude. Now we infer cohesion from grammar signals:
  //   - missing connector → 'weak' (Pearson penalises listed-out facts)
  //   - connector without semicolon → 'moderate' (partial credit)
  //   - 3+ "and" joins without a connector → 'weak'
  //   - perfect connector + semicolon → 'strong'
  let cohesion = 'moderate';
  if (grammarHint) {
    const ql = grammarHint.connector_quality;
    if (ql === 'perfect') cohesion = 'strong';
    else if (ql === 'partial') cohesion = 'moderate';
    else cohesion = 'weak'; // 'missing'
  }
  // Additional weak-cohesion signal: too many " and " joins without a connector
  // (e.g., "X and Y and Z and W") — a classic Band 5–6 listed-out style.
  const lower = (studentText || '').toLowerCase();
  const andJoins = (lower.match(/\sand\s/g) || []).length;
  const hasAnyConnector = /(however|moreover|furthermore|therefore|consequently|whereas|although|nevertheless)/i.test(studentText || '');
  if (andJoins >= 3 && !hasAnyConnector) cohesion = 'weak';

  if (fields.length === 0) {
    return {
      content_score: 1,
      content_reason: 'No key elements provided — neutral local score',
      ideas_captured: [], ideas_missing: [],
      synonym_appropriateness: 'no_swaps',
      synonym_issues: [], cohesion, academic_register: false,
      feedback_note: 'Content judged locally without key element data',
      source: 'local_fallback'
    };
  }

  const checks = fields.map(f => ({ name: f.name, ...checkKeyPoint(studentText, f.text) }));
  const present = checks.filter(c => c.present).map(c => c.name);
  const missing = checks.filter(c => !c.present).map(c => c.name);

  // v19.4: content_score is literally the number of captured ideas (0..N).
  const score = present.length;
  const max = fields.length;

  return {
    content_score: score,
    content_max: max,
    content_reason: missing.length === 0
      ? `All ${max} main ideas captured (local check)`
      : `${score}/${max} main ideas captured — missing: ${missing.join(', ')}`,
    ideas_captured: present,
    ideas_missing: missing,
    synonym_appropriateness: 'no_swaps',  // local can't judge — defer to swap analysis
    synonym_issues: [],
    cohesion,
    academic_register: false,
    feedback_note: missing.length > 0 ? `Include the missing ideas: ${missing.join(', ')}` : 'Good content coverage',
    source: 'local_fallback'
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FEEDBACK BUILDERS v2
// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// FEEDBACK CARD v3 — structured feedback that mirrors the v19 scoring philosophy.
//
// Returns:
//   { verdict, strengths[], improvements[], method_coaching, summary_line }
//
// - verdict.tier: excellent | good | partial | fail | invalid
// - strengths: green check items (what worked)
// - improvements: priority-sorted action items (1=critical, 4=polish)
// - method_coaching: path-specific guidance (Verbatim vs Paraphrased)
// - summary_line: single-line backwards-compatible feedback string
// ═══════════════════════════════════════════════════════════════════════════════
function buildFeedbackCard(contentVerdict, grammar, vocab, firstPerson, form, spelling, rawScore, contentScore, grammarScore, llmJudgment, contentMax, maxRaw) {
  // v19.4: support dynamic content/raw ranges. Default to legacy 0–2 / 0–7 if
  // a caller hasn't been updated yet (back-compat for buildFeedback alias).
  const cMax = (typeof contentMax === 'number' && contentMax > 0) ? contentMax : 2;
  const rMax = (typeof maxRaw === 'number' && maxRaw > 0) ? maxRaw : 7;
  const pte  = rawToPTEDynamic(rawScore, rMax);
  const band = rawToBandDynamic(rawScore, rMax);
  const rawRatio     = rawScore / rMax;
  const contentRatio = contentScore / cMax;
  const contentFull    = contentScore >= cMax;
  const contentPartial = contentScore > 0 && contentScore < cMax;
  const contentNone    = contentScore === 0;

  // ── VERDICT ──────────────────────────────────────────────────────────────
  // v19.8: partial-credit messaging removed — PTE Pearson uses binary capture
  // per idea. The verdict says only what the score is and what to fix.
  let tier, headline;
  if (form && !form.valid) {
    tier = 'invalid';
    headline = `Form failed — ${form.reason}`;
  } else if (contentNone) {
    tier = 'fail';
    headline = 'The main ideas were not captured. Re-read the passage and identify What, Why, How and the Result.';
  } else if (rawRatio >= 0.93) {
    tier = 'excellent';
    const methodLabel = vocab.method === 'paraphrased' ? 'Paraphrased Method'
                      : vocab.method === 'verbatim' ? 'Verbatim Method'
                      : vocab.method === 'phrase_picking' ? 'Phrase-Picking Method'
                      : 'a strong hybrid approach';
    headline = `Excellent — ${band} (PTE ${pte}) achieved via the ${methodLabel}.`;
  } else if (rawRatio >= 0.79) {
    tier = 'good';
    headline = `Solid attempt — ${band} (PTE ${pte}). One or two changes will push this to Band 9.`;
  } else if (rawRatio >= 0.50) {
    tier = 'partial';
    headline = `${band} (PTE ${pte}). Significant gaps to close.`;
  } else {
    tier = 'fail';
    headline = `${band} (PTE ${pte}) — major gaps. Focus on capturing the main ideas first.`;
  }

  const verdict = { tier, headline, pte, band, raw: rawScore, raw_max: rMax, content_max: cMax, method: vocab.method };

  // ── STRENGTHS ────────────────────────────────────────────────────────────
  const strengths = [];

  // v19.8: binary capture — no partial tier in messaging.
  const fullyCaptured = contentVerdict.ideas_captured || [];

  if (contentFull && cMax > 0) {
    strengths.push({ icon: '🎯', label: `All ${cMax} main ideas captured`, detail: fullyCaptured.join(' · ') });
  } else if (fullyCaptured.length > 0) {
    strengths.push({
      icon: '✓',
      label: `Captured ${fullyCaptured.length}/${cMax} main idea${fullyCaptured.length > 1 ? 's' : ''}`,
      detail: fullyCaptured.join(' · ')
    });
  }

  if (grammar.has_connector && grammar.connector_quality === 'perfect') {
    strengths.push({ icon: '🔗', label: `Connector + semicolon: "; ${grammar.connector_used},"`, detail: 'Clauses are properly chained.' });
  } else if (grammar.has_connector) {
    strengths.push({ icon: '🔗', label: `Connector used: "${grammar.connector_used}"`, detail: '' });
  }

  if (vocab.method === 'paraphrased' && !vocab.meaning_changed) {
    strengths.push({ icon: '📚', label: `${vocab.effective_credit} synonym swap${vocab.effective_credit > 1 ? 's' : ''} — Paraphrased Method`, detail: (vocab.safe_swaps || []).slice(0, 3).map(s => `${s.original}→${s.replacement}`).join(', ') });
  } else if (vocab.method === 'verbatim' && grammar.has_connector) {
    strengths.push({ icon: '📋', label: 'Verbatim Method executed correctly', detail: 'Passage lines + connector chain. Note: Reading skill caps moderate without academic synonyms.' });
  }

  if (vocab.academic_words && vocab.academic_words.length >= 2) {
    strengths.push({ icon: '🎓', label: 'Academic vocabulary detected', detail: vocab.academic_words.slice(0, 4).join(', ') });
  }

  if (firstPerson && firstPerson.hasPerspectiveShift) {
    strengths.push({ icon: '👁️', label: 'Third-person perspective', detail: 'Correct academic register.' });
  }

  if (llmJudgment && llmJudgment.cohesion === 'strong') {
    strengths.push({ icon: '✓', label: 'Clauses connect logically', detail: 'AI judge confirmed strong cohesion.' });
  }

  if (form && form.valid && form.wc >= 35 && form.wc <= 65) {
    strengths.push({ icon: '📝', label: `Word count in sweet spot (${form.wc} words)`, detail: '' });
  }

  // ── IMPROVEMENTS ─────────────────────────────────────────────────────────
  const improvements = [];

  // Form failures absorb everything — return early with just the form fix
  if (form && !form.valid) {
    improvements.push({
      priority: 1,
      icon: '🚨',
      action: form.reason,
      detail: 'Write exactly one sentence between 5 and 75 words, ending in a period. Aim for 35–65 words.'
    });
    return {
      verdict, strengths, improvements,
      method_coaching: null,
      summary_line: `FORM ERROR: ${form.reason}`
    };
  }

  // Priority 1 — content (v19.8: binary — only missing ideas surface here)
  const missingArr = contentVerdict.ideas_missing || [];
  if (contentNone) {
    improvements.push({
      priority: 1,
      icon: '🚨',
      action: 'Re-read the passage and capture the main ideas',
      detail: `Identify each of the ${cMax} key ideas (What/Why/How/Result). Missing all ideas heavily caps the score (PTE 15 max).`
    });
  } else if (missingArr.length > 0) {
    const capPte = contentRatio <= 0.5 ? 50 : contentRatio <= 0.75 ? 65 : 79;
    improvements.push({
      priority: 1,
      icon: '⚠️',
      action: `Add the missing idea${missingArr.length > 1 ? 's' : ''}: ${missingArr.join(', ')}`,
      detail: `You captured ${contentScore}/${cMax}. Score is currently capped at PTE ${capPte} until all main ideas are included.`
    });
  }

  // Priority 1 — meaning changed
  if (vocab.meaning_changed) {
    const danger = (vocab.dangerous_swaps || [])[0];
    improvements.push({
      priority: 1,
      icon: '⚠️',
      action: danger ? `"${danger.original}" → "${danger.replacement}" reverses the meaning` : 'A synonym you used reverses the meaning',
      detail: 'Pick substitutes that preserve the original sense. "minor → small" is OK; "minor → major" is wrong.'
    });
  }

  // Priority 2 — grammar / connector
  if (!grammar.has_connector) {
    improvements.push({
      priority: 2,
      icon: '🔗',
      action: 'Add a connector to chain your clauses',
      detail: 'Use ; however, ; moreover, ; therefore, ; furthermore, — these signal logical connection between ideas. Without them, the summary reads as a list.'
    });
  } else if (grammar.connector_quality === 'partial') {
    improvements.push({
      priority: 2,
      icon: '🔗',
      action: `Add a semicolon before "${grammar.connector_used}"`,
      detail: `Write: "; ${grammar.connector_used}," to mark the clause boundary.`
    });
  }

  // Priority 2 — cohesion (LLM-flagged)
  if (llmJudgment && llmJudgment.cohesion === 'weak') {
    improvements.push({
      priority: 2,
      icon: '🧩',
      action: 'Clauses do not connect logically',
      detail: 'Each connector should signal a real relationship: "however" for contrast, "moreover" for addition, "therefore" for consequence.'
    });
  }

  // Priority 3 — vocabulary (boost Reading skill) — v19.2: target 2-3 swaps (was 4)
  if (vocab.effective_credit < 2 && contentScore >= 1 && !vocab.meaning_changed) {
    const need = Math.max(1, 2 - vocab.effective_credit);
    improvements.push({
      priority: 3,
      icon: '📚',
      action: `Replace ${need} more common word${need > 1 ? 's' : ''} with academic synonyms (target: 2–3)`,
      detail: 'Boosts Reading skill toward 90. Examples: made → opted, good → beneficial, important → crucial, change → transformation, show → demonstrate.'
    });
  } else if (vocab.effective_credit >= 2 && vocab.effective_credit < 3 && contentScore >= 1 && !vocab.meaning_changed) {
    improvements.push({
      priority: 4,
      icon: '📚',
      action: 'Optional: 1 more academic swap to fully secure Reading 90',
      detail: 'You already have 2 swaps which qualifies for Paraphrased Method — one more pushes Reading to the very top.'
    });
  }

  // Priority 3 — inappropriate synonyms (LLM-flagged)
  if (vocab.inappropriate_count > 0) {
    const issues = (llmJudgment?.synonym_issues || []).slice(0, 2).join('; ');
    improvements.push({
      priority: 3,
      icon: '📖',
      action: 'Some synonym choices are slightly off',
      detail: issues || 'Pick closer-sense or more register-appropriate substitutes.'
    });
  }

  // Priority 4 — first-person shift
  if (firstPerson && firstPerson.isProblematic) {
    const issues = (firstPerson.issues || []).slice(0, 2).map(i => `"${i.match}"`).join(', ');
    improvements.push({
      priority: 4,
      icon: '👁️',
      action: 'Shift first-person to third-person',
      detail: `Change ${issues || '"I made"'} → "the author made", "my wife" → "his wife", "we" → "they".`
    });
  }

  // Priority 4 — spelling (v19.6: penalty scales 0.25/0.5/0.75/1.0)
  if (spelling && spelling.count > 0) {
    const penalty = Math.min(1.0, 0.25 * spelling.count);
    const hints = (spelling.suggestions || []).slice(0, 3).map(s => `"${s.misspelled}" → "${s.suggestion}"`).join(', ');
    improvements.push({
      priority: 4,
      icon: '🔤',
      action: `${spelling.count} spelling error${spelling.count > 1 ? 's' : ''} (−${penalty.toFixed(2)} raw)`,
      detail: hints
    });
  }

  // ── METHOD COACHING ──────────────────────────────────────────────────────
  let methodCoaching = null;
  if (rawRatio >= 0.93 && contentFull) {
    if (vocab.method === 'verbatim') {
      methodCoaching = {
        current: 'Verbatim Method',
        next: vocab.effective_credit < 2
          ? 'Your Writing skill is at 90. To also push Reading toward 90, swap 2–3 common words for academic synonyms.'
          : 'Excellent execution. You are at the top of both skill ladders.'
      };
    } else if (vocab.method === 'paraphrased') {
      methodCoaching = {
        current: 'Paraphrased Method',
        next: 'Strong vocabulary work and idea coverage. Maintain the connector chain and you stay at Band 9.'
      };
    } else if (vocab.method === 'phrase_picking') {
      methodCoaching = {
        current: 'Phrase-Picking Method',
        next: vocab.effective_credit < 2
          ? 'Solid phrase selection with proper connectors. Add 2–3 academic synonym swaps to lock in Reading 90.'
          : 'Excellent phrase selection + academic upgrades — top of both ladders.'
      };
    }
  } else if (rawRatio < 0.93 && contentScore > 0) {
    if (vocab.method === 'verbatim_weak') {
      methodCoaching = {
        current: 'Verbatim style without connectors',
        next: 'Pick a method and commit. Either: (1) Verbatim Method — keep passage lines but glue them with ; however, ; moreover, ; therefore. Or (2) Paraphrased Method — pick the right lines and replace 2–3 common words with academic synonyms. Both reach 90 if executed cleanly.'
      };
    } else if (vocab.method === 'phrase_picking') {
      methodCoaching = {
        current: 'Phrase-Picking style',
        next: 'You are selecting phrases (good) but cohesion or content coverage needs work. Make sure every WHAT/WHY/HOW/RESULT idea is present and that connectors signal real relationships.'
      };
    } else if (vocab.method === 'hybrid') {
      methodCoaching = {
        current: 'Hybrid approach',
        next: 'Commit to one path. Verbatim Method (lift + connect), Paraphrased Method (lift + 2–3 swaps + connect), or Phrase-Picking (key phrases + connectors). All three reach 90; mixing them inconsistently leaves points on the table.'
      };
    }
  }

  // Sort improvements by priority
  improvements.sort((a, b) => a.priority - b.priority);

  // ── BACKWARDS-COMPAT SUMMARY LINE ────────────────────────────────────────
  const sParts = [];
  sParts.push(headline);
  if (improvements.length > 0) {
    const top = improvements[0];
    sParts.push(`Priority: ${top.action}`);
  }
  const summary_line = sParts.join(' · ');

  return { verdict, strengths, improvements, method_coaching: methodCoaching, summary_line };
}

// Legacy aliases — kept for any other call site that imports them
function buildFeedback(contentVerdict, grammar, vocab, firstPerson, form) {
  const card = buildFeedbackCard(contentVerdict, grammar, vocab, firstPerson, form, { count: 0 }, 0, contentVerdict.content_score, 0, null);
  return card.summary_line;
}
function buildImprovementTips(rawScore, contentScore, vocab, grammar, contentVerdict, form) {
  const card = buildFeedbackCard(contentVerdict, grammar, vocab, { isProblematic: false }, form, { count: 0 }, rawScore, contentScore, 0, null);
  return card.improvements.map(i => `${i.icon} ${i.action}`).join(' • ');
}

function buildPenaltiesList(form, contentScore, vocab, spelling, contentMax) {
  const arr = [];
  const cMax = (typeof contentMax === 'number' && contentMax > 0) ? contentMax : 2;
  const ratio = contentScore / cMax;
  if (form.overflow_penalty) arr.push({ type: 'word_count_overflow', impact: -form.overflow_penalty, detail: form.warning });
  if (contentScore === 0) {
    arr.push({ type: 'content_gate', impact: 'cap_at_PTE_15', detail: `0/${cMax} main ideas captured — heavy cap` });
  } else if (ratio <= 0.5) {
    arr.push({ type: 'content_partial', impact: 'cap_at_PTE_50', detail: `${contentScore}/${cMax} main ideas captured — partial cap` });
  } else if (ratio <= 0.75) {
    arr.push({ type: 'content_partial', impact: 'cap_at_PTE_65', detail: `${contentScore}/${cMax} main ideas captured — upper-mid cap` });
  } else if (ratio < 1) {
    arr.push({ type: 'content_partial', impact: 'cap_at_PTE_79', detail: `${contentScore}/${cMax} main ideas captured — almost there` });
  }
  if (spelling.count > 0) {
    const penalty = Math.min(1.0, 0.25 * spelling.count);
    arr.push({ type: 'spelling', impact: -penalty, detail: `${spelling.count} error(s), -${penalty.toFixed(2)} raw (cap -1.0)` });
  }
  if (vocab.meaning_changed) arr.push({ type: 'meaning_reversed', impact: 'vocab_to_0', detail: 'Synonym altered passage meaning' });
  if (vocab.inappropriate_count > 0) arr.push({ type: 'inappropriate_synonym', impact: -0.5, detail: `${vocab.inappropriate_count} occurrence(s)` });
  return arr;
}

// ═══ GRADING ROUTE ═══
app.post('/api/grade', async (req, res) => {
  try {
    let { text, type, prompt, keyPoints, userId } = req.body;
    const passageId = req.body.passageId;
    if (!text || !type || !prompt) return res.status(400).json({ error: 'Missing fields' });

    // ── SOURCE-OF-TRUTH OVERRIDE (v19.11) ──────────────────────────────────
    // The client sends `prompt` and `keyPoints` from its in-memory passage copy,
    // which goes STALE the moment an admin edits a passage while a student has
    // the page open. If the request names a passageId, ignore the client's copy
    // and score against the passage's CURRENT stored version. This guarantees a
    // fresh attempt is always graded against the latest key elements, even if
    // the student never refreshed.
    if (passageId != null) {
      try {
        const live = await PassageAPI.getById(passageId);
        if (live) {
          if (live.text) prompt = live.text;
          if (live.keyElements && Object.keys(live.keyElements).length) {
            keyPoints = live.keyElements;
          }
        }
      } catch (e) {
        console.warn('grade: could not load live passage', passageId, '-', e.message);
        // fall through with the client-supplied values
      }
    }

    // ── FORM GATE ──
    const form = validateForm(text);
    if (!form.valid) {
      const formFailCard = buildFeedbackCard(
        { content_score: 0, ideas_captured: [], ideas_missing: [], cohesion: 'unknown' },
        { score: 0, has_connector: false, connector_quality: 'missing', grammar_issues: [] },
        { score: 0, method: 'invalid', effective_credit: 0, safe_swaps: [], dangerous_swaps: [], meaning_changed: false, academic_words: [], inappropriate_count: 0 },
        { isProblematic: false, hasPerspectiveShift: false, issues: [] },
        form, { count: 0, suggestions: [] }, 0, 0, 0, null
      );
      // Form-fail also needs to know the passage's idea count for the UI chips.
      const ffMaxContent = countKeyElements(keyPoints) || 2;
      const ffMaxRaw = 1 + ffMaxContent + 2 + 2;
      return res.json({
        trait_scores: { form: 0, form_max: 1, content: 0, content_max: ffMaxContent, grammar: 0, grammar_max: 2, vocabulary: 0, vocabulary_max: 2 },
        content_details: { key_ideas_extracted: [], key_ideas_present: [], key_ideas_missing: [], notes: form.reason },
        grammar_details: { score: 0, has_connector: false, grammar_issues: [], connector_quality: 'missing' },
        vocabulary_details: { score: 0, notes: ['Form invalid'], safe_swaps: [], dangerous_swaps: [], meaning_changed: false, method: 'invalid' },
        skill_contributions: { reading: { estimate: 10, note: 'Form invalid' }, writing: { estimate: 10, note: 'Form invalid' } },
        paraphrase_analysis: { quality: 0, safeSwapCount: 0, dangerousSwapCount: 0 },
        overall_score: 10, raw_score: 0, max_raw_score: ffMaxRaw, total_ideas: ffMaxContent, band: 'Band 5',
        form_gate_triggered: true, form_reason: form.reason, word_count: form.wc,
        feedback: formFailCard.summary_line,
        feedback_card: formFailCard,
        improvement_tips: formFailCard.improvements.map(i => `${i.icon} ${i.action}`).join(' • '),
        first_person_detected: false, first_person_problematic: false,
        method_detected: 'invalid', llm_used: false, penalties_applied: [{ type: 'form_fail', impact: 'all_zero', detail: form.reason }],
        scoring_version: '19.10.0', mode: 'local'
      });
    }

    // ── LOCAL ANALYSIS (deterministic, fast) ──
    const verbatim = detectVerbatim(text, prompt);
    const swaps = analyzeSwaps(text, prompt);
    const firstPerson = detectFirstPerson(text, prompt);
    const grammar = checkGrammar(text, prompt);
    let spelling = checkSpelling(text, prompt);

    // ── CONTENT JUDGE: Claude first, local fallback ──
    // v19.6: also fire the Datamuse spelling enrichment in parallel — both are
    // network-bound, so doing them concurrently saves ~2-4s on slow paths.
    let llmJudgment = null;
    const [_judgeResult, enrichedSpelling] = await Promise.all([
      (async () => {
        try { llmJudgment = await judgeContentWithClaude(text, prompt, keyPoints); }
        catch (e) { /* swallow → fallback */ }
      })(),
      enrichSpellingWithDatamuse(spelling, text).catch(() => spelling)
    ]);
    spelling = enrichedSpelling;

    // ── DYNAMIC CONTENT SCALE (v19.4) ───────────────────────────────────────
    // Each captured key idea = +1 to content_score. Total ideas (3 or 4) defines
    // the maximum content_score and therefore the maximum raw score.
    const totalIdeas = countKeyElements(keyPoints);
    // If a passage somehow has no key elements, fall back to legacy 0–2 scoring.
    const maxContent = totalIdeas > 0 ? totalIdeas : 2;
    const maxRaw = 1 + maxContent + 2 + 2; // form + content + grammar + vocab

    // ── STRICT CONTENT GATE — v19.7: partial credit per idea ───────────────
    // The prompt asks Claude to return per_idea_scores: { what: 1.0, why: 0.5, ... }
    // We compute content_score = ROUND(sum) on the server. If per_idea_scores
    // is missing (older Claude responses, prompt regression), fall back to
    // the array-length authoritative path from v19.4.1.
    if (llmJudgment) {
      const perIdea = (llmJudgment.per_idea_scores && typeof llmJudgment.per_idea_scores === 'object')
        ? llmJudgment.per_idea_scores : null;
      const captured = Array.isArray(llmJudgment.ideas_captured) ? llmJudgment.ideas_captured : [];
      const partial  = Array.isArray(llmJudgment.ideas_partial)  ? llmJudgment.ideas_partial  : [];
      const missing  = Array.isArray(llmJudgment.ideas_missing)  ? llmJudgment.ideas_missing  : [];
      const originalScore = llmJudgment.content_score;
      let computedScore;
      let computedSum = 0;

      if (perIdea && Object.keys(perIdea).length > 0) {
        // ── BINARY CAPTURE (v19.8) ──
        // PTE Pearson scores content as binary per idea: idea is either present
        // or absent. Earlier versions of this engine introduced a partial-credit
        // tier (0.5) to handle overstuffed key elements, but that produced
        // confusing UI ("PARTIAL CREDIT" warnings on Band-9 attempts when the
        // headline was clearly captured). Per the user's design directive —
        // "as long as the idea was captured" — we now snap each per-idea score
        // to {0, 1}: any non-zero signal is treated as captured.
        //
        // The headline rescue layer (v19.7.2) still runs first as a safety net
        // for cases where Claude returned 0.5; both paths converge to 1.0 here.
        for (const k of Object.keys(perIdea)) {
          let v = Number(perIdea[k]);
          if (Number.isNaN(v)) v = 0;
          // Any signal of capture (>= 0.25) counts as captured.
          // Below 0.25 → genuinely missing.
          perIdea[k] = v >= 0.25 ? 1 : 0;
        }
        // Run headline rescue for transparency/debugging — at this point it
        // becomes a no-op for content scoring (0.5→1.0 already happened above)
        // but the audit trail is still useful.
        const rescueAudit = applyHeadlineRescue(perIdea, keyPoints, text);
        llmJudgment.headline_rescue = rescueAudit;
        // Sum after binary snap
        computedSum = 0;
        for (const k of Object.keys(perIdea)) computedSum += perIdea[k];
        computedScore = Math.round(computedSum);
        // Rebuild arrays — partial is now empty by construction.
        llmJudgment.ideas_captured = Object.keys(perIdea).filter(k => perIdea[k] === 1);
        llmJudgment.ideas_partial  = [];
        llmJudgment.ideas_missing  = Object.keys(perIdea).filter(k => perIdea[k] === 0);
      } else if (captured.length > 0 || missing.length > 0 || partial.length > 0) {
        // Fallback — array-length authoritative (legacy v19.4.1 path).
        // v19.8: treat partial as captured for the binary score.
        computedSum = captured.length + partial.length;
        computedScore = Math.round(computedSum);
        // Merge partial → captured for the array surfaces too.
        if (llmJudgment) {
          llmJudgment.ideas_captured = [...captured, ...partial];
          llmJudgment.ideas_partial = [];
          llmJudgment.ideas_missing = missing;
        }
      } else {
        // Last resort — both arrays and per_idea_scores empty.
        computedScore = (typeof originalScore === 'number') ? Math.round(originalScore) : 0;
        computedSum = computedScore;
      }
      computedScore = Math.max(0, Math.min(maxContent, computedScore));
      llmJudgment.content_score = computedScore;
      llmJudgment.content_score_raw_sum = computedSum;
      llmJudgment.content_max = maxContent;
      if (computedScore !== originalScore) {
        llmJudgment.content_score_adjusted = { from: originalScore, to: computedScore, reason: perIdea ? 'computed_from_per_idea_scores' : 'reconciled_with_arrays' };
      }
      // Update reason text to reflect the final score.
      const capList = llmJudgment.ideas_captured || [];
      const partList = llmJudgment.ideas_partial || [];
      const missList = llmJudgment.ideas_missing || [];
      if (capList.length === maxContent && partList.length === 0 && missList.length === 0) {
        llmJudgment.content_reason = `All ${maxContent} key ideas captured.`;
      } else if (capList.length === 0 && partList.length === 0) {
        llmJudgment.content_reason = `No key ideas captured (${missList.join(', ')} all missing).`;
      } else {
        const parts = [];
        if (capList.length) parts.push(`${capList.length} fully (${capList.join(', ')})`);
        if (partList.length) parts.push(`${partList.length} partial (${partList.join(', ')})`);
        if (missList.length) parts.push(`${missList.length} missing (${missList.join(', ')})`);
        llmJudgment.content_reason = `Captured ${parts.join('; ')}. Score: ${computedScore}/${maxContent}.`;
      }
    }

    const fallback = judgeContentLocal(text, prompt, keyPoints, grammar);
    const contentVerdict = llmJudgment || fallback;
    if (typeof contentVerdict.content_max !== 'number') contentVerdict.content_max = maxContent;
    const contentScore = Math.max(0, Math.min(maxContent, contentVerdict.content_score || 0));

    // ── VOCABULARY (now informed by LLM judgment) ──
    const vocab = scoreVocabulary(verbatim, swaps, firstPerson, grammar, llmJudgment);

    // ── GRAMMAR — apply spelling penalty (v19.6: scales with error count) ──
    // Penalty bands: 1 typo → -0.25, 2 typos → -0.5, 3 typos → -0.75, 4+ → -1.0.
    // Cap is -1.0 raw, which on a 9-point scale is roughly -8 PTE — bounded,
    // but a sloppy summary with 4+ typos no longer escapes with -0.5.
    let grammarScore = grammar.score;
    if (spelling.count >= 1) {
      const penalty = Math.min(1.0, 0.25 * spelling.count);
      grammarScore = Math.max(0, grammarScore - penalty);
      const hints = (spelling.suggestions || []).slice(0, 3).map(s => `"${s.misspelled}" → "${s.suggestion}"`).join(', ');
      grammar.grammar_issues.push(`Spelling (${spelling.count} error${spelling.count > 1 ? 's' : ''}, -${penalty.toFixed(2)} raw): ${hints}`);
    }

    // ── COHESION ADJUSTMENT — v19.5: reads from contentVerdict ──
    // Was llmJudgment-only, which meant the local fallback's weak-cohesion
    // detection never triggered the gate. Now both paths feed in.
    // Per user spec: "deduct scores if ideas are not well connected with each other".
    let cohesionPenaltyApplied = false;
    if (contentVerdict?.cohesion === 'weak') {
      grammarScore = Math.max(0, grammarScore - 1.0);
      grammar.grammar_issues.push('Clauses do not connect logically — ideas listed without proper logical glue');
      cohesionPenaltyApplied = true;
    }

    // ── RAW SCORE ASSEMBLY (v19.4 dynamic max) ──
    let rawScore = 1 + contentScore + grammarScore + vocab.score; // max = maxRaw

    // Soft word-count overflow
    if (form.overflow_penalty) rawScore -= form.overflow_penalty;

    // ── CONTENT GATE — proportional cap based on idea coverage ─────────────
    // Captured ratio drives the cap. The user's rule: each idea = one band.
    // We additionally enforce a hard PTE cap so that severely incomplete
    // summaries can't reach Band 9 just by having strong vocab/grammar.
    //
    // v19.5: boundaries widened so 50% coverage lands in the "PTE 50" tier
    // (was strictly < 0.5 which excluded exactly 0.5 — 2/4 misclassified).
    // New tiers:
    //   0% captured        → PTE 15 cap
    //   1%–50%  captured   → PTE 50 cap   (e.g. 2/4 = 50%)
    //   51%–75% captured   → PTE 65 cap   (e.g. 3/4 captured but ratio≠1)
    //   76%–<100% captured → PTE 79 cap
    //   100% captured      → no cap
    const capturedRatio = maxContent > 0 ? contentScore / maxContent : 1;
    let contentCapPTE = null;
    if (capturedRatio === 0)            contentCapPTE = 15;
    else if (capturedRatio <= 0.5)      contentCapPTE = 50;
    else if (capturedRatio <= 0.75)     contentCapPTE = 65;
    else if (capturedRatio < 1)         contentCapPTE = 79;
    if (contentCapPTE !== null) {
      const capRaw = pteToRaw(contentCapPTE, maxRaw);
      if (rawScore > capRaw) rawScore = capRaw;
    }

    // ── COHESION GATE — weak cohesion caps the score (PTE 62) ──
    if (cohesionPenaltyApplied) {
      const cohesionCapRaw = pteToRaw(62, maxRaw);
      if (rawScore > cohesionCapRaw) rawScore = cohesionCapRaw;
    }

    rawScore = Math.max(0, Math.min(maxRaw, rawScore));
    const overallScore = rawToPTEDynamic(rawScore, maxRaw);
    const band = rawToBandDynamic(rawScore, maxRaw);

    const skillContributions = estimateSkillContributions(rawScore, contentScore, grammarScore, vocab.score, swaps, llmJudgment, maxContent, maxRaw);
    const feedbackCard = buildFeedbackCard(contentVerdict, grammar, vocab, firstPerson, form, spelling, rawScore, contentScore, grammarScore, llmJudgment, maxContent, maxRaw);
    const feedback = feedbackCard.summary_line;
    const improvementTips = feedbackCard.improvements.map(i => `${i.icon} ${i.action}`).join(' • ');

    const result = {
      trait_scores: {
        form: 1,
        form_max: 1,
        content: contentScore,
        content_max: maxContent,         // v19.4: 3 or 4 depending on passage
        grammar: Math.round(grammarScore * 10) / 10,
        grammar_max: 2,
        vocabulary: Math.round(vocab.score * 10) / 10,
        vocabulary_max: 2
      },
      content_details: {
        key_ideas_extracted: [
          ...(contentVerdict.ideas_captured || []),
          ...(contentVerdict.ideas_partial  || []),
          ...(contentVerdict.ideas_missing  || [])
        ],
        key_ideas_present: contentVerdict.ideas_captured || [],
        key_ideas_partial: contentVerdict.ideas_partial  || [],
        key_ideas_missing: contentVerdict.ideas_missing  || [],
        per_idea_scores: contentVerdict.per_idea_scores  || null,
        notes: contentVerdict.content_reason,
        feels_connected: contentVerdict.cohesion ? contentVerdict.cohesion !== 'weak' : true,
        cohesion: contentVerdict.cohesion || 'unknown',
        feedback_note: contentVerdict.feedback_note || '',
        source: contentVerdict.source || 'local_fallback',
        score_adjusted: contentVerdict.content_score_adjusted || null,
        // v19.7.2: surface the headline-rescue audit so debugging is easy.
        // Lists which 0.5 → 1.0 upgrades were applied based on headline match.
        headline_rescue: contentVerdict.headline_rescue || null
      },
      grammar_details: {
        score: grammarScore,
        has_connector: grammar.has_connector,
        connector_used: grammar.connector_used,
        connector_type: grammar.connector_type,
        connector_quality: grammar.connector_quality,
        has_semicolon_before_connector: grammar.has_semicolon_before_connector,
        grammar_issues: grammar.grammar_issues,
        first_person: grammar.first_person,
        spelling_errors: spelling.errors,
        spelling_suggestions: spelling.suggestions,
        spelling_count: spelling.count,
        cohesion: contentVerdict.cohesion || 'unknown'
      },
      vocabulary_details: {
        score: vocab.score,
        verbatim_rate: vocab.verbatim_rate + '%',
        safe_swaps: vocab.safe_swaps,
        structural_changes: vocab.structural_changes || [],
        dangerous_swaps: vocab.dangerous_swaps,
        safe_swap_count: vocab.total_paraphrase_credit,
        structural_count: vocab.structural_count || 0,
        dangerous_swap_count: vocab.dangerous_swap_count,
        inappropriate_count: vocab.inappropriate_count || 0,
        meaning_changed: vocab.meaning_changed,
        academic_words: vocab.academic_words,
        perspective_shifted: vocab.perspective_shifted,
        method: vocab.method,
        notes: vocab.notes,
        suggestion: vocab.suggestion,
        breakdown: vocab.breakdown
      },
      paraphrase_analysis: {
        quality: swaps.totalParaphraseCredit >= 4 ? 100 : Math.round((swaps.totalParaphraseCredit / 4) * 100),
        rating: swaps.totalParaphraseCredit >= 4 ? 'strong' : swaps.totalParaphraseCredit >= 2 ? 'moderate' : 'weak',
        swaps: swaps.safeSwaps, dangerous: swaps.dangerousSwaps,
        academic_words: swaps.academicWordsUsed, novel_words: swaps.novelWords,
        novel_word_rate: swaps.novelWordRate + '%',
        safeSwapCount: swaps.safeSwapCount, structuralCount: swaps.structuralCount,
        totalCredit: swaps.totalParaphraseCredit, dangerousSwapCount: swaps.dangerousSwapCount
      },
      verbatim_analysis: { rate: verbatim.verbatimRate + '%', is_verbatim: verbatim.isVerbatim, longest_run: verbatim.longestRun },
      first_person_detected: firstPerson.detected,
      first_person_problematic: firstPerson.isProblematic,
      first_person_details: firstPerson,
      skill_contributions: skillContributions,
      overall_score: overallScore,
      raw_score: rawScore,
      max_raw_score: maxRaw,                // v19.4: dynamic ceiling
      total_ideas: maxContent,               // 3 or 4 — drives content_max
      band,
      word_count: form.wc,
      word_count_warning: form.warning || null,
      feedback,
      feedback_card: feedbackCard,
      improvement_tips: improvementTips,
      key_ideas_status: {
        captured: contentVerdict.ideas_captured || [],
        missing: contentVerdict.ideas_missing || []
      },
      method_detected: vocab.method,
      penalties_applied: buildPenaltiesList(form, contentScore, vocab, spelling, maxContent),
      llm_used: !!llmJudgment,
      scoring_version: '19.10.0',
      mode: llmJudgment ? 'claude' : 'local',
      vocabulary_suggestions: generateVocabSuggestions(text),
      spelling_details: {
        count: spelling.count,
        // v19.6: each suggestion may carry its own `source` (passage|dictionary)
        // — preserve it so the UI can show where the typo flag came from. Some
        // suggestions also have a `suggestions` array of alternatives.
        errors: (spelling.suggestions || []).map(s => ({
          misspelled: s.misspelled,
          suggestion: s.suggestion,
          suggestions: s.suggestions || [s.suggestion].filter(Boolean),
          source: s.source || 'passage'
        })),
        note: spelling.count > 0
          ? `${spelling.count} spelling error${spelling.count > 1 ? 's' : ''} (−${Math.min(1.0, 0.25 * spelling.count).toFixed(2)} raw, cap -1.0)`
          : null
      }
    };

    if (userId && req.body.passageId) {
      try { await StorageAPI.saveProgress(userId, req.body.passageId, text, result); result.saved = true; }
      catch (e) { result.saved = false; }
    }

    // v19.11: attach the LIVE passage's key elements + rationale to the response.
    // The results screen uses this to render "About this passage" and "Key
    // Element Coverage" from current server data — not the student's stale
    // in-memory copy. Without this, a student who had the page open before an
    // admin edit would see the old feedback on a brand-new attempt.
    if (passageId != null) {
      try {
        const live = await PassageAPI.getById(passageId);
        if (live) {
          result.passage_current = {
            id: live.id,
            title: live.title,
            category: live.category,
            keyElements: live.keyElements || {},
            keyElementsRationale: live.keyElementsRationale || null,
            extractionMeta: live.extractionMeta || null
          };
        }
      } catch (e) { /* non-fatal — frontend falls back to its own copy */ }
    }

    // ── Vocabulary swap suggestions ──
    // Prefer Claude's context-aware recommendations (no Datamuse out-of-context noise).
    // The legacy thesaurus_candidates field is preserved for backward compat but only
    // populated when Claude is unavailable (and even then we don't render it in UI v19).
    if (llmJudgment && Array.isArray(llmJudgment.recommended_swaps)) {
      // Filter out anything where the word doesn't actually appear in the student text
      // (Claude occasionally suggests swaps for words that aren't present)
      const studentLower = text.toLowerCase();
      result.vocabulary_swap_suggestions = llmJudgment.recommended_swaps
        .filter(s => s && typeof s.word === 'string' && s.word.length > 0
                  && Array.isArray(s.synonyms) && s.synonyms.length > 0
                  && studentLower.includes(s.word.toLowerCase()))
        .slice(0, 8)
        .map(s => ({
          word: s.word,
          context: s.context || '',
          synonyms: s.synonyms.slice(0, 5).filter(x => typeof x === 'string' && x.length > 0),
          rationale: s.rationale || ''
        }))
        .filter(s => s.synonyms.length > 0);
      result.swap_source = 'claude';
    } else {
      result.vocabulary_swap_suggestions = [];
      result.swap_source = 'none';
    }
    // Keep legacy field empty in v19 — frontend no longer reads it
    result.thesaurus_candidates = [];

    res.json(result);
  } catch (error) {
    console.error('Grade error:', error);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Friendly shortcut routes — let /admin and /practice work without the .html
// extension. These must come BEFORE the catch-all, which would otherwise serve
// index.html for any path that isn't a real file.
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/practice', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'practice.html'));
});

// Catch-all: serve index.html for any unknown routes (SPA support)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`✅ PTE SWT Grader v19.10.0 on port ${PORT}`);
  console.log(`🌐 Frontend: http://localhost:${PORT}`);
  console.log(`🔑 Admin: http://localhost:${PORT}/admin.html (key: ${ADMIN_KEY === 'admin123' ? 'admin123 ⚠ CHANGE THIS!' : 'configured'})`);
  console.log(`🤖 Anthropic: ${anthropic ? 'configured' : 'not configured'}`);
  console.log(`🤖 AI: ${anthropic ? 'ACTIVE' : 'LOCAL'}`);
  console.log(`💾 Storage backend: ${USE_POSTGRES ? 'POSTGRES (URL from ' + DATABASE_URL_SOURCE + ')' : 'JSON FILE (' + DATA_DIR + '/pte_data.json)'}`);

  // v19.10: Initialise Postgres schema and migrate any existing JSON data.
  // Both operations are idempotent.
  if (USE_POSTGRES) {
    try {
      await pgInitSchema();
      console.log('🐘 Postgres schema ready');
      const mig = await pgMigrateFromJsonIfNeeded();
      if (mig.migrated) {
        console.log(`🐘 Migrated ${mig.accounts} accounts and ${mig.user_data} user records from pte_data.json`);
      } else {
        console.log(`🐘 No migration needed (${mig.reason})`);
      }
      // v19.11.1: seed the passages table from the bundle ONLY if it's empty.
      // After this run, every admin edit lives in Postgres and is safe across
      // deploys. The previous file-based PassageAPI is no longer used.
      const seed = await pgSeedPassagesIfEmpty();
      if (seed.seeded) {
        console.log(`🐘 Seeded ${seed.count} passages from bundled passages.json (table was empty)`);
      } else if (seed.reason === 'passages_already_populated') {
        console.log(`🐘 Passages table already has ${seed.existing} rows — leaving them alone`);
      } else {
        console.log(`🐘 Passage seed skipped (${seed.reason}${seed.error ? ': ' + seed.error : ''})`);
      }
    } catch (e) {
      console.error('🐘 Postgres init failed:', e.message);
      console.error('     The server will keep running but writes will fail until Postgres is healthy.');
    }
  }

  // Boot diagnostic — relevant whether or not Postgres is active.
  await captureBootSnapshot();
  console.log('');
  console.log('━━━ STORAGE DIAGNOSTIC ━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Instance ID:      ${INSTANCE_ID}`);
  console.log(`Boot time:        ${BOOT_TIME}`);
  console.log(`Backend:          ${USE_POSTGRES ? 'Postgres' : 'JSON file'}`);
  if (USE_POSTGRES) {
    console.log(`DATABASE_URL:     SET (host redacted)`);
  } else {
    console.log(`DATA_DIR:         ${DATA_DIR}`);
    console.log(`Volume env var:   ${process.env.RAILWAY_VOLUME_MOUNT_PATH ? 'SET → ' + process.env.RAILWAY_VOLUME_MOUNT_PATH : 'NOT SET'}`);
    console.log(`NODE_ENV:         ${process.env.NODE_ENV || '(unset)'}`);
    console.log(`File at boot:     ${BOOT_SNAPSHOT.file_existed_at_boot ? `${BOOT_SNAPSHOT.file_size_at_boot}B, ${BOOT_SNAPSHOT.user_count_at_boot} users, mtime ${BOOT_SNAPSHOT.file_mtime_at_boot}` : 'DOES NOT EXIST'}`);
    if (!process.env.RAILWAY_VOLUME_MOUNT_PATH && (DATA_DIR === '/app/data' || DATA_DIR === './data')) {
      console.log('');
      console.log('⚠⚠⚠  WARNING: No DATABASE_URL and no RAILWAY_VOLUME_MOUNT_PATH detected.');
      console.log('⚠⚠⚠  Writes will go to ephemeral container disk and be wiped on every deploy.');
      console.log('⚠⚠⚠  Provision a Postgres service on Railway (recommended) or attach a volume.');
    }
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});
