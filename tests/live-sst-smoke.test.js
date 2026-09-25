'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('live first user SST prediction serves real MP3 audio', async () => {
  const response = await fetch('https://swt.up.railway.app/writing-audio/pred26-user-sst-01.mp3', {
    signal: AbortSignal.timeout(60000)
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /audio\/mpeg/);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert(bytes.length > 1000, 'Expected a non-empty MP3 response');
});
