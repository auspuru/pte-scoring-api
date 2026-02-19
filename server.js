const express = require('express');
const cors = require('cors');
const OpenAI = require('openai'); // npm install openai

const app = express();
const PORT = process.env.PORT || 3001;

// OpenAI instead of Anthropic
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Change your env var name
});

// ... (keep all your existing helpers: sanitizeInput, hasFiniteVerb, calculateForm, etc.)

// ─── AI GRADING ENGINE (OpenAI Version) ─────────────────────────────────────
async function gradeResponse(text, type, passageText) {
  const firstPersonCheck = checkFirstPersonTrap(text, passageText);

  const systemPrompt = [
    'You are a PTE Academic Examiner. Grade strictly against the passage.',
    '',
    'CONTENT (0-3): 1pt each for TOPIC (main subject), PIVOT (contrast/However), CONCLUSION (final point).',
    'VOCABULARY (0-2): 2=appropriate, 1=minor issues, 0=distorts meaning.',
    'GRAMMAR (0-2): 2=correct connectors, 1=missing, 0=wrong logic.',
    '',
    'Return ONLY JSON.'
  ].join('\n');

  const userPrompt = [
    'PASSAGE:', passageText,
    'STUDENT RESPONSE:', text,
    firstPersonCheck.penalty ? 'PENALTY: First-person trap (-1 content)' : '',
    '',
    'Grade and return JSON with: content(0-3), topic_captured(bool), pivot_captured(bool), conclusion_captured(bool), grammar{score(0-2)}, vocabulary(0-2), feedback(string)'
  ].join('\n');

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',  // or 'gpt-4o' for higher accuracy
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },  // ✅ NATIVE JSON MODE - No regex needed!
      max_tokens: 1000,
      temperature: 0.1,  // Low temp for consistent grading
    });

    const result = JSON.parse(completion.choices[0].message.content);
    return { ...result, mode: 'ai' };

  } catch (err) {
    console.error('OpenAI Error:', err.message);
    return {
      content: 0, grammar: { score: 1 }, vocabulary: 1,
      feedback: 'AI Error: ' + err.message,
      mode: 'local'
    };
  }
}
