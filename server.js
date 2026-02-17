const express = require('express');
const cors = require('cors');

const app = express();
const PORT = parseInt(process.env.PORT) || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ============ LOCAL GRADING FUNCTIONS ============

function validateForm(summary) {
  if (!summary || typeof summary !== 'string') {
    return { wordCount: 0, isValidForm: false, errors: ['Invalid input'] };
  }
  
  const trimmed = summary.trim();
  const words = trimmed.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  
  const errors = [];
  
  // Check word count
  if (wordCount < 5) errors.push('Too short (minimum 5 words)');
  if (wordCount > 75) errors.push('Too long (maximum 75 words)');
  
  // Check for multiple sentences
  const sentenceMatches = trimmed.match(/[.!?]+\s+[A-Z]/g);
  if (sentenceMatches && sentenceMatches.length > 0) {
    errors.push('Multiple sentences detected');
  }
  
  // Check ending punctuation
  if (!/[.!?]$/.test(trimmed)) {
    errors.push('Must end with punctuation');
  }
  
  // Check for newlines
  if (/[\n\r]/.test(summary)) {
    errors.push('Contains line breaks');
  }
  
  // Check for bullets
  if (/^[•\-*\d]\s|^\d+\.\s/m.test(summary)) {
    errors.push('Contains bullet points');
  }
  
  const isValidForm = errors.length === 0;
  
  return { 
    wordCount, 
    isValidForm,
    errors: isValidForm ? [] : errors
  };
}

// Extract key concepts from text
function extractConcepts(text) {
  if (!text) return [];
  
  // Remove common stop words and extract meaningful terms
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of',
    'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then',
    'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more',
    'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
    'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while']);
  
  return text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));
}

// Calculate semantic similarity between two texts
function calculateSimilarity(text1, text2) {
  const concepts1 = new Set(extractConcepts(text1));
  const concepts2 = new Set(extractConcepts(text2));
  
  if (concepts1.size === 0 || concepts2.size === 0) return 0;
  
  const intersection = new Set([...concepts1].filter(x => concepts2.has(x)));
  const union = new Set([...concepts1, ...concepts2]);
  
  return intersection.size / union.size;
}

// Local content analysis
function analyzeContentLocal(summary, passage) {
  const summaryLower = summary.toLowerCase();
  
  // Get key elements
  const topic = passage.keyElements?.critical || '';
  const pivot = passage.keyElements?.important || '';
  const conclusion = passage.keyElements?.conclusion || passage.keyElements?.supplementary?.[0] || '';
  
  // Calculate similarities
  const topicSim = calculateSimilarity(summary, topic);
  const pivotSim = calculateSimilarity(summary, pivot);
  const conclusionSim = conclusion ? calculateSimilarity(summary, conclusion) : 1;
  
  // Determine coverage
  const topicCaptured = topicSim >= 0.3;
  const pivotCaptured = pivotSim >= 0.25;
  const conclusionCaptured = conclusionSim >= 0.2 || !conclusion;
  
  // Calculate content score
  let contentScore = 2;
  if (!topicCaptured) contentScore -= 1;
  if (!pivotCaptured) contentScore -= 0.5;
  if (!conclusionCaptured) contentScore -= 0.5;
  contentScore = Math.max(0, contentScore);
  
  // Check for connectors
  const connectorPattern = /\b(however|although|while|but|yet|nevertheless|whereas|despite|though|moreover|furthermore|therefore|thus|hence|consequently|and|so)\b/i;
  const hasConnector = connectorPattern.test(summary);
  
  // Check for contradictions (simple keyword-based)
  const contradictions = [];
  const passageLower = (passage.text || '').toLowerCase();
  
  // Check for negation flips
  const negationPairs = [
    ['not important', 'important'],
    ['does not', 'does'],
    ['no longer', 'still'],
    ['decreasing', 'increasing'],
    ['declining', 'growing']
  ];
  
  for (const [neg, pos] of negationPairs) {
    if (passageLower.includes(pos) && summaryLower.includes(neg)) {
      contradictions.push(`Possible negation flip: "${pos}" vs "${neg}"`);
    }
  }
  
  return {
    scores: {
      content: Math.round(contentScore),
      topic: { captured: topicCaptured, similarity: Math.round(topicSim * 100) },
      pivot: { captured: pivotCaptured, similarity: Math.round(pivotSim * 100) },
      conclusion: { captured: conclusionCaptured, similarity: Math.round(conclusionSim * 100) }
    },
    grammar: {
      hasConnector,
      score: hasConnector ? 2 : 1
    },
    contradictions,
    vocabulary: {
      score: 2,
      notes: 'Verbatim and paraphrase both accepted'
    }
  };
}

// ============ HYBRID GRADING DECISION ============

