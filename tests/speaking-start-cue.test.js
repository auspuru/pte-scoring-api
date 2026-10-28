'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{create,DURATION_MS}=require('../public/speaking-start-cue');
function fixture(){let at=1000;const env={Date:{now:()=>at}},audio=require('./fixtures/speaking-audio-context')(env);return{env,audio,advance(ms){at+=ms;audio.run();}};}
test('the response cue ends before recording is released, and repeated ticks cannot play it twice',()=>{
  const h=fixture(),cue=create(h.env);let starts=0;cue.unlock();cue.play('answer',()=>starts++);cue.play('answer',()=>starts++);
  assert.equal(h.audio.tones.length,1);assert.equal(starts,0);assert.equal(h.audio.tones[0].frequency.value,1000);
  h.advance(DURATION_MS-1);assert.equal(starts,0);h.advance(1);assert.equal(starts,1);assert(h.audio.tones[0].stoppedAt*1000<=h.env.Date.now());
});
test('leaving the cue cancels its pending callback, including the prefixed Safari AudioContext path',()=>{
  const h=fixture();h.env.webkitAudioContext=h.env.AudioContext;delete h.env.AudioContext;const cue=create(h.env);let starts=0;
  cue.unlock();cue.play('answer',()=>starts++);cue.close();h.advance(1000);assert.equal(starts,0);assert.equal(h.audio.contexts[0].state,'closed');
});
test('unavailable or blocked audio never stalls microphone capture',async()=>{
  let starts=0;create({}).play('answer',()=>starts++);assert.equal(starts,1);
  const h=fixture();h.env.rejectCueResume=true;const cue=create(h.env);cue.unlock();cue.play('answer',()=>starts++);await Promise.resolve();assert.equal(starts,2);assert.equal(h.audio.tones.length,0);
});
