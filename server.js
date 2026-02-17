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

function extractKeywords(text) {
  if (!text) return [];
  
  const stopWords = new Set(['this', 'that', 'with', 'from', 'they', 'have', 'been', 'were', 'said', 'each', 'which', 'their', 'time', 'will', 'about', 'than', 'them', 'into', 'just', 'like', 'over', 'also', 'back', 'only', 'know', 'take', 'year', 'good', 'some', 'come', 'make', 'well', 'work', 'life', 'even', 'more', 'very', 'what', 'when', 'much', 'would', 'there', 'could', 'other', 'after', 'first', 'never', 'these', 'think', 'where', 'being', 'every', 'great', 'might', 'shall', 'still', 'those', 'while', 'should', 'really', 'before', 'always', 'another', 'around', 'because', 'through', 'during', 'without', 'against', 'among', 'within', 'upon', 'towards', 'across', 'behind', 'below', 'above', 'under', 'between', 'beyond', 'except', 'despite', 'regarding', 'concerning', 'following', 'including', 'according', 'depending']);
  
  return text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length >= 4 && !stopWords.has(w));
}

function calculateCoverage(summary, keyText) {
  if (!keyText || !summary) return { percentage: 0, matches: 0, total: 0 };
  
  const sumLower = summary.toLowerCase();
  const keyWords = extractKeywords(keyText);
  
  if (keyWords.length === 0) return { percentage: 100, matches: 0, total: 0 };
  
  const matches = keyWords.filter(word => sumLower.includes(word));
  const percentage = Math.round((matches.length / keyWords.length) * 100);
  
  return { percentage, matches: matches.length, total: keyWords.length };
}

function detectConceptsUniversal(summary, passage) {
  const sumLower = summary.toLowerCase();
  
  const topicText = passage.keyElements?.critical || '';
  const pivotText = passage.keyElements?.important || '';
  const conclusionText = passage.keyElements?.conclusion || passage.keyElements?.supplementary?.[0] || '';
  
  // TOPIC
  const topicCoverage = calculateCoverage(summary, topicText);
  const topicCaptured = topicCoverage.percentage >= 20;
  
  // PIVOT (UNIVERSAL)
  const pivotCoverage = calculateCoverage(summary, pivotText);
  
  const contrastIndicators = ['however', 'although', 'while', 'but', 'yet', 'though', 'despite', 'whereas', 'nevertheless', 'nonetheless', 'even though', 'in contrast', 'on the other hand', 'conversely', 'meanwhile'];
  const hasContrastIndicator = contrastIndicators.some(ind => sumLower.includes(ind));
  
  const pivotKeywords = extractKeywords(pivotText);
  const pivotInSummary = pivotKeywords.filter(kw => sumLower.includes(kw));
  
  // PIVOT CAPTURED if: (contrast indicator + 2+ keywords) OR (25%+ coverage)
  const pivotCaptured = (hasContrastIndicator && pivotInSummary.length >= 2) || 
                        pivotCoverage.percentage >= 25;
  
  // CONCLUSION
  const conclusionCoverage = calculateCoverage(summary, conclusionText);
  const conclusionCaptured = !conclusionText || conclusionCoverage.percentage >= 15;
  
  // CONTRADICTIONS
  const contradictions = [];
  const passageLower = (passage.text || '').toLowerCase();
  
  const oppositePairs = [
    ['increasing', 'decreasing'],
    ['growing', 'declining'],
    ['rising', 'falling'],
    ['more', 'less'],
    ['higher', 'lower'],
    ['better', 'worse'],
    ['success', 'failure']
  ];
  
  for (const [pos, neg] of oppositePairs) {
    if (passageLower.includes(pos) && sumLower.includes(neg) && !sumLower.includes(pos)) {
      contradictions.push(`Opposite: ${pos} vs ${neg}`);
    }
  }
  
  return {
    topic: { captured: topicCaptured, coverage: topicCoverage },
    pivot: { captured: pivotCaptured, coverage: pivotCoverage, hasContrastIndicator, pivotKeywordsFound: pivotInSummary.length },
    conclusion: { captured: conclusionCaptured, coverage: conclusionCoverage },
    contradictions
  };
}

function calculateScore(detection) {
  let score = 2;
  if (!detection.topic.captured) score -= 1;
  if (!detection.pivot.captured) score -= 0.5;
  if (!detection.conclusion.captured) score -= 0.3;
  if (detection.contradictions.length > 0) score -= 0.5;
  return Math.max(0, Math.round(score));
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '5.0.0', anthropicConfigured: !!ANTHROPIC_API_KEY });
});

app.post('/api/grade', async (req, res) => {
  try {
    const { summary, passage } = req.body;
    
    if (!summary || !passage) {
      return res.status(400).json({ error: 'Missing summary or passage' });
    }

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
        feedback: `Form validation failed: ${formCheck.errors.join(', ')}`,
        scoring_mode: 'local'
      });
    }

    const detection = detectConceptsUniversal(summary, passage);
    const contentScore = calculateScore(detection);
    
    const connectorPattern = /\b(however|although|while|but|yet|nevertheless|whereas|despite|though|moreover|furthermore|therefore|thus|hence|consequently)\b/i;
    const hasConnector = connectorPattern.test(summary);
    const grammarScore = hasConnector ? 2 : 1;
    
    const rawScore = 1 + contentScore + grammarScore + 2;
    const overallScore = Math.min(Math.round((rawScore / 7) * 90), 90);
    const bands = ['Band 5', 'Band 5', 'Band 6', 'Band 7', 'Band 8', 'Band 9', 'Band 9', 'Band 9'];
    
    let feedback = '';
    if (detection.contradictions.length > 0) {
      feedback = `Issue: ${detection.contradictions[0]}`;
    } else if (contentScore >= 2) {
      feedback = 'Excellent! All key concepts captured.';
    } else if (contentScore === 1) {
      feedback = detection.pivot.captured ? 'Good coverage. Some elements could be clearer.' : 'Good topic coverage. Pivot/contrast could be clearer.';
    } else {
      feedback = 'Key concepts missing. Review the passage and try again.';
    }
    
    res.json({
      trait_scores: {
        form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
        content: {
          value: contentScore,
          topic_captured: detection.topic.captured,
          pivot_captured: detection.pivot.captured,
          conclusion_captured: detection.conclusion.captured,
          notes: detection.contradictions.length > 0 ? detection.contradictions.join(', ') : `Topic: ${detection.topic.coverage.percentage}% | Pivot: ${detection.pivot.coverage.percentage}%`
        },
        grammar: { value: grammarScore, has_connector: hasConnector, notes: hasConnector ? 'Connector present' : 'No connector' },
        vocabulary: { value: 2, notes: 'Verbatim and paraphrase accepted' }
      },
      overall_score: overallScore,
      raw_score: rawScore,
      band: bands[rawScore] || 'Band 5',
      feedback,
      scoring_mode: 'local',
      detection: {
        topic_coverage: detection.topic.coverage.percentage,
        pivot_coverage: detection.pivot.coverage.percentage,
        has_contrast_indicator: detection.pivot.hasContrastIndicator,
        pivot_keywords_found: detection.pivot.pivotKeywordsFound
      }
    });
    
  } catch (error) {
    console.error('Grading error:', error);
    res.status(500).json({ error: 'Internal error', message: error.message });
n  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ PTE Scoring API v5.0.0 on port ${PORT}`);
});
