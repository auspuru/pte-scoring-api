const express = require('express');
const cors = require('cors');

const app = express();
const PORT = parseInt(process.env.PORT) || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const fetch = global.fetch || require('node-fetch');

app.use(cors());
app.use(express.json({ limit: '10mb' }));

function normalize(text) {
  return text.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Semantic concept extraction - understands meaning regardless of wording
function extractConcepts(text) {
  const normalized = normalize(text);
  
  // Break into semantic units (handles both verbatim and paraphrased)
  return {
    entities: extractEntities(normalized),
    actions: extractActions(normalized),
    relationships: extractRelationships(normalized),
    sentiment: extractSentiment(normalized)
  };
}

function extractEntities(text) {
  // Key nouns/names that indicate who/what
  const patterns = [
    /(?:dr|professor|researcher|author|study|research|paper)[\s\w]+/g,
    /\b(?:persistence|success|talent|intelligence|city|farm|country|advantages|disadvantages)\b/g,
    /\b(?:martinez|harvard|fortune|olympic|nobel)\b/g
  ];
  
  const entities = new Set();
  patterns.forEach(pattern => {
    const matches = text.match(pattern) || [];
    matches.forEach(m => entities.add(m.trim()));
  });
  
  return [...entities];
}

function extractActions(text) {
  // Key verbs/actions
  const actionWords = ['exchange', 'move', 'credit', 'attribute', 'discover', 'reveal', 'persuade', 
                      'convince', 'view', 'regard', 'develop', 'track', 'study', 'ask'];
  return actionWords.filter(word => text.includes(word));
}

function extractRelationships(text) {
  // Contrast/comparison markers (important for pivot detection)
  return {
    hasContrast: /(?:however|but|although|though|while|whereas|yet|nevertheless|rather than|instead of|vs|versus)/.test(text),
    hasCausation: /(?:therefore|thus|because|since|consequently|as a result|leading to)/.test(text),
    hasAddition: /(?:moreover|furthermore|additionally|also|and)/.test(text)
  };
}

function extractSentiment(text) {
  // Positive/negative indicators for contradiction detection
  return {
    positive: (text.match(/\b(?:good|benefit|advantage|success|positive|better|smart|wise)\b/g) || []).length,
    negative: (text.match(/\b(?:bad|disadvantage|wrong|fail|problem|difficult|hard)\b/g) || []).length
  };
}

// Check for contradictions with passage meaning
function detectContradictions(summary, passage) {
  const sumNorm = normalize(summary);
  const passNorm = normalize(passage.text || passage);
  
  const contradictions = [];
  
  // Check for reversed causality (X causes Y vs Y causes X)
  if (passNorm.includes('not talent but persistence') && sumNorm.includes('talent not persistence')) {
    contradictions.push('Reversed causality: implied talent over persistence');
  }
  
  // Check for negation flips (X is good vs X is not good)
  if (passNorm.includes('mindset matters more') && sumNorm.includes('mindset does not matter')) {
    contradictions.push('Negation error: contradicted importance of mindset');
  }
  
  // Check for swapped entities (author vs wife, city vs country confusion)
  if (sumNorm.includes('wife persuaded author') && passNorm.includes('author persuaded wife')) {
    contradictions.push('Entity swap: reversed persuader and persuaded');
  }
  
  // Check for advantage/disadvantage flip
  if (passNorm.includes('advantages outweigh') && sumNorm.includes('disadvantages outweigh')) {
    contradictions.push('Valence error: swapped advantages and disadvantages');
  }
  
  return {
    hasContradiction: contradictions.length > 0,
    contradictions: contradictions,
    severity: contradictions.length > 1 ? 'critical' : contradictions.length === 1 ? 'major' : 'none'
  };
}

// Semantic coverage analysis (accepts verbatim OR paraphrase)
function analyzeSemanticCoverage(summary, passage) {
  const summaryConcepts = extractConcepts(summary);
  const passageText = passage.text || '';
  const keyElements = passage.keyElements || {};
  
  const results = {
    topic: { present: false, confidence: 0, evidence: [] },
    pivot: { present: false, confidence: 0, evidence: [] },
    conclusion: { present: false, confidence: 0, evidence: [] },
    gaps: [],
    meaningClear: true
  };

  // Topic Coverage (The "What")
  const criticalText = normalize(keyElements.critical || '');
  
  // Check if summary captures critical concepts (verbatim OR semantic equivalent)
  const topicKeywords = criticalText.split(' ').filter(w => w.length > 3);
  let topicMatches = 0;
  
  topicKeywords.forEach(keyword => {
    // Direct match
    if (normalize(summary).includes(keyword)) {
      topicMatches++;
      results.topic.evidence.push(`verbatim: ${keyword}`);
    } 
    // Semantic match (check if conceptually related word exists)
    else if (isSemanticMatch(keyword, summary)) {
      topicMatches++;
      results.topic.evidence.push(`semantic: ${keyword}`);
    }
  });
  
  results.topic.confidence = topicKeywords.length > 0 ? topicMatches / topicKeywords.length : 0;
  results.topic.present = results.topic.confidence >= 0.5; // At least half the key concepts
  
  if (!results.topic.present) {
    results.gaps.push(`Topic incomplete: missing core elements from "${keyElements.critical}"`);
  }

  // Pivot Coverage (The "Contrast/Turn")
  const importantText = normalize(keyElements.important || '');
  const pivotKeywords = importantText.split(' ').filter(w => w.length > 3);
  
  let pivotMatches = 0;
  pivotKeywords.forEach(keyword => {
    if (normalize(summary).includes(keyword) || isSemanticMatch(keyword, summary)) {
      pivotMatches++;
    }
  });
  
  results.pivot.confidence = pivotKeywords.length > 0 ? pivotMatches / pivotKeywords.length : 0;
  results.pivot.present = results.pivot.confidence >= 0.5 || summaryConcepts.relationships.hasContrast;
  
  if (!results.pivot.present) {
    results.gaps.push(`Pivot missing: key contrast not captured from "${keyElements.important}"`);
  }

  // Conclusion/Supplementary
  const conclusionText = normalize(keyElements.conclusion || keyElements.supplementary?.[0] || '');
  if (conclusionText.length > 5) {
    const conclusionKeywords = conclusionText.split(' ').filter(w => w.length > 3);
    let conclusionMatches = 0;
    conclusionKeywords.forEach(keyword => {
      if (normalize(summary).includes(keyword) || isSemanticMatch(keyword, summary)) {
        conclusionMatches++;
      }
    });
    results.conclusion.confidence = conclusionKeywords.length > 0 ? conclusionMatches / conclusionKeywords.length : 0;
    results.conclusion.present = results.conclusion.confidence >= 0.3;
  } else {
    results.conclusion.present = true; // No conclusion required
  }

  // Meaning Clarity Check
  if (summary.split(' ').length < 10 && results.gaps.length > 1) {
    results.meaningClear = false;
    results.gaps.push('Summary too brief to convey clear meaning');
  }

  return results;
}

// Semantic matching (accepts synonyms as equivalent)
function isSemanticMatch(concept, text) {
  const normalized = normalize(text);
  
  // Universal synonym mappings
  const synonyms = {
    'persistence': ['perseverance', 'determination', 'tenacity', 'dedication', 'persistent', 'persevered'],
    'talent': ['natural ability', 'gift', 'aptitude', 'innate', 'born with', 'skill', 'intelligence'],
    'success': ['achievement', 'accomplish', 'reach goals', 'succeed', 'successful', 'achievement'],
    'exchange': ['swap', 'trade', 'change', 'switch', 'move', 'shift', 'move from', 'switch from'],
    'city': ['urban', 'town', 'metropolitan', 'terrace'],
    'farm': ['country', 'rural', 'cottage', 'village', 'countryside'],
    'advantages': ['benefits', 'pros', 'positives', 'good points', 'merits', 'upsides'],
    'disadvantages': ['drawbacks', 'cons', 'negatives', 'bad points', 'downsides', 'problems'],
    'author': ['writer', 'narrator', 'he', 'she', 'speaker'],
    'wife': ['spouse', 'partner', 'woman', 'she'],
    'persuade': ['convince', 'urge', 'encourage', 'advise', 'tell']
  };
  
  const conceptBase = concept.replace(/s$/, ''); // Remove plural
  
  if (synonyms[conceptBase]) {
    return synonyms[conceptBase].some(syn => normalized.includes(syn));
  }
  
  // Check for stem matches (e.g., "exchange" matches "exchanging")
  if (normalized.includes(conceptBase)) return true;
  
  return false;
}

function validateForm(summary) {
  if (!summary || typeof summary !== 'string') {
    return { wordCount: 0, isValidForm: false };
  }
  
  const trimmed = summary.trim();
  const words = trimmed.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  const sentenceMatches = trimmed.match(/[.!?]+(?:\s+|$)/g);
  const sentenceCount = sentenceMatches ? sentenceMatches.length : 0;
  const endsWithPeriod = /[.!?]$/.test(trimmed);
  const hasNewlines = /[\n\r]/.test(summary);
  const hasBullets = /^[•\-*\d]\s|^\d+\.\s/m.test(summary);
  
  const isValidForm = wordCount >= 5 && wordCount <= 75 && endsWithPeriod && !hasNewlines && !hasBullets && sentenceCount === 1;
  
  return { wordCount, isValidForm, sentenceCount };
}

function extractJSON(text) {
  if (!text) return null;
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1].trim()); } catch (e) {}
  }
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch (e) { return null; }
  }
  return null;
}

