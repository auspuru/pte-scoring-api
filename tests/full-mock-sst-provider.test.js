'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const assessment=require('../full-mock/assessment');
const {digest}=require('../full-mock/paper');

test('New Full Mocks freeze Claude for SST while the last GPT snapshot keeps its original adapter',()=>{
  assert.deepEqual(assessment.claudeConfiguration({}).sst,{provider:'anthropic',model:'claude-haiku-4-5-20251001'});
  assert.deepEqual(assessment.configuration({}).sst,{provider:'openai',model:'gpt-6.1-sol'});
  const current={},previous={};
  const engine=assessment.createEngine({store:{},adapters:current,previousAdapters:previous,
    providerConfiguration:assessment.claudeConfiguration({}),previousProviderConfiguration:assessment.configuration({})});
  const recent=engine.snapshot;
  assert.equal(engine.validate({paperHash:recent.paperHash,assessment:{version:assessment.VERSION,snapshot:recent,snapshotHash:digest(recent)}}),current);
  const priorClaude={...recent,scoringSources:require('../content/full-mock/sst-form-previous-sources.json')};
  assert.equal(engine.validate({paperHash:priorClaude.paperHash,assessment:{version:assessment.VERSION,snapshot:priorClaude,snapshotHash:digest(priorClaude)}}),current);
  const altered={...priorClaude,scoringSources:structuredClone(priorClaude.scoringSources)};
  altered.scoringSources.files['writing-lab-scoring.js'].sha256='0'.repeat(64);
  assert.throws(()=>engine.validate({paperHash:altered.paperHash,assessment:{version:assessment.VERSION,snapshot:altered,snapshotHash:digest(altered)}}),/different assessment version/);
  const frozen={...assessment.snapshot(assessment.configuration({})),
    scoringSources:require('../content/full-mock/sst-claude-previous-sources.json')};
  assert.equal(engine.validate({paperHash:frozen.paperHash,assessment:{version:assessment.VERSION,snapshot:frozen,snapshotHash:digest(frozen)}}),previous);
});

test('New mock SST uses OpenAI while in-progress Claude SST uses the frozen adapter',()=>{
  const pins=require('../content/full-mock/summary-provider-compatible-pins.json');
  const current={},previous={};
  const engine=assessment.createEngine({store:{},adapters:current,previousAdapters:previous,
    previousProviderConfiguration:assessment.claudeConfiguration({})});
  const validate=snapshot=>engine.validate({paperHash:snapshot.paperHash,
    assessment:{version:assessment.VERSION,snapshot,snapshotHash:digest(snapshot)}});
  assert.equal(engine.snapshot.configuration.sst.provider,'openai');
  assert.equal(validate(engine.snapshot),current);

  const frozen=require('./helpers/sst-coaching-baseline').sstCoachingBaseline(assessment.snapshot(assessment.claudeConfiguration({})));
  const vocabularyPins=require('../content/full-mock/swt-vocabulary-upgrade-pins.json');
  for (const [file,entry] of Object.entries(vocabularyPins.previousFiles)) {
    frozen.scoringSources.files[file]=structuredClone(entry);
  }
  assert.equal(digest(frozen.scoringSources),vocabularyPins.previousDigest);
  assert.equal(validate(frozen),previous);
  const practicePins=require('../content/full-mock/practice-provider-compatible-pins.json');
  for (const [file,sha256] of Object.entries(practicePins.previousFiles)) frozen.scoringSources.files[file].sha256=sha256;
  assert.equal(digest(frozen.scoringSources),practicePins.previousDigest);
  assert.equal(validate(frozen),previous);
  for (const [file,sha256] of Object.entries(pins.previousFiles)) frozen.scoringSources.files[file].sha256=sha256;
  assert.equal(digest(frozen.scoringSources),pins.previousDigest);
  assert.equal(validate(frozen),previous);

  const earlier={...frozen,configuration:assessment.configuration({})};
  assert.equal(validate(earlier),current);
  frozen.scoringSources.files['server.js'].sha256='0'.repeat(64);
  assert.throws(()=>validate(frozen),/different assessment version/);
});
