const express = require('express');
const cors = require('cors');

const app = express();
const PORT = parseInt(process.env.PORT) || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

function validateForm(summary) {
  if (!summary || typeof summary !== 'string') {
    return { wordCount: 0, isValidForm: false };
  }
  
  const trimmed = summary.trim();
  const words = trimmed.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  
  const hasMultipleSentences = /[.!?]\s+[A-Z]/.test(trimmed);
  const endsWithPeriod = /[.!?]$/.test(trimmed);
  const hasNewlines = /[\n\r]/.test(summary);
  const hasBullets = /^[•\-*\d]\s|^\n\d+\.\s/m.test(summary);
  
  const isValidForm = wordCount >= 5 && wordCount <= 75 && endsWithPeriod && !hasNewlines && !hasBullets && !hasMultipleSentences;
  
  return { wordCount, isValidForm };
}

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
          form: { value: 0, word_count: formCheck.wordCount, notes: 'Invalid form' },
          content: { value: 0, topic_captured: false, pivot_captured: false, conclusion_captured: false, notes: 'Form error' },
          grammar: { value: 0, has_connector: false, notes: 'Form error' },
          vocabulary: { value: 0, notes: 'Form error' }
        },
        overall_score: 0,
        raw_score: 0,
        band: 'Band 5',
        feedback: 'Form validation failed. Write one sentence (5-75 words).'
      });
    }

    // No API key - local scoring
    if (!ANTHROPIC_API_KEY) {
      const hasConnector = /\b(however|although|while|but|yet|moreover|furthermore|therefore|thus|and|so)\b/i.test(summary);
      
      return res.json({
        trait_scores: {
          form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
          content: { value: 2, topic_captured: true, pivot_captured: true, conclusion_captured: true, notes: 'Local scoring' },
          grammar: { value: hasConnector ? 2 : 1, has_connector: hasConnector, notes: hasConnector ? 'Connector present' : 'No connector' },
          vocabulary: { value: 2, notes: 'Verbatim and paraphrase both accepted' }
        },
        overall_score: hasConnector ? 90 : 77,
        raw_score: hasConnector ? 7 : 6,
        band: hasConnector ? 'Band 9' : 'Band 8',
        feedback: 'Scored locally (AI not configured)'
      });
    }

    // AI scoring
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
          max_tokens: 1000,
          system: `You are a PTE Academic examiner.

SCORING RULES:
1. GIVE FULL SCORES for BOTH verbatim (copied) AND paraphrased responses
2. ONLY DEDUCT SCORES when:
   - Meaning is UNCLEAR or VAGUE
   - Ideas CONTRADICT the passage
   - KEY LINES/IDEAS are MISSING

CONTENT (0-2):
- 2/2: Meaning is clear, no contradictions, key ideas present (verbatim OR paraphrased)
- 1/2: Minor issues - slightly unclear OR missing 1 minor point
- 0/2: Major contradiction, completely unclear, or missing main topic

GRAMMAR (0-2):
- 2/2: Proper sentence with connector (however, although, while, but, etc.)
- 1/2: Grammatically correct but no connector
- 0/2: Grammar errors present

VOCABULARY (0-2): Always 2/2 - PTE allows copying key phrases`,
          messages: [{
            role: 'user',
            content: `PASSAGE: "${passage.text}"

KEY ELEMENTS:
- TOPIC: ${passage.keyElements?.critical || ''}
- PIVOT: ${passage.keyElements?.important || ''}
- CONCLUSION: ${passage.keyElements?.conclusion || passage.keyElements?.supplementary?.[0] || ''}

STUDENT SUMMARY: "${summary}"

Evaluate:
1. Is the meaning CLEAR? (not vague or confusing)
2. Does it CONTRADICT the passage? (wrong facts, reversed relationships)
3. Are KEY IDEAS missing? (main topic, pivot, conclusion)

Return JSON:
{
  "trait_scores": {
    "form": { "value": 1, "word_count": ${formCheck.wordCount}, "notes": "Valid form" },
    "content": { 
      "value": 0-2, 
      "topic_captured": true/false, 
      "pivot_captured": true/false, 
      "conclusion_captured": true/false,
      "notes": "Explain ONLY if: unclear, contradictory, or missing key ideas"
    },
    "grammar": { "value": 0-2, "has_connector": true/false, "notes": "..." },
    "vocabulary": { "value": 2, "notes": "Verbatim and paraphrase both accepted" }
  },
  "feedback": "What was good OR what needs fixing"
}`
          }]
        })
      });

      if (!response.ok) throw new Error(`API error ${response.status}`);
      
      const data = await response.json();
      const aiContent = data.content?.[0]?.text;
      const jsonMatch = aiContent?.match(/\{[\s\S]*\}/);
      
      if (!jsonMatch) throw new Error('No JSON in response');
      
      const aiResult = JSON.parse(jsonMatch[0]);
      
      const contentScore = Math.min(Math.max(Number(aiResult.trait_scores?.content?.value) || 2, 0), 2);
      const grammarScore = Math.min(Math.max(Number(aiResult.trait_scores?.grammar?.value) || 1, 0), 2);
      const rawScore = 1 + contentScore + grammarScore + 2;
      
      const bands = ['Band 5', 'Band 5', 'Band 6', 'Band 7', 'Band 8', 'Band 9', 'Band 9', 'Band 9'];
      
      return res.json({
        trait_scores: {
          form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
          content: {
            value: contentScore,
            topic_captured: aiResult.trait_scores?.content?.topic_captured ?? true,
            pivot_captured: aiResult.trait_scores?.content?.pivot_captured ?? true,
            conclusion_captured: aiResult.trait_scores?.content?.conclusion_captured ?? true,
            notes: aiResult.trait_scores?.content?.notes || 'Key ideas captured'
          },
          grammar: {
            value: grammarScore,
            has_connector: aiResult.trait_scores?.grammar?.has_connector || false,
            notes: aiResult.trait_scores?.grammar?.notes || ''
          },
          vocabulary: { value: 2, notes: 'Verbatim and paraphrase both accepted' }
        },
        overall_score: Math.min(Math.round((rawScore / 7) * 90), 90),
        raw_score: rawScore,
        band: bands[rawScore] || 'Band 5',
        feedback: aiResult.feedback || 'Good summary'
      });
      
    } catch (apiError) {
      // Fallback
      const hasConnector = /\b(however|although|while|but|yet|moreover|furthermore|therefore|thus)\b/i.test(summary);
      
      return res.json({
        trait_scores: {
          form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
          content: { value: 2, topic_captured: true, pivot_captured: true, conclusion_captured: true, notes: 'AI fallback' },
          grammar: { value: hasConnector ? 2 : 1, has_connector: hasConnector, notes: hasConnector ? 'Connector present' : 'No connector' },
          vocabulary: { value: 2, notes: 'Verbatim and paraphrase both accepted' }
        },
        overall_score: hasConnector ? 90 : 77,
        raw_score: hasConnector ? 7 : 6,
        band: hasConnector ? 'Band 9' : 'Band 8',
        feedback: 'AI service error - lenient scoring applied'
      });
    }
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal error', message: error.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    policy: 'verbatim_and_paraphrase_accepted',
    deduct_only_for: ['unclear_meaning', 'contradictions', 'missing_key_ideas']
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server on port ${PORT}`);
  console.log(`Policy: Accept verbatim AND paraphrase`);
  console.log(`Deduct only for: unclear meaning, contradictions, missing key ideas`);
});
