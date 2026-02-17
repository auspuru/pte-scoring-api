const express = require('express');
const cors = require('cors');

const app = express();
const PORT = parseInt(process.env.PORT) || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

function validateForm(summary) {
  if (!summary || typeof summary !== 'string') {
    return { wordCount: 0, isValidForm: false, errors: ['Invalid input'] };
  }
  
  const trimmed = summary.trim();
  const words = trimmed.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  
  const errors = [];
  
  if (wordCount < 5) errors.push('Too short (minimum 5 words)');
  if (wordCount > 75) errors.push('Too long (maximum 75 words)');
  
  const sentenceMatches = trimmed.match(/[.!?]+\s+[A-Z]/g);
  if (sentenceMatches && sentenceMatches.length > 0) {
    errors.push('Multiple sentences detected');
  }
  
  if (!/[.!?]$/.test(trimmed)) {
    errors.push('Must end with punctuation');
  }
  
  if (/[\n\r]/.test(summary)) {
    errors.push('Contains line breaks');
  }
  
  if (/^[•\-*\d]\s|^\n\d+\.\s/m.test(summary)) {
    errors.push('Contains bullet points');
  }
  
  const isValidForm = errors.length === 0;
  
  return { wordCount, isValidForm, errors: isValidForm ? [] : errors };
}

// SMART pivot detection - recognizes contrast indicators
function detectPivot(summary, pivotText) {
  const sumLower = summary.toLowerCase();
  const pivotLower = pivotText.toLowerCase();
  
  // Contrast indicators that signal pivot capture
  const contrastWords = ['however', 'although', 'while', 'but', 'yet', 'though', 'despite', 'whereas', 'nevertheless', 'nonetheless'];
  const hasContrastWord = contrastWords.some(w => sumLower.includes(w));
  
  // Extract key concepts from pivot (the "what" of the contrast)
  const pivotKeyTerms = pivotLower
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 4 && !['despite', 'although', 'while', 'however', 'though', 'whereas'].includes(w));
  
  // Check how many pivot key terms appear in summary
  const matches = pivotKeyTerms.filter(term => sumLower.includes(term));
  const matchRatio = pivotKeyTerms.length > 0 ? matches.length / pivotKeyTerms.length : 0;
  
  // PIVOT IS CAPTURED IF:
  // 1. Has contrast word AND key terms from pivot appear
  // 2. OR high percentage of pivot terms appear
  const captured = (hasContrastWord && matches.length >= 2) || matchRatio >= 0.3;
  
  return {
    captured,
    hasContrastWord,
    matches: matches.length,
    total: pivotKeyTerms.length,
    ratio: Math.round(matchRatio * 100)
  };
}

// AI grading for accurate content evaluation
async function gradeWithAI(summary, passage) {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 800,
        temperature: 0,
        system: `You are a PTE Academic examiner. Evaluate summaries for TOPIC-PIVOT-CONCLUSION capture.

CRITICAL RULE FOR PIVOT DETECTION:
The pivot is CAPTURED if the summary includes BOTH:
1. The main topic (reading importance, etc.)
2. The contrasting element (digital media increasing, etc.)

Examples of pivot captured:
- "reading is important while digital media increases" ✓
- "despite digital media, reading remains key" ✓
- "reading helps success, noting digital media rises" ✓
- "importance of reading while also highlighting digital media consumption" ✓

The pivot is NOT captured if only one side is mentioned.

Return JSON only.`,
        messages: [{
          role: 'user',
          content: `PASSAGE: "${passage.text}"

KEY ELEMENTS:
- TOPIC: ${passage.keyElements?.critical}
- PIVOT: ${passage.keyElements?.important}
- CONCLUSION: ${passage.keyElements?.conclusion || passage.keyElements?.supplementary?.[0] || 'N/A'}

STUDENT SUMMARY: "${summary}"

Evaluate and return JSON:
{
  "content": {
    "value": 0-2,
    "topic_captured": true/false,
    "pivot_captured": true/false,
    "conclusion_captured": true/false,
    "notes": "explanation"
  },
  "feedback": "what was good or needs improvement"
}`
        }]
      })
    });

    if (!response.ok) return null;
    
    const data = await response.json();
    const content = data.content?.[0]?.text;
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    
    return JSON.parse(match[0]);
    
  } catch (e) {
    console.error('AI error:', e.message);
    return null;
  }
}

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    version: '7.0.0',
    anthropicConfigured: !!ANTHROPIC_API_KEY
  });
});

