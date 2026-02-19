const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// ─── CORS ────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));

// Initialize Anthropic
let anthropic = null;
if (ANTHROPIC_API_KEY && ANTHROPIC_API_KEY.startsWith('sk-ant-')) {
  anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
}

// ─── BAND MAP ────────────────────────────────────────────────────────────────
const BAND_MAP = {
  0: 'Band 5', 1: 'Band 5',
  2: 'Band 6',
  3: 'Band 6.5',
  4: 'Band 7',
  5: 'Band 7.5',
  6: 'Band 8',
  7: 'Band 9'
};

// ─── RATE LIMITER ────────────────────────────────────────────────────────────
const requestCounts = new Map();
app.use((req, res, next) => {
  if (req.path !== '/api/grade') return next();
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const windowStart = now - 60000;

  for (const [key, time] of requestCounts) {
    if (time < windowStart) requestCounts.delete(key);
  }

  const count = Array.from(requestCounts.entries())
    .filter(([key]) => key.startsWith(ip))
    .length;

  if (count >= 10) {
    return res.status(429).json({ error: 'Too many requests. Max 10 grades per minute.' });
  }
  requestCounts.set(`${ip}-${now}`, now);
  next();
});

// ─── CACHE ───────────────────────────────────────────────────────────────────
const gradeCache = new Map();
const MAX_CACHE = 500;
function getCached(key) { return gradeCache.get(key) || null; }
function setCache(key, value) {
  if (gradeCache.size >= MAX_CACHE) {
    const firstKey = gradeCache.keys().next().value;
    gradeCache.delete(firstKey);
  }
  gradeCache.set(key, value);
}

// ─── SMART PASSAGE ANALYZER ──────────────────────────────────────────────────
function analyzePassageStructure(passage) {
  if (!passage) return null;
  
  const lower = passage.toLowerCase();
  const sentences = passage.match(/[^.!?]+[.!?]+/g) || [passage];
  
  // Initialize structure
  const structure = {
    topic: { text: '', keywords: [], sentence: 0 },
    pivot: { text: '', keywords: [], sentence: 0 },
    conclusion: { text: '', keywords: [], sentence: 0 }
  };
  
  // TOPIC DETECTION (Usually first 1-2 sentences, contains main subject)
  const topicIndicators = ['economic', 'cost', 'gdp', 'climate', 'study', 'research', 'report', 'survey', 'analysis', 'data'];
  for (let i = 0; i < Math.min(2, sentences.length); i++) {
    const sent = sentences[i].toLowerCase();
    if (topicIndicators.some(ind => sent.includes(ind))) {
      structure.topic.text = sentences[i].trim();
      structure.topic.keywords = extractKeywords(sentences[i]);
      structure.topic.sentence = i;
      break;
    }
  }
  if (!structure.topic.text && sentences[0]) {
    structure.topic.text = sentences[0].trim();
    structure.topic.keywords = extractKeywords(sentences[0]);
  }
  
  // PIVOT DETECTION (Contrast, problem, shift, injustice, "however", numbers showing disparity)
  const pivotIndicators = ['however', 'but', 'although', 'though', 'while', 'yet', 'despite', 'nevertheless', 'bear', 'burden', 'justice', 'unfair', 'disparity', 'contributing less', 'despite'];
  
  for (let i = 1; i < sentences.length - 1; i++) {
    const sent = sentences[i].toLowerCase();
    // Look for contrast words OR injustice patterns (e.g., "despite X, Y")
    if (pivotIndicators.some(ind => sent.includes(ind)) || 
        (sent.includes('despite') && sent.includes('will')) ||
        (sent.includes('bear') && sent.includes('cost'))) {
      structure.pivot.text = sentences[i].trim();
      structure.pivot.keywords = extractKeywords(sentences[i]);
      structure.pivot.sentence = i;
      break;
    }
  }
  
  // CONCLUSION DETECTION (Last 1-2 sentences, solution, future, therefore, investment, hope)
  const conclusionIndicators = ['therefore', 'thus', 'consequently', 'solution', 'hope', 'future', 'investment', 'transition', 'renewable', 'answer', 'requires'];
  
  for (let i = sentences.length - 1; i >= Math.max(0, sentences.length - 2); i--) {
    const sent = sentences[i].toLowerCase();
    if (conclusionIndicators.some(ind => sent.includes(ind)) || sent.includes('$') || sent.includes('%')) {
      structure.conclusion.text = sentences[i].trim();
      structure.conclusion.keywords = extractKeywords(sentences[i]);
      structure.conclusion.sentence = i;
      break;
    }
  }
  if (!structure.conclusion.text && sentences.length > 2) {
    structure.conclusion.text = sentences[sentences.length - 1].trim();
    structure.conclusion.keywords = extractKeywords(sentences[sentences.length - 1]);
  }
  
  return structure;
}

