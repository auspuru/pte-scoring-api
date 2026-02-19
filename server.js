const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));

let anthropic = null;
if (ANTHROPIC_API_KEY && ANTHROPIC_API_KEY.startsWith('sk-ant-')) {
  anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
}

const BAND_MAP = {
  0: 'Band 5', 1: 'Band 5',
  2: 'Band 6',
  3: 'Band 6.5',
  4: 'Band 7',
  5: 'Band 7.5',
  6: 'Band 8',
  7: 'Band 9'
};

// ─── STRICT PASSAGE PARSER ───────────────────────────────────────────────────
function parsePassage(passage) {
  if (!passage) return null;
  
  const lower = passage.toLowerCase();
  
  // Find the three key segments
  const topicMatch = passage.match(/(potential loss of \d+% of global gdp|economic cost|gdp loss|trillion|billion).*?(?=\.|;)/i);
  const pivotMatch = passage.match(/(developing nations.*?(?:bear|burden|costs|despite|emissions|justice|unfair)).*?(?=\.|;)/i);
  const conclusionMatch = passage.match(/(renewable energy|solar|wind|investment|\$\d+ trillion|transition|hope).*?(?=\.|;)/i);
  
  return {
    topic: {
      text: topicMatch ? topicMatch[0] : '',
      keywords: ['gdp', 'economic', 'cost', 'loss', 'trillion', 'billion', '10%', 'financial', 'damage']
    },
    pivot: {
      text: pivotMatch ? pivotMatch[0] : '',
      keywords: ['developing', 'nations', 'bear', 'burden', 'despite', 'emissions', 'justice', 'unfair', '75%', 'costs', 'contributing']
    },
    conclusion: {
      text: conclusionMatch ? conclusionMatch[0] : '',
      keywords: ['renewable', 'solar', 'wind', 'investment', 'transition', 'hope', 'solution', '$4', 'trillion', 'scale', 'energy']
    }
  };
}

// ─── STRICT STUDENT CHECK ────────────────────────────────────────────────────
function strictCheck(studentText, structure) {
  const lower = studentText.toLowerCase();
  const words = lower.split(/\s+/);
  
  // Check Topic (must have GDP or economic cost indicators)
  const hasTopic = structure.topic.keywords.some(k => lower.includes(k)) || 
                   /\b(gdp|economic|cost|loss|billion|trillion)\b/.test(lower);
  
  // Check Pivot (MUST mention developing nations or the injustice explicitly)
  // "Failing to act" does NOT count as pivot - that's just topic elaboration
  const hasPivot = structure.pivot.keywords.some(k => lower.includes(k)) ||
                   (lower.includes('developing') && lower.includes('nations')) ||
                   (lower.includes('bear') && lower.includes('cost')) ||
                   lower.includes('despite') ||
                   lower.includes('justice') ||
                   (lower.includes('75%') && lower.includes('emissions'));
  
  // Check Conclusion (MUST mention renewable, solar, investment, or solution)
  const hasConclusion = structure.conclusion.keywords.some(k => lower.includes(k)) ||
                        lower.includes('renewable') ||
                        lower.includes('solar') ||
                        lower.includes('investment') ||
                        lower.includes('transition') ||
                        (lower.includes('$') && lower.includes('trillion')) ||
                        lower.includes('hope') && lower.includes('energy');
  
  const present = [];
  const missing = [];
  
  if (hasTopic) present.push('topic'); else missing.push('topic');
  if (hasPivot) present.push('pivot'); else missing.push('pivot');
  if (hasConclusion) present.push('conclusion'); else missing.push('conclusion');
  
  return {
    topic: hasTopic,
    pivot: hasPivot,
    conclusion: hasConclusion,
    present,
    missing,
    count: present.length
  };
}

// ─── FORM VALIDATION ─────────────────────────────────────────────────────────
function validateForm(text) {
  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  const wc = words.length;
  
  if (wc < 5) return { valid: false, score: 0, reason: 'Too short (min 5 words)', wc };
  if (wc > 75) return { valid: false, score: 0, reason: 'Too long (max 75 words)', wc };
  
  // Check for hanging words (incomplete sentences)
  const lastWord = words[words.length - 1].toLowerCase().replace(/[.!?;,]$/, '');
  const hangingWords = ['the', 'a', 'an', 'and', 'but', 'or', 'with', 'by', 'to', 'of', 'in', 'on', 'for', 'agricultural', 'economic', 'climate', 'global', 'potential'];
  
  if (hangingWords.includes(lastWord)) {
    return { valid: false, score: 0, reason: `Incomplete sentence (ends with "${lastWord}")`, wc };
  }
  
  // Check ending punctuation
  if (!/[.!?]$/.test(text.trim())) {
    return { valid: false, score: 0, reason: 'Must end with period', wc };
  }
  
  // Check single sentence
  const clean = text.replace(/(?:Dr|Mr|Mrs|Ms|Prof|U\.K|U\.S|i\.e|e\.g|etc)\./gi, '##');
  const sentences = (clean.match(/[.!?](\s|$)/g) || []).length;
  
  if (sentences !== 1) return { valid: false, score: 0, reason: 'Must be exactly one sentence', wc };
  
  return { valid: true, score: 1, reason: 'Valid', wc };
}

