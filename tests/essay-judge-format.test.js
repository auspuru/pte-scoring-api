'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const format = require('../essay-judge-format');

test('every grading stage forces structured output; independent review and repairs use strict decoding', () => {
  for (const stage of ['assessment', 'subjective-review', 'subjective-resolver', 'evidence-repair']) {
    const request = format.request('Assess original essay.', 'judge-model', { stage });
    const tool = request.tools[0];
    assert.equal(tool.strict, stage === 'assessment' ? undefined : true);
    assert.deepEqual(request.tool_choice, { type: 'tool', name: tool.name });
    assert.equal(tool.input_schema.additionalProperties, false);
    if (stage !== 'evidence-repair') {
      assert.deepEqual(tool.input_schema.$defs.coverage.properties.status.enum, ['addressed', 'partial', 'missing']);
      assert.equal(tool.input_schema.properties.scores.properties.content.$ref, '#/$defs/score6');
      assert.equal(tool.input_schema.$defs.score6.type, 'integer');
      assert(tool.input_schema.required.includes('promptCoverage'));
      assert(tool.input_schema.required.includes('scoringEvidence'));
      assert(tool.input_schema.required.includes('taskRelevance'));
      assert.deepEqual(tool.input_schema.properties.taskRelevance.properties.status.enum, ['relevant', 'minimal', 'off_topic']);
      assert.equal(tool.input_schema.properties.taskRelevance.properties.evidence_span.$ref, '#/$defs/span');
      if (stage === 'subjective-resolver') assert(tool.input_schema.required.includes('candidateRelevance'));
    }
    const result = { scores: { content: 4 } };
    const normalized = format.response({ content: [{ type: 'text', text: 'Untrusted preamble' },
      { type: 'tool_use', name: tool.name, input: result }] }, { stage });
    assert.equal(normalized, result);
  }
});

test('grading rejects text-only, wrong-tool, non-object and truncated output', () => {
  for (const content of [[], [{ type: 'text', text: '{"scores":{"content":6}}' }],
    [{ type: 'tool_use', name: 'another_tool', input: {} }],
    [{ type: 'tool_use', name: 'submit_essay_assessment', input: [] }]]) {
    assert.throws(() => format.response({ content }, { stage: 'assessment' }), { code: 'ESSAY_OUTPUT_FORMAT' });
  }
  assert.throws(() => format.response({ stop_reason: 'max_tokens', content: [
    { type: 'tool_use', name: 'submit_essay_assessment', input: {} }] }, { stage: 'assessment' }), { code: 'ESSAY_TRUNCATED' });
});

test('sample generation retains its separate response contract', () => {
  const request = format.request('Generate a sample.', 'judge-model');
  assert.equal(request.tools, undefined);
  assert.equal(request.tool_choice, undefined);
  assert.deepEqual(format.response({ content: [{ type: 'text', text: '{"sampleStatus":"needs-ideas"}' }] }), { sampleStatus: 'needs-ideas' });
});

test('Each structured judgement binds coverage ids and cardinality to the current question without changing global schemas',()=>{
 const requirements=[{id:'req_1',label:'What is your opinion?'},{id:'req_2',label:'Suggest alternatives.'}];
 for(const stage of ['assessment','subjective-review','subjective-resolver']) {
  const schema=format.request('Assess the original essay.','judge-model',{stage,feedbackV3:true,requirements}).tools[0].input_schema;
  assert.deepEqual(schema.$defs.coverage.properties.requirementId.enum,['req_1','req_2']);
  assert.deepEqual(schema.$defs.coverage.properties.requirement.enum,requirements.map(r=>r.label));
  assert.equal(schema.properties.promptCoverage.minItems,2);assert.equal(schema.properties.promptCoverage.maxItems,2);
  assert.deepEqual(schema.properties.feedbackIssues.items.properties.requirementId.enum,['','req_1','req_2']);
  assert.match(schema.properties.promptCoverage.description,/each id exactly once/);
  const single=format.toolFor(stage,{feedbackV3:true,requirements:requirements.slice(0,1)}).input_schema;
  assert.equal(single.properties.promptCoverage.maxItems,1);
  assert.deepEqual(single.$defs.coverage.properties.requirementId.enum,['req_1']);
  assert.equal(format.toolFor(stage).input_schema.$defs.coverage.properties.requirementId,undefined);
 }
 for(const stage of ['evidence-repair','feedback-repair'])assert.equal(format.toolFor(stage,{feedbackV3:true,requirements}).input_schema.properties.promptCoverage,undefined);
 assert.deepEqual(format.toolFor('feedback-repair',{feedbackV3:true,requirements}).input_schema.properties.feedbackIssues.items.properties.requirementId.enum,['','req_1','req_2']);
});
