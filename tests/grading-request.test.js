'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { request } = require('../public/grading-request');
const response = (status, data) => ({ status, ok: status === 200, json: async () => data });

test('Temporary grading errors, broken JSON and network failures recover with the unchanged submission', async () => {
  for (const kind of ['503', 'network', 'json']) {
    const options = { method: 'POST', body: '{"text":"original answer"}' };
    let calls = 0, recoveries = 0;
    const result = await request('/grade', options, { wait: async () => {}, onRecover: () => recoveries++,
      fetch: async (url, sent) => {
        assert.equal(sent, options);
        if (++calls === 1) {
          if (kind === 'network') throw new TypeError('Failed to fetch');
          if (kind === 'json') return { ok: true, json: async () => { throw new SyntaxError(); } };
          return response(503, { error: 'Temporary overload' });
        }
        return response(200, { score: 9 });
      } });
    assert.deepEqual(result, { score: 9 }); assert.equal(calls, 2); assert.equal(recoveries, 1);
  }
});

test('Authentication, validation, rate limits and rejected evidence never trigger automatic resubmission', async () => {
  for (const [status, data] of [[400, {}], [401, {}], [403, {}], [429, {}], [503, { retryable: false }]]) {
    let calls = 0;
    await assert.rejects(request('/grade', {}, { fetch: async () => { calls++; return response(status, data); } }));
    assert.equal(calls, 1);
  }
});

test('Persistent failures are bounded and recovery stops after an account change or cancellation', async () => {
  for (const kind of ['persistent', 'account', 'cancel']) {
    const controller = new AbortController(); let calls = 0, sameOwner = true;
    await assert.rejects(request('/grade', { signal: controller.signal }, {
      fetch: async () => { calls++; return response(503, {}); },
      canRetry: () => sameOwner, wait: async () => {
        if (kind === 'account') sameOwner = false;
        if (kind === 'cancel') controller.abort();
      } }));
    assert.equal(calls, kind === 'persistent' ? 2 : 1);
  }
});

test('A provisional score is reviewed before return and remains labelled if recovery also fails', async () => {
  for (const recover of [true, false]) {
    let calls = 0;
    const result = await request('/grade', {}, { wait: async () => {}, isFinal: data => !data.provisional,
      fetch: async () => ++calls === 1 ? response(200, { score: 7, provisional: true })
        : recover ? response(200, { score: 9, provisional: false }) : response(503, {}) });
    assert.equal(calls, 2); assert.equal(result.provisional, !recover); assert.equal(result.score, recover ? 9 : 7);
  }
});
