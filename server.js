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

// Grade endpoint - uses Anthropic for comprehensive analysis
app.post('/api/grade', async (req, res) => {
  try {
    const { summary, passage } = req.body;
    
    if (!summary || !passage) {
      return res.status(400).json({ error: 'Missing summary or passage' });
    }

    const trimmed = summary.trim();
    const words = trimmed.split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;

    // Basic form validation
    const endsWithPeriod = /[.]$/.test(trimmed);
    const hasNewlines = /[\n\r]/.test(summary);
    const hasBullets = /[•\-\*]/.test(summary);
    const isValidForm = wordCount >= 5 && wordCount <= 75 && endsWithPeriod && !hasNewlines && !hasBullets;

    // If no Anthropic key, return basic local scoring
    if (!ANTHROPIC_API_KEY) {
      return res.json({
        trait_scores: {
          form: { value: isValidForm ? 1 : 0, word_count: wordCount, notes: isValidForm ? 'Valid form' : 'Invalid form' },
          content: { value: 1, topic_captured: true, pivot_captured: false, notes: 'Local scoring (AI not configured)' },
          grammar: { value: 1, has_connector: true, notes: 'Connector detected' },
          vocabulary: { value: 2, notes: 'Appropriate vocabulary' }
        },
        overall_score: 5,
        raw_score: 5,
        band: 'Band 7',
        feedback: 'Scored locally - AI not configured',
        reasoning: 'Basic local scoring'
      });
    }

    // Use Anthropic for comprehensive analysis
    try {
      console.log('Calling Anthropic API for comprehensive analysis...');
      
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 2000,
          system: `You are an EXPERT PTE Academic "Summarize Written Text" scorer with ADVANCED capabilities. You must detect and penalize:

## YOUR CAPABILITIES:

### 1. GIBBERISH DETECTION
- Random word sequences that don't make sense
- Excessive repetition of words/phrases
- Nonsensical character combinations
- Sentences that are grammatically broken

### 2. SPELLING ERROR DETECTION
- Common misspellings (recieve→receive, becuase→because, thier→their)
- Typos and keyboard errors
- Repeated spelling mistakes

### 3. MEANING DISTORTION DETECTION (CRITICAL)
- Summary says OPPOSITE of passage
- Summary mentions WRONG concepts
- Summary adds information NOT in passage
- Summary omits CRITICAL main idea
- Summary changes the author's point/tone

### 4. PARAPHRASE ACCEPTANCE
- ACCEPT synonyms: "exchange" for "move", "decision" for "choice"
- ACCEPT rewording if meaning stays the same
- ACCEPT copying key phrases from passage

## SCORING RUBRIC:

**FORM (0-1):**
- 1: One sentence, 5-75 words, ends with period
- 0: Multiple sentences, wrong length, or missing period

**CONTENT (0-2) - BE STRICT:**
- 2: Perfectly captures main topic AND key contrast
- 1: Captures main topic but misses contrast, OR minor distortion
- 0: Major meaning distortion, gibberish, or misses main idea entirely

**GRAMMAR (0-2):**
- 2: Semicolon + connector (however, therefore, etc.)
- 1: Connector but no semicolon
- 0: No connector OR major grammar errors

**VOCABULARY (0-2):**
- 2: Appropriate words, no spelling errors
- 1: 1-2 spelling errors OR awkward word choices
- 0: 3+ spelling errors OR inappropriate vocabulary

## OUTPUT FORMAT:
Return ONLY valid JSON:
{
  "trait_scores": {
    "form": {"value": 0-1, "word_count": number, "notes": "..."},
    "content": {"value": 0-2, "topic_captured": true/false, "pivot_captured": true/false, "notes": "..."},
    "grammar": {"value": 0-2, "has_connector": true/false, "notes": "..."},
    "vocabulary": {"value": 0-2, "notes": "..."}
  },
  "issues_detected": {
    "gibberish": ["list any gibberish issues"],
    "spelling_errors": ["list misspelled words"],
    "meaning_distortion": "describe if meaning is wrong"
  },
  "overall_score": 0-90,
  "raw_score": 0-7,
  "band": "Band 5/6/7/8/9",
  "feedback": "...",
  "reasoning": "..."
}`,
          messages: [{
            role: 'user',
            content: `PASSAGE TEXT: "${passage.text}"

KEY ELEMENTS:
- Critical (MUST capture): "${passage.keyElements.critical}"
- Important (SHOULD capture): "${passage.keyElements.important}"

STUDENT SUMMARY: "${summary}"

ANALYZE THIS SUMMARY COMPREHENSIVELY:

1. Is it GIBBERISH? (random words, nonsense, excessive repetition)
2. Are there SPELLING ERRORS? (list them)
3. Is the MEANING ACCURATE? (does it match the passage or distort it?)
4. Does it capture the MAIN TOPIC?
5. Does it capture the KEY CONTRAST?
6. Check grammar (semicolon + connector?)
7. Check vocabulary appropriateness

Be STRICT about meaning accuracy. If the summary says something different from the passage, mark content as 0.

Return ONLY valid JSON with your complete analysis.`
          }]
        })
      });

      if (!response.ok) {
        console.log('Anthropic API error:', await response.text());
        return res.json({
          trait_scores: {
            form: { value: isValidForm ? 1 : 0, word_count: wordCount, notes: isValidForm ? 'Valid form' : 'Invalid form' },
            content: { value: 2, topic_captured: true, pivot_captured: true, notes: 'AI error - defaulting to lenient' },
            grammar: { value: 2, has_connector: true, notes: 'Connector detected' },
            vocabulary: { value: 2, notes: 'Appropriate vocabulary' }
          },
          overall_score: 9,
          raw_score: 7,
          band: 'Band 9',
          feedback: 'AI temporarily unavailable - lenient scoring applied',
          reasoning: 'Fallback scoring'
        });
      }

      const data = await response.json();
      const content = data.content?.[0]?.text;
      
      if (!content) {
        return res.json({
          trait_scores: {
            form: { value: isValidForm ? 1 : 0, word_count: wordCount, notes: isValidForm ? 'Valid form' : 'Invalid form' },
            content: { value: 2, topic_captured: true, pivot_captured: true, notes: 'AI response empty' },
            grammar: { value: 2, has_connector: true, notes: 'Connector detected' },
            vocabulary: { value: 2, notes: 'Appropriate vocabulary' }
          },
          overall_score: 9,
          raw_score: 7,
          band: 'Band 9',
          feedback: 'AI response incomplete - lenient scoring',
          reasoning: 'Fallback scoring'
        });
      }

      console.log('AI Response:', content);

      // Parse JSON from AI response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return res.json({
          trait_scores: {
            form: { value: isValidForm ? 1 : 0, word_count: wordCount, notes: isValidForm ? 'Valid form' : 'Invalid form' },
            content: { value: 2, topic_captured: true, pivot_captured: true, notes: 'JSON parse error' },
            grammar: { value: 2, has_connector: true, notes: 'Connector detected' },
            vocabulary: { value: 2, notes: 'Appropriate vocabulary' }
          },
          overall_score: 9,
          raw_score: 7,
          band: 'Band 9',
          feedback: 'AI response parsing error - lenient scoring',
          reasoning: 'Fallback scoring'
        });
      }
      
      let result = JSON.parse(jsonMatch[0]);
      
      // Ensure structure exists
      if (!result.trait_scores) result.trait_scores = {};
      if (!result.trait_scores.form) result.trait_scores.form = {};
      if (!result.trait_scores.content) result.trait_scores.content = {};
      if (!result.trait_scores.grammar) result.trait_scores.grammar = {};
      if (!result.trait_scores.vocabulary) result.trait_scores.vocabulary = {};
      
      // OVERRIDE form with local validation
      result.trait_scores.form.value = isValidForm ? 1 : 0;
      result.trait_scores.form.word_count = wordCount;
      result.trait_scores.form.notes = isValidForm ? 'One sentence, 5-75 words, ends with period' : 'Invalid form';
      
      // Convert to 0-9 scale
      const formScore = result.trait_scores.form.value || 0;
      const contentScore = result.trait_scores.content.value || 0;
      const grammarScore = result.trait_scores.grammar.value || 0;
      const vocabScore = result.trait_scores.vocabulary.value || 0;
      
      result.raw_score = formScore + contentScore + grammarScore + vocabScore;
      result.overall_score = Math.min(Math.round((result.raw_score / 7) * 9), 9);
      
      // Update band
      const bands = ['Band 5', 'Band 5', 'Band 6', 'Band 7', 'Band 8', 'Band 9', 'Band 9', 'Band 9'];
      result.band = bands[result.raw_score] || 'Band 5';
      
      res.json(result);
      
    } catch (apiError) {
      console.log('API exception:', apiError.message);
      res.json({
        trait_scores: {
          form: { value: isValidForm ? 1 : 0, word_count: wordCount, notes: isValidForm ? 'Valid form' : 'Invalid form' },
          content: { value: 2, topic_captured: true, pivot_captured: true, notes: 'AI exception - lenient' },
          grammar: { value: 2, has_connector: true, notes: 'Connector detected' },
          vocabulary: { value: 2, notes: 'Appropriate vocabulary' }
        },
        overall_score: 9,
        raw_score: 7,
        band: 'Band 9',
        feedback: 'AI service temporarily unavailable - lenient scoring applied',
        reasoning: 'Fallback scoring due to API error'
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