app.post('/api/grade', async (req, res) => {
  try {
    const { summary, passage } = req.body;
    
    if (!summary || !passage) {
      return res.status(400).json({ error: 'Missing summary or passage' });
n    }

    const formCheck = validateForm(summary);
    
    if (!formCheck.isValidForm) {
      return res.json({
        trait_scores: {
          form: { value: 0, word_count: formCheck.wordCount, notes: formCheck.errors.join('; ') },
          content: { value: 0, topic_captured: false, pivot_captured: false, conclusion_captured: false, notes: 'Form error' },
          grammar: { value: 0, has_connector: false, notes: 'Form error' },
          vocabulary: { value: 0, notes: 'Form error' }
        },
        overall_score: 0,
        raw_score: 0,
        band: 'Band 5',
        feedback: `Form failed: ${formCheck.errors.join(', ')}`
      });
    }

    // Detect pivot locally first
    const pivotDetection = detectPivot(summary, passage.keyElements?.important || '');
    console.log('Pivot detection:', pivotDetection);

    let contentResult;
    let scoringMode = 'local';

    // Try AI first if available
    if (ANTHROPIC_API_KEY) {
      const aiResult = await gradeWithAI(summary, passage);
      if (aiResult) {
        // Override AI if local shows clear pivot capture
        if (pivotDetection.captured && !aiResult.content?.pivot_captured) {
          aiResult.content.pivot_captured = true;
          aiResult.content.notes = 'Pivot captured (verified)';
        }
        contentResult = aiResult.content;
        scoringMode = 'ai';
      } else {
        // Fallback to local
        contentResult = getLocalResult(summary, passage, pivotDetection);
      }
    } else {
      contentResult = getLocalResult(summary, passage, pivotDetection);
    }

    // Grammar check
    const hasConnector = /\b(however|although|while|but|yet|nevertheless|whereas|despite|though|moreover|furthermore|therefore|thus)\b/i.test(summary);
    const grammarScore = hasConnector ? 2 : 1;

    // Calculate scores
    const rawScore = 1 + contentResult.value + grammarScore + 2;
    const overallScore = Math.min(Math.round((rawScore / 7) * 90), 90);
    const bands = ['Band 5', 'Band 5', 'Band 6', 'Band 7', 'Band 8', 'Band 9', 'Band 9', 'Band 9'];

    res.json({
      trait_scores: {
        form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
        content: {
          value: contentResult.value,
          topic_captured: contentResult.topic_captured,
          pivot_captured: contentResult.pivot_captured,
          conclusion_captured: contentResult.conclusion_captured,
          notes: contentResult.notes
        },
        grammar: { value: grammarScore, has_connector: hasConnector, notes: hasConnector ? 'Connector present' : 'No connector' },
        vocabulary: { value: 2, notes: 'Verbatim and paraphrase accepted' }
      },
      overall_score: overallScore,
      raw_score: rawScore,
      band: bands[rawScore] || 'Band 5',
      feedback: contentResult.value >= 2 ? 'Excellent! All key concepts captured.' : contentResult.value >= 1 ? 'Good coverage, some elements could be clearer.' : 'Key concepts missing.',
      scoring_mode: scoringMode,
      pivot_analysis: pivotDetection
    });
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

function getLocalResult(summary, passage, pivotDetection) {
  const sumLower = summary.toLowerCase();
  
  // Topic check
  const topicText = (passage.keyElements?.critical || '').toLowerCase();
  const topicWords = topicText.split(/\s+/).filter(w => w.length > 4);
  const topicMatches = topicWords.filter(w => sumLower.includes(w));
  const topicCaptured = topicMatches.length >= 2 || topicWords.length === 0;
  
  // Conclusion check
  const conclusionText = (passage.keyElements?.conclusion || passage.keyElements?.supplementary?.[0] || '').toLowerCase();
  const conclusionWords = conclusionText.split(/\s+/).filter(w => w.length > 4);
  const conclusionMatches = conclusionWords.filter(w => sumLower.includes(w));
  const conclusionCaptured = conclusionMatches.length >= 1 || conclusionWords.length === 0;
  
  // Calculate score
  let score = 2;
  if (!topicCaptured) score -= 1;
  if (!pivotDetection.captured) score -= 0.5;
  if (!conclusionCaptured) score -= 0.3;
  
  return {
    value: Math.max(0, Math.round(score)),
    topic_captured: topicCaptured,
    pivot_captured: pivotDetection.captured,
    conclusion_captured: conclusionCaptured,
    notes: `Pivot: ${pivotDetection.ratio}% match, contrast word: ${pivotDetection.hasContrastWord}`
  };
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ PTE Scoring API v7.0.0 on port ${PORT}`);
  console.log(`📝 Smart pivot detection enabled`);
});
