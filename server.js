const express = require('express');
const cors = require('cors');

const app = express();
const PORT = parseInt(process.env.PORT) || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ============ SMART CONCEPT DETECTION ============

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
  
  return { wordCount, isValidForm, errors: isValidForm ? [] : errors };
}

// Extract semantic concepts (meaning-bearing words)
function extractConcepts(text) {
  if (!text) return [];
  
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    'may', 'might', 'must', 'shall', 'can', 'need', 'to', 'of', 'in', 'for', 'on', 'with', 
    'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 
    'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 
    'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 
    'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or', 
    'because', 'until', 'while', 'this', 'that', 'these', 'those', 'they', 'them', 'their', 
    'there', 'then', 'than', 'also', 'its', 'it', 'he', 'she', 'his', 'her', 'him', 'we', 'us', 
    'our', 'you', 'your', 'i', 'me', 'my', 'mine', 'am', 'get', 'got', 'gets', 'getting', 'go', 
    'goes', 'went', 'going', 'gone', 'make', 'makes', 'made', 'making', 'take', 'takes', 'took', 
    'taking', 'come', 'comes', 'came', 'coming', 'see', 'sees', 'saw', 'seen', 'seeing', 'know', 
    'knows', 'knew', 'known', 'knowing', 'think', 'thinks', 'thought', 'thinking', 'say', 'says', 
    'said', 'saying', 'use', 'uses', 'used', 'using', 'find', 'finds', 'found', 'finding', 'give', 
    'gives', 'gave', 'given', 'giving', 'tell', 'tells', 'told', 'telling', 'become', 'becomes', 
    'became', 'becoming', 'leave', 'leaves', 'left', 'leaving', 'put', 'puts', 'putting', 'mean', 
    'means', 'meant', 'meaning', 'keep', 'keeps', 'kept', 'keeping', 'let', 'lets', 'letting', 
    'begin', 'begins', 'began', 'begun', 'beginning', 'seem', 'seems', 'seemed', 'seeming', 'help', 
    'helps', 'helped', 'helping', 'show', 'shows', 'showed', 'shown', 'showing', 'hear', 'hears', 
    'heard', 'hearing', 'play', 'plays', 'played', 'playing', 'run', 'runs', 'ran', 'running', 
    'move', 'moves', 'moved', 'moving', 'live', 'lives', 'lived', 'living', 'believe', 'believes', 
    'believed', 'believing', 'bring', 'brings', 'brought', 'bringing', 'happen', 'happens', 
    'happened', 'happening', 'write', 'writes', 'wrote', 'written', 'writing', 'provide', 'provides', 
    'provided', 'providing', 'sit', 'sits', 'sat', 'sitting', 'stand', 'stands', 'stood', 'standing', 
    'lose', 'loses', 'lost', 'losing', 'pay', 'pays', 'paid', 'paying', 'meet', 'meets', 'met', 
    'meeting', 'include', 'includes', 'included', 'including', 'continue', 'continues', 'continued', 
    'continuing', 'set', 'sets', 'setting', 'learn', 'learns', 'learned', 'learning', 'change', 
    'changes', 'changed', 'changing', 'lead', 'leads', 'led', 'leading', 'understand', 'understands', 
    'understood', 'understanding', 'watch', 'watches', 'watched', 'watching', 'follow', 'follows', 
    'followed', 'following', 'stop', 'stops', 'stopped', 'stopping', 'create', 'creates', 'created', 
    'creating', 'speak', 'speaks', 'spoke', 'spoken', 'speaking', 'read', 'reads', 'reading', 'allow', 
    'allows', 'allowed', 'allowing', 'add', 'adds', 'added', 'adding', 'spend', 'spends', 'spent', 
    'spending', 'grow', 'grows', 'grew', 'grown', 'growing', 'open', 'opens', 'opened', 'opening', 
    'walk', 'walks', 'walked', 'walking', 'win', 'wins', 'won', 'winning', 'offer', 'offers', 'offered', 
    'offering', 'remember', 'remembers', 'remembered', 'remembering', 'love', 'loves', 'loved', 'loving', 
    'consider', 'considers', 'considered', 'considering', 'appear', 'appears', 'appeared', 'appearing', 
    'buy', 'buys', 'bought', 'buying', 'wait', 'waits', 'waited', 'waiting', 'serve', 'serves', 'served', 
    'serving', 'die', 'dies', 'died', 'dying', 'send', 'sends', 'sent', 'sending', 'expect', 'expects', 
    'expected', 'expecting', 'build', 'builds', 'built', 'building', 'stay', 'stays', 'stayed', 'staying', 
    'fall', 'falls', 'fell', 'fallen', 'falling', 'cut', 'cuts', 'cutting', 'reach', 'reaches', 'reached', 
    'reaching', 'kill', 'kills', 'killed', 'killing', 'remain', 'remains', 'remained', 'remaining', 'suggest', 
    'suggests', 'suggested', 'suggesting', 'raise', 'raises', 'raised', 'raising', 'pass', 'passes', 'passed', 
    'passing', 'sell', 'sells', 'sold', 'selling', 'require', 'requires', 'required', 'requiring', 'report', 
    'reports', 'reported', 'reporting', 'decide', 'decides', 'decided', 'deciding', 'pull', 'pulls', 'pulled', 
    'pulling']);
  
  return text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));
}

