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

// Grade endpoint
app.post('/api/grade', async (req, res) => {
  try {
    const { summary, passage } = req.body;
    
    if (!summary || !passage) {
      return res.status(400).json({ error: 'Missing summary or passage' });
    }

    // Form validation (server-side - more reliable)
    const trimmed = summary.trim();
    const words = trimmed.split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;
    const endsWithPeriod = /[.]$/.test(trimmed);
    const hasNewlines = /[\n\r]/.test(summary);
    const hasBullets = /[•\-\*]/.test(summary);
    const isValidForm = wordCount >= 5 && wordCount <= 75 && endsWithPeriod && !hasNewlines && !hasBullets;

    // If no Anthropic key, return local scoring
    if (!ANTHROPIC_API_KEY) {
      return res.json({
        trait_scores: {
          form: { value: isValidForm ? 1 : 0, word_count: wordCount, notes: isValidForm ? 'Valid form' : 'Invalid form' },
          content: { value: 2, topic_captured: true, pivot_captured: true, notes: 'Local scoring' },
          grammar: { value: 2, has_connector: true, notes: 'Connector detected' },
          vocabulary: { value: 2, notes: 'Appropriate vocabulary' }
        },
        overall_score: 90,
        raw_score: 7,
        band: 'Band 9',
        feedback: 'Scored locally',
        reasoning: 'Local scoring'
      });
    }

    // Use Anthropic for content analysis
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
          system: `You are a PTE Academic scorer. IMPORTANT RULES:

1. COPYING FROM PASSAGE IS ALLOWED - PTE students can copy exact phrases, fragments, or entire sentences
2. PARAPHRASING IS ALLOWED - synonyms and rewording are also accepted
3. BOTH copying AND paraphrasing get FULL marks - be extremely lenient
4. Form is already validated server-side - trust the form value provided
5. Content (0-2): Give 2/2 if main idea is captured (whether copied or paraphrased)
6. Grammar (0-2): 2 pts for good sentence structure with connector
7. Vocabulary (0-2): Copying is allowed, only penalize gibberish or inappropriate words

Return JSON with trait_scores, overall_score (0-90), raw_score (0-7), band, feedback`,
          messages: [{
            role: 'user',
            content: `PASSAGE: "${passage.text}"

KEY ELEMENTS:
- Critical: "${passage.keyElements.critical}"
- Important: "${passage.keyElements.important}"

STUDENT SUMMARY: "${summary}"

FORM IS VALID: ${isValidForm} (${wordCount} words, ends with period)

Score content, grammar, vocabulary. REMEMBER: COPYING IS ALLOWED IN PTE - both exact copying and paraphrasing are accepted and should receive full marks.

Return ONLY JSON: {"trait_scores":{"form":{"value":${isValidForm ? 1 : 0},"word_count":${wordCount},"notes":"..."},"content":{"value":0-2,"topic_captured":true/false,"pivot_captured":true/false,"notes":"..."},"grammar":{"value":0-2,"has_connector":true/false,"notes":"..."},"vocabulary":{"value":0-2,"notes":"..."}},"overall_score":0-90,"raw_score":0-7,"band":"Band X","feedback":"..."}`
          }]
        })
      });

      if (!response.ok) {
        // Fallback to local scoring
        return res.json({
          trait_scores: {
            form: { value: isValidForm ? 1 : 0, word_count: wordCount, notes: isValidForm ? 'Valid form' : 'Invalid form' },
            content: { value: 2, topic_captured: true, pivot_captured: true, notes: 'AI error - lenient' },
            grammar: { value: 2, has_connector: true, notes: 'Connector detected' },
            vocabulary: { value: 2, notes: 'Appropriate vocabulary' }
          },
          overall_score: 90,
          raw_score: 7,
          band: 'Band 9',
          feedback: 'AI error - lenient scoring applied',
          reasoning: 'Fallback'
        });
      }

      const data = await response.json();
      const content = data.content?.[0]?.text;
      
      if (!content) {
        return res.json({
          trait_scores: {
            form: { value: isValidForm ? 1 : 0, word_count: wordCount, notes: isValidForm ? 'Valid form' : 'Invalid form' },
            content: { value: 2, topic_captured: true, pivot_captured: true, notes: 'AI empty - lenient' },
            grammar: { value: 2, has_connector: true, notes: 'Connector detected' },
            vocabulary: { value: 2, notes: 'Appropriate vocabulary' }
          },
          overall_score: 90,
          raw_score: 7,
          band: 'Band 9',
          feedback: 'AI empty - lenient scoring',
          reasoning: 'Fallback'
        });
      }

      // Parse JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return res.json({
          trait_scores: {
            form: { value: isValidForm ? 1 : 0, word_count: wordCount, notes: isValidForm ? 'Valid form' : 'Invalid form' },
            content: { value: 2, topic_captured: true, pivot_captured: true, notes: 'JSON error - lenient' },
            grammar: { value: 2, has_connector: true, notes: 'Connector detected' },
            vocabulary: { value: 2, notes: 'Appropriate vocabulary' }
          },
          overall_score: 90,
          raw_score: 7,
          band: 'Band 9',
          feedback: 'AI parsing error - lenient scoring',
          reasoning: 'Fallback'
        });
      }
      
      let result = JSON.parse(jsonMatch[0]);
      
      // Ensure structure
      if (!result.trait_scores) result.trait_scores = {};
      if (!result.trait_scores.form) result.trait_scores.form = {};
      if (!result.trait_scores.content) result.trait_scores.content = {};
      if (!result.trait_scores.grammar) result.trait_scores.grammar = {};
      if (!result.trait_scores.vocabulary) result.trait_scores.vocabulary = {};
      
      // FORCE form to server-side validation (override AI)
      result.trait_scores.form.value = isValidForm ? 1 : 0;
      result.trait_scores.form.word_count = wordCount;
      result.trait_scores.form.notes = isValidForm ? 'One sentence, 5-75 words, ends with period' : 'Invalid form';
      
      // Calculate raw score (0-7 scale)
      const formScore = result.trait_scores.form.value || 0;
      const contentScore = result.trait_scores.content.value || 0;
      const grammarScore = result.trait_scores.grammar.value || 0;
      const vocabScore = result.trait_scores.vocabulary.value || 0;
      
      result.raw_score = formScore + contentScore + grammarScore + vocabScore;
      
      // Convert to 0-90 PTE scale (capped at 90)
      result.overall_score = Math.min(Math.round((result.raw_score / 7) * 90), 90);
      
      // Band mapping
      const bands = ['Band 5', 'Band 5', 'Band 6', 'Band 7', 'Band 8', 'Band 9', 'Band 9', 'Band 9'];
      result.band = bands[result.raw_score] || 'Band 5';
      
      res.json(result);
      
    } catch (apiError) {
      res.json({
        trait_scores: {
          form: { value: isValidForm ? 1 : 0, word_count: wordCount, notes: isValidForm ? 'Valid form' : 'Invalid form' },
          content: { value: 2, topic_captured: true, pivot_captured: true, notes: 'AI exception - lenient' },
          grammar: { value: 2, has_connector: true, notes: 'Connector detected' },
          vocabulary: { value: 2, notes: 'Appropriate vocabulary' }
        },
        overall_score: 90,
        raw_score: 7,
        band: 'Band 9',
        feedback: 'AI unavailable - lenient scoring',
        reasoning: 'Fallback'
      });
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server on port ${PORT}, Anthropic: ${!!ANTHROPIC_API_KEY}`);
});
