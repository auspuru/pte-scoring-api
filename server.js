const express = require('express');
const cors = require('cors');

const app = express();
const PORT = parseInt(process.env.PORT) || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ─── PORTER STEMMER (no deps) ─────────────────────────────────────────────────
function stem(word) {
  word = word.toLowerCase();
  if (word.length <= 3) return word;
  if (word.endsWith('sses')) word = word.slice(0, -2);
  else if (word.endsWith('ies')) word = word.slice(0, -2);
  else if (!word.endsWith('ss') && word.endsWith('s')) word = word.slice(0, -1);
  if (word.endsWith('eed')) { if (word.length > 4) word = word.slice(0, -1); }
  else if (word.endsWith('ing')) { const b = word.slice(0, -3); if (b.length >= 2) word = b; }
  else if (word.endsWith('ed')) { const b = word.slice(0, -2); if (b.length >= 2) word = b; }
  const step2 = [['ational','ate'],['tional','tion'],['enci','ence'],['anci','ance'],['izer','ize'],
    ['isation','ise'],['ization','ize'],['ation','ate'],['ator','ate'],['alism','al'],
    ['iveness','ive'],['fulness','ful'],['ousness','ous'],['aliti','al'],['iviti','ive'],['biliti','ble']];
  for (const [s, r] of step2) { if (word.endsWith(s)) { word = word.slice(0, -s.length) + r; break; } }
  const step3 = [['icate','ic'],['ative',''],['alize','al'],['iciti','ic'],['ical','ic'],['ful',''],['ness','']];
  for (const [s, r] of step3) { if (word.endsWith(s)) { word = word.slice(0, -s.length) + r; break; } }
  return word;
}

// ─── SYNONYM GROUPS ───────────────────────────────────────────────────────────
const SYNONYM_GROUPS = [
  ['increase','rise','grow','surge','climb','boost','expand','escalate','soar','improve','growth','rising'],
  ['decrease','fall','drop','decline','reduce','shrink','diminish','plunge','deteriorate','reduction','falling'],
  ['important','significant','crucial','vital','key','essential','critical','major','notable','prominent'],
  ['show','demonstrate','indicate','reveal','suggest','highlight','illustrate','prove','confirm','establish'],
  ['cause','lead','result','trigger','produce','generate','create','prompt','drive','bring'],
  ['benefit','advantage','gain','positive','good','help','aid','support','asset','value'],
  ['problem','issue','challenge','difficulty','concern','obstacle','drawback','disadvantage','barrier','risk'],
  ['study','research','investigation','analysis','examination','survey','report','findings','evidence'],
  ['people','individuals','humans','population','society','community','persons','citizens','workers'],
  ['country','nation','state','government','region','land','economy','society'],
  ['large','big','great','huge','vast','major','significant','substantial','considerable','enormous'],
  ['small','little','minor','limited','slight','modest','minimal','negligible','marginal'],
  ['use','utilise','utilize','employ','apply','implement','adopt','rely','depend'],
  ['change','shift','transform','alter','modify','evolve','transition','development','move'],
  ['argue','claim','suggest','propose','contend','assert','maintain','state','note','point','argue'],
  ['new','novel','modern','recent','innovative','emerging','contemporary','current','latest'],
  ['difficult','hard','challenging','complex','complicated','tough','demanding','problematic'],
  ['positive','beneficial','advantageous','favorable','good','constructive','helpful','effective'],
  ['negative','harmful','detrimental','adverse','bad','damaging','destructive','problematic'],
  ['fast','rapid','quick','swift','speedy','accelerated','rapid','prompt'],
  ['need','require','demand','necessitate','call','must','essential','critical'],
  ['improve','enhance','better','strengthen','advance','develop','progress','upgrade'],
  ['global','worldwide','international','universal','overall','general','broad','widespread'],
  ['data','information','evidence','statistics','findings','results','numbers','figures'],
];

