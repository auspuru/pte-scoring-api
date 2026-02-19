const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ─── BAND MAP ────────────────────────────────────────────────────────────────
const BAND_MAP = {
  0: 'Band 5', 1: 'Band 5', 2: 'Band 5',
  3: 'Band 6', 4: 'Band 6',
  5: 'Band 7', 6: 'Band 7',
  7: 'Band 8',
  8: 'Band 9'
};

// ─── RATE LIMITER (10 requests/minute per IP) ─────────────────────────────────
const requestCounts = new Map();

app.use((req, res, next) => {
  if (req.path !== '/api/grade') return next();

  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowStart = now - 60000;

  for (const [key, time] of requestCounts) {
    if (time < windowStart) requestCounts.delete(key);
  }

  const count = Array.from(requestCounts.entries())
    .filter(([key, time]) => key.startsWith(ip) && time > windowStart)
    .length;

  if (count >= 10) {
    return res.status(429).json({ error: 'Too many requests. Max 10 grades per minute.' });
  }

  requestCounts.set(`${ip}-${now}`, now);
  next();
});

// ─── CACHE (size-limited, no memory leak) ────────────────────────────────────
const gradeCache = new Map();
const MAX_CACHE = 500;

function getCached(key) {
  return gradeCache.get(key) || null;
}

function setCache(key, value) {
  if (gradeCache.size >= MAX_CACHE) {
    const firstKey = gradeCache.keys().next().value;
    gradeCache.delete(firstKey);
  }
  gradeCache.set(key, value);
}

// ─── INPUT SANITIZATION (Prevent prompt injection) ───────────────────────────
function sanitizeInput(text) {
  return text
    .replace(/ignore previous instructions/gi, '')
    .replace(/system prompt/gi, '')
    .replace(/you are now/gi, '')
    .replace(/give me 90/gi, '')
    .slice(0, 2000);
}

// ─── SENTENCE COMPLETENESS CHECK (Prevents hanging prepositions) ─────────────
function isCompleteSentence(text) {
  const lastWord = text.trim().split(/\s+/).pop().toLowerCase().replace(/[.!?;,]$/, '');
  const hangingWords = ['for', 'the', 'a', 'an', 'and', 'but', 'or', 'with', 'by', 'to', 'of', 'in', 'on', 'that', 'which', 'who', 'as', 'at', 'is', 'was'];
  
  if (hangingWords.includes(lastWord)) {
    return { complete: false, reason: `Sentence ends with "${lastWord}" — incomplete thought` };
  }
  
  // Check for opening without closing (parentheses, quotes)
  const openParens = (text.match(/\(/g) || []).length;
  const closeParens = (text.match(/\)/g) || []).length;
  if (openParens !== closeParens) {
    return { complete: false, reason: 'Unmatched parentheses — incomplete sentence' };
  }
  
  return { complete: true };
}

// ─── FINITE VERB VALIDATOR (Prevents noun-list gaming) ───────────────────────
function hasFiniteVerb(text) {
  const patterns = [
    /\b(is|are|was|were|be|been|being)\b/i,
    /\b(has|have|had|do|does|did|will|would|could|should|may|might|must)\s+\w+/i,
    /\b(made|took|became|found|gave|told|felt|left|put|meant|kept|began|seemed|helped|showed|wrote|provided|stood|lost|paid|included|continued|changed|led|considered|appeared|served|sent|expected|built|stayed|fell|reached|remained|suggested|raised|passed|required|reported|decided|explains|persuaded|acknowledged|opted|demonstrates|indicates|reveals|discovered|challenges|advises|argues|claims|states|finds|identifies|examines|credit|discusses|transformed|overtook|dominates|generates|acts|possesses|acknowledged|opted|significantly impacted|created|allows|improved|minimizing|expressed|attempts)\b/i
  ];
  return patterns.some(p => p.test(text));
}

