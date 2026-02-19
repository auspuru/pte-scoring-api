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
  
  // Extract: numbers, percentages, key nouns, verbs
  const concepts = [];
  
  // Numbers with units
  const numbers = text.match(/\d+%?|\$\d+(?:\.\d+)?(?:\s*(?:billion|million|trillion))?/gi) || [];
  concepts.push(...numbers);
  
  // Key terms (nouns, verbs, adjectives) - filter out stop words
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those', 'it', 'they', 'them', 'their', 'there', 'then', 'than', 'as', 'if', 'so', 'also', 'only', 'just', 'even', 'still', 'already', 'yet', 'about', 'up', 'out', 'down', 'off', 'over', 'under', 'again', 'further', 'once', 'here', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while', 'of', 'at', 'by', 'for', 'with', 'through', 'during', 'before', 'after', 'above', 'below', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once']);
  
  const words = lower
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
  
  // Get unique important words
  const uniqueWords = [...new Set(words)].slice(0, 15);
  concepts.push(...uniqueWords);
  
  return [...new Set(concepts)];
}

// ─── SEMANTIC MATCH: Check if student captured key point ─────────────────────
function checkKeyPoint(studentText, keyPointText, keyPointType) {
  const student = studentText.toLowerCase();
  const keyPoint = keyPointText.toLowerCase();
  
  // Extract key concepts from the expected key point
  const keyConcepts = extractConcepts(keyPointText);
  
  // Count how many key concepts appear in student text
  let matchedConcepts = 0;
  const matched = [];
  
  for (const concept of keyConcepts) {
    const conceptLower = concept.toLowerCase();
    // Check for exact match or partial match for longer terms
    if (student.includes(conceptLower)) {
      matchedConcepts++;
      matched.push(concept);
    }
  }
  
  // Calculate match percentage
  const matchRate = keyConcepts.length > 0 ? matchedConcepts / keyConcepts.length : 0;
  
  // Determine if key point is present
  // Need at least 40% of key concepts OR critical keywords
  const isPresent = matchRate >= 0.4 || hasCriticalKeywords(student, keyPointType, keyPoint);
  
  return {
    present: isPresent,
    matchRate: Math.round(matchRate * 100),
    matchedConcepts: matched.slice(0, 5),
    totalConcepts: keyConcepts.length
  };
}

// ─── CHECK FOR CRITICAL KEYWORDS ─────────────────────────────────────────────
function hasCriticalKeywords(studentText, type, keyPoint) {
  const student = studentText.toLowerCase();
  
  // Extract critical terms (numbers, proper nouns, unique terms)
  const criticalTerms = keyPoint.match(/\b\d+%?|\$\d+|\b(?:gdp|emissions|nuclear|renewable|climate|energy|cost|billion|trillion|million)\w*\b/gi) || [];
  
  // Check if student has at least one critical term
  return criticalTerms.some(term => student.includes(term.toLowerCase()));
}

// ─── VERBATIM DETECTION ──────────────────────────────────────────────────────
function detectVerbatim(studentText, passageText) {
  const student = studentText.toLowerCase().replace(/[^\w\s]/g, '');
  const passage = passageText.toLowerCase().replace(/[^\w\s]/g, '');
  
  const studentWords = student.split(/\s+/).filter(w => w.length > 3);
  
  if (studentWords.length === 0) return { verbatimRate: 0, isVerbatim: false };
  
  let verbatimWords = 0;
  const verbatimPhrases = [];
  
  // Check for 3+ word phrases that match exactly
  for (let i = 0; i < studentWords.length - 2; i++) {
    const phrase3 = studentWords.slice(i, i + 3).join(' ');
    const phrase4 = studentWords.slice(i, i + 4).join(' ');
    
    if (passage.includes(phrase4)) {
      verbatimWords += 4;
      verbatimPhrases.push(phrase4);
      i += 3; // Skip ahead
    } else if (passage.includes(phrase3)) {
      verbatimWords += 3;
      verbatimPhrases.push(phrase3);
      i += 2; // Skip ahead
    }
  }
  
  // Also check single words (4+ chars)
  for (const word of studentWords) {
    if (word.length >= 4 && passage.includes(word)) {
      verbatimWords++;
    }
  }
  
  const verbatimRate = (verbatimWords / studentWords.length) * 100;
  
  return {
    verbatimRate: Math.round(verbatimRate),
    isVerbatim: verbatimRate > 90,
    phrases: [...new Set(verbatimPhrases)].slice(0, 5)
  };
}

