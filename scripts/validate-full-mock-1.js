'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { loadPaper, registeredPapers, digest } = require('../full-mock/paper');
const { inspectMp3 } = require('./validate-writing-audio');
function validateRecording(candidate, {run=execFileSync,read=fs.readFileSync}={}) {
  const audio=candidate.audio,file=path.resolve(__dirname,'..',audio.path),encoded=inspectMp3(read(file));
  if(!encoded.valid)throw Error('Invalid recording frames: '+candidate.id);
  if(!Number.isFinite(encoded.seconds)||Math.abs(encoded.seconds-audio.entry.seconds)>0.02)
    throw Error('Measured recording duration differs: '+candidate.id+' (frames '+encoded.seconds.toFixed(6)+', declared '+audio.entry.seconds+')');
  const probe=JSON.parse(run('ffprobe',['-v','error','-show_entries','stream=codec_name,sample_rate','-of','json',file],{encoding:'utf8',timeout:10000}));
  if(probe.streams?.length!==1||probe.streams[0].codec_name!=='mp3'||Number(probe.streams[0].sample_rate)!==encoded.sampleRate)
    throw Error('Recording codec differs: '+candidate.id);
  run('ffmpeg',['-v','error','-i',file,'-f','null','-'],{timeout:10000,stdio:'pipe'});
}
function validate({ probe = false } = {}) {
  const paper = loadPaper();
  const papers = registeredPapers(), probed = new Set();
  if (probe) for (const candidate of papers.flatMap(paper => paper.questions).filter(candidate => candidate.audio)) {
    const audio = candidate.audio;
    if (probed.has(audio.path)) continue;
    probed.add(audio.path);
    validateRecording(candidate);
  }
  return { id: paper.id, version: paper.version, sha256: digest(paper), questions: paper.questions.length,
    types: new Set(paper.questions.map(candidate => candidate.question.type)).size, assets: paper.assets.length,
    status: paper.status, studentAvailable: false, humanListeningReview: paper.editorial.humanListeningReview,
    registeredPapers: papers.map(value => ({ id: value.id, version: value.version, sha256: digest(value), questions: value.questions.length })) };
}
if (require.main === module) {
  try { if (process.argv.slice(2).some(arg => arg !== '--probe')) throw Error('Usage: validate-full-mock-1.js [--probe]'); console.log(validate({ probe: process.argv.includes('--probe') })); }
  catch (error) { console.error('Frozen Full Mock 1 failed validation: ' + error.message); process.exitCode = 1; }
}
module.exports = { validate, validateRecording };
