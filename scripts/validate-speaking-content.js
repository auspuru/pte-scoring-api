'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const bank=require('../content/speaking-bank');
function validate() {
  const manifest=require('../content/speaking-audio/manifest.json');
  assert.equal(bank.questions.length,30);assert.equal(new Set(bank.questions.map(q=>q.id)).size,30);
  for(const type of Object.keys(bank.types))assert.equal(bank.questions.filter(q=>q.type===type).length,5);
  for(const q of bank.questions) {
    assert(q.sample&&q.sample.trim(),q.id+' sample');
    if(['ra','rts'].includes(q.type))assert(q.text.split(/\s+/).length<=60,q.id+' prompt length');
    if(q.type==='di')assert(q.sample.startsWith('The given image provides the detailed information about'));
    if(q.type==='sgd')assert.equal(new Set(q.turns.map(t=>t[0])).size,3);
    if(['rs','rl','sgd','rts'].includes(q.type)) {
      const entry=manifest[q.id],bytes=fs.readFileSync(path.join(__dirname,'../content/speaking-audio',q.id+'.mp3'));
      assert(entry,q.id);assert.equal(entry.bytes,bytes.length);
      assert.equal(entry.audioSha256,crypto.createHash('sha256').update(bytes).digest('hex'));
      assert.equal(entry.textSha256,crypto.createHash('sha256').update(q.text).digest('hex'));
      const bounds={rs:[3,9],rl:[45,90],sgd:[90,180],rts:[5,35]}[q.type];
      assert(entry.seconds>=bounds[0]&&entry.seconds<=bounds[1],q.id+' duration');
    }
  }
  return {questions:30,recordings:Object.keys(manifest).length};
}
if(require.main===module)console.log('Speaking assets verified:',validate());
module.exports={validate};
