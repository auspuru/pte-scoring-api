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
