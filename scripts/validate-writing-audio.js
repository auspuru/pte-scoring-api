'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

function validateWritingAudio(root = path.join(__dirname, '..')) {
  const bank = JSON.parse(fs.readFileSync(path.join(root, 'content', 'writing-lab.json'), 'utf8'));
  const directory = path.join(root, 'content', 'writing-audio');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  const questions = [...bank.spoken, ...(bank.dictation || []), ...bank.mocks.flatMap(m => m.questions)].filter(q => ['sst', 'wfd'].includes(q.type));
  const hash = value => createHash('sha256').update(value).digest('hex');
  for (const q of questions) {
    const entry = manifest[q.id];
    if (!entry || entry.textSha256 !== hash(q.text)) throw Error('Missing or outdated recording: ' + q.id);
    const bytes = fs.readFileSync(path.join(directory, q.id + '.mp3'));
    if (bytes.length < 1000 || bytes.length !== entry.bytes || hash(bytes) !== entry.audioSha256) throw Error('Invalid recording: ' + q.id);
    const [min, max] = q.type === 'sst' ? [60, 90] : [3, 8];
    if (!Number.isFinite(entry.seconds) || entry.seconds < min || entry.seconds > max) throw Error('Invalid recording duration: ' + q.id);
  }
  return questions.length;
}

if (require.main === module) console.log('Validated ' + validateWritingAudio() + ' bundled narration recordings.');
module.exports = { validateWritingAudio };
