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

// ========== SMART CONCEPT DETECTION ==========

// Extract meaningful content words
function extractContentWords(text) {
  if (!text) return [];
  
  const stopWords = new Set(['this', 'that', 'with', 'from', 'they', 'have', 'been', 'were', 'said', 'each', 'which', 'their', 'time', 'will', 'about', 'than', 'them', 'into', 'just', 'like', 'over', 'also', 'back', 'only', 'know', 'take', 'year', 'good', 'some', 'come', 'make', 'well', 'work', 'life', 'even', 'more', 'very', 'what', 'when', 'much', 'would', 'there', 'could', 'other', 'after', 'first', 'never', 'these', 'think', 'where', 'being', 'every', 'great', 'might', 'shall', 'still', 'those', 'while', 'should', 'really', 'before', 'always', 'another', 'around', 'because', 'through', 'during', 'without', 'against', 'among', 'within', 'upon', 'towards', 'across', 'behind', 'below', 'above', 'under', 'between', 'beyond', 'except', 'despite', 'regarding', 'concerning', 'following', 'including']);
  
  return text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !stopWords.has(w));
}

// Calculate coverage percentage
function calculateCoverage(summary, keyText) {
  if (!keyText || !summary) return { percentage: 0, matches: 0, total: 0 };
  
  const sumLower = summary.toLowerCase();
  const keyWords = extractContentWords(keyText);
  
  if (keyWords.length === 0) return { percentage: 100, matches: 0, total: 0 };
  
  const matches = keyWords.filter(word => sumLower.includes(word));
  const percentage = Math.round((matches.length / keyWords.length) * 100);
  
  return { percentage, matches: matches.length, total: keyWords.length };
}

// ========== SMART TOPIC DETECTION ==========
function detectTopic(summary, topicText) {
  const coverage = calculateCoverage(summary, topicText);
  
  // Topic captured if 20%+ keywords OR contains core subject words
  const captured = coverage.percentage >= 20 || coverage.matches >= 2;
  
  return { captured, coverage };
}

// ========== SMART PIVOT DETECTION ==========
function detectPivot(summary, pivotText) {
  const sumLower = summary.toLowerCase();
  const coverage = calculateCoverage(summary, pivotText);
  
  // Contrast indicators
  const contrastWords = ['however', 'although', 'while', 'but', 'yet', 'though', 'despite', 'whereas', 'nevertheless', 'nonetheless', 'even though', 'in contrast', 'on the other hand', 'conversely', 'meanwhile', 'whereas'];
  const hasContrastWord = contrastWords.some(w => sumLower.includes(w));
  
  // PIVOT captured if:
  // - Has contrast word AND 2+ pivot keywords, OR
  // - 25%+ pivot keyword coverage
  const captured = (hasContrastWord && coverage.matches >= 2) || coverage.percentage >= 25;
  
  return { captured, hasContrastWord, coverage };
}

// ========== SMART CONCLUSION DETECTION ==========
function detectConclusion(summary, conclusionText) {
  if (!conclusionText) return { captured: true, coverage: { percentage: 100 } };
  
  const sumLower = summary.toLowerCase();
  const coverage = calculateCoverage(summary, conclusionText);
  
  // Result/implication indicators
  const resultWords = ['therefore', 'thus', 'hence', 'consequently', 'as a result', 'leading to', 'resulting in', 'so', 'outcome', 'impact', 'effect', 'conclusion'];
  const hasResultWord = resultWords.some(w => sumLower.includes(w));
  
  // CONCLUSION captured if:
  // - 15%+ keywords, OR
  // - Has result word AND 1+ keywords, OR
  // - 2+ keywords from conclusion
  const captured = coverage.percentage >= 15 || 
                   (hasResultWord && coverage.matches >= 1) || 
                   coverage.matches >= 2;
  
  return { captured, hasResultWord, coverage };
}