function buildSynonymMap() {
  const map = {};
  for (const group of SYNONYM_GROUPS) {
    for (const word of group) {
      map[word] = group;
      map[stem(word)] = group.map(w => stem(w));
    }
  }
  return map;
}
const SYNONYM_MAP = buildSynonymMap();

function isSemanticallyRelated(w1, w2) {
  if (w1 === w2) return true;
  const s1 = stem(w1), s2 = stem(w2);
  if (s1 === s2) return true;
  const grp = SYNONYM_MAP[w1] || SYNONYM_MAP[s1];
  return grp ? (grp.includes(w2) || grp.includes(s2)) : false;
}

// ─── SPELL CHECKER ────────────────────────────────────────────────────────────
const KNOWN_MISSPELLINGS = {
  'recieve':'receive','beleive':'believe','occured':'occurred','occurance':'occurrence',
  'seperate':'separate','definately':'definitely','goverment':'government','enviroment':'environment',
  'accomodate':'accommodate','achive':'achieve','acheive':'achieve','aquire':'acquire',
  'arguement':'argument','begining':'beginning','benifit':'benefit','catagory':'category',
  'changable':'changeable','collegue':'colleague','comittee':'committee','concious':'conscious',
  'conveniance':'convenience','critisism':'criticism','curiousity':'curiosity','dependant':'dependent',
  'desparate':'desperate','dissapear':'disappear','existance':'existence','familier':'familiar',
  'foriegn':'foreign','freind':'friend','grammer':'grammar','gaurd':'guard','guidence':'guidance',
  'happend':'happened','hieght':'height','ignorence':'ignorance','immedietly':'immediately',
  'independant':'independent','indispensible':'indispensable','intelligance':'intelligence',
  'irresistable':'irresistible','knowlegde':'knowledge','liason':'liaison','libary':'library',
  'lisence':'license','maintenence':'maintenance','millenium':'millennium','mispell':'misspell',
  'neccessary':'necessary','nieghbor':'neighbor','noticable':'noticeable','occassion':'occasion',
  'orignal':'original','peice':'piece','persistance':'persistence','polititian':'politician',
  'posession':'possession','preceed':'precede','privalege':'privilege','professer':'professor',
  'recomend':'recommend','refered':'referred','relevent':'relevant','religous':'religious',
  'remeber':'remember','repitition':'repetition','resistence':'resistance','rythm':'rhythm',
  'sieze':'seize','similer':'similar','speach':'speech','studing':'studying','succesful':'successful',
  'suprise':'surprise','tecnology':'technology','tendancy':'tendency','therefor':'therefore',
  'tounge':'tongue','truely':'truly','untill':'until','vaccum':'vacuum','visable':'visible',
  'wether':'whether','wierd':'weird','writting':'writing','teh':'the','taht':'that',
  'thier':'their','alot':'a lot','reccomend':'recommend','apparant':'apparent',
  'conciousness':'consciousness','developement':'development','enviromental':'environmental',
  'governement':'government','imediatly':'immediately','imprtant':'important',
  'incresing':'increasing','indvidual':'individual','infomation':'information',
  'particluar':'particular','populaton':'population','reseach':'research',
  'signifcant':'significant','societal':'societal','technolgy':'technology',
};

