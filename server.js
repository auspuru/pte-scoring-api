const express = require('express');
const cors = require('cors');

const app = express();
const PORT = parseInt(process.env.PORT) || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const fetch = global.fetch || require('node-fetch');

// PTE Academic synonym database for common terms
const SYNONYM_MAP = {
  // Key concepts from passages
  'adaptive': ['adjustable', 'flexible', 'responsive', 'modifying', 'changing'],
  'persistence': ['perseverance', 'determination', 'tenacity', 'endurance', 'dedication', 'commitment', 'doggedness'],
  'success': ['achievement', 'accomplishment', 'triumph', 'victory', 'prosperity', 'attainment'],
  'talent': ['natural ability', 'gift', 'aptitude', 'skill', 'capacity', 'flair', 'genius', 'innate ability'],
  'intelligence': ['intellect', 'brainpower', 'smartness', 'cleverness', 'reasoning', 'mental ability'],
  'setbacks': ['failures', 'obstacles', 'difficulties', 'challenges', 'hurdles', 'reverses', 'problems', 'issues'],
  'tough': ['difficult', 'hard', 'challenging', 'demanding', 'arduous', 'harder'],
  'smart': ['intelligent', 'clever', 'bright', 'brilliant', 'sharp'],
  'achievers': ['high performers', 'successful people', 'winners', 'leaders', 'top performers'],
  'view': ['see', 'regard', 'consider', 'perceive', 'look upon', 'treat'],
  'opportunities': ['chances', 'prospects', 'openings', 'possibilities', 'avenues'],
  'goals': ['aims', 'objectives', 'targets', 'ambitions', 'purposes'],
  'develop': ['build', 'cultivate', 'foster', 'nurture', 'establish', 'create'],
  'practice': ['habit', 'routine', 'exercise', 'training', 'drill', 'repetition'],
  'brain': ['mind', 'intellect', 'mentality', 'cognition', 'memory'],
  'mindset': ['attitude', 'outlook', 'perspective', 'mentality', 'approach'],
  'research': ['study', 'investigation', 'analysis', 'inquiry', 'exploration'],
  'discovered': ['found', 'revealed', 'uncovered', 'identified', 'detected', 'learned'],
  'credit': ['attribute', 'ascribe', 'assign', 'accredit', 'acknowledge'],
  'working': ['functioning', 'operating', 'performing', 'laboring', 'toiling'],
  'harder': ['more difficult', 'tougher', 'more demanding', 'more challenging'],
  'small': ['little', 'minor', 'modest', 'minimal', 'slight'],
  'pause': ['stop', 'halt', 'break', 'interrupt', 'wait'],
  'teaching': ['instructing', 'educating', 'training', 'showing', 'guiding'],
  'wrong': ['incorrect', 'mistaken', 'erroneous', 'false', 'inaccurate'],
  'shocking': ['surprising', 'astonishing', 'staggering', 'startling', 'remarkable'],
  'reach': ['achieve', 'attain', 'accomplish', 'fulfill', 'meet'],
  'blame': ['fault', 'accuse', 'censure', 'attribute to', 'hold responsible'],
  'circumstances': ['conditions', 'situations', 'factors', 'context', 'environment'],
  'determines': ['decides', 'defines', 'establishes', 'sets', 'dictates'],
  'future': ['prospect', 'outcome', 'destiny', 'later', 'coming time']
};

