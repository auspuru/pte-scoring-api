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

function getWords(text) {
  return normalize(text).split(' ').filter(w => w.length > 2);
}

// Universal content analyzer - works for ANY passage type
function analyzeContentUniversal(summary, passage) {
  const summaryNorm = normalize(summary);
  const summaryWords = getWords(summary);
  const summarySet = new Set(summaryWords);
  const passageText = passage.text || '';
  const keyElements = passage.keyElements || {};
  
  const results = {
    topic: { captured: false, score: 0, evidence: [], missing: [] },
    pivot: { captured: false, score: 0, evidence: [], missing: [] },
    conclusion: { captured: false, score: 0, evidence: [], missing: [] },
    overallContent: 0,
    criticalGaps: [],
    semanticMatches: []
  };

  // Extract key concepts from keyElements (dynamically)
  const topicConcepts = extractKeyConcepts(keyElements.critical || '');
  const pivotConcepts = extractKeyConcepts(keyElements.important || '');
  const conclusionConcepts = extractKeyConcepts(keyElements.conclusion || keyElements.supplementary?.[0] || '');

  // TOPIC ANALYSIS (The "What/Who")
  // Check if summary captures the main subject/action from keyElements.critical
  let topicMatches = 0;
  let topicEvidence = [];
  
  topicConcepts.forEach(concept => {
    const variations = getVariations(concept);
    const found = variations.some(v => summaryNorm.includes(v));
    if (found) {
      topicMatches++;
      topicEvidence.push(concept);
    }
  });
  
  // Also check for core semantic elements in passage title/first sentence
  const passageWords = getWords(passageText.substring(0, 200)); // First 200 chars usually contain topic
  const coreNouns = passageWords.filter(w => w.length > 4).slice(0, 5); // Long words are usually content words
  
  let coreMatches = 0;
  coreNouns.forEach(noun => {
    if (summaryNorm.includes(noun)) coreMatches++;
  });
  
  // Score topic (0-2)
  if (topicMatches >= 2 || (topicMatches >= 1 && coreMatches >= 2)) {
    results.topic.score = 2;
    results.topic.captured = true;
  } else if (topicMatches === 1 || coreMatches >= 2) {
    results.topic.score = 1;
    results.topic.missing.push('Clear topic statement');
  } else {
    results.topic.score = 0;
    results.criticalGaps.push('CRITICAL: Main topic missing');
  }
  
  results.topic.evidence = topicEvidence;

  // PIVOT ANALYSIS (The "Contrast/Turn")
  // Check if summary captures the contrast/important point
  let pivotMatches = 0;
  let pivotEvidence = [];
  
  pivotConcepts.forEach(concept => {
    const variations = getVariations(concept);
    const found = variations.some(v => summaryNorm.includes(v));
    if (found) {
      pivotMatches++;
      pivotEvidence.push(concept);
    }
  });
  
  // Check for contrast indicators
  const hasContrast = ['but', 'however', 'although', 'though', 'while', 'whereas', 'yet', 'nevertheless', 'despite'].some(w => summaryNorm.includes(w));
  const hasComparison = ['than', 'compared', 'contrast', 'difference', 'rather', 'instead'].some(w => summaryNorm.includes(w));
  
  if (pivotMatches >= 2 && (hasContrast || hasComparison)) {
    results.pivot.score = 2;
    results.pivot.captured = true;
  } else if (pivotMatches >= 1) {
    results.pivot.score = 1;
    if (!hasContrast) results.pivot.missing.push('Contrast word (however/but/although)');
  } else {
    results.pivot.score = 0;
    results.criticalGaps.push('CRITICAL: Key contrast/point missing');
  }
  
  results.pivot.evidence = pivotEvidence;

  // CONCLUSION ANALYSIS (Supplementary)
  let conclusionMatches = 0;
  conclusionConcepts.forEach(concept => {
    const variations = getVariations(concept);
    if (variations.some(v => summaryNorm.includes(v))) conclusionMatches++;
  });
  
  results.conclusion.score = Math.min(conclusionMatches, 2);
  results.conclusion.captured = conclusionMatches > 0;

  // Calculate overall content score
  // Weight: Topic 40%, Pivot 40%, Conclusion 20%
  const weightedScore = (results.topic.score * 0.4) + (results.pivot.score * 0.4) + (results.conclusion.score * 0.2);
  
  // STRICT CAP: If critical gaps exist, cap the score
  if (results.criticalGaps.length > 0) {
    results.overallContent = Math.min(Math.round(weightedScore), 1); // Max 1 if critical gaps
  } else {
    results.overallContent = Math.min(Math.round(weightedScore), 2);
  }
  
  // Additional strict rule: If topic is 0, max overall is 1
  if (results.topic.score === 0) {
    results.overallContent = Math.min(results.overallContent, 1);
    results.scoreCapped = true;
  }
  
  return results;
}

