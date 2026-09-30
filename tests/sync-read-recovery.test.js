'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/index.js'), 'utf8');
const start = source.indexOf('async function fetchAccountProgress(');
const helper = source.slice(start, source.indexOf('\n}', start) + 2);
function harness(statuses, session = () => true) {
  let calls = 0;
  const delays = [];
  const ctx = { AbortSignal, fetch: async () => {
    const status = statuses[calls++];
    if (status === 'network') throw new TypeError('Failed to fetch');
    return { status };
  }, setTimeout: (done, ms) => { delays.push(ms); done(); } };
  vm.createContext(ctx); vm.runInContext(helper, ctx);
  return { run: () => ctx.fetchAccountProgress('/api/sync/student', {}, session), calls: () => calls, delays };
}
test('Progress loads after deployment 502/503 failures with bounded backoff', async () => {
  const h = harness([502, 503, 200]);
  assert.equal((await h.run()).status, 200);
  assert.deepEqual(h.delays, [2000, 4000]);
});
test('Authentication and client errors are not retried', async () => {
  for (const status of [401, 403, 404]) {
    const h = harness([status]); assert.equal((await h.run()).status, status); assert.equal(h.calls(), 1);
  }
});
test('Network failures retry but an outage stops after four requests', async () => {
  const h = harness(['network', 504, 502, 503]);
  assert.equal((await h.run()).status, 503); assert.equal(h.calls(), 4);
});
test('Account changes stop retries before sending another request', async () => {
  let checks = 0;
  const h = harness([502, 200], () => ++checks === 1);
  await assert.rejects(h.run(), /Account session changed/); assert.equal(h.calls(), 1);
});