// ─── FORM VALIDATION (grace zone + abbreviation handling + verb check) ────────
function calculateForm(text, type) {
  const cleanInput = sanitizeInput(text);
  const wc = cleanInput.trim().split(/\s+/).filter(w => w.length > 0).length;

  if (type === 'summarize-written-text') {
    const cleanText = cleanInput.replace(/(?:Dr|Mr|Mrs|Ms|Prof|U\.K|U\.S|i\.e|e\.g|etc)\./gi, '##');
    const sentenceCount = (cleanText.match(/[.!?](\s|$)/g) || []).length;

    if (sentenceCount !== 1) return { score: 0, reason: 'Multiple sentences detected', wordCount: wc };
    
    const completeness = isCompleteSentence(cleanInput);
    if (!completeness.complete) return { score: 0, reason: completeness.reason, wordCount: wc };
    
    if (!hasFiniteVerb(cleanInput)) return { score: 0, reason: 'No finite verb — not a complete sentence', wordCount: wc };
    if (wc >= 5 && wc <= 80) return { score: 1, reason: 'Valid', wordCount: wc };
    return { score: 0, reason: wc < 5 ? 'Too short (min 5 words)' : 'Too long (max 75 words)', wordCount: wc };
  }

  if (type === 'write-essay') {
    if (wc >= 200 && wc <= 300) return { score: 2, reason: 'Valid', wordCount: wc };
    if ((wc >= 120 && wc < 200) || (wc > 300 && wc <= 380)) return { score: 1, reason: 'Outside ideal range', wordCount: wc };
    return { score: 0, reason: wc < 120 ? 'Too short' : 'Too long', wordCount: wc };
  }

  return { score: 0, reason: 'Unknown type', wordCount: wc };
}

