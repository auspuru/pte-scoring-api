const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

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

const BAND_MAP = {
  0: 'Band 5', 1: 'Band 5',
  2: 'Band 6',
  3: 'Band 6.5',
  4: 'Band 7',
  5: 'Band 7.5',
  6: 'Band 8',
  7: 'Band 9'
};

// ─── NUMBER WORD NORMALISATION ───────────────────────────────────────────────
// Converts written numbers in student text to digits before matching.
// e.g. "fifty percent" -> "50", "half" -> "50"
// This prevents false failures when students paraphrase statistics.
const NUMBER_WORD_MAP = {
  'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
  'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9',
  'ten': '10', 'eleven': '11', 'twelve': '12', 'thirteen': '13',
  'fourteen': '14', 'fifteen': '15', 'sixteen': '16', 'seventeen': '17',
  'eighteen': '18', 'nineteen': '19', 'twenty': '20', 'thirty': '30',
  'forty': '40', 'fifty': '50', 'sixty': '60', 'seventy': '70',
  'eighty': '80', 'ninety': '90',
  'half': '50', 'quarter': '25', 'third': '33', 'double': '2', 'twice': '2'
};

function normaliseNumbers(text) {
  let t = text.toLowerCase();
  for (const [word, digit] of Object.entries(NUMBER_WORD_MAP)) {
    t = t.replace(new RegExp(`\\b${word}\\b`, 'g'), digit);
  }
  return t;
}

