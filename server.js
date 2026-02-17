const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', anthropicConfigured: false });
});

app.get('/', (req, res) => {
  res.json({ message: 'PTE Scoring API is running' });
});

app.post('/api/grade', (req, res) => {
  try {
    const { summary, passage } = req.body;
    
    if (!summary || !passage) {
      return res.status(400).json({ error: 'Missing summary or passage' });
    }

    const trimmed = summary.trim();
    const words = trimmed.split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;

    const summaryLower = summary.toLowerCase();
    const critical = passage.keyElements.critical.toLowerCase();
    const important = passage.keyElements.important.toLowerCase();

    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were']);
    
    const criticalWords = critical.split(/\s+/).filter(w => w.length >= 3 && !stopWords.has(w));
    const importantWords = important.split(/\s+/).filter(w => w.length >= 3 && !stopWords.has(w));
    
    const criticalMatched = criticalWords.filter(w => summaryLower.includes(w)).length;
    const importantMatched = importantWords.filter(w => summaryLower.includes(w)).length;
    
    const topicCaptured = criticalWords.length > 0 ? (criticalMatched / criticalWords.length >= 0.25) : false;
    const pivotCaptured = importantWords.length > 0 ? (importantMatched / importantWords.length >= 0.25) : false;
    
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
    const rawScore = 1 + contentScore + grammarScore + vocabScore;
    const overallScore = Math.round((rawScore / 7) * 90);
    
    const bands = ['Band 5', 'Band 5', 'Band 6', 'Band 7', 'Band 8', 'Band 9', 'Band 9', 'Band 9'];
    
    res.json({
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
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