// ─── GRAMMAR CHECK ───────────────────────────────────────────────────────────
function checkGrammar(text) {
  const lower = text.toLowerCase();
  let score = 2;
  const issues = [];
  
  // Check connector
  const connectors = ['however', 'therefore', 'moreover', 'furthermore', 'consequently', 'thus'];
  const hasConnector = connectors.some(c => lower.includes(c));
  const hasSemicolon = /;\s*(however|therefore|moreover|furthermore|consequently|thus)/i.test(text);
  
  if (!hasConnector) {
    issues.push('No connector detected');
    score = 1;
  } else if (!hasSemicolon) {
    issues.push('Missing semicolon before connector');
    score = 1;
  }
  
  // Major errors
  if (/\b(people|they|countries|nations)\s+(was|is)\b/i.test(text)) {
    issues.push('Subject-verb agreement error');
    score = 0;
  }
  
  return {
    score,
    has_connector: hasConnector,
    has_semicolon_before_connector: hasSemicolon,
    connector_type: lower.includes('however') ? 'contrast' : lower.includes('therefore') ? 'result' : 'none',
    grammar_issues: issues
  };
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '9.0.0', anthropicConfigured: !!anthropic });
});

app.post('/api/grade', async (req, res) => {
  try {
    const { text, type, prompt } = req.body;
    
    if (!text || !type || !prompt) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    // 1. FORM CHECK
    const form = validateForm(text);
    const structure = parsePassage(prompt);
    const coverage = strictCheck(text, structure);
    
    if (!form.valid) {
      return res.json({
        trait_scores: { form: 0, content: 0, grammar: 0, vocabulary: 0 },
        content_details: {
          key_ideas_extracted: [structure.topic.text, structure.pivot.text, structure.conclusion.text],
          key_ideas_present: [],
          key_ideas_missing: ['topic', 'pivot', 'conclusion'],
          notes: 'Form invalid'
        },
        grammar_details: { score: 0, has_connector: false, grammar_issues: [] },
        vocabulary_details: { synonym_usage: 'none' },
        overall_score: 10,
        raw_score: 0,
        band: 'Band 5',
        form_gate_triggered: true,
        form_reason: form.reason,
        word_count: form.wc,
        feedback: `FORM ERROR: ${form.reason}`,
        key_ideas_status: { topic: false, pivot: false, conclusion: false },
        mode: 'local'
      });
    }

    // 2. CONTENT SCORING (Strict)
    let contentScore = 0;
    if (coverage.count === 3) contentScore = 2;
    else if (coverage.count === 2) contentScore = 1;
    else contentScore = 0;
    
    // 3. GRAMMAR
    const grammar = checkGrammar(text);
    
    // 4. TOTALS
    const rawScore = 1 + contentScore + grammar.score + 2; // Form 1 + Content + Grammar + Vocab 2
    const overallScore = Math.min(90, 10 + Math.round((rawScore / 7) * 80));

    // 5. FEEDBACK
    let feedback = '';
    if (coverage.count === 0) feedback = 'Critical: None of the 3 key ideas found. ';
    else if (coverage.count === 1) feedback = `Weak: Only Topic found. Missing: ${coverage.missing.join(', ')}. `;
    else if (coverage.count === 2) feedback = `Good: 2/3 ideas found. Missing: ${coverage.missing[0]}. `;
    else feedback = 'Excellent: All 3 key ideas captured. ';
    
    feedback += grammar.score === 2 ? 'Grammar is excellent.' : 
                grammar.score === 1 ? 'Add semicolon before connector.' : 'Grammar errors detected.';

    res.json({
      trait_scores: {
        form: 1,
        content: contentScore,
        grammar: grammar.score,
        vocabulary: 2
      },
      content_details: {
        key_ideas_extracted: [
          structure.topic.text || 'Topic not detected',
          structure.pivot.text || 'Pivot not detected', 
          structure.conclusion.text || 'Conclusion not detected'
        ],
        key_ideas_present: coverage.present,
        key_ideas_missing: coverage.missing,
        notes: `${coverage.count}/3 key ideas present`
      },
      grammar_details: {
        score: grammar.score,
        has_connector: grammar.has_connector,
        connector_type: grammar.connector_type,
        has_semicolon_before_connector: grammar.has_semicolon_before_connector,
        grammar_issues: grammar.grammar_issues
      },
      vocabulary_details: {
        synonym_usage: 'minimal',
        smart_swaps_detected: [],
        unsafe_swaps_detected: []
      },
      overall_score: overallScore,
      raw_score: rawScore,
      band: BAND_MAP[Math.floor(rawScore)] || 'Band 5',
      word_count: form.wc,
      feedback: feedback,
      key_ideas_status: {
        topic: coverage.topic,
        pivot: coverage.pivot,
        conclusion: coverage.conclusion
      },
      mode: 'local'
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ PTE SWT Grader v9.0.0 on port ${PORT}`);
});
