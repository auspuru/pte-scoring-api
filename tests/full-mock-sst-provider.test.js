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
