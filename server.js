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
const DATA_DIR = process.env.NODE_ENV === 'production' ? '/tmp' : './data';
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
  async saveProgress(userId, passageId, summary, scoreData) {
    const data = await this.readData();
    if (!data.users[userId]) data.users[userId] = { attempts: {}, stats: { totalAttempts: 0, averageScore: 0 } };
    data.users[userId].attempts[passageId] = { summary, score: scoreData, timestamp: new Date().toISOString() };
    const att = Object.values(data.users[userId].attempts);
    data.users[userId].stats.totalAttempts = att.length;
    data.users[userId].stats.averageScore = Math.round(att.reduce((s, a) => s + (a.score?.overall_score || 0), 0) / att.length);
    data.global.totalAttempts++;
    await this.writeData(data);
    return { success: true, userStats: data.users[userId].stats };
  },
  async getProgress(userId) {
    const data = await this.readData();
    return data.users[userId] || { attempts: {}, stats: { totalAttempts: 0, averageScore: 0 } };
  },
  async getLeaderboard(limit = 10) {
    const data = await this.readData();
    return Object.entries(data.users)
      .map(([id, u]) => ({ userId: id, averageScore: u.stats.averageScore, totalAttempts: u.stats.totalAttempts }))
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
  'increase':['decrease','decline','drop','fall','reduction','loss','shrinkage','contraction'],
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
  'growth':['decline','contraction','shrinkage','recession','stagnation','loss','reduction','decrease'],
  'decline':['growth','expansion','rise','increase','boom'],
  'profit':['loss','deficit','debt'],
  'loss':['profit','gain','surplus','revenue','increase','growth','rise','improvement','benefit'],
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
  const strongConcept = matchRate >= 0.35;
  const numberGatePassed = numberMatched || strongConcept;

  const isPresent = numberGatePassed && (matchRate >= thresholds.concept || criticalRate >= thresholds.critical || matchedCritical >= 2);

  return {
    present: isPresent, matchRate: Math.round(matchRate * 100), criticalRate: Math.round(criticalRate * 100),
    matchedConcepts: matched.slice(0, 8), totalConcepts: keyConcepts.length,
    matchedCritical, matchedCriticalTerms: matchedCriticalTerms.slice(0, 8), totalCritical: criticalTerms.length,
    numberMatched, strongConceptFallback: strongConcept, numberGatePassed, thresholdUsed: thresholds
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
// SYNONYM SWAP ANALYSIS — NEW LOGIC:
// 1. Detect which passage words the student replaced with synonyms
// 2. Check if replacements are MEANING-SAFE (from SAFE_SYNONYMS map)
// 3. Check if any replacements are MEANING-DANGEROUS (from MEANING_DANGER map)
// 4. Count valid swaps (meaning-safe) and dangerous swaps (meaning-changing)
// ═══════════════════════════════════════════════════════════════════════════════
function analyzeSwaps(studentText, passageText) {
  const studentWords = studentText.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2);
  const passageWordSet = new Set(passageText.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2));
  const studentWordSet = new Set(studentWords);

  // Words in student that are NOT in the passage (candidate replacements)
  const novelWords = studentWords.filter(w => !passageWordSet.has(w) && !STOP_WORDS.has(w) && w.length >= 3);

  // Detect meaning-safe swaps: student used a synonym of a passage word
  const safeSwaps = [];
  for (const [original, synonyms] of Object.entries(SAFE_SYNONYMS)) {
    if (passageWordSet.has(original)) {
      for (const syn of synonyms) {
        if (studentWordSet.has(syn) && !passageWordSet.has(syn)) {
          safeSwaps.push({ original, replacement: syn, type: 'safe' });
        }
      }
    }
  }

  // Detect meaning-dangerous swaps: student used an antonym/meaning-changer
  // CRITICAL: Only flag if the student REMOVED the original word AND added the antonym
  // E.g., passage has "minor disadvantages", student writes "major disadvantages" → flag
  // But passage has "minor disadvantages", student writes "minor...significant change" → NOT a flag
  const dangerousSwaps = [];
  for (const [original, antonyms] of Object.entries(MEANING_DANGER)) {
    if (passageWordSet.has(original) && !studentWordSet.has(original)) {
      // Original word was REMOVED by student — check if replaced with antonym
      for (const ant of antonyms) {
        if (studentWordSet.has(ant) && !passageWordSet.has(ant)) {
          dangerousSwaps.push({ original, replacement: ant, type: 'dangerous' });
        }
      }
    }
  }

  // Academic vocabulary used
  const ACADEMIC = new Set([
    'consequently','furthermore','moreover','nevertheless','predominantly','significantly',
    'substantially','fundamentally','paradigm','phenomenon','discourse','implications',
    'framework','methodology','synthesis','analysis','correlation','demonstrated','facilitated',
    'implemented','necessitate','acknowledges','encompasses','illustrates','transition',
    'transformation','evolution','proliferation','emergence','contemporary','comprehensive',
    'opted','acknowledged','advocated','cultivated','elucidated','emphasized','exemplified',
    'highlighted','posited','contended','beneficial','detrimental','pivotal','instrumental',
    'paramount','imperative','multifaceted'
  ]);
  const academicWordsUsed = [...new Set(studentWords.filter(w => ACADEMIC.has(w)))];

  return {
    safeSwaps,                        // [{original, replacement, type:'safe'}]
    dangerousSwaps,                   // [{original, replacement, type:'dangerous'}]
    safeSwapCount: safeSwaps.length,
    dangerousSwapCount: dangerousSwaps.length,
    academicWordsUsed,
    novelWords: [...new Set(novelWords)].slice(0, 10),
    novelWordRate: Math.round((new Set(novelWords).size / Math.max(1, studentWords.length)) * 100)
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
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
  const { safeSwaps, dangerousSwaps, safeSwapCount, dangerousSwapCount, academicWordsUsed } = swapData;
  const perspectiveShifted = firstPersonData.hasPerspectiveShift;

  let score = 2;
  let notes = [];
  let suggestion = null;
  let meaningChanged = false;

  // ── Rule 3: Meaning-changing swaps detected → HARD PENALTY ──
  if (dangerousSwapCount > 0) {
    meaningChanged = true;
    score = 0;
    notes.push(`⚠ MEANING CHANGED: ${dangerousSwaps.map(s => `"${s.original}" was replaced with "${s.replacement}" which reverses/alters the meaning`).join('; ')}`);
    suggestion = 'Your synonym changed the meaning of the original text. Use synonyms that preserve the same idea. E.g., "minor" → "small" (OK), but "minor" → "major" (changes meaning)';
  }
  // ── Rule 1 & 2: Check safe swap count ──
  else if (safeSwapCount >= 4) {
    // 4+ safe swaps — full vocab score regardless of verbatim rate
    score = 2;
    notes.push(`✓ ${safeSwapCount} meaning-safe synonym swaps detected — excellent vocabulary`);
  }
  else if (safeSwapCount >= 1 && safeSwapCount < 4) {
    // Some effort but not enough
    if (verbatimRate > 90) {
      score = 1;
      notes.push(`Only ${safeSwapCount} synonym swap${safeSwapCount > 1 ? 's' : ''} found (need 4+) with high verbatim`);
      suggestion = `You need at least 4 synonym swaps for full vocabulary marks. Replace more verbs/adjectives.`;
    } else {
      // Lower verbatim compensates for fewer explicit swaps
      score = 2;
      notes.push(`${safeSwapCount} synonym swap${safeSwapCount > 1 ? 's' : ''} with moderate paraphrasing`);
    }
  }
  else if (safeSwapCount === 0) {
    if (verbatimRate > 90) {
      // Pure copy with zero effort
      score = 1;
      notes.push('No synonym swaps detected with very high verbatim copying');
      suggestion = 'Replace at least 4 verbs or adjectives with synonyms. E.g., "made a choice" → "opted for a decision"';
    } else {
      // Low verbatim even without detected swaps — natural paraphrasing
      score = 2;
      notes.push('Acceptable vocabulary range — natural paraphrasing detected');
    }
  }

  // ── Rule 4: First-person penalty ──
  if (!meaningChanged && firstPersonData.isProblematic && score > 1) {
    score = 1;
    notes.push('⚠ First-person copied from passage — shift to "The author/narrator"');
    suggestion = suggestion || 'Change "I made" → "The author opted", "my wife" → "his wife"';
  }

  // ── Recognition badges ──
  if (perspectiveShifted) notes.push('✓ Proper perspective shift to third-person');
  if (academicWordsUsed.length >= 2) notes.push(`✓ Academic vocabulary: ${academicWordsUsed.slice(0, 3).join(', ')}`);
  if (safeSwaps.length > 0 && !meaningChanged) {
    notes.push(`✓ Smart swaps: ${safeSwaps.slice(0, 4).map(s => `"${s.original}" → "${s.replacement}"`).join(', ')}`);
  }

  return {
    score, verbatim_rate: verbatimRate,
    safe_swaps: safeSwaps, dangerous_swaps: dangerousSwaps,
    safe_swap_count: safeSwapCount, dangerous_swap_count: dangerousSwapCount,
    meaning_changed: meaningChanged,
    academic_words: academicWordsUsed, perspective_shifted: perspectiveShifted,
    notes, suggestion,
    breakdown: {
      verbatim_penalty: verbatimRate > 95 ? 'severe' : verbatimRate > 90 ? 'moderate' : 'none',
      swap_status: safeSwapCount >= 4 ? 'excellent' : safeSwapCount >= 1 ? 'partial' : 'none',
      meaning_danger: dangerousSwapCount > 0
    }
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
  else if (vocab.score === 2) parts.push(`Vocabulary excellent (${vocab.safe_swap_count} safe synonym swaps).`);
  else if (vocab.safe_swap_count < 4) parts.push(`Need ${4 - vocab.safe_swap_count} more synonym swaps for full vocab marks.`);

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
  } else if (vocabScore < 2 && vocab.safe_swap_count < 4) {
    tips.push(`VOCABULARY: Need ${4 - vocab.safe_swap_count} more synonym swaps. Replace verbs (made→opted, knew→acknowledged) and adjectives (good→beneficial, many→numerous) but keep nouns.`);
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
  res.json({ status: 'ok', version: '18.0.0', anthropicConfigured: !!anthropic, storage: 'file-based' });
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
    const contentScore = presentCount >= 2 ? 2 : presentCount === 1 ? 1 : 0;

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
        safe_swaps: vocab.safe_swaps, dangerous_swaps: vocab.dangerous_swaps,
        safe_swap_count: vocab.safe_swap_count, dangerous_swap_count: vocab.dangerous_swap_count,
        meaning_changed: vocab.meaning_changed,
        academic_words: vocab.academic_words, perspective_shifted: vocab.perspective_shifted,
        notes: vocab.notes, suggestion: vocab.suggestion, breakdown: vocab.breakdown
      },
      paraphrase_analysis: {
        quality: swaps.safeSwapCount >= 4 ? 100 : Math.round((swaps.safeSwapCount / 4) * 100),
        rating: swaps.safeSwapCount >= 4 ? 'strong' : swaps.safeSwapCount >= 2 ? 'moderate' : 'weak',
        swaps: swaps.safeSwaps, dangerous: swaps.dangerousSwaps,
        academic_words: swaps.academicWordsUsed, novel_words: swaps.novelWords,
        novel_word_rate: swaps.novelWordRate + '%', safeSwapCount: swaps.safeSwapCount, dangerousSwapCount: swaps.dangerousSwapCount
      },
      verbatim_analysis: { rate: verbatim.verbatimRate + '%', is_verbatim: verbatim.isVerbatim, longest_run: verbatim.longestRun },
      first_person_detected: firstPerson.detected, first_person_problematic: firstPerson.isProblematic,
      first_person_details: firstPerson,
      skill_contributions: skillContributions,
      overall_score: overallScore, raw_score: rawScore, band, word_count: form.wc,
      feedback, improvement_tips: improvementTips,
      key_ideas_status: { topic: tc.present, pivot: pc.present, conclusion: cc.present },
      scoring_version: '18.0.0', mode: 'local'
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
