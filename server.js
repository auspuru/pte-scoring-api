const express = require('express');
const cors = require('cors');

const app = express();
const PORT = parseInt(process.env.PORT) || 3001;
const OPENAI_API_KEY = process.env.ANTHROPIC_API_KEY;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const ALL_CONNECTORS = [
  'however', 'although', 'though', 'while', 'whereas', 'but', 'yet', 'nevertheless', 'nonetheless', 'notwithstanding', 'despite', 'in spite of', 'even though', 'even if', 'conversely', 'on the contrary', 'on the other hand', 'in contrast', 'alternatively', 'rather', 'instead', 'unlike', 'different from', 'as opposed to', 'compared to', 'in comparison', 'by contrast',
  'because', 'since', 'as', 'due to', 'owing to', 'thanks to', 'on account of', 'as a result', 'therefore', 'thus', 'hence', 'consequently', 'accordingly', 'so', 'thereby', 'for this reason', 'that is why', 'this means', 'it follows that', 'leading to', 'resulting in', 'causing', 'bringing about',
  'and', 'also', 'too', 'as well', 'as well as', 'in addition', 'furthermore', 'moreover', 'besides', 'what is more', 'not only', 'but also', 'both', 'equally', 'similarly', 'likewise', 'in the same way', 'along with', 'together with', 'coupled with', 'combined with', 'another', 'additionally',
  'first', 'firstly', 'second', 'secondly', 'third', 'thirdly', 'finally', 'lastly', 'next', 'then', 'after', 'afterwards', 'subsequently', 'later', 'eventually', 'previously', 'before', 'meanwhile', 'at the same time', 'simultaneously', 'during', 'while', 'when', 'until', 'till', 'as soon as', 'once', 'immediately', 'initially', 'originally', 'currently', 'now', 'recently', 'lately', 'soon', 'shortly', 'in the meantime',
  'for example', 'for instance', 'such as', 'like', 'including', 'particularly', 'especially', 'specifically', 'namely', 'that is', 'i.e.', 'e.g.', 'in particular', 'mainly', 'mostly', 'notably', 'chiefly', 'in other words', 'to illustrate',
  'indeed', 'in fact', 'actually', 'certainly', 'definitely', 'clearly', 'obviously', 'apparently', 'evidently', 'undoubtedly', 'without doubt', 'naturally', 'of course', 'needless to say', 'above all', 'most importantly', 'significantly', 'notably', 'in particular', 'especially', 'primarily', 'essentially', 'basically', 'in essence',
  'if', 'unless', 'provided that', 'providing that', 'as long as', 'on condition that', 'in case', 'whether', 'otherwise', 'or else', 'suppose', 'assuming that', 'given that',
  'in conclusion', 'to conclude', 'in summary', 'to summarize', 'overall', 'all in all', 'in short', 'in brief', 'to put it briefly', 'finally', 'lastly', 'in the end', 'at last', 'ultimately', 'on the whole', 'by and large', 'for the most part', 'generally', 'generally speaking', 'broadly speaking', 'as a whole'
];

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

  return {
    wordCount,
    isValidForm: errors.length === 0,
    errors
  };
}

async function aiGrade(summary, passage) {
  if (!OPENAI_API_KEY) return null;

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
        system: `You are a PTE Academic examiner. Grade summaries STRICTLY.

PASSAGE STRUCTURE:
- TOPIC: ${passage.keyElements?.topic || 'N/A'}
- PIVOT: ${passage.keyElements?.pivot || 'N/A'}
- CONCLUSION: ${passage.keyElements?.conclusion || 'N/A'}

STRICT MEANING DETECTION RULES:
1. ACCEPT paraphrasing ONLY if meaning is EXACTLY preserved
2. DEDUCT for:
   - Synonyms that change nuance
   - Opposites/contradictions
   - Missing key qualifiers
   - Overgeneralization
3. Topic must capture the CORE subject accurately
4. Pivot must show the CONTRAST/SHIFT correctly
5. Conclusion must match the passage's final point

SCORING:
1. FORM (0-1): 1 if 5-75 words, one sentence, ends with punctuation
2. CONTENT (0-3):
   - 3 = ALL 3 elements captured with EXACT meaning
   - 2 = 2 elements correct
   - 1 = 1 element correct
   - 0 = 0 elements OR major meaning errors
3. GRAMMAR (0-2):
   - 2 = no errors, uses connector
   - 1 = minor errors OR no connector
   - 0 = major errors
4. VOCABULARY (0-2): Always 2

Return JSON ONLY:`,
        messages: [{
          role: 'user',
          content: `PASSAGE: "${passage.text}"

STUDENT SUMMARY: "${summary}"

Grade and return:
{
  "form": { "value": 0-1, "word_count": number, "notes": "..." },
  "content": {
    "value": 0-3,
    "topic_captured": true/false,
    "pivot_captured": true/false,
    "conclusion_captured": true/false,
    "notes": "..."
  },
  "grammar": {
    "value": 0-2,
    "spelling_errors": [],
    "grammar_issues": [],
    "has_connector": true/false,
    "connector_type": "...",
    "notes": "..."
  },
  "vocabulary": { "value": 0-2, "notes": "..." },
  "feedback": "One line feedback"
}`
        }]
      })
    });

    if (!response.ok) {
      console.log('AI API error:', response.status);
      return null;
    }

    const data = await response.json();
    const content = data.content?.[0]?.text;
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      console.log('No JSON in AI response');
      return null;
    }

    const result = JSON.parse(match[0]);
    return {
      ...result,
      scoring_mode: 'ai'
    };

  } catch (e) {
    console.error('AI grading error:', e.message);
    return null;
  }
}

