'use strict';
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadPaper, digest } = require('../full-mock/paper');
function validate({ probe = false } = {}) {
  const paper = loadPaper();
  if (probe) for (const candidate of paper.questions.filter(candidate => candidate.audio)) {
    const audio = candidate.audio;
    const file = path.resolve(__dirname, '..', audio.path);
    const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8', timeout: 10000 }));
    if (!Number.isFinite(seconds) || Math.abs(seconds - audio.entry.seconds) > 0.02) throw Error('Measured recording duration differs: ' + candidate.id);
    execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { timeout: 10000, stdio: 'pipe' });
  }
  return { id: paper.id, version: paper.version, sha256: digest(paper), questions: paper.questions.length,
    types: new Set(paper.questions.map(candidate => candidate.question.type)).size, assets: paper.assets.length,
    status: paper.status, studentAvailable: false, humanListeningReview: paper.editorial.humanListeningReview };
}
if (require.main === module) {
  try { if (process.argv.slice(2).some(arg => arg !== '--probe')) throw Error('Usage: validate-full-mock-1.js [--probe]'); console.log(validate({ probe: process.argv.includes('--probe') })); }
  catch (error) { console.error('Frozen Full Mock 1 failed validation: ' + error.message); process.exitCode = 1; }
}
module.exports = { validate };
