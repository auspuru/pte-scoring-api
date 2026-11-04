(function (root, factory) {
  const predictions = root.ReadingPredictionsSep2026 || (typeof require === 'function' ? require('./reading-predictions-sep-2026') : null);
  const fibQuality = root.ReadingFibQuality || (typeof require === 'function' ? require('./reading-fib-quality') : null);
  const patternBank = root.ReadingFibPatternBank || (typeof require === 'function' ? require('./reading-fib-pattern-bank') : null);
  const api = factory(predictions, fibQuality, patternBank);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReadingMockTools = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (predictions, fibQuality, patternBank) {
  'use strict';
  const APPROVED_HIW_RECORDS={
  "hiw-c2-01": {
    "key": "hiw-c2-01-neural-20261104-1",
    "text": "Administrative standards are often defended as a means of insulating decisions from personal preference. Their legitimacy, however, remains contingent on the purposes they serve and the circumstances in which they are applied. A rule may constrain discretion without eliminating the judgement required to interpret an unusual case. Treating every classification as provisional does not entail abandoning consistency; it acknowledges that categories can obscure distinctions relevant to a defensible decision. The crucial question is whether departures from routine are authorised through reasons that others can examine. Where decisions are reversible, institutions can learn from objections without presenting every revision as an admission of incompetence. Accountability therefore depends on making interpretations contestable while preserving a coherent explanation of why comparable cases receive comparable treatment.",
    "seconds": 54.912,
    "hash": "235afbf871a7"
  },
  "hiw-c2-02": {
    "key": "hiw-c2-02-neural-20261104-1",
    "text": "A model can reproduce an observed pattern without establishing the mechanism that generated it. This distinction is particularly consequential when observational data are used to recommend an intervention. An association may persist because an unmeasured variable influences both the supposed cause and the outcome, leaving confounding unresolved. Even a statistically identifiable relationship need not remain invariant when the circumstances of its production change. The purpose of a useful model is consequently not to conceal these dependencies beneath a precise numerical prediction, but to specify which assumptions permit that prediction to travel. Its conclusions should remain conditional on those assumptions and receptive to evidence that exposes their limits. Precision becomes informative only when accompanied by scrutiny of what has been measured, what has been omitted, and what the analysis can legitimately support.",
    "seconds": 56.448,
    "hash": "2bb0ef177d78"
  },
  "hiw-c2-03": {
    "key": "hiw-c2-03-neural-20261104-1",
    "text": "An archive is a selective residue of past activity rather than an exhaustive account of what occurred. Documents survive through decisions about preservation, institutional priorities and accidents of material durability. An apparent absence must therefore be interpreted in relation to the processes that produced the collection. Where a claim is corroborated by independent records, confidence may increase, but the provenance of each record still matters. Repetition can reflect a shared administrative source rather than several independent observations. Historians must also distinguish contingent gaps in documentation from the systematic exclusion of people whose experiences were seldom recorded. Silence cannot simply be converted into evidence of consent. A responsible interpretation remains provisional where the surviving material cannot discriminate between plausible explanations, while stating clearly which conclusions the available evidence does sustain.",
    "seconds": 53.856,
    "hash": "c37bea301064"
  },
  "hiw-c2-04": {
    "key": "hiw-c2-04-neural-20261104-1",
    "text": "The apparent stability of an ecosystem can obscure a gradual erosion of its capacity to absorb disturbance. A lake may retain familiar characteristics while accumulating pressures that bring it closer to a threshold. Because the response can involve nonlinearity, a modest additional disturbance may produce a disproportionate change. Restoration then becomes more complicated than merely reversing the final pressure: feedback within the altered system can perpetuate the new condition. This possibility does not make recovery futile, but it qualifies the assumption that degradation and restoration follow symmetrical paths. Effective management attends to early indications of diminishing resilience while acknowledging that their interpretation is uncertain. The objective is to preserve options for intervention before an apparently incremental process produces a transition whose consequences are difficult to reverse.",
    "seconds": 54.312,
    "hash": "5ca0747be41b"
  },
  "hiw-c2-05": {
    "key": "hiw-c2-05-neural-20261104-1",
    "text": "A translation may be lexically accurate yet alter the relationship between a speaker and an audience. Forms of address, understated objections and strategically unresolved references carry pragmatic implications that cannot always be transferred through equivalent vocabulary. The translator must decide which ambiguities are incidental and which are constitutive of the original argument. Resolving every uncertainty can impose a clarity that the source deliberately withholds; reproducing every unfamiliar construction can make a coherent voice seem needlessly obscure. Fidelity consequently requires a negotiated balance between intelligibility and the preservation of meaningful difference. Such judgement is neither arbitrary nor reducible to a universal formula. It becomes defensible when the translator can explain how a particular choice sustains the force of an utterance, including what it insinuates without explicitly asserting.",
    "seconds": 55.008,
    "hash": "675d38806ac8"
  },
  "hiw-c2-06": {
    "key": "hiw-c2-06-neural-20261104-1",
    "text": "Inviting people to speak does not by itself ensure that their contributions receive equitable consideration. A participant may be formally included while the credibility of their testimony is discounted through assumptions about expertise or social standing. Conversely, familiar institutional language can confer authority on a claim whose evidential basis remains weak. Addressing this asymmetry requires more than an indiscriminate declaration that every statement deserves equal weight. It requires examining how credibility is allocated, what opportunities exist to challenge an interpretation, and whether participants possess the resources to make their experiences intelligible within the discussion. Deliberation improves when these conditions become explicit and revisable. The aim is neither automatic deference nor reflexive scepticism, but a process in which the reasons for accepting or rejecting a contribution can themselves be questioned.",
    "seconds": 57.72,
    "hash": "32706ec365f0"
  },
  "hiw-c2-07": {
    "key": "hiw-c2-07-neural-20261104-1",
    "text": "Infrastructure planning distributes opportunities across time as well as across space. A project that appears efficient under current assumptions may foreclose alternatives that later generations would have preferred. This does not imply that all irreversible investments should be deferred, since postponement also imposes costs and can entrench existing disadvantages. It does require distinguishing uncertainty about future demand from disagreement about whose interests should determine the decision. Appraisal becomes more transparent when these issues are articulated separately instead of being compressed into a single forecast. Where feasible, modular designs can preserve flexibility without requiring planners to predict every subsequent development. Their value lies partly in the options they retain, including the ability to revise a commitment when its original rationale no longer withstands public examination.",
    "seconds": 54.216,
    "hash": "3c7120c50b36"
  },
  "hiw-c2-08": {
    "key": "hiw-c2-08-neural-20261104-1",
    "text": "Automated classification acquires an appearance of neutrality when its categories are presented as purely technical. Yet the choice of a target variable already embeds a judgement about which differences matter. A system trained to reproduce previous decisions may faithfully replicate patterns that an institution ought to reconsider. Evaluating its performance therefore requires attention to the provenance of the labels as well as the frequency of predictive errors. Aggregated accuracy can conceal uneven consequences for groups whose circumstances are inadequately represented in the training material. Accountability depends on making these limitations legible to those affected and providing a practicable route for contesting decisions. The central challenge is not simply to increase computational sophistication, but to ensure that the purposes governing classification remain explicit, revisable and answerable to public reasons.",
    "seconds": 54.552,
    "hash": "6a9624d31e9a"
  },
  "hiw-c2-09": {
    "key": "hiw-c2-09-neural-20261104-1",
    "text": "Conserving a historic building involves interpreting continuity rather than simply arresting change. Materials decay, functions evolve and successive alterations may acquire historical significance of their own. Restoring a structure to an imagined original condition can erase evidence of the very processes that make it valuable. Authenticity is therefore not exhausted by the survival of individual components; it also concerns the intelligibility of relationships between fabric, use and setting. This broader account does not license unrestricted redevelopment. It calls for a discriminating judgement about which interventions sustain the building's significance and which merely substitute a convenient narrative for its complexity. Documentation should make those judgements traceable, allowing later conservators to distinguish inherited features from deliberate additions and to reassess decisions whose assumptions may no longer be persuasive.",
    "seconds": 58.32,
    "hash": "31017c258281"
  },
  "hiw-c2-10": {
    "key": "hiw-c2-10-neural-20261104-1",
    "text": "A public programme may satisfy its numerical targets while failing to realise the purpose for which those targets were introduced. Once an indicator becomes consequential for funding, organisations have an incentive to optimise what is counted, even when doing so displaces less measurable responsibilities. This divergence is not an inevitable consequence of quantification, but it reveals the danger of treating a proxy as an exhaustive definition of success. Evaluation should examine how reported improvements were produced and whether their benefits endure beyond the reporting interval. Independent scrutiny and qualitative evidence can expose achievements that are nominal rather than substantive. A credible assessment preserves the usefulness of measurement while keeping its categories subordinate to the public purposes they are meant to illuminate, rather than allowing the categories themselves to dictate those purposes.",
    "seconds": 53.904,
    "hash": "febe37c61e60"
  },
  "hiw-11": {
    "key": "hiw-11-neural-20261104-1",
    "text": "Planting trees can reduce the temperature of a city street, but the benefits depend on more than the number of saplings installed. A continuous canopy provides shade along an entire walking route, whereas isolated trees may leave long stretches exposed. Planners must therefore consider where people actually travel and where heat is most persistent. Maintenance is equally important: restricted roots and inadequate watering can undermine an otherwise ambitious planting programme. Residents may also value open space for markets, games and community events, so the design must accommodate several uses. Successful projects combine local knowledge with careful observation of seasonal conditions. Their performance should be evaluated through changes in comfort and access over time, rather than through planting totals alone, because survival and distribution determine who ultimately benefits.",
    "seconds": 51.864,
    "hash": "1410ace4efb6"
  },
  "hiw-12": {
    "key": "hiw-12-neural-20261104-1",
    "text": "Repeating a scientific study is sometimes treated as a straightforward test of whether the original researchers were correct. In practice, replication requires careful attention to the conditions under which a finding was produced. Differences in equipment, participants or measurement procedures can influence the result without implying misconduct. Researchers should make these differences explicit and distinguish a failure to reproduce an effect from evidence that the effect is impossible. A useful replication may reveal that an apparent general principle depends on a narrower set of circumstances. This discovery can refine a theory rather than simply discredit it. Open methods and accessible data allow others to examine competing explanations, while several independent investigations provide a stronger basis for judgement than a single dramatic success or failure reported in isolation.",
    "seconds": 54.456,
    "hash": "3212f45c562a"
  },
  "hiw-13": {
    "key": "hiw-13-neural-20261104-1",
    "text": "A product that can be repaired easily may remain useful long after its original warranty has expired. Yet repairability is determined partly by decisions made before manufacturing begins. Components joined with removable fasteners are generally more accessible than those sealed permanently inside a casing. Clear documentation also matters, since a replacement part has limited value if technicians cannot identify the fault. Manufacturers may argue that a compact design improves performance, but this advantage must be weighed against the costs of premature disposal. Designing for repair does not require every component to last indefinitely. Instead, it allows predictable failures to be addressed without discarding the whole device. Such an approach can conserve materials while supporting local services, provided that spare parts and reliable information remain available throughout the product's working life.",
    "seconds": 58.8,
    "hash": "94292fd6657f"
  },
  "hiw-14": {
    "key": "hiw-14-neural-20261104-1",
    "text": "Restoring a coastal wetland involves more than planting vegetation in an area that has lost its original habitat. Water must move through the landscape at suitable intervals, carrying sediment and creating conditions in which different species can establish themselves. If an old embankment continues to restrict tidal flow, newly planted vegetation may struggle despite intensive maintenance. Restoration teams therefore begin by investigating the physical processes that sustain the habitat. They also consider neighbouring communities, whose access routes or drainage systems may be affected by proposed changes. A successful project balances ecological recovery with these practical concerns and monitors outcomes over several seasons. Early fluctuations do not necessarily indicate failure, because living systems respond unevenly and may require time to develop the diversity and structure of an established wetland.",
    "seconds": 56.016,
    "hash": "eeb23036390b"
  },
  "hiw-15": {
    "key": "hiw-15-neural-20261104-1",
    "text": "Reading a familiar page can create a strong impression that its contents have been learned. However, recognition while the information remains visible is different from retrieving it without assistance. Students who close the book and attempt to explain an idea may discover gaps that repeated reading had concealed. These difficulties can be useful because they identify what needs further attention. Effective retrieval practice includes feedback, allowing mistaken answers to be corrected before they become established. It also benefits from spacing, with material revisited after an interval instead of rehearsed continuously in a single sitting. The aim is not to make every practice attempt effortless. Some manageable difficulty can strengthen later recall, provided that the learner eventually reaches an accurate understanding and connects individual facts to a coherent explanation.",
    "seconds": 51.312,
    "hash": "f5075ce59d9c"
  },
  "hiw-16": {
    "key": "hiw-16-neural-20261104-1",
    "text": "A museum label may appear to offer a neutral description of an object, yet its selection of details directs the visitor's attention. Naming a maker, explaining a technique or describing an object's journey into the collection can produce quite different interpretations. Curators increasingly consult communities whose knowledge was excluded from earlier displays. This collaboration can reveal meanings that are absent from written catalogues, although agreement should not be assumed simply because consultation has occurred. Different contributors may understand the same object through distinct histories and responsibilities. A thoughtful exhibition makes these perspectives visible while explaining the evidence behind particular claims. Its purpose is not to remove all uncertainty, but to help visitors recognise how knowledge is assembled and why an apparently familiar object may support more than one account.",
    "seconds": 52.512,
    "hash": "9ea85eac1b23"
  },
  "hiw-17": {
    "key": "hiw-17-neural-20261104-1",
    "text": "Extending public transport into the night can improve access to employment, especially for people whose shifts begin or end outside ordinary commuting hours. Nevertheless, a timetable alone does not guarantee a useful service. Connections must be coordinated, waiting areas should feel secure, and information needs to remain available when staffing is reduced. A route with modest passenger numbers may still provide substantial value if it links workers to a hospital or a distribution centre. Evaluating such services only through average occupancy can overlook these wider benefits. Transport planners therefore examine who depends on each connection and what alternatives are realistically affordable. The challenge is to design a reliable network within limited resources, using evidence from actual journeys rather than assuming that daytime travel patterns continue unchanged throughout the night.",
    "seconds": 54.0,
    "hash": "a07c43a44f42"
  },
  "hiw-18": {
    "key": "hiw-18-neural-20261104-1",
    "text": "Seed collections provide a reserve of plant diversity that may become valuable when growing conditions change. Their usefulness, however, depends on how representative and well documented the stored material is. Collecting many seeds from a small number of closely related plants can create an impressive inventory while preserving relatively little genetic variation. Collectors therefore sample across populations and record the environments in which the plants were found. Storage also requires continuing attention, because seeds differ in their tolerance of drying and gradually lose viability. Periodic testing helps staff decide when a collection must be renewed. These facilities complement conservation in natural habitats rather than replacing it, since an isolated seed cannot preserve all the relationships between a plant, its pollinators, the soil and the surrounding ecological community.",
    "seconds": 55.608,
    "hash": "a75a06ae9f29"
  },
  "hiw-19": {
    "key": "hiw-19-neural-20261104-1",
    "text": "Converting public records into digital files can make information easier to locate, but accessibility is not achieved simply by scanning documents. Search systems depend on accurate descriptions, readable text and consistent information about when and how each record was created. A badly indexed collection can remain effectively invisible even when every page is online. Long term preservation presents another challenge, because software formats and storage systems eventually become obsolete. Institutions need procedures for checking files, migrating them to suitable formats and documenting any changes made during that process. They must also consider which personal details should be restricted and which records serve a legitimate public interest. The objective is durable and intelligible access, supported by clear responsibilities, rather than the rapid accumulation of files that nobody can reliably interpret.",
    "seconds": 56.52,
    "hash": "b58d48b311ca"
  },
  "hiw-20": {
    "key": "hiw-20-neural-20261104-1",
    "text": "A river connects places that may be governed by different authorities and used for competing purposes. An action that improves conditions in one location can transfer a problem downstream, especially when drainage works accelerate the movement of water. Managing the catchment as a connected system therefore requires cooperation beyond individual property boundaries. Farmers, residents and local agencies may agree on the need to reduce flooding while disagreeing about where water should be retained. Evidence about soils, rainfall and land use can clarify the available options, but it does not eliminate questions about how costs are shared. Effective planning makes these tradeoffs explicit and revisits decisions as conditions change. It also recognises that small interventions can have cumulative effects, so their combined consequences matter as much as the performance of any single project.",
    "seconds": 51.96,
    "hash": "eebb2f9097d5"
  }
};
  function approvedQuestion(q){
    if(!q||q.type!=='hiw'||q.audioKey||q.fixedAudio)return q;
    const entry=APPROVED_HIW_RECORDS[q.id];if(!entry)return q;
    if(q.audioText!==entry.text)return{...q,fixedAudio:true,audioUnavailable:true,audioUrl:null};
    return{...q,fixedAudio:true,audioKey:entry.key,audioVersion:'approved-audio-2026-11-04.1',audioSeconds:entry.seconds,audioUrl:'/practice-audio/'+entry.key+'.mp3?v=sha256-'+entry.hash};
  }
  const extraLabels = { swt: 'Summarise written text', hcs: 'Highlight Correct Summary', hiw: 'Highlight Incorrect Words' };
  const AUDIO_VARIANTS = Object.freeze(['single', 'ambient', 'two-speakers', 'sound-cue', 'mixed']);
  const AUDIO_BACKGROUNDS = Object.freeze([
    { id: 'rain', label: 'Rain' }, { id: 'traffic', label: 'Passing traffic' },
    { id: 'wind', label: 'Wind' }, { id: 'office', label: 'Office typing' }
  ]);
  const AUDIO_CUES = Object.freeze(['woodpecker-chirp', 'phone-ring']);
  const LANGUAGE_FIRST_FIB_EXCLUDE = Object.freeze({
    dropdown: new Set(['RFIB_002','RFIB_005','RFIB_006','RFIB_007','RFIB_010','RFIB_014','RFIB_018','RFIB_019','RFIB_047','RFIB_049']),
    wordbank: new Set(['RDWD_001','RDWD_002','RDWD_004','RDWD_005','RDWD_006','RDWD_007','RDWD_008','RDWD_010','RDWD_013','RDWD_016','RDWD_030','RDWD_037','RDWD_047'])
  });
  const TECHNICAL_FIB_TERMS = /\b(?:polygenic|deadweight|allele|genotype|phenotype|immunoglobulin|subduction|quantitative easing|bond yield|fiscal multiplier|mitochondri|pathogen resistance)\b/i;
  function strengthenFib(q, seed) {
    return fibQuality && ['dropdown','wordbank'].includes(q?.type)
      ? fibQuality.strengthen(q, seed || q.uid || q.id || q.title)
      : q;
  }
  function languageFirstFib(q) {
    if (!q || !['dropdown','wordbank'].includes(q.type)) return false;
    if (LANGUAGE_FIRST_FIB_EXCLUDE[q.type]?.has(String(q.id))) return false;
    return !TECHNICAL_FIB_TERMS.test([q.title,q.passage,q.answers,q.answer,q.options,q.wordBank].flat(Infinity).join(' '));
  }
  function qualityFibPool(bank, type, offset = 0, minimumWords = 0) {
    const library = (bank.practiceLibraries || []).find(l => l.id === type)?.questions || [];
    const core = (bank.sets || []).flatMap(set => (set.questions || []).filter(q => q.type === type)
      .map(q => ({ ...q, uid: q.uid || set.id + ':' + q.id, reasoning: q.reasoning || set.reasoning?.[q.id] || {} })));
    const pattern = patternBank?.[type] || [];
    const merged = [...pattern, ...library].filter(q => languageFirstFib(q) && String(q.passage || '').trim().split(/\s+/).length >= minimumWords).map(q => strengthenFib(q, 'practice:'+q.id));
    const seen = new Set(), unique = merged.filter(q => {
      const identity = String(q.passage || '').trim().replace(/\s+/g,' ').toLowerCase();
      if (!identity || seen.has(identity)) return false;
      seen.add(identity); return true;
    });
    if (!unique.length) return [];
    const shift = ((offset % unique.length) + unique.length) % unique.length;
    return [...unique.slice(shift), ...unique.slice(0,shift)];
  }
  function hash(value) {
    let n = 2166136261;
    for (const ch of String(value || '')) { n ^= ch.charCodeAt(0); n = Math.imul(n, 16777619); }
    return n >>> 0;
  }
  const DISTRACTION_GAIN = 0.55;
  // HIW combines both cue sounds, varied backgrounds and two speaker turns.
  // The recording text and answer coordinates are independent of these layers.
  function audioVariant(q, challenge = true) {
    return q?.type === 'hiw' && challenge ? 'mixed' : 'single';
  }
  function audioPlayback(q, challenge = true) {
    if(q?.fixedAudio)return{fixedAudio:true,audioUrl:q.audioUrl,audioSeconds:q.audioSeconds,variant:'single',label:'Recorded prompt',transcript:q.audioText||''};
    const variant = audioVariant(q, challenge);
    if (variant === 'single') return { variant, label: 'Single-speaker audio', transcript: q?.audioText || '' };
    const background = AUDIO_BACKGROUNDS[hash(q.id || q.uid) % AUDIO_BACKGROUNDS.length].id;
    return {
      variant, speakers: 2, background, cues: [...AUDIO_CUES],
      label: 'Two speakers · ' + AUDIO_BACKGROUNDS.find(item => item.id === background).label + ' · Woodpecker chirps + phone ring',
      transcript: q?.audioText || ''
    };
  }
  function seeded(seed) {
    let n = hash(seed) || 1;
    return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; };
  }
  function shuffle(items, seed) {
    const next = items.slice(), random = seeded(seed);
    for (let i = next.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [next[i], next[j]] = [next[j], next[i]]; }
    if (next.length > 1 && next.every((value, i) => value === items[i])) [next[0], next[1]] = [next[1], next[0]];
    return next;
  }
  // Keep answer keys in their original coordinate system. Only the rendered
  // order changes, and the same question receives the same order after reload.
  function prepareQuestion(question, seed = question?.uid || question?.id) {
    const q = JSON.parse(JSON.stringify(question || {}));
    if (q.optionOrderVersion === 1) return q;
    if (Array.isArray(q.options)) q.options = q.options.map((row, i) => shuffle(row, `${seed}:options:${i}`));
    if (Array.isArray(q.bank)) q.bank = shuffle(q.bank, `${seed}:bank`);
    if (Array.isArray(q.items)) q.items = shuffle(q.items, `${seed}:items`);
    if (Array.isArray(q.choices)) {
      const original = (q.originalChoices || q.choices).slice(), indices = shuffle(original.map((_, i) => i), `${seed}:choices`);
      q.originalChoices = original;
      q.choiceIndices = indices;
      q.choices = indices.map(i => original[i]);
    }
    q.optionOrderVersion = 1;
    return q;
  }
  function prepareQuestions(questions, seed = '') { return (Array.isArray(questions) ? questions : []).map((q, i) => prepareQuestion(q, `${seed}:${q.uid || q.id || i}`)); }
  function choiceText(q, originalIndex) {
    if (Array.isArray(q?.originalChoices)) return q.originalChoices[originalIndex];
    if (Array.isArray(q?.choiceIndices)) return q.choices[q.choiceIndices.indexOf(originalIndex)];
    return q?.choices?.[originalIndex];
  }
  function scoreExtra(q, answer = [], assessment) {
    const a = Array.isArray(answer) ? answer : [];
    if (q.type === 'hcs') return { earned: a.length && a[0] === q.answer ? 1 : 0, possible: 1 };
    if (q.type === 'hiw') return { earned: Math.max(0, [...new Set(a)].reduce((n, index) => n + (q.answers.includes(index) ? 1 : -1), 0)), possible: q.answers.length };
    if (q.type !== 'swt') return null;
    if (!String(a[0] || '').trim()) return { earned: 0, possible: 9 };
    const data = assessment?.result;
    // Local SWT scoring is a valid practice estimate. Missing AI-only
    // annotations must not exclude an otherwise complete local score from the
    // mixed-mock total; only a genuinely provisional score stays pending.
    const valid = data && !data.score_provisional &&
      Number.isFinite(data.raw_score) && data.raw_score >= 0 && data.raw_score <= 9 && data.max_raw_score === 9 &&
      ['content', 'form', 'grammar', 'vocabulary'].every(key => Number.isFinite(data.trait_scores?.[key]));
    return valid ? { earned: data.raw_score, possible: 9 } : { earned: 0, possible: 9, pending: true };
  }
  function isAudio(q) { return q.type === 'hcs' || q.type === 'hiw'; }
  // Pearson PTE Academic Test Taker Score Guide, p. 40; checked 10 September 2026.
  // These are format constraints only; scoring is intentionally independent.
  const readingFormat = {
    minutes: [23, 30],
    source: 'https://www.pearsonpte.com/content/dam/ELL/pte/pearsonpte/pdfs/pte-academic-pdfs/PTE-Academic-Test-Taker-Score-Guide.pdf',
    tasks: [
      { type: 'dropdown', label: 'Dropdown blanks', min: 5, max: 6, words: 300 },
      { type: 'mcma', label: 'Multiple answers', min: 2, max: 3, words: 350 },
      { type: 'reorder', label: 'Reorder paragraphs', min: 2, max: 3, words: 150 },
      { type: 'wordbank', label: 'Drag-and-drop blanks', min: 4, max: 5, words: 80 },
      { type: 'mcsa', label: 'Single answer', min: 2, max: 3, words: 300 }
    ]
  };
  function validateReading(questions, minutes) {
    if (!Number.isFinite(minutes) || minutes < readingFormat.minutes[0] || minutes > readingFormat.minutes[1]) throw Error('This reading mock has an invalid section time.');
    if (new Set(questions.map(q => q.uid)).size !== questions.length) throw Error('This reading mock contains repeated questions.');
    const order = readingFormat.tasks.map(t => t.type);
    let last = -1;
    for (const q of questions) {
      const position = order.indexOf(q.type), task = readingFormat.tasks[position];
      if (position < 0 || position < last) throw Error('This reading mock has an invalid task order.');
      last = position;
      const text = q.type === 'reorder' ? q.items.map(item => item.text).join(' ') : q.passage;
      if (String(text || '').trim().split(/\s+/).filter(Boolean).length > task.words) throw Error('A reading passage exceeds the exam format’s word limit.');
    }
    for (const task of readingFormat.tasks) {
      const count = questions.filter(q => q.type === task.type).length;
      if (count < task.min || count > task.max) throw Error('This reading mock has an invalid number of ' + task.label.toLowerCase() + ' questions.');
    }
  }

  function fibContext(passage, index, answer) {
    const token = '[[' + (index + 1) + ']]', source = String(passage || ''), at = source.indexOf(token);
    if (at < 0) return String(answer || '');
    const before = source.slice(0, at).trim().split(/\s+/).slice(-6).join(' ');
    const after = source.slice(at + token.length).trim().split(/\s+/).slice(0, 6).join(' ');
    return [before, answer, after].filter(Boolean).join(' ');
  }
  function languageReasoning(q) {
    const old = q.reasoning?.blanks || [];
    return {
      ...(q.reasoning || {}),
      correct: 'Choose from the grammar, collocation and meaning supplied by the surrounding sentence. No specialist subject knowledge is required.',
      blanks: (q.answers || []).map((answer, i) => ({
        answer,
        explanation: old[i]?.explanation || ('"' + answer + '" gives the natural English fit in "' + fibContext(q.passage, i, answer) + '" and keeps the sentence grammatically and logically coherent.'),
        skill: old[i]?.skill || 'grammar + vocabulary/collocation',
        meaning: old[i]?.meaning || ''
      }))
    };
  }
  // Focused Reading mocks 4–9 use only the current 21–27 September 2026
  // prediction bank. Five RW-FIB plus five Reading-FIB questions per paper
  // stay inside Pearson's published task-count ranges and remain unique.
  function composeReadingBlanksPractice(bank, preset) {
    if (!predictions || predictions.dropdown?.length < 30 || predictions.wordbank?.length < 30)
      throw Error('The September 2026 Reading prediction bank is incomplete.');
    const variants = (bank.mockCatalogue || []).filter(m => m.kind === 'reading-blanks');
    const index = Math.max(0, variants.findIndex(m => m.id === preset.id));
    const take = (type, count, maxWords) => {
      const pool = type === 'dropdown' ? predictions.dropdown : predictions.wordbank;
      const slice = pool.slice(index * count, index * count + count);
      if (slice.length !== count) throw Error('The prediction ' + type + ' pool is incomplete.');
      return slice.map(q => {
        const words=String(q.passage || '').trim().split(/\s+/).filter(Boolean).length;
        if(words>maxWords) throw Error('A prediction passage exceeds the PTE word limit.');
        const strengthened = strengthenFib(q, 'prediction:'+q.uid);
        return { ...strengthened, reasoning: languageReasoning(strengthened) };
      });
    };
    const questions = [...take('dropdown', 5, 300), ...take('wordbank', 5, 80)];
    if (new Set(questions.map(q => q.uid || q.id)).size !== questions.length)
      throw Error('This Reading prediction mock contains repeated questions.');
    return { name: preset.name, minutes: preset.minutes || 25, questions, predictionSource: predictions.source };
  }

  // Reading-only practice uses all five task types. Fill-in-the-blanks are
  // drawn from the language-first pool: answers must be recoverable from
  // context, grammar or collocation rather than specialist subject knowledge.
  function practiceMockNumber(id) {
    const match = /^reading-practice-mock-(\d+)$/.exec(String(id || ''));
    const number = Number(match?.[1]);
    return Number.isInteger(number) && number >= 1 && number <= 15 ? number : null;
  }
  function predictionFibPool(type, offset = 0) {
    const pool = type === 'dropdown' ? predictions?.dropdown : predictions?.wordbank;
    if (!Array.isArray(pool) || !pool.length) return [];
    const shift = ((offset % pool.length) + pool.length) % pool.length;
    return [...pool.slice(shift), ...pool.slice(0, shift)].map(q => {
      const strengthened = strengthenFib(q, 'prediction:' + (q.uid || q.id));
      return { ...strengthened, reasoning: languageReasoning(strengthened) };
    });
  }

  // Reading Practice mocks mirror the current Reading section shape: all five
  // Reading task types, exam order and published task-count ranges. Prediction
  // FIB items use the full-length original language-first bank.
  function composeReadingPractice(bank, preset, preferred) {
    const syntheticNumber = practiceMockNumber(preset.id);
    const family = preset.family === 'sectional' ? 'sectional' : 'practice';
    const familyPresets = (bank.mockCatalogue || []).filter(m => family === 'sectional'
      ? m.family === 'sectional'
      : (m.family === 'practice' || m.kind === 'reading-blanks'));
    const listedIndex = Math.max(0, familyPresets.findIndex(m => m.id === preset.id));
    const familyIndex = syntheticNumber ? syntheticNumber - 1 : listedIndex;
    const index = family === 'sectional' ? familyIndex + 9 : familyIndex;
    const sets = bank.sets || [];
    const rotated = sets.map((_,i) => sets[(i + index) % sets.length]);
    const selected = [], seen = new Set();
    for (const [type, count] of [['dropdown',5],['mcma',2],['reorder',2],['wordbank',5],['mcsa',2]]) {
      let added = 0;
      const spec = readingFormat.tasks.find(task => task.type === type);
      const fib = ['dropdown','wordbank'].includes(type);
      const quality = fib ? qualityFibPool(bank,type,index*5,type === 'dropdown' ? 100 : 60) : [];
      const sources = fib
        ? [{ id:'language-first-'+type, questions:quality }]
        : [preferred, ...rotated].filter(Boolean);
      for (const source of sources) {
        for (const q of source.questions || []) {
          if (q.type !== type) continue;
          const text = type === 'reorder' ? q.items.map(item => item.text).join(' ') : q.passage;
          const identity = String(text || '').trim().replace(/\s+/g,' ').toLowerCase();
          if (!identity || seen.has(identity) || identity.split(/\s+/).length > spec.words) continue;
          selected.push({...q,uid:q.uid || source.id+':'+q.id,reasoning:q.reasoning || source.reasoning?.[q.id] || {}});
          seen.add(identity);
          if (++added === count) break;
        }
        if (added === count) break;
      }
      if (added !== count) throw Error('Not enough distinct '+spec.label.toLowerCase()+' questions for this mock.');
    }
    const minutes = syntheticNumber ? 23 : (preset.minutes || 23);
    validateReading(selected, minutes);
    return {name:preset.name || ('Reading Practice Mock '+(index+1)),minutes,questions:selected};
  }

  function compose(bank, mode, setId, swtPassages) {
    const syntheticNumber = practiceMockNumber(mode);
    const preset = bank.mockCatalogue?.find(item => item.id === mode) || (syntheticNumber ? {
      id: mode, name: 'Reading Practice Mock ' + syntheticNumber, family: 'practice', timed: true, minutes: 23
    } : null);
    if (preset) {
      const set = syntheticNumber
        ? (bank.sets || [])[(syntheticNumber - 1) % (bank.sets || []).length]
        : [...bank.sets,...(bank.importedSets||[])].find(item => item.id === preset.setId);
      if (!set) throw Error('This mock question set is unavailable.');
      if(syntheticNumber || preset.kind==='reading-blanks') return composeReadingPractice(bank, { ...preset, minutes:23 }, set);
      const prepared = ['sectional','practice'].includes(preset.family)
        ? composeReadingPractice(bank, { ...preset, minutes:set.minutes }, set)
        : null;
      const reading = prepared?.questions || set.questions.map(q => ({ ...q, uid: set.id + ':' + q.id, reasoning: set.reasoning[q.id] || {} }));
      validateReading(reading, set.minutes);
      const audio = preset.audioQuestionIds.map(id => bank.audioQuestionBank.find(q => q.id === id));
      if (audio.some(q => !q) || audio.filter(q => q.type === 'hcs').length !== 2 || audio.filter(q => q.type === 'hiw').length !== 2) throw Error('This mock audio set is incomplete.');
      const minimumIntegratedMinutes = 20 + set.minutes + bank.mixedMock.listeningMinutes;
      const sharedMinutes = preset.minutes ? Math.max(preset.minutes, minimumIntegratedMinutes) : undefined;
      return composeIntegrated(preset.name, reading, set.minutes, audio, bank.mixedMock.listeningMinutes, swtPassages, preset.timed, sharedMinutes);
    }
    const sectional = bank.sectionalMocks.find(item => item.id === mode);
    const set = bank.sets.find(item => item.id === (sectional?.setId || setId));
    if (!set) throw Error('This question set is unavailable.');
    const reading = set.questions.map(q => strengthenFib({ ...q, uid: set.id + ':' + q.id, reasoning: set.reasoning[q.id] || {} }, 'set:'+set.id+':'+q.id));
    if (sectional) {
      const questions = sectional.questionRefs ? sectional.questionRefs.map(ref => {
        const source = bank.sets.find(item => item.id === ref.setId);
        const q = source?.questions.find(item => item.id === ref.questionId);
        if (!q) throw Error('A sectional reading question is unavailable.');
        return strengthenFib({ ...q, uid: source.id + ':' + q.id, reasoning: source.reasoning[q.id] || {} }, 'sectional:'+source.id+':'+q.id);
      }) : reading;
      validateReading(questions, sectional.minutes);
      return { name: sectional.name, minutes: sectional.minutes, questions };
    }
    if (mode === 'mock') validateReading(reading, set.minutes);
    if (mode !== 'full') return { name: set.name, minutes: set.minutes, questions: reading };
    return composeIntegrated(bank.mixedMock.name, reading, set.minutes, bank.mixedMock.audioQuestions, bank.mixedMock.listeningMinutes, swtPassages, true);
  }
  function composeIntegrated(name, reading, readingMinutes, audio, listeningMinutes, swtPassages, timed, sharedMinutes) {
    if (!Array.isArray(swtPassages) || swtPassages.length !== 2 || swtPassages.some(p => p?.id == null || !p.text || !p.keyElements) || new Set(swtPassages.map(p => String(p.id))).size !== 2 || new Set(swtPassages.map(p => p.text.trim().replace(/\s+/g, ' ').toLowerCase())).size !== 2) throw Error('Two different SWT passages are required. Please try again.');
    const swt = swtPassages.map((p, i) => ({ id: p.id, uid: 'mixed:swt:' + p.id, type: 'swt', title: p.title || 'Summarise written text', passageId: p.id, passage: p.text, keyPoints: p.keyElements, sampleResponse: p.sampleResponse || '', instructions: 'Read the passage and write a one-sentence summary of 5–75 words. This is SWT ' + (i + 1) + ' of 2.' + (timed ? ' You have 10 minutes for this question.' : ' Take your time in this untimed practice mock.') }));
    const questions = [...swt, ...reading, ...audio.map(approvedQuestion)];
    if (new Set(questions.map(q => q.uid)).size !== questions.length) throw Error('This mock contains repeated questions.');
    const stages = [
      { id: 'swt-1', name: 'SWT 1 of 2', first: 0, last: 0, minutes: 10 },
      { id: 'swt-2', name: 'SWT 2 of 2', first: 1, last: 1, minutes: 10 },
      { id: 'reading', name: 'Reading', first: 2, last: reading.length + 1, minutes: readingMinutes },
      { id: 'listening', name: 'HCS & HIW', first: reading.length + 2, last: questions.length - 1, minutes: listeningMinutes }
    ];
    return { name, minutes: stages.reduce((n, stage) => n + stage.minutes, 0), questions, stages: timed ? stages : undefined };
  }
  // Autoplay, manual playback and review share one audio lifecycle.
  function createSpeaker(env, onState) {
    let active = null, timeout = null, startTimeout = null, serial = 0, volume = 1, utteranceQueue = [], recording = null;
    try { const saved = env.localStorage?.getItem('ipt-exam-volume'); if (saved != null && Number.isFinite(Number(saved))) volume = Math.max(0, Math.min(1, Number(saved))); } catch {}
    function setVolume(value) {
      volume = Math.max(0, Math.min(1, Number(value)));
      for (const utterance of utteranceQueue) utterance.volume = volume;
      if(recording)recording.volume=volume;
      if (effects?.master) effects.master.gain.value = DISTRACTION_GAIN * volume;
      try { env.localStorage?.setItem('ipt-exam-volume', String(volume)); } catch {}
    }
    let audioContext = null, effects = null, voiceCleanup = null;
    function clearTimers() {
      if (timeout !== null) env.clearTimeout(timeout);
      if (startTimeout !== null) env.clearTimeout(startTimeout);
      timeout = startTimeout = null;
      voiceCleanup?.();
      voiceCleanup = null;
    }
    function stopEffects() {
      if (!effects) return;
      const previous = effects; effects = null;
      previous.timers.forEach(id => env.clearTimeout(id));
      previous.nodes.forEach(node => {
        try { node.stop?.(); } catch (_) {}
        try { node.disconnect?.(); } catch (_) {}
      });
    }
    // Call during the click that opens/resumes a question, before its countdown.
    // Unlocking only inside the later speech callback loses browser activation.
    function unlock() {
      try {
        const Context = env.AudioContext || env.webkitAudioContext;
        if (!Context) return Promise.resolve(false);
        if (!audioContext || audioContext.state === 'closed') audioContext = new Context();
        if (audioContext.state === 'running') return Promise.resolve(true);
        return Promise.resolve(audioContext.resume?.()).then(() => audioContext.state === 'running', () => false);
      } catch (_) { return Promise.resolve(false); }
    }
    function cancel() {
      serial++;
      clearTimers();
      stopEffects();
      if(recording){const previous=recording;recording=null;previous.onplaying=previous.onended=previous.onerror=null;previous.pause();}
      if (active !== null) {
        const previous = active; active = null;
        env.speechSynthesis?.cancel();
        onState(previous, 'error', 'Playback was interrupted. Replay this question before submitting.');
      }
    }
    function startEffects(options, ticket, ready, unavailable) {
      const mixed = options.variant === 'mixed';
      if (!mixed && !['ambient', 'sound-cue'].includes(options.variant)) return;
      const background = mixed ? options.background : options.variant === 'ambient' ? 'wind' : null;
      const cues = mixed ? AUDIO_CUES : options.variant === 'sound-cue' ? ['woodpecker-chirp'] : [];
      const begin = enabled => {
        if (ticket !== serial || active === null) return;
        if (!enabled || audioContext?.state !== 'running') return unavailable();
        stopEffects();
        const layer = { nodes: [], timers: [], background }; effects = layer;
        const live = () => ticket === serial && effects === layer && active !== null;
        const track = node => { layer.nodes.push(node); return node; };
        const later = (fn, ms) => {
          const id = env.setTimeout(() => {
            layer.timers = layer.timers.filter(timer => timer !== id);
            if (live()) { try { fn(); } catch (_) { stopEffects(); unavailable(); } }
          }, ms);
          layer.timers.push(id);
        };
        const repeat = (fn, first, interval) => {
          const next = () => { fn(); later(next, interval); };
          later(next, first);
        };
        try {
          const master = track(audioContext.createGain()); layer.master = master;
          master.gain.value = DISTRACTION_GAIN * volume;
          master.connect(audioContext.destination);
          if (background) {
            // Distinct environmental textures: steady rain, passing engines,
            // slow wind gusts, and irregular office keystrokes.
            const seconds = 6, rate = audioContext.sampleRate;
            const buffer = audioContext.createBuffer(1, rate * seconds, rate);
            const samples = buffer.getChannelData(0), random = seeded('hiw:' + background);
            let brown = 0, keyAt = 0.18, clickAge = 1;
            for (let i = 0; i < samples.length; i++) {
              const t = i / rate, white = random() * 2 - 1;
              brown = (brown + 0.025 * white) / 1.025;
              const air = brown * 3.5;
              if (background === 'rain') samples[i] = white * 0.48 + air * 0.25;
              else if (background === 'traffic') {
                const pass = Math.pow(Math.sin(Math.PI * t / seconds), 2);
                const engine = Math.sin(2 * Math.PI * (72 * t + 8 * Math.sin(2 * Math.PI * t / seconds)));
                samples[i] = (air * 0.85 + engine * 0.14) * (0.15 + pass * 0.85);
              } else if (background === 'office') {
                if (t >= keyAt) { clickAge = 0; keyAt = t + 0.055 + random() * 0.4; }
                samples[i] = white * 0.025 + Math.exp(-clickAge * 150) * (white * 0.48 + Math.sin(2 * Math.PI * 1800 * clickAge) * 0.24);
                clickAge += 1 / rate;
              } else samples[i] = air * (0.3 + 0.7 * Math.pow(Math.sin(Math.PI * t / seconds), 2));
            }
            const source = track(audioContext.createBufferSource());
            const filter = track(audioContext.createBiquadFilter()), gain = track(audioContext.createGain());
            source.buffer = buffer; source.loop = true;
            filter.type = 'lowpass'; filter.frequency.value = { rain: 5500, traffic: 1200, wind: 700, office: 6500 }[background] || 1200;
            gain.gain.setValueAtTime(0, audioContext.currentTime);
            gain.gain.linearRampToValueAtTime(background === 'office' ? 0.42 : 0.23, audioContext.currentTime + 0.15);
            source.connect(filter); filter.connect(gain); gain.connect(master); source.start();
          }
          const tone = (frequency, at, duration, volume, chirp) => {
            const oscillator = track(audioContext.createOscillator()), gain = track(audioContext.createGain());
            oscillator.type = chirp ? 'triangle' : 'sine';
            oscillator.frequency.setValueAtTime(frequency, at);
            if (chirp) {
              oscillator.frequency.exponentialRampToValueAtTime(2700, at + 0.025);
              oscillator.frequency.exponentialRampToValueAtTime(1900, at + 0.065);
            }
            gain.gain.setValueAtTime(0.0001, at);
            gain.gain.exponentialRampToValueAtTime(volume, at + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
            oscillator.connect(gain); gain.connect(master);
            oscillator.onended = () => {
              oscillator.disconnect(); gain.disconnect();
              layer.nodes = layer.nodes.filter(node => node !== oscillator && node !== gain);
            };
            oscillator.start(at); oscillator.stop(at + duration + 0.01);
          };
          if (cues.includes('woodpecker-chirp')) repeat(() => {
            const now = audioContext.currentTime;
            for (let i = 0; i < 3; i++) tone(1700, now + i * 0.09, 0.07, 0.13, true);
          }, 700, 18000);
          if (cues.includes('phone-ring')) repeat(() => {
            const now = audioContext.currentTime;
            for (const offset of [0, 0.32]) {
              tone(660, now + offset, 0.2, 0.075, false);
              tone(880, now + offset, 0.2, 0.055, false);
            }
          }, 4500, 21000);
        } catch (_) { stopEffects(); unavailable(); }
      };
      if (audioContext?.state === 'running') begin(true);
      else ready.then(begin);
    }
    function play(key, text, options = {}) {
      cancel();
      options = { ...options };
      const effectsReady = unlock();
      if(options.fixedAudio){
        const ticket=serial;active=key;let started=false;
        const current=()=>ticket===serial&&active===key;
        const finish=(status,message)=>{
          if(!current())return;active=null;serial++;clearTimers();stopEffects();
          if(recording){const previous=recording;recording=null;previous.onplaying=previous.onended=previous.onerror=null;previous.pause();}
          onState(key,status,message);
        };
        onState(key,'loading','Loading recording…');
        if(!options.audioUrl||!env.Audio){finish('error','The recording is unavailable. Select Play audio to retry.');return;}
        try{
          const audio=new env.Audio(options.audioUrl);recording=audio;audio.volume=volume;
          audio.onplaying=()=>{if(!current())return;started=true;if(startTimeout!==null)env.clearTimeout(startTimeout);startTimeout=null;onState(key,'playing','Playing. Follow the question on screen.');};
          audio.onended=()=>{if(current())finish(started?'complete':'error',started?'Audio complete. Your answer is ready to submit.':'Audio did not start. Select Play audio to retry.');};
          audio.onerror=()=>finish('error','The recording could not finish. Select Play audio to retry.');
          startTimeout=env.setTimeout(()=>finish('error','Audio did not start. Select Play audio to retry.'),8000);
          timeout=env.setTimeout(()=>finish('error','Audio timed out. Replay the question before submitting.'),150000);
          const playing=audio.play();if(playing?.catch)playing.catch(()=>finish('error','Your browser could not start audio. Select Play audio to retry.'));
        }catch(_){finish('error','The recording could not start. Select Play audio to retry.');}
        return;
      }
      if (!env.speechSynthesis || !env.SpeechSynthesisUtterance) {
        onState(key, 'error', 'Audio is unavailable in this browser. Open the practice in a browser with an English speech voice. Your saved selections can still be scored.');
        return;
      }
      const ticket = serial, variant = options.variant || 'single', twoSpeakers = variant === 'two-speakers' || variant === 'mixed';
      let started = false, effectsUnavailable = false, cursor = 0, utterances = [];
      active = key;
      const current = () => ticket === serial && active === key;
      const finish = (status, message) => {
        if (!current()) return;
        active = null; serial++;
        clearTimers(); stopEffects();
        if (status === 'error') env.speechSynthesis.cancel();
        onState(key, status, message);
      };
      const armStartTimeout = () => {
        if (startTimeout !== null) env.clearTimeout(startTimeout);
        startTimeout = env.setTimeout(() => finish('error', 'Audio did not start. Select Play audio to enable playback in this browser.'), 8000);
      };
      const playingMessage = () => options.hideLabels ? 'Playing. Follow the question on screen.' : effectsUnavailable ? 'Playing speech. Practice background sound is unavailable in this browser.' :
        variant === 'mixed' ? 'Playing: ' + options.label + '.' :
        variant === 'two-speakers' ? 'Playing. Follow both speakers.' :
        variant === 'sound-cue' ? 'Playing with brief woodpecker-style chirp cues.' :
        variant === 'ambient' ? 'Playing with light ambient practice sound.' : 'Playing. Follow the question on screen.';
      const refreshEffects = (ready = effectsReady) => {
        effectsUnavailable = false;
        startEffects(options, ticket, ready, () => {
          effectsUnavailable = true;
          if (current()) onState(key, 'playing', playingMessage());
        });
        if (current()) onState(key, 'playing', playingMessage());
      };
      const playNext = () => {
        if (!current()) return;
        const utterance = utterances[cursor++];
        let partStarted = false;
        if (cursor > 1) armStartTimeout();
        utterance.onstart = () => {
          if (!current() || partStarted) return;
          partStarted = true;
          if (startTimeout !== null) env.clearTimeout(startTimeout);
          startTimeout = null;
          onState(key, 'playing', playingMessage());
          if (!started && current()) {
            started = true;
            refreshEffects();
          }
        };
        utterance.onend = () => {
          if (!current()) return;
          if (!partStarted) return finish('error', 'Audio did not start. Check your sound and try again.');
          if (cursor < utterances.length) return playNext();
          finish('complete', effectsUnavailable && !options.hideLabels ? 'Audio complete. Practice background sound was unavailable in this browser.' : 'Audio complete. Your answer is ready to submit.');
        };
        utterance.onerror = event => finish('error', event?.error === 'not-allowed' ? 'Your browser blocked autoplay. Select Play audio to start.' : 'Audio could not finish. Check your sound and select Play audio to retry.');
        try { env.speechSynthesis.speak(utterance); } catch (_) { finish('error', 'Audio could not start. Try another browser with an English voice.'); }
      };
      const beginSpeech = voices => {
        if (!current()) return;
        voiceCleanup?.(); voiceCleanup = null;
        const transcript = String(text || '');
        let parts = [transcript];
        if (twoSpeakers) {
          parts = transcript.match(/[\s\S]*?[.!?]+(?:["'”’)\]]+)?(?=\s|$)|[\s\S]+$/g)?.map(part => part.trim()).filter(Boolean) || [transcript];
          if (parts.length === 1) {
            const words = transcript.match(/\S+\s*/g) || [];
            if (words.length > 1) { const middle = Math.ceil(words.length / 2); parts = [words.slice(0, middle).join('').trim(), words.slice(middle).join('').trim()]; }
          }
        }
        const first = voices.find(v => /^en[-_](AU|GB)/i.test(v.lang)) || voices[0] || null;
        const identity = v => v && (v.voiceURI || v.name || v.lang);
        const others = voices.filter(v => identity(v) !== identity(first));
        const second = others.find(v => /^en[-_](US|CA)/i.test(v.lang)) || others[0] || first;
        const distinct = first && second && identity(first) !== identity(second);
        utterances = parts.map((part, i) => {
          const utterance = new env.SpeechSynthesisUtterance(part);
          utterance.volume = volume;
          utterance.voice = i % 2 ? second : first;
          utterance.lang = utterance.voice?.lang || (i % 2 ? 'en-US' : 'en-GB');
          utterance.rate = twoSpeakers ? (i % 2 ? 0.96 : 1.03) : 1;
          utterance.pitch = twoSpeakers ? (i % 2 ? (distinct ? 0.92 : 0.82) : (distinct ? 1.06 : 1.18)) : 1;
          return utterance;
        });
        utteranceQueue = utterances;
        playNext();
      };
      const readVoices = () => env.speechSynthesis.getVoices().filter(v => /^en(?:[-_]|$)/i.test(v.lang));
      onState(key, 'loading', 'Starting audio…');
      if (!current()) return;
      armStartTimeout();
      timeout = env.setTimeout(() => finish('error', 'Audio timed out. Replay the question before submitting.'), 150000);
      try {
        const voices = readVoices();
        if (voices.length || !env.speechSynthesis.addEventListener) return beginSpeech(voices);
        // Browsers often return [] until voiceschanged fires on first use.
        let voiceTimer = null;
        const voicesChanged = () => {
          if (!current()) return;
          try { const available = readVoices(); if (available.length) beginSpeech(available); }
          catch (_) { finish('error', 'The speech voice could not load. Check your browser audio settings and retry.'); }
        };
        voiceCleanup = () => {
          env.speechSynthesis.removeEventListener?.('voiceschanged', voicesChanged);
          if (voiceTimer !== null) env.clearTimeout(voiceTimer);
        };
        env.speechSynthesis.addEventListener('voiceschanged', voicesChanged);
        voiceTimer = env.setTimeout(() => { if (current()) { try { beginSpeech(readVoices()); } catch (_) { beginSpeech([]); } } }, 1500);
        voicesChanged();
      } catch (_) { finish('error', 'The speech voice could not load. Check your browser audio settings and retry.'); }
    }
    return { play, cancel, unlock, setVolume, getVolume: () => volume };
  }
  return { approvedQuestion, extraLabels, scoreExtra, isAudio, compose, createSpeaker, readingFormat, validateReading, languageFirstFib, qualityFibPool, strengthenFib, audioVariant, audioPlayback, shuffle, prepareQuestion, prepareQuestions, choiceText, AUDIO_VARIANTS, AUDIO_BACKGROUNDS, AUDIO_CUES };
});
