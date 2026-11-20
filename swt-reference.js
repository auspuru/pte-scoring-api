'use strict';
const seeds = require('./passages.json');
const advanced = require('./content/swt-advanced.json');
const advancedRevisions = require('./content/swt-advanced-revisions.json');
const legacySampleRevisions = require('./content/swt-sample-revisions.json');
const publicationReferences = require('./content/swt-publication-references.json');
const { hash } = require('./scoring-jobs');
const { POLICY_VERSION } = require('./swt-scoring-policy');
const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
const expandedGuides = {
  8: {
    overview: 'Tourism can bring jobs, spending and conservation benefits that last when local communities share the returns and manage growth.',
    connection: 'These are related benefits. Local income retention and careful growth management help them last. Potentially low costs are a separate advantage.',
    items: [
      { label: 'Main idea', phrases: ['a large percentage of GDP', 'a huge number of jobs'], idea: 'Tourism makes a major contribution to the world economy and employment.' },
      { label: 'Employment and spending', phrases: ['visitor spending to circulate through many local businesses'], idea: 'Tourism jobs and spending extend across many local businesses.' },
      { label: 'Environment and culture', phrases: ['conservation and improvement of the environment', 'maintenance of local diversity and culture'], idea: 'Tourism can support conservation and help preserve local cultures.' },
      { label: 'Lasting benefits', phrases: ['communities retain a meaningful share of the income', 'growth is managed'], idea: 'The benefits are strongest when communities keep part of the income and growth is managed to protect local services and natural areas.' }
    ]
  },
  9: {
    overview: 'Berners-Lee invented the Web to make information easier to access, and its open design widened access and participation.',
    connection: 'Difficulty finding information motivated the invention. Open standards made it easier to link information and publish independently, helping the Web spread.',
    items: [
      { label: 'Main idea', phrases: ['Sir Tim Berners-Lee', 'inventor of the World Wide Web'], idea: 'Berners-Lee is the Web’s inventor and a world-changing scientist.' },
      { label: 'Motivation', phrases: ["couldn't find all the information he wanted in one place"], idea: 'Difficulty finding information in one place motivated him to invent the Web.' },
      { label: 'How it spread', phrases: ['reached through common standards', 'permission from one central publisher'], idea: 'Using shared standards and allowing users to publish without central permission helped the Web expand.' },
      { label: 'Impact', phrases: ['who could publish, participate and build new services'], idea: 'The Web changed daily life, broadened access to information and widened participation.' }
    ]
  }
};

function matchingExpandedGuide(passage) {
  const seed = seeds.find(p => p.id === Number(passage.id));
  return seed && seed.text === passage.text && seed.title === passage.title ? expandedGuides[seed.id] : null;
}

function publicationReference(passage) {
  const revision = publicationReferences[hash(String(passage.text ?? ''))];
  return revision?.id === Number(passage.id) && revision.title === passage.title ? revision : null;
}

function applyPublicationReference(passage, reference) {
  if (!reference) return passage;
  // Check each stored field independently. JSONB can reorder keys without changing an authored value.
  const changes = {};
  for (const [field, { before, after }] of Object.entries(reference.fields)) {
    if (passage[field] !== undefined && before.includes(hash(passage[field]))) changes[field] = after;
  }
  if (changes.sampleResponse) changes.sampleRevision = POLICY_VERSION;
  else delete changes.sampleNotes;
  return { ...passage, ...changes };
}

