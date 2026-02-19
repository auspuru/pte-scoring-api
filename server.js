const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// ─── CORS CONFIG ─────────────────────────────────────────────────────────────
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

// ─── GRAMMAR ERROR PATTERNS ──────────────────────────────────────────────────
const GRAMMAR_PATTERNS = {
  // Major errors (affect comprehension) - Score 0
  major: {
    double_negatives: /\b(never\s+no|not\s+no|never\s+nothing|not\s+nothing|hardly\s+no|scarcely\s+no)\b/gi,
    subject_verb_agreement: [
      { pattern: /\b(people|they|we)\s+(was|is)\b/gi, fix: 'were/are' },
      { pattern: /\b(he|she|it)\s+(were|are)\b/gi, fix: 'was/is' },
      { pattern: /\b(the\s+\w+)\s+(are|were)\s+(a|an)\b/gi, fix: 'is/was' }
    ],
    fragments: /^\s*(Because|Although|While|Since|Unless|If|And|But)\s+/i,
    run_ons: /[a-z]+,\s*[a-z]+\s+[a-z]+,/g, // Comma splice pattern
    missing_verb: /^\s*(The|A|An)\s+\w+\s+(and|but|or)\s+/i // Missing verb after subject
  },
  
  // Minor errors - Score 1
  minor: {
    article_errors: [
      { pattern: /\b(a\s+[aeiou])/gi, type: 'article' }, // a apple → an apple
      { pattern: /\b(an\s+[^aeiou\s])/gi, type: 'article' } // an cat → a cat
    ],
    preposition_errors: [
      { pattern: /\b(depend\s+of|depend\s+from)\b/gi, fix: 'depend on' },
      { pattern: /\b(interested\s+on|interested\s+of)\b/gi, fix: 'interested in' },
      { pattern: /\b(responsible\s+of)\b/gi, fix: 'responsible for' },
      { pattern: /\b(afraid\s+of)\b/gi, fix: 'afraid of' }
    ],
    plural_errors: /\b(many\s+\w+s|much\s+\w+[^s])\b/gi,
    spelling_common: /\b(recieve|acheive|seperate|occured|definately|goverment|enviroment|wich|untill|beleive)\b/gi
  }
};