const COMMON_VOCAB = new Set([
  'the','a','an','is','are','was','were','be','been','being','have','has','had','do','does','did',
  'will','would','shall','should','may','might','must','can','could','need','ought',
  'i','you','he','she','it','we','they','me','him','her','us','them','my','your','his','its','our','their',
  'this','that','these','those','who','which','what','where','when','how','why','whom','whose',
  'in','on','at','to','for','of','with','by','from','as','into','about','above','after','against',
  'along','among','around','before','behind','below','beside','between','beyond','during',
  'except','inside','outside','until','within','without','toward','through','under','over','off',
  'and','or','nor','but','if','then','than','so','yet','both','either','neither','although',
  'because','since','while','though','whereas','unless','whenever','whether',
  'not','no','just','only','even','also','too','very','quite','rather','really','truly','actually',
  'certainly','definitely','clearly','obviously','probably','possibly','perhaps','maybe',
  'simply','barely','hardly','almost','nearly','exactly','particularly','especially',
  'mainly','mostly','generally','usually','normally','typically','often','sometimes','rarely','never',
  'always','already','still','again','however','therefore','thus','hence','consequently',
  'moreover','furthermore','nevertheless','nonetheless','meanwhile','first','second','third',
  'finally','lastly','next','later','soon','now','here','there','all','any','each','every',
  'few','more','most','some','such','own','same','other','another','one','two','three','four',
  'five','many','much','less','least','several','various','numerous',
  'government','research','study','data','results','analysis','evidence','impact','effect',
  'increase','decrease','significant','important','suggest','indicate','demonstrate','show',
  'people','society','community','economy','technology','environment','education','health',
  'change','develop','improve','reduce','provide','include','require','consider','believe',
  'system','social','economic','political','cultural','global','local','national','international',
  'information','development','population','individual','relationship','process','approach',
  'problem','challenge','solution','opportunity','advantage','disadvantage','benefit','risk',
  'traditional','modern','current','recent','future','past','present','high','low',
  'large','small','major','minor','positive','negative','public','private','human','natural',
  'based','used','found','made','given','taken','seen','known','called','considered',
  'reported','argued','claimed','suggested','noted','stated','proposed','found','shown',
  'between','different','following','according','example','another','through','without',
  'however','although','therefore','because','despite','whereas','similarly','consequently',
  'furthermore','moreover','nevertheless','nonetheless','meanwhile','subsequently',
  'argue','claim','suggest','propose','contend','assert','maintain','state','note',
  'increase','decrease','rise','fall','grow','decline','improve','worsen','change',
  'cause','effect','result','impact','influence','factor','reason','outcome',
  'must','need','require','essential','critical','vital','important','necessary',
  'include','involve','contain','comprise','consist','relate','connect','link',
]);

