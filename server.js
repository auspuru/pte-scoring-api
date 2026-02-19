const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();

// CORS configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Use Haiku model (available on your account)
const MODEL = 'claude-3-haiku-20240307';

// Cache for responses (max 500 entries)
const cache = new Map();
const MAX_CACHE = 500;

// Rate limiting (10 requests per minute per IP)
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS = 10;

// Check rate limit
function checkRateLimit(ip) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  
  if (!rateLimit.has(ip)) {
    rateLimit.set(ip, []);
  }
  
  const requests = rateLimit.get(ip).filter(time => time > windowStart);
  requests.push(now);
  rateLimit.set(ip, requests);
  
  return requests.length <= MAX_REQUESTS;
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '5.5.0',
    model: MODEL,
    anthropicConfigured: !!process.env.ANTHROPIC_API_KEY,
    cacheSize: cache.size
  });
});

// Sanitize input to prevent prompt injection
function sanitizeInput(text) {
  return text
    .replace(/[<>]/g, '')
    .replace(/\{.*?\}/g, '')
    .substring(0, 5000);
}

// Check for finite verb (basic)
function hasFiniteVerb(text) {
  const finitePatterns = [
    /\b(is|are|was|were|be|been|being|have|has|had|do|does|did|will|would|could|should|may|might|must|can|shall)\b/i,
    /\b[a-z]+ed\b/i,
    /\b[a-z]+ing\b/i,
    /\b[a-z]+s\b/i
  ];
  return finitePatterns.some(p => p.test(text));
}

// Check for connectors
function detectConnector(text) {
  const connectors = {
    contrast: ['however', 'although', 'though', 'while', 'whereas', 'but', 'yet', 'nevertheless', 'nonetheless', 'despite', 'in contrast', 'on the other hand', 'conversely'],
    addition: ['and', 'also', 'furthermore', 'moreover', 'additionally', 'besides', 'in addition', 'as well as'],
    reason: ['because', 'since', 'as', 'therefore', 'thus', 'hence', 'consequently', 'so', 'due to', 'owing to', 'accordingly', 'as a result'],
    sequence: ['first', 'second', 'then', 'next', 'finally', 'subsequently', 'afterwards', 'meanwhile'],
    example: ['for example', 'for instance', 'such as', 'like', 'namely', 'specifically']
  };
  
  const lower = text.toLowerCase();
  for (const [type, words] of Object.entries(connectors)) {
    for (const word of words) {
      if (lower.includes(word.toLowerCase())) {
        return { has: true, type, word };
      }
    }
  }
  return { has: false, type: 'none', word: null };
}

// Check for first-person usage
function checkFirstPerson(text, passage) {
  const firstPerson = /\b(I|me|my|mine|myself)\b/i;
  const passageHasFirstPerson = firstPerson.test(passage);
  const summaryHasFirstPerson = firstPerson.test(text);
  
  return passageHasFirstPerson && summaryHasFirstPerson;
}

// Local grading fallback
function localGrade(text, passage) {
  const words = text.trim().split(/\s+/).length;
  const connector = detectConnector(text);
  const firstPersonPenalty = checkFirstPerson(text, passage);
  
  // Check for chained connectors
  const connectorWords = ['however', 'although', 'though', 'while', 'but', 'and', 'therefore', 'consequently', 'furthermore', 'moreover'];
  const foundConnectors = connectorWords.filter(c => text.toLowerCase().includes(c));
  const chainedConnectors = foundConnectors.length >= 2;
  
  // Basic content detection
  const passageLower = passage.toLowerCase();
  const textLower = text.toLowerCase();
  
  // Extract key terms from passage (simple approach)
  const keyTerms = passageLower.match(/\b[a-z]{5,}\b/g) || [];
  const uniqueTerms = [...new Set(keyTerms)].slice(0, 20);
  const matchedTerms = uniqueTerms.filter(term => textLower.includes(term));
  const contentScore = Math.min(3, Math.floor(matchedTerms.length / 5));
  
  // Grammar score
  let grammarScore = 1;
  if (connector.has) grammarScore = 2;
  if (chainedConnectors) grammarScore = 1; // Penalty for chained
  
  // Vocabulary score
  const vocabScore = contentScore >= 2 ? 2 : 1;
  
  const rawScore = 1 + contentScore + grammarScore + vocabScore; // Form is always 1 if we got here
  const overallScore = Math.round((rawScore / 8) * 90);
  
  let band;
  if (overallScore >= 79) band = 'Band 8';
  else if (overallScore >= 65) band = 'Band 7';
  else if (overallScore >= 51) band = 'Band 6';
  else if (overallScore >= 40) band = 'Band 5';
  else band = 'Band 4';
  
  return {
    trait_scores: {
      form: 1,
      content: contentScore,
      grammar: grammarScore,
      vocabulary: vocabScore
    },
    content_details: {
      topic_captured: contentScore >= 1,
      pivot_captured: contentScore >= 2,
      conclusion_captured: contentScore >= 3,
      first_person_penalty: firstPersonPenalty,
      notes: 'Local grading'
    },
    grammar_details: {
      spelling_errors: [],
      grammar_issues: [],
      has_connector: connector.has,
      connector_type: connector.type,
      connector_logic_correct: true,
      chained_connectors: chainedConnectors
    },
    vocabulary_details: {
      synonym_usage: contentScore >= 2 ? 'good' : 'basic',
      smart_swaps_detected: [],
      compression_detected: false,
      compressed_items: []
    },
    overall_score: overallScore,
    raw_score: rawScore,
    band: band,
    form_gate_triggered: false,
    form_reason: 'Valid',
    word_count: words,
    feedback: 'Graded using local fallback.',
    scoring_mode: 'local'
  };
}