// Constants
const MAX_RETRIES = 2;
const REQUEST_TIMEOUT = 30000;
const MIN_PARAPHRASE_WORDS = 4; // Minimum words that must be changed to synonyms
const MAX_VERBATIM_RATIO = 0.6; // Max 60% verbatim allowed

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Utility: Normalize text
function normalize(text) {
  return text.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Utility: Get unique words
function getWords(text) {
  return normalize(text).split(' ').filter(w => w.length > 2);
}

// Check paraphrase quality - returns analysis object
function analyzeParaphrase(studentSummary, passageText) {
  const studentWords = getWords(studentSummary);
  const passageWords = getWords(passageText);
  const passageWordSet = new Set(passageWords);
  
  let verbatimCount = 0;
  let synonymSubstitutions = 0;
  let changedWords = [];
  let matchedSynonyms = [];
  
  // Check each word in student summary
  studentWords.forEach(word => {
    if (passageWordSet.has(word)) {
      verbatimCount++;
    } else {
      // Check if it's a synonym of any passage word
      let isSynonym = false;
      let originalWord = '';
      
      for (const [key, synonyms] of Object.entries(SYNONYM_MAP)) {
        // Check if word matches a synonym
        if (synonyms.includes(word) && passageWordSet.has(key)) {
          isSynonym = true;
          originalWord = key;
          break;
        }
        // Check if word is the key and original passage had synonym (reverse)
        if (key === word && synonyms.some(s => passageWordSet.has(s))) {
          isSynonym = true;
          originalWord = word;
          break;
        }
        // Check both directions in synonym list
        if (synonyms.includes(word)) {
          // Check if any form of key or other synonyms exist in passage
          const allForms = [key, ...synonyms];
          if (allForms.some(form => passageWordSet.has(form))) {
            isSynonym = true;
            originalWord = key;
            break;
          }
        }
      }
      
      if (isSynonym) {
        synonymSubstitutions++;
        changedWords.push({ from: originalWord, to: word });
      }
    }
  });
  
  const totalContentWords = studentWords.length;
  const verbatimRatio = totalContentWords > 0 ? verbatimCount / totalContentWords : 0;
  
  // Check for phrase-level copying (3+ word sequences)
  const passagePhrases = getNgrams(passageText, 3);
  const studentPhrases = getNgrams(studentSummary, 3);
  let copiedPhrases = 0;
  
  studentPhrases.forEach(phrase => {
    if (passagePhrases.has(phrase)) copiedPhrases++;
  });
  
  return {
    verbatimCount,
    verbatimRatio,
    synonymSubstitutions,
    changedWords,
    copiedPhrases,
    totalWords: totalContentWords,
    isVerbatim: verbatimRatio > MAX_VERBATIM_RATIO,
    hasAdequateParaphrase: synonymSubstitutions >= MIN_PARAPHRASE_WORDS,
    paraphraseScore: Math.min((synonymSubstitutions / MIN_PARAPHRASE_WORDS) * 2, 2), // 0-2 scale
    uniqueWords: totalContentWords - verbatimCount
  };
}

// Generate n-grams
function getNgrams(text, n) {
  const words = getWords(text);
  const ngrams = new Set();
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.add(words.slice(i, i + n).join(' '));
  }
  return ngrams;
}

// Form validation
function validateForm(summary) {
  if (!summary || typeof summary !== 'string') {
    return { wordCount: 0, isValidForm: false, error: 'Summary must be a string' };
  }
  
  const trimmed = summary.trim();
  const words = trimmed.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  
  const sentenceMatches = trimmed.match(/[.!?]+(?:\s+|$)/g);
  const sentenceCount = sentenceMatches ? sentenceMatches.length : 0;
  
  const endsWithPeriod = /[.!?]$/.test(trimmed);
  const hasNewlines = /[\n\r]/.test(summary);
  const hasBullets = /^[•\-*\d]\s|^\d+\.\s/m.test(summary);
  
  const isValidForm = wordCount >= 5 && wordCount <= 75 && endsWithPeriod && !hasNewlines && !hasBullets && sentenceCount === 1;
  
  return { wordCount, isValidForm, sentenceCount, details: { endsWithPeriod, hasNewlines, hasBullets } };
}

// Extract JSON
function extractJSON(text) {
  if (!text) return null;
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1].trim()); } catch (e) {}
  }
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch (e) { return null; }
  }
  return null;
}

