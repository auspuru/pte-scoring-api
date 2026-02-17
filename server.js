const express = require('express');
const cors = require('cors');

const app = express();
const PORT = parseInt(process.env.PORT) || 3001;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Polyfill fetch for Node < 18
const fetch = global.fetch || require('node-fetch');

// Constants
const MAX_RETRIES = 2;
const REQUEST_TIMEOUT = 30000; // 30 seconds
const CONNECTORS = ['however', 'although', 'while', 'but', 'yet', 'nevertheless', 'whereas', 'despite', 'though', 'moreover', 'furthermore', 'therefore', 'thus', 'hence', 'consequently'];

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
    timestamp: new Date().toISOString(),
    anthropicConfigured: !!ANTHROPIC_API_KEY,
    nodeVersion: process.version
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'PTE Scoring API', 
    version: '2.1.0',
    endpoints: ['/api/health', '/api/grade']
  });
});

// Form validation helper
function validateForm(summary) {
  if (!summary || typeof summary !== 'string') {
    return { wordCount: 0, isValidForm: false, error: 'Summary must be a string' };
  }
  
  const trimmed = summary.trim();
  const words = trimmed.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  
  // More accurate sentence counting
  const sentenceMatches = trimmed.match(/[.!?]+(?:\s+|$)/g);
  const sentenceCount = sentenceMatches ? sentenceMatches.length : 0;
  
  const endsWithPeriod = /[.!?]$/.test(trimmed);
  const hasNewlines = /[\n\r]/.test(summary);
  const hasBullets = /^[•\-*\d]\s|^\d+\.\s/m.test(summary);
  
  const isValidForm = wordCount >= 5 && 
                      wordCount <= 75 && 
                      endsWithPeriod && 
                      !hasNewlines && 
                      !hasBullets && 
                      sentenceCount === 1;
  
  return { 
    wordCount, 
    isValidForm, 
    sentenceCount,
    details: { endsWithPeriod, hasNewlines, hasBullets }
  };
}

// Safe JSON extractor from AI response
function extractJSON(text) {
  if (!text) return null;
  
  // Try to find JSON in code blocks first
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch (e) {
      // Continue to other methods
    }
  }
  
  // Find JSON object in text
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      return null;
    }
  }
  
  return null;
}

// Fallback scoring when AI fails
function getFallbackScoring(summary, formCheck) {
  const summaryLower = summary.toLowerCase();
  const hasConnector = CONNECTORS.some(c => summaryLower.includes(c));
  
  return {
    trait_scores: {
      form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
      content: { value: 2, topic_captured: true, pivot_captured: true, conclusion_captured: true, notes: 'AI error - fallback scoring' },
      grammar: { value: hasConnector ? 2 : 1, has_connector: hasConnector, notes: hasConnector ? 'Connector detected' : 'No connector' },
      vocabulary: { value: 2, notes: 'Appropriate vocabulary' }
    },
    overall_score: hasConnector ? 90 : 77,
    raw_score: hasConnector ? 7 : 6,
    band: hasConnector ? 'Band 9' : 'Band 8',
    feedback: 'AI service error - lenient scoring applied',
    reasoning: 'Fallback'
  };
}

// Safe passage validator
function validatePassage(passage) {
  if (!passage || typeof passage !== 'object') {
    return { valid: false, error: 'Passage must be an object' };
  }
  
  if (!passage.text || typeof passage.text !== 'string') {
    return { valid: false, error: 'Passage text is required' };
  }
  
  if (!passage.keyElements || typeof passage.keyElements !== 'object') {
    return { valid: false, error: 'Passage keyElements are required' };
  }
  
  return { 
    valid: true,
    text: passage.text,
    critical: passage.keyElements.critical || 'N/A',
    important: passage.keyElements.important || 'N/A',
    conclusion: passage.keyElements.conclusion || passage.keyElements.supplementary?.[0] || 'N/A'
  };
}

// Fetch with timeout wrapper
async function fetchWithTimeout(url, options, timeout = REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw error;
  }
}

