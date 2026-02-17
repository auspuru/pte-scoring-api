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

// Check for keyword presence (more lenient than similarity)
function checkKeywordPresence(summary, keyText) {
  if (!keyText) return { present: false, score: 0 };
  
  const sumLower = summary.toLowerCase();
  const keyLower = keyText.toLowerCase();
  
  // Extract important words (4+ chars) from key text
  const keyWords = keyLower
    .split(/\s+/)
    .map(w => w.replace(/[^\w]/g, ''))
    .filter(w => w.length >= 4);
  
  if (keyWords.length === 0) return { present: false, score: 0 };
  
  // Count how many key words appear in summary
  const matches = keyWords.filter(word => sumLower.includes(word)).length;
  const score = matches / keyWords.length;
  
  // Also check for semantic similarity as backup
  const simScore = calculateSimilarity(summary, keyText);
  
  // Return true if either method shows good coverage
  return {
    present: score >= 0.25 || simScore >= 0.2,
    keywordScore: Math.round(score * 100),
    simScore: Math.round(simScore * 100)
  };
}

// Local content analysis - MORE LENIENT
function analyzeContentLocal(summary, passage) {
  // TOPIC check
  const topicCheck = checkKeywordPresence(summary, passage.keyElements?.critical || '');
  
  // PIVOT check - be more lenient
  const pivotCheck = checkKeywordPresence(summary, passage.keyElements?.important || '');
  
  // CONCLUSION check
  const conclusionCheck = checkKeywordPresence(summary, 
    passage.keyElements?.conclusion || passage.keyElements?.supplementary?.[0] || '');
  
  // Calculate content score
  let contentScore = 2;
  if (!topicCheck.present) contentScore -= 1;
  if (!pivotCheck.present) contentScore -= 0.5;
  if (!conclusionCheck.present) contentScore -= 0.3;
  contentScore = Math.max(0, contentScore);
  
  // Check for connectors
  const connectorPattern = /\b(however|although|while|but|yet|nevertheless|whereas|despite|though|moreover|furthermore|therefore|thus|hence|consequently|and|so)\b/i;
  const hasConnector = connectorPattern.test(summary);
  
  return {
    scores: {
      content: Math.round(contentScore),
      topic: { 
        captured: topicCheck.present, 
        keywordScore: topicCheck.keywordScore,
        simScore: topicCheck.simScore
      },
      pivot: { 
        captured: pivotCheck.present, 
        keywordScore: pivotCheck.keywordScore,
        simScore: pivotCheck.simScore
      },
      conclusion: { 
        captured: conclusionCheck.present, 
        keywordScore: conclusionCheck.keywordScore,
        simScore: conclusionCheck.simScore
      }
    },
    grammar: {
      hasConnector,
      score: hasConnector ? 2 : 1
    },
    vocabulary: {
      score: 2,
      notes: 'Verbatim and paraphrase both accepted'
    }
  };
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

PIVOT DETECTION - BE VERY LENIENT:
- Pivot is captured if summary mentions BOTH the main topic AND the contrasting/opposing element
- Example: "reading is important while digital media increases" = pivot captured ✓
- Example: "despite digital trends, reading remains key" = pivot captured ✓
- Example: "reading helps academic success, noting digital media is rising" = pivot captured ✓
- If the summary mentions the contrast element AT ALL, mark pivot as captured`,
        messages: [{
          role: 'user',
          content: `PASSAGE: "${passage.text}"

KEY ELEMENTS:
- TOPIC: ${passage.keyElements?.critical || 'N/A'}
- PIVOT: ${passage.keyElements?.important || 'N/A'}
- CONCLUSION: ${passage.keyElements?.conclusion || passage.keyElements?.supplementary?.[0] || 'N/A'}

STUDENT SUMMARY: "${summary}"

LOCAL ANALYSIS (use this as guidance):
- Topic keyword match: ${localResult.scores.topic.keywordScore}%
- Pivot keyword match: ${localResult.scores.pivot.keywordScore}%
- Conclusion keyword match: ${localResult.scores.conclusion.keywordScore}%
- Has connector: ${localResult.grammar.hasConnector}

IMPORTANT: If local analysis shows pivot keyword match >= 25%, mark pivot_captured as TRUE.

Return JSON:
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
    
    // OVERRIDE AI if local analysis shows good coverage but AI says no
    let topicCaptured = aiResult.trait_scores?.content?.topic_captured;
    let pivotCaptured = aiResult.trait_scores?.content?.pivot_captured;
    let conclusionCaptured = aiResult.trait_scores?.content?.conclusion_captured;
    
    // If local shows good keyword match, override AI
    if (localResult.scores.topic.keywordScore >= 25) topicCaptured = true;
    if (localResult.scores.pivot.keywordScore >= 25) pivotCaptured = true;
    if (localResult.scores.conclusion.keywordScore >= 20) conclusionCaptured = true;
    
    // Recalculate content score based on overrides
    let contentScore = 2;
    if (!topicCaptured) contentScore -= 1;
    if (!pivotCaptured) contentScore -= 0.5;
    if (!conclusionCaptured) contentScore -= 0.3;
    contentScore = Math.max(0, Math.round(contentScore));
    
    return {
      trait_scores: {
        form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
        content: {
          value: contentScore,
          topic_captured: topicCaptured,
          pivot_captured: pivotCaptured,
          conclusion_captured: conclusionCaptured,
          notes: aiResult.trait_scores?.content?.notes || 'Evaluated'
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
    version: '3.1.0',
    anthropicConfigured: !!ANTHROPIC_API_KEY,
    policy: 'Local keyword matching + AI for complex cases'
  });
});