// ─── IMPROVED FIRST-PERSON DETECTION (Narrative vs Interview quotes) ──────────
function checkFirstPersonTrap(text, passageText) {
  const iCount = (passageText.match(/\b(I|my|me|I've|I'd|I'm)\b/g) || []).length;
  // Only penalise true narratives (3+ first-person uses), not interview quotes with Dr./researcher
  const isNarrative = iCount > 2 && !passageText.includes('Dr.') && !/researcher|professor|scientist/i.test(passageText);

  if (isNarrative && /^\s*(I|My|Me)\b/.test(text)) {
    return {
      penalty: true,
      note: "First-person trap: passage is a narrative using 'I/my' — student must shift to 'The author/narrator'.",
      suggestion: "Change 'I made' to 'The author made' or 'The narrator made'."
    };
  }
  return { penalty: false };
}

// ─── AI GRADING ENGINE ───────────────────────────────────────────────────────
async function gradeResponse(text, type, passageText) {

  const cacheKey = (text + type + passageText).slice(0, 200);
  const cached = getCached(cacheKey);
  if (cached) {
    console.log('Cache hit');
    return { ...cached, cached: true };
  }

  const firstPersonCheck = checkFirstPersonTrap(text, passageText);

  const systemPrompt = [
    'You are an elite PTE Academic Examiner. Evaluate strictly against the passage provided.',
    '',
    '═══════════════════════════════════════════════════════',
    'CONTENT (0-3) — KEY IDEA COVERAGE (NON-NEGOTIABLE)',
    '═══════════════════════════════════════════════════════',
    'STEP 1: Extract 3-4 Key Ideas from the passage (the "Gold" content):',
    '  - Key Idea 1: Main subject/action (what/who is this about?)',
    '  - Key Idea 2: Core conflict/problem/characteristic',
    '  - Key Idea 3: Resolution/outcome/implication',
    '  - Key Idea 4: Important supporting detail (if present)',
    '',
    'STEP 2: Check which Key Ideas appear in student summary (paraphrased OR verbatim OK):',
    '  - Award 1 point per Key Idea captured accurately',
    '  - If meaning is reversed (advantage→disadvantage): 0 for that idea',
    '  - If specific numbers/names are wrong: 0 for that idea',
    '',
    'STEP 3: Content Score (STRICT):',
    '  3/3 = 3 or 4 Key Ideas captured (comprehensive coverage)',
    '  2/3 = 2 Key Ideas captured (partial coverage)',
    '  1/3 = 1 Key Idea captured (poor coverage)',
    '  0/3 = 0 Key Ideas OR only "hook" sentence copied without substance',
    '',
    'CRITICAL RULES:',
    '  - NOISE IS OK: Including extra details (dates, examples, quotes) does not penalize if Key Ideas are present',
    '  - MISSING MAIN = DOOMED: Missing Key Ideas is catastrophic even if grammar is perfect',
    '  - Example: Copying only "Have you ever wondered..." (hook) = 0/3 even if Topic words present',
    '  - Example: Missing the Pivot/Contrast when passage has "But/However" = max 2/3',
    '',
    '═══════════════════════════════════════════════════════',
    'VOCABULARY (0-2) — APPROPRIATENESS PRIMARY',
    '═══════════════════════════════════════════════════════',
    '  2 = Appropriate word choice, meaning clear. Verbatim nouns/terms acceptable.',
    '      Smart swaps are BONUS (frustrated→dissatisfied, large→substantial, etc.)',
    '  1 = Minor word choice issues affecting clarity slightly',
    '  0 = Word choice distorts meaning significantly',
    '',
    'Smart Swaps to detect (bonus praise):',
    '  - made a choice → opted for / selected',
    '  - familiar with → acknowledged / recognized',
    '  - good idea → beneficial decision / advantageous choice',
    '  - frustrated → dissatisfied / displeased',
    '  - long way from → far from',
    '  - large/substantial, many/numerous, advantages/benefits',
    '',
    'List Compression (bonus):',
    '  - 3+ items compressed to category noun (e.g., "shop, listen, communicate" → "communication methods")',
    '',
    '═══════════════════════════════════════════════════════',
    'GRAMMAR (0-2)',
    '═══════════════════════════════════════════════════════',
    '  2 = Good control, correct connector usage, minor spelling OK',
    '      - Semicolon + connector (; however, / ; moreover,) = Band 9 signal',
    '      - Chained connectors (2+) = excellent',
    '  1 = 3+ spelling errors OR missing connector OR 1 serious grammar error',
    '  0 = Errors prevent understanding OR wrong connector logic',
    '',
    'Connector Logic:',
    '  however/yet/although/whereas = CONTRAST only',
    '  moreover/furthermore/additionally = ADDITION only', 
    '  consequently/therefore/thus = CAUSE-EFFECT only',
    '',
    'Return ONLY valid JSON. No markdown.',
  ].join('\n');

  const userPrompt = [
    'PASSAGE:',
    '"' + passageText + '"',
    '',
    'STUDENT RESPONSE:',
    '"' + text + '"',
    '',
    'PRE-CHECK:',
    firstPersonCheck.penalty
      ? 'FIRST-PERSON TRAP: Deduct 1 content point. ' + firstPersonCheck.note
      : 'No first-person trap.',
    '',
    'TASK:',
    '1. List the 3-4 Key Ideas from the passage',
    '2. Check which appear in the student summary',
    '3. Return JSON with exact structure:',
    '',
    '{',
    '  "content": 0-3,',
    '  "key_ideas_extracted": ["idea 1", "idea 2", "idea 3", "idea 4"],',
    '  "key_ideas_present": ["idea 1", "idea 3"],',
    '  "key_ideas_missing": ["idea 2", "idea 4"],',
    '  "content_notes": "Specific: which ideas missing and why",',
    '  "grammar": {',
    '    "score": 0-2,',
    '    "spelling_errors": [{"word": "misspelled", "suggestion": "correct"}],',
    '    "grammar_issues": [{"issue": "description", "suggestion": "fix"}],',
    '    "has_connector": true/false,',
    '    "connector_type": "contrast|addition|reason|none",',
    '    "connector_logic_correct": true/false,',
    '    "chained_connectors": true/false',
    '  },',
    '  "vocabulary": 0-2,',
    '  "synonym_usage": "none|low|optimal",',
    '  "smart_swaps_detected": ["frustrated→dissatisfied"],',
    '  "compression_detected": true/false,',
    '  "compressed_items": ["shop+music+communicate→communication methods"],',
    '  "feedback": "MISSING: [Key Ideas not captured]. PRESENT: [what was captured]. SWAPS: [synonyms found]. FIX: [actionable suggestion]."',
    '}'
  ].join('\n');

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawText = response.content[0].text;
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON found in AI response');

    const result = JSON.parse(match[0]);
    const finalResult = { ...result, mode: 'ai' };
    setCache(cacheKey, finalResult);
    return finalResult;

  } catch (err) {
    console.error('AI Grading Error:', err.message);
    return {
      content: 0,
      key_ideas_extracted: [],
      key_ideas_present: [],
      key_ideas_missing: [],
      content_notes: 'Local fallback — AI unavailable.',
      grammar: {
        score: 1,
        spelling_errors: [],
        grammar_issues: [],
        has_connector: false,
        connector_type: 'none',
        connector_logic_correct: false,
        chained_connectors: false
      },
      vocabulary: 1,
      synonym_usage: 'none',
      smart_swaps_detected: [],
      compression_detected: false,
      compressed_items: [],
      feedback: 'AI grading unavailable. Check ANTHROPIC_API_KEY.',
      mode: 'local'
    };
  }
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '6.0.0-key-ideas',  // Major version bump: Key Idea system
    model: 'claude-3-haiku-20240307',
    anthropicConfigured: !!ANTHROPIC_API_KEY,
    cacheSize: gradeCache.size,
    mode: ANTHROPIC_API_KEY ? 'AI-primary' : 'local-fallback'
  });
});

