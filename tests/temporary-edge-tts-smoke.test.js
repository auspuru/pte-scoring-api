'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEdgeNarration } = require('../writing-lab-audio');

test('Edge neural runtime can synthesize MP3 bytes', async () => {
  const bytes = await createEdgeNarration({
    input:'This is a short natural narration check.',
    edgeVoice:'en-AU-NatashaNeural'
  });
  assert(Buffer.isBuffer(bytes));
  assert(bytes.length > 1000);
});
