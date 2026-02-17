const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.use(cors());
app.use(express.json());

const SYSTEM_PROMPT = `You are a PTE Academic "Summarize Written Text" scoring expert...

TRAIT 1 - FORM (0-1):
- 1 point: One sentence, 5-75 words, ends with period
- 0 points: Multiple sentences, <5 or >75 words

TRAIT 2 - CONTENT (0-2) - BE VERY LENIENT:
- 2 points: Captures main topic AND key contrast/turning point
- 1 point: Captures main topic OR contrast (not both)
- 0 points: Missing main idea

IMPORTANT: Accept paraphrasing! "downsides" = "disadvantages", "benefits" = "advantages", "aware" = "familiar". Only penalize if MEANING is changed.

TRAIT 3 - GRAMMAR (0-2):
- 2 points: Semicolon + connector OR complex structure
- 1 point: Simple connectors (and, but, however)
- 0 points: Comma splice, fragments

TRAIT 4 - VOCABULARY (0-2) - BE LENIENT:
- 2 points: Appropriate vocabulary, some paraphrasing
- 1 point: Some copied phrases (PTE allows this!)
- 0 points: Excessive copying (>90%) only

OUTPUT JSON:
{
  "trait_scores": {
    "form": { "value": 0-1, "word_count": number, "notes": "..." },
    "content": { "value": 0-2, "topic_captured": true/false, "pivot_captured": true/false, "notes": "..." },
    "grammar": { "value": 0-2, "has_connector": true/false, "notes": "..." },
    "vocabulary": { "value": 0-2, "notes": "..." }
  },
  "overall_score": 0-90,
  "raw_score": 0-7,
  "band": "Band 9/8/7/6/5",
  "feedback": "...",
  "reasoning": "..."
}`;

app.post('/api/grade', async (req, res) => {
  try {
    const { summary, passage } = req.body;
    if (!summary || !passage) return res.status(400).json({ error: 'Missing data' });
    if (!OPENAI_API_KEY) return res.status(500).json({ error: 'API key not set' });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `PASSAGE: ${passage.text}\n\nKEY ELEMENTS:\n- Critical: ${passage.keyElements.critical}\n- Important: ${passage.keyElements.important}\n- Supplementary: ${passage.keyElements.supplementary.join(', ')}\n\nSTUDENT SUMMARY: ${summary}\n\nEvaluate this summary. Be LENIENT with paraphrasing!` }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      })
    });

    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);
    
    if (result.raw_score > 7) result.raw_score = 7;
    if (result.overall_score > 90) result.overall_score = 90;
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', openaiConfigured: !!OPENAI_API_KEY });
});

app.listen(PORT, () => console.log(`Server on port ${PORT}`));
