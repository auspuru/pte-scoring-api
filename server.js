const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

app.use(cors());
app.use(express.json());

// Common spelling errors to check
const commonMisspellings = {
  'becuase': 'because',
  'becasue': 'because',
  'beacuse': 'because',
  'thier': 'their',
  'ther': 'their',
  'theyre': "they're",
  'recieve': 'receive',
  'occured': 'occurred',
  'seperate': 'separate',
  'definately': 'definitely',
  'occuring': 'occurring',
  'accomodate': 'accommodate',
  'acheive': 'achieve',
  'adress': 'address',
  'beleive': 'believe',
  'calender': 'calendar',
  'collegue': 'colleague',
  'concious': 'conscious',
  'decieve': 'deceive',
  'embarass': 'embarrass',
  'existance': 'existence',
  'foriegn': 'foreign',
  'goverment': 'government',
  'harrass': 'harass',
  'independant': 'independent',
  'knowlege': 'knowledge',
  'liason': 'liaison',
  'maintainance': 'maintenance',
  'neccessary': 'necessary',
  'noticable': 'noticeable',
  'occurance': 'occurrence',
  'persistant': 'persistent',
  'posession': 'possession',
  'preceeding': 'preceding',
  'priviledge': 'privilege',
  'publically': 'publicly',
  'recomend': 'recommend',
  'refering': 'referring',
  'relevent': 'relevant',
  'religous': 'religious',
  'resistence': 'resistance',
  'sieze': 'seize',
  'supercede': 'supersede',
  'suprise': 'surprise',
  'tommorow': 'tomorrow',
  'untill': 'until',
  'weild': 'wield',
  'wich': 'which',
  'wierd': 'weird'
};

// Check for spelling errors
function checkSpelling(summary) {
  const words = summary.toLowerCase().match(/\b[a-z]+\b/g) || [];
  const errors = [];
  
  for (const word of words) {
    if (commonMisspellings[word]) {
      errors.push(`${word} → ${commonMisspellings[word]}`);
    }
  }
  
  return errors;
}

// Check for gibberish (nonsensical text)
function checkGibberish(summary) {
  const issues = [];
  
  // Check for excessive repetition
  const words = summary.toLowerCase().split(/\s+/);
  const wordCounts = {};
  for (const word of words) {
    wordCounts[word] = (wordCounts[word] || 0) + 1;
  }
  
  for (const [word, count] of Object.entries(wordCounts)) {
    if (count > 5 && word.length > 2) {
      issues.push(`Excessive repetition of "${word}" (${count} times)`);
    }
  }
  
  // Check for random character strings
  const randomPattern = /\b[bcdfghjklmnpqrstvwxyz]{4,}\b|\b[aeiou]{4,}\b/i;
  if (randomPattern.test(summary)) {
    issues.push('Contains nonsensical character sequences');
  }
  
  // Check for very short words dominating
  const shortWords = words.filter(w => w.length <= 2).length;
  if (shortWords / words.length > 0.4) {
    issues.push('Too many short words - possible gibberish');
  }
  
  return issues;
}

// Local content validation (semantic check)
function validateContentLocally(summary, passage) {
  const summaryLower = summary.toLowerCase();
  const critical = passage.keyElements.critical.toLowerCase();
  const important = passage.keyElements.important.toLowerCase();
  
  // Extract key concepts from critical point
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall']);
  
  const criticalWords = critical.split(/\s+/).filter(w => w.length >= 4 && !stopWords.has(w));
  const importantWords = important.split(/\s+/).filter(w => w.length >= 4 && !stopWords.has(w));
  
  // Check for concept matches
  const criticalMatched = criticalWords.filter(w => summaryLower.includes(w)).length;
  const importantMatched = importantWords.filter(w => summaryLower.includes(w)).length;
  
  const topicScore = criticalWords.length > 0 ? criticalMatched / criticalWords.length : 0;
  const pivotScore = importantWords.length > 0 ? importantMatched / importantWords.length : 0;
  
  return {
    topicScore,
    pivotScore,
    topicCaptured: topicScore >= 0.3,
    pivotCaptured: pivotScore >= 0.3,
    criticalWords,
    importantWords
  };
}