// Calculate Jaccard similarity
function calculateSimilarity(text1, text2) {
  const concepts1 = new Set(extractConcepts(text1));
  const concepts2 = new Set(extractConcepts(text2));
  
  if (concepts1.size === 0 || concepts2.size === 0) return 0;
  
  const intersection = new Set([...concepts1].filter(x => concepts2.has(x)));
  const union = new Set([...concepts1, ...concepts2]);
  
  return intersection.size / union.size;
}

// SMART concept detection with validation
function detectConceptsSmart(summary, passage) {
  const sumLower = summary.toLowerCase();
  
  // Get key elements
  const topicText = passage.keyElements?.critical || '';
  const pivotText = passage.keyElements?.important || '';
  const conclusionText = passage.keyElements?.conclusion || passage.keyElements?.supplementary?.[0] || '';
  
  // ========== TOPIC DETECTION ==========
  // Check if main subject is present
  const topicConcepts = extractConcepts(topicText);
  const topicMatches = topicConcepts.filter(c => sumLower.includes(c));
  const topicSim = calculateSimilarity(summary, topicText);
  const topicCaptured = topicMatches.length >= Math.max(2, topicConcepts.length * 0.25) || topicSim >= 0.2;
  
  // ========== PIVOT DETECTION (SMART) ==========
  // Pivot requires: (1) main topic present AND (2) contrasting element present
  const pivotConcepts = extractConcepts(pivotText);
  
  // Extract the "contrast" part of pivot (usually after "despite", "although", "while", "but")
  const contrastKeywords = ['despite', 'although', 'while', 'but', 'however', 'yet', 'though', 'whereas', 'nevertheless'];
  let pivotContrastPart = pivotText;
  
  for (const kw of contrastKeywords) {
    const idx = pivotText.toLowerCase().indexOf(kw);
    if (idx !== -1) {
      pivotContrastPart = pivotText.substring(idx + kw.length).trim();
      break;
    }
  }
  
  // Check if contrast concepts are in summary
  const contrastConcepts = extractConcepts(pivotContrastPart);
  const contrastMatches = contrastConcepts.filter(c => sumLower.includes(c));
  const hasContrastElement = contrastMatches.length >= 1 || contrastKeywords.some(kw => sumLower.includes(kw));
  
  // Pivot is captured if: topic element present AND contrast element present
  const pivotCaptured = topicMatches.length >= 1 && hasContrastElement;
  const pivotSim = calculateSimilarity(summary, pivotText);
  
  // ========== CONCLUSION DETECTION ==========
  const conclusionConcepts = extractConcepts(conclusionText);
  const conclusionMatches = conclusionConcepts.filter(c => sumLower.includes(c));
  const conclusionSim = conclusionText ? calculateSimilarity(summary, conclusionText) : 1;
  const conclusionCaptured = !conclusionText || conclusionMatches.length >= 1 || conclusionSim >= 0.15;
  
  // ========== CONTRADICTION DETECTION ==========
  const contradictions = [];
  const passageLower = (passage.text || '').toLowerCase();
  
  // Check for reversed relationships
  const reversals = [
    { pos: 'not talent but persistence', neg: 'talent not persistence', desc: 'Reversed: talent over persistence' },
    { pos: 'reading remains', neg: 'reading declining', desc: 'Reversed: reading declining' },
    { pos: 'advantages outweigh', neg: 'disadvantages outweigh', desc: 'Reversed: disadvantages over advantages' },
    { pos: 'more important', neg: 'less important', desc: 'Reversed: importance' }
  ];
  
  for (const r of reversals) {
    if (passageLower.includes(r.pos.split(' ')[0]) && sumLower.includes(r.neg.split(' ')[0])) {
      if (passageLower.includes(r.pos.split(' ').slice(-1)[0]) && sumLower.includes(r.neg.split(' ').slice(-1)[0])) {
        contradictions.push(r.desc);
      }
    }
  }
  
  // Check for negation flips
  const negations = ['not', 'no', 'never', 'nothing', 'neither', 'nor', 'hardly', 'scarcely', 'barely'];
  const keyPhrases = extractConcepts(passage.text || '').slice(0, 10);
  
  for (const phrase of keyPhrases) {
    const phraseInPassage = passageLower.includes(phrase);
    const negatedInSummary = negations.some(n => {
      const idx = sumLower.indexOf(phrase);
      if (idx === -1) return false;
      const before = sumLower.substring(Math.max(0, idx - 20), idx);
      return before.includes(` ${n} `) || before.endsWith(` ${n}`);
    });
    
    if (phraseInPassage && negatedInSummary) {
      contradictions.push(`Negation: "${phrase}"`);
    }
  }
  
  return {
    topic: {
      captured: topicCaptured,
      matches: topicMatches.length,
      total: topicConcepts.length,
      similarity: Math.round(topicSim * 100)
    },
    pivot: {
      captured: pivotCaptured,
      hasContrastElement,
      contrastMatches: contrastMatches.length,
      similarity: Math.round(pivotSim * 100)
    },
    conclusion: {
      captured: conclusionCaptured,
      matches: conclusionMatches.length,
      similarity: Math.round(conclusionSim * 100)
    },
    contradictions
  };
}