function fallbackSample(passage) {
  if (normalize(passage?.sampleResponse)) return null;

  // Current standalone bank: require id + title + full passage text so a teacher
  // edit can never inherit a stale model answer accidentally.
  const seed = seeds.find(p => p.id === Number(passage?.id)
    && normalize(p.title) === normalize(passage?.title)
    && normalize(p.text) === normalize(passage?.text));
  if (seed && normalize(seed.sampleResponse)) {
    return { sampleResponse: normalize(seed.sampleResponse), sampleNotes: normalize(seed.sampleNotes) };
  }

  const preserved = require('./content/swt-legacy.json').find(p => Number(p.id) === Number(passage?.id)
    && normalize(p.title) === normalize(passage?.title) && normalize(p.text) === normalize(passage?.text));
  if (preserved) return { sampleResponse: preserved.sampleResponse, sampleNotes: preserved.sampleNotes };

  // Advanced rows receive dynamic database IDs, so identify them by canonical
  // title + text. Prefer the revised bank when available.
  const revisedAdvanced = advancedRevisions.find(p => normalize(p.title) === normalize(passage?.title)
    && normalize(p.text) === normalize(passage?.text));
  const advancedSeed = revisedAdvanced || advanced.find(p => normalize(p.title) === normalize(passage?.title)
    && normalize(p.text) === normalize(passage?.text));
  if (advancedSeed && normalize(advancedSeed.sampleResponse)) {
    return { sampleResponse: normalize(advancedSeed.sampleResponse), sampleNotes: normalize(advancedSeed.sampleNotes) };
  }

  // Production still contains legacy SWT rows that pre-date passages.json.
  // If this id/title belongs to the current standalone bank but the source text
  // no longer matches, stop here rather than attaching an older legacy answer
  // to a teacher-edited passage.
  const currentIdentity = seeds.find(p => p.id === Number(passage?.id)
    && normalize(p.title) === normalize(passage?.title));
  if (currentIdentity) return null;

  // Legacy revision entries are explicitly keyed by the original passage id +
  // title. Only use them for rows that are not represented by the current
  // canonical bank; an authored database sample always wins.
  const legacy = legacySampleRevisions.find(p => Number(p.id) === Number(passage?.id)
    && normalize(p.title) === normalize(passage?.title));
  if (legacy && normalize(legacy.sampleResponse)) {
    return {
      sampleResponse: normalize(legacy.sampleResponse),
      sampleNotes: 'Model answer restored from the reviewed SWT sample bank.',
      sampleRevision: POLICY_VERSION
    };
  }

  return null;
}

function phraseFromIdea(idea, source) {
  const words = value => [...String(value || '').matchAll(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)];
  const iw = words(idea), sw = words(source);
  for (let n = Math.min(10, iw.length); n >= 3; n--) {
    for (let i = 0; i <= iw.length - n; i++) {
      const target = iw.slice(i, i + n).map(w => w[0].toLowerCase()).join(' ');
      for (let j = 0; j <= sw.length - n; j++) {
        if (sw.slice(j, j + n).map(w => w[0].toLowerCase()).join(' ') !== target) continue;
        return source.slice(sw[j].index, sw[j + n - 1].index + sw[j + n - 1][0].length);
      }
    }
  }
  return '';
}

function buildStudyGuide(passage) {
  const guide = matchingExpandedGuide(passage);
  const source = normalize(passage.text);
  const reviewedKey = guide && publicationReference(passage)?.fields.keyElements;
  const keyHash = reviewedKey && passage.keyElements && hash(passage.keyElements);
  if (keyHash && (reviewedKey.before.includes(keyHash) || keyHash === hash(reviewedKey.after))) {
    return { ...guide, items: guide.items.map(item => ({ ...item,
      phrases: item.phrases.filter(phrase => source.includes(phrase) && phrase.split(/\s+/).length <= 12)
    })) };
  }
  const labels = { what: 'Central idea', topic: 'Topic and context', pivot: 'Main development',
    why: 'Supporting idea', how: 'Supporting idea', result: 'Outcome or significance', conclusion: 'Outcome or significance' };
  const entries = Object.keys(labels).filter(key => typeof passage.keyElements?.[key] === 'string' && passage.keyElements[key].trim())
    .map(key => [key, passage.keyElements[key]]);
  return {
    overview: '',
    connection: 'Choose the main message and one or two useful supporting ideas; keep any cause, contrast or final implication needed to connect them. You do not need every detail.',
    items: entries.slice(0, 5).map(([key, value]) => {
      const idea = value.replace(/<[^>]*>/g, '').trim();
      const phrase = phraseFromIdea(idea, source);
      return { label: labels[key],
        phrases: phrase ? [phrase] : [], idea };
    })
  };
}

function studentPassage(passage) {
  const fallback = fallbackSample(passage);
  const projected = applyPublicationReference({ ...passage, ...fallback }, publicationReference(passage));
  return { ...projected, studyGuide: buildStudyGuide(projected) };
}
module.exports = { studentPassage, buildStudyGuide, phraseFromIdea, fallbackSample };