// ========== AI ENHANCEMENT ==========
async function enhanceWithAI(summary, passage, localResult) {
  if (!ANTHROPIC_API_KEY) return null;
  
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
        max_tokens: 600,
        temperature: 0,
        system: `You validate PTE summary concept detection. Check if TOPIC, PIVOT, and CONCLUSION are captured.

CAPTURED means: the concept appears in the summary (verbatim OR paraphrased).

Return JSON only with validation results.`,
        messages: [{
          role: 'user',
          content: `PASSAGE: "${passage.text}"

KEY ELEMENTS:
- TOPIC: ${passage.keyElements?.critical}
- PIVOT: ${passage.keyElements?.important}
- CONCLUSION: ${passage.keyElements?.conclusion || passage.keyElements?.supplementary?.[0]}

STUDENT SUMMARY: "${summary}"

LOCAL DETECTION:
- Topic: ${localResult.topic.captured ? 'YES' : 'NO'} (${localResult.topic.coverage.percentage}%)
- Pivot: ${localResult.pivot.captured ? 'YES' : 'NO'} (contrast word: ${localResult.pivot.hasContrastWord}, ${localResult.pivot.coverage.percentage}%)
- Conclusion: ${localResult.conclusion.captured ? 'YES' : 'NO'} (${localResult.conclusion.coverage.percentage}%)

Validate and return JSON:
{
  "validation": {
    "topic_correct": true/false,
    "pivot_correct": true/false,
    "conclusion_correct": true/false
  },
  "adjustments": {
    "topic_override": true/false/null,
    "pivot_override": true/false/null,
    "conclusion_override": true/false/null
  }
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

// ========== API ENDPOINTS ==========

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    version: '8.0.0',
    anthropicConfigured: !!ANTHROPIC_API_KEY,
    policy: 'Smart TOPIC-PIVOT-CONCLUSION detection'
  });
});

app.post('/api/grade', async (req, res) => {
  console.log('Grade request received');
  
  try {
    const { summary, passage } = req.body;
    
    if (!summary || !passage) {
      return res.status(400).json({ error: 'Missing summary or passage' });
    }

    // Step 1: Form validation
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
        feedback: `Form validation failed: ${formCheck.errors.join(', ')}`
      });
    }

    // Step 2: Smart concept detection
    const topicResult = detectTopic(summary, passage.keyElements?.critical || '');
    const pivotResult = detectPivot(summary, passage.keyElements?.important || '');
    const conclusionResult = detectConclusion(summary, passage.keyElements?.conclusion || passage.keyElements?.supplementary?.[0]);
    
    console.log('Detection:', {
      topic: `${topicResult.captured} (${topicResult.coverage.percentage}%)`,
      pivot: `${pivotResult.captured} (${pivotResult.coverage.percentage}%)`,
      conclusion: `${conclusionResult.captured} (${conclusionResult.coverage.percentage}%)`
    });

    // Step 3: Optional AI validation
    const aiValidation = await enhanceWithAI(summary, passage, {
      topic: topicResult,
      pivot: pivotResult,
      conclusion: conclusionResult
    });

    // Apply AI overrides if provided
    let topicCaptured = topicResult.captured;
    let pivotCaptured = pivotResult.captured;
    let conclusionCaptured = conclusionResult.captured;
    let scoringMode = 'local';

    if (aiValidation?.adjustments) {
      if (aiValidation.adjustments.topic_override !== null) {
        topicCaptured = aiValidation.adjustments.topic_override;
      }
      if (aiValidation.adjustments.pivot_override !== null) {
        pivotCaptured = aiValidation.adjustments.pivot_override;
      }
      if (aiValidation.adjustments.conclusion_override !== null) {
        conclusionCaptured = aiValidation.adjustments.conclusion_override;
      }
      scoringMode = 'ai_enhanced';
    }

    // Step 4: Calculate content score
    let contentScore = 2;
    if (!topicCaptured) contentScore -= 1;
    if (!pivotCaptured) contentScore -= 0.5;
    if (!conclusionCaptured) contentScore -= 0.3;
    contentScore = Math.max(0, Math.round(contentScore));

    // Step 5: Grammar check
    const connectorPattern = /\b(however|although|while|but|yet|nevertheless|whereas|despite|though|moreover|furthermore|therefore|thus|hence|consequently)\b/i;
    const hasConnector = connectorPattern.test(summary);
    const grammarScore = hasConnector ? 2 : 1;

    // Step 6: Calculate final scores
    const rawScore = 1 + contentScore + grammarScore + 2;
    const overallScore = Math.min(Math.round((rawScore / 7) * 90), 90);
    const bands = ['Band 5', 'Band 5', 'Band 6', 'Band 7', 'Band 8', 'Band 9', 'Band 9', 'Band 9'];

    // Build feedback
    let feedback = '';
    if (contentScore >= 2) {
      feedback = 'Excellent! All key concepts captured.';
    } else if (contentScore === 1) {
      const missing = [];
      if (!topicCaptured) missing.push('topic');
      if (!pivotCaptured) missing.push('pivot');
      if (!conclusionCaptured) missing.push('conclusion');
      feedback = missing.length > 0 
        ? `Good coverage. ${missing.join(', ')} could be clearer.`
        : 'Good coverage. Some elements could be more explicit.';
    } else {
      feedback = 'Key concepts missing. Review the passage and try again.';
    }

    const result = {
      trait_scores: {
        form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
        content: {
          value: contentScore,
          topic_captured: topicCaptured,
          pivot_captured: pivotCaptured,
          conclusion_captured: conclusionCaptured,
          notes: `Topic: ${topicResult.coverage.percentage}% | Pivot: ${pivotResult.coverage.percentage}% | Conclusion: ${conclusionResult.coverage.percentage}%`
        },
        grammar: {
          value: grammarScore,
          has_connector: hasConnector,
          notes: hasConnector ? 'Connector present' : 'No connector'
        },
        vocabulary: { value: 2, notes: 'Verbatim and paraphrase accepted' }
      },
      overall_score: overallScore,
      raw_score: rawScore,
      band: bands[rawScore] || 'Band 5',
      feedback,
      scoring_mode: scoringMode,
      detection_details: {
        topic: {
          captured: topicCaptured,
          coverage: topicResult.coverage.percentage,
          matches: topicResult.coverage.matches
        },
        pivot: {
          captured: pivotCaptured,
          coverage: pivotResult.coverage.percentage,
          has_contrast_word: pivotResult.hasContrastWord,
          matches: pivotResult.coverage.matches
        },
        conclusion: {
          captured: conclusionCaptured,
          coverage: conclusionResult.coverage.percentage,
          has_result_word: conclusionResult.hasResultWord,
          matches: conclusionResult.coverage.matches
        }
      }
    };

    console.log('Result:', JSON.stringify(result, null, 2));
    res.json(result);
    
  } catch (error) {
    console.error('Grading error:', error);
    res.status(500).json({ error: 'Internal error', message: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ PTE Scoring API v8.0.0 on port ${PORT}`);
  console.log(`📝 Smart TOPIC-PIVOT-CONCLUSION detection enabled`);
  console.log(`🤖 AI enhancement: ${ANTHROPIC_API_KEY ? 'Enabled' : 'Disabled'}`);
});