// Calculate content score based on detection
function calculateContentScore(detection) {
  let score = 2;
  
  // Topic is critical
  if (!detection.topic.captured) {
    score -= 1;
  }
  
  // Pivot is important
  if (!detection.pivot.captured) {
    score -= 0.5;
  }
  
  // Conclusion is supplementary
  if (!detection.conclusion.captured) {
    score -= 0.3;
  }
  
  // Contradictions are severe
  if (detection.contradictions.length > 0) {
    score -= 0.5 * detection.contradictions.length;
  }
  
  return Math.max(0, Math.round(score));
}

// ============ AI VALIDATION ============

async function validateWithAI(summary, passage, localDetection, localScore) {
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
        max_tokens: 800,
        temperature: 0,
        system: `You are a PTE Academic validator. Your job is to verify if the local analysis correctly identified captured concepts.

VALIDATION RULES:
1. TOPIC captured = main subject of passage appears in summary
2. PIVOT captured = BOTH main topic AND contrasting element appear in summary
3. CONCLUSION captured = result/implication appears in summary
4. CONTRADICTION = summary says opposite of passage

Respond with JSON only.`,
        messages: [{
          role: 'user',
          content: `PASSAGE: "${passage.text}"

KEY ELEMENTS:
- TOPIC: ${passage.keyElements?.critical}
- PIVOT: ${passage.keyElements?.important}
- CONCLUSION: ${passage.keyElements?.conclusion || passage.keyElements?.supplementary?.[0]}

STUDENT SUMMARY: "${summary}"

LOCAL ANALYSIS:
- Topic captured: ${localDetection.topic.captured} (${localDetection.topic.matches}/${localDetection.topic.total} concepts, ${localDetection.topic.similarity}% sim)
- Pivot captured: ${localDetection.pivot.captured} (hasContrast: ${localDetection.pivot.hasContrastElement}, ${localDetection.pivot.similarity}% sim)
- Conclusion captured: ${localDetection.conclusion.captured} (${localDetection.conclusion.similarity}% sim)
- Contradictions: ${localDetection.contradictions.join(', ') || 'None'}

Validate and return JSON:
{
  "validation": {
    "topic_correct": true/false,
    "pivot_correct": true/false,
    "conclusion_correct": true/false,
    "contradictions_correct": true/false
  },
  "adjustments": {
    "topic_override": true/false/null,
    "pivot_override": true/false/null,
    "conclusion_override": true/false/null
  },
  "reason": "brief explanation"
}`
        }]
      })
    });

    if (!response.ok) return null;
    
    const data = await response.json();
    const aiContent = data.content?.[0]?.text;
    const jsonMatch = aiContent?.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) return null;
    
    return JSON.parse(jsonMatch[0]);
    
  } catch (error) {
    console.error('AI validation error:', error);
    return null;
  }
}

