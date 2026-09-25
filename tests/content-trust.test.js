'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fib = require('../scripts/validate-reading-fib-content');
const audio = require('../scripts/validate-writing-audio');
const metadata = require('../scripts/validate-content-metadata');

test('every active Reading FIB surface passes one shared grammar-vocabulary quality gate', () => {
  const result = fib.validateReadingFibContent();
  assert(result.unique >= 50);
  assert(result.dropdown >= 20);
  assert(result.wordbank >= 20);
  assert(result.patternDerived >= 20);
  assert.match(result.qualityVersion, /^grammar-vocab-/);
});

test('bundled Writing audio is bound to transcripts, duration metadata and decodable MP3 frames', () => {
  assert.equal(audio.validateWritingAudio(), 126);
  const file=fs.readFileSync(path.join(__dirname,'..','content','writing-audio','sst-urban-trees.mp3'));
  const ok=audio.inspectMp3(file);
  assert.equal(ok.valid,true,ok.reason);
  assert(ok.frames > 100);
  const truncated=audio.inspectMp3(file.subarray(0,Math.floor(file.length*0.55)));
  assert.equal(truncated.valid,false);
});

test('prediction/original content exposes freshness and unique-bank metadata', () => {
  const stats=metadata.validateContentMetadata();
  assert.deepEqual(stats.readingPrediction,{dropdown:30,wordbank:30});
  assert.equal(stats.writingPrediction.swt,18);
  assert.equal(stats.writingPrediction.sst,17);
  assert.equal(stats.writingPrediction.wfd,36);
  assert.equal(stats.patternOriginal.dropdown,12);
  assert.equal(stats.patternOriginal.wordbank,12);
});

test('student UIs label reused predictions as Revision instead of presenting them as new', () => {
  const reading=fs.readFileSync(require.resolve('../public/reading-practice'),'utf8');
  const writing=fs.readFileSync(require.resolve('../public/writing-lab-client'),'utf8');
  const catalogue=fs.readFileSync(require.resolve('../public/practice-catalogue'),'utf8');
  assert.match(reading,/Unseen prediction/);
  assert.match(reading,/Revision/);
  assert.match(reading,/Reviewed /);
  assert.doesNotMatch(writing,/Unseen prediction/);
  assert.doesNotMatch(writing,/Adapted practice/);
  assert.doesNotMatch(writing,/content-provenance/);
  assert.doesNotMatch(catalogue,/Current Writing prediction pool/);
  assert.doesNotMatch(catalogue,/Repeated prediction items are marked Revision/);
});

test('Writing audio load failures keep a visible retry path', () => {
  const client=fs.readFileSync(require.resolve('../public/writing-lab-client'),'utf8');
  assert.match(client,/Audio could not load\. Check your connection and retry\./);
  assert.match(client,/startButton\.textContent='Retry audio'/);
  assert.match(client,/startButton\.disabled=false/);
});
