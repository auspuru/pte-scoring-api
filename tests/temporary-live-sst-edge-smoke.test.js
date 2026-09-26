'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

for (const id of ['pred26-user-sst-01','pred26-user-sst-13']) {
  test('live '+id+' serves cached MP3 audio', async () => {
    const response=await fetch('https://swt.up.railway.app/writing-audio/'+id+'.mp3',{signal:AbortSignal.timeout(30000)});
    assert.equal(response.status,200);
    assert.match(response.headers.get('content-type')||'',/audio\/mpeg/);
    const bytes=Buffer.from(await response.arrayBuffer());
    assert(bytes.length>1000);
  });
}
