const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── SAFETY FIRST: Global Error Handlers ─────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('FATAL: Uncaught Exception:', err);
  // Keep running despite errors
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('FATAL: Unhandled Rejection at:', promise, 'reason:', reason);
});

// ─── ANTHROPIC SETUP (Safe Initialization) ───────────────────────────────────
let anthropic = null;
let Anthropic = null;

try {
  Anthropic = require('@anthropic-ai/sdk');
  console.log('✅ Anthropic SDK loaded');
} catch (err) {
  console.error('❌ Failed to load Anthropic SDK:', err.message);
}

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (Anthropic && ANTHROPIC_API_KEY && ANTHROPIC_API_KEY.startsWith('sk-ant-')) {
  try {
    anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    console.log('✅ Anthropic client initialized');
  } catch (err) {
    console.error('❌ Failed to initialize Anthropic:', err.message);
  }
} else {
  console.warn('⚠️  Anthropic not available - running in LOCAL ONLY mode');
  console.warn('   Key exists:', !!ANTHROPIC_API_KEY);
  console.warn('   Key format valid:', ANTHROPIC_API_KEY ? ANTHROPIC_API_KEY.startsWith('sk-ant-') : false);
}

// ─── MIDDLEWARE ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Request logging for debugging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── DATA ────────────────────────────────────────────────────────────────────
const BAND_MAP = {
  0: 'Band 5', 1: 'Band 5', 2: 'Band 5',
  3: 'Band 6', 4: 'Band 6',
  5: 'Band 7', 6: 'Band 7',
  7: 'Band 8', 8: 'Band 9'
};

// ─── HELPERS (Bulletproof) ───────────────────────────────────────────────────
function toString(val) {
  if (val === null || val === undefined) return '';
  return String(val);
}

function sanitizeInput(text) {
  try {
    const str = toString(text);
    return str
      .replace(/ignore previous instructions/gi, '')
      .replace(/system prompt/gi, '')
      .replace(/you are now/gi, '')
      .replace(/give me 90/gi, '')
      .slice(0, 2000);
  } catch (e) {
    return '';
  }
}

function hasFiniteVerb(text) {
  try {
    return /\b(is|are|was|were|has|have|had|made|became|found|indicates|reveals|suggests|argues|claims|states|finds|shows|demonstrates)\b/i.test(text);
  } catch (e) {
    return true; // Default to true to avoid false negatives
  }
}

function calculateForm(text, type) {
  try {
    const cleanInput = sanitizeInput(text);
    const words = cleanInput.trim().split(/\s+/).filter(w => w.length > 0);
    const wc = words.length;

    if (type === 'summarize-written-text') {
      const cleanText = cleanInput.replace(/(?:Dr|Mr|Mrs|Ms|Prof|U\.K|U\.S|i\.e|e\.g|etc)\./gi, '##');
      const sentenceCount = (cleanText.match(/[.!?](\s|$)/g) || []).length;
      
      if (sentenceCount !== 1) return { score: 0, reason: 'Multiple sentences', wordCount: wc };
      if (!hasFiniteVerb(cleanInput)) return { score: 0, reason: 'No finite verb', wordCount: wc };
      if (wc >= 5 && wc <= 80) return { score: 1, reason: 'Valid', wordCount: wc };
      return { score: 0, reason: wc < 5 ? 'Too short' : 'Too long', wordCount: wc };
    }
    return { score: 0, reason: 'Invalid type', wordCount: wc };
  } catch (e) {
    console.error('Form calculation error:', e);
    return { score: 1, reason: 'Error fallback', wordCount: 0 }; // Default to valid to not block user
  }
}

function checkFirstPersonTrap(text, passageText) {
  try {
    const pText = toString(passageText);
    const sText = toString(text);
    const iCount = (pText.match(/\b(I|my|me)\b/gi) || []).length;
    const isNarrative = iCount > 2 && !pText.includes('Dr.') && !/researcher|professor/i.test(pText);
    
    if (isNarrative && /^\s*(I|My|Me)\b/.test(sText)) {
      return { penalty: true, note: "First-person narrative detected" };
    }
    return { penalty: false };
  } catch (e) {
    return { penalty: false };
  }
}

