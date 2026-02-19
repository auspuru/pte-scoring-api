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

// ─── FINITE VERB VALIDATOR (Prevents noun-list gaming) ───────────────────────
function hasFiniteVerb(text) {
  const patterns = [
    /\b(is|are|was|were|be|been|being)\b/i,
    /\b(has|have|had|do|does|did|will|would|could|should|may|might|must)\s+\w+/i,
    /\b(made|took|became|found|gave|told|felt|left|put|meant|kept|began|seemed|helped|showed|wrote|provided|stood|lost|paid|included|continued|changed|led|considered|appeared|served|sent|expected|built|stayed|fell|reached|remained|suggested|raised|passed|required|reported|decided|explains|persuaded|acknowledged|opted|demonstrates|indicates|reveals|discovered|challenges|advises|argues|claims|states|finds|identifies|examines|credit|discusses|transformed|overtook|dominates)\b/i
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
    'You are an elite PTE Academic Examiner. Evaluate ONLY against the passage provided.',
    '',
    '═══════════════════════════════════════════════════════',
    'CONTENT — THE SWT TRINITY (0-3)',
    '═══════════════════════════════════════════════════════',
    'Award 1 point each for correctly capturing:',
    '  TOPIC (1pt)      — Main subject introduced in first 1-2 sentences of passage.',
    '  PIVOT (1pt)      — The contrast or turning point (markers: But, However, Yet, Although).',
    '  CONCLUSION (1pt) — Final implication or resolution (last 1-2 sentences).',
    '',
    'CONTENT RULES:',
    '  VERBATIM OK:      Copying nouns and technical terms directly is ACCEPTABLE — full marks.',
    '  MEANING ERROR:    Swapping meaning (advantage->disadvantage) = 0 for that element.',
    '  FACTUAL ERROR:    Wrong numbers or names = 0 for that element.',
    '    Example: passage says "3.4 times" — student writes "34 times" = FACTUAL ERROR = 0.',
    '  VERBATIM MISTAKE: Miscopying passage words (found-members vs founder-members) = -1 content.',
    '  MISSING PIVOT:    If passage has But/However and student ignores it entirely = max 2/3.',
    '  FIRST-PERSON:     Already pre-checked — see user message for penalty status.',
    '',
    '═══════════════════════════════════════════════════════',
    'VOCABULARY (0-2) — APPROPRIATENESS IS PRIMARY',
    '═══════════════════════════════════════════════════════',
    'CRITICAL: Band 9 responses can score 2/2 with minimal synonym swaps.',
    'Proof: "became the founder-members...; however, progress was not smooth;',
    '  moreover, the UK\'s financial hub has overtaken rivals..." = 2/2 vocabulary.',
    '',
    '  2 = Word choice is appropriate and meaning is clear.',
    '      Verbatim copying of nouns/terms is fine for 2/2.',
    '      Smart swaps are a BONUS — detect and praise but do not require for 2.',
    '  1 = Minor word choice issues that slightly affect clarity.',
    '  0 = Word choice so poor that meaning is distorted or lost.',
    '',
    'SMART SWAP DETECTION (bonus only — does not change score directly):',
    '  frustrated->dissatisfied, large->substantial, made a choice->opted for,',
    '  advantages->benefits, familiar with->acknowledged, long way from->far from,',
    '  good idea->beneficial decision, list compressed to category noun.',
    '  → synonym_usage: "optimal" if 2+ swaps, "low" if 1, "none" if none.',
    '',
    'LIST COMPRESSION (Band 9 bonus):',
    '  If student compressed 3+ passage items into a single category noun = compression_detected: true.',
    '  Example: "shop, listen to music and communicate" → "communication methods".',
    '  Praise in feedback.',
    '',
    '═══════════════════════════════════════════════════════',
    'GRAMMAR (0-2) — Relaxed for minor spelling',
    '═══════════════════════════════════════════════════════',
    '  2 = Good overall control. 1-2 minor spelling errors ACCEPTABLE if meaning is clear.',
    '      Correct connector with semicolon ("; however," / "; moreover,") = 2.',
    '      Chaining 2+ connectors correctly = Band 9 signal — reward in feedback.',
    '  1 = 3+ spelling errors OR missing connector OR 1 serious grammar error.',
    '  0 = Errors that prevent understanding OR connector used with wrong logic.',
    '',
    'CONNECTOR LOGIC — wrong type = Grammar deduction:',
    '  "however / yet / although / whereas"    → CONTRAST only.',
    '  "moreover / furthermore / additionally"  → ADDITION only.',
    '  "consequently / therefore / thus"        → CAUSE-EFFECT only.',
    '',
    'Return ONLY valid JSON. No markdown. No text outside the JSON object.',
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
      ? 'FIRST-PERSON TRAP DETECTED — deduct 1 content point. ' + firstPersonCheck.note
      : 'No first-person trap.',
    '',
    'Return this exact JSON:',
    '{',
    '  "content": 0,',
    '  "topic_captured": false,',
    '  "pivot_captured": false,',
    '  "conclusion_captured": false,',
    '  "content_notes": "Specific: which Trinity element was missed and exactly why.",',
    '  "grammar": {',
    '    "score": 0,',
    '    "spelling_errors": [{ "word": "misspelled", "suggestion": "correct" }],',
    '    "grammar_issues": [{ "issue": "describe problem", "suggestion": "fix", "rule": "rule name" }],',
    '    "has_connector": false,',
    '    "connector_type": "contrast|addition|reason|none",',
    '    "connector_logic_correct": true,',
    '    "chained_connectors": false',
    '  },',
    '  "vocabulary": 0,',
    '  "synonym_usage": "none|low|optimal",',
    '  "smart_swaps_detected": ["e.g. frustrated->dissatisfied"],',
    '  "compression_detected": false,',
    '  "compressed_items": ["e.g. shop+music+communicate -> communication methods"],',
    '  "feedback": "MISSING: [Topic/Pivot/Conclusion - exactly what was expected]. PRESENT: [what was captured well]. SWAPS: [list swaps found or none]. FIX: [one specific actionable suggestion]."',
    '}',
  ].join('\n');

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-latest',  // ← Updated to latest alias
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
      topic_captured: false,
      pivot_captured: false,
      conclusion_captured: false,
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
      feedback: 'AI grading unavailable. Please ensure ANTHROPIC_API_KEY is set correctly.',
      mode: 'local'
    };
  }
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '5.3.1',
    model: 'claude-3-5-sonnet-latest',  // ← Updated here too
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

    const cleanText = sanitizeInput(text);
    const formCheck = calculateForm(cleanText, type);
    const firstPersonCheck = checkFirstPersonTrap(cleanText, prompt);

    if (formCheck.score === 0) {
      return res.json({
        trait_scores: { form: 0, content: 0, grammar: 0, vocabulary: 0 },
        content_details: { topic_captured: false, pivot_captured: false, conclusion_captured: false, notes: 'Form invalid — not graded.' },
        grammar_details: { spelling_errors: [], grammar_issues: [], has_connector: false, connector_type: 'none', connector_logic_correct: false, chained_connectors: false },
        vocabulary_details: { synonym_usage: 'none', smart_swaps_detected: [], compression_detected: false, compressed_items: [] },
        overall_score: 10,
        raw_score: 0,
        band: 'Band 5',
        form_gate_triggered: true,
        form_reason: formCheck.reason,
        word_count: formCheck.wordCount,
        feedback: 'FORM ERROR: ' + formCheck.reason + '. Your response must be exactly one complete sentence (5-75 words) containing a subject and verb.',
        scoring_mode: 'local'
      });
    }

    const result = await gradeResponse(cleanText, type, prompt);

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
        topic_captured:       result.topic_captured,
        pivot_captured:       result.pivot_captured,
        conclusion_captured:  result.conclusion_captured,
        first_person_penalty: firstPersonCheck.penalty || false,
        notes:                result.content_notes
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

app.listen(PORT, '0.0.0.0', () => {
  console.log('✅ PTE Grading API v5.3.1 on port ' + PORT);
  if (!ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY not set — running in local fallback mode');
  } else if (!ANTHROPIC_API_KEY.startsWith('sk-ant-')) {
    console.error('❌ ANTHROPIC_API_KEY looks wrong — expected format: sk-ant-...');
  } else {
    console.log('🤖 AI mode active — model: claude-3-5-sonnet-latest');
  }
});
