'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

async function main() {
  const [inputFile, outputFile] = process.argv.slice(2);
  if (!inputFile || !outputFile) throw Error('Usage: node generate-edge-hd.js <input.json> <output.mp3>');

  const input = JSON.parse(await fs.readFile(inputFile, 'utf8'));
  const modulePath = path.join(__dirname, '..', '.edge-tts-hd', 'node_modules', '@andresaya', 'edge-tts');
  const { EdgeTTS } = require(modulePath);
  if (typeof EdgeTTS !== 'function') throw Error('Native HD EdgeTTS export is unavailable.');

  const tts = new EdgeTTS();
  await tts.synthesize(String(input.text || ''), input.voice || 'en-AU-NatashaNeural', {
    rate: Number.isFinite(Number(input.rate)) ? Number(input.rate) : -5,
    pitch: 0,
    volume: 0,
    outputFormat: 'audio-48khz-192kbitrate-mono-mp3'
  });

  let audio;
  if (typeof tts.toBuffer === 'function') audio = tts.toBuffer();
  else if (typeof tts.getAudioData === 'function') audio = tts.getAudioData();
  else throw Error('Native HD EdgeTTS audio export method is unavailable.');

  const bytes = Buffer.from(audio);
  if (bytes.length < 1000) throw Error('Native HD Edge TTS returned no usable audio.');
  await fs.writeFile(outputFile, bytes);
}

main().catch(error => {
  console.error(String(error?.stack || error?.message || error));
  process.exit(1);
});
