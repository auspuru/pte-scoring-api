const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const crypto = require('crypto');
const fsSync = require('fs');
const fs = require('fs').promises;
const path = require('path');

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

const StorageAPI = {
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

// ═══════════════════════════════════════════════════════════════════════════════
// PASSAGE STORAGE — admin-editable, persisted to the Railway volume
// ═══════════════════════════════════════════════════════════════════════════════
// Passages are stored as a JSON array on disk. On first read, if the volume
// file doesn't exist, we seed it from the bundled passages.json (default 10).
// Admin endpoints (/api/admin/passages) provide full CRUD.
const PassageAPI = {
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
    const cleaned = this._sanitize(passage);
    if (idx >= 0) all[idx] = { ...all[idx], ...cleaned };
    else {
      // Auto-assign id if missing
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
  },

  _sanitize(p) {
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
    return out;
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER-SIDE AUTH
// ═══════════════════════════════════════════════════════════════════════════════
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin123'; // Set in Railway env vars

function hashPw(pw) { return crypto.createHash('sha256').update(pw.toLowerCase().trim()).digest('hex'); }

const AuthAPI = {
  async readAccounts() {
    const data = await StorageAPI.readData();
    if (!data.accounts) data.accounts = {};
    return data;
  },
  async register(username, password, secretQ, secretA) {
    const data = await this.readAccounts();
    const uid = username.toLowerCase().trim();
    if (data.accounts[uid]) return { success: false, error: 'Username taken' };
    if (password.length < 4) return { success: false, error: 'Password min 4 chars' };
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
    const data = await this.readAccounts();
    const uid = username.toLowerCase().trim();
    const acct = data.accounts[uid];
    if (!acct) return { success: false, error: 'User not found' };
    if (acct.blocked) return { success: false, error: 'Account blocked. Contact admin.' };
    if (acct.passwordHash !== hashPw(password)) return { success: false, error: 'Wrong password' };
    acct.lastLogin = new Date().toISOString();
    await StorageAPI.writeData(data);
    return { success: true, user: { username: uid, role: acct.role || 'user' } };
  },
  async changePassword(username, oldPw, newPw) {
    const data = await this.readAccounts();
    const uid = username.toLowerCase().trim();
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
        // v19.7: surface partial-credit ideas in the note
        const partialList = (llmJudgment && Array.isArray(llmJudgment.ideas_partial)) ? llmJudgment.ideas_partial : [];
        if (contentFull && partialList.length === 0 && hasAcademicSynonyms) return 'Strong — correct ideas + academic synonyms';
        if (contentFull && partialList.length === 0) return 'All ideas captured — replace 2–3 common words with academic synonyms to push Reading higher';
        if (partialList.length > 0) return `${contentScore}/${cMax} main ideas captured (${partialList.length} partial) — flesh out the partial idea${partialList.length > 1 ? 's' : ''} to lift Reading further`;
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

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '18.0.0', anthropicConfigured: !!anthropic, storage: DATA_DIR, sync: true });
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
  try {
    const data = await StorageAPI.readData();
    const exists = !!(data.accounts && data.accounts[req.params.username.toLowerCase().trim()]);
    res.json({ exists });
  } catch (e) { res.json({ exists: false }); }
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

app.get('/api/admin/impersonate/:username', requireAdmin, async (req, res) => {
  try {
    const uid = req.params.username.toLowerCase().trim();
    const userData = await StorageAPI.getUserData(uid);
    res.json({ success: true, username: uid, data: userData });
  } catch (e) { res.status(500).json({ error: 'Impersonate failed' }); }
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
// CONTENT JUDGE — Claude-powered (with local fallback)
//
// Per real-exam feedback: content (correct idea selection) is THE primary
// determinant. Wrong ideas → severe ceiling. Correct ideas + academic synonyms
// → reach Band 9 / PTE 90. Verbatim with good connectors stays at Writing 90
// but caps Reading around 55–65 unless academic synonyms are added.
// ═══════════════════════════════════════════════════════════════════════════════
function formatKeyElementsHint(keyElements) {
  if (!keyElements) return '';
  const parts = [];
  // New schema (preferred)
  if (keyElements.what)    parts.push('- What: '   + stripHtml(keyElements.what));
  if (keyElements.why)     parts.push('- Why: '    + stripHtml(keyElements.why));
  if (keyElements.how)     parts.push('- How: '    + stripHtml(keyElements.how));
  if (keyElements.result)  parts.push('- Result: ' + stripHtml(keyElements.result));
  // Legacy schema (fallback)
  if (!keyElements.what && keyElements.topic)      parts.push('- Topic: '      + stripHtml(keyElements.topic));
  if (!keyElements.why  && keyElements.pivot)      parts.push('- Pivot: '      + stripHtml(keyElements.pivot));
  if (!keyElements.result && keyElements.conclusion) parts.push('- Conclusion: ' + stripHtml(keyElements.conclusion));
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

CONTENT SCORING — partial credit per idea:

For EACH key idea above, assign a per-idea score:
  • 1.0  — HEADLINE captured. The student's summary clearly conveys the central claim of this idea, even if specific supporting details (dates, names, numbers, secondary clauses) are omitted. Paraphrasing the headline IS capture.
  • 0.5  — Partially captured. The student gestures at the idea but with significant distortion or only fragments of the core claim.
  • 0.0  — Missing. The idea is not conveyed at all, or has been replaced by unrelated/fabricated content.

Then content_score = SUM of per-idea scores, ROUNDED to nearest integer (range 0–${totalIdeas}).

CAPTURE PHILOSOPHY — read this carefully:
The KEY IDEAS above are written as full sentences with headline + supporting context. A student who captures the HEADLINE earns 1.0 even without the supporting context. Examples of captured (1.0):
  • Key idea: "Progress was not entirely smooth, with setbacks like the South Sea Bubble of 1720"
    Student wrote: "the progress was not completely smooth"  →  1.0 (headline captured; the date is supporting detail).
  • Key idea: "He has altered the way people think as well as the way they live, like other revolutionary scientists"
    Student wrote: "has changed the world more than anyone in the past century"  →  1.0 (same headline meaning).
  • Key idea: "He persuaded his wife that exchanging the town house for a farm cottage on a lower income was a good idea"
    Student wrote: "he tried to convince his wife that exchanging town house for farm cottage was a good idea"  →  1.0 ("tried to convince" = "persuaded"; same idea).
  • Key idea: "Tourism employs a large proportion of women, minority groups and young people"
    Student wrote: "the sector employs many women, minority groups and young people"  →  1.0.

Examples of partial (0.5):
  • Key idea: "He persuaded his wife that exchanging the town house for a farm cottage was a good idea"
    Student wrote: "he made his wife move"  →  0.5 (gestures at the action but loses the persuasion + reasoning).

Examples of missing (0.0):
  • Key idea: "The financial hub has overtaken New York rivals in funds managed and holds 70% of bond markets"
    Student wrote: nothing about overtaking NY  →  0.0.
  • Student replaces an idea with fabricated content not in the passage  →  0.0.

OUTPUT REQUIREMENTS:
- per_idea_scores: object mapping each idea label (what/why/how/result OR topic/pivot/conclusion) to its 0.0/0.5/1.0 score.
- ideas_captured: labels with score >= 1.0.
- ideas_partial: labels with score == 0.5.
- ideas_missing: labels with score == 0.0.
- length(ideas_captured) + length(ideas_partial) + length(ideas_missing) MUST equal ${totalIdeas}.
- content_score: SUM of per_idea_scores values, rounded to nearest integer (so two 0.5s round up; one 0.5 alone rounds down).

CRITICAL RULES (do not break these):
1. An idea is "captured" (1.0) when its CORE/HEADLINE meaning is clearly present — paraphrasing is fine, omitting supporting detail is fine, the central claim must be there.
2. If the student replaces a passage idea with different content (even if grammatically fluent), score that idea 0.0 — fluency does not rescue missing content.
3. If the summary is off-topic or gibberish, every per_idea_score is 0.0.

- synonym_appropriateness "appropriate": all swaps preserve meaning and academic register, OR no swaps were made (verbatim).
- synonym_appropriateness "some_inappropriate": one or more swaps are awkward, wrong register, or shift connotation.
- synonym_appropriateness "meaning_changed": a swap reverses or significantly alters the passage meaning.
- synonym_appropriateness "no_swaps": pure verbatim with zero substitution (still acceptable).
- academic_register: true if the summary uses 2+ recognisably academic/formal words (e.g., consequently, substantial, demonstrate, comprehensive).

VOCABULARY SWAP SUGGESTIONS (recommended_swaps) — VERY IMPORTANT:
Identify 6 to 8 common, non-academic words in the STUDENT SUMMARY that could be replaced with academic synonyms to lift Reading skill score. Be GENEROUS — students benefit from having more options to choose from. The CONTEXT MUST FIT — re-read the sentence with each suggested synonym mentally and only include synonyms that read fluently and preserve meaning exactly.

Rules for each suggested word:
- It can be ANY common, non-academic word the student used (whether they copied it from the passage or wrote it themselves)
- Skip ONLY: proper nouns, dates, numbers, technical terms, fixed phrases, and words already academic (e.g., "consequently", "substantial", "demonstrate")
- Provide 3 to 5 academic synonyms per word — the student picks which one fits best
- Each synonym MUST fit the EXACT context of the sentence
- Skip the word entirely if NO synonym fits cleanly — better to suggest fewer words with great synonyms than many words with awkward ones

GOOD examples (context-appropriate):
- "made a lifestyle choice" → word: "made", synonyms: ["opted for", "chose", "selected"] ✓
- "wanted information in one place" → word: "wanted", synonyms: ["sought", "needed", "required"] ✓
- "many advantages" → word: "many", synonyms: ["numerous", "several", "multiple", "various"] ✓
- "good idea" → word: "good", synonyms: ["beneficial", "sound", "sensible", "prudent"] ✓
- "big problem" → word: "big", synonyms: ["significant", "substantial", "considerable", "major"] ✓
- "think about" → word: "think about", synonyms: ["consider", "examine", "evaluate"] ✓
- "show that" → word: "show", synonyms: ["demonstrate", "indicate", "reveal", "establish"] ✓
- "use" → synonyms: ["utilise", "employ", "apply"] ✓
- "help" → synonyms: ["assist", "facilitate", "support"] ✓
- "get" → synonyms: ["obtain", "acquire", "secure"] ✓

BAD examples to AVOID:
- "wanted information" → DO NOT suggest ["hot", "cherished", "treasured", "loved"] — wrong register and meaning
- "make a choice" → DO NOT suggest ["create"] for "make" — different sense
- DO NOT suggest synonyms that are too rare, archaic, or jarring in academic English
- DO NOT suggest a synonym that subtly shifts meaning

Aim for 6-8 candidates if possible, but quality beats quantity — 4 great suggestions are better than 8 awkward ones.

Respond ONLY with valid JSON, no other text. Use this exact structure:
{
  "per_idea_scores": { "what": 1.0, "why": 1.0, "how": 0.5, "result": 0.0 },
  "content_score": 3,
  "content_reason": "one short sentence summarising overall coverage",
  "ideas_captured": ["what", "why"],
  "ideas_partial": ["how"],
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
- per_idea_scores values: only 0.0, 0.5, or 1.0 (no other values).
- content_score: ROUND(sum of per_idea_scores values) — JavaScript Math.round semantics (0.5 rounds up).
- ideas_captured / ideas_partial / ideas_missing: derived from per_idea_scores. Their lengths must sum to ${totalIdeas}.`;

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
  // v19.7: when there's partial coverage, say so explicitly so the headline
  // tells students what's actually going on, not just the score band.
  const partialIdeasList = contentVerdict.ideas_partial || [];
  const hasPartial = partialIdeasList.length > 0;
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
    const partialNote = hasPartial
      ? ` ${partialIdeasList.length} idea${partialIdeasList.length > 1 ? 's' : ''} got partial credit — flesh ${partialIdeasList.length > 1 ? 'them' : 'it'} out to fully secure this band.`
      : '';
    headline = `Excellent — ${band} (PTE ${pte}) achieved via the ${methodLabel}.${partialNote}`;
  } else if (rawRatio >= 0.79) {
    tier = 'good';
    const partialNote = hasPartial ? ` ${partialIdeasList.length} idea${partialIdeasList.length > 1 ? 's' : ''} partial — flesh ${partialIdeasList.length > 1 ? 'them' : 'it'} out for full marks.` : ' One or two changes will push this to Band 9.';
    headline = `Solid attempt — ${band} (PTE ${pte}).${partialNote}`;
  } else if (rawRatio >= 0.50) {
    tier = 'partial';
    const partialNote = hasPartial ? ` ${partialIdeasList.length} of your ideas got partial credit only.` : ' Significant gaps to close.';
    headline = `Partial credit — ${band} (PTE ${pte}).${partialNote}`;
  } else {
    tier = 'fail';
    headline = `${band} (PTE ${pte}) — major gaps. Focus on capturing the main ideas first.`;
  }

  const verdict = { tier, headline, pte, band, raw: rawScore, raw_max: rMax, content_max: cMax, method: vocab.method };

  // ── STRENGTHS ────────────────────────────────────────────────────────────
  const strengths = [];

  const fullyCaptured = contentVerdict.ideas_captured || [];
  const partialCaptured = contentVerdict.ideas_partial || [];

  if (contentFull && cMax > 0 && partialCaptured.length === 0) {
    strengths.push({ icon: '🎯', label: `All ${cMax} main ideas captured`, detail: fullyCaptured.join(' · ') });
  } else if (fullyCaptured.length > 0 || partialCaptured.length > 0) {
    // Build a label that surfaces both fully captured AND partial, so the student
    // gets credit for what they got and a clear cue for what to flesh out.
    const totalWeighted = fullyCaptured.length + 0.5 * partialCaptured.length;
    const niceTotal = Number.isInteger(totalWeighted) ? totalWeighted.toString() : totalWeighted.toFixed(1);
    let label;
    if (fullyCaptured.length > 0 && partialCaptured.length > 0) {
      label = `Captured ${niceTotal}/${cMax} main ideas (${partialCaptured.length} partial)`;
    } else if (fullyCaptured.length > 0) {
      label = `Captured ${fullyCaptured.length}/${cMax} main idea${fullyCaptured.length > 1 ? 's' : ''}`;
    } else {
      label = `${partialCaptured.length} idea${partialCaptured.length > 1 ? 's' : ''} partially captured`;
    }
    const detailParts = [];
    if (fullyCaptured.length) detailParts.push('Full: ' + fullyCaptured.join(', '));
    if (partialCaptured.length) detailParts.push('Partial: ' + partialCaptured.join(', '));
    strengths.push({ icon: '✓', label, detail: detailParts.join(' · ') });
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

  // Priority 1 — content (v19.7: split missing vs partial guidance)
  const missingArr = contentVerdict.ideas_missing || [];
  const partialArr = contentVerdict.ideas_partial || [];
  if (contentNone) {
    improvements.push({
      priority: 1,
      icon: '🚨',
      action: 'Re-read the passage and capture the main ideas',
      detail: `Identify each of the ${cMax} key ideas (What/Why/How/Result). Missing all ideas heavily caps the score (PTE 15 max).`
    });
  } else if (contentPartial || missingArr.length > 0 || partialArr.length > 0) {
    // PTE cap matches the gate at the same boundaries.
    const capPte = contentRatio <= 0.5 ? 50 : contentRatio <= 0.75 ? 65 : 79;

    // Action: prioritise missing over partial because missing costs a full band each.
    if (missingArr.length > 0) {
      improvements.push({
        priority: 1,
        icon: '⚠️',
        action: `Add the missing idea${missingArr.length > 1 ? 's' : ''}: ${missingArr.join(', ')}`,
        detail: `You captured ${contentScore}/${cMax}. Score is currently capped at PTE ${capPte} until all main ideas are included.`
      });
    }
    // Partial ideas get their own coaching — half-credit means there's something
    // there but it needs the headline meaning to be clearer.
    if (partialArr.length > 0) {
      improvements.push({
        priority: 1,
        icon: '🟡',
        action: `Flesh out the partial idea${partialArr.length > 1 ? 's' : ''}: ${partialArr.join(', ')}`,
        detail: `You touched on ${partialArr.length === 1 ? 'this idea' : 'these ideas'} but the core meaning isn't clear yet — half credit only. Re-read the passage and convey the headline of each one explicitly.`
      });
    }
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
    const { text, type, prompt, keyPoints, userId } = req.body;
    if (!text || !type || !prompt) return res.status(400).json({ error: 'Missing fields' });

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
        scoring_version: '19.7.1', mode: 'local'
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
        // Authoritative — use per_idea_scores. Each value clamped to {0, 0.5, 1.0}.
        for (const k of Object.keys(perIdea)) {
          let v = Number(perIdea[k]);
          if (Number.isNaN(v)) v = 0;
          // Snap to nearest of 0 / 0.5 / 1
          if (v >= 0.75) v = 1;
          else if (v >= 0.25) v = 0.5;
          else v = 0;
          perIdea[k] = v;
          computedSum += v;
        }
        computedScore = Math.round(computedSum);
        // Rebuild captured / partial / missing arrays so they always match perIdea.
        llmJudgment.ideas_captured = Object.keys(perIdea).filter(k => perIdea[k] === 1);
        llmJudgment.ideas_partial  = Object.keys(perIdea).filter(k => perIdea[k] === 0.5);
        llmJudgment.ideas_missing  = Object.keys(perIdea).filter(k => perIdea[k] === 0);
      } else if (captured.length > 0 || missing.length > 0 || partial.length > 0) {
        // Fallback — array-length authoritative (legacy v19.4.1 path).
        // Half-credit for "partial" entries.
        computedSum = captured.length + 0.5 * partial.length;
        computedScore = Math.round(computedSum);
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
        // v19.5: surface the reconcile metadata so the UI / debug tools can
        // see when Claude's numeric content_score was overridden by the
        // ideas_captured array length (a known LLM inconsistency).
        score_adjusted: contentVerdict.content_score_adjusted || null
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
      scoring_version: '19.7.1',
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

// Catch-all: serve index.html for any unknown routes (SPA support)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ PTE SWT Grader v18.0.0 on port ${PORT}`);
  console.log(`🌐 Frontend: http://localhost:${PORT}`);
  console.log(`🔑 Admin: http://localhost:${PORT}/admin.html (key: ${ADMIN_KEY === 'admin123' ? 'admin123 ⚠ CHANGE THIS!' : 'configured'})`);
  console.log(`🤖 Anthropic: ${anthropic ? 'configured' : 'not configured'}`);
  console.log(`💾 Storage: ${DATA_DIR}/pte_data.json`);
  console.log(`🤖 AI: ${anthropic ? 'ACTIVE' : 'LOCAL'}`);
  console.log(`💾 Storage: ${DATA_DIR}/pte_data.json`);
});