// ─── FORM VALIDATION ─────────────────────────────────────────────────────────
function validateForm(text) {
  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  const wc = words.length;
  
  if (wc < 5) return { valid: false, score: 0, reason: 'Too short (min 5 words)', wc };
  if (wc > 75) return { valid: false, score: 0, reason: 'Too long (max 75 words)', wc };
  
  // Check ending punctuation
  if (!/[.!?]$/.test(text.trim())) {
    return { valid: false, score: 0, reason: 'Must end with period', wc };
  }
  
  // Check single sentence
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
  
  // Check connector
  const connectors = ['however', 'therefore', 'moreover', 'furthermore', 'consequently', 'thus', 'although', 'though', 'while', 'whereas'];
  const hasConnector = connectors.some(c => lower.includes(c));
  const hasSemicolon = /;\s*(however|therefore|moreover|furthermore|consequently|thus|although|though)/i.test(text);
  
  if (!hasConnector) {
    issues.push('No connector detected - use however, therefore, etc.');
    score = 1;
  } else if (!hasSemicolon) {
    issues.push('Missing semicolon before connector (e.g., "; however,")');
    score = 1;
  }
  
  // Check capital letter at start
  if (!/^[A-Z]/.test(text.trim())) {
    issues.push('Sentence must start with capital letter');
    score = Math.min(score, 1);
  }
  
  // Major errors
  if (/(people|they|countries|nations|economies).*(is|was)/i.test(text)) {
    issues.push('Subject-verb agreement error (plural subject with singular verb)');
    score = 0;
  }
  
  return {
    score,
    has_connector: hasConnector,
    has_semicolon_before_connector: hasSemicolon,
    connector_type: lower.includes('however') || lower.includes('although') ? 'contrast' : 
                    lower.includes('therefore') || lower.includes('thus') ? 'result' : 'none',
    grammar_issues: issues
  };
}

// ─── VOCABULARY SCORING ──────────────────────────────────────────────────────
function scoreVocabulary(verbatimRate, hasParaphrasing) {
  // PTE allows verbatim copying - 90% or less is acceptable for full score
  if (verbatimRate > 90) {
    return {
      score: 1,
      synonym_usage: 'excessive verbatim copying',
      note: 'Try to paraphrase more - use your own words'
    };
  }
  
  // If good paraphrasing detected
  if (hasParaphrasing) {
    return {
      score: 2,
      synonym_usage: 'good - effective paraphrasing',
      note: 'Good use of synonyms and rephrasing'
    };
  }
  
  // Default - verbatim copying up to 90% is acceptable for PTE
  return {
    score: 2,
    synonym_usage: 'acceptable',
    note: 'Verbatim copying is acceptable for PTE scoring'
  };
}