function spellCheck(summary) {
  const words = summary.match(/\b[a-zA-Z']+\b/g) || [];
  const errors = [];
  const seen = new Set();

  for (const rawWord of words) {
    const word = rawWord.toLowerCase().replace(/^'+|'+$/g, '');
    if (word.length <= 2 || seen.has(word)) continue;
    seen.add(word);
    if (COMMON_VOCAB.has(word)) continue;
    if (/^\d+$/.test(word)) continue;

    // Known misspelling lookup
    if (KNOWN_MISSPELLINGS[word]) {
      errors.push({ word: rawWord, suggestion: KNOWN_MISSPELLINGS[word], confidence: 'high' });
    }
  }

  return errors;
}

// ─── GRAMMAR CHECKER ──────────────────────────────────────────────────────────
function checkGrammar(summary) {
  const issues = [];

  const rules = [
    {
      re: /\ba\s+([aeiou]\w*)/gi,
      fn: (m, w) => !/^(one|once|uniform|unit|unique|university|use|used|user|usual|usually|union|united|universal|universe|utility)/i.test(w)
        ? { issue: `"a ${w}"`, suggestion: `"an ${w}"`, rule: 'Use "an" before vowel sounds' } : null
    },
    {
      re: /\ban\s+([^aeiou\s]\w*)/gi,
      fn: (m, w) => !/^(hour|honest|heir|honor|herb)/i.test(w)
        ? { issue: `"an ${w}"`, suggestion: `"a ${w}"`, rule: 'Use "a" before consonant sounds' } : null
    },
    {
      re: /\b(they|we|you|i)\s+(was)\b/gi,
      fn: (m, p1) => ({ issue: `"${p1} was"`, suggestion: `"${p1} were"`, rule: 'Subject-verb agreement' })
    },
    {
      re: /\b(he|she|it)\s+(were)\b/gi,
      fn: (m, p1) => ({ issue: `"${p1} were"`, suggestion: `"${p1} was"`, rule: 'Subject-verb agreement' })
    },
    {
      re: /\bmore\s+(\w+er)\b/gi,
      fn: (m, w) => ({ issue: `"more ${w}"`, suggestion: `just "${w}"`, rule: 'Double comparative' })
    },
    {
      re: /\bmost\s+(\w+est)\b/gi,
      fn: (m, w) => ({ issue: `"most ${w}"`, suggestion: `just "${w}"`, rule: 'Double superlative' })
    },
    {
      re: /\btheir\s+(is|are|was|were)\b/gi,
      fn: (m) => ({ issue: `"${m}"`, suggestion: m.replace(/their/i, 'there'), rule: '"their" vs "there"' })
    },
    {
      re: /\bthere\s+(book|house|car|idea|opinion|view|work|job|role|goal|aim)\b/gi,
      fn: (m, w) => ({ issue: `"there ${w}"`, suggestion: `"their ${w}"`, rule: '"there" vs "their"' })
    },
    {
      re: /\bless\s+(\w+s)\b/gi,
      fn: (m, w) => !['times','chances','cases','means','equals'].includes(w.toLowerCase())
        ? { issue: `"less ${w}"`, suggestion: `"fewer ${w}"`, rule: 'Use "fewer" with countable nouns' } : null
    },
    {
      re: /\b(could|would|should|might|must)\s+of\b/gi,
      fn: (m, p1) => ({ issue: `"${p1} of"`, suggestion: `"${p1} have"`, rule: 'Modal verb: "of" → "have"' })
    },
    {
      re: /\b(affect)\s+(the|a|an|their|its)\b/gi,
      fn: (m) => null // affect as verb before article is fine
    },
    {
      re: /,\s*,/g,
      fn: () => ({ issue: 'double comma',  suggestion: 'single comma', rule: 'Punctuation error' })
    },
  ];

  for (const { re, fn } of rules) {
    let match;
    const r = new RegExp(re.source, re.flags);
    while ((match = r.exec(summary)) !== null) {
      const result = fn(...match);
      if (result) issues.push(result);
    }
  }

  return issues;
}

// ─── CONNECTORS ───────────────────────────────────────────────────────────────
const ALL_CONNECTORS = [
  'however','although','though','while','whereas','yet','nevertheless','nonetheless',
  'notwithstanding','despite','in spite of','even though','even if','conversely',
  'on the contrary','on the other hand','in contrast','alternatively','rather','instead',
  'unlike','as opposed to','by contrast','because','since','due to','owing to','thanks to',
  'on account of','as a result','therefore','thus','hence','consequently','accordingly',
  'thereby','for this reason','that is why','leading to','resulting in','furthermore',
  'moreover','besides','in addition','additionally','similarly','likewise',
  'for example','for instance','such as','in particular','namely','in other words',
  'in conclusion','to conclude','in summary','to summarize','overall','ultimately',
  'in short','on the whole','generally speaking','if','unless','provided that',
  'as long as','given that','assuming that'
];

// ─── FORM VALIDATOR ───────────────────────────────────────────────────────────
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
  if (sentenceMatches && sentenceMatches.length > 0) errors.push('Multiple sentences detected');
  if (!/[.!?]$/.test(trimmed)) errors.push('Must end with punctuation');
  if (/[\n\r]/.test(summary)) errors.push('Contains line breaks');
  if (/^[•\-*\d]\s|^\d+\.\s/m.test(summary)) errors.push('Contains bullet points');
  return { wordCount, isValidForm: errors.length === 0, errors };
}

// ─── SEMANTIC CONTENT SCORER ──────────────────────────────────────────────────
const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being','have','has','had','do','does','did',
  'will','would','shall','should','may','might','must','can','could','i','you','he','she','it',
  'we','they','me','him','her','us','them','in','on','at','to','for','of','with','by','from',
  'as','into','about','and','or','nor','but','if','then','than','so','yet','both','either',
  'not','no','just','only','even','also','too','very','quite','this','that','these','those',
  'all','any','each','every','few','more','most','some','such','one','two','three','many','much',
  'what','which','who','where','when','how','why','whom','whose','own','same','other','another'
]);

