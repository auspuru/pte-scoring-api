const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    anthropicConfigured: !!ANTHROPIC_API_KEY,
    localScoring: true
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'PTE Scoring API', 
    anthropic: !!ANTHROPIC_API_KEY,
    localFallback: true
  });
});

// Form validation helper
function validateForm(summary) {
  const trimmed = summary.trim();
  const words = trimmed.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  
  // Check for multiple sentences
  const sentenceMatches = trimmed.match(/[.!?]+\s+[A-Z]/g);
  const sentenceCount = sentenceMatches ? sentenceMatches.length + 1 : 1;
  
  const endsWithPeriod = /[.!?]$/.test(trimmed);
  const hasNewlines = /[\n\r]/.test(summary);
  const hasBullets = /[•\\-*]/.test(summary);
  
  const isValidForm = wordCount >= 5 && wordCount <= 75 && endsWithPeriod && !hasNewlines && !hasBullets && sentenceCount === 1;
  
  return {
    wordCount,
    sentenceCount,
    endsWithPeriod,
    hasNewlines,
    hasBullets,
    isValidForm
  };
}

// Grade endpoint
app.post('/api/grade', async (req, res) => {
  try {
    const { summary, passage } = req.body;
    
    if (!summary || !passage) {
      return res.status(400).json({ error: 'Missing summary or passage' });
    }

    // Form validation
    const formCheck = validateForm(summary);
    console.log('Form validation:', formCheck);

    // If form is invalid, return 0 score immediately
    if (!formCheck.isValidForm) {
      return res.json({
        trait_scores: {
          form: { 
            value: 0, 
            word_count: formCheck.wordCount, 
            notes: formCheck.wordCount < 5 ? 'Too short (min 5 words)' : 
                   formCheck.wordCount > 75 ? 'Too long (max 75 words)' :
                   formCheck.sentenceCount > 1 ? 'Multiple sentences detected' :
                   !formCheck.endsWithPeriod ? 'Must end with punctuation' : 'Invalid form'
          },
          content: { value: 0, topic_captured: false, pivot_captured: false, notes: 'Form error - content not scored' },
          grammar: { value: 0, has_connector: false, notes: 'Form error - grammar not scored' },
          vocabulary: { value: 0, notes: 'Form error - vocabulary not scored' }
        },
        overall_score: 0,
        raw_score: 0,
        band: 'Band 5',
        feedback: 'Form validation failed. Please write one sentence (5-75 words) ending with a period.',
        reasoning: 'Form invalid'
      });
    }

    // If no Anthropic key, use local scoring
    if (!ANTHROPIC_API_KEY) {
      const summaryLower = summary.toLowerCase();
      const connectors = ['however', 'although', 'while', 'but', 'yet', 'nevertheless', 'whereas', 'despite', 'though', 'moreover', 'furthermore'];
      const hasConnector = connectors.some(c => summaryLower.includes(c));
      
      return res.json({
        trait_scores: {
          form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
n          content: { value: 2, topic_captured: true, pivot_captured: true, notes: 'Local scoring - lenient' },
          grammar: { value: hasConnector ? 2 : 1, has_connector: hasConnector, notes: hasConnector ? 'Connector detected' : 'No connector' },
          vocabulary: { value: 2, notes: 'Appropriate vocabulary' }
        },
        overall_score: hasConnector ? 90 : 77,
        raw_score: hasConnector ? 7 : 6,
        band: hasConnector ? 'Band 9' : 'Band 8',
        feedback: 'Scored locally',
        reasoning: 'Local scoring'
      });
    }

    // Use Anthropic for accurate content analysis
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
          system: `You are a PTE Academic examiner. Score based on TOPIC-PIVOT-CONCLUSION structure:

**FORM (0 or 1):** Already validated. Always return 1.

**CONTENT (0, 1, or 2):** 
- 2/2: TOPIC captured + PIVOT/contrast accurately represented
- 1/2: TOPIC mentioned but PIVOT missing, distorted, or nuance changed
- 0/2: TOPIC completely wrong or missing

**GRAMMAR (0, 1, or 2):**
- 2/2: Proper sentence with connector (however, although, while, but, etc.)
- 1/2: Grammatically correct but no connector
- 0/2: Grammar errors

**VOCABULARY (0, 1, or 2):**
- 2/2: Appropriate word choices (copying allowed)
- 1/2: Some awkward choices
- 0/2: Inappropriate vocabulary

CRITICAL: If the summary changes the MEANING of the pivot/contrast, deduct content points!`,
          messages: [{
            role: 'user',
            content: `ORIGINAL PASSAGE:
"""${passage.text}"""

STRUCTURE TO EVALUATE:
- TOPIC (Critical): ${passage.keyElements.critical}
- PIVOT (Important contrast): ${passage.keyElements.important}
- SUPPLEMENTARY: ${passage.keyElements.supplementary.join(', ')}

STUDENT SUMMARY:
"""${summary}"""

Evaluate: Does the summary capture the TOPIC and accurately represent the PIVOT/contrast?

Return ONLY this JSON:
{
  "trait_scores": {
    "form": { "value": 1, "word_count": ${formCheck.wordCount}, "notes": "Valid form" },
    "content": { 
      "value": 0-2, 
      "topic_captured": true/false, 
      "pivot_captured": true/false, 
      "notes": "Did it capture topic? Did it preserve the pivot/contrast accurately?" 
    },
    "grammar": { 
      "value": 0-2, 
      "has_connector": true/false, 
      "notes": "Connector usage assessment" 
    },
    "vocabulary": { 
      "value": 0-2, 
      "notes": "Vocabulary assessment" 
    }
  },
  "feedback": "What was captured well and what needs improvement"
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

      // Parse JSON from AI response
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in AI response');
      }
      
      let aiResult;
      try {
        aiResult = JSON.parse(jsonMatch[0]);
      } catch (e) {
        throw new Error('JSON parse error');
      }
      
      // Ensure structure exists with defaults
      const traitScores = {
        form: { 
          value: 1, 
          word_count: formCheck.wordCount, 
          notes: 'Valid form' 
        },
        content: {
          value: Math.min(Math.max(Number(aiResult.trait_scores?.content?.value) || 0, 0), 2),
          topic_captured: aiResult.trait_scores?.content?.topic_captured || false,
          pivot_captured: aiResult.trait_scores?.content?.pivot_captured || false,
          notes: aiResult.trait_scores?.content?.notes || 'Content assessment'
        },
        grammar: {
          value: Math.min(Math.max(Number(aiResult.trait_scores?.grammar?.value) || 1, 0), 2),
          has_connector: aiResult.trait_scores?.grammar?.has_connector || false,
          notes: aiResult.trait_scores?.grammar?.notes || 'Grammar assessment'
        },
        vocabulary: {
          value: Math.min(Math.max(Number(aiResult.trait_scores?.vocabulary?.value) || 2, 0), 2),
          notes: aiResult.trait_scores?.vocabulary?.notes || 'Vocabulary assessment'
        }
      };
      
      // Calculate scores
      const rawScore = traitScores.form.value + traitScores.content.value + traitScores.grammar.value + traitScores.vocabulary.value;
      const overallScore = Math.min(Math.round((rawScore / 7) * 90), 90);
      
      // Band mapping
      const bands = ['Band 5', 'Band 5', 'Band 6', 'Band 7', 'Band 8', 'Band 9', 'Band 9', 'Band 9'];
      const band = bands[rawScore] || 'Band 5';
      
      const result = {
        trait_scores: traitScores,
        overall_score: overallScore,
        raw_score: rawScore,
        band: band,
        feedback: aiResult.feedback || 'Summary evaluated',
        reasoning: 'AI scoring'
      };
      
      console.log('AI Scoring Result:', JSON.stringify(result, null, 2));
      
      res.json(result);
      
    } catch (apiError) {
      console.error('AI API error:', apiError.message);
      
      // Fallback to lenient local scoring
      const summaryLower = summary.toLowerCase();
      const connectors = ['however', 'although', 'while', 'but', 'yet', 'nevertheless', 'whereas', 'despite', 'though', 'moreover', 'furthermore'];
      const hasConnector = connectors.some(c => summaryLower.includes(c));
      
      res.json({
        trait_scores: {
          form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
          content: { value: 2, topic_captured: true, pivot_captured: true, notes: 'AI error - lenient fallback' },
          grammar: { value: hasConnector ? 2 : 1, has_connector: hasConnector, notes: hasConnector ? 'Connector detected' : 'No connector' },
          vocabulary: { value: 2, notes: 'Appropriate vocabulary' }
        },
        overall_score: hasConnector ? 90 : 77,
        raw_score: hasConnector ? 7 : 6,
        band: hasConnector ? 'Band 9' : 'Band 8',
        feedback: 'AI service error - lenient scoring applied',
        reasoning: 'Fallback'
      });
    }
  } catch (error) {
    console.error('Grading error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server on port ${PORT}, Anthropic: ${!!ANTHROPIC_API_KEY}`);
});