// ─── GENERATE FEEDBACK ───────────────────────────────────────────────────────
function generateFeedback(coverage, grammar, vocab, verbatim) {
  let feedback = '';
  
  // Content feedback
  const presentCount = coverage.filter(c => c.present).length;
  const missing = coverage.filter(c => !c.present).map(c => c.type);
  
  if (presentCount === 3) {
    feedback = '✓ Excellent! All 3 key ideas captured (Topic, Pivot, Conclusion). ';
  } else if (presentCount === 2) {
    feedback = `Good! 2/3 key ideas found. Missing: ${missing[0]}. `;
  } else if (presentCount === 1) {
    feedback = `Partial coverage. Only 1/3 key ideas found. Missing: ${missing.join(', ')}. `;
  } else {
    feedback = 'Critical: No key ideas detected. Make sure to include the main topic, the pivot/contrast, and the conclusion. ';
  }
  
  // Grammar feedback
  if (grammar.score === 2) {
    feedback += 'Grammar is excellent. ';
  } else if (grammar.score === 1) {
    feedback += `Grammar needs improvement: ${grammar.grammar_issues[0]}. `;
  } else {
    feedback += 'Grammar errors detected. Check subject-verb agreement. ';
  }
  
  // Vocabulary feedback
  if (verbatim.isVerbatim) {
    feedback += 'Excessive verbatim copying (>90%) - try to paraphrase more. ';
  }
  
  return feedback.trim();
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '10.0.0', anthropicConfigured: !!anthropic });
});