// Safe passage validator
function validatePassage(passage) {
  if (!passage || typeof passage !== 'object') return { valid: false, error: 'Passage must be an object' };
  if (!passage.text || typeof passage.text !== 'string') return { valid: false, error: 'Passage text required' };
  if (!passage.keyElements || typeof passage.keyElements !== 'object') return { valid: false, error: 'keyElements required' };
  
  return { 
    valid: true,
    text: passage.text,
    critical: passage.keyElements.critical || 'N/A',
    important: passage.keyElements.important || 'N/A',
    conclusion: passage.keyElements.conclusion || passage.keyElements.supplementary?.[0] || 'N/A',
    fullText: passage.text
  };
}

// Timeout wrapper
async function fetchWithTimeout(url, options, timeout = REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error.name === 'AbortError' ? new Error('Request timeout') : error;
  }
}

// Grade endpoint
app.post('/api/grade', async (req, res) => {
  try {
    const { summary, passage } = req.body;
    
    if (!summary || !passage) {
      return res.status(400).json({ error: 'Missing summary or passage' });
    }

    const formCheck = validateForm(summary);
    
    if (!formCheck.isValidForm) {
      return res.status(400).json({
        trait_scores: {
          form: { value: 0, word_count: formCheck.wordCount, notes: 'Invalid form' },
          content: { value: 0, topic_captured: false, pivot_captured: false, conclusion_captured: false, notes: 'Form error' },
          grammar: { value: 0, has_connector: false, notes: 'Form error' },
          vocabulary: { value: 0, notes: 'Form error' }
        },
        overall_score: 0,
        raw_score: 0,
        band: 'Band 5',
        feedback: 'Form validation failed.',
        paraphrase_analysis: { warning: 'Form invalid - paraphrase not analyzed' }
      });
    }

    const passageCheck = validatePassage(passage);
    if (!passageCheck.valid) {
      return res.status(400).json({ error: 'Invalid passage', details: passageCheck.error });
    }

    // Analyze paraphrase quality locally first
    const paraAnalysis = analyzeParaphrase(summary, passageCheck.fullText);
    
    // If too verbatim, warn but don't auto-fail (let AI decide context)
    let paraphraseWarning = '';
    if (paraAnalysis.isVerbatim) {
      paraphraseWarning = 'Warning: High verbatim similarity detected. Ensure you paraphrase using your own words.';
    }
    
    // Check if they met the 4-word synonym minimum
    if (!paraAnalysis.hasAdequateParaphrase) {
      paraphraseWarning += ` Only ${paraAnalysis.synonymSubstitutions} synonym substitutions found (min ${MIN_PARAPHRASE_WORDS} recommended).`;
    }

    // No API key - local scoring with paraphrase bonus
    if (!ANTHROPIC_API_KEY) {
      const connectors = ['however', 'although', 'while', 'but', 'yet', 'moreover', 'furthermore', 'therefore'];
      const hasConnector = connectors.some(c => summary.toLowerCase().includes(c));
      
      // Base scores
      let contentScore = 2;
      let vocabScore = paraAnalysis.hasAdequateParaphrase ? 2 : 1; // Penalize if not enough paraphrasing
      
      if (paraAnalysis.isVerbatim) {
        contentScore = 1; // Penalize verbatim copying
        vocabScore = 0;
      }
      
      const grammarScore = hasConnector ? 2 : 1;
      const rawScore = 1 + contentScore + grammarScore + vocabScore;
      const overallScore = Math.min(Math.round((rawScore / 7) * 90), 90);
      
      return res.json({
        trait_scores: {
          form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
          content: { value: contentScore, topic_captured: true, pivot_captured: true, conclusion_captured: true, notes: paraAnalysis.isVerbatim ? 'Too verbatim' : 'Local scoring' },
          grammar: { value: grammarScore, has_connector: hasConnector, notes: hasConnector ? 'Connector found' : 'No connector' },
          vocabulary: { value: vocabScore, notes: paraAnalysis.hasAdequateParaphrase ? 'Good paraphrasing' : 'Insufficient synonym variety' }
        },
        overall_score: overallScore,
        raw_score: rawScore,
        band: overallScore >= 79 ? 'Band 8+' : overallScore >= 65 ? 'Band 7' : 'Band 6',
        feedback: paraAnalysis.isVerbatim 
          ? 'Your summary copies too many words from the passage. Use synonyms and restructure sentences.' 
          : `Good attempt. ${hasConnector ? '' : 'Try adding a connector like "however" or "moreover".'}`,
        paraphrase_analysis: {
          ...paraAnalysis,
          warning: paraphraseWarning,
          status: paraAnalysis.hasAdequateParaphrase ? 'ACCEPTABLE' : 'NEEDS_IMPROVEMENT',
          synonym_substitutions_detected: paraAnalysis.changedWords
        },
        scoring_mode: 'local_with_paraphrase_check'
      });
    }

    // AI scoring with paraphrase context
    let lastError = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await fetchWithTimeout(
          'https://api.anthropic.com/v1/messages',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
              model: 'claude-3-haiku-20240307',
              max_tokens: 2000,
              temperature: 0.0,
              system: `You are a PTE Academic examiner. Evaluate paraphrasing quality:

PARAPHRASE REQUIREMENTS:
- Student MUST change at least 4 words to synonyms (nearest meaning) to demonstrate understanding
- Acceptable: "natural ability" for "talent", "difficult" for "tough", "perseverance" for "persistence"
- Acceptable: Adding connector words or restructuring sentence order
- NOT acceptable: Copying 3+ word phrases verbatim from passage
- NOT acceptable: Changing only 1-2 words while keeping 80%+ of original text

VERBATIM DETECTION:
- If >60% words are copied exactly from passage, mark as "verbatim" and reduce vocabulary score
- If student changed 4+ words to appropriate synonyms, mark as "good paraphrase"

SCORING:
- Content: Full credit if meaning accurate, regardless of paraphrasing (unless completely wrong)
- Vocabulary: 2/2 if 4+ good synonyms used, 1/2 if 2-3 synonyms, 0/2 if verbatim copying
- Grammar: Check for complex connectors (however, although, while, but, moreover, etc.)`,
              messages: [{
                role: 'user',
                content: `Evaluate this PTE summary.

PASSAGE: "${passageCheck.text}"

KEY ELEMENTS:
- TOPIC: ${passageCheck.critical}
- PIVOT: ${passageCheck.important}  
- CONCLUSION: ${passageCheck.conclusion}

STUDENT SUMMARY: "${summary}"

PARAPHRASE ANALYSIS (Auto-generated):
- Verbatim word count: ${paraAnalysis.verbatimCount}
- Synonym substitutions detected: ${paraAnalysis.synonymSubstitutions}
- Verbatim ratio: ${(paraAnalysis.verbatimRatio * 100).toFixed(1)}%
- Changed words: ${JSON.stringify(paraAnalysis.changedWords.slice(0, 6))}
- 4-word minimum met: ${paraAnalysis.hasAdequateParaphrase ? 'YES' : 'NO'}

Return JSON:
{
  "trait_scores": {
    "form": { "value": 1, "word_count": ${formCheck.wordCount}, "notes": "Valid form" },
    "content": { "value": 0-2, "topic_captured": true/false, "pivot_captured": true/false, "conclusion_captured": true/false, "notes": "..." },
    "grammar": { "value": 0-2, "has_connector": true/false, "connector_used": "...", "notes": "..." },
    "vocabulary": { "value": 0-2, "paraphrase_quality": "excellent/good/poor/verbatim", "synonyms_count": number, "notes": "..." }
  },
  "paraphrase_evaluation": {
    "is_verbatim": true/false,
    "synonyms_used": ["word -> synonym", ...],
    "recommendation": "..."
  },
  "feedback": "...",
  "overall_assessment": "..."
}`
              }]
            })
          }
        );

        if (!response.ok) throw new Error(`API error ${response.status}`);
        
        const data = await response.json();
        const aiContent = data.content?.[0]?.text;
        if (!aiContent) throw new Error('Empty AI response');
        
        const aiResult = extractJSON(aiContent);
        if (!aiResult) throw new Error('JSON parse failed');

        // Calculate final scores
        const contentValue = Math.min(Math.max(Number(aiResult.trait_scores?.content?.value) || 1, 0), 2);
        const grammarValue = Math.min(Math.max(Number(aiResult.trait_scores?.grammar?.value) || 1, 0), 2);
        const vocabValue = Math.min(Math.max(Number(aiResult.trait_scores?.vocabulary?.value) || 1, 0), 2);
        
        const rawScore = 1 + contentValue + grammarValue + vocabValue;
        const overallScore = Math.min(Math.round((rawScore / 7) * 90), 90);
        const bands = ['Band 5', 'Band 5', 'Band 6', 'Band 7', 'Band 8', 'Band 9', 'Band 9', 'Band 9'];

        return res.json({
          trait_scores: {
            form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
            content: {
              value: contentValue,
              topic_captured: !!aiResult.trait_scores?.content?.topic_captured,
              pivot_captured: !!aiResult.trait_scores?.content?.pivot_captured,
              conclusion_captured: !!aiResult.trait_scores?.content?.conclusion_captured,
              notes: aiResult.trait_scores?.content?.notes || ''
            },
            grammar: {
              value: grammarValue,
              has_connector: !!aiResult.trait_scores?.grammar?.has_connector,
              connector_used: aiResult.trait_scores?.grammar?.connector_used || '',
              notes: aiResult.trait_scores?.grammar?.notes || ''
            },
            vocabulary: {
              value: vocabValue,
              paraphrase_quality: aiResult.trait_scores?.vocabulary?.paraphrase_quality || 'good',
              synonyms_count: paraAnalysis.synonymSubstitutions,
              notes: aiResult.trait_scores?.vocabulary?.notes || ''
            }
          },
          overall_score: overallScore,
          raw_score: rawScore,
          band: bands[rawScore] || 'Band 5',
          feedback: aiResult.feedback || aiResult.overall_assessment || 'Evaluated',
          paraphrase_analysis: {
            ...paraAnalysis,
            ai_evaluation: aiResult.paraphrase_evaluation || {},
            status: paraAnalysis.hasAdequateParaphrase ? 'MEETS_MINIMUM_4_SYNONYMS' : 'BELOW_MINIMUM_SYNONYMS',
            recommendation: paraAnalysis.hasAdequateParaphrase 
              ? 'Good paraphrasing detected' 
              : `Change at least ${MIN_PARAPHRASE_WORDS - paraAnalysis.synonymSubstitutions} more words to synonyms`
          },
          word_count: formCheck.wordCount,
          scoring_mode: 'ai_with_paraphrase_validation'
        });
        
      } catch (apiError) {
        lastError = apiError;
        if (attempt < MAX_RETRIES - 1) await new Promise(r => setTimeout(r, 1000));
      }
    }

    // Fallback
    res.status(500).json({ error: 'AI scoring failed', message: lastError?.message });

  } catch (error) {
    console.error('Grading error:', error);
    res.status(500).json({ error: 'Internal error', message: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', anthropicConfigured: !!ANTHROPIC_API_KEY, version: '2.3.0' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ PTE Scoring API v2.3.0 on port ${PORT}`);
  console.log(`📝 Paraphrase detection: ${MIN_PARAPHRASE_WORDS}+ synonym minimum`);
  console.log(`🚫 Verbatim threshold: ${(MAX_VERBATIM_RATIO * 100)}%`);
});

module.exports = app;
