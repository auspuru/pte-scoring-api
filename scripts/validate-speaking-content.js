'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const bank=require('../content/speaking-bank');
function validate() {
  const manifest=require('../content/speaking-audio/manifest.json');
  assert.equal(bank.questions.length,30+require('../content/di-user-predictions.json').length);assert.equal(new Set(bank.questions.map(q=>q.id)).size,bank.questions.length);
  for(const type of Object.keys(bank.types))assert.equal(bank.questions.filter(q=>q.type===type).length,type==='di'?5+require('../content/di-user-predictions.json').length:5);
  for(const q of bank.questions) {
    assert(q.sample&&q.sample.trim(),q.id+' sample');
    if(['ra','rts'].includes(q.type))assert(q.text.split(/\s+/).length<=60,q.id+' prompt length');
    if(q.type==='di'){assert(q.sample.startsWith('The given image provides the detailed information about'));assert(q.facts.length>=2);if(q.imageUrl){assert(/^\/assets\/di-predictions-20260930\/\d+\.png$/.test(q.imageUrl));assert(fs.statSync(path.join(__dirname,'../public',q.imageUrl)).size>0);assert.equal(q.predictionSource.contentStatus,'verbatim-user-provided');}}
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
  return {questions:bank.questions.length,recordings:Object.keys(manifest).length};
}
if(require.main===module)console.log('Speaking assets verified:',validate());
module.exports={validate};