// AI grading with Anthropic
async function aiGrade(text, passage) {
  const prompt = `You are a PTE Academic scoring expert. Grade this Summarize Written Text response.

PASSAGE:
${passage}

STUDENT SUMMARY:
${text}

Analyze and return ONLY a JSON object with this exact structure:
{
  "trait_scores": {
    "form": 0-1 (1 if 5-75 words and one sentence, else 0),
    "content": 0-3 (0=none, 1=topic only, 2=topic+pivot, 3=all three),
    "grammar": 0-2 (2=no errors+connector, 1=minor errors, 0=major errors),
    "vocabulary": 0-2 (2=excellent synonyms, 1=adequate, 0=poor)
  },
  "content_details": {
    "topic_captured": true/false,
    "pivot_captured": true/false,
    "conclusion_captured": true/false,
    "first_person_penalty": true/false (if passage uses "I" and summary also uses "I" instead of "the author"),
    "notes": "brief explanation"
  },
  "grammar_details": {
    "spelling_errors": [{"word": "misspelled", "suggestion": "correct"}],
    "grammar_issues": [{"issue": "description", "suggestion": "fix", "rule": "rule name"}],
    "has_connector": true/false,
    "connector_type": "contrast/addition/reason/none",
    "connector_logic_correct": true/false,
    "chained_connectors": true/false (true if 2+ connectors used)
  },
  "vocabulary_details": {
    "synonym_usage": "none/basic/good/excellent",
    "smart_swaps_detected": ["word → synonym"],
    "compression_detected": true/false,
    "compressed_items": ["compressed phrases"]
  },
  "feedback": "2-3 sentences of constructive feedback"
}

Important scoring rules:
- Content 0/3: Missing topic, pivot, and conclusion
- Content 1/3: Topic captured only
- Content 2/3: Topic + pivot captured
- Content 3/3: All three elements captured
- Deduct 1 band if first_person_penalty is true (passage is narrative but summary uses "I")
- Grammar: 2 = perfect with connector, 1 = minor issues, 0 = major issues
- Chained connectors (using 2+ like "Although... but...") = grammar penalty`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    temperature: 0.1,
    messages: [{ role: 'user', content: prompt }]
  });

  const content = response.content[0].text;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Invalid AI response');
  
  const aiResult = JSON.parse(jsonMatch[0]);
  
  // Calculate scores
  const traits = aiResult.trait_scores;
  const rawScore = traits.form + traits.content + traits.grammar + traits.vocabulary;
  const overallScore = Math.round((rawScore / 8) * 90);
  
  let band;
  if (overallScore >= 79) band = 'Band 8';
  else if (overallScore >= 65) band = 'Band 7';
  else if (overallScore >= 51) band = 'Band 6';
  else if (overallScore >= 40) band = 'Band 5';
  else band = 'Band 4';
  
  // Apply first-person penalty to band if needed
  if (aiResult.content_details.first_person_penalty) {
    if (band === 'Band 8') band = 'Band 7';
    else if (band === 'Band 7') band = 'Band 6';
    else if (band === 'Band 6') band = 'Band 5';
    else if (band === 'Band 5') band = 'Band 4';
  }
  
  return {
    ...aiResult,
    overall_score: overallScore,
    raw_score: rawScore,
    band: band,
    form_gate_triggered: false,
    form_reason: 'Valid',
    word_count: text.trim().split(/\s+/).length,
    scoring_mode: 'ai'
  };
}