function extractKeywords(text) {
  if (!text) return [];
  return text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/)
    .filter(w => w.length >= 4 && !STOP_WORDS.has(w));
}

function semanticOverlap(passageKeywords, summaryText) {
  const summaryWords = summaryText.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/);
  const summaryStems = summaryWords.map(stem);
  let matched = 0;
  const matchedWords = [];

  for (const kw of passageKeywords) {
    const kwStem = stem(kw);
    if (summaryText.toLowerCase().includes(kw)) { matched++; matchedWords.push(kw); continue; }
    if (summaryStems.includes(kwStem)) { matched++; matchedWords.push(`${kw}→stem`); continue; }
    if (summaryWords.some(sw => isSemanticallyRelated(sw, kw))) { matched++; matchedWords.push(`${kw}→syn`); continue; }
  }
  return { matched, total: passageKeywords.length, matchedWords };
}

function scoreElement(keyText, summaryText, requireContrast = false) {
  if (!keyText) return { captured: true, score: 1, detail: 'N/A' };
  const keywords = extractKeywords(keyText);
  if (keywords.length === 0) return { captured: true, score: 1, detail: 'No keywords to match' };

  const { matched, total, matchedWords } = semanticOverlap(keywords, summaryText);
  const ratio = matched / total;

  let captured = false;
  if (requireContrast) {
    const contrastWords = ['however','although','while','but','yet','though','despite','whereas',
      'nevertheless','on the other hand','in contrast','conversely','notwithstanding'];
    const hasContrast = contrastWords.some(w => summaryText.toLowerCase().includes(w));
    // Pivot needs contrast word + at least some keyword overlap
    captured = hasContrast && (matched >= 1 || ratio >= 0.25);
  } else {
    // Topic/conclusion: need meaningful overlap
    captured = matched >= 2 || ratio >= 0.4;
  }

  return {
    captured,
    score: captured ? 1 : 0,
    detail: `${matched}/${total} matched (${Math.round(ratio * 100)}%): [${matchedWords.slice(0, 5).join(', ')}]`
  };
}

