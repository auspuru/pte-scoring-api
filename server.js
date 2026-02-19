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

// ─── RATE LIMITER (in-memory, 10 requests/minute per IP) ─────────────────────
const requestCounts = new Map();

app.use((req, res, next) => {
  if (req.path !== '/api/grade' && req.path !== '/api/grade/swt') return next();

  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowStart = now - 60000;

  // Clean expired entries
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

// ─── CACHE (Redis if available, else in-memory) ──────────────────────────────
let redisClient = null;
let useRedis = false;

if (process.env.REDIS_URL) {
  try {
    const redis = require('redis');
    redisClient = redis.createClient({ url: process.env.REDIS_URL });
    redisClient.connect().catch(console.error);
    useRedis = true;
    console.log('📦 Redis cache enabled');
  } catch (err) {
    console.warn('⚠️  Redis not available, using in-memory cache');
  }
}

const gradeCache = new Map();
const MAX_CACHE = 500;

async function getCached(key) {
  if (useRedis && redisClient) {
    try {
      const val = await redisClient.get(key);
      return val ? JSON.parse(val) : null;
    } catch (e) {
      // Fallback to memory on Redis error
    }
  }
  return gradeCache.get(key) || null;
}

async function setCache(key, value) {
  if (useRedis && redisClient) {
    try {
      await redisClient.setEx(key, 3600, JSON.stringify(value)); // 1 hour TTL
      return;
    } catch (e) {
      // Fallback to memory on Redis error
    }
  }
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

// ─── FINITE VERB VALIDATOR (Prevents noun-list gaming) ───────────────────────
function hasFiniteVerb(text) {
  const patterns = [
    /\b(is|are|was|were|be|been|being)\b/i,
    /\b(has|have|had|do|does|did|will|would|could|should|may|might|must)\s+\w+/i,
    /\b(made|took|became|found|gave|told|felt|left|put|meant|kept|let|began|seemed|helped|showed|heard|played|ran|moved|lived|believed|brought|happened|wrote|provided|sat|stood|lost|paid|met|included|continued|set|learned|changed|led|understood|watched|followed|stopped|created|spoke|read|spent|grew|opened|walked|offered|remembered|loved|considered|appeared|bought|waited|served|died|sent|expected|built|stayed|fell|cut|reached|killed|remained|suggested|talked|raised|passed|sold|required|reported|decided|pulled|explains|persuaded|acknowledged|opted|demonstrates|indicates|reveals|discovered|challenges|advises|suggests|argues|claims|states|notes|finds|shows|identifies|examines|investigates|credit|discusses|transformed|overtook|dominates)\b/i
  ];
  return patterns.some(p => p.test(text));
}

// ─── IMPROVED FIRST-PERSON DETECTION (Narrative vs Quote) ────────────────────
function checkFirstPersonTrap(text, passageText) {
  const iCount = (passageText.match(/\b(I|my|me|I've|I'd|I'm)\b/g) || []).length;
  const isNarrative = iCount > 2 && !passageText.includes('Dr.') && !passageText.includes('researcher');
  
  if (isNarrative && /^\s*(I|My|Me)\b/.test(text)) {
    return {
      penalty: 1,
      note: "First-person narrative detected - shift 'I' to 'The author'",
      suggestion: "Change 'I made' to 'The author made'"
    };
  }
  return { penalty: 0 };
}

// ─── FORM VALIDATION with Verb Check + Grace Zone ────────────────────────────
function calculateForm(text, type) {
  const cleanInput = sanitizeInput(text);
  const wc = cleanInput.trim().split(/\s+/).filter(w => w.length > 0).length;

  if (type === 'summarize-written-text') {
    const cleanText = cleanInput.replace(/(?:Dr|Mr|Mrs|Ms|Prof|U\.K|U\.S|i\.e|e\.g|etc)\./gi, '##');
    const sentenceCount = (cleanText.match(/[.!?](\s|$)/g) || []).length;
    
    if (sentenceCount !== 1) return { score: 0, reason: 'Multiple sentences detected', wordCount: wc };
    if (!hasFiniteVerb(cleanInput)) return { score: 0, reason: 'No finite verb found', wordCount: wc };
    if (wc >= 5 && wc <= 80) return { score: 1, reason: 'Valid', wordCount: wc };
    
    return { score: 0, reason: wc < 5 ? 'Too short' : 'Too long', wordCount: wc };
  }

  if (type === 'write-essay') {
    if (wc >= 200 && wc <= 300) return { score: 2, reason: 'Valid', wordCount: wc };
    if ((wc >= 120 && wc < 200) || (wc > 300 && wc <= 380)) return { score: 1, reason: 'Partial', wordCount: wc };
    return { score: 0, reason: wc < 120 ? 'Too short' : 'Too long', wordCount: wc };
  }

  return { score: 0, reason: 'Invalid type', wordCount: wc };
}

// ─── AI GRADING ENGINE ───────────────────────────────────────────────────────
async function gradeResponse(text, type, passageText) {
  const cacheKey = (text + type + passageText).slice(0, 200);
  const cached = await getCached(cacheKey);
  if (cached) {
    console.log('Cache hit');
    return { ...cached, cached: true };
  }

  const firstPersonCheck = checkFirstPersonTrap(text, passageText);

  const systemPrompt = [
    'You are a PTE SWT examiner. Evaluate ONLY against the passage provided.',
    '',
    '═══════════════════════════════════════════════════════',
    'THE SWT TRINITY (Content 0-3)',
    '═══════════════════════════════════════════════════════',
    'Award 1 point ONLY for these specific elements:',
    '• TOPIC (1pt): Main subject introduced in first 1-2 sentences',
    '• PIVOT (1pt): The contrast/turning point (markers: But, However, Yet, Although)',
    '• CONCLUSION (1pt): Final implication/resolution (last 1-2 sentences)',
    '',
    'CRITICAL RULES:',
    '• If passage has "But/However" and student misses it → pivot_captured: false',
    '• Verbatim nouns are REQUIRED (keep "founder-members", "IPCC", names exact)',
    '• First-person already checked; deduct content if penalty flagged',
    '',
    '═══════════════════════════════════════════════════════',
    'VOCABULARY (0-2) — HOLISTIC RANGE',
    '═══════════════════════════════════════════════════════',
    '2 = Appropriate word choice PLUS evidence of range:',
    '    • Nominalization: "the study found" → "findings indicate"',
    '    • List compression: "shop, music, talk" → "communication methods"',
    '    • Academic synonyms: "big"→"substantial", "said"→"argued"',
    '1 = Appropriate but basic (verbatim copying of descriptive words)',
    '0 = Wrong word choice distorts meaning',
    '',
    '═══════════════════════════════════════════════════════',
    'GRAMMAR (0-2)',
    '═══════════════════════════════════════════════════════',
    '2 = Correct connector logic (however=contrast, moreover=addition)',
    '    1-2 spelling errors acceptable if meaning clear',
    '1 = Missing connector OR 3+ spelling errors',
    '0 = Wrong connector logic OR incomprehensible',
    '',
    'Return ONLY valid JSON with no markdown.'
  ].join('\n');

  const userPrompt = [
    'PASSAGE:',
    '"' + passageText + '"',
    '',
    'STUDENT RESPONSE:',
    '"' + text + '"',
    '',
    'FIRST-PERSON PENALTY:',
    firstPersonCheck.penalty ? 'YES - deduct 1 content point' : 'None',
    '',
    'Return EXACT JSON:',
    '{',
    '  "content": 0-3,',
    '  "topic_captured": true/false,',
    '  "pivot_captured": true/false,',
    '  "conclusion_captured": true/false,',
    '  "content_notes": "Specifically: which Trinity element was missed and why",',
    '  "grammar": { "score": 0-2, "has_connector": true/false, "connector_type": "contrast|addition|reason|none" },',
    '  "vocabulary": 0-2,',
    '  "smart_swaps_detected": ["original->synonym"],',
    '  "compression_detected": true/false,',
    '  "feedback": "MISSING: [specific element]. PRESENT: [what worked]. SWAPS: [X found]. FIX: [one actionable tip]."',
    '}'
  ].join('\n');

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawText = response.content[0].text;
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON found in AI response');

    const result = JSON.parse(match[0]);
    const finalResult = { ...result, form: calculateForm(text, type), mode: 'ai' };

    await setCache(cacheKey, finalResult);
    return finalResult;

  } catch (err) {
    console.error('AI Grading Error:', err.message);
    return {
      content: 0,
      topic_captured: false,
      pivot_captured: false,
      conclusion_captured: false,
      content_notes: 'Local fallback — AI unavailable.',
      grammar: { score: 1, has_connector: false, connector_type: 'none' },
      vocabulary: 1,
      smart_swaps_detected: [],
      compression_detected: false,
      feedback: 'AI grading unavailable. Please ensure ANTHROPIC_API_KEY is set correctly.',
      form: calculateForm(text, type),
      mode: 'local'
    };
  }
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '6.0.0',
    model: 'claude-3-5-sonnet-20241022',
    anthropicConfigured: !!ANTHROPIC_API_KEY,
    cacheMode: useRedis ? 'redis' : 'memory',
    cacheSize: useRedis ? 'N/A' : gradeCache.size,
    mode: ANTHROPIC_API_KEY ? 'AI-primary' : 'local-fallback'
  });
});

// Production-grade SWT endpoint with Form Gate
app.post('/api/grade/swt', async (req, res) => {
  try {
    const { text, prompt: passageText } = req.body;

    if (!text || !passageText) {
      return res.status(400).json({ error: 'Missing text or passage' });
    }

    // Step 1: Hard validation
    const formCheck = calculateForm(text, 'summarize-written-text');
    const firstPersonCheck = checkFirstPersonTrap(text, passageText);
    
    // FORM GATE: If form invalid, return Band 5 immediately (save API cost)
    if (formCheck.score === 0) {
      return res.json({
        trait_scores: { form: 0, content: 0, grammar: 0, vocabulary: 0 },
        overall_score: 10,
        band: 'Band 5',
        form_gate_triggered: true,
        form_reason: formCheck.reason,
        word_count: formCheck.wordCount,
        feedback: `FORM ERROR: ${formCheck.reason}. Your summary must be exactly one sentence (5-75 words) with a subject and verb.`
      });
    }

    // Step 2: AI Grading (only if form passed)
    const result = await gradeResponse(text, 'summarize-written-text', passageText);
    
    // Step 3: Calculate scores
    let contentScore = result.content || 0;
    if (firstPersonCheck.penalty) contentScore = Math.max(0, contentScore - 1);
    
    const rawScore = formCheck.score + contentScore + (result.grammar?.score || 0) + (result.vocabulary || 0);
    const maxPossible = 8;
    const overallScore = Math.min(90, 10 + Math.round((rawScore / maxPossible) * 80));
    
    const band = rawScore >= 8 ? 'Band 9' : 
                 rawScore >= 7 ? 'Band 8' :
                 rawScore >= 6 ? 'Band 7' :
                 rawScore >= 5 ? 'Band 6' : 'Band 5';

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
        has_connector: result.grammar?.has_connector || false,
        connector_type: result.grammar?.connector_type || 'none'
      },
      vocabulary_details: {
        swap_count: result.smart_swaps_detected?.length || 0,
        detected_swaps: result.smart_swaps_detected || [],
        compression_detected: result.compression_detected || false
      },
      overall_score: overallScore,
      raw_score: rawScore,
      band: band,
      form_gate_triggered: false,
      form_reason: formCheck.reason,
      feedback: result.feedback,
      word_count: formCheck.wordCount,
      scoring_mode: result.cached ? 'cached' : result.mode
    });

  } catch (error) {
    console.error('Route error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Legacy/general grading endpoint (backward compatible)
app.post('/api/grade', async (req, res) => {
  try {
    const { text, type, prompt } = req.body;

    if (!text || !type || !prompt) {
      return res.status(400).json({ error: 'Missing required fields: text, type, prompt' });
    }

    const formCheck = calculateForm(text, type);
    
    // Form gate for SWT via legacy endpoint too
    if (type === 'summarize-written-text' && formCheck.score === 0) {
      return res.json({
        trait_scores: { form: 0, content: 0, grammar: 0, vocabulary: 0 },
        overall_score: 10,
        band: 'Band 5',
        form_gate_triggered: true,
        form_reason: formCheck.reason,
        word_count: formCheck.wordCount,
        feedback: `FORM ERROR: ${formCheck.reason}. Your summary must be exactly one sentence (5-75 words) with a subject and verb.`
      });
    }

    const result = await gradeResponse(text, type, prompt);
    
    // Handle both old and new form structures
    const formScore = typeof result.form === 'object' ? result.form.score : (result.form || 0);
    const rawScore = formScore + (result.content || 0) + (result.grammar?.score || 0) + (result.vocabulary || 0);
    const maxPossible = type === 'write-essay' ? 9 : 8;
    const overallScore = Math.min(90, 10 + Math.round((rawScore / maxPossible) * 80));

    res.json({
      trait_scores: {
        form: formScore,
        content: result.content,
        grammar: result.grammar?.score,
        vocabulary: result.vocabulary
      },
      content_details: {
        topic_captured: result.topic_captured,
        pivot_captured: result.pivot_captured,
        conclusion_captured: result.conclusion_captured,
        notes: result.content_notes
      },
      grammar_details: result.grammar,
      vocabulary_details: {
        synonym_usage: result.synonym_usage,
        smart_swaps_detected: result.smart_swaps_detected || [],
        compression_detected: result.compression_detected || false,
        compressed_items: result.compressed_items || []
      },
      overall_score: overallScore,
      raw_score: rawScore,
      band: BAND_MAP[rawScore] || 'Band 5',
      feedback: result.feedback,
      scoring_mode: result.cached ? 'cached' : result.mode,
      word_count: typeof result.form === 'object' ? result.form.wordCount : undefined
    });

  } catch (error) {
    console.error('Route error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── START ───────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log('✅ PTE Grading API v6.0.0 on port ' + PORT);
  if (!ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY not set — running in local fallback mode');
  } else if (!ANTHROPIC_API_KEY.startsWith('sk-ant-')) {
    console.error('❌ ANTHROPIC_API_KEY looks wrong — expected format: sk-ant-...');
  } else {
    console.log('🤖 AI mode active — model: claude-3-5-sonnet-20241022');
  }
});
