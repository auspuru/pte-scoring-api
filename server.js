const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// ─── CORS CONFIG ─────────────────────────────────────────────────────────────
// Allow all origins in development (restrict in production)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));

// Initialize Anthropic only if key exists
let anthropic = null;
if (ANTHROPIC_API_KEY && ANTHROPIC_API_KEY.startsWith('sk-ant-')) {
  anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
}

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
  const lastWord = text.trim().split(/\s+/).pop().toLowerCase().replace(/[.!?;,]$/, '');
  const hangingWords = ['for', 'the', 'a', 'an', 'and', 'but', 'or', 'with', 'by', 'to', 'of', 'in', 'on', 'that', 'which', 'who', 'as', 'at'];
  
  if (hangingWords.includes(lastWord)) {
    return { complete: false, reason: `Sentence ends with "${lastWord}" — incomplete` };
  }
  return { complete: true };
}

// ─── FINITE VERB CHECK ───────────────────────────────────────────────────────
function hasFiniteVerb(text) {
  const patterns = [
    /\b(is|are|was|were|be|been|being)\b/i,
    /\b(has|have|had|do|does|did|will|would|could|should|may|might|must)\s+\w+/i,
    /\b(made|took|became|found|gave|told|felt|left|put|meant|kept|began|seemed|helped|showed|wrote|provided|stood|lost|paid|included|continued|changed|led|considered|appeared|served|sent|expected|built|stayed|fell|reached|remained|suggested|raised|passed|required|reported|decided|explains|persuaded|acknowledged|opted|demonstrates|indicates|reveals|discovered|challenges|advises|argues|claims|states|finds|identifies|examines|credit|discusses|transformed|overtook|dominates|generates|acts|possesses|created|allows|improved|expressed|attempts|discussed|explained|highlighted|suggested)\b/i
  ];
  return patterns.some(p => p.test(text));
}

// ─── FORM VALIDATION ─────────────────────────────────────────────────────────
function calculateForm(text, type) {
  const cleanInput = sanitizeInput(text);
  const words = cleanInput.trim().split(/\s+/).filter(w => w.length > 0);
  const wc = words.length;

  if (type === 'summarize-written-text') {
    const cleanText = cleanInput.replace(/(?:Dr|Mr|Mrs|Ms|Prof|U\.K|U\.S|i\.e|e\.g|etc)\./gi, '##');
    const sentenceCount = (cleanText.match(/[.!?](\s|$)/g) || []).length;

    if (wc < 5) return { score: 0, reason: 'Too short (min 5 words)', wordCount: wc };
    if (wc > 75) return { score: 0, reason: 'Too long (max 75 words)', wordCount: wc };
    if (sentenceCount !== 1) return { score: 0, reason: 'Must be exactly one sentence', wordCount: wc };
    
    const completeness = isCompleteSentence(cleanInput);
    if (!completeness.complete) return { score: 0, reason: completeness.reason, wordCount: wc };
    
    if (!hasFiniteVerb(cleanInput)) return { score: 0, reason: 'No finite verb detected', wordCount: wc };
    
    return { score: 1, reason: 'Valid', wordCount: wc };
  }
  
  return { score: 0, reason: 'Invalid type', wordCount: wc };
}