app.get('/', (req, res) => {
  res.json({ 
    message: 'PTE Scoring API v3.1.0',
    endpoints: ['/api/health', '/api/grade']
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

    // Step 2: Local content analysis (LENIENT)
    const localResult = analyzeContentLocal(summary, passage);
    console.log('Local analysis:', localResult);
    
    // Step 3: Decide whether to use AI
    // Use AI only for very low scores or when Anthropic is available and we want double-check
    const useAI = ANTHROPIC_API_KEY && localResult.scores.content < 1.5;
    console.log('Use AI:', useAI);
    
    let result;
    
    if (useAI) {
      // Use AI for low-scoring cases
      const aiResult = await gradeWithAI(summary, passage, formCheck, localResult);
      
      if (aiResult) {
        result = aiResult;
      } else {
        // Fallback to local
        result = buildLocalResult(formCheck, localResult);
      }
    } else {
      // Use local scoring (more lenient)
      result = buildLocalResult(formCheck, localResult);
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
        topic_keyword_match: localResult.scores.topic.keywordScore,
        topic_sim: localResult.scores.topic.simScore,
        pivot_keyword_match: localResult.scores.pivot.keywordScore,
        pivot_sim: localResult.scores.pivot.simScore,
        conclusion_keyword_match: localResult.scores.conclusion.keywordScore,
        conclusion_sim: localResult.scores.conclusion.simScore
      }
    };
    
    console.log('Final result:', finalResult);
    res.json(finalResult);
    
  } catch (error) {
    console.error('Grading error:', error);
    res.status(500).json({ error: 'Internal error', message: error.message });
  }
});

function buildLocalResult(formCheck, localResult) {
  const contentScore = localResult.scores.content;
  const grammarScore = localResult.grammar.score;
  const rawScore = 1 + contentScore + grammarScore + 2;
  
  return {
    trait_scores: {
      form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
      content: {
        value: contentScore,
        topic_captured: localResult.scores.topic.captured,
        pivot_captured: localResult.scores.pivot.captured,
        conclusion_captured: localResult.scores.conclusion.captured,
        notes: `Topic: ${localResult.scores.topic.keywordScore}%, Pivot: ${localResult.scores.pivot.keywordScore}%`
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

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ PTE Scoring API v3.1.0 on port ${PORT}`);
  console.log(`📝 Lenient keyword matching + AI for edge cases`);
  console.log(`🤖 Anthropic: ${ANTHROPIC_API_KEY ? 'Configured' : 'Not configured'}`);
});
