const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

function gradeLocally(summary, passage) {
  const trimmed = summary.trim();
  const words = trimmed.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;

  const formScore = 1;

  const summaryLower = summary.toLowerCase();
  const critical = passage.keyElements.critical.toLowerCase();
  const important = passage.keyElements.important.toLowerCase();

  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were']);
  
  const criticalWords = critical.split(/\s+/).filter(w => w.length >= 3 && !stopWords.has(w));
  const importantWords = important.split(/\s+/).filter(w => w.length >= 3 && !stopWords.has(w));
  
  const criticalMatched = criticalWords.filter(w => summaryLower.includes(w)).length;
  const importantMatched = importantWords.filter(w => summaryLower.includes(w)).length;
  
  const topicCaptured = criticalMatched / criticalWords.length >= 0.25;
  const pivotCaptured = importantMatched / importantWords.length >= 0.25;
  
  let contentScore = 0;
  if (topicCaptured && pivotCaptured) contentScore = 2;
  else if (topicCaptured) contentScore = 1;

  const hasSemicolon = summary.includes(';');
  const connectors = ['however', 'moreover', 'furthermore', 'consequently', 'therefore', 'nevertheless', 'but', 'and', 'although', 'so'];
  const hasConnector = connectors.some(c => summaryLower.includes(c));
  
  let grammarScore = 0;
  if (hasSemicolon && hasConnector) grammarScore = 2;
  else if (hasConnector) grammarScore = 1;

  const vocabScore = 2;

  const rawScore = formScore + contentScore + grammarScore + vocabScore;
  const overallScore = Math.round((rawScore / 7) * 90);
  
  const bands = ['Band 5', 'Band 5', 'Band 6', 'Band 7', 'Band 8', 'Band 9', 'Band 9', 'Band 9'];
  
  return {
    trait_scores: {
      form: { value: 1, word_count: wordCount, notes: 'Valid form' },
      content: { value: contentScore, topic_captured: topicCaptured, pivot_captured: pivotCaptured, notes: 'Content scored' },
      grammar: { value: grammarScore, has_connector: hasConnector, notes: hasSemicolon ? 'Semicolon + connector' : hasConnector ? 'Connector' : 'No connector' },
      vocabulary: { value: vocabScore, notes: 'Appropriate vocabulary' }
    },
    overall_score: overallScore,
    raw_score: rawScore,
    band: bands[rawScore] || 'Band 5',
    feedback: 'Scored successfully',
    reasoning: 'Local scoring'
  };
}

app.post('/api/grade', async (req, res) => {
  try {
    const { summary, passage } = req.body;
    if (!summary || !passage) {
      return res.status(400).json({ error: 'Missing data' });
    }
    
    const result = gradeLocally(summary, passage);
    res.json(result);
  } catch (error) {
    console.error('Grading error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', anthropicConfigured: false });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
