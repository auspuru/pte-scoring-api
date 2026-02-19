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

// ─── BAND MAP (PTE SWT 0-7 scale) ────────────────────────────────────────────
const BAND_MAP = {
  0: 'Band 5', 1: 'Band 5',
  2: 'Band 6',
  3: 'Band 6.5',
  4: 'Band 7',
  5: 'Band 7.5',
  6: 'Band 8',
  7: 'Band 9'
};

// ─── CONNECTOR REFERENCE ─────────────────────────────────────────────────────
const CONNECTORS = {
  contrast: ['however', 'yet', 'although', 'while', 'but'],
  addition: ['moreover', 'furthermore', 'additionally', 'also'],
  result: ['consequently', 'therefore', 'thus', 'hence', 'so'],
  example: ['for instance', 'specifically', 'such as']
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

// ─── SENTENCE COMPLETENESS CHECK ─────────────────────────────────────────────
function isCompleteSentence(text) {
  if (!text || text.length < 5) return { complete: false, reason: 'Too short' };
  
  const trimmed = text.trim();
  const lastChar = trimmed.slice(-1);
  const lastWord = trimmed.split(/\s+/).pop().toLowerCase().replace(/[.!?;,]$/, '');
  
  const hangingWords = ['for', 'the', 'a', 'an', 'and', 'but', 'or', 'with', 'by', 'to', 'of', 'in', 'on', 'that', 'which', 'who', 'as', 'at', 'is', 'was', 'were'];
  
  if (hangingWords.includes(lastWord) && lastChar !== '.') {
    return { complete: false, reason: `Incomplete sentence (ends with "${lastWord}")` };
  }
  
  if (!/[.!?]$/.test(trimmed)) {
    return { complete: false, reason: 'Sentence must end with period, question mark, or exclamation' };
  }
  
  return { complete: true };
}

// ─── FINITE VERB CHECK ───────────────────────────────────────────────────────
function hasFiniteVerb(text) {
  if (!text) return false;
  
  const lowerText = text.toLowerCase();
  
  const beingPattern = /\b(is|are|was|were|be|been|being)\s+\w+/i;
  const helpingPattern = /\b(has|have|had|do|does|did|will|would|could|should|may|might|must|shall|can)\s+\w+/i;
  const pastVerbs = /\b(made|took|became|found|gave|told|felt|left|put|meant|kept|began|seemed|helped|showed|wrote|provided|stood|lost|paid|included|continued|changed|led|considered|appeared|served|sent|expected|built|stayed|fell|reached|remained|suggested|raised|passed|required|reported|decided|explained|emphasized|warned|revealed|acknowledged|demonstrated|indicated|suggested|argued|claimed|stated|identified|examined|credited|discussed|transformed|overtook|dominated|generated|acted|possessed|opted|created|allowed|improved|expressed|attempted|highlighted|resulted|ensured|remained|faced|bore|surged|dropped|required|offered|hoped|concluded|predicted|reduced|impacted|caused|affected|threatened|increased|decreased|showed|found|thought|believed|said|noted|mentioned|added|continued|started|wanted|needed|looked|worked|lived|called|tried|asked|moved|played|believed|brought|happened|stood|understood|wrote|spoke|spent|grew|opened|walked|watched|heard|let|began|knew|ate|ran|went|came|did|saw|got|had|did)\b/i;
  const presentVerbs = /\b(threatens|affects|reduces|impacts|causes|creates|demonstrates|indicates|reveals|shows|explains|emphasizes|warns|claims|states|suggests|argues|acknowledges|discusses|provides|includes|requires|offers|makes|takes|becomes|finds|gives|tells|feels|leaves|puts|means|keeps|begins|seems|helps|writes|stands|loses|pays|continues|changes|leads|considers|appears|serves|sends|expects|builds|stays|falls|reaches|remains|raises|passes|reports|decides|acts|possesses|opts|demonstrates|indicates|reveals|discovers|challenges|advises|argues|claims|states|finds|identifies|examines|credits|discusses|transforms|overtakes|dominates|generates|acknowledges|opts|significantly impacts|creates|allows|improves|minimizes|expressed|attempts|discussed|explained|highlighted|suggested|results|ensures|remains|faces|bears|surges|drops|requires|offers|hopes|warns|emphasizes|reveals|concludes|predicts|indicates|saves|rewards|replaces|exchanges|persuades|develops|becomes|stays|runs|comes|goes|does|has|says|gets|makes|takes|sees|knows|thinks|looks|wants|needs|likes|uses|finds|gives|tells|asks|works|feels|tries|leaves|calls|keeps|brings|begins|helps|shows|hears|plays|runs|moves|lives|believes|brought|happened|stood|understood|wrote|spoke|spent|grew|opened|walked|watched)\b/i;
  
  if (beingPattern.test(lowerText)) return true;
  if (helpingPattern.test(lowerText)) return true;
  if (pastVerbs.test(lowerText)) return true;
  if (presentVerbs.test(lowerText)) return true;
  
  const words = lowerText.split(/\s+/);
  const verbEndingPattern = /(s|es|ed|ing|tion|sion)$/;
  const hasVerbEnding = words.some(word => {
    const clean = word.replace(/[.,;!?]$/, '');
    return clean.length > 2 && verbEndingPattern.test(clean) && 
           !['this', 'thus', 'gas', 'pass', 'class', 'glass', 'grass', 'across', 'loss', 'boss', 'toss', 'crisis', 'analysis', 'basis', 'his', 'hers', 'its', 'ours', 'yours', 'theirs'].includes(clean);
  });
  
  return hasVerbEnding;
}

// ─── CONNECTOR DETECTION ─────────────────────────────────────────────────────
function detectConnectors(text) {
  const lowerText = text.toLowerCase();
  const found = {
    contrast: [],
    addition: [],
    result: [],
    example: [],
    hasSemicolonBeforeConnector: false,
    chainedConnectors: false
  };
  
  Object.keys(CONNECTORS).forEach(type => {
    CONNECTORS[type].forEach(connector => {
      const regex = new RegExp(`\\b${connector}\\b`, 'gi');
      const matches = lowerText.match(regex);
      if (matches) {
        found[type].push(connector);
      }
    });
  });
  
  const semicolonConnectorPattern = /;\s*(however|moreover|furthermore|consequently|therefore|thus|additionally)/gi;
  found.hasSemicolonBeforeConnector = semicolonConnectorPattern.test(text);
  
  const chainedPattern = /;\s*\w+\s*,?.*;\s*\w+/;
  found.chainedConnectors = chainedPattern.test(text);
  
  return found;
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
    
    const completeness = isCompleteSentence(cleanInput);
    if (!completeness.complete) return { score: 0, reason: completeness.reason, wordCount: wc };
    
    if (!hasFiniteVerb(cleanInput)) {
      return { score: 0, reason: 'No finite verb detected - add a main verb', wordCount: wc };
    }
    
    return { score: 1, reason: 'Valid', wordCount: wc };
  }
  
  return { score: 0, reason: 'Invalid type', wordCount: wc };
}