function extractKeywords(text) {
  if (!text) return [];
  // Extract important words (nouns, numbers, key verbs) - simplified
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3)
    .filter(w => !['this', 'that', 'with', 'from', 'have', 'been', 'were', 'they', 'their', 'than', 'when', 'where', 'what', 'that', 'which', 'while', 'about'].includes(w));
  
  // Prioritize numbers, percentages, currency
  const numbers = text.match(/\d+%?|\$\d+|\d+\s*(billion|trillion|million)/gi) || [];
  
  return [...new Set([...numbers, ...words.slice(0, 8)])];
}

// ─── CHECK STUDENT AGAINST STRUCTURE ─────────────────────────────────────────
function checkStudentCoverage(studentText, structure) {
  const lowerStudent = studentText.toLowerCase();
  const found = { topic: false, pivot: false, conclusion: false };
  const matched = { topic: [], pivot: [], conclusion: [] };
  
  // Check Topic (at least 1 keyword match)
  if (structure.topic.keywords) {
    const matches = structure.topic.keywords.filter(kw => lowerStudent.includes(kw.toLowerCase()));
    if (matches.length >= 1) {
      found.topic = true;
      matched.topic = matches;
    }
  }
  
  // Check Pivot (at least 1 keyword match OR contrast words)
  if (structure.pivot.keywords) {
    const matches = structure.pivot.keywords.filter(kw => lowerStudent.includes(kw.toLowerCase()));
    if (matches.length >= 1) {
      found.pivot = true;
      matched.pivot = matches;
    }
  }
  // Backup pivot detection: look for contrast indicators in student text
  if (!found.pivot) {
    const contrastWords = ['however', 'but', 'although', 'though', 'despite', 'while', 'yet', 'bear', 'burden', 'justice', 'unfair'];
    if (contrastWords.some(w => lowerStudent.includes(w))) {
      found.pivot = true;
      matched.pivot = ['contrast_indicator'];
    }
  }
  
  // Check Conclusion (at least 1 keyword match OR solution indicators)
  if (structure.conclusion.keywords) {
    const matches = structure.conclusion.keywords.filter(kw => lowerStudent.includes(kw.toLowerCase()));
    if (matches.length >= 1) {
      found.conclusion = true;
      matched.conclusion = matches;
    }
  }
  // Backup conclusion detection
  if (!found.conclusion) {
    const solutionWords = ['therefore', 'thus', 'solution', 'hope', 'investment', 'renewable', 'transition', 'future'];
    if (solutionWords.some(w => lowerStudent.includes(w)) || /\d+%/.test(studentText)) {
      found.conclusion = true;
      matched.conclusion = ['solution_indicator'];
    }
  }
  
  const present = Object.entries(found).filter(([k, v]) => v).map(([k]) => k);
  const missing = Object.entries(found).filter(([k, v]) => !v).map(([k]) => k);
  
  return { found, matched, present, missing, count: present.length };
}

