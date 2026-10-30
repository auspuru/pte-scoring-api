'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const bank=require('../content/speaking-bank');
function validate() {
  const manifest=require('../content/speaking-audio-manifest')();
  let recordings=0;
  const discussions=require('../content/user-sgd-oct30.json');
  assert.equal(bank.questions.length,30+require('../content/di-user-predictions.json').length+require('../content/rts-original-practice.json').length+require('../content/user-speaking-oct24.json').length+discussions.length);assert.equal(new Set(bank.questions.map(q=>q.id)).size,bank.questions.length);
  for(const type of Object.keys(bank.types))assert.equal(bank.questions.filter(q=>q.type===type).length,type==='di'?5+require('../content/di-user-predictions.json').length:type==='rts'?6+require('../content/rts-original-practice.json').length:type==='rl'?9:type==='sgd'?5+discussions.length:5);
  for(const q of bank.questions) {
    assert(q.sample&&q.sample.trim(),q.id+' sample');
    if(['ra','rts'].includes(q.type))assert(q.text.split(/\s+/).length<=60,q.id+' prompt length');
    if(q.type==='di'){assert(q.sample.startsWith('The given image provides the detailed information about'));assert(q.facts.length>=2);if(q.imageUrl){assert(/^\/assets\/di-predictions-20260930\/\d+\.png$/.test(q.imageUrl));assert(fs.statSync(path.join(__dirname,'../public',q.imageUrl)).size>0);assert.equal(q.predictionSource.contentStatus,'verbatim-user-provided');}}
    if(q.type==='sgd')assert.equal(new Set(q.turns.map(t=>t[0])).size,3);
    if(q.audioPrompt===false){assert.equal(q.type,'rts');assert(q.text.endsWith('?'));}
    if(q.type==='rts'){assert.match(q.text,/What would you say to [^?]+\?$/);assert.equal(q.preparation,10);assert.equal(q.seconds,40);}
    if(['rs','rl','sgd','rts'].includes(q.type)&&q.audioPrompt!==false) {
      const key=q.promptAudioKey||q.id,entry=manifest[key],bytes=fs.readFileSync(path.join(__dirname,'../content/speaking-audio',key+'.mp3'));recordings++;
      assert(entry,q.id);assert.equal(entry.bytes,bytes.length);
      assert.equal(entry.audioSha256,crypto.createHash('sha256').update(bytes).digest('hex'));
      assert.equal(entry.textSha256,crypto.createHash('sha256').update(q.text).digest('hex'));
      if(q.type==='sgd') {
        assert.equal(new Set(entry.voices).size,3,q.id+' distinct recorded voices');
        if(q.source?.date==='2026-10-30') {
          assert(q.text.startsWith('Narration: '+q.narration+'\n'),q.id+' narration');
          assert.deepEqual(Object.keys(entry.speakerVoices),['Speaker 1','Speaker 2','Speaker 3']);
          assert.equal(new Set(Object.values(entry.speakerVoices)).size,3,q.id+' stable speaker voices');
          assert.deepEqual(entry.turnSpeakers,q.turns.map(t=>t[0]),q.id+' recorded turn order');
        }
      }
      const bounds={rs:[3,9],rl:[45,90],sgd:[90,180],rts:[5,35]}[q.type];
      assert(entry.seconds>=bounds[0]&&entry.seconds<=bounds[1],q.id+' duration');
    }
  }
  return {questions:bank.questions.length,recordings};
}
if(require.main===module)console.log('Speaking assets verified:',validate());
module.exports={validate};
