'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const bank=require('../content/speaking-bank');
function validate() {
  const manifest=require('../content/speaking-audio-manifest')();
  let recordings=0;
  const discussions = [
    ...require('../content/user-sgd-oct30.json'),
    ...require('../content/user-sgd-20261123.json'),
    ...require('../content/user-sgd-20261124.json'),
  ];
  const suppliedSpeaking = require('../content/user-speaking-oct24.json');
  const retellPredictions = require('../content/user-rl-20261123.json');
  const diPredictions = require('../content/di-user-predictions.json');
  const rtsPrompts = require('../content/rts-original-practice.json');
  const suppliedRts = require('../content/user-rts-20261124.json');
  const bookletRts = require('../content/user-rts-pte-nepal-20261122.json');
  const bookletRtsById = new Map(bookletRts.map(q => [q.id, q]));
  const originalReadAloud = require('../content/ra-original-20261125.json');
  const suppliedRtsById = new Map(suppliedRts.map(q => [q.id, q]));
  const picturedDurations = new Map(retellPredictions.map(({ id, source }) => {
    const seconds = source.playerDurationSeconds;
    assert(Number.isSafeInteger(seconds) && seconds > 0, id + ' source player duration');
    return [id, seconds];
  }));
  const suppliedRepeatSentences = require('../content/user-rs-20261125.json');
  const bookletReadAloud = require('../content/user-ra-pte-nepal-20261122.json');
  const bookletReadAloudById = new Map(bookletReadAloud.map(q => [q.id, q]));
  const expectedCounts = {
    rs: 5 + suppliedRepeatSentences.length,
    ra: 5 + originalReadAloud.length + bookletReadAloud.length,
    di: 5 + diPredictions.length,
    rts: 6 + rtsPrompts.length + suppliedRts.length + bookletRts.length,
    rl: 5 + suppliedSpeaking.filter(q => q.type === 'rl').length + retellPredictions.length,
    sgd: 5 + discussions.length,
  };
  assert.equal(bank.questions.length, 30 + diPredictions.length + rtsPrompts.length
    + suppliedSpeaking.length + discussions.length + retellPredictions.length + suppliedRts.length + bookletRts.length + originalReadAloud.length + suppliedRepeatSentences.length + bookletReadAloud.length);
  assert.equal(new Set(bank.questions.map(q => q.id)).size, bank.questions.length);
  for (const type of Object.keys(bank.types)) {
    assert.equal(bank.questions.filter(q => q.type === type).length, expectedCounts[type] ?? 5);
  }
  for(const q of bank.questions) {
    assert(q.sample&&q.sample.trim(),q.id+' sample');
    const suppliedScenario = suppliedRtsById.get(q.id);
    const bookletScenario = bookletRtsById.get(q.id);
    const suppliedPassage = bookletReadAloudById.get(q.id);
    if (suppliedPassage) assert.equal(q.text, suppliedPassage.text, q.id + ' supplied wording');
    if (!suppliedScenario && !suppliedPassage && !bookletScenario && ['ra','rts'].includes(q.type))assert(q.text.split(/\s+/).length<=60,q.id+' prompt length');
    if(q.type==='di'){assert(q.sample.startsWith('The given image provides the detailed information about'));assert(q.facts.length>=2);if(q.imageUrl){assert(/^\/assets\/di-predictions-20260930\/\d+\.(?:png|jpg|jpeg)$/.test(q.imageUrl));assert(fs.statSync(path.join(__dirname,'../public',q.imageUrl)).size>0);assert.equal(q.predictionSource.contentStatus,'verbatim-user-provided');}}
    if(q.type==='sgd')assert.equal(new Set(q.turns.map(t=>t[0])).size,3);
    if(q.audioPrompt===false){assert.equal(q.type,'rts');assert(q.text.endsWith('?'));}
    if (q.type === 'rts') {
      if (suppliedScenario) {
        assert.equal(q.text, suppliedScenario.text, q.id + ' supplied wording');
        assert(q.text.endsWith('?'), q.id + ' final question');
        assert.equal(q.title, 'New · ' + suppliedScenario.title, q.id + ' New label');
        assert(q.facts.length >= 2, q.id + ' response reference');
      } else if (bookletScenario) {
        assert.equal(q.text, bookletScenario.text, q.id + ' supplied wording');
        assert(q.promptAudioKey, q.id + ' versioned narration');
        assert(q.facts.length >= 2, q.id + ' response reference');
      } else {
        assert.match(q.text, /What would you say to [^?]+\?$/);
      }
      assert.equal(q.preparation, 10);
      assert.equal(q.seconds, 40);
    }
    if(['rs','rl','sgd','rts'].includes(q.type)&&q.audioPrompt!==false) {
      const key=q.promptAudioKey||q.id,entry=manifest[key],bytes=fs.readFileSync(path.join(__dirname,'../content/speaking-audio',key+'.mp3'));recordings++;
      assert(entry,q.id);assert.equal(entry.bytes,bytes.length);
      assert.equal(entry.audioSha256,crypto.createHash('sha256').update(bytes).digest('hex'));
      assert.equal(entry.textSha256,crypto.createHash('sha256').update(q.text).digest('hex'));
      if(q.type==='sgd') {
        assert.equal(new Set(entry.voices).size,3,q.id+' distinct recorded voices');
        const speakers=[...new Set(q.turns.map(t=>t[0]))];
        assert(q.narration&&q.text.startsWith('Narration: '+q.narration+'\n'),q.id+' narration');
        assert.equal(entry.narrationIncluded,true,q.id+' spoken introduction');
        assert.equal(entry.narrationSha256,crypto.createHash('sha256').update(q.narration).digest('hex'));
        assert.deepEqual(Object.keys(entry.speakerVoices),speakers);
        assert.equal(new Set(Object.values(entry.speakerVoices)).size,3,q.id+' stable speaker voices');
        assert.equal(new Set(Object.values(entry.speakerAccents)).size,3,q.id+' contrasting accents');
        assert.deepEqual(entry.turnSpeakers,q.turns.map(t=>t[0]),q.id+' recorded turn order');
      }
      const [minimum, maximum] = { rs:[3,9], rl:[45,90], sgd:[90,180], rts:[5,35] }[q.type];
      // The supplied lectures vary in length. Allow the range shown in each
      // source player so its transcript can be narrated at a natural pace.
      const picturedSeconds = picturedDurations.get(q.id);
      const low = Math.min(minimum, picturedSeconds ?? minimum);
      const high = Math.max(maximum, picturedSeconds ?? maximum);
      assert(entry.seconds >= low && entry.seconds <= high, q.id + ' duration');
    }
  }
  return {questions:bank.questions.length,recordings};
}
if(require.main===module)console.log('Speaking assets verified:',validate());
module.exports={validate};
