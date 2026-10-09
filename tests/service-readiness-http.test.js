'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { releaseEnvironment } = require('../scripts/verify-release');

async function start(t, pgurl = '') {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pte-readiness-'));
  const child = spawn(process.execPath, ['server.js'], { cwd:path.resolve(__dirname, '..'),
    env:{...releaseEnvironment(process.env), PORT:String(port), PGURL:pgurl,
      RAILWAY_VOLUME_MOUNT_PATH:directory, SKIP_PUPPETEER_WARMUP:'1', DISABLE_EXTERNAL_SPELLCHECK:'1'},
    stdio:'ignore' });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
      await exited;
      clearTimeout(timer);
    }
    await fs.rm(directory, { recursive:true, force:true });
  });
  return { directory, base:`http://127.0.0.1:${port}` };
}

async function readiness(base, expected) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base + '/api/ready');
      const body = await response.json();
      if (body.status === expected) return { code:response.status, body, cache:response.headers.get('cache-control') };
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error('Readiness did not reach ' + expected);
}

test('The real server becomes ready after creating both practice stores', { timeout:20000 }, async t => {
  const app = await start(t);
  const result = await readiness(app.base, 'ready');
  assert.equal(result.code, 200);
  assert.deepEqual(result.body, { ready:true, status:'ready' });
  assert.equal(result.cache, 'no-store');
  await fs.access(path.join(app.directory, 'speaking-lab'));
  await fs.access(path.join(app.directory, 'writing-lab'));
});

test('A listening server with a failed Postgres initialization stays unavailable', { timeout:20000 }, async t => {
  const app = await start(t, 'postgres://test:test@127.0.0.1:9/unavailable');
  const result = await readiness(app.base, 'initialization_failed');
  assert.equal(result.code, 503);
  assert.deepEqual(result.body, { ready:false, status:'initialization_failed' });
  const again = await fetch(app.base + '/api/ready');
  assert.equal(again.status, 503);
});
