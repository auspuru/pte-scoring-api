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

// ─── EXTRACT KEY CONCEPTS FROM TEXT ─────────────────────────────────────────
function extractConcepts(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  
  const concepts = [];
  
  // Numbers with units
  const numbers = text.match(/\d+%?|\$\d+(?:\.\d+)?(?:\s*(?:billion|million|trillion))?/gi) || [];
  concepts.push(...numbers);
  
  // Key terms - filter out stop words
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those', 'it', 'they', 'them', 'their', 'there', 'then', 'than', 'as', 'so', 'also', 'about', 'up', 'out', 'down', 'off', 'over', 'under', 'again', 'here', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'too', 'very', 'just', 'because', 'while', 'through', 'during', 'before', 'after', 'above', 'below']);
  
  const words = lower
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
  
  const uniqueWords = [...new Set(words)].slice(0, 15);
  concepts.push(...uniqueWords);
  
  return [...new Set(concepts)];
}

// ─── CHECK IF KEY POINT IS PRESENT ──────────────────────────────────────────
function checkKeyPoint(studentText, keyPointText) {
  if (!keyPointText || keyPointText.trim().length === 0) {
    return { present: false, matchRate: 0, phraseMatchRate: 0, matched: [], totalConcepts: 0 };
  }
  
  const student = studentText.toLowerCase().replace(/[^\w\s]/g, ' ');
  const keyPoint = keyPointText.toLowerCase().replace(/[^\w\s]/g, ' ');
  
  const studentWords = student.split(/\s+/).filter(w => w.length > 0);
  const keyWords = keyPoint.split(/\s+/).filter(w => w.length > 0);
  
  // Filter out common stop words for meaningful comparison
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those', 'it', 'they', 'them', 'their', 'there', 'then', 'than', 'as', 'so', 'also', 'about', 'up', 'out', 'down', 'off', 'over', 'under', 'again', 'here', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'too', 'very', 'just', 'because', 'while', 'through', 'during', 'before', 'after', 'above', 'below', 'into', 'onto', 'upon', 'within', 'without']);
  
  // Get meaningful words (4+ chars, not stop words) from key point
  const meaningfulKeyWords = [...new Set(keyWords.filter(w => w.length >= 4 && !stopWords.has(w)))];
  
  if (meaningfulKeyWords.length === 0) {
    return { present: false, matchRate: 0, phraseMatchRate: 0, matched: [], totalConcepts: 0 };
  }
  
  // Count how many meaningful words from key point appear in student text
  let matchedWords = 0;
  const matched = [];
  
  for (const word of meaningfulKeyWords) {
    if (student.includes(word)) {
      matchedWords++;
      matched.push(word);
    }
  }
  
  const wordMatchRate = matchedWords / meaningfulKeyWords.length;
  
  // Check for phrase matches (3+ word sequences) - more reliable indicator
  const keyPhrases = [];
  for (let i = 0; i < keyWords.length - 2; i++) {
    const phrase3 = keyWords.slice(i, i + 3).join(' ');
    const phrase4 = keyWords.slice(i, i + 4).join(' ');
    if (i <= keyWords.length - 4) {
      keyPhrases.push(phrase4);
    }
    keyPhrases.push(phrase3);
  }
  
  let matchedPhrases = 0;
  const matchedPhraseList = [];
  for (const phrase of keyPhrases) {
    if (student.includes(phrase)) {
      matchedPhrases++;
      matchedPhraseList.push(phrase);
    }
  }
  
  const phraseMatchRate = keyPhrases.length > 0 ? matchedPhrases / keyPhrases.length : 0;
  
  // STRICT CRITERIA: Must have either:
  // - 60%+ word match AND at least 1 phrase match, OR
  // - 40%+ phrase match rate (strong indicator of the actual sentence)
  const hasStrongWordMatch = wordMatchRate >= 0.60 && matchedPhrases >= 1;
  const hasStrongPhraseMatch = phraseMatchRate >= 0.40;
  
  const isPresent = hasStrongWordMatch || hasStrongPhraseMatch;
  
  return {
    present: isPresent,
    matchRate: Math.round(wordMatchRate * 100),
    phraseMatchRate: Math.round(phraseMatchRate * 100),
    matched: matched.slice(0, 5),
    totalConcepts: meaningfulKeyWords.length,
    matchedPhrases: matchedPhraseList.slice(0, 3)
  };
}