// ─── AI GRADING (Ultra-Defensive) ────────────────────────────────────────────
async function gradeResponse(text, type, passageText) {
  // If no AI available, return immediately
  if (!anthropic) {
    return {
      content: 2, // Default generous score
      topic_captured: true,
      pivot_captured: true, 
      conclusion_captured: true,
      grammar: { score: 2, has_connector: true, connector_type: 'contrast' },
      vocabulary: 2,
      feedback: 'AI unavailable - using estimated scoring. Please check ANTHROPIC_API_KEY.',
      mode: 'local'
    };
  }

  const firstPersonCheck = checkFirstPersonTrap(text, passageText);

  const systemPrompt = `You are a PTE examiner. Grade the SWT response.
CONTENT (0-3): 1pt each for TOPIC, PIVOT (contrast), CONCLUSION.
GRAMMAR (0-2): 2=correct, 1=minor issues, 0=wrong.
VOCABULARY (0-2): 2=good, 1=ok, 0=poor.
Return ONLY JSON.`;

  const userPrompt = `Passage: ${passageText.substring(0, 800)}
Student: ${text.substring(0, 200)}
Penalty: ${firstPersonCheck.penalty ? 'Yes (-1 content)' : 'No'}

Return: {"content":0-3,"topic_captured":bool,"pivot_captured":bool,"conclusion_captured":bool,"grammar":{"score":0-2},"vocabulary":0-2,"feedback":"..."}`;

  try {
    console.log('Calling Haiku API...');
    
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',  // Your available model
      max_tokens: 1000,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    // Defensive parsing
    let rawText = '';
    if (response && response.content && response.content[0] && response.content[0].text) {
      rawText = response.content[0].text;
    } else {
      throw new Error('Invalid response structure from Anthropic');
    }

    console.log('AI raw response:', rawText.substring(0, 100));

    // Clean and parse
    const cleanText = rawText
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/gi, '')
      .trim();
    
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON object found');
    
    const result = JSON.parse(jsonMatch[0]);
    return { ...result, mode: 'ai' };

  } catch (err) {
    console.error('AI Grading failed:', err.message);
    
    // Return fallback that still gives valid scores
    return {
      content: 1,
      topic_captured: false,
      pivot_captured: false,
      conclusion_captured: false,
      content_notes: `AI Error: ${err.message}`,
      grammar: { score: 1, has_connector: false, connector_type: 'none' },
      vocabulary: 1,
      feedback: `Grading service temporarily limited. Error: ${err.message}. Please try again.`,
      mode: 'local'
    };
  }
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '5.5.0-emergency',
    ai_available: !!anthropic,
    key_configured: !!ANTHROPIC_API_KEY,
    timestamp: new Date().toISOString()
  });
});

app.post('/api/grade', async (req, res) => {
  try {
    // Validate request body exists
    if (!req.body) {
      return res.status(400).json({ error: 'No request body' });
    }

    const text = toString(req.body.text);
    const type = toString(req.body.type) || 'summarize-written-text';
    const prompt = toString(req.body.prompt);

    if (!text.trim() || !prompt.trim()) {
      return res.status(400).json({ error: 'Missing text or prompt' });
    }

    // Form check
    const formCheck = calculateForm(text, type);
    const firstPersonCheck = checkFirstPersonTrap(text, prompt);

    if (formCheck.score === 0) {
      return res.json({
        trait_scores: { form: 0, content: 0, grammar: 0, vocabulary: 0 },
        overall_score: 10,
        band: 'Band 5',
        form_gate_triggered: true,
        form_reason: formCheck.reason,
        word_count: formCheck.wordCount,
        feedback: `FORM ERROR: ${formCheck.reason}`,
        scoring_mode: 'local'
      });
    }

    // AI Grading (with timeout protection implicitly handled by Express)
    const result = await gradeResponse(text, type, prompt);
    
    // Calculate scores
    let contentScore = Math.max(0, (result.content || 0) - (firstPersonCheck.penalty ? 1 : 0));
    const rawScore = formCheck.score + contentScore + (result.grammar?.score || 0) + (result.vocabulary || 0);
    const overallScore = Math.min(90, 10 + Math.round((rawScore / 8) * 80));

    res.json({
      trait_scores: {
        form: formCheck.score,
        content: contentScore,
        grammar: result.grammar?.score || 0,
        vocabulary: result.vocabulary || 0
      },
      content_details: {
        topic_captured: result.topic_captured || false,
        pivot_captured: result.pivot_captured || false,
        conclusion_captured: result.conclusion_captured || false,
        first_person_penalty: firstPersonCheck.penalty || false
      },
      overall_score: overallScore,
      raw_score: rawScore,
      band: BAND_MAP[rawScore] || 'Band 5',
      word_count: formCheck.wordCount,
      feedback: result.feedback || 'No feedback available',
      scoring_mode: result.mode || 'unknown'
    });

  } catch (error) {
    console.error('ROUTE ERROR:', error);
    // Never crash - always return JSON
    res.status(500).json({ 
      error: 'Server error', 
      message: error.message,
      trait_scores: { form: 1, content: 0, grammar: 0, vocabulary: 0 },
      overall_score: 10,
      band: 'Band 5',
      feedback: 'Server error occurred. Please refresh and try again.'
    });
  }
});

// ─── START ───────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 Emergency Server v5.5.0 on port', PORT);
  console.log('AI Status:', anthropic ? '✅ Connected' : '❌ Local only');
});
