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
    .filter(([key, time]) => key.startsWith(ip) && time > windowStart)
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

// ─── TYPE SAFE HELPERS ───────────────────────────────────────────────────────
function toString(val) {
  if (val === null || val === undefined) return '';
  return String(val);
}

// ─── INPUT SANITIZATION ──────────────────────────────────────────────────────
function sanitizeInput(text) {
  const str = toString(text);
  return str
    .replace(/ignore previous instructions/gi, '')
    .replace(/system prompt/gi, '')
    .replace(/you are now/gi, '')
    .replace(/give me 90/gi, '')
    .slice(0, 2000);
}

// ─── FINITE VERB VALIDATOR ───────────────────────────────────────────────────
function hasFiniteVerb(text) {
  const str = toString(text);
  const patterns = [
    /\b(is|are|was|were|be|been|being)\b/i,
    /\b(has|have|had|do|does|did|will|would|could|should|may|might|must)\s+\w+/i,
    /\b(made|took|became|found|gave|told|felt|left|put|meant|kept|began|seemed|helped|showed|wrote|provided|stood|lost|paid|included|continued|changed|led|considered|appeared|served|sent|expected|built|stayed|fell|reached|remained|suggested|raised|passed|required|reported|decided|explains|persuaded|acknowledged|opted|demonstrates|indicates|reveals|discovered|challenges|advises|argues|claims|states|finds|identifies|examines|credit|discusses|transformed|overtook|dominates)\b/i
  ];
  return patterns.some(p => p.test(str));
}