// Extract key concepts from a string (handles "X rather than Y" format)
function extractKeyConcepts(text) {
  if (!text) return [];
  
  // Split on common separators
  const concepts = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+(?:rather than|instead of|vs|versus|and|or|but)\s+/g)
    .map(s => s.trim())
    .filter(s => s.length > 3)
    .slice(0, 6); // Max 6 concepts
  
  return [...new Set(concepts)];
}

// Get variations of a concept (stemming, synonyms)
function getVariations(concept) {
  const variations = [concept];
  
  // Add plural/singular variants
  if (concept.endsWith('s')) {
    variations.push(concept.slice(0, -1));
  } else {
    variations.push(concept + 's');
  }
  
  // Add common suffix variations
  if (concept.endsWith('y')) {
    variations.push(concept.slice(0, -1) + 'ies');
  }
  if (concept.endsWith('e')) {
    variations.push(concept + 'd');
    variations.push(concept + 's');
  }
  
  // Common synonym mappings (universal)
  const universalSynonyms = {
    'persistence': ['perseverance', 'determination', 'tenacity', 'dedication'],
    'success': ['achievement', 'accomplishment', 'triumph', 'victory'],
    'advantages': ['benefits', 'pros', 'positives', 'merits', 'upside'],
    'disadvantages': ['drawbacks', 'cons', 'negatives', 'downsides', 'problems'],
    'city': ['urban', 'town', 'metropolitan', 'municipal'],
    'country': ['rural', 'farm', 'village', 'countryside', 'pastoral'],
    'exchange': ['swap', 'trade', 'change', 'switch', 'move', 'shift'],
    'research': ['study', 'investigation', 'analysis', 'inquiry'],
    'discovered': ['found', 'revealed', 'uncovered', 'identified'],
    'author': ['writer', 'narrator', 'speaker', 'he', 'she']
  };
  
  const baseWord = concept.split(' ').pop(); // Get last word
  if (universalSynonyms[baseWord]) {
    variations.push(...universalSynonyms[baseWord]);
  }
  
  return variations;
}

