'use strict';

const fs = require('node:fs/promises');
const continuous = require('../azure-continuous-delivery');

async function main() {
  const [file, mime] = process.argv.slice(2);
  if (!file || !['audio/webm', 'audio/wav', 'audio/mp4', 'audio/ogg', 'audio/mpeg'].includes(mime)) {
    throw Error('Usage: node scripts/compare-azure-continuous.js <original recording> <audio MIME>');
  }
  if (!process.env.AZURE_SPEECH_KEY || !process.env.AZURE_SPEECH_REGION) {
    throw Error('Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION through the approved secret environment.');
  }
  const result = await continuous.assessRecording({ mime, data: (await fs.readFile(file)).toString('base64') });
  console.log(JSON.stringify(result));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
