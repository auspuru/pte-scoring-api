'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReadiness } = require('../service-readiness');

test('Readiness stays unavailable until initialization and a storage probe succeed', async () => {
  let probes = 0;
  const ready = createReadiness({ probeStorage: async () => { probes++; }, cacheMs: 0 });
  assert.deepEqual(await ready.check(), { ready: false, status: 'starting' });
  assert.equal(probes, 0);
  ready.markInitialized();
  assert.deepEqual(await ready.check(), { ready: true, status: 'ready' });
  assert.equal(probes, 1);
});

test('Storage loss makes readiness fail, and a later successful probe recovers', async () => {
  let unavailable = true;
  const ready = createReadiness({ probeStorage: async () => { if (unavailable) throw Error('private database details'); }, cacheMs: 0 });
  ready.markInitialized();
  assert.deepEqual(await ready.check(), { ready: false, status: 'storage_unavailable' });
  unavailable = false;
  assert.equal((await ready.check()).ready, true);
});

test('A stuck storage connection is bounded without spawning more probes', async () => {
  let probes = 0, release;
  const ready = createReadiness({ probeStorage: () => { probes++; return new Promise(resolve => { release = resolve; }); }, timeoutMs: 20, cacheMs: 0 });
  ready.markInitialized();
  const results = await Promise.all([ready.check(), ready.check(), ready.check()]);
  assert(results.every(x => x.ready === false));
  assert.equal(probes, 1);
  assert.equal((await ready.check()).ready, false);
  assert.equal(probes, 1);
  release();
});

test('Shutdown cannot be overturned by an in-flight successful storage probe', async () => {
  let release;
  const ready = createReadiness({ probeStorage: () => new Promise(resolve => { release = resolve; }) });
  ready.markInitialized();
  const checking = ready.check();
  await Promise.resolve();
  ready.stop();
  release();
  assert.deepEqual(await checking, { ready: false, status: 'stopping' });
  assert.deepEqual(await ready.check(), { ready: false, status: 'stopping' });
});

test('A failed initialization cannot advertise readiness later', async () => {
  const ready = createReadiness({ probeStorage: async () => {} });
  ready.markFailed();
  ready.markInitialized();
  assert.deepEqual(await ready.check(), { ready: false, status: 'initialization_failed' });
});

test('The readiness HTTP contract uses 503 for failure and contains no internal errors', async () => {
  const ready = createReadiness({ probeStorage: async () => { throw Error('secret-host-and-user'); }, cacheMs: 0 });
  ready.markInitialized();
  const res = { status(code) { this.code = code; return this; }, set(key, value) { this.header = [key, value]; }, json(body) { this.body = body; } };
  await ready.handler({}, res);
  assert.equal(res.code, 503);
  assert.deepEqual(res.header, ['Cache-Control', 'no-store']);
  assert.deepEqual(res.body, { ready: false, status: 'storage_unavailable' });
});