// Detect patchwriting (phrase copying)
function analyzePatchwriting(summary, passage) {
  const getNgrams = (text, n) => {
    const words = normalize(text).split(' ').filter(w => w.length > 0);
    const grams = [];
    for (let i = 0; i <= words.length - n; i++) {
      grams.push(words.slice(i, i + n).join(' '));
    }
    return grams;
  };
  
  const passage4grams = new Set(getNgrams(passage, 4));
  const student4grams = getNgrams(summary, 4);
  
  let copiedCount = 0;
  const copiedPhrases = [];
  
  student4grams.forEach(gram => {
    if (passage4grams.has(gram)) {
      copiedCount++;
      copiedPhrases.push(gram);
    }
  });
  
  // Check for "stitched" summaries (multiple short copied phrases)
  const uniqueCopied = [...new Set(copiedPhrases)];
  const stitchPattern = uniqueCopied.length > 3 && copiedCount > 5;
  
  return {
    copied4grams: copiedCount,
    uniquePhrases: uniqueCopied.slice(0, 5),
    isPatchwriting: copiedCount > 3 || stitchPattern,
    stitchPattern: stitchPattern
  };
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
  if (!passage || typeof passage !== 'object') return { valid: false, error: 'Passage must be an object' };
  if (!passage.text || typeof passage.text !== 'string') return { valid: false, error: 'Passage text required' };
  if (!passage.keyElements || typeof passage.keyElements !== 'object') {
    // Allow but warn if keyElements missing
    console.warn('Warning: keyElements missing, using text analysis');
    passage.keyElements = {
      critical: passage.text.substring(0, 100),
      important: passage.text.substring(100, 200)
    };
  }
  
  return { 
    valid: true,
    text: passage.text,
    critical: passage.keyElements.critical || 'N/A',
    important: passage.keyElements.important || 'N/A',
    conclusion: passage.keyElements.conclusion || passage.keyElements.supplementary?.[0] || 'N/A',
    fullText: passage.text,
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
      return res.status(400).json({
        trait_scores: {
          form: { value: 0, word_count: formCheck.wordCount, notes: 'Invalid form' },
          content: { value: 0, topic_captured: false, pivot_captured: false, conclusion_captured: false, notes: 'Form error' },
          grammar: { value: 0, has_connector: false, notes: 'Form error' },
          vocabulary: { value: 0, notes: 'Form error' }
        },
        overall_score: 0,
        raw_score: 0,
        band: 'Band 5',
        feedback: 'Form validation failed.'
      });
    }

    const passageCheck = validatePassage(passage);
    if (!passageCheck.valid) {
      return res.status(400).json({ error: 'Invalid passage', details: passageCheck.error });
    }

    // Universal content analysis
    const contentAnalysis = analyzeContentUniversal(summary, passageCheck.raw);
    const patchAnalysis = analyzePatchwriting(summary, passageCheck.fullText);
    
    // Determine scores
    const maxContentScore = contentAnalysis.overallContent;
    const contentWarning = contentAnalysis.criticalGaps.length > 0 
      ? `Missing: ${contentAnalysis.criticalGaps.join('; ')}` 
      : '';

    // No API key - strict local scoring
    if (!ANTHROPIC_API_KEY) {
      const hasConnector = ['however', 'although', 'while', 'but', 'yet', 'moreover', 'furthermore', 'therefore', 'thus'].some(c => 
        normalize(summary).includes(c)
      );
      const grammarScore = hasConnector ? 2 : 1;
      const vocabScore = patchAnalysis.isPatchwriting ? 0 : (patchAnalysis.copied4grams > 0 ? 1 : 2);
      
      const rawScore = 1 + maxContentScore + grammarScore + vocabScore;
      const overallScore = Math.min(Math.round((rawScore / 7) * 90), 90);
      
      return res.json({
        trait_scores: {
          form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
          content: { 
            value: maxContentScore, 
            topic_captured: contentAnalysis.topic.captured, 
            pivot_captured: contentAnalysis.pivot.captured, 
            conclusion_captured: contentAnalysis.conclusion.captured,
            notes: contentWarning || 'Universally assessed'
          },
          grammar: { value: grammarScore, has_connector: hasConnector, notes: hasConnector ? 'Connector found' : 'Simple structure' },
          vocabulary: { value: vocabScore, notes: patchAnalysis.isPatchwriting ? 'Patchwriting detected' : 'Original wording' }
        },
        overall_score: overallScore,
        raw_score: rawScore,
        band: overallScore >= 79 ? 'Band 8+' : overallScore >= 65 ? 'Band 7' : overallScore >= 50 ? 'Band 6' : 'Band 5',
        feedback: contentWarning || 'Summary evaluated.',
        content_analysis: contentAnalysis,
        scoring_mode: 'universal_local'
      });
    }

    // AI scoring with universal constraints
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
              max_tokens: 2000,
              temperature: 0.0,
              system: `You are a PTE Academic examiner. UNIVERSAL RULES FOR ALL PASSAGES:

STRICT CONTENT REQUIREMENTS (All passages):
1. TOPIC must be clearly stated (who/what is this about?)
2. PIVOT must show contrast or key turning point
3. If TOPIC is buried/implied rather than stated → Content max 1/2
4. If PIVOT is missing → Content max 1/2
5. If BOTH unclear → Content 0/2

PATCHWRITING DETECTION:
- 4+ word sequences copied = patchwriting
- "Stitching" copied phrases with semicolons = patchwriting
- Changing only 1-2 words in a sentence = patchwriting

SCORING CAPS:
- Vocabulary 0/2 if patchwriting detected
- Content 1/2 max if topic not clearly stated
- Content 0/2 if completely misses main subject`,
              messages: [{
                role: 'user',
                content: `Grade this summary for passage: "${passageCheck.text.substring(0, 300)}..."

KEY ELEMENTS REQUIRED:
- TOPIC: ${passageCheck.critical}
- PIVOT: ${passageCheck.important}
- CONCLUSION: ${passageCheck.conclusion}

STUDENT SUMMARY: "${summary}"

LOCAL ANALYSIS:
- Topic captured: ${contentAnalysis.topic.captured} (score: ${contentAnalysis.topic.score}/2)
- Pivot captured: ${contentAnalysis.pivot.captured} (score: ${contentAnalysis.pivot.score}/2)
- Critical gaps: ${contentAnalysis.criticalGaps.join(', ') || 'None'}
- Patchwriting detected: ${patchAnalysis.isPatchwriting} (${patchAnalysis.copied4grams} copied phrases)

STRICT INSTRUCTIONS:
1. If student buried the topic (e.g., said "it was good" without saying WHAT), reduce Content score
2. If student missed the pivot/contrast entirely, reduce Content score  
3. If student copied phrases verbatim, give Vocabulary 0/2

Return JSON:
{
  "trait_scores": {
    "form": { "value": 1, "word_count": ${formCheck.wordCount}, "notes": "Valid form" },
    "content": { 
      "value": 0-2, 
      "topic_captured": true/false,
      "pivot_captured": true/false,
      "notes": "Explain any deductions for missing/unclear elements"
    },
    "grammar": { "value": 0-2, "has_connector": true/false, "notes": "..." },
    "vocabulary": { "value": 0-2, "patchwriting_detected": true/false, "notes": "..." }
  },
  "deductions": ["List any score reductions and why"],
  "feedback": "Specific feedback on missing elements"
}`
              }]
            })
          }
        );

        if (!response.ok) throw new Error(`API error ${response.status}`);
        
        const data = await response.json();
        const aiContent = data.content?.[0]?.text;
        if (!aiContent) throw new Error('Empty AI response');
        
        const aiResult = extractJSON(aiContent);
        if (!aiResult) throw new Error('JSON parse failed');

        // Apply universal caps regardless of AI score
        let finalContent = Math.min(Math.max(Number(aiResult.trait_scores?.content?.value) || 0, 0), 2);
        let finalVocab = Math.min(Math.max(Number(aiResult.trait_scores?.vocabulary?.value) || 2, 0), 2);
        
        // ENFORCE: Content cap if topic missing
        if (!contentAnalysis.topic.captured && finalContent > 1) {
          finalContent = 1;
        }
        if (contentAnalysis.topic.score === 0 && finalContent > 0) {
          finalContent = 0;
        }
        
        // ENFORCE: Content cap if pivot missing
        if (!contentAnalysis.pivot.captured && finalContent > 1) {
          finalContent = 1;
        }
        
        // ENFORCE: Vocab 0 if patchwriting
        if (patchAnalysis.isPatchwriting) {
          finalVocab = 0;
        }
        
        const grammarScore = Math.min(Math.max(Number(aiResult.trait_scores?.grammar?.value) || 1, 0), 2);
        const rawScore = 1 + finalContent + grammarScore + finalVocab;
        const overallScore = Math.min(Math.round((rawScore / 7) * 90), 90);
        const bands = ['Band 5', 'Band 5', 'Band 6', 'Band 7', 'Band 8', 'Band 9', 'Band 9', 'Band 9'];

        return res.json({
          trait_scores: {
            form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
            content: {
              value: finalContent,
              topic_captured: contentAnalysis.topic.captured,
              pivot_captured: contentAnalysis.pivot.captured,
              conclusion_captured: contentAnalysis.conclusion.captured,
              notes: aiResult.trait_scores?.content?.notes || ''
            },
            grammar: {
              value: grammarScore,
              has_connector: !!aiResult.trait_scores?.grammar?.has_connector,
              notes: aiResult.trait_scores?.grammar?.notes || ''
            },
            vocabulary: {
              value: finalVocab,
              patchwriting_detected: patchAnalysis.isPatchwriting,
              notes: patchAnalysis.isPatchwriting 
                ? `Copied phrases: ${patchAnalysis.uniquePhrases.join(', ')}...` 
                : (aiResult.trait_scores?.vocabulary?.notes || 'Original')
            }
          },
          overall_score: overallScore,
          raw_score: rawScore,
          band: bands[rawScore] || 'Band 5',
          feedback: aiResult.feedback || contentWarning || 'Evaluated',
          content_analysis: {
            topic_score: contentAnalysis.topic.score,
            pivot_score: contentAnalysis.pivot.score,
            critical_gaps: contentAnalysis.criticalGaps,
            enforced_caps: {
              content_capped: finalContent < (aiResult.trait_scores?.content?.value || 0),
              vocab_capped: finalVocab < (aiResult.trait_scores?.vocabulary?.value || 0)
            }
          },
          scoring_mode: 'universal_ai_validated'
        });
        
      } catch (apiError) {
        lastError = apiError;
        if (attempt < 1) await new Promise(r => setTimeout(r, 1000));
      }
    }

    // Fallback
    const rawScore = 1 + maxContentScore + 1 + (patchAnalysis.isPatchwriting ? 0 : 2);
    res.json({
      trait_scores: {
        form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
        content: { 
          value: maxContentScore, 
          topic_captured: contentAnalysis.topic.captured,
          pivot_captured: contentAnalysis.pivot.captured,
          notes: contentAnalysis.criticalGaps.join('; ') || 'Local analysis'
        },
        grammar: { value: 1, has_connector: false, notes: 'Fallback' },
        vocabulary: { value: patchAnalysis.isPatchwriting ? 0 : 2, notes: 'Fallback' }
      },
      overall_score: Math.min(Math.round((rawScore / 7) * 90), 90),
      raw_score: rawScore,
      band: 'Band 7',
      feedback: contentWarning || 'AI unavailable - local scoring applied',
      content_analysis: contentAnalysis,
      warning: 'AI failed, using universal local analysis'
    });

  } catch (error) {
    console.error('Grading error:', error);
    res.status(500).json({ error: 'Internal error', message: error.message });
  }
});

app.get('/api/grade', (req, res) => {
  res.status(405).json({ error: 'Use POST method' });
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    anthropicConfigured: !!ANTHROPIC_API_KEY, 
    version: '3.0.0',
    features: ['universal_content_validation', 'dynamic_topic_detection', 'patchwriting_detection', 'strict_scoring_caps']
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ PTE Scoring API v3.0.0 (Universal) on port ${PORT}`);
  console.log(`🌍 Works with any passage type`);
  console.log(`📋 Strict validation: Topic + Pivot mandatory for all`);
});
