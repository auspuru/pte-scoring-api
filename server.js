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

// ─── UNSAFE SWAPS DATABASE ───────────────────────────────────────────────────
const UNSAFE_SWAPS = {
  'frustrated': ['angry', 'mad', 'furious'],
  'seduced': ['tricked', 'fooled', 'deceived'],
  'controversial': ['wrong', 'bad', 'false'],
  'argue': ['fight', 'disagree', 'yell'],
  'claim': ['lie', 'pretend', 'say'],
  'suggest': ['tell', 'command', 'force'],
  'acknowledge': ['admit', 'confess', 'agree'],
  'emphasize': ['say', 'tell', 'shout'],
  'demonstrate': ['show', 'prove', 'display'],
  'indicate': ['show', 'say', 'point'],
  'significant': ['big', 'large', 'huge'],
  'substantial': ['big', 'large', 'much'],
  'approximately': ['about', 'around', 'maybe'],
  'economic': ['money', 'cash', 'rich'],
  'environmental': ['green', 'nature', 'tree'],
  'infrastructure': ['buildings', 'roads', 'concrete'],
  'sustainable': ['green', 'eco-friendly', 'recyclable'],
  'consequently': ['so', 'then', 'thus'],
  'furthermore': ['also', 'and', 'plus'],
  'moreover': ['also', 'and', 'plus'],
  'however': ['but', 'yet', 'though'],
  'therefore': ['so', 'thus', 'hence']
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

// ─── LOCAL KEY IDEA EXTRACTION (Fallback/Validation) ─────────────────────────
function extractKeyIdeasLocal(passage) {
  if (!passage) return { topic: null, pivot: null, result: null };
  
  const sentences = passage.match(/[^.!?]+[.!?]+/g) || [passage];
  const firstSentences = sentences.slice(0, 2).join(' ').toLowerCase();
  const lastSentences = sentences.slice(-2).join(' ').toLowerCase();
  
  // TOPIC detection (usually first sentence, contains main subject)
  const topicPatterns = [
    /\b(climate change|economic|economy|gdp|global warming|renewable|energy|technology|infrastructure|government|research|study|report|survey|investigation)\b/i,
    /\b(the\s+\w+\s+(of|in|on|at))\b/i
  ];
  
  let topic = null;
  for (const pattern of topicPatterns) {
    const match = firstSentences.match(pattern);
    if (match) {
      topic = match[0].trim();
      break;
    }
  }
  if (!topic) topic = sentences[0]?.split(' ').slice(0, 5).join(' ') + '...';
  
  // PIVOT detection (contrast words, problem indicators)
  const pivotPatterns = [
    /\b(however|but|although|though|while|whereas|yet|despite|in contrast|on the other hand|unfortunately|problem|challenge|issue|difficulty|crisis|decline|decrease|reduce|fall|drop)\b/i,
    /\b(bear|burden|cost|risk|threat|danger|worry|concern|fear)\b/i
  ];
  
  let pivot = null;
  for (const pattern of pivotPatterns) {
    const match = passage.toLowerCase().match(pattern);
    if (match) {
      pivot = match[0].trim();
      break;
    }
  }
  
  // RESULT detection (solution, conclusion, future, therefore)
  const resultPatterns = [
    /\b(therefore|thus|consequently|as a result|in conclusion|solution|answer|remedy|fix|improve|better|future|hope|optimistic|positive|benefit|advantage|help|aid|assist|require|need|must|should)\b/i,
    /\b(transition|shift|change|move|transform|convert|switch)\b/i
  ];
  
  let result = null;
  for (const pattern of resultPatterns) {
    const match = lastSentences.match(pattern);
    if (match) {
      result = match[0].trim();
      break;
    }
  }
  
  return { topic, pivot, result };
}

// ─── CHECK KEY IDEAS IN STUDENT RESPONSE ─────────────────────────────────────
function checkKeyIdeasPresent(studentText, keyIdeas) {
  const lowerStudent = studentText.toLowerCase();
  const present = [];
  const missing = [];
  
  // Check Topic
  if (keyIdeas.topic && lowerStudent.includes(keyIdeas.topic.toLowerCase())) {
    present.push('topic');
  } else {
    // Check for synonyms or related concepts
    const topicConcepts = keyIdeas.topic?.toLowerCase().split(' ') || [];
    const hasConcept = topicConcepts.some(word => 
      word.length > 4 && lowerStudent.includes(word)
    );
    if (hasConcept) present.push('topic');
    else missing.push('topic');
  }
  
  // Check Pivot
  if (keyIdeas.pivot && lowerStudent.includes(keyIdeas.pivot.toLowerCase())) {
    present.push('pivot');
  } else {
    // Check for contrast indicators
    const contrastWords = ['however', 'but', 'although', 'yet', 'despite', 'while', 'whereas', 'nevertheless'];
    const hasContrast = contrastWords.some(w => lowerStudent.includes(w));
    if (hasContrast) present.push('pivot');
    else missing.push('pivot');
  }
  
  // Check Result
  if (keyIdeas.result && lowerStudent.includes(keyIdeas.result.toLowerCase())) {
    present.push('result');
  } else {
    // Check for conclusion indicators
    const resultWords = ['therefore', 'thus', 'consequently', 'result', 'solution', 'conclusion', 'hence', 'so'];
    const hasResult = resultWords.some(w => lowerStudent.includes(w));
    if (hasResult) present.push('result');
    else missing.push('result');
  }
  
  return { present, missing, count: present.length };
}

// ─── DETECT UNSAFE SWAPS ─────────────────────────────────────────────────────
function detectUnsafeSwaps(studentText, passageText) {
  const unsafe = [];
  const lowerStudent = studentText.toLowerCase();
  
  if (!passageText) return unsafe;
  
  // Check each unsafe swap
  for (const [original, badSwaps] of Object.entries(UNSAFE_SWAPS)) {
    if (passageText.toLowerCase().includes(original)) {
      // Check if student used a bad swap
      for (const swap of badSwaps) {
        if (lowerStudent.includes(swap)) {
          unsafe.push(`${swap} (should be: ${original})`);
          break;
        }
      }
    }
  }
  
  return unsafe;
}

// ─── SENTENCE & FORM CHECKS ──────────────────────────────────────────────────
function isCompleteSentence(text) {
  if (!text || text.length < 5) return { complete: false, reason: 'Too short' };
  
  const trimmed = text.trim();
  const lastChar = trimmed.slice(-1);
  
  // Check for ending punctuation
  if (!/[.!?]$/.test(trimmed)) {
    return { complete: false, reason: 'Must end with period, question mark, or exclamation' };
  }
  
  // Check for hanging words
  const lastWord = trimmed.split(/\s+/).pop().toLowerCase().replace(/[.!?;,]$/, '');
  const hangingWords = ['for', 'the', 'a', 'an', 'and', 'but', 'or', 'with', 'by', 'to', 'of', 'in', 'on', 'that', 'which', 'who'];
  
  if (hangingWords.includes(lastWord)) {
    return { complete: false, reason: `Incomplete sentence (ends with "${lastWord}")` };
  }
  
  return { complete: true };
}

function hasFiniteVerb(text) {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  
  // Comprehensive verb detection
  const verbPatterns = [
    /\b(is|are|was|were|be|been|being)\s+\w+/i,
    /\b(has|have|had|do|does|did|will|would|could|should|may|might|must)\s+\w+/i,
    /\b(threatens|reduces|impacts|causes|creates|shows|explains|demonstrates|indicates|reveals|suggests|argues|claims|states|acknowledges|discusses|provides|includes|requires|offers|makes|takes|becomes|finds|gives|tells|feels|leaves|puts|means|keeps|begins|seems|helps|writes|stands|loses|pays|continues|changes|leads|considers|appears|serves|sends|expects|builds|stays|falls|reaches|remains|raises|passes|reports|decides|acts|possesses|opts|improves|minimizes|expresses|attempts|highlights|results|ensures|faces|bears|surges|drops|hopes|warns|emphasizes|concludes|predicts|saves|rewards|replaces|exchanges|persuades|develops)\b/i
  ];
  
  return verbPatterns.some(pattern => pattern.test(lowerText));
}

// ─── FORM VALIDATION ─────────────────────────────────────────────────────────
function calculateForm(text, type) {
  const cleanInput = sanitizeInput(text);
  const words = cleanInput.trim().split(/\s+/).filter(w => w.length > 0);
  const wc = words.length;

  if (type === 'summarize-written-text') {
    if (wc < 5) return { score: 0, reason: 'Too short (minimum 5 words)', wordCount: wc };
    if (wc > 75) return { score: 0, reason: 'Too long (maximum 75 words)', wordCount: wc };
    
    // Check single sentence
    const cleanText = cleanInput.replace(/(?:Dr|Mr|Mrs|Ms|Prof|U\.K|U\.S|i\.e|e\.g|etc)\./gi, '##');
    const sentenceCount = (cleanText.match(/[.!?](\s|$)/g) || []).length;
    
    if (sentenceCount !== 1) return { score: 0, reason: 'Must be exactly one sentence', wordCount: wc };
    
    const completeness = isCompleteSentence(cleanInput);
    if (!completeness.complete) return { score: 0, reason: completeness.reason, wordCount: wc };
    
    if (!hasFiniteVerb(cleanInput)) {
      return { score: 0, reason: 'No finite verb detected', wordCount: wc };
    }
    
    return { score: 1, reason: 'Valid', wordCount: wc };
  }
  
  return { score: 0, reason: 'Invalid type', wordCount: wc };
}

// ─── CONNECTOR DETECTION ─────────────────────────────────────────────────────
function detectConnectors(text) {
  const lowerText = text.toLowerCase();
  const found = {
    contrast: ['however', 'yet', 'although', 'while', 'but', 'whereas', 'nevertheless'].filter(c => lowerText.includes(c)),
    addition: ['moreover', 'furthermore', 'additionally', 'also'].filter(c => lowerText.includes(c)),
    result: ['consequently', 'therefore', 'thus', 'hence', 'so', 'accordingly'].filter(c => lowerText.includes(c)),
    hasSemicolonBeforeConnector: /;\s*(however|moreover|furthermore|consequently|therefore|thus|additionally|hence)/gi.test(text),
    chainedConnectors: /;\s*\w+\s*,?.*;\s*\w+/g.test(text)
  };
  
  return found;
}

// ─── AI GRADING ENGINE ───────────────────────────────────────────────────────
async function gradeResponse(text, type, passageText, localKeyIdeas) {
  const cacheKey = (text + type + passageText).slice(0, 200);
  const cached = getCached(cacheKey);
  if (cached) return { ...cached, cached: true };

  const connectorInfo = detectConnectors(text);

  if (!anthropic) {
    // LOCAL FALLBACK MODE
    const keyIdeaCheck = checkKeyIdeasPresent(text, localKeyIdeas);
    const unsafeSwaps = detectUnsafeSwaps(text, passageText);
    
    let contentScore = 0;
    if (keyIdeaCheck.count === 3) contentScore = 2;
    else if (keyIdeaCheck.count === 2) contentScore = 1;
    else contentScore = 0;
    
    let vocabScore = 2;
    if (unsafeSwaps.length > 2) vocabScore = 0;
    else if (unsafeSwaps.length > 0) vocabScore = 1;
    
    const hasConnector = connectorInfo.contrast.length > 0 || connectorInfo.addition.length > 0 || connectorInfo.result.length > 0;
    let grammarScore = 1;
    if (hasConnector && connectorInfo.hasSemicolonBeforeConnector) grammarScore = 2;
    
    return {
      content: contentScore,
      key_ideas_extracted: [localKeyIdeas.topic, localKeyIdeas.pivot, localKeyIdeas.result].filter(Boolean),
      key_ideas_present: keyIdeaCheck.present,
      key_ideas_missing: keyIdeaCheck.missing,
      content_notes: `Local mode: ${keyIdeaCheck.count}/3 key ideas found`,
      grammar: { 
        score: grammarScore, 
        has_connector: hasConnector,
        connector_type: connectorInfo.contrast.length > 0 ? 'contrast' : connectorInfo.result.length > 0 ? 'result' : connectorInfo.addition.length > 0 ? 'addition' : 'none',
        connector_logic_correct: hasConnector,
        chained_connectors: connectorInfo.chainedConnectors,
        has_semicolon_before_connector: connectorInfo.hasSemicolonBeforeConnector,
        spelling_errors: [], 
        grammar_issues: [] 
      },
      vocabulary: vocabScore,
      synonym_usage: unsafeSwaps.length > 0 ? 'unsafe' : 'acceptable',
      smart_swaps_detected: [],
      unsafe_swaps_detected: unsafeSwaps,
      feedback: `LOCAL MODE: ${keyIdeaCheck.count}/3 key ideas found. ${unsafeSwaps.length > 0 ? 'Warning: Unsafe word choices detected.' : ''}`,
      mode: 'local'
    };
  }

  const systemPrompt = `You are a strict PTE Academic examiner for Summarize Written Text (SWT).

=== SCORING RULES - BE STRICT ===
1. CONTENT (0-2 points):
   - Extract exactly 3 key ideas from passage: TOPIC (main subject), PIVOT (contrast/problem), RESULT (conclusion/solution)
   - 2 points = ALL 3 present (verbatim copying ACCEPTABLE)
   - 1 point = Exactly 2 present
   - 0 points = 0-1 present
   
2. GRAMMAR (0-2 points):
   - 2 points = Perfect grammar + uses semicolon + connector (e.g., "; however,")
   - 1 point = Minor errors or missing semicolon
   - 0 points = Major errors
   
3. VOCABULARY (0-2 points):
   - 2 points = Meaning fully preserved
   - 0 points = ANY synonym that changes meaning (e.g., "frustrated"→"angry", "seduced"→"tricked")

=== STRICT VALIDATION ===
- If student misses the PIVOT (contrast point), CONTENT = 0 or 1 max
- If student misses RESULT/CONCLUSION, CONTENT = 1 max
- Verbatim is OK, but missing ideas is NOT OK

Return ONLY JSON:
{
  "content": 0-2,
  "key_ideas_extracted": ["topic: ...", "pivot: ...", "result: ..."],
  "key_ideas_present": ["which ones student got"],
  "key_ideas_missing": ["which ones student missed"],
  "content_notes": "explanation",
  "grammar": {
    "score": 0-2,
    "has_connector": boolean,
    "connector_type": "contrast|addition|result|none",
    "connector_logic_correct": boolean,
    "spelling_errors": [],
    "grammar_issues": []
  },
  "vocabulary": 0-2,
  "synonym_usage": "none|minimal|moderate",
  "unsafe_swaps_detected": [],
  "feedback": "specific feedback"
}`;

  const userPrompt = `PASSAGE: "${passageText}"

STUDENT RESPONSE: "${text}"

STRICT ANALYSIS:
1. First, identify the 3 key ideas in the passage (Topic, Pivot, Result)
2. Check if student response contains ALL THREE ideas (verbatim is fine)
3. If any key idea is missing, DO NOT give full content marks
4. Check for unsafe synonyms (words that change meaning)

Return JSON only.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.0 // Strict consistency
    });

    const rawText = response.content[0].text;
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON found');

    const result = JSON.parse(match[0]);
    
    // VALIDATION: Cross-check with local detection to prevent AI hallucination
    const localCheck = checkKeyIdeasPresent(text, localKeyIdeas);
    if (result.content === 2 && localCheck.count < 2) {
      // AI is being too generous, override
      result.content = localCheck.count >= 2 ? 1 : 0;
      result.content_notes = (result.content_notes || '') + ' [Corrected by validation]';
    }
    
    // Add connector info
    if (!result.grammar) result.grammar = {};
    result.grammar.has_semicolon_before_connector = connectorInfo.hasSemicolonBeforeConnector;
    result.grammar.chained_connectors = connectorInfo.chainedConnectors;
    
    const finalResult = { ...result, mode: 'ai' };
    setCache(cacheKey, finalResult);
    return finalResult;

  } catch (err) {
    console.error('AI Error:', err.message);
    
    // Failover to local grading
    const keyIdeaCheck = checkKeyIdeasPresent(text, localKeyIdeas);
    const unsafeSwaps = detectUnsafeSwaps(text, passageText);
    
    let contentScore = 0;
    if (keyIdeaCheck.count === 3) contentScore = 2;
    else if (keyIdeaCheck.count === 2) contentScore = 1;
    
    return {
      content: contentScore,
      key_ideas_extracted: [localKeyIdeas.topic, localKeyIdeas.pivot, localKeyIdeas.result].filter(Boolean),
      key_ideas_present: keyIdeaCheck.present,
      key_ideas_missing: keyIdeaCheck.missing,
      content_notes: `AI Error - Local fallback: ${err.message}`,
      grammar: { 
        score: 1, 
        has_connector: connectorInfo.contrast.length > 0 || connectorInfo.result.length > 0,
        connector_type: 'none',
        connector_logic_correct: false,
        chained_connectors: connectorInfo.chainedConnectors,
        has_semicolon_before_connector: connectorInfo.hasSemicolonBeforeConnector,
        spelling_errors: [], 
        grammar_issues: [err.message] 
      },
      vocabulary: unsafeSwaps.length > 0 ? 1 : 2,
      synonym_usage: 'error',
      smart_swaps_detected: [],
      unsafe_swaps_detected: unsafeSwaps,
      feedback: `AI Error: ${err.message}. Local scoring applied.`,
      mode: 'error-fallback'
    };
  }
}

// ─── BUILD FEEDBACK ──────────────────────────────────────────────────────────
function buildFeedback(result, formCheck, connectorInfo, keyIdeaCheck) {
  const parts = [];
  
  // Content feedback
  if (keyIdeaCheck.count === 0) {
    parts.push("Critical: You missed all main points from the passage.");
  } else if (keyIdeaCheck.count === 1) {
    parts.push(`Weak content: You only captured 1/3 key ideas. Missing: ${keyIdeaCheck.missing.join(', ')}`);
  } else if (keyIdeaCheck.count === 2) {
    parts.push(`Good: You captured 2/3 key ideas. Missing: ${keyIdeaCheck.missing.join(', ')}`);
  } else {
    parts.push("Excellent: You captured all 3 key ideas from the passage.");
  }
  
  // Grammar feedback
  if (!connectorInfo.hasSemicolonBeforeConnector) {
    parts.push("Use semicolons before connectors for Band 9 style: '; however,' '; therefore,'");
  }
  
  // Vocabulary feedback
  if (result.unsafe_swaps_detected?.length > 0) {
    parts.push(`Warning: ${result.unsafe_swaps_detected.length} unsafe word choice(s) detected.`);
  }
  
  return parts.join(' ');
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: '7.2.0', 
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
    
    // Extract key ideas locally first (for validation)
    const localKeyIdeas = extractKeyIdeasLocal(prompt);
    
    // FORM GATE - Strict enforcement
    if (formCheck.score === 0) {
      return res.json({
        trait_scores: { form: 0, content: 0, grammar: 0, vocabulary: 0 },
        content_details: { 
          key_ideas_extracted: [], 
          key_ideas_present: [], 
          key_ideas_missing: [], 
          notes: 'Form invalid - no content scored'
        },
        grammar_details: { 
          score: 0,
          has_connector: false, 
          connector_type: 'none',
          has_semicolon_before_connector: false,
          chained_connectors: false,
          spelling_errors: [], 
          grammar_issues: [] 
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
        feedback: `FORM ERROR: ${formCheck.reason}. Write one sentence (5-75 words).`,
        key_ideas_status: { topic: false, pivot: false, conclusion: false },
        mode: 'local'
      });
    }

    const result = await gradeResponse(cleanText, type, prompt, localKeyIdeas);
    const connectorInfo = detectConnectors(cleanText);
    const keyIdeaCheck = checkKeyIdeasPresent(cleanText, localKeyIdeas);
    
    // Final content validation
    let finalContentScore = result.content || 0;
    
    // Strict enforcement: if local detection shows < 2 ideas, cap the score
    if (keyIdeaCheck.count === 0 && finalContentScore > 0) finalContentScore = 0;
    if (keyIdeaCheck.count === 1 && finalContentScore > 0) finalContentScore = 0; // 1 idea = 0 pts
    if (keyIdeaCheck.count === 2 && finalContentScore > 1) finalContentScore = 1;
    if (keyIdeaCheck.count === 3 && finalContentScore < 2) finalContentScore = 2;
    
    const grammarScore = result.grammar?.score || 0;
    const vocabScore = result.vocabulary || 0;
    const rawScore = formCheck.score + finalContentScore + grammarScore + vocabScore;
    
    // Convert to PTE score (10-90)
    const overallScore = Math.min(90, 10 + Math.round((rawScore / 7) * 80));

    // Build response matching README exactly
    const response = {
      trait_scores: {
        form: formCheck.score,
        content: finalContentScore,
        grammar: grammarScore,
        vocabulary: vocabScore
      },
      content_details: {
        key_ideas_extracted: result.key_ideas_extracted || [],
        key_ideas_present: result.key_ideas_present || keyIdeaCheck.present,
        key_ideas_missing: result.key_ideas_missing || keyIdeaCheck.missing,
        notes: result.content_notes || ''
      },
      grammar_details: {
        score: grammarScore,
        has_connector: result.grammar?.has_connector || (connectorInfo.contrast.length + connectorInfo.addition.length + connectorInfo.result.length > 0),
        connector_type: result.grammar?.connector_type || (connectorInfo.contrast.length > 0 ? 'contrast' : connectorInfo.result.length > 0 ? 'result' : connectorInfo.addition.length > 0 ? 'addition' : 'none'),
        has_semicolon_before_connector: result.grammar?.has_semicolon_before_connector || connectorInfo.hasSemicolonBeforeConnector,
        chained_connectors: result.grammar?.chained_connectors || connectorInfo.chainedConnectors,
        spelling_errors: result.grammar?.spelling_errors || [],
        grammar_issues: result.grammar?.grammar_issues || []
      },
      vocabulary_details: {
        synonym_usage: result.synonym_usage || 'minimal',
        smart_swaps_detected: result.smart_swaps_detected || [],
        unsafe_swaps_detected: result.unsafe_swaps_detected || detectUnsafeSwaps(cleanText, prompt)
      },
      overall_score: overallScore,
      raw_score: rawScore,
      band: BAND_MAP[Math.floor(rawScore)] || 'Band 5',
      word_count: formCheck.wordCount,
      feedback: buildFeedback(result, formCheck, connectorInfo, keyIdeaCheck),
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
  console.log(`✅ PTE SWT Logic Grader v7.2.0 running on port ${PORT}`);
  console.log(`🤖 AI: ${anthropic ? 'ACTIVE' : 'LOCAL MODE'}`);
  console.log(`🛡️  Validation: ENABLED`);
});
