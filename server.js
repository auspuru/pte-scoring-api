const express = require('express');
const cors = require('cors');
const app = express();
const PORT = parseInt(process.env.PORT) || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ========== UTILITY FUNCTIONS ==========
function calculateSimilarity(text1, text2) {
  const set1 = new Set(text1.toLowerCase().match(/\b[a-z]{4,}\b/g) || []);
  const set2 = new Set(text2.toLowerCase().match(/\b[a-z]{4,}\b/g) || []);
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

// *** commonWords defined at module level (before extractConcepts) ***
const commonWords = new Set([
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for', 'not', 'on', 'with',
  'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her',
  'she', 'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what', 'so', 'up',
  'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me', 'when', 'make', 'can', 'like', 'time',
  'no', 'just', 'him', 'know', 'take', 'people', 'into', 'year', 'your', 'good', 'some', 'could',
  'them', 'see', 'other', 'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think',
  'also', 'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first', 'well', 'way', 'even',
  'new', 'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us', 'is', 'was', 'are',
  'were', 'been', 'being', 'has', 'had', 'does', 'did', 'should', 'may', 'might', 'must', 'shall',
  'need', 'dare', 'ought', 'used', 'rarely', 'seldom', 'hardly', 'scarcely', 'barely', 'rather',
  'quite', 'such', 'here', 'where', 'everywhere', 'somewhere', 'anywhere', 'nowhere', 'above',
  'below', 'again', 'further', 'once', 'today', 'tomorrow', 'tonight', 'yesterday', 'soon',
  'later', 'early', 'never', 'always', 'usually', 'often', 'sometimes', 'frequently', 'generally',
  'already', 'yet', 'still', 'however', 'moreover', 'furthermore', 'therefore', 'thus', 'hence',
  'consequently', 'accordingly', 'nevertheless', 'nonetheless', 'otherwise', 'instead',
  'meanwhile', 'subsequently', 'similarly', 'likewise', 'conversely', 'whereas', 'although',
  'though', 'despite', 'spite', 'regardless', 'notwithstanding', 'unless', 'whether', 'while',
  'why', 'whatever', 'whichever', 'whoever', 'whomever', 'anyone', 'someone', 'everyone',
  'anybody', 'somebody', 'everybody', 'nobody', 'anything', 'something', 'everything', 'nothing',
  'each', 'every', 'both', 'either', 'neither', 'many', 'much', 'more', 'most', 'few', 'fewer',
  'fewest', 'little', 'less', 'least', 'several', 'various', 'numerous', 'plenty', 'lot', 'lots',
  'amount', 'number', 'quantity', 'same', 'very', 'else', 'contrary', 'contrast', 'comparison',
  'comparatively', 'according', 'addition', 'additionally', 'result', 'conclusion', 'summary',
  'example', 'instance', 'illustration', 'fact', 'case', 'point', 'evidence', 'reason',
  'explanation', 'purpose', 'intention', 'aim', 'objective', 'goal', 'argument', 'view', 'opinion',
  'perspective', 'viewpoint', 'standpoint', 'position', 'attitude', 'belief', 'idea', 'notion',
  'concept', 'theory', 'hypothesis', 'thesis', 'theme', 'topic', 'subject', 'matter', 'issue',
  'question', 'problem', 'concern', 'aspect', 'factor', 'element', 'component', 'constituent',
  'ingredient', 'part', 'portion', 'section', 'segment', 'share', 'proportion', 'percentage',
  'ratio', 'rate', 'degree', 'level', 'extent', 'scope', 'range', 'scale', 'magnitude', 'size',
  'volume', 'sum', 'total', 'aggregate', 'average', 'mean', 'maximum', 'minimum', 'extreme',
  'limit', 'source', 'origin', 'root', 'cause', 'basis', 'foundation', 'ground', 'background',
  'context', 'circumstance', 'situation', 'condition', 'state', 'status', 'place', 'location',
  'site', 'spot', 'area', 'region', 'zone', 'sector', 'field', 'domain', 'realm', 'sphere',
  'territory', 'quarter', 'side', 'respect', 'regard', 'relation', 'relationship', 'connection',
  'association', 'link', 'tie', 'bond', 'parallel', 'similarity', 'difference', 'distinction',
  'variation', 'variety', 'change', 'alteration', 'modification', 'adjustment', 'adaptation',
  'improvement', 'development', 'growth', 'increase', 'decrease', 'reduction', 'decline', 'drop',
  'fall', 'rise', 'expansion', 'extension', 'spread', 'influence', 'effect', 'impact',
  'consequence', 'outcome', 'product', 'output', 'yield', 'profit', 'benefit', 'advantage',
  'gain', 'value', 'worth', 'importance', 'significance', 'meaning', 'implication', 'inference',
  'deduction', 'assumption', 'presumption', 'supposition', 'interpretation', 'understanding',
  'comprehension', 'apprehension', 'perception', 'awareness', 'consciousness', 'knowledge',
  'information', 'data', 'detail', 'particular', 'specific', 'occurrence', 'event', 'incident',
  'happening', 'episode', 'affair', 'business', 'history', 'past', 'beginning', 'start',
  'commencement', 'onset', 'opening', 'introduction', 'entry', 'admission', 'access', 'approach',
  'means', 'method', 'manner', 'mode', 'fashion', 'style', 'process', 'procedure', 'proceeding',
  'course', 'progress', 'advance', 'advancement', 'progression', 'evolution', 'reach', 'compass',
  'standard', 'criterion', 'measure', 'measurement', 'estimate', 'estimation', 'calculation',
  'computation', 'assessment', 'evaluation', 'appraisal', 'judgment', 'sentiment', 'feeling',
  'emotion', 'passion', 'affection', 'attachment', 'love', 'liking', 'fondness', 'taste',
  'preference', 'inclination', 'tendency', 'trend', 'direction', 'movement', 'motion', 'action',
  'activity', 'operation', 'performance', 'execution', 'implementation', 'realization',
  'achievement', 'accomplishment', 'attainment', 'success', 'victory', 'triumph', 'win',
  'acquisition', 'obtainment', 'procurement', 'possession', 'ownership', 'property', 'belongings',
  'assets', 'estate', 'wealth', 'riches', 'fortune', 'abundance', 'unit', 'module', 'chapter',
  'allocation', 'allotment', 'apportionment', 'distribution', 'dispensation', 'division',
  'partition', 'separation', 'differentiation', 'discrimination', 'discernment', 'observation',
  'notice', 'attention', 'consideration', 'thought', 'reflection', 'deliberation',
  'contemplation', 'meditation', 'cogitation', 'rumination', 'pondering', 'thinking', 'reasoning',
  'ratiocination', 'generalization', 'conception', 'abstraction', 'specification',
  'particularization', 'individualization', 'characterization', 'description', 'account',
  'report', 'narrative', 'story', 'tale', 'chronicle', 'record', 'annals', 'archives',
  'documents', 'documentation', 'proof', 'verification', 'confirmation', 'substantiation',
  'corroboration', 'validation', 'authentication', 'attestation', 'testimony', 'witness',
  'deposition', 'declaration', 'statement', 'assertion', 'claim', 'contention', 'allegation',
  'accusation', 'charge', 'criticism', 'critique', 'review', 'commentary', 'comment', 'remark',
  'utterance', 'expression', 'pronouncement', 'announcement', 'pronunciation', 'enunciation',
  'articulation', 'diction', 'phrasing', 'wording', 'language', 'terminology', 'jargon', 'slang',
  'colloquialism', 'vernacular', 'dialect', 'idiom', 'phrase', 'clause', 'sentence', 'paragraph',
  'passage', 'text', 'content', 'substance', 'gist', 'essence', 'quintessence', 'core', 'heart',
  'crux', 'nucleus', 'kernel', 'marrow', 'pith', 'meat', 'material', 'stuff', 'fabric', 'texture',
  'structure', 'framework', 'frame', 'form', 'shape', 'figure', 'outline', 'profile', 'contour',
  'configuration', 'conformation', 'formation', 'arrangement', 'disposition', 'layout', 'design',
  'pattern', 'model', 'mold', 'cast', 'stamp', 'type', 'sort', 'kind', 'class', 'category',
  'group', 'set', 'batch', 'collection', 'assortment', 'selection', 'series', 'sequence',
  'succession', 'progression', 'chain', 'string', 'train', 'line', 'file', 'column', 'procession',
  'parade', 'march', 'finish', 'end', 'close', 'termination', 'cessation', 'discontinuance',
  'stoppage', 'halt', 'pause', 'break', 'interruption', 'interval', 'interim', 'period', 'spell',
  'stretch', 'span', 'duration', 'term', 'tenure', 'incumbency', 'occupancy', 'tenancy',
  'effects', 'resources', 'money', 'cash', 'capital', 'funds', 'finance', 'finances', 'income',
  'revenue', 'receipts', 'earnings', 'profits', 'proceeds', 'returns', 'interest', 'dividend',
  'quota', 'sharing', 'participation', 'involvement', 'engagement', 'commitment', 'dedication',
  'devotion', 'allegiance', 'loyalty', 'fidelity', 'faithfulness', 'constancy', 'steadfastness',
  'stability', 'firmness', 'solidity', 'strength', 'power', 'force', 'might', 'energy', 'vigor',
  'vitality', 'life', 'spirit', 'soul', 'mind', 'intellect', 'intelligence', 'wit', 'wisdom',
  'literacy', 'education', 'schooling', 'training', 'instruction', 'teaching', 'tuition',
  'coaching', 'tutoring', 'drilling', 'exercise', 'practice', 'rehearsal', 'preparation',
  'readiness', 'fitness', 'suitability', 'appropriateness', 'aptness', 'qualification',
  'competence', 'capability', 'capacity', 'ability', 'faculty', 'facility', 'skill', 'art',
  'knack', 'trick', 'secret', 'mystery', 'enigma', 'riddle', 'puzzle', 'conundrum', 'query',
  'inquiry', 'interrogation', 'examination', 'investigation', 'research', 'study', 'analysis',
  'scrutiny', 'inspection', 'check', 'surveillance', 'watch', 'monitoring', 'supervision',
  'superintendence', 'oversight', 'care', 'custody', 'keeping', 'preservation', 'conservation',
  'protection', 'safeguarding', 'security', 'safety', 'welfare', 'wellbeing', 'health',
  'prosperity', 'happiness', 'contentment', 'satisfaction', 'fulfillment', 'comfort', 'ease',
  'relief', 'solace', 'consolation', 'support', 'succor', 'aid', 'help', 'assistance', 'service',
  'favor', 'kindness', 'benevolence', 'beneficence', 'philanthropy', 'charity', 'altruism',
  'humanity', 'humaneness', 'compassion', 'sympathy', 'empathy', 'pity', 'commiseration',
  'condolence', 'alleviation', 'mitigation', 'palliation', 'remedy', 'cure', 'healing',
  'treatment', 'therapy', 'therapeutics', 'medication', 'medicine', 'drug', 'pharmaceutical',
  'corrective', 'ameliorative', 'betterment', 'amelioration', 'reform', 'reformation',
  'rectification', 'correction', 'accommodation', 'reconciliation', 'harmonization', 'attunement',
  'tuning', 'regulation', 'divergence', 'departure', 'digression', 'excursion', 'wandering',
  'roaming', 'roving', 'ranging', 'traveling', 'journeying', 'voyaging', 'touring', 'tripping',
  'transport', 'transportation', 'conveyance', 'carriage', 'carrying', 'transmission', 'transfer',
  'transference', 'shift', 'shifting', 'removal', 'remotion', 'displacement', 'dislocation',
  'derangement', 'disorganization', 'confusion', 'disorder', 'chaos', 'disarray', 'jumble',
  'muddle', 'mess', 'clutter', 'litter', 'rubbish', 'trash', 'waste', 'garbage', 'refuse',
  'debris', 'detritus', 'remains', 'remnants', 'relics', 'fragments', 'pieces', 'bits', 'scraps',
  'odds', 'ends', 'leftovers', 'residue', 'residuum', 'remainder', 'rest', 'balance', 'remnant',
  'surplus', 'excess', 'superfluity', 'superabundance', 'overflow', 'overabundance', 'plethora',
  'excessiveness', 'immoderation', 'extravagance', 'wastefulness', 'squandering', 'dissipation',
  'frittering', 'lavishness', 'prodigality', 'profusion', 'affluence', 'opulence', 'luxury',
  'sumptuousness', 'magnificence', 'splendor', 'grandeur', 'greatness', 'eminence', 'dignity',
  'nobility', 'honor', 'esteem', 'admiration', 'appreciation', 'approval', 'commendation',
  'praise', 'acclaim', 'acclamation', 'applause', 'ovation', 'cheer', 'plaudit', 'compliment',
  'flattery', 'adulation', 'blandishment', 'cajolery', 'coaxing', 'wheedling', 'persuasion',
  'inducement', 'incentive', 'incitement', 'encouragement', 'inspiration', 'motivation',
  'stimulus', 'spur', 'goad', 'prompt', 'urge', 'drive', 'impulse', 'compulsion', 'pressure',
  'stress', 'strain', 'tension', 'anxiety', 'worry', 'trouble', 'difficulty', 'predicament',
  'plight', 'dilemma', 'quandary', 'impasse', 'stalemate', 'standstill', 'deadlock', 'checkmate',
  'defeat', 'overthrow', 'downfall', 'collapse', 'failure', 'disaster', 'catastrophe', 'calamity',
  'misfortune', 'mishap', 'accident', 'casualty', 'mischance', 'setback', 'reverse', 'relapse',
  'recurrence', 'repetition', 'reiteration', 'renewal', 'resumption', 'return', 'reversion',
  'retrogression', 'regression', 'retrogradation', 'deterioration', 'degeneration', 'decay',
  'decomposition', 'rotting', 'putrefaction', 'corruption', 'infection', 'contamination',
  'pollution', 'defilement', 'taint', 'tarnish', 'stain', 'blemish', 'flaw', 'defect',
  'imperfection', 'fault', 'error', 'mistake', 'blunder', 'slip', 'oversight', 'omission',
  'neglect', 'default', 'nonperformance', 'nonfulfillment', 'breach', 'violation', 'infringement',
  'transgression', 'trespass', 'offense', 'sin', 'crime', 'misdeed', 'wrongdoing', 'misconduct',
  'misbehavior', 'malfeasance', 'misfeasance', 'malpractice', 'negligence', 'carelessness',
  'heedlessness', 'inattention', 'inadvertence', 'thoughtlessness', 'inconsiderateness',
  'tactlessness', 'indiscretion', 'imprudence', 'folly', 'foolishness', 'silliness', 'stupidity',
  'absurdity', 'ridiculousness', 'ludicrousness', 'preposterousness', 'nonsense', 'balderdash',
  'twaddle', 'drivel', 'gibberish', 'gobbledygook', 'argot', 'cant', 'lingo', 'patois',
  'vulgarism', 'barbarism', 'solecism', 'impropriety', 'incorrectness', 'inaccuracy',
  'imprecision', 'inexactness', 'vagueness', 'ambiguity', 'equivocation', 'ambivalence',
  'uncertainty', 'unsureness', 'doubtfulness', 'dubiousness', 'questionableness',
  'problematicness', 'debatability', 'controversy', 'dispute', 'disputation', 'debate',
  'discussion', 'deliberation', 'consultation', 'conference', 'parley', 'palaver', 'council',
  'assembly', 'congregation', 'gathering', 'meeting', 'convention', 'congress', 'conclave',
  'caucus', 'symposium', 'seminar', 'workshop', 'clinic', 'forum', 'platform', 'stage', 'scene',
  'theater', 'arena', 'ground', 'orbit', 'ambit', 'play', 'latitude', 'leeway', 'margin',
  'allowance', 'tolerance', 'forbearance', 'patience', 'endurance', 'fortitude', 'resignation',
  'submission', 'yielding', 'surrender', 'capitulation', 'armistice', 'truce', 'peace',
  'peacetime', 'wartime', 'conflict', 'combat', 'fighting', 'battle', 'warfare', 'hostilities',
  'strife', 'discord', 'dissension', 'disagreement', 'variance', 'contention', 'contest',
  'competition', 'rivalry', 'opposition', 'antagonism', 'hostility', 'enmity', 'animosity',
  'antipathy', 'aversion', 'repugnance', 'abhorrence', 'loathing', 'hatred', 'detestation',
  'execration', 'abomination', 'horror', 'terror', 'fear', 'fright', 'alarm', 'dread', 'awe',
  'consternation', 'panic', 'trepidation', 'apprehension', 'misgiving', 'qualm', 'scruple',
  'compunction', 'remorse', 'regret', 'repentance', 'contrition', 'penitence', 'atonement',
  'expiation', 'amends', 'reparation', 'restitution', 'redress', 'compensation',
  'indemnification', 'recompense', 'remuneration', 'payment', 'repayment', 'reimbursement',
  'refund', 'rebate', 'discount', 'deduction', 'lowering', 'abatement', 'subsidence', 'ebbing',
  'waning', 'fading', 'attenuation', 'exhaustion', 'depletion', 'drain', 'dispersion',
  'scattering', 'dissemination', 'diffusion', 'recovery', 'recuperation', 'convalescence',
  'restoration', 'reinstatement', 'replacement', 'substitution', 'exchange', 'swap', 'barter',
  'trade', 'traffic', 'commerce', 'merchandising', 'marketing', 'selling', 'vending', 'retailing',
  'hawking', 'peddling', 'huckstering', 'haggling', 'bargaining', 'negotiation', 'transaction',
  'deal', 'contract', 'agreement', 'arrangement', 'settlement', 'compromise', 'conformation',
  'compliance', 'conformance', 'adherence', 'observance', 'gratification', 'pleasure',
  'enjoyment', 'delight', 'joy', 'felicity', 'bliss', 'ecstasy', 'rapture', 'exaltation',
  'elation', 'jubilation', 'exultation', 'rejoicing', 'celebration', 'ceremony', 'rite',
  'ritual', 'worship', 'adoration', 'veneration', 'reverence', 'homage', 'deference',
  'obeisance', 'obedience', 'heeding', 'mindful', 'note', 'warmth', 'reliability',
  'dependability', 'trustworthiness', 'integrity', 'honesty', 'probity', 'uprightness',
  'rectitude', 'righteousness', 'virtue', 'goodness', 'morality', 'ethics', 'principles',
  'standards', 'ideals', 'values', 'morals', 'manners', 'behavior', 'conduct', 'demeanor',
  'deportment', 'bearing', 'port', 'presence', 'appearance', 'look', 'countenance', 'visage',
  'face', 'features', 'lineament', 'physiognomy', 'complexion', 'color', 'hue', 'tint', 'shade',
  'tone', 'tinge', 'touch', 'suggestion', 'hint', 'trace', 'vestige', 'sign', 'mark', 'token',
  'indication', 'certification', 'guarantee', 'warranty', 'assurance', 'promise', 'word',
  'pledge', 'vow', 'oath', 'affirmation', 'broadcast', 'disclosure', 'revelation', 'divulgence',
  'exposure', 'uncovering', 'unmasking', 'exhibition', 'display', 'show', 'demonstration',
  'manifestation', 'oration', 'address', 'lecture', 'talk', 'discourse', 'sermon', 'homily',
  'lesson', 'moral', 'doctrine', 'dogma', 'tenet', 'principle', 'maxim', 'axiom', 'aphorism',
  'adage', 'proverb', 'saying', 'saw', 'dictum', 'precept', 'rule', 'canon', 'law', 'statute',
  'act', 'enactment', 'ordinance', 'decree', 'edict', 'order', 'command', 'directive',
  'injunction', 'brief', 'commission', 'mandate', 'authorization', 'warrant', 'permit',
  'license', 'charter', 'patent', 'copyright', 'trademark', 'brand', 'label', 'tag', 'ticket',
  'slip', 'chit', 'voucher', 'coupon', 'token', 'counter', 'coin', 'specie', 'currency',
  'contingency', 'eventuality', 'possibility', 'probability', 'likelihood', 'prospect',
  'expectation', 'anticipation', 'hope', 'outlook', 'future', 'tomorrow', 'hereafter',
  'afterlife', 'immortality', 'eternity', 'perpetuity', 'continuance', 'permanence',
  'changelessness', 'immutability', 'invariability', 'uniformity', 'regularity', 'evenness',
  'levelness', 'flatness', 'smoothness', 'planeness', 'equality', 'equivalence', 'parity',
  'sameness', 'identity', 'likeness', 'resemblance', 'similitude', 'affinity', 'analogy',
  'correspondence', 'accord', 'concord', 'harmony', 'consonance', 'congruity', 'consistency',
  'compatibility', 'congeniality', 'ripeness', 'maturity', 'completion', 'gap', 'minute',
  'second', 'hour', 'week', 'month', 'decade', 'century', 'millennium', 'age', 'era', 'epoch',
  'date', 'season', 'semester', 'session', 'sitting', 'hearing', 'trial', 'test', 'quiz',
  'exam', 'universal', 'singular', 'certain', 'species', 'genus', 'family', 'phylum', 'kingdom',
  'district', 'figure', 'digit', 'integer', 'whole', 'gross', 'net', 'fraction', 'particle',
  'atom', 'molecule', 'corpuscle', 'grain', 'granule', 'powder', 'dust', 'sand', 'grit',
  'gravel', 'pebble', 'stone', 'rock', 'boulder', 'hill', 'mountain', 'peak', 'summit', 'top',
  'pinnacle', 'height', 'elevation', 'altitude', 'layer', 'stratum', 'bed', 'seam', 'vein',
  'lode', 'deposit', 'accumulation', 'crowd', 'throng', 'multitude', 'mass', 'host', 'army',
  'legion', 'myriad', 'swarm', 'flock', 'herd', 'pack', 'school', 'shoal', 'colony', 'community',
  'society', 'institution', 'establishment', 'foundation', 'corporation', 'company', 'firm',
  'venture', 'undertaking', 'project', 'scheme', 'plan', 'program', 'agenda', 'schedule',
  'timetable', 'calendar', 'diary', 'journal', 'log', 'repository', 'storehouse', 'warehouse',
  'depot', 'magazine', 'arsenal', 'armory', 'reservoir', 'tank', 'cistern', 'basin', 'pool',
  'pond', 'lake', 'sea', 'ocean', 'deep', 'depth', 'abyss', 'chasm', 'gulf', 'bay', 'inlet',
  'cove', 'creek', 'stream', 'brook', 'rivulet', 'rill', 'burn', 'beck', 'river', 'watercourse',
  'waterway', 'channel', 'canal', 'conduit', 'duct', 'pipe', 'tube', 'cylinder', 'barrel',
  'cask', 'keg', 'drum', 'vat', 'container', 'receptacle', 'vessel', 'utensil', 'implement',
  'instrument', 'tool', 'device', 'appliance', 'machine', 'engine', 'motor', 'turbine',
  'generator', 'dynamo', 'alternator', 'transformer', 'converter', 'inverter', 'rectifier',
  'controller', 'governor', 'moderator', 'adjuster', 'adaptor', 'adapter', 'coupling',
  'connector', 'junction', 'joint', 'articulation', 'hinge', 'pivot', 'axis', 'spindle',
  'shaft', 'pole', 'rod', 'bar', 'rail', 'track', 'cable', 'wire', 'cord', 'rope', 'string',
  'thread', 'fiber', 'filament', 'hair', 'bristle', 'whisker', 'feather', 'plume', 'quill',
  'spine', 'prickle', 'thorn', 'spike', 'point', 'crest', 'ridge', 'continuity', 'continuum',
  'entirety', 'totality', 'completeness', 'fullness', 'plentitude', 'repletion', 'satiation',
  'satiety', 'embodiment', 'incarnation', 'representation', 'symbolization', 'typification',
  'exemplification', 'instantiation', 'spectacle', 'sight', 'vista', 'panorama', 'landscape',
  'scenery', 'countryside', 'terrain', 'topography', 'geography', 'geology', 'ecology',
  'habitat', 'globe', 'planet', 'star', 'sun', 'moon', 'satellite', 'asteroid', 'comet',
  'meteor', 'meteorite', 'meteoroid', 'wreckage', 'rubble', 'ruins', 'antiques', 'heirlooms',
  'heritage', 'legacy', 'bequest', 'inheritance', 'patrimony', 'birthright', 'due', 'right',
  'entitlement', 'title', 'residence', 'residency', 'habitation', 'dwelling', 'abode',
  'domicile', 'home', 'house', 'building', 'edifice', 'construction', 'erection', 'shadow',
  'shade', 'darkness', 'blackness', 'obscurity', 'dimness', 'duskiness', 'murkiness',
  'cloudiness', 'fogginess', 'mistiness', 'haziness', 'vaporousness', 'steaminess', 'humidity',
  'dampness', 'moisture', 'wetness', 'sogginess', 'solving', 'resolving', 'settling', 'deciding',
  'determining', 'inferring', 'cerebrating', 'weighing', 'reckoning', 'counting', 'numbering',
  'enumerating', 'listing', 'itemizing', 'detailing', 'version', 'yarn', 'anecdote',
  'compass', 'weight', 'repayment', 'swapping', 'organizations', 'institutions'
]);

function extractConcepts(text) {
  if (!text) return [];
  return text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4)
    .filter(w => !commonWords.has(w));
}