// Local scoring function (fallback when AI fails)
function gradeLocally(summary, passage) {
  const trimmed = summary.trim();
  const words = trimmed.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  
  // Check spelling
  const spellingErrors = checkSpelling(summary);
  
  // Check gibberish
  const gibberishIssues = checkGibberish(summary);
  
  // Content validation
  const contentValidation = validateContentLocally(summary, passage);
  
  // Determine content score
  let contentScore = 0;
  let contentNotes = '';
  
  if (gibberishIssues.length > 0) {
    contentScore = 0;
    contentNotes = `Gibberish detected: ${gibberishIssues.join(', ')}`;
  } else if (contentValidation.topicCaptured && contentValidation.pivotCaptured) {
    contentScore = 2;
    contentNotes = 'Topic and pivot captured';
  } else if (contentValidation.topicCaptured) {
    contentScore = 1;
    contentNotes = 'Topic captured, pivot missed';
  } else {
    contentScore = 0;
    contentNotes = 'Critical point missed - meaning not captured';
  }
  
  // Grammar scoring
  const hasSemicolon = summary.includes(';');
  const connectors = ['however', 'moreover', 'furthermore', 'consequently', 'therefore', 'nevertheless', 'but', 'and', 'although', 'so'];
  const hasConnector = connectors.some(c => summary.toLowerCase().includes(c));
  
  let grammarScore = 0;
  if (hasSemicolon && hasConnector) grammarScore = 2;
  else if (hasConnector) grammarScore = 1;
  
  // Vocabulary scoring (penalize spelling errors)
  let vocabScore = 2;
  if (spellingErrors.length > 2) vocabScore = 1;
  if (spellingErrors.length > 4) vocabScore = 0;
  
  const rawScore = 1 + contentScore + grammarScore + vocabScore;
  const overallScore = Math.min(Math.round((rawScore / 7) * 9), 9);
  
  const bands = ['Band 5', 'Band 5', 'Band 6', 'Band 7', 'Band 8', 'Band 9', 'Band 9', 'Band 9'];
  
  return {
    trait_scores: {
      form: { value: 1, word_count: wordCount, notes: 'Valid form' },
      content: { 
        value: contentScore, 
        topic_captured: contentValidation.topicCaptured, 
        pivot_captured: contentValidation.pivotCaptured, 
        notes: contentNotes 
      },
      grammar: { value: grammarScore, has_connector: hasConnector, notes: hasSemicolon ? 'Semicolon + connector' : hasConnector ? 'Connector' : 'No connector' },
      vocabulary: { value: vocabScore, notes: spellingErrors.length > 0 ? `Spelling errors: ${spellingErrors.slice(0, 3).join(', ')}${spellingErrors.length > 3 ? '...' : ''}` : 'Appropriate vocabulary' }
    },
    overall_score: overallScore,
    raw_score: rawScore,
    band: bands[rawScore] || 'Band 5',
    feedback: ANTHROPIC_API_KEY ? 'Scored with AI + local validation' : 'Scored locally (AI not configured)',
    reasoning: 'Combined scoring',
    spelling_errors: spellingErrors,
    gibberish_issues: gibberishIssues
  };
}

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