// ─── LOCAL GRADER ─────────────────────────────────────────────────────────────
function localGrade(summary, passage, formCheck) {
  const sumLower = summary.toLowerCase();

  const topicResult     = scoreElement(passage.keyElements?.topic,      summary, false);
  const pivotResult     = scoreElement(passage.keyElements?.pivot,      summary, true);
  const conclusionResult= scoreElement(passage.keyElements?.conclusion, summary, false);
  const contentValue = topicResult.score + pivotResult.score + conclusionResult.score;

  const hasConnector = ALL_CONNECTORS.some(c => sumLower.includes(c.toLowerCase()));
  const connectorType = hasConnector ? ALL_CONNECTORS.find(c => sumLower.includes(c.toLowerCase())) : null;

  const spellingErrors = spellCheck(summary);
  const grammarIssues  = checkGrammar(summary);

  const totalErrors = spellingErrors.length + grammarIssues.length;
  let grammarValue;
  if (totalErrors === 0 && hasConnector) grammarValue = 2;
  else if (totalErrors <= 1 || hasConnector) grammarValue = 1;
  else grammarValue = 0;

  // Build rich feedback
  const parts = [];

  if (contentValue === 3) {
    parts.push('✅ Excellent! All three key elements (topic, contrast/pivot, conclusion) are covered.');
  } else {
    const missing = [];
    if (!topicResult.captured)      missing.push('topic');
    if (!pivotResult.captured)      missing.push('contrast/pivot');
    if (!conclusionResult.captured) missing.push('conclusion');
    parts.push(`⚠️ Content gaps: ${missing.join(', ')} not clearly captured. Ensure your summary reflects all main points of the passage.`);
  }

  if (!hasConnector) {
    parts.push('📎 No linking connector detected. Use connectors such as "however", "although", "therefore", or "consequently" to connect your ideas.');
  }

  if (spellingErrors.length > 0) {
    const fixes = spellingErrors.map(e => `"${e.word}" → "${e.suggestion}"`).join(', ');
    parts.push(`🔤 Spelling errors: ${fixes}.`);
  }

  if (grammarIssues.length > 0) {
    const fixes = grammarIssues.map(g => `${g.issue} → ${g.suggestion} [${g.rule}]`).join('; ');
    parts.push(`✏️ Grammar issues: ${fixes}.`);
  }

  if (spellingErrors.length === 0 && grammarIssues.length === 0 && hasConnector) {
    parts.push('✅ Grammar, spelling, and connector usage all look correct.');
  }

  return {
    form: { value: 1, word_count: formCheck.wordCount, notes: 'Valid form' },
    content: {
      value: contentValue,
      topic_captured:      topicResult.captured,
      pivot_captured:      pivotResult.captured,
      conclusion_captured: conclusionResult.captured,
      notes: `Topic: ${topicResult.detail} | Pivot: ${pivotResult.detail} | Conclusion: ${conclusionResult.detail}`
    },
    grammar: {
      value: grammarValue,
      spelling_errors: spellingErrors,
      grammar_issues:  grammarIssues,
      has_connector:   hasConnector,
      connector_type:  connectorType,
      notes: hasConnector ? `Connector found: "${connectorType}"` : 'No connector detected'
    },
    vocabulary: { value: 2, notes: 'Paraphrase and verbatim both accepted' },
    feedback: parts.join(' '),
    scoring_mode: 'local'
  };
}

// ─── AI GRADER ────────────────────────────────────────────────────────────────
async function aiGrade(summary, passage) {
  if (!ANTHROPIC_API_KEY) return null;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        temperature: 0,
        system: `You are a strict PTE Academic examiner grading "Summarize Written Text" responses.

PASSAGE KEY ELEMENTS:
- TOPIC: ${passage.keyElements?.topic || 'N/A'}
- PIVOT/CONTRAST: ${passage.keyElements?.pivot || 'N/A'}
- CONCLUSION: ${passage.keyElements?.conclusion || 'N/A'}

SCORING CRITERIA:

FORM (0-1):
  1 = single sentence, 5–75 words, ends with punctuation mark
  0 = any violation

CONTENT (0-3) — Award 1 point per correctly captured element:
  TOPIC (1pt): Correct main subject identified with accurate meaning
  PIVOT (1pt): Contrast or shift shown with appropriate linking language (however, although, despite, etc.)
  CONCLUSION (1pt): Final point or implication correctly reflected
  → Synonyms and paraphrasing are FINE if meaning is preserved
  → Deduct if meaning is reversed, omitted, or heavily distorted

GRAMMAR (0-2):
  2 = grammatically correct throughout + uses a linking connector
  1 = 1 minor error OR grammatically correct but no connector
  0 = 2+ errors, or a major error that impedes meaning
  → List every spelling error with correction
  → List every grammar issue with correction and rule name

VOCABULARY (0-2):
  2 = vocabulary is appropriate and does not impede understanding
  1 = vocabulary errors affect clarity
  0 = vocabulary so poor meaning is lost

Return ONLY valid JSON (no markdown fences):`,
        messages: [{
          role: 'user',
          content: `PASSAGE: "${passage.text}"

STUDENT SUMMARY: "${summary}"

Return this exact JSON:
{
  "form": { "value": 0, "word_count": 0, "notes": "..." },
  "content": {
    "value": 0,
    "topic_captured": false,
    "pivot_captured": false,
    "conclusion_captured": false,
    "notes": "What was captured and what was missed, with brief explanation"
  },
  "grammar": {
    "value": 0,
    "spelling_errors": [{ "word": "misspelled", "suggestion": "correct" }],
    "grammar_issues": [{ "issue": "quoted problem phrase", "suggestion": "corrected version", "rule": "rule name" }],
    "has_connector": false,
    "connector_type": "word used or null",
    "notes": "..."
  },
  "vocabulary": { "value": 2, "notes": "..." },
  "feedback": "2-3 sentence actionable feedback: mention missing content elements, list spelling/grammar corrections with fixes, note connector usage."
}`
        }]
      })
    });

    if (!response.ok) {
      console.log('Anthropic API error:', response.status);
      return null;
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) { console.log('No JSON found in AI response'); return null; }

    const result = JSON.parse(match[0]);
    return { ...result, scoring_mode: 'ai' };

  } catch (e) {
    console.error('AI grading error:', e.message);
    return null;
  }
}