// ─── CONNECTOR WORDS ─────────────────────────────────────────────────────────
const CONNECTORS = {
  contrast: ['however', 'yet', 'although', 'while', 'whereas', 'but', 'nevertheless', 'nonetheless', 'conversely', 'on the other hand', 'in contrast'],
  addition: ['moreover', 'furthermore', 'additionally', 'also', 'besides', 'in addition', 'what is more'],
  result: ['consequently', 'therefore', 'thus', 'hence', 'accordingly', 'as a result', 'so', 'ergo'],
  example: ['for instance', 'specifically', 'such as', 'namely', 'in particular']
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

// ─── INPUT SANITIZATION ─────────────────────────────────────────────────────
function sanitizeInput(text) {
  if (!text) return '';
  return text
    .replace(/ignore previous instructions/gi, '')
    .replace(/system prompt/gi, '')
    .replace(/you are now/gi, '')
    .replace(/give me 90/gi, '')
    .slice(0, 2000);
}

// ─── LOCAL KEY IDEA EXTRACTION ───────────────────────────────────────────────
function extractKeyIdeasLocal(passage) {
  if (!passage) return { topic: null, pivot: null, result: null };
  
  const sentences = passage.match(/[^.!?]+[.!?]+/g) || [passage];
  const firstTwo = sentences.slice(0, 2).join(' ').toLowerCase();
  const lastTwo = sentences.slice(-2).join(' ').toLowerCase();
  const lowerPassage = passage.toLowerCase();
  
  let topic = null, pivot = null, result = null;
  let topicKeywords = [], pivotKeywords = [], resultKeywords = [];
  
  // TOPIC
  if (lowerPassage.includes('gdp') || lowerPassage.includes('economic') || lowerPassage.includes('cost')) {
    topic = 'economic impact';
    topicKeywords = ['gdp', 'economic', 'cost', 'loss', 'billion', 'trillion', 'financial', 'money'];
  } else if (lowerPassage.includes('climate') || lowerPassage.includes('environment')) {
    topic = 'climate/environment';
    topicKeywords = ['climate', 'environment', 'warming', 'temperature', 'weather', 'green'];
  } else {
    topic = 'main subject';
    topicKeywords = sentences[0]?.split(' ').slice(0, 4).map(w => w.toLowerCase().replace(/[^a-z]/g, '')).filter(w => w.length > 3) || [];
  }
  
  // PIVOT
  const contrastWords = ['however', 'but', 'although', 'though', 'while', 'yet', 'despite', 'nevertheless'];
  for (const word of contrastWords) {
    if (lowerPassage.includes(word)) {
      pivot = 'contrast/challenge';
      pivotKeywords = [...contrastWords, 'problem', 'issue', 'difficulty', 'burden', 'risk'];
      break;
    }
  }
  
  // RESULT
  const solutionWords = ['therefore', 'thus', 'consequently', 'solution', 'answer', 'hope', 'future', 'investment', 'transition'];
  for (const word of solutionWords) {
    if (lastTwo.includes(word) || lowerPassage.includes(word)) {
      result = 'solution/conclusion';
      resultKeywords = solutionWords;
      break;
    }
  }
  
  return { topic, pivot, result, topicKeywords, pivotKeywords, resultKeywords };
}

// ─── CHECK KEY IDEAS PRESENCE ────────────────────────────────────────────────
function checkKeyIdeasPresent(studentText, keyIdeas) {
  const lowerStudent = studentText.toLowerCase();
  const present = [];
  const missing = [];
  
  // Check Topic
  let hasTopic = keyIdeas.topicKeywords?.some(kw => lowerStudent.includes(kw)) || false;
  if (hasTopic) present.push('topic');
  else missing.push('topic');
  
  // Check Pivot
  let hasPivot = keyIdeas.pivotKeywords?.some(kw => lowerStudent.includes(kw)) || false;
  if (!hasPivot && (lowerStudent.includes('afford') || lowerStudent.includes('whether'))) hasPivot = true;
  if (hasPivot) present.push('pivot');
  else missing.push('pivot');
  
  // Check Result
  let hasResult = keyIdeas.resultKeywords?.some(kw => lowerStudent.includes(kw)) || false;
  if (!hasResult && (lowerStudent.includes('%') || lowerStudent.includes('investment'))) hasResult = true;
  if (hasResult) present.push('result');
  else missing.push('result');
  
  return { present, missing, count: present.length };
}

// ─── GRAMMAR ANALYSIS ENGINE ─────────────────────────────────────────────────
function analyzeGrammar(text) {
  const issues = [];
  const lowerText = text.toLowerCase();
  let score = 2; // Default perfect score
  let severity = 'none'; // none, minor, major
  
  // Check for connectors
  const hasConnector = Object.values(CONNECTORS).some(list => 
    list.some(conn => lowerText.includes(conn.toLowerCase()))
  );
  
  const hasSemicolon = /;\s*(however|moreover|furthermore|therefore|thus|consequently|additionally|hence)/i.test(text);
  
  // MAJOR ERRORS (Score 0)
  
  // 1. Double negatives
  if (GRAMMAR_PATTERNS.major.double_negatives.test(text)) {
    issues.push('Major error: Double negative detected');
    score = 0;
    severity = 'major';
  }
  
  // 2. Subject-verb agreement
  for (const rule of GRAMMAR_PATTERNS.major.subject_verb_agreement) {
    if (rule.pattern.test(text)) {
      issues.push(`Major error: Subject-verb agreement issue (suggestion: use "${rule.fix}")`);
      score = 0;
      severity = 'major';
    }
  }
  
  // 3. Sentence fragments
  if (GRAMMAR_PATTERNS.major.fragments.test(text)) {
    issues.push('Major error: Sentence fragment detected');
    score = 0;
    severity = 'major';
  }
  
  // 4. Missing finite verb (incomplete sentence)
  const words = text.trim().split(/\s+/);
  const finiteVerbs = /\b(is|are|was|were|be|been|being|has|have|had|do|does|did|will|would|could|should|may|might|must|can|shall|threatens|reduces|impacts|causes|creates|shows|explains|demonstrates|indicates|reveals|suggests|argues|claims|states|acknowledges|discusses|provides|includes|requires|offers|makes|takes|becomes|finds|gives|tells|feels|leaves|puts|means|keeps|begins|seems|helps|writes|stands|loses|pays|continues|changes|leads|considers|appears|serves|sends|expects|builds|stays|falls|reaches|remains|raises|passes|reports|decides|acts|possesses|opts|improves|minimizes|expresses|attempts|highlights|results|ensures|faces|bears|surges|drops|hopes|warns|emphasizes|concludes|predicts|saves|rewards|replaces|exchanges|persuades|develops|resulted|ensured|remained|faced|bore|surged|dropped|required|offered|hoped|concluded|predicted|reduced|impacted|caused|affected|increased|decreased|transformed|generated|dominated|overtook|demonstrated|indicated|acknowledged|examined|credited|identified|challenged|advised|attempted|highlighted|showed|found|thought|believed|said|noted|mentioned|added|continued|started|wanted|needed|looked|worked|lived|called|tried|asked|moved|played|believed|brought|happened|understood|wrote|spoke|spent|grew|opened|walked|watched|heard|let|began|knew|ate|ran|went|came|did|saw|got|had)\b/i;
  
  if (!finiteVerbs.test(text) && words.length > 3) {
    issues.push('Major error: No finite verb detected - incomplete sentence structure');
    score = 0;
    severity = 'major';
  }
  
  // MINOR ERRORS (Score 1 if no major errors)
  if (score === 2) {
    // Article errors
    for (const rule of GRAMMAR_PATTERNS.minor.article_errors) {
      const matches = text.match(rule.pattern);
      if (matches) {
        matches.forEach(match => {
          issues.push(`Minor error: Article usage "${match.trim()}"`);
        });
        if (score > 1) {
          score = 1;
          severity = 'minor';
        }
      }
    }
    
    // Preposition errors
    for (const rule of GRAMMAR_PATTERNS.minor.preposition_errors) {
      if (rule.pattern.test(text)) {
        issues.push(`Minor error: Preposition - should be "${rule.fix}"`);
        if (score > 1) {
          score = 1;
          severity = 'minor';
        }
      }
    }
    
    // Common spelling errors
    if (GRAMMAR_PATTERNS.minor.spelling_common.test(text)) {
      issues.push('Minor error: Possible spelling mistake detected');
      if (score > 1) {
        score = 1;
        severity = 'minor';
      }
    }
    
    // Missing connector or semicolon (Band 9 style)
    if (!hasConnector) {
      issues.push('Minor issue: No connector detected (use however, therefore, moreover)');
      if (score > 1) score = 1;
    } else if (!hasSemicolon) {
      issues.push('Minor issue: Use semicolon before connector for Band 9 style (e.g., "; however,")');
      if (score > 1) score = 1;
    }
  }
  
  // Determine connector type
  let connectorType = 'none';
  if (CONNECTORS.contrast.some(c => lowerText.includes(c))) connectorType = 'contrast';
  else if (CONNECTORS.result.some(c => lowerText.includes(c))) connectorType = 'result';
  else if (CONNECTORS.addition.some(c => lowerText.includes(c))) connectorType = 'addition';
  
  return {
    score,
    severity,
    issues,
    has_connector: hasConnector,
    connector_type: connectorType,
    has_semicolon_before_connector: hasSemicolon,
    chained_connectors: /;\s*\w+\s*,?.*;\s*\w+/g.test(text),
    spelling_errors: [],
    grammar_issues: issues
  };
}

// ─── FORM VALIDATION ─────────────────────────────────────────────────────────
function calculateForm(text, type) {
  const cleanInput = sanitizeInput(text);
  const words = cleanInput.trim().split(/\s+/).filter(w => w.length > 0);
  const wc = words.length;

  if (type === 'summarize-written-text') {
    if (wc < 5) return { score: 0, reason: 'Too short (minimum 5 words)', wordCount: wc };
    if (wc > 75) return { score: 0, reason: 'Too long (maximum 75 words)', wordCount: wc };
    
    const cleanText = cleanInput.replace(/(?:Dr|Mr|Mrs|Ms|Prof|U\.K|U\.S|i\.e|e\.g|etc)\./gi, '##');
    const sentenceCount = (cleanText.match(/[.!?](\s|$)/g) || []).length;
    
    if (sentenceCount !== 1) return { score: 0, reason: 'Must be exactly one sentence', wordCount: wc };
    
    return { score: 1, reason: 'Valid', wordCount: wc };
  }
  
  return { score: 0, reason: 'Invalid type', wordCount: wc };
}

// ─── AI GRADING ENGINE ───────────────────────────────────────────────────────
async function gradeResponse(text, type, passageText, localKeyIdeas) {
  const cacheKey = (text + type + passageText).slice(0, 200);
  const cached = getCached(cacheKey);
  if (cached) return { ...cached, cached: true };

  const localCheck = checkKeyIdeasPresent(text, localKeyIdeas);
  const grammarAnalysis = analyzeGrammar(text);

  if (!anthropic) {
    // LOCAL MODE with grammar detection
    let contentScore = 0;
    if (localCheck.count === 3) contentScore = 2;
    else if (localCheck.count === 2) contentScore = 1;
    
    return {
      content: contentScore,
      key_ideas_extracted: [localKeyIdeas.topic, localKeyIdeas.pivot, localKeyIdeas.result].filter(Boolean),
      key_ideas_present: localCheck.present,
      key_ideas_missing: localCheck.missing,
      content_notes: `${localCheck.count}/3 key ideas found (Local mode)`,
      grammar: grammarAnalysis,
      vocabulary: 2, // Assume good unless obvious errors
      synonym_usage: 'minimal',
      unsafe_swaps_detected: [],
      feedback: `${localCheck.count}/3 key ideas. ${grammarAnalysis.issues.join('; ') || 'No major grammar issues.'}`,
      mode: 'local'
    };
  }

  const systemPrompt = `You are a strict PTE Academic examiner for Summarize Written Text (SWT).

=== GRAMMAR DETECTION RULES ===
Score 2: Perfect grammar + semicolon + connector (e.g., "; however,")
Score 1: Minor errors (article, preposition) OR missing semicolon OR missing connector
Score 0: Major errors (subject-verb agreement, double negatives, fragments, no finite verb)

=== CONTENT RULES ===
Score 2: ALL 3 key ideas (Topic + Pivot + Result) present
Score 1: Exactly 2 key ideas present
Score 0: 0-1 key ideas present

Return ONLY JSON:
{
  "content": 0-2,
  "key_ideas_extracted": ["topic: ...", "pivot: ...", "result: ..."],
  "key_ideas_present": [],
  "key_ideas_missing": [],
  "content_notes": "...",
  "grammar": {
    "score": 0-2,
    "has_connector": boolean,
    "connector_type": "contrast|addition|result|none",
    "has_semicolon_before_connector": boolean,
    "grammar_issues": ["list specific issues"],
    "severity": "none|minor|major"
  },
  "vocabulary": 0-2,
  "feedback": "..."
}`;

  const userPrompt = `PASSAGE: "${passageText}"

STUDENT RESPONSE: "${text}"

LOCAL GRAMMAR CHECK: ${grammarAnalysis.issues.length} issues found: ${grammarAnalysis.issues.join(', ')}

Analyze content and grammar strictly. If grammar has major errors (subject-verb disagreement, fragments), score 0. If minor (missing semicolon), score 1. Return JSON only.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.1
    });

    const rawText = response.content[0].text;
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON found');

    const result = JSON.parse(match[0]);
    
    // Override with local grammar analysis if AI misses major errors
    if (grammarAnalysis.severity === 'major' && result.grammar?.score > 0) {
      result.grammar.score = 0;
      result.grammar.severity = 'major';
      result.grammar.grammar_issues = [...(result.grammar.grammar_issues || []), ...grammarAnalysis.issues];
    }
    
    // Ensure grammar object has all fields
    if (!result.grammar) result.grammar = grammarAnalysis;
    else {
      result.grammar.has_semicolon_before_connector = grammarAnalysis.has_semicolon_before_connector;
      result.grammar.has_connector = grammarAnalysis.has_connector;
      result.grammar.connector_type = grammarAnalysis.connector_type;
    }
    
    const finalResult = { ...result, mode: 'ai' };
    setCache(cacheKey, finalResult);
    return finalResult;

  } catch (err) {
    console.error('AI Error:', err.message);
    return {
      content: localCheck.count >= 2 ? 1 : 0,
      key_ideas_extracted: [localKeyIdeas.topic, localKeyIdeas.pivot, localKeyIdeas.result].filter(Boolean),
      key_ideas_present: localCheck.present,
      key_ideas_missing: localCheck.missing,
      content_notes: `AI Error - using local detection`,
      grammar: grammarAnalysis,
      vocabulary: 1,
      synonym_usage: 'error',
      feedback: `AI Error. Local scoring: ${localCheck.count}/3 ideas, Grammar: ${grammarAnalysis.severity}`,
      mode: 'error-fallback'
    };
  }
}

// ─── BUILD FEEDBACK ──────────────────────────────────────────────────────────
function buildFeedback(result, formCheck, grammarAnalysis, keyIdeaCheck) {
  const parts = [];
  
  // Content feedback
  if (keyIdeaCheck.count === 0) {
    parts.push("Critical: You missed all main points from the passage.");
  } else if (keyIdeaCheck.count === 1) {
    parts.push(`Weak content: Only 1/3 key ideas captured. Missing: ${keyIdeaCheck.missing.join(', ')}`);
  } else if (keyIdeaCheck.count === 2) {
    parts.push(`Good: You captured 2/3 key ideas. Missing: ${keyIdeaCheck.missing.join(', ')}`);
  } else {
    parts.push("Excellent: All 3 key ideas captured.");
  }
  
  // Grammar feedback with specific issues
  if (grammarAnalysis.severity === 'major') {
    parts.push(`Major grammar issues: ${grammarAnalysis.issues.join('; ')}`);
  } else if (grammarAnalysis.severity === 'minor') {
    parts.push(`Minor issues: ${grammarAnalysis.issues.join('; ')}`);
  } else {
    if (!grammarAnalysis.has_connector) {
      parts.push("Add connectors (however, therefore) to improve grammar score.");
    } else if (!grammarAnalysis.has_semicolon_before_connector) {
      parts.push("Band 9 style: Use semicolons before connectors (e.g., '; however,')");
    } else {
      parts.push("Grammar is excellent.");
    }
  }
  
  return parts.join(' ');
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: '7.4.0', 
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

    const cleanText = sanitizeInput(text);
    const formCheck = calculateForm(cleanText, type);
    const localKeyIdeas = extractKeyIdeasLocal(prompt);
    
    // FORM GATE
    if (formCheck.score === 0) {
      return res.json({
        trait_scores: { form: 0, content: 0, grammar: 0, vocabulary: 0 },
        content_details: { 
          key_ideas_extracted: [], 
          key_ideas_present: [], 
          key_ideas_missing: [], 
          notes: 'Form invalid'
        },
        grammar_details: { 
          score: 0,
          has_connector: false, 
          connector_type: 'none',
          has_semicolon_before_connector: false,
          chained_connectors: false,
          spelling_errors: [], 
          grammar_issues: ['Form validation failed'],
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
        form_reason: formCheck.reason,
        word_count: formCheck.wordCount,
        feedback: `FORM ERROR: ${formCheck.reason}. Must be one sentence (5-75 words).`,
        key_ideas_status: { topic: false, pivot: false, conclusion: false },
        mode: 'local'
      });
    }

    const result = await gradeResponse(cleanText, type, prompt, localKeyIdeas);
    const grammarAnalysis = analyzeGrammar(cleanText);
    const keyIdeaCheck = checkKeyIdeasPresent(cleanText, localKeyIdeas);
    
    // Final content scoring
    let finalContentScore = 0;
    if (keyIdeaCheck.count === 3) finalContentScore = 2;
    else if (keyIdeaCheck.count === 2) finalContentScore = 1;
    else finalContentScore = 0;
    
    // Grammar score from analysis
    const grammarScore = result.grammar?.score !== undefined ? result.grammar.score : grammarAnalysis.score;
    const vocabScore = result.vocabulary || 2;
    
    const rawScore = formCheck.score + finalContentScore + grammarScore + vocabScore;
    const overallScore = Math.min(90, 10 + Math.round((rawScore / 7) * 80));

    const response = {
      trait_scores: {
        form: formCheck.score,
        content: finalContentScore,
        grammar: grammarScore,
        vocabulary: vocabScore
      },
      content_details: {
        key_ideas_extracted: result.key_ideas_extracted || [],
        key_ideas_present: keyIdeaCheck.present,
        key_ideas_missing: keyIdeaCheck.missing,
        notes: result.content_notes || `${keyIdeaCheck.count}/3 key ideas`
      },
      grammar_details: {
        score: grammarScore,
        has_connector: grammarAnalysis.has_connector,
        connector_type: grammarAnalysis.connector_type,
        has_semicolon_before_connector: grammarAnalysis.has_semicolon_before_connector,
        chained_connectors: grammarAnalysis.chained_connectors,
        spelling_errors: result.grammar?.spelling_errors || [],
        grammar_issues: grammarAnalysis.issues,
        severity: grammarAnalysis.severity
      },
      vocabulary_details: {
        synonym_usage: result.synonym_usage || 'minimal',
        smart_swaps_detected: result.smart_swaps_detected || [],
        unsafe_swaps_detected: result.unsafe_swaps_detected || []
      },
      overall_score: overallScore,
      raw_score: rawScore,
      band: BAND_MAP[Math.floor(rawScore)] || 'Band 5',
      word_count: formCheck.wordCount,
      feedback: buildFeedback(result, formCheck, grammarAnalysis, keyIdeaCheck),
      key_ideas_status: {
        topic: keyIdeaCheck.present.includes('topic'),
        pivot: keyIdeaCheck.present.includes('pivot'),
        conclusion: keyIdeaCheck.present.includes('result')
      },
      mode: result.mode
    };

    res.json(response);

  } catch (error) {
    console.error('Route error:', error);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ PTE SWT Logic Grader v7.4.0 running on port ${PORT}`);
  console.log(`🤖 AI: ${anthropic ? 'ACTIVE' : 'LOCAL MODE'}`);
  console.log(`📝 Grammar Detection: ENABLED`);
});