// ─── VERBATIM DETECTION ─────────────────────────────────────────────────────
function detectVerbatim(studentText, passageText) {
  const student = studentText.toLowerCase().replace(/[^\w\s]/g, '');
  const passage = passageText.toLowerCase().replace(/[^\w\s]/g, '');
  
  const studentWords = student.split(/\s+/).filter(w => w.length > 3);
  
  if (studentWords.length === 0) return { verbatimRate: 0, isVerbatim: false };
  
  // Track which words have been matched (to avoid double counting)
  const matchedWords = new Set();
  const verbatimPhrases = [];
  
  // Check for 3+ word phrases first (longer phrases take priority)
  for (let i = 0; i < studentWords.length - 2; i++) {
    const phrase4 = studentWords.slice(i, i + 4).join(' ');
    const phrase3 = studentWords.slice(i, i + 3).join(' ');
    
    if (i <= studentWords.length - 4 && passage.includes(phrase4)) {
      // Mark these 4 words as matched
      for (let j = i; j < i + 4 && j < studentWords.length; j++) {
        matchedWords.add(j);
      }
      verbatimPhrases.push(phrase4);
      i += 3; // Skip ahead
    } else if (passage.includes(phrase3)) {
      // Mark these 3 words as matched
      for (let j = i; j < i + 3 && j < studentWords.length; j++) {
        matchedWords.add(j);
      }
      verbatimPhrases.push(phrase3);
      i += 2; // Skip ahead
    }
  }
  
  // Check individual words (4+ chars) that haven't been matched yet
  for (let i = 0; i < studentWords.length; i++) {
    if (!matchedWords.has(i) && studentWords[i].length >= 4 && passage.includes(studentWords[i])) {
      matchedWords.add(i);
    }
  }
  
  // Calculate verbatim rate - each word counted only once
  const verbatimRate = (matchedWords.size / studentWords.length) * 100;
  
  return {
    verbatimRate: Math.round(verbatimRate),
    isVerbatim: verbatimRate > 90,
    phrases: [...new Set(verbatimPhrases)].slice(0, 5)
  };
}

// ─── FORM VALIDATION ────────────────────────────────────────────────────────
function validateForm(text) {
  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  const wc = words.length;
  
  if (wc < 5) return { valid: false, score: 0, reason: 'Too short (min 5 words)', wc };
  if (wc > 75) return { valid: false, score: 0, reason: 'Too long (max 75 words)', wc };
  if (!/[.!?]$/.test(text.trim())) return { valid: false, score: 0, reason: 'Must end with period', wc };
  
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
  
  const connectors = ['however', 'therefore', 'moreover', 'furthermore', 'consequently', 'thus', 'although', 'though', 'while', 'whereas', 'because', 'since'];
  const hasConnector = connectors.some(c => lower.includes(c));
  
  // Check for proper connector usage (semicolon OR comma acceptable)
  const hasSemicolonConnector = /;\s*(however|therefore|moreover|furthermore|consequently|thus|although|though)/i.test(text);
  const hasCommaConnector = /,\s*(however|therefore|moreover|furthermore|consequently|thus|although|though)/i.test(text);
  
  if (!hasConnector) {
    issues.push('No connector detected - use however, therefore, etc.');
    score = 1;
  } else if (!hasSemicolonConnector && !hasCommaConnector) {
    issues.push('Add comma or semicolon before connector');
    // Don't penalize as heavily - just a minor issue
    score = 2;
  }
  
  if (!/^[A-Z]/.test(text.trim())) {
    issues.push('Start with capital letter');
    score = Math.min(score, 1);
  }
  
  if (/(people|they|countries|nations)\s+(is|was)\b/i.test(text)) {
    issues.push('Subject-verb agreement error');
    score = 0;
  }
  
  return {
    score,
    has_connector: hasConnector,
    has_semicolon_before_connector: hasSemicolonConnector,
    connector_type: lower.includes('however') ? 'contrast' : lower.includes('therefore') ? 'result' : 'none',
    grammar_issues: issues
  };
}