// ─── HTML STRIP (safety: frontend may pass unsanitised key point strings) ────
function stripHtml(text) {
  return (text || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// ─── EXTRACT KEY CONCEPTS FROM TEXT ─────────────────────────────────────────
function extractConcepts(text) {
  if (!text) return [];

  const concepts = [];

  // Numbers with optional units (e.g. $4 trillion, 75%, 2050)
  const numbers = text.match(/\$?\d+(?:\.\d+)?(?:\s*(?:billion|million|trillion))?%?/gi) || [];
  concepts.push(...numbers.map(n => n.toLowerCase().trim()).filter(n => n.length > 0));

  // Key terms — broad stop word filter
  const stopWords = new Set([
    'the','a','an','and','or','but','in','on','at','to','for','of','with','by',
    'is','are','was','were','be','been','have','has','had','will','would','could',
    'should','may','might','can','this','that','these','those','it','they','them',
    'their','there','then','than','as','so','also','about','up','out','down','off',
    'over','under','again','here','why','how','all','any','both','each','few',
    'more','most','other','some','such','no','nor','not','only','own','same','too',
    'very','just','because','while','through','during','before','after','above',
    'below','despite','without','within','between','into','from','its','our','we'
  ]);

  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  concepts.push(...new Set(words));

  return [...new Set(concepts)];
}

// ─── PLURAL NORMALISATION ────────────────────────────────────────────────────
// Simple s-stripping ("classes"→"classe") causes more false negatives than it
// fixes. Removed in v15 — normaliseNumbers() + fuzzy matching cover the real
// edge cases. A proper stemmer can be added later if needed.
function deplural(word) { return word; }  // identity — effectively disabled

// ─── FUZZY NUMBER MATCH ──────────────────────────────────────────────────────
// "50.0" matches "50"; allows ±1 unit tolerance for minor formatting differences.
function fuzzyNumberMatch(keyPointNumbers, studentNumbers) {
  for (const kn of keyPointNumbers) {
    const kVal = parseFloat(kn);
    for (const sn of studentNumbers) {
      const sVal = parseFloat(sn);
      if (!isNaN(kVal) && !isNaN(sVal) && Math.abs(kVal - sVal) <= 1) return true;
    }
  }
  return false;
}

// ─── CHECK IF KEY POINT IS PRESENT ──────────────────────────────────────────
function checkKeyPoint(studentText, keyPointText) {
  const cleanStudent  = stripHtml(studentText);
  const cleanKeyPoint = stripHtml(keyPointText);

  const student     = cleanStudent.toLowerCase().replace(/[^\w\s$%]/g, ' ');
  const studentNorm = normaliseNumbers(student);   // "fifty percent" -> "50"
  const keyPoint    = cleanKeyPoint.toLowerCase();

  const keyConcepts = extractConcepts(normaliseNumbers(cleanKeyPoint));

  // Adaptive thresholds: long key points lower both bars
  const isLong = keyConcepts.length > 15;
  const thresholds = {
    concept:  isLong ? 0.20 : 0.25,
    critical: isLong ? 0.30 : 0.35
  };

  // Concept matching with plural normalisation
  let matchedConcepts = 0;
  const matched = [];
  for (const concept of keyConcepts) {
    const c = concept.toLowerCase();
    if (studentNorm.includes(c) || studentNorm.includes(deplural(c))) {
      matchedConcepts++;
      matched.push(concept);
    }
  }
  const matchRate = keyConcepts.length > 0 ? matchedConcepts / keyConcepts.length : 0;

  // Critical terms: numbers + long words, with plural normalisation
  const numberTerms = (keyPoint.match(/\$?\d+(?:\.\d+)?(?:\s*(?:billion|million|trillion))?%?/gi) || [])
    .map(t => t.toLowerCase().trim());
  const longWords = keyPoint
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 5)
    .map(w => w.toLowerCase());
  const uniqueCriticalTerms = [...new Set([...numberTerms, ...longWords])].filter(t => t.length > 0);

  let matchedCritical = 0;
  for (const term of uniqueCriticalTerms) {
    if (studentNorm.includes(term) || studentNorm.includes(deplural(term))) matchedCritical++;
  }
  const criticalRate = uniqueCriticalTerms.length > 0 ? matchedCritical / uniqueCriticalTerms.length : 0;

  // Number gate: fuzzy ±1 match + written-number normalisation + strong-concept fallback
  const keyPointNumbers = (keyPoint.match(/\d+(?:\.\d+)?/g) || []);
  const studentNumbers  = (studentNorm.match(/\d+(?:\.\d+)?/g) || []);
  const hasNumbers      = keyPointNumbers.length > 0;
  const numberMatched   = hasNumbers ? fuzzyNumberMatch(keyPointNumbers, studentNumbers) : true;
  const strongConcept   = matchRate >= 0.40;
  const numberGatePassed = numberMatched || strongConcept;

  const isPresent = numberGatePassed && (
    matchRate    >= thresholds.concept  ||
    criticalRate >= thresholds.critical ||
    matchedCritical >= 2
  );

  return {
    present: isPresent,
    matchRate: Math.round(matchRate * 100),
    criticalRate: Math.round(criticalRate * 100),
    matchedConcepts: matched.slice(0, 5),
    totalConcepts: keyConcepts.length,
    matchedCritical,
    totalCritical: uniqueCriticalTerms.length,
    numberMatched,
    strongConceptFallback: strongConcept,
    numberGatePassed,
    thresholdUsed: thresholds
  };
}

// ─── VERBATIM DETECTION ─────────────────────────────────────────────────────
function detectVerbatim(studentText, passageText) {
  const student = studentText.toLowerCase().replace(/[^\w\s]/g, '');
  const passage = passageText.toLowerCase().replace(/[^\w\s]/g, '');
  
  const studentWords = student.split(/\s+/).filter(w => w.length > 3);
  
  if (studentWords.length === 0) return { verbatimRate: 0, isVerbatim: false };
  
  // Track matched word indices to avoid double-counting
  const matchedWords = new Set();
  const verbatimPhrases = [];
  
  // 4-word phrases first, then 3-word
  for (let i = 0; i < studentWords.length - 2; i++) {
    const phrase4 = studentWords.slice(i, i + 4).join(' ');
    const phrase3 = studentWords.slice(i, i + 3).join(' ');
    
    if (i <= studentWords.length - 4 && passage.includes(phrase4)) {
      for (let j = i; j < i + 4 && j < studentWords.length; j++) matchedWords.add(j);
      verbatimPhrases.push(phrase4);
      i += 3;
    } else if (passage.includes(phrase3)) {
      for (let j = i; j < i + 3 && j < studentWords.length; j++) matchedWords.add(j);
      verbatimPhrases.push(phrase3);
      i += 2;
    }
  }
  
  // Individual words (4+ chars) not yet matched
  for (let i = 0; i < studentWords.length; i++) {
    if (!matchedWords.has(i) && studentWords[i].length >= 4 && passage.includes(studentWords[i])) {
      matchedWords.add(i);
    }
  }
  
  const verbatimRate = (matchedWords.size / studentWords.length) * 100;
  
  return {
    verbatimRate: Math.round(verbatimRate),
    isVerbatim: verbatimRate > 95,
    phrases: [...new Set(verbatimPhrases)].slice(0, 5)
  };
}

// ─── FORM VALIDATION ────────────────────────────────────────────────────────
function validateForm(text) {
  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  const wc = words.length;
  
  if (wc < 5)  return { valid: false, score: 0, reason: 'Too short (min 5 words)', wc };
  if (wc > 75) return { valid: false, score: 0, reason: 'Too long (max 75 words)', wc };
  if (!/[.!?]$/.test(text.trim())) return { valid: false, score: 0, reason: 'Must end with period', wc };
  
  // Mask known abbreviations so they don't trigger false sentence splits
  const clean = text.replace(/(?:Dr|Mr|Mrs|Ms|Prof|U\.K|U\.S|i\.e|e\.g|etc)\./gi, '##');
  const sentences = (clean.match(/[.!?](\s|$)/g) || []).length;
  
  if (sentences !== 1) return { valid: false, score: 0, reason: 'Must be exactly one sentence', wc };
  
  return { valid: true, score: 1, reason: 'Valid', wc };
}

// ─── GRAMMAR CHECK ───────────────────────────────────────────────────────────
function checkGrammar(text) {
  const lower = text.toLowerCase();
  let score = 2;
  const issues = [];
  
  const connectors = [
    'however', 'therefore', 'moreover', 'furthermore', 'consequently',
    'thus', 'although', 'though', 'while', 'whereas'
  ];
  const hasConnector = connectors.some(c => lower.includes(c));
  const hasSemicolon = /;\s*(however|therefore|moreover|furthermore|consequently|thus|although|though)/i.test(text);
  
  if (!hasConnector) {
    issues.push('No connector detected - use however, therefore, etc.');
    score = 1;
  } else if (!hasSemicolon) {
    issues.push('Missing semicolon before connector');
    score = 1;
  }
  
  if (!/^[A-Z]/.test(text.trim())) {
    issues.push('Start with capital letter');
    score = Math.min(score, 1);
  }
  
  if (/(people|they|countries|nations)\s+(is|was)\b/i.test(text)) {
    issues.push('Subject-verb agreement error');
    score = 0;
  }
  
  const connectorType =
    lower.includes('however') || lower.includes('although') || lower.includes('though') || lower.includes('whereas') ? 'contrast' :
    lower.includes('therefore') || lower.includes('consequently') || lower.includes('thus') ? 'result' :
    lower.includes('moreover') || lower.includes('furthermore') ? 'addition' : 'none';

  return {
    score,
    has_connector: hasConnector,
    has_semicolon_before_connector: hasSemicolon,
    connector_type: connectorType,
    grammar_issues: issues
  };
}

// ─── VOCABULARY SCORING ──────────────────────────────────────────────────────
function scoreVocabulary(verbatimRate) {
  const paraphraseRate = 100 - verbatimRate;
  
  if (verbatimRate > 95) {
    return {
      score: 1,
      synonym_usage: 'excessive verbatim (>95%)',
      note: 'Try to paraphrase more',
      verbatim_rate: verbatimRate,
      paraphrase_rate: paraphraseRate
    };
  }
  
  return {
    score: 2,
    synonym_usage: 'acceptable',
    note: 'Verbatim copying is OK for PTE',
    verbatim_rate: verbatimRate,
    paraphrase_rate: paraphraseRate
  };
}

// ─── GENERATE FEEDBACK ───────────────────────────────────────────────────────
function generateFeedback(coverage, grammar, verbatim) {
  const presentCount = coverage.filter(c => c.present).length;
  const missing = coverage.filter(c => !c.present).map(c => c.type);
  
  let feedback = '';
  
  if (presentCount === 3)      feedback = 'Excellent! All 3 key ideas captured. ';
  else if (presentCount === 2) feedback = `Good! 2/3 key ideas. Missing: ${missing[0]}. `;
  else if (presentCount === 1) feedback = `Partial: 1/3 key ideas. Missing: ${missing.join(', ')}. `;
  else                         feedback = 'Critical: No key ideas found. Include topic, pivot, and conclusion. ';
  
  if (grammar.score === 2)      feedback += 'Grammar excellent. ';
  else if (grammar.score === 1) feedback += `${grammar.grammar_issues[0]}. `;
  else                          feedback += 'Grammar errors detected. ';
  
  if (verbatim.isVerbatim) feedback += 'Excessive verbatim (>90%) - try paraphrasing. ';
  
  return feedback.trim();
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'PTE SWT Scoring API v15.0.0',
    endpoints: ['/api/health', '/api/grade'],
    anthropicConfigured: !!anthropic
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '15.0.0', anthropicConfigured: !!anthropic });
});

