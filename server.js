const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
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
// SCORING CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════
const BAND_MAP = { 0:'Band 5',1:'Band 5',2:'Band 6',3:'Band 6.5',4:'Band 7',5:'Band 7.5',6:'Band 8',7:'Band 9' };
const RAW_TO_PTE = { 0:10,1:15,2:28,3:38,4:50,5:62,6:76,7:90 };

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
  for (const [original, antonyms] of Object.entries(MEANING_DANGER)) {
    if (passageWordSet.has(original) && !studentWordSet.has(original)) {
      for (const ant of antonyms) {
        if (studentWordSet.has(ant) && !passageWordSet.has(ant)) dangerousSwaps.push({ original, replacement: ant, type: 'dangerous' });
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
  if (wc < 5)  return { valid: false, score: 0, reason: 'Too short (min 5 words)', wc };
  if (wc > 75) return { valid: false, score: 0, reason: 'Too long (max 75 words)', wc };
  if (!/[.!?]$/.test(text.trim())) return { valid: false, score: 0, reason: 'Must end with period', wc };
  const clean = text.replace(/\b(?:Dr|Mrs|Mr|Ms|Prof|Jr|Sr|St|etc|vs|approx|govt|Inc|Corp|Ltd|Vol|No|Fig)\./gi, '##')
                     .replace(/\b(?:U\.K|U\.S|i\.e|e\.g|a\.m|p\.m)\b\.?/gi, '##');
  const sentences = (clean.match(/[.!?](\s|$)/g) || []).length;
  if (sentences !== 1) return { valid: false, score: 0, reason: `Must be exactly one sentence (found ${sentences})`, wc };
  return { valid: true, score: 1, reason: 'Valid', wc };
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
// VOCABULARY SCORING — FINAL LOGIC:
//
// Rule 1: Verbatim is FINE as long as student has 4+ meaning-safe synonym swaps → 2/2
// Rule 2: Verbatim with <4 safe swaps → 1/2
// Rule 3: If synonyms CHANGE meaning (antonyms/meaning-reversing) → penalize to 0/2
// Rule 4: First-person from passage without perspective shift → cap at 1/2
// Rule 5: Pure gibberish / off-topic → 0/2
// ═══════════════════════════════════════════════════════════════════════════════
function scoreVocabulary(verbatimData, swapData, firstPersonData) {
  const { verbatimRate } = verbatimData;
  const { safeSwaps, structuralChanges, dangerousSwaps, safeSwapCount, structuralCount, totalParaphraseCredit, dangerousSwapCount, academicWordsUsed } = swapData;
  const perspectiveShifted = firstPersonData.hasPerspectiveShift;
  const effectiveCredit = safeSwapCount + structuralCount;

  let score = 2; // Default: copy-paste is FINE
  let notes = [];
  let suggestion = null;
  let meaningChanged = false;

  // ── ONLY penalty 1: Meaning-changing swaps → V:0 ──
  if (dangerousSwapCount > 0) {
    meaningChanged = true; score = 0;
    notes.push(`⚠ MEANING CHANGED: ${dangerousSwaps.map(s => `"${s.original}" → "${s.replacement}" reverses meaning`).join('; ')}`);
    suggestion = 'Your synonym changed the meaning. "minor" → "small" (OK), "minor" → "major" (WRONG).';
  }

  // ── ONLY penalty 2: First-person copy without shift → cap V:1 ──
  if (!meaningChanged && firstPersonData.isProblematic && score > 1) {
    score = 1;
    notes.push('⚠ First-person copied — shift to "The author/narrator"');
    suggestion = 'Change "I made" → "The author opted", "my wife" → "his wife"';
  }

  // ── Recognition notes (informational, no score impact) ──
  if (effectiveCredit >= 4) notes.push(`✓ ${effectiveCredit} paraphrasing credits — excellent vocabulary`);
  else if (effectiveCredit >= 2) notes.push(`${effectiveCredit} paraphrasing credits — good vocabulary`);
  else if (effectiveCredit === 1) notes.push('1 paraphrasing credit detected');
  else if (!meaningChanged) notes.push('Verbatim response accepted — add synonym swaps for even better scores');

  if (perspectiveShifted) notes.push('✓ Perspective shift to third-person');
  if (academicWordsUsed.length >= 2) notes.push(`✓ Academic: ${academicWordsUsed.slice(0, 3).join(', ')}`);
  if (safeSwaps.length > 0 && !meaningChanged) notes.push(`✓ Swaps: ${safeSwaps.slice(0, 4).map(s => `"${s.original}" → "${s.replacement}"`).join(', ')}`);
  if (structuralChanges.length > 0 && !meaningChanged) notes.push(`✓ Structural: ${structuralChanges.map(s => s.detail).join(', ')}`);

  // Suggestion for improvement (no score penalty)
  if (!meaningChanged && !suggestion && effectiveCredit < 4) {
    suggestion = 'Tip: Replace verbs/adjectives with synonyms (made→opted, good→beneficial) for stronger vocabulary demonstration.';
  }

  return {
    score, verbatim_rate: verbatimRate,
    safe_swaps: safeSwaps, structural_changes: structuralChanges, dangerous_swaps: dangerousSwaps,
    safe_swap_count: safeSwapCount, structural_count: structuralCount,
    effective_credit: effectiveCredit, total_paraphrase_credit: effectiveCredit,
    dangerous_swap_count: dangerousSwapCount, meaning_changed: meaningChanged,
    academic_words: academicWordsUsed, perspective_shifted: perspectiveShifted,
    notes, suggestion,
    breakdown: { verbatim_penalty: 'none', swap_status: effectiveCredit >= 4 ? 'excellent' : effectiveCredit >= 1 ? 'partial' : 'none', meaning_danger: dangerousSwapCount > 0 }
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// READING/WRITING CONTRIBUTION ESTIMATOR
// ═══════════════════════════════════════════════════════════════════════════════
function estimateSkillContributions(rawScore, contentScore, grammarScore, vocabScore) {
  const readingRaw = contentScore + Math.min(1, vocabScore);
  const writingRaw = grammarScore + vocabScore + 1;
  return {
    reading: {
      estimate: Math.min(90, Math.max(10, Math.round((readingRaw / 3) * 90))),
      components: { content: contentScore, vocabulary_partial: Math.min(1, vocabScore) },
      note: contentScore >= 2 ? 'Strong — all key ideas captured' : contentScore === 1 ? 'Moderate — some key ideas missing' : 'Weak — key ideas not detected'
    },
    writing: {
      estimate: Math.min(90, Math.max(10, Math.round((writingRaw / 5) * 90))),
      components: { grammar: grammarScore, vocabulary: vocabScore, form: 1 },
      note: writingRaw >= 4 ? 'Strong — good grammar and vocabulary' : writingRaw >= 3 ? 'Moderate — improve grammar or vocabulary' : 'Weak — needs better grammar and word choice'
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

// ═══ GRADING ROUTE ═══
app.post('/api/grade', async (req, res) => {
  try {
    const { text, type, prompt, keyPoints, userId } = req.body;
    if (!text || !type || !prompt) return res.status(400).json({ error: 'Missing fields' });

    const form = validateForm(text);
    const topicText = stripHtml(keyPoints?.topic || '');
    const pivotText = stripHtml(keyPoints?.pivot || '');
    const conclusionText = stripHtml(keyPoints?.conclusion || '');

    if (!form.valid) {
      return res.json({
        trait_scores: { form: 0, content: 0, grammar: 0, vocabulary: 0 },
        content_details: { key_ideas_extracted: [topicText, pivotText, conclusionText], key_ideas_present: [], key_ideas_missing: ['topic','pivot','conclusion'] },
        grammar_details: { score: 0, has_connector: false, grammar_issues: [], connector_quality: 'missing' },
        vocabulary_details: { score: 0, notes: ['Form invalid'], safe_swaps: [], dangerous_swaps: [], meaning_changed: false },
        skill_contributions: { reading: { estimate: 10 }, writing: { estimate: 10 } },
        paraphrase_analysis: { quality: 0, safeSwapCount: 0, dangerousSwapCount: 0 },
        overall_score: 10, raw_score: 0, band: 'Band 5',
        form_gate_triggered: true, form_reason: form.reason, word_count: form.wc,
        feedback: `FORM ERROR: ${form.reason}`, improvement_tips: 'Fix form first.',
        first_person_detected: false, first_person_problematic: false, scoring_version: '18.0.0', mode: 'local'
      });
    }

    const tc = checkKeyPoint(text, topicText);
    const pc = checkKeyPoint(text, pivotText);
    const cc = checkKeyPoint(text, conclusionText);
    const coverage = [{ type:'topic', present:tc.present },{ type:'pivot', present:pc.present },{ type:'conclusion', present:cc.present }];
    const presentCount = coverage.filter(c => c.present).length;
    const contentScore = presentCount >= 3 ? 2 : presentCount >= 1 ? 1 : 0;

    const verbatim = detectVerbatim(text, prompt);
    const swaps = analyzeSwaps(text, prompt);
    const firstPerson = detectFirstPerson(text, prompt);
    const grammar = checkGrammar(text, prompt);
    const vocab = scoreVocabulary(verbatim, swaps, firstPerson);

    const rawScore = 1 + contentScore + grammar.score + vocab.score;
    const overallScore = RAW_TO_PTE[Math.min(7, rawScore)] || 10;
    const band = BAND_MAP[Math.min(7, rawScore)] || 'Band 5';
    const skillContributions = estimateSkillContributions(rawScore, contentScore, grammar.score, vocab.score);
    const feedback = generateFeedback(coverage, grammar, vocab, firstPerson);
    const improvementTips = generateImprovementTips(rawScore, contentScore, grammar.score, vocab.score, grammar, vocab);

    const result = {
      trait_scores: { form: 1, content: contentScore, grammar: grammar.score, vocabulary: vocab.score },
      content_details: {
        key_ideas_extracted: [topicText.substring(0,60), pivotText.substring(0,60), conclusionText.substring(0,60)],
        key_ideas_present: coverage.filter(c => c.present).map(c => c.type),
        key_ideas_missing: coverage.filter(c => !c.present).map(c => c.type),
        notes: `${presentCount}/3 key ideas present`,
        key_point_details: { topic: tc, pivot: pc, conclusion: cc }
      },
      grammar_details: {
        score: grammar.score, has_connector: grammar.has_connector, connector_used: grammar.connector_used,
        connector_type: grammar.connector_type, connector_quality: grammar.connector_quality,
        has_semicolon_before_connector: grammar.has_semicolon_before_connector,
        grammar_issues: grammar.grammar_issues, first_person: grammar.first_person
      },
      vocabulary_details: {
        score: vocab.score, verbatim_rate: vocab.verbatim_rate + '%',
        safe_swaps: vocab.safe_swaps, structural_changes: vocab.structural_changes || [], dangerous_swaps: vocab.dangerous_swaps,
        safe_swap_count: vocab.total_paraphrase_credit, structural_count: vocab.structural_count || 0,
        dangerous_swap_count: vocab.dangerous_swap_count,
        meaning_changed: vocab.meaning_changed,
        academic_words: vocab.academic_words, perspective_shifted: vocab.perspective_shifted,
        notes: vocab.notes, suggestion: vocab.suggestion, breakdown: vocab.breakdown
      },
      paraphrase_analysis: {
        quality: swaps.totalParaphraseCredit >= 4 ? 100 : Math.round((swaps.totalParaphraseCredit / 4) * 100),
        rating: swaps.totalParaphraseCredit >= 4 ? 'strong' : swaps.totalParaphraseCredit >= 2 ? 'moderate' : 'weak',
        swaps: swaps.safeSwaps, dangerous: swaps.dangerousSwaps,
        academic_words: swaps.academicWordsUsed, novel_words: swaps.novelWords,
        novel_word_rate: swaps.novelWordRate + '%', safeSwapCount: swaps.safeSwapCount, structuralCount: swaps.structuralCount, totalCredit: swaps.totalParaphraseCredit, dangerousSwapCount: swaps.dangerousSwapCount
      },
      verbatim_analysis: { rate: verbatim.verbatimRate + '%', is_verbatim: verbatim.isVerbatim, longest_run: verbatim.longestRun },
      first_person_detected: firstPerson.detected, first_person_problematic: firstPerson.isProblematic,
      first_person_details: firstPerson,
      skill_contributions: skillContributions,
      overall_score: overallScore, raw_score: rawScore, band, word_count: form.wc,
      feedback, improvement_tips: improvementTips,
      key_ideas_status: { topic: tc.present, pivot: pc.present, conclusion: cc.present },
      scoring_version: '18.0.0', mode: 'local',
      vocabulary_suggestions: generateVocabSuggestions(text)
    };

    if (userId && req.body.passageId) {
      try { await StorageAPI.saveProgress(userId, req.body.passageId, text, result); result.saved = true; }
      catch (e) { result.saved = false; }
    }

    res.json(result);
  } catch (error) {
    console.error('Error:', error);
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
  console.log(`🤖 AI: ${anthropic ? 'ACTIVE' : 'LOCAL'}`);
  console.log(`💾 Storage: ${DATA_DIR}/pte_data.json`);
});