const botPatterns = [
  /\b(this passage|the passage|the text|the author)\b/gi,
  /\b(not only.*but also|on the one hand.*on the other hand)\b/gi,
  /\b(in conclusion|to conclude|in summary|to sum up)\b/gi,
  /\b(furthermore|moreover|nevertheless|nonetheless)\s+furthermore/gi,
  /\b(advantages?|disadvantages?|benefits?|drawbacks?)\s+and\s+(advantages?|disadvantages?|benefits?|drawbacks?)/gi
];

// ========== FORM VALIDATION ==========
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
  if (!/[.!?]$/.test(trimmed)) errors.push('Must end with punctuation');
  if (/[\n\r]/.test(summary)) errors.push('Contains line breaks');
  if (/^[•\-*\d]\s|^\d+\.\s/m.test(summary)) errors.push('Contains bullet points');

  return { wordCount, isValidForm: errors.length === 0, errors };
}

// ========== AI GRADING (PRIMARY) ==========
async function aiGrade(summary, passage) {
  if (!ANTHROPIC_API_KEY) return null;
  try {
    const similarity = calculateSimilarity(summary, passage.text);
    const isLikelyCopied = similarity > 0.65;

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
        system: `You are a PTE Academic examiner. Grade summaries STRICTLY with ZERO tolerance for missing key ideas.

PASSAGE KEY ELEMENTS:
- CRITICAL/TOPIC: ${passage.keyElements?.critical || 'N/A'}
- IMPORTANT/PIVOT: ${passage.keyElements?.important || 'N/A'}
- CONCLUSION: ${passage.keyElements?.conclusion || passage.keyElements?.supplementary?.[0] || 'N/A'}

STRICT RULES:
1. CONTENT (0-3): 1 point per captured element
   - 1 point if TOPIC captured with meaning preserved
   - 1 point if PIVOT captured with meaning preserved
   - 1 point if CONCLUSION captured with meaning preserved
   - Paraphrasing OK, meaning changes are NOT
2. PARAPHRASE DETECTION:
   - Accept synonyms that preserve exact meaning
   - REJECT synonyms that change nuance
   - REJECT missing qualifiers
3. BOT/TEMPLATE DETECTION:
   - Generic phrases = RED FLAG

SCORING CRITERIA:
- FORM (0-1): 1 if 5-75 words, one sentence, proper punctuation
- CONTENT (0-3): 1 point per element captured
- GRAMMAR (0-2): 2=no errors+connector, 1=minor errors, 0=major errors
- VOCABULARY (0-2): Always 2 unless extremely repetitive
${isLikelyCopied ? 'WARNING: High lexical similarity detected. Penalize if verbatim reproduction.' : ''}

Return JSON ONLY with no markdown formatting:`,
        messages: [{
          role: 'user',
          content: `PASSAGE: "${passage.text}"

STUDENT SUMMARY: "${summary}"
${isLikelyCopied ? '\nNote: High similarity detected - check for copying.' : ''}

Grade strictly and return EXACTLY this JSON structure:
{
  "form": { "value": 0-1, "word_count": number, "notes": "..." },
  "content": {
    "value": 0-3,
    "topic_captured": true/false,
    "pivot_captured": true/false,
    "conclusion_captured": true/false,
    "meaning_preserved": true/false,
    "notes": "..."
  },
  "grammar": {
    "value": 0-2,
    "spelling_errors": [],
    "grammar_issues": [],
    "has_connector": true/false,
    "connector_type": "however/although/etc or null",
    "notes": "..."
  },
  "vocabulary": { "value": 0-2, "notes": "..." },
  "bot_detected": true/false,
  "similarity_score": ${similarity.toFixed(2)},
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
      console.log('No JSON in AI response:', content);
      return null;
    }

    const result = JSON.parse(match[0]);

    // Enforce: if topic not captured, content must be 0
    if (result.content && !result.content.topic_captured && result.content.value > 0) {
      result.content.value = 0;
      result.content.notes = (result.content.notes || '') + ' [AUTO-CORRECTED: Missing critical topic = 0]';
    }

    return { ...result, scoring_mode: 'ai' };
  } catch (e) {
    console.error('AI grading error:', e.message);
    return null;
  }
}

// ========== LOCAL FALLBACK GRADING ==========
function localGrade(summary, passage, formCheck) {
  const sumLower = summary.toLowerCase();
  const similarity = calculateSimilarity(summary, passage.text);
  const isLikelyBot = botPatterns.some(pattern => pattern.test(summary));

  const topicConcepts = extractConcepts(passage.keyElements?.critical);
  const pivotConcepts = extractConcepts(passage.keyElements?.important);
  const conclusionConcepts = extractConcepts(
    passage.keyElements?.conclusion || passage.keyElements?.supplementary?.[0]
  );

  function checkConceptCoverage(concepts, text) {
    if (!concepts || concepts.length === 0) return { captured: true, ratio: 1, matches: 0 };
    const matches = concepts.filter(c => text.includes(c)).length;
    return {
      captured: matches >= Math.ceil(concepts.length * 0.5),
      ratio: matches / concepts.length,
      matches
    };
  }

  const topicCheck = checkConceptCoverage(topicConcepts, sumLower);

  const contrastWords = ['however','although','while','but','yet','though','despite','whereas','nevertheless'];
  const hasContrast = contrastWords.some(w => sumLower.includes(w));
  const pivotCheck = checkConceptCoverage(pivotConcepts, sumLower);
  const pivotCaptured = (hasContrast && pivotCheck.ratio > 0.3) || pivotCheck.ratio >= 0.6;

  const conclusionCheck = checkConceptCoverage(conclusionConcepts, sumLower);

  // CONTENT: 0-3 (1 point per element captured)
  let contentValue = 0;
  if (topicCheck.captured) contentValue += 1;
  if (pivotCaptured) contentValue += 1;
  if (conclusionCheck.captured) contentValue += 1;

  const contentNotes = [
    `Topic:${topicCheck.matches}/${topicConcepts.length}`,
    `Pivot:${pivotCheck.matches}/${pivotConcepts.length}`,
    `Conclusion:${conclusionCheck.matches}/${conclusionConcepts.length}`
  ].join(', ');

  // Similarity penalty — copy-paste detection
  if (similarity > 0.7) {
    contentValue = Math.max(0, contentValue - 1);
  }

  // Grammar check
  const connectors = ['however', 'although', 'while', 'but', 'yet', 'nevertheless', 'whereas',
    'despite', 'though', 'moreover', 'furthermore', 'therefore', 'thus'];
  const hasConnector = connectors.some(c => sumLower.includes(c));
  const connectorType = hasConnector ? connectors.find(c => sumLower.includes(c)) : null;

  // Spell check — uses module-level commonWords + excludes passage words
  const passageWords = new Set(passage.text.toLowerCase().match(/\b[a-z]+\b/g) || []);
  const summaryWords = summary.toLowerCase().match(/\b[a-z]+\b/g) || [];
  const spellingErrors = summaryWords
    .filter(w => w.length > 3 && !commonWords.has(w) && !passageWords.has(w))
    .slice(0, 5);

  const grammarValue = spellingErrors.length === 0 && hasConnector ? 2
    : spellingErrors.length <= 1 ? 1 : 0;

  // Vocabulary
  const vocabValue = 2; // Default; deduct only if extremely repetitive

  // Form
  const formValue = formCheck.isValidForm ? 1 : 0;

  // Raw score: form(0-1) + content(0-3) + grammar(0-2) + vocab(0-2) = max 8
  const rawScore = formValue + contentValue + grammarValue + vocabValue;
  const overallScore = Math.min(90, Math.round((rawScore / 8) * 90));

  // Band
  let band;
  if (overallScore >= 79) band = 9;
  else if (overallScore >= 65) band = 8;
  else if (overallScore >= 51) band = 7;
  else if (overallScore >= 37) band = 6;
  else band = 5;

  return {
    form: {
      value: formValue,
      word_count: formCheck.wordCount,
      notes: formCheck.errors.length > 0 ? formCheck.errors.join('; ') : 'Valid form'
    },
    content: {
      value: contentValue,
      topic_captured: topicCheck.captured,
      pivot_captured: pivotCaptured,
      conclusion_captured: conclusionCheck.captured,
      meaning_preserved: contentValue >= 2,
      notes: contentNotes
    },
    grammar: {
      value: grammarValue,
      spelling_errors: spellingErrors,
      grammar_issues: [],
      has_connector: hasConnector,
      connector_type: connectorType,
      notes: `Connector: ${connectorType || 'none'}, Spelling flags: ${spellingErrors.length}`
    },
    vocabulary: { value: vocabValue, notes: 'Auto-assessed' },
    bot_detected: isLikelyBot,
    similarity_score: parseFloat(similarity.toFixed(2)),
    feedback: contentValue === 0
      ? 'Missing the main topic — identify and include the central idea.'
      : contentValue === 1
        ? 'Captured the main idea but missed the contrast or conclusion.'
        : contentValue === 2
          ? 'Good coverage — try to include all three key elements.'
          : 'Excellent summary covering all key elements.',
    scoring_mode: 'local'
  };
}

// ========== MAIN GRADE ENDPOINT ==========
app.post('/api/grade', async (req, res) => {
  try {
    const { summary, passage } = req.body;

    if (!summary || !passage) {
      return res.status(400).json({ error: 'Missing summary or passage' });
    }

    const formCheck = validateForm(summary);

    // Try AI grading first, fall back to local
    let result = await aiGrade(summary, passage);
    if (!result) {
      result = localGrade(summary, passage, formCheck);
    } else {
      // Add form override from local validator
      result.form = result.form || {};
      result.form.word_count = formCheck.wordCount;
      if (!formCheck.isValidForm) {
        result.form.value = 0;
        result.form.notes = (result.form.notes || '') + ' | FORM ERRORS: ' + formCheck.errors.join('; ');
      }
    }

    // Calculate overall score
    const formVal = result.form?.value ?? 0;
    const contentVal = result.content?.value ?? 0;
    const grammarVal = result.grammar?.value ?? 0;
    const vocabVal = result.vocabulary?.value ?? 0;

    const rawScore = formVal + contentVal + grammarVal + vocabVal;
    const overallScore = Math.min(90, Math.round((rawScore / 8) * 90));

    let band;
    if (overallScore >= 79) band = 9;
    else if (overallScore >= 65) band = 8;
    else if (overallScore >= 51) band = 7;
    else if (overallScore >= 37) band = 6;
    else band = 5;

    res.json({
      ...result,
      overall_score: overallScore,
      band,
      raw_score: rawScore,
      max_raw_score: 8,
      form_check: formCheck
    });

  } catch (err) {
    console.error('Grade endpoint error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// ========== HEALTH CHECK ==========
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    mode: ANTHROPIC_API_KEY ? 'ai-primary' : 'local-only',
    version: '12.0.0'
  });
});

app.listen(PORT, () => {
  console.log(`PTE Grader API v12.0.0 running on port ${PORT}`);
  console.log(`Mode: ${ANTHROPIC_API_KEY ? 'AI-primary (Claude Haiku)' : 'Local fallback only'}`);
});