app.post('/api/grade', async (req, res) => {
  try {
    const { text, type, prompt, keyPoints } = req.body;
    
    if (!text || !type || !prompt) {
      return res.status(400).json({ error: 'Missing fields: text, type, and prompt are required' });
    }

    const form = validateForm(text);

    // Strip HTML from key point strings defensively
    const topicText      = stripHtml(keyPoints?.topic      || '');
    const pivotText      = stripHtml(keyPoints?.pivot      || '');
    const conclusionText = stripHtml(keyPoints?.conclusion || '');
    
    if (!form.valid) {
      return res.json({
        trait_scores: { form: 0, content: 0, grammar: 0, vocabulary: 0 },
        content_details: {
          key_ideas_extracted: [topicText, pivotText, conclusionText],
          key_ideas_present: [],
          key_ideas_missing: ['topic', 'pivot', 'conclusion']
        },
        grammar_details: { score: 0, has_connector: false, grammar_issues: [] },
        vocabulary_details: { synonym_usage: 'none', verbatim_rate: '0%', paraphrase_rate: '100%' },
        overall_score: 10,
        raw_score: 0,
        band: 'Band 5',
        form_gate_triggered: true,
        form_reason: form.reason,
        word_count: form.wc,
        feedback: `FORM ERROR: ${form.reason}`,
        key_ideas_status: { topic: false, pivot: false, conclusion: false },
        mode: 'local'
      });
    }

    // Check each key point independently
    const topicCheck      = checkKeyPoint(text, topicText);
    const pivotCheck      = checkKeyPoint(text, pivotText);
    const conclusionCheck = checkKeyPoint(text, conclusionText);
    
    const coverage = [
      { type: 'topic',      present: topicCheck.present },
      { type: 'pivot',      present: pivotCheck.present },
      { type: 'conclusion', present: conclusionCheck.present }
    ];
    
    const presentCount = coverage.filter(c => c.present).length;
    const contentScore = presentCount >= 2 ? 2 : presentCount === 1 ? 1 : 0;
    
    const verbatim = detectVerbatim(text, prompt);
    const grammar  = checkGrammar(text);
    const vocab    = scoreVocabulary(verbatim.verbatimRate);
    
    const rawScore     = 1 + contentScore + grammar.score + vocab.score;
    const overallScore = Math.min(90, 10 + Math.round((rawScore / 7) * 80));
    const feedback     = generateFeedback(coverage, grammar, verbatim);

    res.json({
      trait_scores: {
        form: 1,
        content: contentScore,
        grammar: grammar.score,
        vocabulary: vocab.score
      },
      content_details: {
        // Safe truncation — no trailing '...' if text is short enough
        key_ideas_extracted: [
          topicText.length      > 60 ? topicText.substring(0, 60)      + '...' : topicText,
          pivotText.length      > 60 ? pivotText.substring(0, 60)      + '...' : pivotText,
          conclusionText.length > 60 ? conclusionText.substring(0, 60) + '...' : conclusionText
        ],
        key_ideas_present: coverage.filter(c =>  c.present).map(c => c.type),
        key_ideas_missing: coverage.filter(c => !c.present).map(c => c.type),
        notes: `${presentCount}/3 key ideas present`,
        // Full per-key-point debug detail for diagnosing edge cases
        key_point_details: {
          topic: {
            present:               topicCheck.present,
            matchRate:             topicCheck.matchRate,
            criticalRate:          topicCheck.criticalRate,
            matchedCritical:       topicCheck.matchedCritical,
            totalCritical:         topicCheck.totalCritical,
            matchedConcepts:       topicCheck.matchedConcepts,
            numberMatched:         topicCheck.numberMatched,
            strongConceptFallback: topicCheck.strongConceptFallback,
            numberGatePassed:      topicCheck.numberGatePassed
          },
          pivot: {
            present:               pivotCheck.present,
            matchRate:             pivotCheck.matchRate,
            criticalRate:          pivotCheck.criticalRate,
            matchedCritical:       pivotCheck.matchedCritical,
            totalCritical:         pivotCheck.totalCritical,
            matchedConcepts:       pivotCheck.matchedConcepts,
            numberMatched:         pivotCheck.numberMatched,
            strongConceptFallback: pivotCheck.strongConceptFallback,
            numberGatePassed:      pivotCheck.numberGatePassed
          },
          conclusion: {
            present:               conclusionCheck.present,
            matchRate:             conclusionCheck.matchRate,
            criticalRate:          conclusionCheck.criticalRate,
            matchedCritical:       conclusionCheck.matchedCritical,
            totalCritical:         conclusionCheck.totalCritical,
            matchedConcepts:       conclusionCheck.matchedConcepts,
            numberMatched:         conclusionCheck.numberMatched,
            strongConceptFallback: conclusionCheck.strongConceptFallback,
            numberGatePassed:      conclusionCheck.numberGatePassed
          }
        }
      },
      grammar_details: {
        score: grammar.score,
        has_connector: grammar.has_connector,
        connector_type: grammar.connector_type,
        has_semicolon_before_connector: grammar.has_semicolon_before_connector,
        grammar_issues: grammar.grammar_issues
      },
      vocabulary_details: {
        synonym_usage: vocab.synonym_usage,
        verbatim_rate: verbatim.verbatimRate + '%',
        paraphrase_rate: (100 - verbatim.verbatimRate) + '%',
        note: vocab.note
      },
      overall_score: overallScore,
      raw_score: rawScore,
      band: BAND_MAP[Math.min(7, Math.floor(rawScore))] || 'Band 5',
      word_count: form.wc,
      feedback,
      // IMPORTANT: Frontend must read these by NAME, not by array index
      key_ideas_status: {
        topic:      topicCheck.present,
        pivot:      pivotCheck.present,
        conclusion: conclusionCheck.present
      },
      mode: 'local'
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ PTE SWT Grader v15.0.0 on port ${PORT}`);
  console.log(`🤖 AI: ${anthropic ? 'ACTIVE' : 'LOCAL'}`);
});
