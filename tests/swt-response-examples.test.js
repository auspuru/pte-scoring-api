'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createResponseExamplesProvider, createResponseExamplesHandler, createResponseExamplesService } = require('../swt-response-examples');
const reading = require('../content/user-swt-predictions-part1').find(row => row.id === 910088);

const text = 'Reading your work aloud can reveal an awkward tone. Direct words make complicated points clear.';
const examples = {
  anchor: 'Direct words make complicated points clear',
  corrected: 'Reading your work aloud can reveal an awkward tone, and direct words can make complicated points clear.',
  sample: 'Writers can read a draft aloud to hear awkward phrasing and then choose direct words to make complex ideas clear.',
  change: 'Join your two ideas by explaining how reading a draft aloud helps you choose clearer words.'
};

function submit(handler, answer = text, passage = reading.text) {
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  return Promise.resolve(handler({params: {id: String(reading.id)}, body: {text: answer, passage}}, response))
    .then(() => response);
}

test('SWT feedback accepts a multi-sentence draft and returns both reviewed rewrites from that draft', async () => {
  const calls = [];
  const service = createResponseExamplesService({
    generate: async input => { calls.push(input); return examples; },
    review: async input => { calls.push(input); return true; }
  });
  const handler = createResponseExamplesHandler({getPassage: async () => reading, service});
  const response = await submit(handler);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, examples);
  assert.equal(calls.length, 2);
  for (const input of calls) {
    assert.equal(input.passage, reading.text);
    assert.equal(input.text, text);
  }
  assert.deepEqual(calls[1].examples, examples);
  assert.notEqual(response.body.sample, reading.sampleResponse);

  const stale = await submit(handler, text, 'A different version of the reading passage.');
  assert.equal(stale.statusCode, 409);
  assert.equal(calls.length, 2, 'A changed reference must be resolved before generating a rewrite');
});

test('Incomplete or ungrounded examples never appear as reviewed coaching', async () => {
  for (const override of [
    {anchor: 'words absent from this draft'},
    {corrected: 'Too short.'},
    {sample: text},
    {sample: examples.corrected},
    {sample: 'Reading ' + 'aloud '.repeat(75) + 'helps.'}
  ]) {
    const service = createResponseExamplesService({
      generate: async () => ({...examples, ...override}),
      review: async () => assert.fail('Malformed examples should be caught before review')
    });
    assert.equal(await service.get(reading.text, text), null, JSON.stringify(override));
  }
});

test('Both provider requests receive the submitted draft and the matching passage', async () => {
  const inputs = [];
  const provider = createResponseExamplesProvider({messages: {create: async request => {
    const name = request.tool_choice.name;
    inputs.push(JSON.parse(request.messages[0].content));
    const input = inputs.length === 1 ? examples : {approved: true};
    return {stop_reason: 'tool_use', content: [{type: 'tool_use', name, input}]};
  }}});
  const service = createResponseExamplesService(provider);
  assert.deepEqual(await service.get(reading.text, text), examples);
  assert.deepEqual(inputs, [
    {passage: reading.text, text},
    {passage: reading.text, text, examples}
  ]);
});

test('A rejected example can be retried and concurrent requests share only the matching draft and passage', async () => {
  let generated = 0, reviewed = 0;
  const service = createResponseExamplesService({
    generate: async () => { generated++; return examples; },
    review: async () => ++reviewed > 1
  });
  assert.equal(await service.get(reading.text, text), null);
  const [first, second] = await Promise.all([service.get(reading.text, text), service.get(reading.text, text)]);
  assert.deepEqual(first, examples);
  assert.deepEqual(second, examples);
  assert.deepEqual(await service.get(reading.text, text), examples);
  assert.equal(generated, 2);
  await service.get(reading.text, text + ' Revision makes the tone clearer.');
  await service.get(reading.text + ' A new edition adds an example.', text);
  assert.equal(generated, 4);
  assert.equal(reviewed, 4);
});
