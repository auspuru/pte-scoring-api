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

async function ensureDataDir() {
  try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch (e) { /* ok */ }
}

const StorageAPI = {
  async readData() {
    try { return JSON.parse(await fs.readFile(STORAGE_FILE, 'utf8')); }
    catch { return { users: {}, global: { totalAttempts: 0 } }; }
  },
  async writeData(data) { await ensureDataDir(); await fs.writeFile(STORAGE_FILE, JSON.stringify(data, null, 2)); },
  
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

// Continuous raw-to-PTE mapping — supports decimal raw scores via linear interpolation
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

  const isLong = keyConcepts.length > 15;
  const thresholds = { concept: isLong ? 0.18 : 0.22, critical: isLong ? 0.25 : 0.30 };

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

  // PRESENCE DECISION — numbers are a bonus signal, NOT a hard gate
  // A key idea is present if:
  //   Path A: concept match >= threshold OR critical match >= threshold OR 2+ critical terms
  //   Path B: numbers matched (bonus — boosts confidence but absence doesn't block)
  // Old logic had numberGate as hard blocker — this caused false negatives
  // when student captured the idea without specific numbers
  const conceptPass = matchRate >= thresholds.concept;
  const criticalPass = criticalRate >= thresholds.critical;
  const minCritical = matchedCritical >= 2;
  const strongConcept = matchRate >= 0.35;
  
  const isPresent = (conceptPass || criticalPass || minCritical) && 
                    (numberMatched || strongConcept || matchRate >= 0.25);

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
  // For "Paraphrased Method" recognition, require actual word swaps (wordSwapCredit), not just structural changes
  if (wordSwapCredit >= 4) notes.push(`✓ ${wordSwapCredit} synonym swaps — Paraphrased Method`);
  else if (wordSwapCredit >= 2) notes.push(`${wordSwapCredit} synonym swaps`);
  else if (wordSwapCredit === 1) notes.push('1 synonym swap (target: 4 for Paraphrased Method)');
  else if (!meaningChanged && verbatimRate >= 70) notes.push('Verbatim style — ensure strong connectors');

  if (perspectiveShifted) notes.push('✓ Third-person perspective');
  if (academicWordsUsed.length >= 2) notes.push(`✓ Academic vocabulary: ${academicWordsUsed.slice(0, 3).join(', ')}`);
  if (safeSwaps.length > 0 && !meaningChanged) notes.push(`Swaps: ${safeSwaps.slice(0, 4).map(s => `"${s.original}" → "${s.replacement}"`).join(', ')}`);
  if (structuralChanges.length > 0 && !meaningChanged) notes.push(`Structural: ${structuralChanges.map(s => s.detail).join(', ')}`);

  // Method tag — paraphrased requires real word swaps, not just structural changes
  const method = wordSwapCredit >= 4 ? 'paraphrased'
               : verbatimRate >= 70 && hasConnector ? 'verbatim'
               : verbatimRate >= 70 ? 'verbatim_weak'
               : 'hybrid';

  if (!suggestion && score >= 2) {
    suggestion = effectiveCredit >= 4
      ? 'Strong vocabulary — keep using academic synonyms.'
      : 'For higher Reading skill, swap 4 common words for academic synonyms (e.g., made→opted, good→beneficial, important→crucial).';
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
function estimateSkillContributions(rawScore, contentScore, grammarScore, vocabScore, swapData, llmJudgment) {
  const academicCount = (swapData?.academicWordsUsed?.length || 0)
    + ((llmJudgment?.academic_register === true) ? 2 : 0);
  const swapCredit = swapData?.totalParaphraseCredit || 0;
  const hasAcademicSynonyms = academicCount >= 2 || swapCredit >= 4;

  // ── READING ──
  let reading;
  if (contentScore === 0) {
    reading = 15; // Wrong ideas — cap heavily
  } else if (contentScore === 1) {
    reading = hasAcademicSynonyms ? 50 : 38;
  } else { // contentScore === 2
    if (academicCount >= 3 || swapCredit >= 5) reading = 90;
    else if (hasAcademicSynonyms) reading = 79;
    else if (swapCredit >= 1) reading = 65;
    else reading = 55; // All ideas captured but pure verbatim — Reading caps moderate
  }

  // ── WRITING ──
  let writing;
  if (rawScore >= 6.5) writing = 88;
  else if (rawScore >= 6) writing = 82;
  else if (rawScore >= 5) writing = 70;
  else if (rawScore >= 4) writing = 58;
  else if (rawScore >= 3) writing = 45;
  else if (rawScore >= 2) writing = 30;
  else writing = 15;

  return {
    reading: {
      estimate: reading,
      components: { content: contentScore, academic_synonyms: academicCount, swap_credit: swapCredit, has_academic_synonyms: hasAcademicSynonyms },
      note: contentScore === 0
        ? 'Wrong ideas — Reading skill heavily impacted'
        : contentScore === 2 && hasAcademicSynonyms
          ? 'Strong — correct ideas + academic synonyms'
          : contentScore === 2
            ? 'All ideas captured but no academic synonyms — paraphrase 4 words for higher Reading'
            : 'Some main ideas missing'
    },
    writing: {
      estimate: writing,
      components: { grammar: grammarScore, vocabulary: vocabScore, form: 1, raw: rawScore },
      note: rawScore >= 6 ? 'Strong production' : rawScore >= 4 ? 'Moderate production' : 'Production needs work'
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

  const prompt = `You are a strict but fair PTE Academic Summarize Written Text scorer. Score this one-sentence summary across three dimensions AND suggest context-appropriate vocabulary swaps.

PASSAGE:
${passageText}

STUDENT SUMMARY:
${studentText}

${kpHint ? 'KEY IDEAS THE PASSAGE CONVEYS:\n' + kpHint + '\n' : ''}
EVALUATE:
1. CONTENT COVERAGE — Did the student capture the main What/Why/How/Result of the passage? This is THE most important dimension. Wrong/missing ideas → 0.
2. SYNONYM APPROPRIATENESS — If the student replaced words from the passage, are substitutes meaning-preserving and register-appropriate? VERBATIM COPYING IS ACCEPTABLE — do NOT penalise it.
3. COHESION — Do the clauses connect logically with proper connectors (however/moreover/therefore/furthermore)?

SCORING GUIDANCE:
- content_score 2: All key ideas (or at least 3 of 4 from What/Why/How/Result) captured AND clauses connect cleanly.
- content_score 1: Some key ideas captured, others missed; OR ideas listed without logical connection.
- content_score 0: Off-topic, gibberish, OR the main argument is missed entirely.
- synonym_appropriateness "appropriate": all swaps preserve meaning and academic register, OR no swaps were made (verbatim).
- synonym_appropriateness "some_inappropriate": one or more swaps are awkward, wrong register, or shift connotation.
- synonym_appropriateness "meaning_changed": a swap reverses or significantly alters the passage meaning.
- synonym_appropriateness "no_swaps": pure verbatim with zero substitution (still acceptable).
- academic_register: true if the summary uses 2+ recognisably academic/formal words (e.g., consequently, substantial, demonstrate, comprehensive).

VOCABULARY SWAP SUGGESTIONS (recommended_swaps) — VERY IMPORTANT:
Identify up to 4 common, non-academic words in the STUDENT SUMMARY that could be replaced with academic synonyms to lift Reading skill score. The CONTEXT MUST FIT — re-read the sentence with each suggested synonym mentally and only include synonyms that read fluently and preserve meaning exactly.

Rules for each suggested word:
- It MUST appear verbatim from the passage (a word the student copied)
- It MUST be a common, non-academic word (skip proper nouns, dates, numbers, technical terms, words already academic like "consequently"/"substantial")
- Each suggested synonym MUST fit the EXACT context of the sentence
- Skip the word entirely if no synonym fits cleanly — better to suggest nothing than something awkward

GOOD examples (context-appropriate):
- "made a lifestyle choice" → word: "made", synonyms: ["opted for", "chose"] ✓
- "wanted information in one place" → word: "wanted", synonyms: ["sought", "needed"] ✓
- "many advantages" → word: "many", synonyms: ["numerous", "several"] ✓
- "good idea" → word: "good", synonyms: ["beneficial", "sound"] ✓

BAD examples to AVOID:
- "wanted information" → DO NOT suggest ["hot", "cherished", "treasured", "loved"] — wrong register and meaning
- "make a choice" → DO NOT suggest ["create"] for "make" — different sense
- DO NOT suggest synonyms for content words the student already paraphrased
- DO NOT suggest synonyms that are too rare or jarring in academic English

If no swap candidates fit cleanly, return an empty array — that is a valid answer.

Respond ONLY with valid JSON, no other text:
{
  "content_score": 0,
  "content_reason": "one short sentence",
  "ideas_captured": ["short label", "short label"],
  "ideas_missing": ["short label"],
  "synonym_appropriateness": "appropriate",
  "synonym_issues": [],
  "cohesion": "strong",
  "academic_register": false,
  "feedback_note": "one short sentence of actionable feedback",
  "recommended_swaps": [
    { "word": "made", "context": "made a lifestyle choice", "synonyms": ["opted for", "decided on"], "rationale": "Academic register lifts Reading skill" }
  ]
}`;

  try {
    const callPromise = anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 900,
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

function judgeContentLocal(studentText, passageText, keyElements) {
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

  if (fields.length === 0) {
    return {
      content_score: 1,
      content_reason: 'No key elements provided — neutral local score',
      ideas_captured: [], ideas_missing: [],
      synonym_appropriateness: 'no_swaps',
      synonym_issues: [], cohesion: 'moderate', academic_register: false,
      feedback_note: 'Content judged locally without key element data',
      source: 'local_fallback'
    };
  }

  const checks = fields.map(f => ({ name: f.name, ...checkKeyPoint(studentText, f.text) }));
  const present = checks.filter(c => c.present).map(c => c.name);
  const missing = checks.filter(c => !c.present).map(c => c.name);

  let score;
  if (present.length === fields.length) score = 2;
  else if (present.length >= Math.ceil(fields.length / 2)) score = 1;
  else if (present.length >= 1) score = 1;
  else score = 0;

  return {
    content_score: score,
    content_reason: present.length === fields.length
      ? 'All main ideas captured (local check)'
      : present.length > 0
        ? `Captured ${present.length}/${fields.length} main ideas — missing: ${missing.join(', ')}`
        : 'Main ideas not detected',
    ideas_captured: present,
    ideas_missing: missing,
    synonym_appropriateness: 'no_swaps',  // local can't judge — defer to swap analysis
    synonym_issues: [],
    cohesion: 'moderate',
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
function buildFeedbackCard(contentVerdict, grammar, vocab, firstPerson, form, spelling, rawScore, contentScore, grammarScore, llmJudgment) {
  const pte = rawToPTE(rawScore);
  const band = rawToBand(rawScore);

  // ── VERDICT ──────────────────────────────────────────────────────────────
  let tier, headline;
  if (form && !form.valid) {
    tier = 'invalid';
    headline = `Form failed — ${form.reason}`;
  } else if (contentScore === 0) {
    tier = 'fail';
    headline = 'The main ideas were not captured. Re-read the passage and identify What, Why, How and the Result.';
  } else if (rawScore >= 6.5) {
    tier = 'excellent';
    const methodLabel = vocab.method === 'paraphrased' ? 'Paraphrased Method'
                      : vocab.method === 'verbatim' ? 'Verbatim Method'
                      : 'a strong hybrid approach';
    headline = `Excellent — ${band} (PTE ${pte}) achieved via the ${methodLabel}.`;
  } else if (rawScore >= 5.5) {
    tier = 'good';
    headline = `Solid attempt — ${band} (PTE ${pte}). One or two changes will push this to Band 9.`;
  } else if (rawScore >= 3.5) {
    tier = 'partial';
    headline = `Partial credit — ${band} (PTE ${pte}). Significant gaps to close.`;
  } else {
    tier = 'fail';
    headline = `${band} (PTE ${pte}) — major gaps. Focus on capturing the main ideas first.`;
  }

  const verdict = { tier, headline, pte, band, raw: rawScore, method: vocab.method };

  // ── STRENGTHS ────────────────────────────────────────────────────────────
  const strengths = [];

  if (contentScore === 2) {
    strengths.push({ icon: '🎯', label: 'All main ideas captured', detail: (contentVerdict.ideas_captured || []).join(' · ') });
  } else if (contentScore === 1 && (contentVerdict.ideas_captured || []).length > 0) {
    strengths.push({ icon: '✓', label: `Captured ${contentVerdict.ideas_captured.length} main idea${contentVerdict.ideas_captured.length > 1 ? 's' : ''}`, detail: contentVerdict.ideas_captured.join(' · ') });
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

  // Priority 1 — content
  if (contentScore === 0) {
    improvements.push({
      priority: 1,
      icon: '🚨',
      action: 'Re-read the passage and capture the main ideas',
      detail: 'Identify the What (topic), Why (reason), How (mechanism) and Result (outcome). Wrong ideas heavily cap the score (PTE 15 max).'
    });
  } else if (contentScore === 1) {
    const missing = (contentVerdict.ideas_missing || []).join(', ');
    improvements.push({
      priority: 1,
      icon: '⚠️',
      action: missing ? `Add the missing ideas: ${missing}` : 'Some main ideas are missing',
      detail: 'Score is partial-capped (PTE 50 ceiling) until all main ideas are included.'
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

  // Priority 3 — vocabulary (boost Reading skill)
  if (vocab.effective_credit < 4 && contentScore >= 1 && !vocab.meaning_changed) {
    const need = 4 - vocab.effective_credit;
    improvements.push({
      priority: 3,
      icon: '📚',
      action: `Replace ${need} more common word${need > 1 ? 's' : ''} with academic synonyms`,
      detail: 'Boosts Reading skill toward 90. Examples: made → opted, good → beneficial, important → crucial, change → transformation, show → demonstrate.'
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

  // Priority 4 — spelling
  if (spelling && spelling.count > 0) {
    const hints = (spelling.suggestions || []).slice(0, 3).map(s => `"${s.misspelled}" → "${s.suggestion}"`).join(', ');
    improvements.push({
      priority: 4,
      icon: '🔤',
      action: `${spelling.count} spelling error${spelling.count > 1 ? 's' : ''} (capped at -0.5 raw)`,
      detail: hints
    });
  }

  // ── METHOD COACHING ──────────────────────────────────────────────────────
  let methodCoaching = null;
  if (rawScore >= 6.5 && contentScore === 2) {
    if (vocab.method === 'verbatim') {
      methodCoaching = {
        current: 'Verbatim Method',
        next: vocab.effective_credit < 4
          ? 'Your Writing skill is at 90. To also push Reading toward 90, swap 4 common words for academic synonyms.'
          : 'Excellent execution. You are at the top of both skill ladders.'
      };
    } else if (vocab.method === 'paraphrased') {
      methodCoaching = {
        current: 'Paraphrased Method',
        next: 'Strong vocabulary work and idea coverage. Maintain the connector chain and you stay at Band 9.'
      };
    }
  } else if (rawScore < 6.5 && contentScore >= 1) {
    if (vocab.method === 'verbatim_weak') {
      methodCoaching = {
        current: 'Verbatim style without connectors',
        next: 'Pick a method and commit. Either: (1) Verbatim Method — keep passage lines but glue them with ; however, ; moreover, ; therefore. Or (2) Paraphrased Method — pick the right lines and replace 4 common words with academic synonyms. Both reach 90 if executed cleanly.'
      };
    } else if (vocab.method === 'hybrid') {
      methodCoaching = {
        current: 'Hybrid approach',
        next: 'Commit to one path. Verbatim Method (lift + connect) or Paraphrased Method (lift + 4 swaps + connect). Both reach 90; mixing them inconsistently leaves points on the table.'
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

function buildPenaltiesList(form, contentScore, vocab, spelling) {
  const arr = [];
  if (form.overflow_penalty) arr.push({ type: 'word_count_overflow', impact: -form.overflow_penalty, detail: form.warning });
  if (contentScore === 0) arr.push({ type: 'content_gate', impact: 'cap_at_PTE_15', detail: 'Main ideas missed — heavy cap' });
  else if (contentScore === 1) arr.push({ type: 'content_partial', impact: 'cap_at_PTE_50', detail: 'Some ideas missing — partial cap' });
  if (spelling.count > 0) arr.push({ type: 'spelling', impact: -0.5, detail: `${spelling.count} error(s), capped at -0.5 raw` });
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
      return res.json({
        trait_scores: { form: 0, content: 0, grammar: 0, vocabulary: 0 },
        content_details: { key_ideas_extracted: [], key_ideas_present: [], key_ideas_missing: [], notes: form.reason },
        grammar_details: { score: 0, has_connector: false, grammar_issues: [], connector_quality: 'missing' },
        vocabulary_details: { score: 0, notes: ['Form invalid'], safe_swaps: [], dangerous_swaps: [], meaning_changed: false, method: 'invalid' },
        skill_contributions: { reading: { estimate: 10, note: 'Form invalid' }, writing: { estimate: 10, note: 'Form invalid' } },
        paraphrase_analysis: { quality: 0, safeSwapCount: 0, dangerousSwapCount: 0 },
        overall_score: 10, raw_score: 0, band: 'Band 5',
        form_gate_triggered: true, form_reason: form.reason, word_count: form.wc,
        feedback: formFailCard.summary_line,
        feedback_card: formFailCard,
        improvement_tips: formFailCard.improvements.map(i => `${i.icon} ${i.action}`).join(' • '),
        first_person_detected: false, first_person_problematic: false,
        method_detected: 'invalid', llm_used: false, penalties_applied: [{ type: 'form_fail', impact: 'all_zero', detail: form.reason }],
        scoring_version: '19.0.0', mode: 'local'
      });
    }

    // ── LOCAL ANALYSIS (deterministic, fast) ──
    const verbatim = detectVerbatim(text, prompt);
    const swaps = analyzeSwaps(text, prompt);
    const firstPerson = detectFirstPerson(text, prompt);
    const grammar = checkGrammar(text, prompt);
    const spelling = checkSpelling(text, prompt);

    // ── CONTENT JUDGE: Claude first, local fallback ──
    let llmJudgment = null;
    try {
      llmJudgment = await judgeContentWithClaude(text, prompt, keyPoints);
    } catch (e) { /* swallow → fallback */ }
    const fallback = judgeContentLocal(text, prompt, keyPoints);
    const contentVerdict = llmJudgment || fallback;
    const contentScore = contentVerdict.content_score;

    // ── VOCABULARY (now informed by LLM judgment) ──
    const vocab = scoreVocabulary(verbatim, swaps, firstPerson, grammar, llmJudgment);

    // ── GRAMMAR — apply spelling penalty (capped at -0.5 raw, was -1 per error) ──
    let grammarScore = grammar.score;
    if (spelling.count >= 1) {
      grammarScore = Math.max(0, grammarScore - 0.5);
      const hints = spelling.suggestions.slice(0, 3).map(s => `"${s.misspelled}" → "${s.suggestion}"`).join(', ');
      grammar.grammar_issues.push(`Spelling: ${hints}`);
    }

    // ── COHESION ADJUSTMENT (LLM-driven) ──
    if (llmJudgment?.cohesion === 'weak' && grammarScore > 0.5) {
      grammarScore = Math.max(0, grammarScore - 0.5);
      grammar.grammar_issues.push('Clauses do not connect logically — review connector usage');
    }

    // ── RAW SCORE ASSEMBLY ──
    let rawScore = 1 + contentScore + grammarScore + vocab.score; // max 7

    // Soft word-count overflow
    if (form.overflow_penalty) rawScore -= form.overflow_penalty;

    // ── CONTENT GATE — heavy penalty for wrong ideas ──
    // Per user spec: wrong content → cap PTE 9–15 (essentially fail)
    if (contentScore === 0) rawScore = Math.min(rawScore, 1);
    // Partial content → cap at raw 4.5 (PTE ~56)
    else if (contentScore === 1 && rawScore > 4.5) rawScore = 4.5;

    rawScore = Math.max(0, Math.min(7, rawScore));
    const overallScore = rawToPTE(rawScore);
    const band = rawToBand(rawScore);

    const skillContributions = estimateSkillContributions(rawScore, contentScore, grammarScore, vocab.score, swaps, llmJudgment);
    const feedbackCard = buildFeedbackCard(contentVerdict, grammar, vocab, firstPerson, form, spelling, rawScore, contentScore, grammarScore, llmJudgment);
    const feedback = feedbackCard.summary_line;
    const improvementTips = feedbackCard.improvements.map(i => `${i.icon} ${i.action}`).join(' • ');

    const result = {
      trait_scores: {
        form: 1,
        content: contentScore,
        grammar: Math.round(grammarScore * 10) / 10,
        vocabulary: Math.round(vocab.score * 10) / 10
      },
      content_details: {
        key_ideas_extracted: [
          ...(contentVerdict.ideas_captured || []),
          ...(contentVerdict.ideas_missing || [])
        ],
        key_ideas_present: contentVerdict.ideas_captured || [],
        key_ideas_missing: contentVerdict.ideas_missing || [],
        notes: contentVerdict.content_reason,
        feels_connected: contentVerdict.cohesion ? contentVerdict.cohesion !== 'weak' : true,
        cohesion: contentVerdict.cohesion || 'unknown',
        feedback_note: contentVerdict.feedback_note || '',
        source: contentVerdict.source || 'local_fallback'
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
      penalties_applied: buildPenaltiesList(form, contentScore, vocab, spelling),
      llm_used: !!llmJudgment,
      scoring_version: '19.0.0',
      mode: llmJudgment ? 'claude' : 'local',
      vocabulary_suggestions: generateVocabSuggestions(text),
      spelling_details: {
        count: spelling.count,
        errors: spelling.suggestions.map(s => ({ misspelled: s.misspelled, suggestion: s.suggestion, source: 'passage' })),
        note: spelling.count > 0 ? `${spelling.count} spelling error${spelling.count > 1 ? 's' : ''} (capped at -0.5 raw)` : null
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
        .slice(0, 4)
        .map(s => ({
          word: s.word,
          context: s.context || '',
          synonyms: s.synonyms.slice(0, 3).filter(x => typeof x === 'string' && x.length > 0),
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