// ─── PERSPECTIVE SHIFT CHECK ─────────────────────────────────────────────────
function checkPerspectiveShift(text, passageText) {
  if (!passageText) return { penalty: false, note: null };
  
  const firstPersonIndicators = ['\\bI\\b', '\\bmy\\b', '\\bme\\b', "\\bI've\\b", "\\bI'd\\b", "\\bI'm\\b"];
  const iCount = firstPersonIndicators.reduce((count, pattern) => {
    const matches = passageText.match(new RegExp(pattern, 'gi'));
    return count + (matches ? matches.length : 0);
  }, 0);
  
  const isFirstPersonPassage = iCount > 2;
  
  if (isFirstPersonPassage && /^\s*(I|My|Me)\b/.test(text)) {
    return { 
      penalty: true, 
      note: "Use 'The author' instead of 'I' for first-person passages" 
    };
  }
  
  return { penalty: false, note: null };
}

// ─── BUILD HONEST FEEDBACK ───────────────────────────────────────────────────
function buildFeedback(result, formCheck, connectorInfo, wordCount, perspectiveCheck) {
  const parts = [];
  const keyIdeasPresent = result.key_ideas_present || [];
  const keyIdeasMissing = result.key_ideas_missing || [];
  
  // Content feedback - BE HONEST
  if (keyIdeasMissing.length === 0 && keyIdeasPresent.length >= 3) {
    parts.push("Excellent! You captured all key points from the passage.");
  } else if (keyIdeasPresent.length >= 2) {
    parts.push(`Good attempt. You captured ${keyIdeasPresent.length} out of 3 key points.`);
    if (keyIdeasMissing.length > 0) {
      parts.push(`Missing: ${keyIdeasMissing.join(', ')}`);
    }
  } else if (keyIdeasPresent.length === 1) {
    parts.push(`You captured only 1 key point. Missing: ${keyIdeasMissing.join(', ')}`);
  } else {
    parts.push("Your summary is missing the main points from the passage.");
  }
  
  // Grammar feedback
  const hasConnector = connectorInfo.contrast.length > 0 || connectorInfo.addition.length > 0 || connectorInfo.result.length > 0;
  if (!hasConnector) {
    parts.push("Add connectors (however, moreover, therefore) to improve grammar score.");
  } else if (!connectorInfo.hasSemicolonBeforeConnector) {
    parts.push("Use semicolons before connectors: '; however,' '; moreover,' '; therefore,'");
  }
  
  // Vocabulary feedback
  if (result.unsafe_swaps_detected && result.unsafe_swaps_detected.length > 0) {
    parts.push(`Unsafe synonym swaps detected: ${result.unsafe_swaps_detected.join(', ')}. Keep original wording to preserve meaning.`);
  }
  
  // Perspective feedback
  if (perspectiveCheck.penalty) {
    parts.push(perspectiveCheck.note);
  }
  
  return parts.join(' ');
}

