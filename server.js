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

// ─── FINITE VERB CHECK (FIXED) ───────────────────────────────────────────────
function hasFiniteVerb(text) {
  if (!text) return false;
  
  const lowerText = text.toLowerCase();
  
  // Pattern 1: Being verbs + complement
  const beingPattern = /\b(is|are|was|were|be|been|being)\s+\w+/i;
  
  // Pattern 2: Helping verbs + main verb
  const helpingPattern = /\b(has|have|had|do|does|did|will|would|could|should|may|might|must|shall|can)\s+\w+/i;
  
  // Pattern 3: Past tense verbs (comprehensive list)
  const pastVerbs = /\b(made|took|became|found|gave|told|felt|left|put|meant|kept|began|seemed|helped|showed|wrote|provided|stood|lost|paid|included|continued|changed|led|considered|appeared|served|sent|expected|built|stayed|fell|reached|remained|suggested|raised|passed|required|reported|decided|explained|emphasized|warned|revealed|acknowledged|demonstrated|indicated|suggested|argued|claimed|stated|identified|examined|credited|discussed|transformed|overtook|dominated|generated|acted|possessed|opted|created|allowed|improved|expressed|attempted|highlighted|resulted|ensured|remained|faced|bore|surged|dropped|required|offered|hoped|concluded|predicted|reduced|impacted|caused|affected|threatened|increased|decreased|showed|found|thought|believed|said|noted|mentioned|added|continued|started|wanted|needed|looked|worked|lived|called|tried|asked|moved|played|believed|brought|happened|stood|understood|wrote|spoke|spent|grew|opened|walked|watched|heard|let|began|knew|ate|ran|went|came|did|saw|got|had|did)\b/i;
  
  // Pattern 4: Present tense verbs (3rd person singular) - THE CRITICAL FIX
  const presentVerbs = /\b(threatens|affects|reduces|impacts|causes|creates|demonstrates|indicates|reveals|shows|explains|emphasizes|warns|claims|states|suggests|argues|acknowledges|discusses|provides|includes|requires|offers|makes|takes|becomes|finds|gives|tells|feels|leaves|puts|means|keeps|begins|seems|helps|writes|stands|loses|pays|continues|changes|leads|considers|appears|serves|sends|expects|builds|stays|falls|reaches|remains|raises|passes|reports|decides|acts|possesses|opts|demonstrates|indicates|reveals|discovers|challenges|advises|argues|claims|states|finds|identifies|examines|credits|discusses|transforms|overtakes|dominates|generates|acknowledges|opts|significantly impacts|creates|allows|improves|minimizes|expressed|attempts|discussed|explained|highlighted|suggested|results|ensures|remains|faces|bears|surges|drops|requires|offers|hopes|warns|emphasizes|reveals|concludes|predicts|indicates|saves|rewards|replaces|exchanges|persuades|develops|becomes|stays|runs|comes|goes|does|has|says|gets|makes|takes|sees|knows|thinks|looks|wants|needs|likes|uses|finds|gives|tells|asks|works|feels|tries|leaves|calls|keeps|brings|begins|helps|shows|hears|plays|runs|moves|lives|believes|brings|happens|stands|understands|writes|speaks|spends|grows|opens|walks|watches)\b/i;
  
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

// ─── FORM VALIDATION ─────────────────────────────────────────────────────────
function calculateForm(text, type) {
  const cleanInput = sanitizeInput(text);
  const words = cleanInput.trim().split(/\s+/).filter(w => w.length > 0);
  const wc = words.length;

  if (type === 'summarize-written-text') {
    // Word count check first
    if (wc < 5) return { score: 0, reason: 'Too short (minimum 5 words)', wordCount: wc };
    if (wc > 75) return { score: 0, reason: 'Too long (maximum 75 words)', wordCount: wc };
    
    // Sentence count check
    const cleanText = cleanInput.replace(/(?:Dr|Mr|Mrs|Ms|Prof|U\.K|U\.S|i\.e|e\.g|etc)\./gi, '##');
    const sentenceCount = (cleanText.match(/[.!?](\s|$)/g) || []).length;
    
    if (sentenceCount !== 1) return { score: 0, reason: 'Must be exactly one sentence', wordCount: wc };
    
    // Completeness check
    const completeness = isCompleteSentence(cleanInput);
    if (!completeness.complete) return { score: 0, reason: completeness.reason, wordCount: wc };
    
    // Finite verb check (THE FIX)
    if (!hasFiniteVerb(cleanInput)) {
      return { score: 0, reason: 'No finite verb detected - add a main verb like "threatens", "affects", "reduces"', wordCount: wc };
    }
    
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
    return { penalty: true, note: "First-person trap: Use 'The author' instead of 'I'" };
  }
  return { penalty: false };
}

// ─── AI GRADING ENGINE ───────────────────────────────────────────────────────
async function gradeResponse(text, type, passageText) {
  const cacheKey = (text + type + passageText).slice(0, 200);
  const cached = getCached(cacheKey);
  if (cached) return { ...cached, cached: true };

  const firstPersonCheck = checkFirstPersonTrap(text, passageText);

  if (!anthropic) {
    return {
      content: 1,
      key_ideas_extracted: ["AI unavailable"],
      key_ideas_present: ["Local mode"],
      key_ideas_missing: ["Connect AI for full grading"],
      content_notes: 'Local fallback mode.',
      grammar: { score: 1, spelling_errors: [], grammar_issues: [], has_connector: false, connector_type: 'none', connector_logic_correct: false, chained_connectors: false },
      vocabulary: 1,
      synonym_usage: 'none',
      smart_swaps_detected: [],
      compression_detected: false,
      compressed_items: [],
      feedback: 'Running in local mode. Set ANTHROPIC_API_KEY for AI grading.',
      mode: 'local'
    };
  }

  const systemPrompt = `You are a PTE Academic examiner. Score based on Key Idea Coverage.

CONTENT (0-3 points):
Extract 3 Key Ideas from the passage:
1. Main subject/action (WHO/WHAT)
2. Core conflict/problem/characteristic  
3. Resolution/outcome/implication

Scoring:
- 3/3 = All 3 Key Ideas present (paraphrased or verbatim OK)
- 2/3 = 2 Key Ideas present
- 1/3 = 1 Key Idea present
- 0/3 = Only hook captured OR no substance

Rules:
- NOISE IS OK: Extra details don't penalize if Key Ideas present
- MISSING MAIN = DOOM: Missing Key Ideas tanks score even with perfect grammar
- No factual errors (wrong numbers/names = 0 for that idea)

VOCABULARY (0-2):
2 = Appropriate word choice, meaning clear (verbatim OK)
1 = Minor issues
0 = Distorts meaning

GRAMMAR (0-2):
2 = Good control, correct connector (however/moreover/consequently)
1 = Missing connector OR 3+ spelling errors
0 = Errors prevent understanding

Return ONLY JSON:
{"content":0-3,"key_ideas_extracted":[],"key_ideas_present":[],"key_ideas_missing":[],"content_notes":"","grammar":{"score":0-2,"has_connector":false,"connector_type":"none","connector_logic_correct":false,"chained_connectors":false,"spelling_errors":[],"grammar_issues":[]},"vocabulary":0-2,"synonym_usage":"none","smart_swaps_detected":[],"compression_detected":false,"feedback":""}`;

  const userPrompt = `PASSAGE: "${passageText}"

STUDENT: "${text}"

${firstPersonCheck.penalty ? 'NOTE: First-person penalty applies.' : ''}

Return JSON only.`;

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
      grammar: { score: 1, has_connector: false, connector_type: 'none', connector_logic_correct: false, chained_connectors: false, spelling_errors: [], grammar_issues: [] },
      vocabulary: 1,
      synonym_usage: 'none',
      smart_swaps_detected: [],
      compression_detected: false,
      feedback: `Error: ${err.message}. Please try again.`,
      mode: 'error'
    };
  }
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: '6.1.0', 
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
        content_details: { 
          key_ideas_extracted: [], 
          key_ideas_present: [], 
          key_ideas_missing: [], 
          notes: 'Form invalid - ' + formCheck.reason 
        },
        grammar_details: { spelling_errors: [], grammar_issues: [], has_connector: false, connector_type: 'none', connector_logic_correct: false, chained_connectors: false },
        vocabulary_details: { synonym_usage: 'none', smart_swaps_detected: [], compression_detected: false, compressed_items: [] },
        overall_score: 10,
        raw_score: 0,
        band: 'Band 5',
        form_gate_triggered: true,
        form_reason: formCheck.reason,
        word_count: formCheck.wordCount,
        feedback: `FORM ERROR: ${formCheck.reason}. Your summary must be one complete sentence (5-75 words) with a subject and main verb.`
      });
    }

    const result = await gradeResponse(cleanText, type, prompt);
    
    let contentScore = result.content || 0;
    if (firstPersonCheck.penalty) contentScore = Math.max(0, contentScore - 1);

    const rawScore = formCheck.score + contentScore + (result.grammar?.score || 0) + (result.vocabulary || 0);
    const maxPossible = 8;
    const overallScore = Math.min(90, 10 + Math.round((rawScore / maxPossible) * 80));

    // Determine which key ideas are present for frontend display
    const keyIdeasPresent = result.key_ideas_present || [];
    const keyIdeasMissing = result.key_ideas_missing || [];
    
    res.json({
      trait_scores: {
        form: formCheck.score,
        content: contentScore,
        grammar: result.grammar?.score || 0,
        vocabulary: result.vocabulary || 0
      },
      content_details: {
        key_ideas_extracted: result.key_ideas_extracted || [],
        key_ideas_present: keyIdeasPresent,
        key_ideas_missing: keyIdeasMissing,
        first_person_penalty: firstPersonCheck.penalty || false,
        notes: result.content_notes || '',
        // For frontend display logic
        has_topic: contentScore >= 1,
        has_pivot: contentScore >= 2, 
        has_conclusion: contentScore >= 3
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

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server v6.1.0 running on port ${PORT}`);
  console.log(`🤖 AI: ${anthropic ? 'ACTIVE' : 'DISABLED'}`);
});
