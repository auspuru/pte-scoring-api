'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const executable = path.join(__dirname, '..', '.edge-tts', 'bin', 'edge-tts');
if (!fs.existsSync(executable)) throw new Error('Edge TTS executable is missing: ' + executable);
const output = execFileSync(executable, ['--version'], { encoding:'utf8', timeout:10000 }).trim();
if (!/7\.2\.8/.test(output)) throw new Error('Unexpected Edge TTS version: ' + output);
console.log('Edge neural TTS verified: ' + output);