function localGrade(summary, passage, formCheck) {
  const sumLower = summary.toLowerCase();

  function extractKeywords(text) {
    if (!text) return [];
    return text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 4);
  }

  function checkCoverage(keyText) {
    const keywords = extractKeywords(keyText);
    if (keywords.length === 0) return { captured: true, matches: 0, total: 0 };
    const matches = keywords.filter(w => sumLower.includes(w)).length;
    return {
      captured: matches >= 2 || (matches / keywords.length) >= 0.25,
      matches,
      total: keywords.length
    };
  }

  const topicCheck = checkCoverage(passage.keyElements?.topic);

  const pivotKeywords = extractKeywords(passage.keyElements?.pivot);
  const contrastWords = ['however', 'although', 'while', 'but', 'yet', 'though', 'despite', 'whereas', 'nevertheless'];
  const hasContrast = contrastWords.some(w => sumLower.includes(w));
  const pivotMatches = pivotKeywords.filter(w => sumLower.includes(w)).length;
  const pivotCaptured = (hasContrast && pivotMatches >= 1) || pivotMatches >= 2 || (pivotKeywords.length > 0 && (pivotMatches / pivotKeywords.length) >= 0.3);

  const conclusionCheck = checkCoverage(passage.keyElements?.conclusion);

  let contentValue = 3;
  if (!topicCheck.captured) contentValue -= 1;
  if (!pivotCaptured) contentValue -= 1;
  if (!conclusionCheck.captured) contentValue -= 1;
  contentValue = Math.max(0, contentValue);

  const hasConnector = ALL_CONNECTORS.some(c => sumLower.includes(c.toLowerCase()));
  const connectorType = hasConnector ? ALL_CONNECTORS.find(c => sumLower.includes(c.toLowerCase())) : null;

  const commonWords = new Set([
    'the', 'a', 'an', 'some', 'any', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'its', 'our', 'their',
    'be', 'am', 'is', 'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall', 'should', 'may', 'might', 'must', 'can', 'could',
    'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'us', 'them',
    'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'into', 'onto', 'upon', 'about', 'above', 'across', 'after', 'against', 'along', 'among', 'around', 'before', 'behind', 'below', 'beneath', 'beside', 'between', 'beyond', 'during', 'except', 'inside', 'outside', 'until', 'within', 'without', 'toward', 'towards', 'through', 'under', 'via', 'per', 'like', 'unlike',
    'and', 'or', 'nor', 'either', 'neither', 'both', 'whether', 'if', 'unless', 'because', 'since', 'when', 'once', 'than',
    'not', 'no', 'just', 'only', 'even', 'also', 'too', 'very', 'quite', 'rather', 'really', 'truly', 'actually', 'certainly', 'definitely', 'probably', 'possibly', 'perhaps', 'maybe', 'simply', 'merely', 'barely', 'hardly', 'almost', 'nearly', 'exactly', 'particularly', 'especially', 'mainly', 'mostly', 'generally', 'usually', 'normally', 'typically', 'often', 'sometimes', 'occasionally', 'rarely', 'never', 'always', 'already', 'still', 'once', 'twice', 'again', 'further',
    'say', 'says', 'said', 'tell', 'told', 'talk', 'talked', 'speak', 'spoke', 'state', 'stated', 'mention', 'mentioned', 'note', 'noted', 'report', 'reported', 'claim', 'claimed', 'suggest', 'suggested', 'propose', 'proposed', 'argue', 'argued', 'believe', 'believed', 'think', 'thought', 'consider', 'considered', 'feel', 'felt', 'know', 'knew', 'known', 'understand', 'understood', 'realize', 'realized', 'recognize', 'recognized', 'see', 'saw', 'seen', 'look', 'looked', 'watch', 'watched', 'find', 'found', 'discover', 'discovered', 'notice', 'noticed', 'observe', 'observed', 'use', 'used', 'make', 'made', 'come', 'came', 'go', 'went', 'gone', 'take', 'took', 'taken', 'give', 'gave', 'given', 'put', 'let', 'call', 'called', 'try', 'tried', 'need', 'needed', 'want', 'wanted', 'like', 'liked', 'help', 'helped', 'show', 'showed', 'shown', 'play', 'played', 'move', 'moved', 'live', 'lived', 'bring', 'brought', 'happen', 'happened', 'write', 'wrote', 'written', 'provide', 'provided', 'include', 'included', 'involve', 'involved',
    'one', 'two', 'three', 'first', 'second', 'third', 'next', 'last', 'final', 'many', 'much', 'more', 'most', 'few', 'little', 'less', 'least', 'several', 'various', 'numerous', 'lot', 'lots', 'number', 'total', 'whole', 'entire', 'complete', 'full', 'part', 'half', 'piece', 'portion', 'section', 'aspect', 'side', 'area', 'field', 'domain', 'region', 'sector', 'share', 'percentage', 'proportion', 'degree', 'level', 'extent', 'scope', 'range', 'scale', 'size', 'volume', 'amount', 'sum', 'average', 'maximum', 'minimum', 'point', 'fact', 'case', 'instance', 'example', 'item', 'element', 'component', 'member', 'unit', 'entity', 'object', 'subject', 'topic', 'theme', 'matter', 'issue', 'question', 'problem', 'concern'
  ]);

  const words = summary.toLowerCase().match(/\b[a-z]+\b/g) || [];
  const spellingErrors = words.filter(w => w.length > 3 && !commonWords.has(w)).slice(0, 5);

  const grammarIssues = [];
  if (/\b(is|are|was|were)\s+\w+ing\b/i.test(summary)) grammarIssues.push('Check verb tense');
  if (/\b(a)\s+[aeiou]/gi.test(summary)) grammarIssues.push('Use "an" before vowels');

  const grammarValue = spellingErrors.length > 0 ? 1 : (hasConnector ? 2 : 1);

  let feedback = '';
  if (spellingErrors.length > 0) feedback += `Check: ${spellingErrors.join(', ')}. `;
  if (contentValue >= 2) feedback += 'Excellent coverage!';
  else if (contentValue === 1) {
    const missing = [];
    if (!topicCheck.captured) missing.push('topic');
    if (!pivotCaptured) missing.push('pivot');
    if (!conclusionCheck.captured) missing.push('conclusion');
    feedback += missing.length > 0 ? `Good. Clarify ${missing.join(', ')}.` : 'Good.';
  } else {
    feedback += 'Key concepts missing.';
  }

  return {
    form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
    content: {
      value: contentValue,
      topic_captured: topicCheck.captured,
      pivot_captured: pivotCaptured,
      conclusion_captured: conclusionCheck.captured,
      notes: `Topic:${topicCheck.matches}/${topicCheck.total}, Pivot:${pivotMatches}/${pivotKeywords.length}, Conclusion:${conclusionCheck.matches}/${conclusionCheck.total}`
    },
    grammar: {
      value: grammarValue,
      spelling_errors: spellingErrors,
      grammar_issues: grammarIssues,
      has_connector: hasConnector,
      connector_type: connectorType,
      notes: hasConnector ? `Connector: ${connectorType}` : 'No connector'
    },
    vocabulary: { value: 2, notes: 'Verbatim & paraphrase OK' },
    feedback,
    scoring_mode: 'local'
  };
}

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '3.0.0',
    anthropicConfigured: !!OPENAI_API_KEY,
    mode: OPENAI_API_KEY ? 'AI-primary' : 'local-only'
  });
});

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
          form: { value: 0, word_count: formCheck.wordCount, notes: formCheck.errors.join('; ') },
          content: { value: 0, topic_captured: false, pivot_captured: false, conclusion_captured: false, notes: 'Form error' },
          grammar: { value: 0, has_connector: false, notes: 'Form error' },
          vocabulary: { value: 0, notes: 'Form error' }
        },
        spell_check: { errors: [], hasErrors: false },
        grammar_details: { issues: [], hasConnector: false },
        overall_score: 0,
        raw_score: 0,
        band: 'Band 5',
        feedback: `Form failed: ${formCheck.errors.join(', ')}`,
        scoring_mode: 'local'
      });
    }

    let result = await aiGrade(summary, passage);

    if (!result) {
      console.log('AI failed, using local grading');
      result = localGrade(summary, passage, formCheck);
    }

    const rawScore = result.form.value + result.content.value + result.grammar.value + result.vocabulary.value;
    const overallScore = Math.min(Math.round((rawScore / 8) * 90), 90);
    const bands = ['Band 5', 'Band 5', 'Band 5', 'Band 6', 'Band 6', 'Band 7', 'Band 8', 'Band 9', 'Band 9'];

    res.json({
      trait_scores: {
        form: result.form,
        content: result.content,
        grammar: result.grammar,
        vocabulary: result.vocabulary
      },
      spell_check: {
        errors: result.grammar.spelling_errors || [],
        hasErrors: (result.grammar.spelling_errors || []).length > 0
      },
      grammar_details: {
        issues: result.grammar.grammar_issues || [],
        hasConnector: result.grammar.has_connector,
        connectorType: result.grammar.connector_type
      },
      overall_score: overallScore,
      raw_score: rawScore,
      band: bands[rawScore] || 'Band 5',
      feedback: result.feedback,
      scoring_mode: result.scoring_mode
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ PTE API v3.0.0 on port ${PORT}`);
  console.log(`${OPENAI_API_KEY ? '🤖 AI-primary' : '⚙️ Local-only'} mode`);
});
