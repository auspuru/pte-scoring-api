const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    anthropicConfigured: !!ANTHROPIC_API_KEY,
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'PTE Scoring API', 
    version: '1.0.0',
    endpoints: ['/api/health', '/api/grade']
  });
});

// Form validation helper
function validateForm(summary) {
  if (!summary || typeof summary !== 'string') {
    return { wordCount: 0, sentenceCount: 0, endsWithPeriod: false, hasNewlines: false, hasBullets: false, isValidForm: false };
  }
  
  const trimmed = summary.trim();
  const words = trimmed.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  
  const sentenceMatches = trimmed.match(/[.!?]+\s+[A-Z]/g);
  const sentenceCount = sentenceMatches ? sentenceMatches.length + 1 : 1;
  
  const endsWithPeriod = /[.!?]$/.test(trimmed);
  const hasNewlines = /[\n\r]/.test(summary);
  const hasBullets = /[•\-*]/.test(summary);
  
  const isValidForm = wordCount >= 5 && wordCount <= 75 && endsWithPeriod && !hasNewlines && !hasBullets && sentenceCount === 1;
  
  return { wordCount, sentenceCount, endsWithPeriod, hasNewlines, hasBullets, isValidForm };
}

// Grade endpoint
app.post('/api/grade', async (req, res) => {
  console.log('Grade request received');
  
  try {
    const { summary, passage } = req.body;
    
    if (!summary || !passage) {
      return res.status(400).json({ error: 'Missing summary or passage' });
    }

    const formCheck = validateForm(summary);
    console.log('Form check:', JSON.stringify(formCheck));

    // Invalid form = 0 score
    if (!formCheck.isValidForm) {
      const formNotes = formCheck.wordCount < 5 ? 'Too short (min 5 words)' : 
                        formCheck.wordCount > 75 ? 'Too long (max 75 words)' :
                        formCheck.sentenceCount > 1 ? 'Multiple sentences detected' :
                        !formCheck.endsWithPeriod ? 'Must end with punctuation' : 'Invalid form';
      
      return res.json({
        trait_scores: {
          form: { value: 0, word_count: formCheck.wordCount, notes: formNotes },
          content: { value: 0, topic_captured: false, pivot_captured: false, notes: 'Form error' },
          grammar: { value: 0, has_connector: false, notes: 'Form error' },
n          vocabulary: { value: 0, notes: 'Form error' }
        },
        overall_score: 0,
        raw_score: 0,
        band: 'Band 5',
        feedback: 'Form validation failed. Write one sentence (5-75 words) ending with a period.',
        reasoning: 'Form invalid'
      });
    }

    // No Anthropic key - local scoring
    if (!ANTHROPIC_API_KEY) {
      const summaryLower = summary.toLowerCase();
      const connectors = ['however', 'although', 'while', 'but', 'yet', 'nevertheless', 'whereas', 'despite', 'though', 'moreover', 'furthermore'];
      const hasConnector = connectors.some(c => summaryLower.includes(c));
      
      const rawScore = hasConnector ? 7 : 6;
      const overallScore = Math.min(Math.round((rawScore / 7) * 90), 90);
      
      return res.json({
        trait_scores: {
          form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
          content: { value: 2, topic_captured: true, pivot_captured: true, notes: 'Local scoring' },
          grammar: { value: hasConnector ? 2 : 1, has_connector: hasConnector, notes: hasConnector ? 'Connector detected' : 'No connector' },
          vocabulary: { value: 2, notes: 'Appropriate vocabulary' }
        },
        overall_score: overallScore,
        raw_score: rawScore,
        band: hasConnector ? 'Band 9' : 'Band 8',
        feedback: 'Scored locally (AI not configured)',
        reasoning: 'Local scoring'
      });
    }

    // Anthropic AI scoring
    console.log('Calling Anthropic API...');
    
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
          max_tokens: 1500,
          system: `You are a PTE Academic examiner. Score based on TOPIC-PIVOT structure:

FORM (0 or 1): Already validated. Return 1.

CONTENT (0, 1, or 2):
- 2/2: TOPIC captured + PIVOT accurately represented
- 1/2: TOPIC mentioned but PIVOT missing or distorted
- 0/2: TOPIC completely wrong

GRAMMAR (0, 1, or 2): 2 with connector, 1 without, 0 with errors
VOCABULARY (0, 1, or 2): 2 appropriate, 1 awkward, 0 inappropriate

If pivot meaning is changed, deduct content points!`,
          messages: [{
            role: 'user',
            content: `PASSAGE: "${passage.text}"

TOPIC: ${passage.keyElements.critical}
PIVOT: ${passage.keyElements.important}

SUMMARY: "${summary}"

Return JSON only:
{
  "trait_scores": {
    "form": { "value": 1, "word_count": ${formCheck.wordCount}, "notes": "Valid form" },
    "content": { "value": 0-2, "topic_captured": true/false, "pivot_captured": true/false, "notes": "..." },
    "grammar": { "value": 0-2, "has_connector": true/false, "notes": "..." },
    "vocabulary": { "value": 0-2, "notes": "..." }
  },
  "feedback": "..."
}`
          }]
        })
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      const aiContent = data.content?.[0]?.text;
      
      if (!aiContent) {
        throw new Error('Empty AI response');
      }

      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found');
      }
      
      const aiResult = JSON.parse(jsonMatch[0]);
      
      const contentValue = Math.min(Math.max(Number(aiResult.trait_scores?.content?.value) || 1, 0), 2);
      const grammarValue = Math.min(Math.max(Number(aiResult.trait_scores?.grammar?.value) || 1, 0), 2);
      const vocabValue = Math.min(Math.max(Number(aiResult.trait_scores?.vocabulary?.value) || 2, 0), 2);
      
      const rawScore = 1 + contentValue + grammarValue + vocabValue;
      const overallScore = Math.min(Math.round((rawScore / 7) * 90), 90);
      
      const bands = ['Band 5', 'Band 5', 'Band 6', 'Band 7', 'Band 8', 'Band 9', 'Band 9', 'Band 9'];
      
      return res.json({
        trait_scores: {
          form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
          content: {
            value: contentValue,
            topic_captured: aiResult.trait_scores?.content?.topic_captured || false,
            pivot_captured: aiResult.trait_scores?.content?.pivot_captured || false,
            notes: aiResult.trait_scores?.content?.notes || 'Content assessed'
          },
          grammar: {
            value: grammarValue,
            has_connector: aiResult.trait_scores?.grammar?.has_connector || false,
            notes: aiResult.trait_scores?.grammar?.notes || 'Grammar assessed'
          },
          vocabulary: {
            value: vocabValue,
            notes: aiResult.trait_scores?.vocabulary?.notes || 'Vocabulary assessed'
          }
        },
        overall_score: overallScore,
        raw_score: rawScore,
        band: bands[rawScore] || 'Band 5',
        feedback: aiResult.feedback || 'Summary evaluated',
        reasoning: 'AI scoring'
      });
      
    } catch (apiError) {
      console.error('AI error:', apiError.message);
      
      // Fallback
      const summaryLower = summary.toLowerCase();
      const connectors = ['however', 'although', 'while', 'but', 'yet', 'nevertheless', 'whereas', 'despite', 'though', 'moreover', 'furthermore'];
      const hasConnector = connectors.some(c => summaryLower.includes(c));
      
      const rawScore = hasConnector ? 7 : 6;
      
      return res.json({
        trait_scores: {
          form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
          content: { value: 2, topic_captured: true, pivot_captured: true, notes: 'AI error - fallback' },
          grammar: { value: hasConnector ? 2 : 1, has_connector: hasConnector, notes: hasConnector ? 'Connector detected' : 'No connector' },
          vocabulary: { value: 2, notes: 'Appropriate vocabulary' }
        },
        overall_score: Math.min(Math.round((rawScore / 7) * 90), 90),
        raw_score: rawScore,
        band: hasConnector ? 'Band 9' : 'Band 8',
        feedback: 'AI service error - lenient scoring applied',
        reasoning: 'Fallback'
      });
    }
  } catch (error) {
    console.error('Grading error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
n});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Anthropic configured: ${!!ANTHROPIC_API_KEY}`);
});
