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

// ─── BAND MAP (Updated for PTE SWT 0-7 scale) ────────────────────────────────
const BAND_MAP = {
  0: 'Band 5', 1: 'Band 5',
  2: 'Band 6',
  3: 'Band 6.5',
  4: 'Band 7',
  5: 'Band 7.5',
  6: 'Band 8',
  7: 'Band 9'
};

// ─── CONNECTOR REFERENCE (From README Section 5.5) ───────────────────────────
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
  
  // Check for hanging words (prepositions, articles, conjunctions)
  const hangingWords = ['for', 'the', 'a', 'an', 'and', 'but', 'or', 'with', 'by', 'to', 'of', 'in', 'on', 'that', 'which', 'who', 'as', 'at', 'is', 'was', 'were'];
  
  if (hangingWords.includes(lastWord) && lastChar !== '.') {
    return { complete: false, reason: `Incomplete sentence (ends with "${lastWord}")` };
  }
  
  // Must end with proper punctuation
  if (!/[.!?]$/.test(trimmed)) {
    return { complete: false, reason: 'Sentence must end with period, question mark, or exclamation' };
  }
  
  return { complete: true };
}

// ─── FINITE VERB CHECK ───────────────────────────────────────────────────────
function hasFiniteVerb(text) {
  if (!text) return false;
  
  const lowerText = text.toLowerCase();
  
  // Pattern 1: Being verbs + complement
  const beingPattern = /\b(is|are|was|were|be|been|being)\s+\w+/i;
  
  // Pattern 2: Helping verbs + main verb
  const helpingPattern = /\b(has|have|had|do|does|did|will|would|could|should|may|might|must|shall|can)\s+\w+/i;
  
  // Pattern 3: Past tense verbs (comprehensive list)
  const pastVerbs = /\b(made|took|became|found|gave|told|felt|left|put|meant|kept|began|seemed|helped|showed|wrote|provided|stood|lost|paid|included|continued|changed|led|considered|appeared|served|sent|expected|built|stayed|fell|reached|remained|suggested|raised|passed|required|reported|decided|explained|emphasized|warned|revealed|acknowledged|demonstrated|indicated|suggested|argued|claimed|stated|identified|examined|credited|discussed|transformed|overtook|dominated|generated|acted|possessed|opted|created|allowed|improved|expressed|attempted|highlighted|resulted|ensured|remained|faced|bore|surged|dropped|required|offered|hoped|concluded|predicted|reduced|impacted|caused|affected|threatened|increased|decreased|showed|found|thought|believed|said|noted|mentioned|added|continued|started|wanted|needed|looked|worked|lived|called|tried|asked|moved|played|believed|brought|happened|stood|understood|wrote|spoke|spent|grew|opened|walked|watched|heard|let|began|knew|ate|ran|went|came|did|saw|got|had|did)\b/i;
  
  // Pattern 4: Present tense verbs (3rd person singular)
  const presentVerbs = /\b(threatens|affects|reduces|impacts|causes|creates|demonstrates|indicates|reveals|shows|explains|emphasizes|warns|claims|states|suggests|argues|acknowledges|discusses|provides|includes|requires|offers|makes|takes|becomes|finds|gives|tells|feels|leaves|puts|means|keeps|begins|seems|helps|writes|stands|loses|pays|continues|changes|leads|considers|appears|serves|sends|expects|builds|stays|falls|reaches|remains|raises|passes|reports|decides|acts|possesses|opts|demonstrates|indicates|reveals|discovers|challenges|advises|argues|claims|states|finds|identifies|examines|credits|discusses|transforms|overtakes|dominates|generates|acknowledges|opts|significantly impacts|creates|allows|improves|minimizes|expressed|attempts|discussed|explained|highlighted|suggested|results|ensures|remains|faces|bears|surges|drops|requires|offers|hopes|warns|emphasizes|reveals|concludes|predicts|indicates|saves|rewards|replaces|exchanges|persuades|develops|becomes|stays|runs|comes|goes|does|has|says|gets|makes|takes|sees|knows|thinks|looks|wants|needs|likes|uses|finds|gives|tells|asks|works|feels|tries|leaves|calls|keeps|brings|begins|helps|shows|hears|plays|runs|moves|lives|believes|brought|happened|stood|understood|wrote|spoke|spent|grew|opened|walked|watched)\b/i;
  
  // Check all patterns
  if (beingPattern.test(lowerText)) return true;
  if (helpingPattern.test(lowerText)) return true;
  if (pastVerbs.test(lowerText)) return true;
  if (presentVerbs.test(lowerText)) return true;
  
  // Fallback: Check for common verb endings (-s, -es, -ed, -ing)
  const words = lowerText.split(/\s+/);
  const verbEndingPattern = /(s|es|ed|ing|tion|sion)$/;
  const hasVerbEnding = words.some(word => {
    const clean = word.replace(/[.,;!?]$/, '');
    return clean.length > 2 && verbEndingPattern.test(clean) && 
           !['this', 'thus', 'gas', 'pass', 'class', 'glass', 'grass', 'across', 'loss', 'boss', 'toss', 'crisis', 'analysis', 'basis', 'his', 'hers', 'its', 'ours', 'yours', 'theirs'].includes(clean);
  });
  
  return hasVerbEnding;
}