// ─── VOCABULARY SCORING ──────────────────────────────────────────────────────
function scoreVocabulary(verbatimRate) {
  const paraphraseRate = 100 - verbatimRate;
  
  if (verbatimRate > 90) {
    return { 
      score: 1, 
      synonym_usage: 'excessive verbatim (>90%)', 
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
  
  if (presentCount === 3) feedback = 'Excellent! All 3 key ideas captured. ';
  else if (presentCount === 2) feedback = `Good! 2/3 key ideas. Missing: ${missing[0]}. `;
  else if (presentCount === 1) feedback = `Partial: 1/3 key ideas. Missing: ${missing.join(', ')}. `;
  else feedback = 'Critical: No key ideas found. Include topic, pivot, and conclusion. ';
  
  if (grammar.score === 2) feedback += 'Grammar excellent. ';
  else if (grammar.score === 1) feedback += `${grammar.grammar_issues[0] || 'Minor grammar issue'}. `;
  else feedback += 'Grammar errors. ';
  
  if (verbatim.isVerbatim) feedback += 'Excessive verbatim (>90%) - try paraphrasing. ';
  
  return feedback.trim();
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '10.1.0', anthropicConfigured: !!anthropic });
});

app.post('/api/grade', async (req, res) => {
  try {
    const { text, type, prompt, keyPoints } = req.body;
    
    if (!text || !type || !prompt) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const form = validateForm(text);
    const topicText = keyPoints?.topic || '';
    const pivotText = keyPoints?.pivot || '';
    const conclusionText = keyPoints?.conclusion || '';
    
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

    // Check each key point (sequence doesn't matter)
    const topicCheck = checkKeyPoint(text, topicText);
    const pivotCheck = checkKeyPoint(text, pivotText);
    const conclusionCheck = checkKeyPoint(text, conclusionText);
    
    const coverage = [
      { type: 'topic', present: topicCheck.present, details: topicCheck },
      { type: 'pivot', present: pivotCheck.present, details: pivotCheck },
      { type: 'conclusion', present: conclusionCheck.present, details: conclusionCheck }
    ];
    
    // Content scoring
    const presentCount = coverage.filter(c => c.present).length;
    let contentScore = presentCount === 3 ? 2 : presentCount === 2 ? 1 : 0;
    
    // Verbatim detection
    const verbatim = detectVerbatim(text, prompt);
    
    // Grammar
    const grammar = checkGrammar(text);
    
    // Vocabulary
    const vocab = scoreVocabulary(verbatim.verbatimRate);
    
    // Totals
    const rawScore = 1 + contentScore + grammar.score + vocab.score;
    const overallScore = Math.min(90, 10 + Math.round((rawScore / 7) * 80));
    
    // Feedback
    const feedback = generateFeedback(coverage, grammar, verbatim);

    res.json({
      trait_scores: {
        form: 1,
        content: contentScore,
        grammar: grammar.score,
        vocabulary: vocab.score
      },
      content_details: {
        key_ideas_extracted: [
          topicText.substring(0, 80) + (topicText.length > 80 ? '...' : ''),
          pivotText.substring(0, 80) + (pivotText.length > 80 ? '...' : ''),
          conclusionText.substring(0, 80) + (conclusionText.length > 80 ? '...' : '')
        ],
        key_ideas_present: coverage.filter(c => c.present).map(c => c.type),
        key_ideas_missing: coverage.filter(c => !c.present).map(c => c.type),
        notes: `${presentCount}/3 key ideas present`,
        topic_match: { wordRate: topicCheck.matchRate, phraseRate: topicCheck.phraseMatchRate, matched: topicCheck.matched },
        pivot_match: { wordRate: pivotCheck.matchRate, phraseRate: pivotCheck.phraseMatchRate, matched: pivotCheck.matched },
        conclusion_match: { wordRate: conclusionCheck.matchRate, phraseRate: conclusionCheck.phraseMatchRate, matched: conclusionCheck.matched }
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
      feedback: feedback,
      key_ideas_status: {
        topic: topicCheck.present,
        pivot: pivotCheck.present,
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
  console.log(`✅ PTE SWT Grader v10.1.0 on port ${PORT}`);
  console.log(`🤖 AI: ${anthropic ? 'ACTIVE' : 'LOCAL'}`);
});