// ─── FIRST PERSON CHECK ──────────────────────────────────────────────────────
function checkFirstPersonTrap(text, passageText) {
  if (!passageText) return { penalty: false };
  const iCount = (passageText.match(/\b(I|my|me|I've|I'd|I'm)\b/g) || []).length;
  const isNarrative = iCount > 2 && !passageText.includes('Dr.') && !/researcher|professor|scientist/i.test(passageText);

  if (isNarrative && /^\s*(I|My|Me)\b/.test(text)) {
    return { penalty: true, note: "Shift 'I/my' to 'The author/narrator'" };
  }
  return { penalty: false };
}

// ─── AI GRADING ENGINE ───────────────────────────────────────────────────────
async function gradeResponse(text, type, passageText) {
  const cacheKey = (text + type + passageText).slice(0, 200);
  const cached = getCached(cacheKey);
  if (cached) return { ...cached, cached: true };

  const firstPersonCheck = checkFirstPersonTrap(text, passageText);

  // If no Anthropic key, return local fallback immediately
  if (!anthropic) {
    return {
      content: 1,
      key_ideas_extracted: ["Local mode - AI unavailable"],
      key_ideas_present: ["Unable to analyze"],
      key_ideas_missing: ["AI not configured"],
      content_notes: 'Running in local fallback mode. Set ANTHROPIC_API_KEY for full grading.',
      grammar: { score: 1, spelling_errors: [], grammar_issues: [], has_connector: false, connector_type: 'none', connector_logic_correct: false, chained_connectors: false },
      vocabulary: 1,
      synonym_usage: 'none',
      smart_swaps_detected: [],
      compression_detected: false,
      compressed_items: [],
      feedback: 'Server running in local mode. AI grading requires ANTHROPIC_API_KEY.',
      mode: 'local'
    };
  }

  const systemPrompt = `You are a PTE Academic examiner. Evaluate strictly on Key Idea Coverage.

CONTENT (0-3 points):
Extract 3 Key Ideas from the passage:
1. Main subject/entity (WHO/WHAT)
2. Core conflict/characteristic/problem  
3. Resolution/outcome/implication

Scoring:
- 3/3 = All 3 Key Ideas present (paraphrased or verbatim OK)
- 2/3 = 2 Key Ideas present
- 1/3 = 1 Key Idea present
- 0/3 = Only "hook" captured OR no substantive content from passage

Rules:
- NOISE IS OK: Extra details don't penalize if Key Ideas present
- MISSING MAIN = DOOM: Missing Key Ideas tanks score even with perfect grammar
- No factual errors (wrong numbers/names = 0 for that idea)

VOCABULARY (0-2):
2 = Appropriate word choice, meaning clear (verbatim nouns OK)
1 = Minor issues
0 = Distorts meaning

GRAMMAR (0-2):
2 = Good control, correct connector (however/moreover/consequently), minor spelling OK
1 = Missing connector OR 3+ spelling errors
0 = Errors prevent understanding

Return ONLY this JSON:
{
  "content": 0-3,
  "key_ideas_extracted": ["idea1", "idea2", "idea3"],
  "key_ideas_present": [],
  "key_ideas_missing": [],
  "content_notes": "explanation",
  "grammar": {"score": 0-2, "has_connector": true/false, "connector_type": "contrast|addition|reason|none", "connector_logic_correct": true/false, "chained_connectors": true/false, "spelling_errors": [], "grammar_issues": []},
  "vocabulary": 0-2,
  "synonym_usage": "none|low|optimal",
  "smart_swaps_detected": [],
  "compression_detected": false,
  "feedback": "MISSING: [ideas]. PRESENT: [ideas]. FIX: [suggestion]."
}`;

  const userPrompt = `PASSAGE: "${passageText}"

STUDENT: "${text}"

${firstPersonCheck.penalty ? 'NOTE: First-person trap detected. Student used I/my in narrative passage.' : ''}

Analyze Key Ideas and return JSON only.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.1 // More consistent
    });

    const rawText = response.content[0].text;
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON found');

    const result = JSON.parse(match[0]);
    const finalResult = { ...result, mode: 'ai' };
    setCache(cacheKey, finalResult);
    return finalResult;

  } catch (err) {
    console.error('AI Error:', err.message);
    // Return fallback so server doesn't crash
    return {
      content: 1,
      key_ideas_extracted: ["Error extracting"],
      key_ideas_present: ["Check manual"],
      key_ideas_missing: ["AI processing failed"],
      content_notes: `AI Error: ${err.message}`,
      grammar: { score: 1, has_connector: false, connector_type: 'none', connector_logic_correct: false, chained_connectors: false, spelling_errors: [], grammar_issues: [] },
      vocabulary: 1,
      synonym_usage: 'none',
      smart_swaps_detected: [],
      compression_detected: false,
      feedback: `Grading error: ${err.message}. Please try again.`,
      mode: 'error'
    };
  }
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: '6.0.1', 
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
    const firstPersonCheck = checkFirstPersonTrap(cleanText, prompt);

    if (formCheck.score === 0) {
      return res.json({
        trait_scores: { form: 0, content: 0, grammar: 0, vocabulary: 0 },
        content_details: { key_ideas_extracted: [], key_ideas_present: [], key_ideas_missing: [], notes: 'Form invalid' },
        grammar_details: { spelling_errors: [], grammar_issues: [], has_connector: false, connector_type: 'none', connector_logic_correct: false, chained_connectors: false },
        vocabulary_details: { synonym_usage: 'none', smart_swaps_detected: [], compression_detected: false, compressed_items: [] },
        overall_score: 10,
        raw_score: 0,
        band: 'Band 5',
        form_gate_triggered: true,
        form_reason: formCheck.reason,
        word_count: formCheck.wordCount,
        feedback: `FORM ERROR: ${formCheck.reason}. Must be one complete sentence (5-75 words).`
      });
    }

    const result = await gradeResponse(cleanText, type, prompt);
    
    let contentScore = result.content || 0;
    if (firstPersonCheck.penalty) contentScore = Math.max(0, contentScore - 1);

    const rawScore = formCheck.score + contentScore + (result.grammar?.score || 0) + (result.vocabulary || 0);
    const maxPossible = 8;
    const overallScore = Math.min(90, 10 + Math.round((rawScore / maxPossible) * 80));

    res.json({
      trait_scores: {
        form: formCheck.score,
        content: contentScore,
        grammar: result.grammar?.score || 0,
        vocabulary: result.vocabulary || 0
      },
      content_details: {
        key_ideas_extracted: result.key_ideas_extracted || [],
        key_ideas_present: result.key_ideas_present || [],
        key_ideas_missing: result.key_ideas_missing || [],
        first_person_penalty: firstPersonCheck.penalty || false,
        notes: result.content_notes
      },
      grammar_details: result.grammar || {},
      vocabulary_details: {
        synonym_usage: result.synonym_usage || 'none',
        smart_swaps_detected: result.smart_swaps_detected || [],
        compression_detected: result.compression_detected || false,
        compressed_items: result.compressed_items || []
      },
      overall_score: overallScore,
      raw_score: rawScore,
      band: BAND_MAP[rawScore] || 'Band 5',
      word_count: formCheck.wordCount,
      feedback: result.feedback || 'No feedback provided',
      mode: result.mode
    });

  } catch (error) {
    console.error('Route error:', error);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server v6.0.1 running on port ${PORT}`);
  console.log(`🤖 AI Mode: ${anthropic ? 'ACTIVE' : 'DISABLED (set ANTHROPIC_API_KEY)'}`);
  console.log(`📝 Test: curl http://localhost:${PORT}/api/health`);
});
