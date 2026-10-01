'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const delivery=require('../speaking-delivery');
test('Flagged word timings preserve provider offsets for playback without changing delivery scores',()=>{
  const input={NBest:[{PronunciationAssessment:{AccuracyScore:80,FluencyScore:82,ProsodyScore:78},Words:[
    {Word:'environmental',Offset:64000000,Duration:3000000,PronunciationAssessment:{AccuracyScore:55,ErrorType:'Mispronunciation'}}
  ]}]};
  const parsed=delivery.extractAssessment(input);assert.equal(parsed.words[0].startSeconds,6.4);assert.equal(parsed.words[0].durationSeconds,0.3);
  const r=delivery.aggregate([{...parsed,weight:20}]);assert.equal(r.pronunciation.words[0].startSeconds,6.4);
  input.NBest[0].Words[0].Offset=null;assert.equal(delivery.extractAssessment(input).words[0].startSeconds,undefined,'Missing offsets must not pretend to locate a word at zero seconds');
});