// ─── CONNECTOR DETECTION (NEW - Based on README Section 5.5) ─────────────────
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
  
  // Check for each connector type
  Object.keys(CONNECTORS).forEach(type => {
    CONNECTORS[type].forEach(connector => {
      const regex = new RegExp(`\\b${connector}\\b`, 'gi');
      const matches = lowerText.match(regex);
      if (matches) {
        found[type].push(connector);
      }
    });
  });
  
  // Check for semicolon before connector (Band 9 style)
  const semicolonConnectorPattern = /;\s*(however|moreover|furthermore|consequently|therefore|thus|additionally)/gi;
  found.hasSemicolonBeforeConnector = semicolonConnectorPattern.test(text);
  
  // Check for chained connectors (multiple semicolons with connectors)
  const chainedPattern = /;\s*\w+\s*,?.*;\s*\w+/;
  found.chainedConnectors = chainedPattern.test(text);
  
  return found;
}

// ─── FORM VALIDATION (Updated per README Section 3.2) ────────────────────────
function calculateForm(text, type) {
  const cleanInput = sanitizeInput(text);
  const words = cleanInput.trim().split(/\s+/).filter(w => w.length > 0);
  const wc = words.length;

  if (type === 'summarize-written-text') {
    // Word count check first (5-75 words per README)
    if (wc < 5) return { score: 0, reason: 'Too short (minimum 5 words)', wordCount: wc };
    if (wc > 75) return { score: 0, reason: 'Too long (maximum 75 words)', wordCount: wc };
    
    // Sentence count check - CRITICAL: Multiple sentences = automatic 0
    const cleanText = cleanInput.replace(/(?:Dr|Mr|Mrs|Ms|Prof|U\.K|U\.S|i\.e|e\.g|etc)\./gi, '##');
    const sentenceCount = (cleanText.match(/[.!?](\s|$)/g) || []).length;
    
    if (sentenceCount !== 1) return { score: 0, reason: 'Must be exactly one sentence', wordCount: wc };
    
    // Completeness check
    const completeness = isCompleteSentence(cleanInput);
    if (!completeness.complete) return { score: 0, reason: completeness.reason, wordCount: wc };
    
    // Finite verb check
    if (!hasFiniteVerb(cleanInput)) {
      return { score: 0, reason: 'No finite verb detected - add a main verb like "threatens", "affects", "reduces"', wordCount: wc };
    }
    
    return { score: 1, reason: 'Valid', wordCount: wc };
  }
  
  return { score: 0, reason: 'Invalid type', wordCount: wc };
}

// ─── FIRST PERSON / PERSPECTIVE SHIFT CHECK ──────────────────────────────────
function checkPerspectiveShift(text, passageText) {
  if (!passageText) return { penalty: false, note: null };
  
  // Check if passage uses first person
  const firstPersonIndicators = ['\bI\b', '\bmy\b', '\bme\b', "\bI've\b", "\bI'd\b", "\bI'm\b"];
  const iCount = firstPersonIndicators.reduce((count, pattern) => {
    const matches = passageText.match(new RegExp(pattern, 'gi'));
    return count + (matches ? matches.length : 0);
  }, 0);
  
  const isFirstPersonPassage = iCount > 2;
  
  // Check if response uses first person when it shouldn't
  if (isFirstPersonPassage && /^\s*(I|My|Me)\b/.test(text)) {
    return { 
      penalty: true, 
      note: "Perspective shift needed: Use 'The author' instead of 'I' for first-person passages" 
    };
  }
  
  return { penalty: false, note: null };
}