// ─── AI GRADING ENGINE ───────────────────────────────────────────────────────
async function gradeResponse(text, type, passageText) {
  const cacheKey = (text + type + passageText).slice(0, 200);
  const cached = getCached(cacheKey);
  if (cached) return { ...cached, cached: true };

  const connectorInfo = detectConnectors(text);

  if (!anthropic) {
    return {
      content: 1,
      key_ideas_extracted: ["AI unavailable"],
      key_ideas_present: ["Local mode"],
      key_ideas_missing: ["Connect AI for full grading"],
      content_notes: 'Local fallback mode.',
      grammar: { 
        score: 1, 
        spelling_errors: [], 
        grammar_issues: [], 
        has_connector: connectorInfo.contrast.length > 0 || connectorInfo.addition.length > 0 || connectorInfo.result.length > 0,
        connector_type: connectorInfo.contrast.length > 0 ? 'contrast' : connectorInfo.addition.length > 0 ? 'addition' : connectorInfo.result.length > 0 ? 'result' : 'none',
        connector_logic_correct: false,
        chained_connectors: connectorInfo.chainedConnectors,
        has_semicolon_before_connector: connectorInfo.hasSemicolonBeforeConnector
      },
      vocabulary: 1,
      synonym_usage: 'none',
      smart_swaps_detected: [],
      unsafe_swaps_detected: [],
      feedback: 'Running in local mode. Set ANTHROPIC_API_KEY for AI grading.',
      mode: 'local'
    };
  }

  const systemPrompt = `You are a PTE Academic examiner for Summarize Written Text (SWT).

=== CORE PRINCIPLES ===
1. VERBATIM COPYING IS ACCEPTABLE for capturing main ideas
2. MEANING PRESERVATION is critical - don't penalize for keeping original wording
3. CONTENT COVERAGE matters most - missing key points hurts more than extra words
4. Any word count 5-75 is valid if all key points are captured

=== EXTRACT 3 KEY IDEAS FROM THE PASSAGE ===
1. TOPIC: Main subject/action (WHO/WHAT is this about?)
2. PIVOT: Contrast/problem/shift (however, but, although)
3. RESULT: Conclusion/outcome/solution

=== CONTENT SCORING (0-2) ===
- 2 points: ALL 3 key ideas present (verbatim OK)
- 1 point: 2 key ideas present
- 0 points: 0-1 key ideas present

=== GRAMMAR SCORING (0-2) ===
- 2 points: Correct grammar WITH proper semicolon + connector usage
- 1 point: Minor errors OR missing connector
- 0 points: Major errors affecting comprehension

=== VOCABULARY SCORING (0-2) ===
- 2 points: Accurate word choice, meaning preserved
- 1 point: Some awkward phrasing but meaning clear
- 0 points: Wrong word choice that changes meaning

=== DETECT UNSAFE SYNONYM SWAPS ===
Flag words changed that alter meaning (e.g., "frustrated" -> "angry", "seduced" -> "tricked")

Return ONLY JSON:
{
  "content": 0-2,
  "key_ideas_extracted": ["topic description", "pivot description", "result description"],
  "key_ideas_present": ["which ideas student captured"],
  "key_ideas_missing": ["which ideas student missed"],
  "content_notes": "brief explanation",
  "grammar": {
    "score": 0-2,
    "has_connector": false,
    "connector_type": "none|contrast|addition|result",
    "connector_logic_correct": false,
    "spelling_errors": [],
    "grammar_issues": []
  },
  "vocabulary": 0-2,
  "synonym_usage": "none|minimal|moderate",
  "smart_swaps_detected": [],
  "unsafe_swaps_detected": [],
  "feedback": "honest, specific feedback"
}`;

  const userPrompt = `PASSAGE: "${passageText}"

STUDENT RESPONSE: "${text}"

Analyze using the 3-key-idea framework (Topic + Pivot + Result). Be honest about what was captured vs missed. Verbatim is OK. Return JSON only.`;

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
    
    // Add connector info from local detection
    if (!result.grammar) result.grammar = {};
    result.grammar.has_semicolon_before_connector = connectorInfo.hasSemicolonBeforeConnector;
    result.grammar.chained_connectors = connectorInfo.chainedConnectors;
    
    const finalResult = { ...result, mode: 'ai' };
    setCache(cacheKey, finalResult);
    return finalResult;

  } catch (err) {
    console.error('AI Error:', err.message);
    return {
      content: 1,
      key_ideas_extracted: ["Error"],
      key_ideas_present: [],
      key_ideas_missing: ["Processing failed"],
      content_notes: `Error: ${err.message}`,
      grammar: { 
        score: 1, 
        has_connector: connectorInfo.contrast.length > 0 || connectorInfo.addition.length > 0 || connectorInfo.result.length > 0,
        connector_type: 'none',
        connector_logic_correct: false,
        chained_connectors: connectorInfo.chainedConnectors,
        has_semicolon_before_connector: connectorInfo.hasSemicolonBeforeConnector,
        spelling_errors: [], 
        grammar_issues: [] 
      },
      vocabulary: 1,
      synonym_usage: 'none',
      smart_swaps_detected: [],
      unsafe_swaps_detected: [],
      feedback: `Error: ${err.message}. Please try again.`,
      mode: 'error'
    };
  }
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: '7.1.0', 
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
    const perspectiveCheck = checkPerspectiveShift(cleanText, prompt);
    const connectorInfo = detectConnectors(cleanText);

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
          spelling_errors: [], 
          grammar_issues: [], 
          has_connector: false, 
          connector_type: 'none', 
          connector_logic_correct: false, 
          chained_connectors: false,
          has_semicolon_before_connector: false
        },
        vocabulary_details: { 
          synonym_usage: 'none', 
          smart_swaps_detected: [], 
          unsafe_swaps_detected: [],
          compression_detected: false
        },
        overall_score: 10,
        raw_score: 0,
        band: 'Band 5',
        form_gate_triggered: true,
        form_reason: formCheck.reason,
        word_count: formCheck.wordCount,
        feedback: `FORM ERROR: ${formCheck.reason}. Your summary must be one complete sentence (5-75 words).`,
        key_ideas_status: { topic: false, pivot: false, conclusion: false }
      });
    }

    const result = await gradeResponse(cleanText, type, prompt);
    
    // Apply perspective shift penalty
    let contentScore = result.content || 0;
    if (perspectiveCheck.penalty) {
      contentScore = Math.max(0, contentScore - 0.5);
    }

    // Calculate total score (max 7: Form 1 + Content 2 + Grammar 2 + Vocabulary 2)
    const grammarScore = result.grammar?.score || 0;
    const vocabScore = result.vocabulary || 0;
    const rawScore = formCheck.score + contentScore + grammarScore + vocabScore;
    const maxPossible = 7;
    
    // Convert to PTE overall score (10-90 scale)
    const overallScore = Math.min(90, 10 + Math.round((rawScore / maxPossible) * 80));

    // Determine key ideas status for frontend
    const keyIdeasPresent = result.key_ideas_present || [];
    const keyIdeasMissing = result.key_ideas_missing || [];
    
    const hasTopic = keyIdeasPresent.some(k => k.toLowerCase().includes('topic') || k.toLowerCase().includes('gdp') || k.toLowerCase().includes('economic') || k.toLowerCase().includes('climate'));
    const hasPivot = keyIdeasPresent.some(k => k.toLowerCase().includes('pivot') || k.toLowerCase().includes('however') || k.toLowerCase().includes('but') || k.toLowerCase().includes('developing'));
    const hasConclusion = keyIdeasPresent.some(k => k.toLowerCase().includes('result') || k.toLowerCase().includes('conclusion') || k.toLowerCase().includes('renewable') || k.toLowerCase().includes('solution'));
    
    // Build honest feedback
    const feedback = buildFeedback(result, formCheck, connectorInfo, formCheck.wordCount, perspectiveCheck);
    
    // Word count feedback
    const wordCountFeedback = formCheck.wordCount < 33 ? 'concise' : formCheck.wordCount <= 50 ? 'optimal' : formCheck.wordCount <= 65 ? 'safe' : 'maximum';

    res.json({
      trait_scores: {
        form: formCheck.score,
        content: contentScore,
        grammar: grammarScore,
        vocabulary: vocabScore
      },
      content_details: {
        key_ideas_extracted: result.key_ideas_extracted || [],
        key_ideas_present: keyIdeasPresent,
        key_ideas_missing: keyIdeasMissing,
        perspective_shift_penalty: perspectiveCheck.penalty || false,
        perspective_note: perspectiveCheck.note,
        notes: result.content_notes || '',
        // For frontend display logic (Scan Method)
        has_topic: contentScore >= 1,
        has_pivot: contentScore >= 1.5, 
        has_conclusion: contentScore >= 2
      },
      grammar_details: {
        ...result.grammar,
        has_semicolon_before_connector: result.grammar?.has_semicolon_before_connector || connectorInfo.hasSemicolonBeforeConnector,
        chained_connectors: result.grammar?.chained_connectors || connectorInfo.chainedConnectors
      },
      vocabulary_details: {
        synonym_usage: result.synonym_usage || 'none',
        smart_swaps_detected: result.smart_swaps_detected || [],
        unsafe_swaps_detected: result.unsafe_swaps_detected || [],
        verbatim_phrases: result.verbatim_phrases || [],
        compression_detected: result.compression_detected || false,
        compressed_items: result.compressed_items || []
      },
      overall_score: overallScore,
      raw_score: rawScore,
      band: BAND_MAP[Math.floor(rawScore)] || 'Band 5',
      word_count: formCheck.wordCount,
      word_count_feedback: wordCountFeedback,
      connector_analysis: connectorInfo,
      feedback: feedback.trim(),
      mode: result.mode,
      band_9_insights: {
        verbatim_acceptable: true,
        content_coverage_priority: true,
        meaning_preservation_critical: true,
        word_count_flexibility: 'Any count within 5-75 words is valid - even 33 words can score Band 9',
        scan_method: 'Topic + Pivot + Result',
        connector_style: 'Use semicolons before connectors (e.g., "; however,")'
      }
    });

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
  console.log(`✅ PTE SWT Logic Grader v7.0.0 running on port ${PORT}`);
  console.log(`🤖 AI: ${anthropic ? 'ACTIVE' : 'DISABLED'}`);
  console.log(`📚 Band 9 Insights: ENABLED`);
});