// ─── BAND MAP ─────────────────────────────────────────────────────────────────
const BAND_MAP = {
  0: 'Band 5', 1: 'Band 5', 2: 'Band 5',
  3: 'Band 6', 4: 'Band 6',
  5: 'Band 7', 6: 'Band 7',
  7: 'Band 8',
  8: 'Band 9'
};

// ─── ROUTES ───────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '4.0.0',
    anthropicConfigured: !!ANTHROPIC_API_KEY,
    openaiConfigured: !!OPENAI_API_KEY,
    mode: ANTHROPIC_API_KEY ? 'AI-primary' : 'local-only'
  });
});

app.post('/api/grade', async (req, res) => {
  try {
    const { summary, passage } = req.body;
    if (!summary || !passage) return res.status(400).json({ error: 'Missing summary or passage' });

    const formCheck = validateForm(summary);

    if (!formCheck.isValidForm) {
      return res.json({
        trait_scores: {
          form: { value: 0, word_count: formCheck.wordCount, notes: formCheck.errors.join('; ') },
          content: { value: 0, topic_captured: false, pivot_captured: false, conclusion_captured: false, notes: 'Form invalid' },
          grammar: { value: 0, spelling_errors: [], grammar_issues: [], has_connector: false, notes: 'Form invalid' },
          vocabulary: { value: 0, notes: 'Form invalid' }
        },
        spell_check: { errors: [], hasErrors: false },
        grammar_details: { issues: [], hasConnector: false },
        overall_score: 0,
        raw_score: 0,
        band: 'Band 5',
        feedback: `❌ Form check failed: ${formCheck.errors.join(', ')}`,
        scoring_mode: 'local'
      });
    }

    let result = await aiGrade(summary, passage);
    if (!result) {
      console.log('AI unavailable — using local grader');
      result = localGrade(summary, passage, formCheck);
    }

    const rawScore = Math.min(8,
      (result.form?.value      || 0) +
      (result.content?.value   || 0) +
      (result.grammar?.value   || 0) +
      (result.vocabulary?.value|| 0)
    );

    const overallScore = Math.round((rawScore / 8) * 90);

    res.json({
      trait_scores: {
        form:       result.form,
        content:    result.content,
        grammar:    result.grammar,
        vocabulary: result.vocabulary
      },
      spell_check: {
        errors:    result.grammar?.spelling_errors || [],
        hasErrors: (result.grammar?.spelling_errors || []).length > 0
      },
      grammar_details: {
        issues:        result.grammar?.grammar_issues || [],
        hasConnector:  result.grammar?.has_connector  || false,
        connectorType: result.grammar?.connector_type || null
      },
      overall_score: overallScore,
      raw_score:     rawScore,
      band:          BAND_MAP[rawScore] || 'Band 5',
      feedback:      result.feedback,
      scoring_mode:  result.scoring_mode
    });

  } catch (error) {
    console.error('Grade route error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ PTE API v4.0.0 on port ${PORT}`);
  console.log(`${ANTHROPIC_API_KEY ? '🤖 AI-primary (Anthropic)' : '⚙️ Local-only'} mode`);
});