// ============ API ENDPOINTS ============

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    version: '4.0.0',
    anthropicConfigured: !!ANTHROPIC_API_KEY,
    policy: 'Smart concept detection with AI validation'
  });
});

app.post('/api/grade', async (req, res) => {
  console.log('Grade request received');
  
  try {
    const { summary, passage } = req.body;
    
    if (!summary || !passage) {
      return res.status(400).json({ error: 'Missing summary or passage' });
    }

    // Step 1: Form validation
    const formCheck = validateForm(summary);
    
    if (!formCheck.isValidForm) {
      return res.json({
        trait_scores: {
          form: { value: 0, word_count: formCheck.wordCount, notes: formCheck.errors.join('; ') },
n          content: { value: 0, topic_captured: false, pivot_captured: false, conclusion_captured: false, notes: 'Form error' },
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

    // Step 2: Smart concept detection
    const detection = detectConceptsSmart(summary, passage);
    console.log('Smart detection:', detection);
    
    // Step 3: Calculate content score
    let contentScore = calculateContentScore(detection);
    
    // Step 4: AI validation for borderline cases
    let aiValidation = null;
    let useAIResult = false;
    
    if (ANTHROPIC_API_KEY && (contentScore === 1 || detection.contradictions.length > 0)) {
      aiValidation = await validateWithAI(summary, passage, detection, contentScore);
      
      if (aiValidation) {
        // Apply AI overrides if provided
        if (aiValidation.adjustments?.topic_override !== null) {
          detection.topic.captured = aiValidation.adjustments.topic_override;
        }
        if (aiValidation.adjustments?.pivot_override !== null) {
          detection.pivot.captured = aiValidation.adjustments.pivot_override;
        }
        if (aiValidation.adjustments?.conclusion_override !== null) {
          detection.conclusion.captured = aiValidation.adjustments.conclusion_override;
        }
        
        // Recalculate score after adjustments
        contentScore = calculateContentScore(detection);
        useAIResult = true;
      }
    }
    
    // Step 5: Grammar check
    const connectorPattern = /\b(however|although|while|but|yet|nevertheless|whereas|despite|though|moreover|furthermore|therefore|thus|hence|consequently)\b/i;
    const hasConnector = connectorPattern.test(summary);
    const grammarScore = hasConnector ? 2 : 1;
    
    // Step 6: Build result
    const rawScore = 1 + contentScore + grammarScore + 2;
    const overallScore = Math.min(Math.round((rawScore / 7) * 90), 90);
    const bands = ['Band 5', 'Band 5', 'Band 6', 'Band 7', 'Band 8', 'Band 9', 'Band 9', 'Band 9'];
    
    const result = {
      trait_scores: {
        form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
        content: {
          value: contentScore,
          topic_captured: detection.topic.captured,
          pivot_captured: detection.pivot.captured,
          conclusion_captured: detection.conclusion.captured,
          notes: detection.contradictions.length > 0 
            ? `Contradictions: ${detection.contradictions.join(', ')}`
            : `Topic: ${detection.topic.similarity}%, Pivot: ${detection.pivot.similarity}%`
        },
        grammar: {
          value: grammarScore,
          has_connector: hasConnector,
          notes: hasConnector ? 'Connector present' : 'No connector'
        },
        vocabulary: { value: 2, notes: 'Verbatim and paraphrase accepted' }
      },
      overall_score: overallScore,
      raw_score: rawScore,
      band: bands[rawScore] || 'Band 5',
      feedback: detection.contradictions.length > 0
        ? `Contradictions detected: ${detection.contradictions.join(', ')}`
        : contentScore >= 2
          ? 'Excellent coverage of key ideas'
          : contentScore >= 1
            ? 'Good coverage, some elements could be clearer'
            : 'Key ideas missing or unclear',
      scoring_mode: useAIResult ? 'ai_validated' : 'local',
      detection_details: detection
    };
    
    console.log('Final result:', result);
    res.json(result);
    
  } catch (error) {
    console.error('Grading error:', error);
    res.status(500).json({ error: 'Internal error', message: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ PTE Scoring API v4.0.0 (Smart Detection) on port ${PORT}`);
  console.log(`🤖 AI validation: ${ANTHROPIC_API_KEY ? 'Enabled' : 'Disabled'}`);
});