// ─── FORM VALIDATION ─────────────────────────────────────────────────────────
function calculateForm(text, type) {
  const cleanInput = sanitizeInput(text);
  const wc = cleanInput.trim().split(/\s+/).filter(w => w.length > 0).length;

  if (type === 'summarize-written-text') {
    const cleanText = cleanInput.replace(/(?:Dr|Mr|Mrs|Ms|Prof|U\.K|U\.S|i\.e|e\.g|etc)\./gi, '##');
    const sentenceCount = (cleanText.match(/[.!?](\s|$)/g) || []).length;

    if (sentenceCount !== 1) return { score: 0, reason: 'Multiple sentences detected', wordCount: wc };
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

// ─── FIRST-PERSON DETECTION ──────────────────────────────────────────────────
function checkFirstPersonTrap(text, passageText) {
  const pText = toString(passageText);
  const sText = toString(text);
  
  const iCount = (pText.match(/\b(I|my|me|I've|I'd|I'm)\b/g) || []).length;
  const isNarrative = iCount > 2 && !pText.includes('Dr.') && !/researcher|professor|scientist/i.test(pText);

  if (isNarrative && /^\s*(I|My|Me)\b/.test(sText)) {
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
  const strText = toString(text);
  const strType = toString(type);
  const strPassage = toString(passageText);
  
  const cacheKey = (strText + strType + strPassage).slice(0, 200);
  const cached = getCached(cacheKey);
  if (cached) {
    console.log('Cache hit');
    return { ...cached, cached: true };
  }

  const firstPersonCheck = checkFirstPersonTrap(strText, strPassage);

  const systemPrompt = [
    'You are an elite PTE Academic Examiner. Evaluate ONLY against the passage provided.',
    '',
    'CONTENT — THE SWT TRINITY (0-3):',
    'Award 1 point each for:',
    '  TOPIC (1pt) — Main subject in first 1-2 sentences',
    '  PIVOT (1pt) — Contrast/turning point (But, However, Yet, Although)',
    '  CONCLUSION (1pt) — Final implication/resolution (last 1-2 sentences)',
    '',
    'RULES:',
    '  • Verbatim nouns are REQUIRED (keep "founder-members", "IPCC", names exact)',
    '  • Missing Pivot when passage has one = max 2/3',
    '  • Wrong numbers/names = 0 for that element',
    '  • First-person penalty already applied in pre-check',
    '',
    'VOCABULARY (0-2):',
    '  2 = Appropriate word choice, meaning clear (verbatim nouns OK)',
    '  1 = Minor word choice issues',
    '  0 = Meaning distorted',
    '',
    'GRAMMAR (0-2):',
    '  2 = Good control, correct connector logic (however=contrast, moreover=addition)',
    '  1 = Missing connector or 3+ spelling errors',
    '  0 = Wrong logic or incomprehensible',
    '',
    'Return ONLY valid JSON. No markdown.'
  ].join('\n');

  const userPrompt = [
    'PASSAGE:',
    '"' + strPassage + '"',
    '',
    'STUDENT RESPONSE:',
    '"' + strText + '"',
    '',
    'FIRST-PERSON PENALTY:',
    firstPersonCheck.penalty ? 'YES - deduct 1 content point' : 'None',
    '',
    'Return JSON:',
    '{',
    '  "content": 0-3,',
    '  "topic_captured": true/false,',
    '  "pivot_captured": true/false,',
    '  "conclusion_captured": true/false,',
    '  "content_notes": "Specific: which Trinity element was missed and why",',
    '  "grammar": { "score": 0-2, "has_connector": true/false, "connector_type": "contrast|addition|reason|none" },',
    '  "vocabulary": 0-2,',
    '  "smart_swaps_detected": ["original->synonym"],',
    '  "compression_detected": true/false,',
    '  "feedback": "MISSING: [element]. PRESENT: [what worked]. SWAPS: [X found]. FIX: [actionable tip]."',
    '}'
  ].join('\n');

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
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
      topic_captured: false,
      pivot_captured: false,
      conclusion_captured: false,
      content_notes: 'AI unavailable',
      grammar: { score: 1, has_connector: false, connector_type: 'none' },
      vocabulary: 1,
      smart_swaps_detected: [],
      compression_detected: false,
      feedback: 'AI grading unavailable. Using local fallback.',
      mode: 'local'
    };
  }
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '5.4.0',
    model: 'claude-3-5-sonnet-20241022',
    anthropicConfigured: !!ANTHROPIC_API_KEY,
    cacheSize: gradeCache.size
  });
});

app.post('/api/grade', async (req, res) => {
  try {
    // CRITICAL FIX: Force all inputs to strings immediately
    let text = toString(req.body.text);
    let type = toString(req.body.type);
    let prompt = toString(req.body.prompt);

    if (!text.trim() || !type.trim() || !prompt.trim()) {
      return res.status(400).json({ error: 'Missing required fields: text, type, prompt' });
    }

    // Step 1: Form validation
    const formCheck = calculateForm(text, type);
    const firstPersonCheck = checkFirstPersonTrap(text, prompt);

    // Step 2: Form gate - early return if invalid
    if (formCheck.score === 0) {
      return res.json({
        trait_scores: { form: 0, content: 0, grammar: 0, vocabulary: 0 },
        content_details: { 
          topic_captured: false, 
          pivot_captured: false, 
          conclusion_captured: false, 
          first_person_penalty: false,
          notes: 'Form invalid — not graded.' 
        },
        grammar_details: { 
          spelling_errors: [], 
          grammar_issues: [], 
          has_connector: false, 
          connector_type: 'none', 
          connector_logic_correct: false, 
          chained_connectors: false 
        },
        vocabulary_details: { 
          synonym_usage: 'none', 
          smart_swaps_detected: [], 
          compression_detected: false, 
          compressed_items: [] 
        },
        overall_score: 10,
        raw_score: 0,
        band: 'Band 5',
        form_gate_triggered: true,
        form_reason: formCheck.reason,
        word_count: formCheck.wordCount,
        feedback: 'FORM ERROR: ' + formCheck.reason + '. Your response must be exactly one complete sentence (5-75 words) with a subject and verb.',
        scoring_mode: 'local'
      });
    }

    // Step 3: AI grading
    const result = await gradeResponse(text, type, prompt);

    // Step 4: Apply penalties
    let contentScore = result.content || 0;
    if (firstPersonCheck.penalty) {
      contentScore = Math.max(0, contentScore - 1);
    }

    const rawScore = formCheck.score + contentScore + (result.grammar?.score || 0) + (result.vocabulary || 0);
    const maxPossible = type === 'write-essay' ? 9 : 8;
    const overallScore = Math.min(90, 10 + Math.round((rawScore / maxPossible) * 80));

    res.json({
      trait_scores: {
        form: formCheck.score,
        content: contentScore,
        grammar: result.grammar?.score,
        vocabulary: result.vocabulary
      },
      content_details: {
        topic_captured: result.topic_captured,
        pivot_captured: result.pivot_captured,
        conclusion_captured: result.conclusion_captured,
        first_person_penalty: firstPersonCheck.penalty || false,
        notes: result.content_notes
      },
      grammar_details: {
        spelling_errors: result.grammar?.spelling_errors || [],
        grammar_issues: result.grammar?.grammar_issues || [],
        has_connector: result.grammar?.has_connector || false,
        connector_type: result.grammar?.connector_type || 'none',
        connector_logic_correct: result.grammar?.connector_logic_correct || false,
        chained_connectors: result.grammar?.chained_connectors || false
      },
      vocabulary_details: {
        synonym_usage: result.synonym_usage || 'none',
        smart_swaps_detected: result.smart_swaps_detected || [],
        compression_detected: result.compression_detected || false,
        compressed_items: result.compressed_items || []
      },
      overall_score: overallScore,
      raw_score: rawScore,
      band: BAND_MAP[rawScore] || 'Band 5',
      form_gate_triggered: false,
      form_reason: formCheck.reason,
      word_count: formCheck.wordCount,
      feedback: result.feedback,
      scoring_mode: result.cached ? 'cached' : result.mode
    });

  } catch (error) {
    console.error('Route error:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
});

// ─── START ───────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log('✅ PTE Grading API v5.4.0 on port ' + PORT);
  if (!ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY not set — running in local fallback mode');
  } else if (!ANTHROPIC_API_KEY.startsWith('sk-ant-')) {
    console.error('❌ ANTHROPIC_API_KEY looks wrong — expected format: sk-ant-...');
  } else {
    console.log('🤖 AI mode active');
  }
});