function shouldUseAI(summary, passage, localResult) {
  // Use AI for complex cases:
  // 1. Borderline content scores (around 1)
  // 2. Potential contradictions detected
  // 3. Low similarity scores but might be good paraphrase
  // 4. Form is valid but content is unclear
  
  const contentScore = localResult.scores.content;
  const topicSim = localResult.scores.topic.similarity;
  const pivotSim = localResult.scores.pivot.similarity;
  
  // Borderline cases need AI review
  if (contentScore === 1) return true;
  
  // Potential contradictions need AI verification
  if (localResult.contradictions.length > 0) return true;
  
  // Very low similarity might be good paraphrase or completely off
  if (topicSim < 20 && contentScore > 0) return true;
  
  // High similarity with low score discrepancy
  if (topicSim > 50 && pivotSim > 40 && contentScore < 2) return true;
  
  // Default to local for clear cases
  return false;
}

// ============ AI GRADING ============

async function gradeWithAI(summary, passage, formCheck, localResult) {
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
        temperature: 0.1,
        system: `You are a PTE Academic examiner using TOPIC-PIVOT-CONCLUSION structure.

SCORING PRINCIPLES:
1. ACCEPT BOTH verbatim copying AND paraphrasing - judge on meaning, not wording
2. CONTENT (0-2): Score based on accurate capture of key ideas
   - 2/2: Topic, pivot, and conclusion all clearly present
   - 1/2: Some elements missing or unclear
   - 0/2: Major contradiction or completely wrong topic
3. Only deduct for: unclear meaning, contradictions, missing key ideas

PIVOT DETECTION:
- Pivot is captured if summary mentions BOTH the main topic AND the contrasting element
- Example: "reading is important while digital media grows" = pivot captured ✓
- Example: "despite digital trends, reading remains key" = pivot captured ✓`,
        messages: [{
          role: 'user',
          content: `PASSAGE: "${passage.text}"

KEY ELEMENTS:
- TOPIC: ${passage.keyElements?.critical || 'N/A'}
- PIVOT: ${passage.keyElements?.important || 'N/A'}
- CONCLUSION: ${passage.keyElements?.conclusion || passage.keyElements?.supplementary?.[0] || 'N/A'}

STUDENT SUMMARY: "${summary}"

LOCAL ANALYSIS:
- Topic similarity: ${localResult.scores.topic.similarity}%
- Pivot similarity: ${localResult.scores.pivot.similarity}%
- Has connector: ${localResult.grammar.hasConnector}
- Potential issues: ${localResult.contradictions.join(', ') || 'None detected'}

Evaluate and return JSON:
{
  "trait_scores": {
    "form": { "value": 1, "word_count": ${formCheck.wordCount}, "notes": "Valid form" },
    "content": { 
      "value": 0-2, 
      "topic_captured": true/false, 
      "pivot_captured": true/false, 
      "conclusion_captured": true/false,
      "notes": "Brief explanation"
    },
    "grammar": { "value": 0-2, "has_connector": true/false, "notes": "..." },
    "vocabulary": { "value": 2, "notes": "Verbatim accepted" }
  },
  "feedback": "What was good or needs improvement"
}`
        }]
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const aiContent = data.content?.[0]?.text;
    const jsonMatch = aiContent?.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    
    const aiResult = JSON.parse(jsonMatch[0]);
    
    return {
      trait_scores: {
        form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
        content: {
          value: Math.min(Math.max(Number(aiResult.trait_scores?.content?.value) || 2, 0), 2),
          topic_captured: aiResult.trait_scores?.content?.topic_captured ?? localResult.scores.topic.captured,
          pivot_captured: aiResult.trait_scores?.content?.pivot_captured ?? localResult.scores.pivot.captured,
          conclusion_captured: aiResult.trait_scores?.content?.conclusion_captured ?? localResult.scores.conclusion.captured,
          notes: aiResult.trait_scores?.content?.notes || 'AI evaluated'
        },
        grammar: {
          value: Math.min(Math.max(Number(aiResult.trait_scores?.grammar?.value) || localResult.grammar.score, 0), 2),
          has_connector: aiResult.trait_scores?.grammar?.has_connector ?? localResult.grammar.hasConnector,
          notes: aiResult.trait_scores?.grammar?.notes || ''
        },
        vocabulary: { value: 2, notes: 'Verbatim and paraphrase accepted' }
      },
      feedback: aiResult.feedback || 'Evaluated by AI',
      scoring_mode: 'ai'
    };
    
  } catch (error) {
    console.error('AI grading error:', error.message);
    return null;
  }
}

// ============ API ENDPOINTS ============

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    version: '3.0.0',
    anthropicConfigured: !!ANTHROPIC_API_KEY,
    gradingModes: ['local', 'ai', 'hybrid'],
    policy: 'Hybrid: Local for clear cases, AI for borderline/complex cases'
  });
});

