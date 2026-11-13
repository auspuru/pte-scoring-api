'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {loadPaper}=require('../full-mock/paper');
const {validateRecording}=require('../scripts/validate-full-mock-1');
const {inspectMp3}=require('../scripts/validate-writing-audio');
const candidate=loadPaper('full-mock-1').questions.find(q=>q.question.id==='fm1-rs-01');
test('Frozen audio duration uses encoded samples while retaining codec and full-decode checks',()=>{
 const calls=[];validateRecording(candidate,{run:(command,args)=>{calls.push({command,args});return command==='ffprobe'?JSON.stringify({streams:[{codec_name:'mp3',sample_rate:'48000'}],format:{duration:'5.160'}}):Buffer.alloc(0);}});
 assert.deepEqual(calls.map(c=>c.command),['ffprobe','ffmpeg']);assert(calls[1].args.includes('null'));
});
test('A wrong declared duration, truncated frames or wrong codec still fails validation',()=>{
 const wrong=structuredClone(candidate);wrong.audio.entry.seconds+=1;
 assert.throws(()=>validateRecording(wrong),/Measured recording duration differs/);
 assert.throws(()=>validateRecording(candidate,{read:()=>Buffer.from('not an mp3')}),/Invalid recording frames/);
 assert.throws(()=>validateRecording(candidate,{read:file=>{const bytes=fs.readFileSync(file);return bytes.subarray(0,bytes.length-288);}}),/Invalid recording frames|Measured recording duration differs/);
 assert.throws(()=>validateRecording(candidate,{run:()=>JSON.stringify({streams:[{codec_name:'aac',sample_rate:'48000'}]})}),/Recording codec differs/);
});
test('Xing seek metadata does not add a frame of audio to retained low-sample-rate clips',()=>{
 const q=loadPaper('full-mock-1',1).questions.find(q=>q.question.id==='fm1-rs-01');
 const result=inspectMp3(fs.readFileSync(q.audio.path));assert.equal(result.sampleRate,24000);assert.equal(result.metadataFrames,1);
 assert(Math.abs(result.seconds-q.audio.entry.seconds)<0.001);
});