// ─── GRAMMAR ANALYZER ────────────────────────────────────────────────────────
function analyzeGrammar(text) {
  const issues = [];
  const lower = text.toLowerCase();
  let score = 2;
  
  // Major errors
  const doubleNeg = /\b(never\s+no|not\s+no|never\s+nothing|not\s+nothing)\b/i;
  if (doubleNeg.test(text)) {
    issues.push('Double negative error');
    score = 0;
  }
  
  // Subject-verb agreement checks
  if (/\b(people|they|we|countries|nations)\s+(was|is)\b/i.test(text)) {
    issues.push('Subject-verb agreement: plural subject with singular verb');
    score = Math.min(score, 1);
  }
  if (/\b(it|this|that)\s+(were|are)\b/i.test(text)) {
    issues.push('Subject-verb agreement: singular subject with plural verb');
    score = Math.min(score, 1);
  }
  
  // Check connectors
  const hasConnector = ['however', 'therefore', 'moreover', 'furthermore', 'consequently', 'thus', 'although', 'while'].some(c => lower.includes(c));
  const hasSemicolon = /;\s*(however|therefore|moreover|furthermore|consequently|thus)/i.test(text);
  
  if (!hasConnector) {
    issues.push('No connector detected');
    if (score > 1) score = 1;
  } else if (!hasSemicolon) {
    issues.push('Missing semicolon before connector');
    if (score > 1) score = 1;
  }
  
  // Check for sentence completeness
  if (!/[.!?]$/.test(text.trim())) {
    issues.push('Sentence must end with punctuation');
    score = 0;
  }
  
  // Check for verb
  const hasVerb = /\b(is|are|was|were|be|been|being|has|have|had|do|does|did|will|would|could|should|may|might|must|can|shall|threatens|reduces|impacts|causes|creates|shows|offers|requires|represents|results|ensures|remains|faces|bears|surges|drops|hopes|concludes|predicts|indicates|saves|rewards|replaces|exchanges|persuades|develops|becomes|makes|takes|finds|gives|tells|leaves|puts|means|keeps|begins|helps|stands|continues|changes|leads|serves|sends|expects|stays|falls|reaches|raises|passes|reports|decides|acts|opts|improves|expresses|attempts|highlights|resulted|ensured|remained|faced|bore|surged|dropped|required|offered|hoped|concluded|predicted|reduced|impacted|caused|affected|increased|decreased|transformed|generated|dominated|overtook|demonstrated|acknowledged|examined|credited|identified|challenged|advised|attempted|showed|found|thought|believed|said|noted|mentioned|added|continued|started|wanted|needed|looked|worked|lived|called|tried|asked|moved|played|believed|brought|happened|understood|wrote|spoke|spent|grew|opened|walked|watched|heard|let|began|knew|ate|ran|went|came|did|saw|got|had)\b/i.test(text);
  
  if (!hasVerb && text.split(/\s+/).length > 3) {
    issues.push('No finite verb detected');
    score = 0;
  }
  
  return {
    score,
    has_connector: hasConnector,
    connector_type: lower.includes('however') || lower.includes('but') || lower.includes('although') ? 'contrast' : 
                    lower.includes('therefore') || lower.includes('thus') || lower.includes('consequently') ? 'result' :
                    lower.includes('moreover') || lower.includes('furthermore') ? 'addition' : 'none',
    has_semicolon_before_connector: hasSemicolon,
    chained_connectors: /;\s*\w+\s*,?.*;\s*\w+/g.test(text),
    grammar_issues: issues,
    severity: score === 0 ? 'major' : score === 1 ? 'minor' : 'none'
  };
}