app.get('/', (req, res) => {
  res.json({ 
    message: 'PTE Scoring API v3.0.0',
    endpoints: ['/api/health', '/api/grade'],
    features: ['Hybrid grading', 'Local + AI analysis', 'TOPIC-PIVOT-CONCLUSION structure']
  });
});

app.post('/api/grade', async (req, res) => {
  console.log('Grade request received');
  
  try {
    const { summary, passage } = req.body;
    
    if (!summary || !passage) {
      return res.status(400).json({ error: 'Missing summary or passage' });
    }

    // Step 1: Validate form (always local)
    const formCheck = validateForm(summary);
    console.log('Form check:', formCheck);
    
    if (!formCheck.isValidForm) {
      return res.json({
        trait_scores: {
          form: { value: 0, word_count: formCheck.wordCount, notes: formCheck.errors.join('; ') },
          content: { value: 0, topic_captured: false, pivot_captured: false, conclusion_captured: false, notes: 'Form error - content not scored' },
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

    // Step 2: Local content analysis
    const localResult = analyzeContentLocal(summary, passage);
    console.log('Local analysis:', localResult);
    
    // Step 3: Decide whether to use AI
    const useAI = ANTHROPIC_API_KEY && shouldUseAI(summary, passage, localResult);
    console.log('Use AI:', useAI);
    
    let result;
    
    if (useAI) {
      // Use AI for complex cases
      const aiResult = await gradeWithAI(summary, passage, formCheck, localResult);
      
      if (aiResult) {
        result = aiResult;
      } else {
        // Fallback to local if AI fails
        const contentScore = localResult.scores.content;
        const grammarScore = localResult.grammar.score;
        const rawScore = 1 + contentScore + grammarScore + 2;
        
        result = {
          trait_scores: {
            form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
            content: {
              value: contentScore,
              topic_captured: localResult.scores.topic.captured,
              pivot_captured: localResult.scores.pivot.captured,
              conclusion_captured: localResult.scores.conclusion.captured,
              notes: `Topic: ${localResult.scores.topic.similarity}%, Pivot: ${localResult.scores.pivot.similarity}%`
            },
            grammar: {
              value: grammarScore,
              has_connector: localResult.grammar.hasConnector,
              notes: localResult.grammar.hasConnector ? 'Connector present' : 'No connector'
            },
            vocabulary: { value: 2, notes: 'Verbatim and paraphrase accepted' }
          },
          feedback: 'AI failed - using local scoring',
          scoring_mode: 'local_fallback'
        };
      }
    } else {
      // Use local scoring for clear cases
      const contentScore = localResult.scores.content;
      const grammarScore = localResult.grammar.score;
      const rawScore = 1 + contentScore + grammarScore + 2;
      
      result = {
        trait_scores: {
          form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
          content: {
            value: contentScore,
            topic_captured: localResult.scores.topic.captured,
            pivot_captured: localResult.scores.pivot.captured,
            conclusion_captured: localResult.scores.conclusion.captured,
            notes: `Topic: ${localResult.scores.topic.similarity}%, Pivot: ${localResult.scores.pivot.similarity}%`
          },
          grammar: {
            value: grammarScore,
            has_connector: localResult.grammar.hasConnector,
            notes: localResult.grammar.hasConnector ? 'Connector present' : 'No connector'
          },
          vocabulary: { value: 2, notes: 'Verbatim and paraphrase accepted' }
        },
        feedback: contentScore >= 1.5 ? 'Good coverage of key ideas' : 'Some key elements missing',
        scoring_mode: 'local'
      };
    }
    
    // Calculate final scores
    const rawScore = result.trait_scores.form.value + 
                     result.trait_scores.content.value + 
                     result.trait_scores.grammar.value + 
                     result.trait_scores.vocabulary.value;
    
    const overallScore = Math.min(Math.round((rawScore / 7) * 90), 90);
    
    const bands = ['Band 5', 'Band 5', 'Band 6', 'Band 7', 'Band 8', 'Band 9', 'Band 9', 'Band 9'];
    
    const finalResult = {
      ...result,
      overall_score: overallScore,
      raw_score: rawScore,
      band: bands[rawScore] || 'Band 5',
      local_analysis: {
        topic_similarity: localResult.scores.topic.similarity,
        pivot_similarity: localResult.scores.pivot.similarity,
        conclusion_similarity: localResult.scores.conclusion.similarity,
        contradictions: localResult.contradictions
      }
    };
    
    console.log('Final result:', finalResult);
    res.json(finalResult);
    
  } catch (error) {
    console.error('Grading error:', error);
    res.status(500).json({ error: 'Internal error', message: error.message });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ PTE Scoring API v3.0.0 on port ${PORT}`);
  console.log(`📝 Hybrid grading: Local for clear cases, AI for complex cases`);
  console.log(`🤖 Anthropic: ${ANTHROPIC_API_KEY ? 'Configured' : 'Not configured'}`);
});