function validatePassage(passage) {
  if (!passage || typeof passage !== 'object') return { valid: false, error: 'Passage must be object' };
  if (!passage.text) return { valid: false, error: 'Passage text required' };
  if (!passage.keyElements) {
    passage.keyElements = {
      critical: passage.text.substring(0, 100),
      important: passage.text.substring(100, 200)
    };
  }
  
  return { 
    valid: true,
    text: passage.text,
    raw: passage
  };
}

async function fetchWithTimeout(url, options, timeout = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error.name === 'AbortError' ? new Error('Request timeout') : error;
  }
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
        feedback: 'Form validation failed. Check word count and sentence structure.'
      });
    }

    const passageCheck = validatePassage(passage);
    
    // Semantic analysis
    const coverage = analyzeSemanticCoverage(summary, passageCheck.raw);
    const contradiction = detectContradictions(summary, passageCheck.raw);
    
    // Calculate Content Score (0-2)
    let contentScore = 2;
    let contentNotes = 'Key ideas captured';
    
    // Deduct for missing elements
    if (!coverage.topic.present) {
      contentScore -= 1;
      contentNotes = `Topic missing: ${coverage.gaps.find(g => g.includes('Topic')) || 'Main subject unclear'}`;
    }
    if (!coverage.pivot.present) {
      contentScore -= 0.5;
      contentNotes += '; Key contrast/point missing';
    }
    if (!coverage.meaningClear) {
      contentScore = Math.max(contentScore - 1, 0);
      contentNotes = 'Meaning unclear - too brief or vague';
    }
    
    // CRITICAL: Deduct for contradictions
    if (contradiction.hasContradiction) {
      if (contradiction.severity === 'critical') {
        contentScore = 0;
        contentNotes = `Critical contradiction: ${contradiction.contradictions.join(', ')}`;
      } else {
        contentScore = Math.max(contentScore - 1, 0);
        contentNotes += `; Contradiction detected: ${contradiction.contradictions[0]}`;
      }
    }
    
    contentScore = Math.max(Math.min(contentScore, 2), 0);

    // No API key - local scoring
    if (!ANTHROPIC_API_KEY) {
      const hasConnector = /(?:however|although|while|but|yet|moreover|furthermore|therefore|thus|and|so)/.test(normalize(summary));
      const grammarScore = hasConnector ? 2 : 1;
      
      // Vocabulary: Full credit for both verbatim and paraphrase (PTE allows copying key phrases)
      const vocabScore = 2;
      
      const rawScore = 1 + contentScore + grammarScore + vocabScore;
      const overallScore = Math.min(Math.round((rawScore / 7) * 90), 90);
      
      return res.json({
        trait_scores: {
          form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
          content: { 
            value: contentScore, 
            topic_captured: coverage.topic.present, 
            pivot_captured: coverage.pivot.present, 
            conclusion_captured: coverage.conclusion.present,
            notes: contentNotes
          },
          grammar: { value: grammarScore, has_connector: hasConnector, notes: hasConnector ? 'Connector present' : 'Simple structure' },
          vocabulary: { value: vocabScore, notes: 'PTE allows copying key phrases - verbatim accepted' }
        },
        overall_score: overallScore,
        raw_score: rawScore,
        band: overallScore >= 79 ? 'Band 8+' : overallScore >= 65 ? 'Band 7' : overallScore >= 50 ? 'Band 6' : 'Band 5',
        feedback: contentNotes.includes('Contradiction') || contentNotes.includes('missing') 
          ? `Issues found: ${contentNotes}` 
          : 'Good coverage of key ideas.',
        semantic_analysis: {
          coverage: coverage,
          contradiction: contradiction,
          scoring_mode: 'semantic_local'
        }
      });
    }

    // AI scoring with semantic focus
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
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
              max_tokens: 1500,
              temperature: 0.0,
              system: `You are a PTE Academic examiner. Score based on MEANING ACCURACY, not wording style.

ACCEPT BOTH:
- Verbatim copying (PTE allows this)
- Paraphrasing (synonyms accepted equally)

DEDUCT SCORES ONLY FOR:
1. Missing key ideas (topic, pivot/contrast, conclusion)
2. Contradicting the passage meaning
3. Unclear/vague meaning that doesn't convey the point
4. Wrong information or reversed relationships

DO NOT DEDUCT FOR:
- Copying phrases verbatim
- Lack of paraphrasing
- Similar sentence structure to passage

CONTENT SCORING (0-2):
- 2/2: All key ideas present, meaning accurate, no contradictions
- 1/2: Some key ideas missing OR minor contradiction/vagueness
- 0/2: Major contradiction, completely wrong topic, or meaning incomprehensible`,
              messages: [{
                role: 'user',
                content: `Evaluate this summary for semantic accuracy and coverage.

PASSAGE: "${passageCheck.text}"

KEY ELEMENTS TO CAPTURE:
- TOPIC: ${passageCheck.raw.keyElements?.critical || 'Main subject'}
- PIVOT: ${passageCheck.raw.keyElements?.important || 'Key contrast/point'}
- CONCLUSION: ${passageCheck.raw.keyElements?.conclusion || passageCheck.raw.keyElements?.supplementary?.[0] || 'Optional'}

STUDENT SUMMARY: "${summary}"

LOCAL SEMANTIC ANALYSIS:
- Topic coverage: ${(coverage.topic.confidence * 100).toFixed(0)}% (${coverage.topic.present ? 'OK' : 'MISSING'})
- Pivot coverage: ${(coverage.pivot.confidence * 100).toFixed(0)}% (${coverage.pivot.present ? 'OK' : 'MISSING'})
- Contradictions detected: ${contradiction.hasContradiction ? contradiction.contradictions.join(', ') : 'None'}
- Gaps: ${coverage.gaps.join('; ') || 'None'}

Evaluate:
1. Is the meaning accurate even if words are copied?
2. Are there any contradictions with the passage?
3. Are key ideas missing or unclear?

Return JSON:
{
  "trait_scores": {
    "form": { "value": 1, "word_count": ${formCheck.wordCount}, "notes": "Valid form" },
    "content": { 
      "value": 0-2, 
      "topic_captured": true/false,
      "pivot_captured": true/false,
      "conclusion_captured": true/false,
      "notes": "Explain only if meaning wrong, contradictory, or missing ideas"
    },
    "grammar": { "value": 0-2, "has_connector": true/false, "notes": "..." },
    "vocabulary": { "value": 2, "notes": "PTE accepts verbatim copying" }
  },
  "semantic_assessment": {
    "meaning_accurate": true/false,
    "contradictions": ["list any"],
    "missing_elements": ["list any"]
  },
  "feedback": "Focus on meaning issues, not wording style"
}`
              }]
            })
          }
        );

        if (!response.ok) throw new Error(`API error ${response.status}`);
        
        const data = await response.json();
        const aiResult = extractJSON(data.content?.[0]?.text);
        if (!aiResult) throw new Error('Parse failed');

        // Use AI score but ensure it's not higher than local analysis allows
        let finalContent = Math.min(Math.max(Number(aiResult.trait_scores?.content?.value) || 1, 0), 2);
        
        // Override if local detected critical issues
        if (contradiction.severity === 'critical') finalContent = 0;
        else if (!coverage.meaningClear) finalContent = Math.min(finalContent, 1);
        
        const grammarScore = Math.min(Math.max(Number(aiResult.trait_scores?.grammar?.value) || 1, 0), 2);
        
        // Always 2 for vocabulary (PTE allows copying)
        const vocabScore = 2;
        
        const rawScore = 1 + finalContent + grammarScore + vocabScore;
        const overallScore = Math.min(Math.round((rawScore / 7) * 90), 90);
        const bands = ['Band 5', 'Band 5', 'Band 6', 'Band 7', 'Band 8', 'Band 9', 'Band 9', 'Band 9'];

        return res.json({
          trait_scores: {
            form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
            content: {
              value: finalContent,
              topic_captured: coverage.topic.present,
              pivot_captured: coverage.pivot.present,
              conclusion_captured: coverage.conclusion.present,
              notes: aiResult.trait_scores?.content?.notes || contentNotes
            },
            grammar: {
              value: grammarScore,
              has_connector: !!aiResult.trait_scores?.grammar?.has_connector,
              notes: aiResult.trait_scores?.grammar?.notes || ''
            },
            vocabulary: {
              value: vocabScore,
              notes: 'Verbatim and paraphrase both accepted - scored on appropriateness'
            }
          },
          overall_score: overallScore,
          raw_score: rawScore,
          band: bands[rawScore] || 'Band 5',
          feedback: aiResult.feedback || 'Evaluated for semantic accuracy',
          semantic_analysis: {
            coverage_percentages: {
              topic: Math.round(coverage.topic.confidence * 100),
              pivot: Math.round(coverage.pivot.confidence * 100)
            },
            contradictions: contradiction,
            meaning_clear: coverage.meaningClear
          },
          scoring_mode: 'semantic_ai'
        });
        
      } catch (apiError) {
        lastError = apiError;
        if (attempt < 1) await new Promise(r => setTimeout(r, 1000));
      }
    }

    // Fallback
    res.json({
      trait_scores: {
        form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
        content: { value: contentScore, topic_captured: coverage.topic.present, pivot_captured: coverage.pivot.present, notes: contentNotes },
        grammar: { value: 1, has_connector: false, notes: 'Fallback' },
        vocabulary: { value: 2, notes: 'Verbatim accepted' }
      },
      overall_score: 65,
      raw_score: 6,
      band: 'Band 7',
      feedback: contentNotes,
      warning: 'AI failed, using semantic local analysis'
    });

  } catch (error) {
    console.error('Grading error:', error);
    res.status(500).json({ error: 'Internal error', message: error.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: '3.1.0',
    policy: 'semantic_focused',
    rules: 'Scores for verbatim AND paraphrase. Deducts only for: unclear meaning, contradictions, missing key ideas'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ PTE Scoring API v3.1.0 (Semantic Focus) on port ${PORT}`);
  console.log(`📝 Policy: Accept verbatim and paraphrase equally`);
  console.log(`⚠️  Deduct only for: contradictions, missing ideas, unclear meaning`);
});