// Main grading endpoint
app.post('/api/grade', async (req, res) => {
  try {
    const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    // Rate limiting
    if (!checkRateLimit(clientIP)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Max 10 requests per minute.' });
    }
    
    const { text, type, prompt: passage } = req.body;
    
    // Validation
    if (!text || !passage) {
      return res.status(400).json({ error: 'Missing text or passage' });
    }
    
    if (type !== 'summarize-written-text') {
      return res.status(400).json({ error: 'Invalid type' });
    }
    
    // Sanitize inputs
    const cleanText = sanitizeInput(text);
    const cleanPassage = sanitizeInput(passage);
    
    // Check word count
    const words = cleanText.trim().split(/\s+/).length;
    if (words < 5 || words > 75) {
      return res.json({
        trait_scores: { form: 0, content: 0, grammar: 0, vocabulary: 0 },
        content_details: { topic_captured: false, pivot_captured: false, conclusion_captured: false, first_person_penalty: false, notes: 'Form invalid' },
        grammar_details: { spelling_errors: [], grammar_issues: [], has_connector: false, connector_type: 'none', connector_logic_correct: false, chained_connectors: false },
        vocabulary_details: { synonym_usage: 'none', smart_swaps_detected: [], compression_detected: false, compressed_items: [] },
        overall_score: 10,
        raw_score: 0,
        band: 'Band 5',
        form_gate_triggered: true,
        form_reason: words < 5 ? 'Too short (min 5 words)' : 'Too long (max 75 words)',
        word_count: words,
        feedback: `FORM ERROR: Summary must be between 5-75 words. Your summary is ${words} words.`,
        scoring_mode: 'local'
      });
    }
    
    // Check for finite verb (form validation)
    if (!hasFiniteVerb(cleanText)) {
      return res.json({
        trait_scores: { form: 0, content: 0, grammar: 0, vocabulary: 0 },
        content_details: { topic_captured: false, pivot_captured: false, conclusion_captured: false, first_person_penalty: false, notes: 'No finite verb' },
        grammar_details: { spelling_errors: [], grammar_issues: [], has_connector: false, connector_type: 'none', connector_logic_correct: false, chained_connectors: false },
        vocabulary_details: { synonym_usage: 'none', smart_swaps_detected: [], compression_detected: false, compressed_items: [] },
        overall_score: 10,
        raw_score: 0,
        band: 'Band 5',
        form_gate_triggered: true,
        form_reason: 'No finite verb — not a complete sentence',
        word_count: words,
        feedback: 'FORM ERROR: No finite verb — not a complete sentence. Your response must be exactly one complete sentence (5-75 words) with a subject and verb.',
        scoring_mode: 'local'
      });
    }
    
    // Check cache
    const cacheKey = cleanText.toLowerCase().trim() + '|' + cleanPassage.substring(0, 100);
    if (cache.has(cacheKey)) {
      const cached = cache.get(cacheKey);
      cached.scoring_mode = 'cached';
      return res.json(cached);
    }
    
    // Try AI grading first
    let result;
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        result = await aiGrade(cleanText, cleanPassage);
      } catch (aiError) {
        console.error('AI Grading Error:', aiError.message);
        result = localGrade(cleanText, cleanPassage);
        result.feedback = 'AI grading unavailable. Using local fallback. ' + result.feedback;
      }
    } else {
      result = localGrade(cleanText, cleanPassage);
      result.feedback = 'AI not configured. Using local grading. ' + result.feedback;
    }
    
    // Cache result
    if (cache.size >= MAX_CACHE) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }
    cache.set(cacheKey, result);
    
    res.json(result);
    
  } catch (error) {
    console.error('Grading error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log('✅ PTE Grading API v5.5.0 on port', PORT);
  console.log('🤖 AI mode:', process.env.ANTHROPIC_API_KEY ? 'active' : 'disabled');
  console.log('📦 Model:', MODEL);
});
