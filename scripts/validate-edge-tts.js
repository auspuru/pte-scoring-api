'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '.edge-tts-hd', 'node_modules', '@andresaya', 'edge-tts');
const packageFile = path.join(root, 'package.json');
if (!fs.existsSync(packageFile)) throw new Error('Native HD Edge TTS package is missing.');

const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
if (pkg.version !== '1.8.1') throw new Error('Unexpected native HD Edge TTS version: ' + pkg.version);

const moduleFile = path.join(root, pkg.main || 'dist/index.js');
const mod = require(moduleFile);
if (typeof mod.EdgeTTS !== 'function') throw new Error('EdgeTTS export is unavailable.');

const generator = fs.readFileSync(path.join(__dirname, 'generate-edge-hd.js'), 'utf8');
if (!generator.includes('audio-48khz-192kbitrate-mono-mp3')) {
  throw new Error('Native HD Edge generator is not configured for 48 kHz / 192 kbps.');
}

console.log('Edge neural TTS verified: @andresaya/edge-tts ' + pkg.version + ' · native 48 kHz / 192 kbps source requested');