// ─── FORM CHECK ──────────────────────────────────────────────────────────────
function checkForm(text, type) {
  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  const wc = words.length;
  
  if (type === 'summarize-written-text') {
    if (wc < 5) return { valid: false, score: 0, reason: 'Too short (min 5 words)', wc };
    if (wc > 75) return { valid: false, score: 0, reason: 'Too long (max 75 words)', wc };
    
    // Count sentences
    const clean = text.replace(/(?:Dr|Mr|Mrs|Ms|Prof|U\.K|U\.S|i\.e|e\.g|etc)\./gi, '##');
    const sentences = (clean.match(/[.!?](\s|$)/g) || []).length;
    
    if (sentences !== 1) return { valid: false, score: 0, reason: 'Must be exactly one sentence', wc };
    
    return { valid: true, score: 1, reason: 'Valid', wc };
  }
  
  return { valid: false, score: 0, reason: 'Invalid type', wc };
}

// ─── AI GRADING ──────────────────────────────────────────────────────────────
async function gradeWithAI(text, passage, structure, localCheck) {
  const cacheKey = (text + passage).slice(0, 200);
  const cached = getCached(cacheKey);
  if (cached) return cached;

  if (!anthropic) {
    return {
      content: localCheck.count >= 2 ? (localCheck.count === 3 ? 2 : 1) : 0,
      grammar: analyzeGrammar(text),
      vocabulary: 2,
      mode: 'local'
    };
  }

  const systemPrompt = `You are a PTE Academic examiner. Analyze this SWT response STRICTLY.

Passage Structure:
- TOPIC (first part): ${structure.topic.text.substring(0, 100)}...
- PIVOT (middle contrast): ${structure.pivot.text ? structure.pivot.text.substring(0, 100) + '...' : 'Not found'}
- CONCLUSION (end): ${structure.conclusion.text ? structure.conclusion.text.substring(0, 100) + '...' : 'Not found'}

SCORING RULES:
- Content 2/2: ALL THREE (Topic + Pivot + Conclusion) present
- Content 1/2: Exactly TWO present  
- Content 0/2: Zero or one present

The student's response has these keywords detected:
- Topic matched: ${localCheck.matched.topic.join(', ')}
- Pivot matched: ${localCheck.matched.pivot.join(', ')}  
- Conclusion matched: ${localCheck.matched.conclusion.join(', ')}

Return ONLY JSON:
{
  "content": 0-2,
  "content_notes": "which ideas were found/missed",
  "vocabulary": 0-2,
  "vocab_notes": "any synonym issues"
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 500,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Student wrote: "${text}"\n\nLocal detection found ${localCheck.count}/3 ideas. Verify and return JSON only.`
      }],
      temperature: 0
    });

    const raw = response.content[0].text;
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON');
    
    const result = JSON.parse(match[0]);
    
    // Override with local if AI is wrong
    let finalContent = result.content;
    if (localCheck.count === 3 && finalContent < 2) finalContent = 2;
    if (localCheck.count === 2 && finalContent < 1) finalContent = 1;
    if (localCheck.count <= 1 && finalContent > 0) finalContent = 0;
    
    const finalResult = {
      content: finalContent,
      content_notes: result.content_notes || `Local: ${localCheck.count}/3 ideas`,
      grammar: analyzeGrammar(text),
      vocabulary: result.vocabulary || 2,
      mode: 'ai'
    };
    
    setCache(cacheKey, finalResult);
    return finalResult;
    
  } catch (err) {
    return {
      content: localCheck.count >= 2 ? (localCheck.count === 3 ? 2 : 1) : 0,
      content_notes: `AI error, using local: ${localCheck.count}/3`,
      grammar: analyzeGrammar(text),
      vocabulary: 2,
      mode: 'error'
    };
  }
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: '8.0.0', 
    anthropicConfigured: !!anthropic,
    timestamp: new Date().toISOString()
  });
});