// ─── WORD COUNT OPTIMALITY CHECK (NEW - Per README Section 8.2) ──────────────
function getWordCountFeedback(wc) {
  if (wc < 40) {
    return { 
      optimal: false, 
      feedback: `Word count (${wc}) is below optimal range. Band 9 responses are typically 50-75 words. Aim higher to ensure comprehensive content coverage.` 
    };
  }
  if (wc >= 50 && wc <= 75) {
    return { 
      optimal: true, 
      feedback: `Excellent word count (${wc})! This is the Band 9 sweet spot for comprehensive coverage.` 
    };
  }
  if (wc > 40 && wc < 50) {
    return { 
      optimal: true, 
      feedback: `Good word count (${wc}). Consider expanding to 50-75 words for maximum content coverage.` 
    };
  }
  return { optimal: true, feedback: null };
}

// ─── AI GRADING ENGINE (Updated per README Band 9 Insights) ──────────────────
async function gradeResponse(text, type, passageText) {
  const cacheKey = (text + type + passageText).slice(0, 200);
  const cached = getCached(cacheKey);
  if (cached) return { ...cached, cached: true };

  const perspectiveCheck = checkPerspectiveShift(text, passageText);
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
      compression_detected: false,
      compressed_items: [],
      verbatim_acceptable: true,
      feedback: 'Running in local mode. Set ANTHROPIC_API_KEY for AI grading.',
      mode: 'local'
    };
  }

  // Updated system prompt based on README Band 9 Insights
  const systemPrompt = `You are a PTE Academic examiner specializing in Summarize Written Text (SWT). Score based on the official PTE criteria with Band 9 insights.

=== BAND 9 INSIGHTS (CRITICAL) ===
1. CONTENT COVERAGE TRUMPS CONCISENESS: Including extra details is OK. Missing key details hurts your score.
2. VERBATIM IS ACCEPTABLE: 95% verbatim copying is perfectly fine. Do NOT penalize for copying key phrases.
3. MEANING PRESERVATION IS CRITICAL: Accurate vocabulary that preserves meaning scores higher than sophisticated vocabulary that changes nuance.
4. OPTIMAL WORD COUNT: 50-75 words is the sweet spot for Band 9.

=== SCORING CRITERIA ===

CONTENT (0-2 points):
- 2 points: Includes ALL main points and key supporting details from the passage
- 1 point: Includes most main points but misses some supporting details  
- 0 points: Misses main points or includes incorrect information

KEY INSIGHT: Use the "Scan Method" to identify:
1. TOPIC (WHO/WHAT) - Main subject in first 1-2 sentences
2. PIVOT - Contrast words (however, but, although) indicating a shift
3. RESULT - Conclusion or final outcome in last 1-2 sentences

FORM (0-1 point):
- 1 point: Single sentence, 5-75 words
- 0 points: Multiple sentences OR word count outside range
CRITICAL: Multiple sentences = automatic 0 for Form

GRAMMAR (0-2 points):
- 2 points: Correct grammatical structure with proper semicolons + connectors (however/moreover/consequently)
- 1 point: Minor errors that don't impede understanding OR missing proper connector
- 0 points: Major errors that affect comprehension

Band 9 Style: Use semicolons before connectors: "; however," "; moreover," "; therefore,"

VOCABULARY (0-2 points):
- 2 points: Appropriate word choice that preserves meaning (verbatim is OK!)
- 1 point: Adequate vocabulary with some awkward phrasing
- 0 points: Inappropriate word choice or altered meaning

KEY INSIGHT: Simple but accurate > fancy but wrong. Don't force synonyms if they change nuance.

=== CONNECTOR REFERENCE ===
- Contrast: however, yet, although, while, but
- Addition: moreover, furthermore, additionally
- Result: consequently, therefore, thus

=== PERSPECTIVE SHIFT ===
If passage uses first person (I, my, me), response should use "The author" or "The narrator".

Return ONLY JSON:
{
  "content": 0-2,
  "key_ideas_extracted": ["topic", "pivot", "result"],
  "key_ideas_present": [],
  "key_ideas_missing": [],
  "content_notes": "",
  "grammar": {
    "score": 0-2,
    "has_connector": false,
    "connector_type": "none|contrast|addition|result",
    "connector_logic_correct": false,
    "chained_connectors": false,
    "has_semicolon_before_connector": false,
    "spelling_errors": [],
    "grammar_issues": []
  },
  "vocabulary": 0-2,
  "synonym_usage": "none|minimal|moderate|extensive",
  "smart_swaps_detected": [],
  "unsafe_swaps_detected": [],
  "compression_detected": false,
  "verbatim_phrases": [],
  "feedback": ""
}`;

  const userPrompt = `PASSAGE: "${passageText}"

STUDENT RESPONSE: "${text}"

${perspectiveCheck.penalty ? 'NOTE: Perspective shift issue detected - student used first person for a first-person passage.' : ''}

Analyze using the Scan Method (Topic + Pivot + Result). Remember: Verbatim copying is acceptable. Meaning preservation is critical. Content coverage trumps conciseness.

Return JSON only.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1200,
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
    result.grammar.chained_connectors = connectorInfo.chainedConnectors || result.grammar.chained_connectors;
    
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
      compression_detected: false,
      verbatim_phrases: [],
      feedback: `Error: ${err.message}. Please try again.`,
      mode: 'error'
    };
  }
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: '7.0.0', 
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
    const wordCountFeedback = getWordCountFeedback(formCheck.wordCount);
    const connectorInfo = detectConnectors(cleanText);

    // FORM GATE: If form is invalid, return immediately with 0 scores
    if (formCheck.score === 0) {
      return res.json({
        trait_scores: { form: 0, content: 0, grammar: 0, vocabulary: 0 },
        content_details: { 
          key_ideas_extracted: [], 
          key_ideas_present: [], 
          key_ideas_missing: [], 
          notes: 'Form invalid - ' + formCheck.reason 
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
          compression_detected: false, 
          compressed_items: [] 
        },
        overall_score: 10,
        raw_score: 0,
        band: 'Band 5',
        form_gate_triggered: true,
        form_reason: formCheck.reason,
        word_count: formCheck.wordCount,
        word_count_feedback: wordCountFeedback.feedback,
        feedback: `FORM ERROR: ${formCheck.reason}. Your summary must be one complete sentence (5-75 words) with a subject and main verb. CRITICAL: Multiple sentences = automatic 0 for Form.`,
        band_9_insights: {
          verbatim_acceptable: true,
          content_coverage_priority: true,
          optimal_word_count: '50-75 words'
        }
      });
    }

    const result = await gradeResponse(cleanText, type, prompt);
    
    // Apply perspective shift penalty if needed
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

    // Determine which key ideas are present for frontend display
    const keyIdeasPresent = result.key_ideas_present || [];
    const keyIdeasMissing = result.key_ideas_missing || [];
    
    // Build comprehensive feedback
    let feedback = result.feedback || '';
    
    // Add word count feedback
    if (wordCountFeedback.feedback) {
      feedback += ` ${wordCountFeedback.feedback}`;
    }
    
    // Add perspective shift note
    if (perspectiveCheck.penalty) {
      feedback += ` ${perspectiveCheck.note}`;
    }
    
    // Add connector feedback
    if (!result.grammar?.has_connector && !result.grammar?.has_semicolon_before_connector) {
      feedback += ` Consider using semicolons with connectors (e.g., "; however," "; moreover," "; therefore,") for Band 9 grammar.`;
    }
    
    // Add verbatim encouragement
    if (result.synonym_usage === 'extensive' || (result.unsafe_swaps_detected && result.unsafe_swaps_detected.length > 0)) {
      feedback += ` Band 9 insight: Verbatim copying is acceptable. Focus on meaning preservation over fancy synonyms.`;
    }

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
        optimal_word_count: '50-75 words',
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
