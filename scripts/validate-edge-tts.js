'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const executable = path.join(__dirname, '..', '.edge-tts', 'bin', 'edge-tts');
if (!fs.existsSync(executable)) throw new Error('Edge TTS executable is missing: ' + executable);
const output = execFileSync(executable, ['--version'], { encoding:'utf8', timeout:10000 }).trim();
if (!/7\.2\.8/.test(output)) throw new Error('Unexpected Edge TTS version: ' + output);

const python = path.join(__dirname, '..', '.edge-tts', 'bin', 'python');
const source = execFileSync(python, ['-c', [
  'import inspect, edge_tts.communicate, edge_tts.constants',
  'print(inspect.getsource(edge_tts.communicate))',
  'print("MP3_BITRATE_BPS="+str(edge_tts.constants.MP3_BITRATE_BPS))'
].join(';')], { encoding:'utf8', timeout:10000 });
if (!source.includes('audio-48khz-192kbitrate-mono-mp3')) {
  throw new Error('Edge TTS is not patched for native HD output.');
}
if (source.includes('audio-24khz-48kbitrate-mono-mp3')) {
  throw new Error('Low-quality Edge TTS output format is still present.');
}
if (!source.includes('MP3_BITRATE_BPS=192000')) {
  throw new Error('Edge TTS bitrate compensation is not patched for 192 kbps.');
}
console.log('Edge neural TTS verified: ' + output + ' · native 48 kHz / 192 kbps source enabled');