app.post('/api/grade', async (req, res) => {
  try {
    const { text, type, prompt } = req.body;
    
    if (!text || !type || !prompt) {
      return res.status(400).json({ error: 'Missing fields: text, type, prompt' });
    }

    // Form validation
    const form = checkForm(text, type);
    
    // Analyze passage structure
    const structure = analyzePassageStructure(prompt);
    
    // Check student coverage
    const coverage = checkStudentCoverage(text, structure);
    
    // FORM GATE
    if (!form.valid) {
      return res.json({
        trait_scores: { form: 0, content: 0, grammar: 0, vocabulary: 0 },
        content_details: {
          key_ideas_extracted: structure ? [structure.topic.text, structure.pivot.text, structure.conclusion.text].filter(Boolean) : [],
          key_ideas_present: [],
          key_ideas_missing: ['topic', 'pivot', 'conclusion'],
          notes: 'Form validation failed'
        },
        grammar_details: {
          score: 0,
          has_connector: false,
          connector_type: 'none',
          has_semicolon_before_connector: false,
          chained_connectors: false,
          grammar_issues: ['Form error: ' + form.reason],
          severity: 'major'
        },
        vocabulary_details: {
          synonym_usage: 'none',
          smart_swaps_detected: [],
          unsafe_swaps_detected: []
        },
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

    // Get grades
    const aiResult = await gradeWithAI(text, prompt, structure, coverage);
    
    // Calculate totals
    const contentScore = aiResult.content;
    const grammarScore = aiResult.grammar.score;
    const vocabScore = aiResult.vocabulary;
    const rawScore = 1 + contentScore + grammarScore + vocabScore; // Form is 1
    const overallScore = Math.min(90, 10 + Math.round((rawScore / 7) * 80));

    // Build feedback
    let feedback = '';
    if (coverage.count === 3) feedback = 'Excellent! All 3 key ideas captured. ';
    else if (coverage.count === 2) feedback = `Good: 2/3 ideas. Missing: ${coverage.missing[0]}. `;
    else if (coverage.count === 1) feedback = `Weak: Only 1/3 ideas. Missing: ${coverage.missing.join(', ')}. `;
    else feedback = 'Critical: No key ideas detected. ';
    
    if (aiResult.grammar.severity === 'major') {
      feedback += 'Major grammar errors detected.';
    } else if (aiResult.grammar.severity === 'minor') {
      feedback += aiResult.grammar.grammar_issues.join('; ') + '.';
    } else {
      feedback += 'Grammar is excellent.';
    }

    res.json({
      trait_scores: {
        form: 1,
        content: contentScore,
        grammar: grammarScore,
        vocabulary: vocabScore
      },
      content_details: {
        key_ideas_extracted: [
          structure.topic.text.substring(0, 60) + '...',
          structure.pivot.text ? structure.pivot.text.substring(0, 60) + '...' : 'Not detected',
          structure.conclusion.text ? structure.conclusion.text.substring(0, 60) + '...' : 'Not detected'
        ],
        key_ideas_present: coverage.present,
        key_ideas_missing: coverage.missing,
        notes: aiResult.content_notes || `${coverage.count}/3 ideas detected`
      },
      grammar_details: {
        score: grammarScore,
        has_connector: aiResult.grammar.has_connector,
        connector_type: aiResult.grammar.connector_type,
        has_semicolon_before_connector: aiResult.grammar.has_semicolon_before_connector,
        chained_connectors: aiResult.grammar.chained_connectors,
        grammar_issues: aiResult.grammar.grammar_issues,
        severity: aiResult.grammar.severity
      },
      vocabulary_details: {
        synonym_usage: 'minimal',
        smart_swaps_detected: [],
        unsafe_swaps_detected: []
      },
      overall_score: overallScore,
      raw_score: rawScore,
      band: BAND_MAP[Math.floor(rawScore)] || 'Band 5',
      word_count: form.wc,
      feedback: feedback,
      key_ideas_status: {
        topic: coverage.found.topic,
        pivot: coverage.found.pivot,
        conclusion: coverage.found.conclusion
      },
      mode: aiResult.mode
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ PTE SWT Grader v8.0.0 on port ${PORT}`);
  console.log(`🤖 AI: ${anthropic ? 'ACTIVE' : 'LOCAL'}`);
});
