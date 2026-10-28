'use strict';

// Read-only candidates from existing papers. No paper is assembled or published
// here. Namespaces preserve legacy IDs without assuming they are globally unique.
function inventory() {
  const speaking = require('../content/speaking-mocks');
  const reading = require('../public/reading-bank.json');
  const writing = require('../content/writing-lab.json');
  const listening = require('../content/listening-mocks');
  const speakingAudio = require('../content/speaking-audio-manifest')();
  const writingAudio = require('../content/writing-audio/manifest.json');
  const references = require('../content/di-reference-manifest.json');
  const display = require('../content/di-display-manifest.json');
  const candidates = new Map();
  function add(id, question, origin, audio) {
    const next = { id, question: structuredClone(question), origins: [origin] };
    if (audio) next.audio = audio;
    if (question.type === 'di' && question.imageUrl) {
      next.image = { path: 'public' + question.imageUrl, sha256: references.entries[question.id]?.source?.sha256 };
      const derived = display.entries[question.id];
      if (derived) next.displayImage = { path: 'public' + derived.displayImageUrl, sha256: derived.displaySha256 };
    }
    const previous = candidates.get(id);
    if (previous) {
      if (JSON.stringify(previous.question) !== JSON.stringify(next.question)) throw Error('Conflicting full-mock candidate: ' + id);
      previous.origins.push(origin);
    } else candidates.set(id, next);
  }
  for (const paper of speaking.papers) for (const q of paper.questions) {
    if (q.type === 'intro') continue;
    const source = q.audioSource;
    const audio = source && { path: `content/${source.folder}-audio/${source.id}.mp3`,
      entry: (source.folder === 'speaking' ? speakingAudio : writingAudio)[source.id] };
    add('speaking/' + q.id, q, paper.id, audio);
  }
  for (const set of reading.sets) for (const q of set.questions) add('reading/' + set.id + '/' + q.id, q, set.id);
  for (const paper of writing.mocks) for (const q of paper.questions) {
    if (['swt', 'essay'].includes(q.type)) add('writing/' + q.id, q, paper.id);
  }
  for (const paper of listening.mocks) for (const q of paper.questions) {
    const id = q.audioId || q.id;
    add('listening/' + q.id, q, paper.id, { path: 'content/writing-audio/' + id + '.mp3', entry: writingAudio[id] });
  }
  return [...candidates.values()];
}
module.exports = { inventory };