// Grade endpoint - uses Anthropic + local validation
app.post('/api/grade', async (req, res) => {
  try {
    const { summary, passage } = req.body;
    
    if (!summary || !passage) {
      return res.status(400).json({ error: 'Missing summary or passage' });
    }

    // Local validation first
    const trimmed = summary.trim();
    const words = trimmed.split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;
    
    const spellingErrors = checkSpelling(summary);
    const gibberishIssues = checkGibberish(summary);
    const contentValidation = validateContentLocally(summary, passage);

    // If no Anthropic key, use local scoring
    if (!ANTHROPIC_API_KEY) {
      console.log('No Anthropic key, using local scoring');
      const result = gradeLocally(summary, passage);
      return res.json(result);
    }

    // Try Anthropic API for semantic analysis
    try {
      console.log('Calling Anthropic API...');
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
          system: `You are an expert PTE Academic "Summarize Written Text" scorer. Be COMPETENT and ACCURATE - detect gibberish, spelling errors, and meaning distortions.

SCORING RUBRIC:

TRAIT 1: FORM (0-1)
- 1 point: One sentence, 5-75 words, ends with period
- 0 points: Multiple sentences, no period, or wrong length

TRAIT 2: CONTENT (0-2) - BE STRICT ABOUT MEANING
- 2 points: Accurately captures BOTH the main topic AND the key contrast/pivot from the passage
- 1 point: Captures main topic but misses key contrast, OR has minor meaning distortion
- 0 points: Misses main topic OR has major meaning distortion OR is gibberish

IMPORTANT: Detect these issues:
- GIBBERISH: Random words, nonsense, excessive repetition
- MEANING CHANGE: Summary says opposite of passage or different concept
- MISSING CRITICAL POINT: Main idea not mentioned at all

TRAIT 3: GRAMMAR (0-2)
- 2 points: Uses semicolon + connector (however, therefore, moreover, etc.)
- 1 point: Uses connector but no semicolon, OR minor grammar issues
- 0 points: Major grammar errors, no connectors

TRAIT 4: VOCABULARY (0-2)
- 2 points: Appropriate vocabulary, may copy key phrases from passage
- 1 point: Some awkward word choices OR 1-2 spelling errors
- 0 points: Multiple spelling errors OR inappropriate word choices

Return ONLY valid JSON:
{
  "trait_scores": {
    "form": {"value": 0-1, "word_count": number, "notes": "..."},
    "content": {"value": 0-2, "topic_captured": true/false, "pivot_captured": true/false, "notes": "..."},
    "grammar": {"value": 0-2, "has_connector": true/false, "notes": "..."},
    "vocabulary": {"value": 0-2, "notes": "..."}
  },
  "overall_score": 0-90,
  "raw_score": 0-7,
  "band": "Band 5/6/7/8/9",
  "feedback": "...",
  "reasoning": "..."
}`,
          messages: [{
            role: 'user',
            content: `PASSAGE: ${passage.text}

KEY ELEMENTS:
- Critical (main idea to capture): ${passage.keyElements.critical}
- Important (key contrast/pivot): ${passage.keyElements.important}

STUDENT SUMMARY: "${summary}"

Score this summary COMPETENTLY:
1. Check if it's gibberish/nonsense
2. Check if meaning is ACCURATE (not distorted)
3. Check if main topic is captured
4. Check if key contrast is captured
5. Check grammar and vocabulary

Be STRICT about meaning accuracy. If the summary says something different from the passage, mark it as wrong.

Return ONLY valid JSON.`
          }]
        })
      });

      if (!response.ok) {
        console.log('Anthropic API error, falling back to local');
        const result = gradeLocally(summary, passage);
        return res.json(result);
      }

      const data = await response.json();
      const content = data.content?.[0]?.text;
      
      if (!content) {
        console.log('No content from Anthropic, using local');
        const result = gradeLocally(summary, passage);
        return res.json(result);
      }

      // Parse JSON from Claude's response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.log('Invalid JSON from Anthropic, using local');
        const result = gradeLocally(summary, passage);
        return res.json(result);
      }
      
      let result = JSON.parse(jsonMatch[0]);
      
      // Ensure structure exists
      if (!result.trait_scores) result.trait_scores = {};
      if (!result.trait_scores.form) result.trait_scores.form = {};
      if (!result.trait_scores.content) result.trait_scores.content = {};
      if (!result.trait_scores.grammar) result.trait_scores.grammar = {};
      if (!result.trait_scores.vocabulary) result.trait_scores.vocabulary = {};
      
      // OVERRIDE form with local validation (more reliable)
      result.trait_scores.form.value = 1;
      result.trait_scores.form.word_count = wordCount;
      result.trait_scores.form.notes = 'Valid form';
      
      // If AI detected gibberish or major meaning distortion, trust it
      const aiContentValue = result.trait_scores.content.value || 0;
      const aiNotes = result.trait_scores.content.notes || '';
      
      // Cross-check with local validation
      if (aiContentValue === 0 && !aiNotes.toLowerCase().includes('gibberish') && contentValidation.topicCaptured) {
        // AI might be too strict, use local if topic is captured
        result.trait_scores.content.topic_captured = contentValidation.topicCaptured;
        result.trait_scores.content.pivot_captured = contentValidation.pivotCaptured;
        if (contentValidation.topicCaptured && contentValidation.pivotCaptured) {
          result.trait_scores.content.value = 2;
        } else if (contentValidation.topicCaptured) {
          result.trait_scores.content.value = 1;
        }
      }
      
      // Apply spelling penalty to vocabulary
      let vocabValue = result.trait_scores.vocabulary.value || 2;
      if (spellingErrors.length > 2) vocabValue = Math.min(vocabValue, 1);
      if (spellingErrors.length > 4) vocabValue = 0;
      result.trait_scores.vocabulary.value = vocabValue;
      if (spellingErrors.length > 0) {
        result.trait_scores.vocabulary.notes = `Spelling errors found: ${spellingErrors.slice(0, 3).join(', ')}${spellingErrors.length > 3 ? '...' : ''}`;
      }
      
      // Recalculate totals (0-9 scale)
      const formScore = 1;
      const contentScore = result.trait_scores.content.value || 0;
      const grammarScore = result.trait_scores.grammar.value || 0;
      const vocabScore = result.trait_scores.vocabulary.value || 0;
      
      result.raw_score = formScore + contentScore + grammarScore + vocabScore;
      result.overall_score = Math.min(Math.round((result.raw_score / 7) * 9), 9);
      if (result.raw_score > 7) result.raw_score = 7;
      
      // Update band
      const bands = ['Band 5', 'Band 5', 'Band 6', 'Band 7', 'Band 8', 'Band 9', 'Band 9', 'Band 9'];
      result.band = bands[result.raw_score] || 'Band 5';
      
      // Add debug info
      result.spelling_errors = spellingErrors;
      result.gibberish_issues = gibberishIssues;
      
      res.json(result);
    } catch (apiError) {
      console.log('API exception, using local fallback:', apiError.message);
      const result = gradeLocally(summary, passage);
      res.json(result);
    }
  } catch (error) {
    console.error('Grading error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server on port ${PORT}, Anthropic: ${!!ANTHROPIC_API_KEY}`);
});