app.post('/api/grade', async (req, res) => {
  try {
    const { text, type, prompt, keyPoints } = req.body;
    
    if (!text || !type || !prompt) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    // 1. FORM CHECK
    const form = validateForm(text);
    
    // Use keyPoints from frontend or fallback
    const topicText = keyPoints?.topic || '';
    const pivotText = keyPoints?.pivot || '';
    const conclusionText = keyPoints?.conclusion || '';
    
    if (!form.valid) {
      return res.json({
        trait_scores: { form: 0, content: 0, grammar: 0, vocabulary: 0 },
        content_details: {
          key_ideas_extracted: [topicText, pivotText, conclusionText],
          key_ideas_present: [],
          key_ideas_missing: ['topic', 'pivot', 'conclusion'],
          notes: 'Form invalid'
        },
        grammar_details: { score: 0, has_connector: false, grammar_issues: [] },
        vocabulary_details: { synonym_usage: 'none', verbatim_rate: 0 },
        overall_score: 10,
        raw_score: 0,
        band: 'Band 5',
        form_gate_triggered: true,
        form_reason: form.reason,
        word_count: form.wc,
        feedback: `FORM ERROR: ${form.reason}. Your summary must be one sentence between 5-75 words ending with a period.`,
        key_ideas_status: { topic: false, pivot: false, conclusion: false },
        mode: 'local'
      });
    }

    // 2. CHECK EACH KEY POINT (sequence doesn't matter)
    const topicCheck = checkKeyPoint(text, topicText, 'topic');
    const pivotCheck = checkKeyPoint(text, pivotText, 'pivot');
    const conclusionCheck = checkKeyPoint(text, conclusionText, 'conclusion');
    
    const coverage = [
      { type: 'topic', present: topicCheck.present, ...topicCheck },
      { type: 'pivot', present: pivotCheck.present, ...pivotCheck },
      { type: 'conclusion', present: conclusionCheck.present, ...conclusionCheck }
    ];
    
    // 3. CONTENT SCORING
    // All 3 present = 2/2, 2 present = 1/2, 0-1 present = 0/2
    const presentCount = coverage.filter(c => c.present).length;
    let contentScore = 0;
    if (presentCount === 3) contentScore = 2;
    else if (presentCount === 2) contentScore = 1;
    else contentScore = 0;
    
    // 4. VERBATIM DETECTION
    const verbatim = detectVerbatim(text, prompt);
    
    // 5. GRAMMAR
    const grammar = checkGrammar(text);
    
    // 6. VOCABULARY
    const vocab = scoreVocabulary(verbatim.verbatimRate, verbatim.verbatimRate < 70);
    
    // 7. TOTALS
    const rawScore = 1 + contentScore + grammar.score + vocab.score;
    const overallScore = Math.min(90, 10 + Math.round((rawScore / 7) * 80));
    
    // 8. FEEDBACK
    const feedback = generateFeedback(coverage, grammar, vocab, verbatim);

    res.json({
      trait_scores: {
        form: 1,
        content: contentScore,
        grammar: grammar.score,
        vocabulary: vocab.score
      },
      content_details: {
        key_ideas_extracted: [
          topicText.substring(0, 60) + '...',
          pivotText.substring(0, 60) + '...',
          conclusionText.substring(0, 60) + '...'
        ],
        key_ideas_present: coverage.filter(c => c.present).map(c => c.type),
        key_ideas_missing: coverage.filter(c => !c.present).map(c => c.type),
        notes: `${presentCount}/3 key ideas present`,
        topic_match: topicCheck.matchRate + '%',
        pivot_match: pivotCheck.matchRate + '%',
        conclusion_match: conclusionCheck.matchRate + '%'
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
        verbatim_phrases: verbatim.phrases,
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
  console.log(`✅ PTE SWT Grader v10.0.0 on port ${PORT}`);
  console.log(`🤖 AI: ${anthropic ? 'ACTIVE' : 'LOCAL'}`);
});
needsSemicolon = ['however', 'therefore', 'moreover', 'furthermore', 'consequently', 'thus', 'nevertheless'];
  let hasSemicolon = false;
  
  if (needsSemicolon.includes(connectorWord)) {
    // Check if connector is preceded by semicolon or starts the sentence
    const connectorIndex = lower.indexOf(connectorWord);
    const textBeforeConnector = text.slice(0, connectorIndex);
    hasSemicolon = /;\s*$/.test(textBeforeConnector) || /^\s*\w+/.test(textBeforeConnector) === false;
    
    if (!hasSemicolon && connectorIndex > 0) {
      issues.push(`Missing semicolon or period before "${connectorWord}"`);
      if (score > 1) score = 1;
    }
  }
  
  if (!hasConnector) {
    issues.push('No connector detected - use linking words for better cohesion');
    if (score > 1) score = 1;
  }
  
  // Check for chained connectors (e.g., "However, ...; Moreover, ...")
  const connectorCount = [...Object.values(connectors).flat()].filter(c => lower.includes(c)).length;
  const chainedConnectors = connectorCount > 1;
  
  if (chainedConnectors) {
    issues.push('Multiple connectors detected - may affect clarity');
  }
  
  // Check for sentence completeness
  if (!/[.!?]$/.test(text.trim())) {
    issues.push('Sentence must end with proper punctuation');
    score = 0;
  }
  
  // Check for capital letter at start
  if (!/^[A-Z]/.test(text.trim())) {
    issues.push('Sentence must start with capital letter');
    if (score > 1) score = 1;
  }
  
  // Check for finite verb (simplified)
  const verbPatterns = /\b(is|are|was|were|be|been|being|has|have|had|do|does|did|will|would|could|should|may|might|must|can|shall|shows|indicates|suggests|requires|means|remains|appears|seems|becomes|continues|starts|helps|makes|takes|gives|finds|keeps|leads|serves|expects|falls|raises|acts|improves|attempts|resulted|ensured|remained|faced|required|offered|hoped|concluded|predicted|reduced|impacted|caused|affected|increased|decreased|generated|demonstrated|acknowledged|examined|identified|advised|showed|found|said|noted|mentioned|added|continued|started|wanted|needed|looked|worked|called|tried|asked|moved|played|brought|happened|understood|spent|grew|opened|walked|watched|heard|began|knew|ate|ran|went|came|did|saw|got|had)\b/i;
  
  if (!verbPatterns.test(text) && text.split(/\s+/).length > 3) {
    issues.push('No finite verb detected');
    score = Math.min(score, 1);
  }
  
  // Check for run-on sentences (multiple independent clauses without proper punctuation)
  const clauseCount = (text.match(/\b(and|but|or|so|yet)\b/gi) || []).length;
  if (clauseCount > 2 && !text.includes(';')) {
    issues.push('Possible run-on sentence - consider using semicolons or breaking into multiple sentences');
    if (score > 1) score = 1;
  }
  
  return {
    score,
    has_connector: hasConnector,
    connector_type: connectorType,
    connector_word: connectorWord,
    has_semicolon_before_connector: hasSemicolon,
    chained_connectors: chainedConnectors,
    grammar_issues: issues,
    severity: score === 0 ? 'major' : score === 1 ? 'minor' : 'none'
  };
}

// ─── FORM CHECK ──────────────────────────────────────────────────────────────
function checkForm(text, type) {
  if (!text || typeof text !== 'string') {
    return { valid: false, score: 0, reason: 'Invalid input', wc: 0 };
  }
  
  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  const wc = words.length;
  
  if (type === 'summarize-written-text') {
    if (wc < 5) return { valid: false, score: 0, reason: 'Too short (min 5 words)', wc };
    if (wc > 75) return { valid: false, score: 0, reason: 'Too long (max 75 words)', wc };
    
    // Count sentences (handle abbreviations)
    const clean = text
      .replace(/\b(Dr|Mr|Mrs|Ms|Prof|U\.K|U\.S|U\.S\.A|i\.e|e\.g|etc|vs|vol|vols|inc|ltd|jr|sr|st)\./gi, match => match.replace('.', '##'))
      .replace(/\d+\.\d+/g, match => match.replace('.', '##'));
    
    const sentenceEndings = (clean.match(/[.!?](\s|$)/g) || []).length;
    
    if (sentenceEndings === 0) return { valid: false, score: 0, reason: 'No sentence ending punctuation found', wc };
    if (sentenceEndings > 1) return { valid: false, score: 0, reason: 'Must be exactly one sentence', wc };
    
    return { valid: true, score: 1, reason: 'Valid', wc };
  }
  
  return { valid: false, score: 0, reason: 'Invalid type', wc };
}

// ─── AI GRADING ──────────────────────────────────────────────────────────────
async function gradeWithAI(text, passage, structure, localCheck) {
  const cacheKey = generateCacheKey(text, passage);
  const cached = getCached(cacheKey);
  if (cached) return { ...cached, cached: true };

  if (!anthropic) {
    return {
      content: localCheck.count >= 2 ? (localCheck.count === 3 ? 2 : 1) : 0,
      grammar: analyzeGrammar(text),
      vocabulary: 2,
      mode: 'local',
      cached: false
    };
  }

  const systemPrompt = `You are a PTE Academic examiner. Analyze this SWT response STRICTLY.

Passage Structure:
- TOPIC (first part): ${structure.topic?.text?.substring(0, 100) || 'N/A'}...
- PIVOT (middle contrast): ${structure.pivot?.text ? structure.pivot.text.substring(0, 100) + '...' : 'Not found'}
- CONCLUSION (end): ${structure.conclusion?.text ? structure.conclusion.text.substring(0, 100) + '...' : 'Not found'}

SCORING RULES:
- Content 2/2: ALL THREE (Topic + Pivot + Conclusion) present with accurate meaning
- Content 1/2: Exactly TWO present OR all three but with minor inaccuracies  
- Content 0/2: Zero or one present OR significant misinterpretation

VOCABULARY RULES:
- 2/2: Effective use of synonyms, no unsafe word substitutions
- 1/2: Some synonym use but minor awkwardness OR over-reliance on original text
- 0/2: Poor word choice, significant meaning changes, or copied phrases

The student's response has these keywords detected:
- Topic matched: ${localCheck.matched.topic.join(', ') || 'None'}
- Pivot matched: ${localCheck.matched.pivot.join(', ') || 'None'}  
- Conclusion matched: ${localCheck.matched.conclusion.join(', ') || 'None'}

Return ONLY valid JSON (no markdown, no code blocks):
{
  "content": 0-2,
  "content_notes": "which ideas were found/missed and accuracy assessment",
  "vocabulary": 0-2,
  "vocab_notes": "synonym usage assessment"
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
    
    // Extract JSON from response
    let jsonStr = raw;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }
    
    const result = JSON.parse(jsonStr);
    
    // Validate AI response ranges
    let finalContent = Math.max(0, Math.min(2, Math.round(result.content) || 0));
    let finalVocab = Math.max(0, Math.min(2, Math.round(result.vocabulary) || 2));
    
    // Only override if there's a significant discrepancy (AI hallucination protection)
    if (localCheck.count === 3 && finalContent < 1) {
      finalContent = 1; // At least 1 if local found all 3
    }
    if (localCheck.count <= 1 && finalContent > 1) {
      finalContent = 1; // Cap at 1 if local found 0-1
    }
    
    const finalResult = {
      content: finalContent,
      content_notes: result.content_notes || `Local: ${localCheck.count}/3 ideas`,
      grammar: analyzeGrammar(text),
      vocabulary: finalVocab,
      vocab_notes: result.vocab_notes || '',
      mode: 'ai',
      cached: false
    };
    
    setCache(cacheKey, finalResult);
    return finalResult;
    
  } catch (err) {
    console.error('AI grading error:', err.message);
    return {
      content: localCheck.count >= 2 ? (localCheck.count === 3 ? 2 : 1) : 0,
      content_notes: `AI error (${err.message}), using local: ${localCheck.count}/3`,
      grammar: analyzeGrammar(text),
      vocabulary: 2,
      mode: 'error',
      cached: false
    };
  }
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: '8.1.0', 
    anthropicConfigured: !!anthropic,
    cacheSize: gradeCache.size,
    timestamp: new Date().toISOString()
  });
});

app.post('/api/grade', async (req, res) => {
  try {
    const { text, type, prompt, keyPoints } = req.body;
    
    // Input validation
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid field: text (must be string)' });
    }
    if (!type || typeof type !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid field: type (must be string)' });
    }
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid field: prompt (must be string)' });
    }
    
    // Sanitize inputs
    const sanitizedText = text.slice(0, 5000); // Limit input size
    const sanitizedPrompt = prompt.slice(0, 10000);

    // Form validation
    const form = checkForm(sanitizedText, type);
    
    // Use provided key points OR auto-detect structure
    let structure;
    if (keyPoints && keyPoints.topic && keyPoints.pivot && keyPoints.conclusion) {
      // Use pre-defined key points from frontend
      structure = {
        topic: { text: keyPoints.topic, keywords: extractKeywords(keyPoints.topic), sentence: 0 },
        pivot: { text: keyPoints.pivot, keywords: extractKeywords(keyPoints.pivot), sentence: 1 },
        conclusion: { text: keyPoints.conclusion, keywords: extractKeywords(keyPoints.conclusion), sentence: 2 }
      };
    } else {
      // Auto-detect structure from passage
      structure = analyzePassageStructure(sanitizedPrompt);
    }
    
    // Check student coverage
    const coverage = checkStudentCoverage(sanitizedText, structure);
    
    // FORM GATE - Return early if form is invalid
    if (!form.valid) {
      return res.json({
        trait_scores: { form: 0, content: 0, grammar: 0, vocabulary: 0 },
        content_details: {
          key_ideas_extracted: structure ? [
            structure.topic?.text?.substring(0, 60) + '...',
            structure.pivot?.text ? structure.pivot.text.substring(0, 60) + '...' : 'Not detected',
            structure.conclusion?.text ? structure.conclusion.text.substring(0, 60) + '...' : 'Not detected'
          ] : [],
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
        feedback: `FORM ERROR: ${form.reason}. Your response must be a single sentence between 5-75 words.`,
        key_ideas_status: { topic: false, pivot: false, conclusion: false },
        mode: 'local'
      });
    }

    // Get grades
    const aiResult = await gradeWithAI(sanitizedText, sanitizedPrompt, structure, coverage);
    
    // Calculate totals
    const contentScore = aiResult.content;
    const grammarScore = aiResult.grammar.score;
    const vocabScore = aiResult.vocabulary;
    const rawScore = 1 + contentScore + grammarScore + vocabScore; // Form is 1
    const overallScore = Math.min(90, 10 + Math.round((rawScore / 7) * 80));
    const band = BAND_MAP[Math.min(7, Math.max(0, Math.floor(rawScore)))] || 'Band 5';

    // Build detailed feedback
    let feedback = '';
    if (coverage.count === 3) {
      feedback = 'Excellent! All 3 key ideas captured. ';
    } else if (coverage.count === 2) {
      feedback = `Good work! 2/3 key ideas present. Missing: ${coverage.missing[0]}. `;
    } else if (coverage.count === 1) {
      feedback = `Partial coverage. Only 1/3 key ideas captured. Missing: ${coverage.missing.join(', ')}. `;
    } else {
      feedback = 'Critical: No key ideas from the passage detected. Make sure to include the main topic, any contrasting points, and the conclusion. ';
    }
    
    // Grammar feedback
    if (aiResult.grammar.severity === 'major') {
      feedback += 'Major grammar errors: ' + aiResult.grammar.grammar_issues.join('. ') + '.';
    } else if (aiResult.grammar.severity === 'minor') {
      feedback += 'Minor issues: ' + aiResult.grammar.grammar_issues.join('. ') + '.';
    } else {
      feedback += 'Grammar and structure are excellent.';
    }
    
    // Vocabulary feedback
    if (vocabScore === 2) {
      feedback += ' Vocabulary usage is strong.';
    } else if (vocabScore === 1) {
      feedback += ' Try to use more varied vocabulary and synonyms.';
    } else {
      feedback += ' Work on word choice - avoid copying phrases directly from the passage.';
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
          structure?.topic?.text?.substring(0, 60) + '...' || 'N/A',
          structure?.pivot?.text ? structure.pivot.text.substring(0, 60) + '...' : 'Not detected',
          structure?.conclusion?.text ? structure.conclusion.text.substring(0, 60) + '...' : 'Not detected'
        ],
        key_ideas_present: coverage.present,
        key_ideas_missing: coverage.missing,
        notes: aiResult.content_notes || `${coverage.count}/3 ideas detected`
      },
      grammar_details: {
        score: grammarScore,
        has_connector: aiResult.grammar.has_connector,
        connector_type: aiResult.grammar.connector_type,
        connector_word: aiResult.grammar.connector_word,
        has_semicolon_before_connector: aiResult.grammar.has_semicolon_before_connector,
        chained_connectors: aiResult.grammar.chained_connectors,
        grammar_issues: aiResult.grammar.grammar_issues,
        severity: aiResult.grammar.severity
      },
      vocabulary_details: {
        synonym_usage: vocabScore === 2 ? 'good' : vocabScore === 1 ? 'fair' : 'poor',
        vocab_notes: aiResult.vocab_notes || '',
        smart_swaps_detected: [],
        unsafe_swaps_detected: []
      },
      overall_score: overallScore,
      raw_score: rawScore,
      band,
      word_count: form.wc,
      feedback,
      key_ideas_status: {
        topic: coverage.found.topic,
        pivot: coverage.found.pivot,
        conclusion: coverage.found.conclusion
      },
      mode: aiResult.mode,
      cached: aiResult.cached || false
    });

  } catch (error) {
    console.error('Grading error:', error);
    res.status(500).json({ 
      error: 'Server error during grading', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ PTE SWT Grader v8.1.0 on port ${PORT}`);
  console.log(`🤖 AI: ${anthropic ? 'ACTIVE' : 'LOCAL ONLY'}`);
  console.log(`⏰ ${new Date().toISOString()}`);
});
