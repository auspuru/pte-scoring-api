const express = require('express');
const cors = require('cors');

const app = express();
const PORT = parseInt(process.env.PORT) || 3001;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Polyfill fetch for Node < 18
const fetch = global.fetch || require('node-fetch');

// Constants
const MAX_RETRIES = 2;
const REQUEST_TIMEOUT = 30000;
const CONNECTORS = ['however', 'although', 'while', 'but', 'yet', 'nevertheless', 'whereas', 'despite', 'though', 'moreover', 'furthermore', 'therefore', 'thus', 'hence', 'consequently', 'and', 'or', 'nor', 'so'];

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
    version: '2.2.0',
    features: ['Paraphrase detection', 'Semantic similarity', 'Robust error handling']
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

// Semantic similarity helper - check if concepts are present even with different words
function checkSemanticPresence(summary, concepts) {
  const summaryLower = summary.toLowerCase();
  const words = summaryLower.split(/\s+/);
  
  return concepts.map(conceptGroup => {
    // Each conceptGroup is an array of synonyms/variants
    const found = conceptGroup.some(variant => summaryLower.includes(variant.toLowerCase()));
    return {
      concept: conceptGroup[0],
      variants: conceptGroup,
      found,
      matchedVariant: found ? conceptGroup.find(v => summaryLower.includes(v.toLowerCase())) : null
    };
  });
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
function getFallbackScoring(summary, formCheck, passageCheck) {
  const summaryLower = summary.toLowerCase();
  const hasConnector = CONNECTORS.some(c => summaryLower.includes(c));
  
  // Check for semantic concepts locally if passage data available
  let contentScore = 2;
  let topicCaptured = true;
  let pivotCaptured = true;
  
  if (passageCheck?.valid) {
    // Check topic concepts
    const topicConcepts = [
      ['adaptive persistence', 'persistence', 'persistent'],
      ['high achievers', 'successful people', 'achievers', 'success'],
      ['talent', 'natural ability', 'innate ability', 'gifted', 'intelligence']
    ];
    
    const topicChecks = checkSemanticPresence(summary, topicConcepts);
    topicCaptured = topicChecks.filter(t => t.found).length >= 2;
    
    // Check pivot concepts  
    const pivotConcepts = [
      ['setbacks', 'failures', 'obstacles', 'difficulties', 'challenges', 'problems'],
      ['learning opportunities', 'learning', 'teaching', 'lessons', 'learn'],
      ['working smarter', 'work smarter', 'smarter', 'not about working harder']
    ];
    
    const pivotChecks = checkSemanticPresence(summary, pivotConcepts);
    pivotCaptured = pivotChecks.filter(p => p.found).length >= 2;
    
    // Calculate content score based on capture
    if (!topicCaptured && !pivotCaptured) contentScore = 0;
    else if (!topicCaptured || !pivotCaptured) contentScore = 1;
    else contentScore = 2;
  }
  
  const grammarScore = hasConnector ? 2 : 1;
  const rawScore = 1 + contentScore + grammarScore + 2; // +2 for vocab (assumed good)
  const overallScore = Math.min(Math.round((rawScore / 7) * 90), 90);
  
  const bands = ['Band 5', 'Band 5', 'Band 6', 'Band 7', 'Band 8', 'Band 9', 'Band 9', 'Band 9'];
  
  return {
    trait_scores: {
      form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
      content: { 
        value: contentScore, 
        topic_captured: topicCaptured, 
        pivot_captured: pivotCaptured, 
        conclusion_captured: true, 
        notes: 'Local semantic scoring' 
      },
      grammar: { value: grammarScore, has_connector: hasConnector, notes: hasConnector ? 'Connector detected' : 'No connector' },
      vocabulary: { value: 2, notes: 'Appropriate vocabulary' }
    },
    overall_score: overallScore,
    raw_score: rawScore,
    band: bands[rawScore] || 'Band 5',
    feedback: 'AI service error - semantic fallback scoring applied',
    reasoning: 'Fallback with paraphrase detection'
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
    conclusion: passage.keyElements.conclusion || passage.keyElements.supplementary?.[0] || 'N/A',
    raw: passage
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

    // No Anthropic key - local scoring with semantic analysis
    if (!ANTHROPIC_API_KEY) {
      console.log('No API key configured, using local semantic scoring');
      const result = getFallbackScoring(summary, formCheck, passageCheck);
      result.scoring_mode = 'local_semantic';
      return res.json(result);
    }

    // Anthropic AI scoring with enhanced paraphrase detection
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
              temperature: 0.0, // Zero temp for consistent evaluation
              system: `You are a PTE Academic examiner. CRITICAL: Detect PARAPHRASES and SEMANTIC EQUIVALENTS - do not require exact keyword matching.

SCORING RUBRIC:

FORM (0 or 1): Already validated. Return 1.

CONTENT (0, 1, or 2):
- 2/2: Main idea captured ACCURATELY, even with different words (paraphrases accepted)
  * TOPIC: Must convey that adaptive persistence (not talent) leads to success
  * PIVOT: Must convey that viewing setbacks as learning opportunities increases success (3.4x) OR that it's about working smarter not harder
  * Accept synonyms: talent=natural ability=giftedness; setbacks=failures=obstacles; tough=difficult=hard
- 1/2: Main idea mentioned but distorted, incomplete, or only partial paraphrase
- 0/2: Main idea completely wrong or missing

GRAMMAR (0, 1, or 2): 
- 2: Complex sentence with connector (however, although, while, but, yet, moreover, furthermore, therefore, etc.)
- 1: Simple sentence or compound without sophisticated connector
- 0: Grammatical errors

VOCABULARY (0, 1, or 2):
- 2: Appropriate word choices, good paraphrasing (e.g., "natural ability" instead of "talent")
- 1: Awkward word choices but understandable
- 0: Inappropriate vocabulary

PARAPHRASE DETECTION EXAMPLES:
✓ "natural ability" = "talent" (ACCEPT)
✓ "difficult times" = "tough" (ACCEPT)  
✓ "working smarter" = "working smarter when things get tough" (ACCEPT)
✓ "view failures as lessons" = "view setbacks as learning opportunities" (ACCEPT)
✗ "adaptive persistence is about talent" (WRONG - opposite meaning)`,
              messages: [{
                role: 'user',
                content: `Evaluate this PTE summary for PARAPHRASING quality and content accuracy.

PASSAGE: "${passageCheck.text}"

KEY ELEMENTS TO CAPTURE:
- TOPIC: ${passageCheck.critical}
- PIVOT/CONTRAST: ${passageCheck.important}
- CONCLUSION: ${passageCheck.conclusion}

STUDENT SUMMARY: "${summary}"

TASK: Return JSON with this exact structure:
{
  "trait_scores": {
    "form": { "value": 1, "word_count": ${formCheck.wordCount}, "notes": "Valid form" },
    "content": { 
      "value": 0-2, 
      "topic_captured": true/false, 
      "topic_notes": "Did they capture main idea? Accept paraphrases like 'natural ability' for 'talent'",
      "pivot_captured": true/false, 
      "pivot_notes": "Did they capture the contrast? Accept 'working smarter' or 'setbacks as lessons'",
      "conclusion_captured": true/false,
      "notes": "Summary of content quality"
    },
    "grammar": { 
      "value": 0-2, 
      "has_connector": true/false,
      "connector_used": "name of connector if any",
      "notes": "Grammar assessment"
    },
    "vocabulary": { 
      "value": 0-2, 
      "paraphrase_quality": "excellent/good/poor",
      "notes": "Vocabulary variety and appropriateness"
    }
  },
  "feedback": "Constructive feedback mentioning specific strengths and what key point might be missing",
  "paraphrase_analysis": {
    "detected_paraphrases": ["list specific paraphrases detected"],
    "missed_concepts": ["any key concepts truly missing"]
  }
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
        
        // Enhanced response with paraphrase detection info
        return res.json({
          trait_scores: {
            form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
            content: {
              value: contentValue,
              topic_captured: !!aiResult.trait_scores?.content?.topic_captured,
              pivot_captured: !!aiResult.trait_scores?.content?.pivot_captured,
              conclusion_captured: !!aiResult.trait_scores?.content?.conclusion_captured,
              topic_notes: aiResult.trait_scores?.content?.topic_notes || '',
              pivot_notes: aiResult.trait_scores?.content?.pivot_notes || '',
              notes: aiResult.trait_scores?.content?.notes || 'Content assessed'
            },
            grammar: {
              value: grammarValue,
              has_connector: !!aiResult.trait_scores?.grammar?.has_connector,
              connector_used: aiResult.trait_scores?.grammar?.connector_used || '',
              notes: aiResult.trait_scores?.grammar?.notes || 'Grammar assessed'
            },
            vocabulary: {
              value: vocabValue,
              paraphrase_quality: aiResult.trait_scores?.vocabulary?.paraphrase_quality || 'good',
              notes: aiResult.trait_scores?.vocabulary?.notes || 'Vocabulary assessed'
            }
          },
          overall_score: overallScore,
          raw_score: rawScore,
          band: bands[rawScore] || 'Band 5',
          feedback: aiResult.feedback || 'Summary evaluated',
          reasoning: 'AI scoring with paraphrase detection',
          paraphrase_analysis: aiResult.paraphrase_analysis || {},
          attempt: attempt + 1,
          word_count: formCheck.wordCount
        });
        
      } catch (apiError) {
        console.error(`Attempt ${attempt + 1} failed:`, apiError.message);
        lastError = apiError;
        
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    }

    // All retries failed - use fallback with semantic analysis
    console.error('All AI attempts failed, using semantic fallback');
    const fallback = getFallbackScoring(summary, formCheck, passageCheck);
    fallback.warning = `AI failed after ${MAX_RETRIES} attempts: ${lastError.message}`;
    fallback.scoring_mode = 'fallback_semantic';
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
  console.log(`✅ PTE Scoring API v2.2.0 running on port ${PORT}`);
  console.log(`🎯 Paraphrase detection: ENABLED`);
  console.log(`🔑 Anthropic API: ${!!ANTHROPIC_API_KEY ? 'Configured' : 'Not configured (local mode)'}`);
  console.log(`📡 Endpoints: http://localhost:${PORT}/api/health`);
});