// Grade endpoint
app.post('/api/grade', async (req, res) => {
  try {
    const { summary, passage } = req.body;
    
    // Input validation
    if (!summary || !passage) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        details: { summary: !!summary, passage: !!passage }
      });
    }

    const formCheck = validateForm(summary);
    
    // Invalid form = 0 score
    if (!formCheck.isValidForm) {
      return res.status(400).json({
        trait_scores: {
          form: { value: 0, word_count: formCheck.wordCount, notes: `Invalid form: ${formCheck.sentenceCount} sentences detected` },
          content: { value: 0, topic_captured: false, pivot_captured: false, conclusion_captured: false, notes: 'Form error' },
          grammar: { value: 0, has_connector: false, notes: 'Form error' },
          vocabulary: { value: 0, notes: 'Form error' }
        },
        overall_score: 0,
        raw_score: 0,
        band: 'Band 5',
        feedback: `Form validation failed. Write one sentence (5-75 words) ending with a period. Current: ${formCheck.wordCount} words, ${formCheck.sentenceCount} sentences.`,
        reasoning: 'Form invalid'
      });
    }

    const passageCheck = validatePassage(passage);
    if (!passageCheck.valid) {
      return res.status(400).json({
        error: 'Invalid passage structure',
        details: passageCheck.error
      });
    }

    // No Anthropic key - local scoring
    if (!ANTHROPIC_API_KEY) {
      console.log('No API key configured, using local scoring');
      const summaryLower = summary.toLowerCase();
      const hasConnector = CONNECTORS.some(c => summaryLower.includes(c));
      
      return res.json({
        trait_scores: {
          form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
          content: { value: 2, topic_captured: true, pivot_captured: true, conclusion_captured: true, notes: 'Local scoring' },
          grammar: { value: hasConnector ? 2 : 1, has_connector: hasConnector, notes: hasConnector ? 'Connector detected' : 'No connector' },
          vocabulary: { value: 2, notes: 'Appropriate vocabulary' }
        },
        overall_score: hasConnector ? 90 : 77,
        raw_score: hasConnector ? 7 : 6,
        band: hasConnector ? 'Band 9' : 'Band 8',
        feedback: 'Scored locally (AI not configured)',
        reasoning: 'Local scoring'
      });
    }

    // Anthropic AI scoring with retry logic
    let lastError = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await fetchWithTimeout(
          'https://api.anthropic.com/v1/messages', // FIXED: removed trailing space
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
              model: 'claude-3-haiku-20240307',
              max_tokens: 1500,
              temperature: 0.1, // Added for consistent outputs
              system: `You are a PTE Academic examiner. Score based on TOPIC-PIVOT-CONCLUSION structure:

FORM (0 or 1): Already validated. Return 1.

CONTENT (0, 1, or 2):
- 2/2: TOPIC captured + PIVOT accurately represented + CONCLUSION included
- 1/2: TOPIC mentioned but PIVOT or CONCLUSION missing/distorted
- 0/2: TOPIC completely wrong

GRAMMAR (0, 1, or 2): 2 with connector, 1 without, 0 with errors
VOCABULARY (0, 1, or 2): 2 appropriate, 1 awkward, 0 inappropriate

Return ONLY valid JSON. No markdown, no explanation.`,
              messages: [{
                role: 'user',
                content: `PASSAGE: "${passageCheck.text}"

TOPIC: ${passageCheck.critical}
PIVOT: ${passageCheck.important}
CONCLUSION: ${passageCheck.conclusion}

SUMMARY: "${summary}"

Return JSON:
{
  "trait_scores": {
    "form": { "value": 1, "word_count": ${formCheck.wordCount}, "notes": "Valid form" },
    "content": { "value": 0-2, "topic_captured": true/false, "pivot_captured": true/false, "conclusion_captured": true/false, "notes": "..." },
    "grammar": { "value": 0-2, "has_connector": true/false, "notes": "..." },
    "vocabulary": { "value": 0-2, "notes": "..." }
  },
  "feedback": "..."
}`
              }]
            })
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`API error ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const aiContent = data.content?.[0]?.text;
        
        if (!aiContent) {
          throw new Error('Empty AI response content');
        }

        const aiResult = extractJSON(aiContent);
        
        if (!aiResult) {
          console.error('Failed to parse AI response:', aiContent);
          throw new Error('Could not parse AI response as JSON');
        }

        // Validate and clamp scores
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
              topic_captured: !!aiResult.trait_scores?.content?.topic_captured,
              pivot_captured: !!aiResult.trait_scores?.content?.pivot_captured,
              conclusion_captured: !!aiResult.trait_scores?.content?.conclusion_captured,
              notes: aiResult.trait_scores?.content?.notes || 'Content assessed'
            },
            grammar: {
              value: grammarValue,
              has_connector: !!aiResult.trait_scores?.grammar?.has_connector,
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
          reasoning: 'AI scoring',
          attempt: attempt + 1
        });
        
      } catch (apiError) {
        console.error(`Attempt ${attempt + 1} failed:`, apiError.message);
        lastError = apiError;
        
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); // Exponential backoff
        }
      }
    }

    // All retries failed - use fallback
    console.error('All AI attempts failed, using fallback');
    const fallback = getFallbackScoring(summary, formCheck);
    fallback.warning = `AI failed after ${MAX_RETRIES} attempts: ${lastError.message}`;
    return res.json(fallback);

  } catch (error) {
    console.error('Grading error:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found', path: req.path });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error', 
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ PTE Scoring API v2.1.0 running on port ${PORT}`);
  console.log(`🔑 Anthropic API: ${!!ANTHROPIC_API_KEY ? 'Configured' : 'Not configured (local mode)'}`);
  console.log(`📡 Endpoints: http://localhost:${PORT}/api/health`);
});
