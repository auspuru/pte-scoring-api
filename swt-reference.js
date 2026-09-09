'use strict';
const seeds = require('./passages.json');
const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
const references = {
  8: {
    previous: 'Travel and tourism generates a significant percentage of GDP and a substantial number of jobs in the worldwide economy; moreover, the sector employs many women, minority groups and young people while offering good training and transferability; furthermore, tourism acts as a catalyst for conservation and the maintenance of local diversity and culture; therefore, it has a comparative advantage with low start-up and running costs.',
    sample: 'Travel and tourism contributes substantially to global GDP and employment, with further growth expected, while providing jobs and training for women, minorities and young people and supporting environmental conservation and local cultures; additionally, its potentially low start-up and running costs give it a comparative advantage over other industries.',
    guide: {
      overview: 'Tourism brings economic, employment, environmental and cultural benefits, with low costs as a further advantage.',
      connection: 'These are related benefits, not a chain in which one benefit causes all the others; low costs explain the comparative advantage.',
      items: [
        { label: 'Main idea', phrases: ['a large percentage of GDP', 'a huge number of jobs'], idea: 'Tourism makes a major contribution to the world economy and employment.' },
        { label: 'Employment', phrases: ['women, minority groups and young people', 'good training and transferability'], idea: 'Its jobs reach diverse groups and provide useful, transferable training.' },
        { label: 'Environment and culture', phrases: ['conservation and improvement of the environment', 'maintenance of local diversity and culture'], idea: 'Tourism can support conservation and help preserve local cultures.' },
        { label: 'Further advantage', phrases: ['start-up and running costs can be low'], idea: 'Potentially low costs give tourism an advantage over other industries.' }
      ]
    }
  },
  9: {
    previous: 'Sir Tim Berners-Lee, the inventor of the World Wide Web, has changed the world more than anyone in the past century; however, this mild-mannered Oxford computer scientist built his own computer from spare parts; moreover, he invented the Web because he was frustrated by being unable to find information in one place; therefore, it has transformed shopping, music, and communication, giving individuals the same access as the elite.',
    sample: 'Sir Tim Berners-Lee invented the World Wide Web because he was frustrated by scattered information, and its global spread has transformed shopping, music and communication while giving individuals access to information previously associated with the elite, fundamentally changing how people think and live.',
    guide: {
      overview: 'Berners-Lee invented the Web to make information easier to access, and its global use changed society.',
      connection: 'Difficulty finding information motivated the invention; the Web’s global spread then transformed daily life and access to information.',
      items: [
        { label: 'Main idea', phrases: ['Sir Tim Berners-Lee', 'inventor of the World Wide Web'], idea: 'Berners-Lee is the Web’s inventor and a world-changing scientist.' },
        { label: 'Motivation', phrases: ["couldn't find all the information he wanted in one place"], idea: 'Difficulty finding information in one place motivated him to invent the Web.' },
        { label: 'Impact', phrases: ['Since the Web went global', 'shop, listen to music and communicate'], idea: 'The Web’s global spread changed everyday activities and communication.' },
        { label: 'Wider significance', phrases: ['the same access to information as the elite', 'Society will never be the same'], idea: 'Broader access to information changed society; this meaning can be combined with the Web’s impact.' }
      ]
    }
  }
};

function matchedReference(passage) {
  const seed = seeds.find(p => p.id === Number(passage.id));
  return seed && normalize(seed.text) === normalize(passage.text) ? references[seed.id] : null;
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
  const reference = matchedReference(passage);
  const source = normalize(passage.text);
  if (reference) {
    return { ...reference.guide, items: reference.guide.items.map(item => ({ ...item,
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
  const reference = matchedReference(passage);
  const useRevision = reference && normalize(passage.sampleResponse) === normalize(reference.previous);
  return { ...passage,
    ...(useRevision ? { sampleResponse: reference.sample,
      sampleNotes: 'The sample keeps the main message and important relationships without requiring every detail.',
      sampleRevision: '20.3.5' } : {}),
    studyGuide: buildStudyGuide(passage)
  };
}
module.exports = { studentPassage, buildStudyGuide, phraseFromIdea };