app.post('/api/grade', async (req, res) => {
  try {
    const { text, type, prompt } = req.body;

    if (!text || !type || !prompt) {
      return res.status(400).json({ error: 'Missing required fields: text, type, prompt' });
    }

    // Sanitize input
    const cleanText = sanitizeInput(text);

    // Step 1: Form gate
    const formCheck = calculateForm(cleanText, type);
    const firstPersonCheck = checkFirstPersonTrap(cleanText, prompt);

    // Early return if form invalid
    if (formCheck.score === 0) {
      return res.json({
        trait_scores: { form: 0, content: 0, grammar: 0, vocabulary: 0 },
        content_details: { 
          key_ideas_extracted: [],
          key_ideas_present: [],
          key_ideas_missing: [],
          notes: 'Form invalid — not graded.' 
        },
        grammar_details: { spelling_errors: [], grammar_issues: [], has_connector: false, connector_type: 'none', connector_logic_correct: false, chained_connectors: false },
        vocabulary_details: { synonym_usage: 'none', smart_swaps_detected: [], compression_detected: false, compressed_items: [] },
        overall_score: 10,
        raw_score: 0,
        band: 'Band 5',
        form_gate_triggered: true,
        form_reason: formCheck.reason,
        word_count: formCheck.wordCount,
        feedback: 'FORM ERROR: ' + formCheck.reason + '. Must be one complete sentence (5-75 words).',
        scoring_mode: 'local'
      });
    }

    // Step 2: AI grading
    const result = await gradeResponse(cleanText, type, prompt);

    // Step 3: Apply first-person penalty
    let contentScore = result.content || 0;
    if (firstPersonCheck.penalty) {
      contentScore = Math.max(0, contentScore - 1);
    }

    const rawScore = formCheck.score +
                     contentScore +
                     (result.grammar?.score || 0) +
                     (result.vocabulary || 0);

    const maxPossible = type === 'write-essay' ? 9 : 8;
    const overallScore = Math.min(90, 10 + Math.round((rawScore / maxPossible) * 80));

    res.json({
      trait_scores: {
        form:       formCheck.score,
        content:    contentScore,
        grammar:    result.grammar?.score,
        vocabulary: result.vocabulary
      },
      content_details: {
        key_ideas_extracted:   result.key_ideas_extracted || [],
        key_ideas_present:     result.key_ideas_present || [],
        key_ideas_missing:     result.key_ideas_missing || [],
        first_person_penalty:  firstPersonCheck.penalty || false,
        notes:                 result.content_notes
      },
      grammar_details: {
        spelling_errors:         result.grammar?.spelling_errors || [],
        grammar_issues:          result.grammar?.grammar_issues || [],
        has_connector:           result.grammar?.has_connector || false,
        connector_type:          result.grammar?.connector_type || 'none',
        connector_logic_correct: result.grammar?.connector_logic_correct || false,
        chained_connectors:      result.grammar?.chained_connectors || false
      },
      vocabulary_details: {
        synonym_usage:        result.synonym_usage,
        smart_swaps_detected: result.smart_swaps_detected || [],
        compression_detected: result.compression_detected || false,
        compressed_items:     result.compressed_items || []
      },
      overall_score: overallScore,
      raw_score:     rawScore,
      band:          BAND_MAP[rawScore] || 'Band 5',
      form_gate_triggered: false,
      word_count:    formCheck.wordCount,
      feedback:      result.feedback,
      scoring_mode:  result.cached ? 'cached' : result.mode
    });

  } catch (error) {
    console.error('Route error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── START ───────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log('✅ PTE Grading API v6.0.0-key-ideas on port ' + PORT);
  if (!ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY not set — running in local fallback mode');
  } else if (!ANTHROPIC_API_KEY.startsWith('sk-ant-')) {
    console.error('❌ ANTHROPIC_API_KEY looks wrong — expected format: sk-ant-...');
  } else {
    console.log('🤖 AI mode active — Key Idea Extraction system');
  }
});
