'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');
const path = require('node:path');

function startChild(t, mode) {
  const modulePath = path.resolve(__dirname, '../graceful-shutdown.js');
  const child = spawn(process.execPath, ['-e', `
    const http = require('node:http');
    const { installGracefulShutdown } = require(${JSON.stringify(modulePath)});
    let response;
    let finished = false;
    const server = http.createServer((req, res) => {
      response = res;
      res.on('finish', () => { finished = true; });
      process.send({ type: 'request' });
    });
    process.on('message', message => {
      if (message === 'finish') response.end('saved');
    });
    installGracefulShutdown(server, {
      onShutdown: () => process.send({ type: 'unready' }),
      timeoutMs: ${mode === 'drain' ? 3000 : 200},
      logger: {
        log: message => process.send({ type: 'log', message }),
        error: message => process.send({ type: 'error', message })
      },
      cleanup: async () => {
        if (!finished) throw new Error('Resources closed before response finished');
        process.send({ type: 'cleanup' });
        if (${JSON.stringify(mode)} === 'cleanup-hang') await new Promise(() => {});
      }
    });
    server.listen(0, '127.0.0.1', () => process.send({ type: 'ready', port: server.address().port }));
  `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const messages = [];
  child.on('message', message => messages.push(message));
  return { child, messages, exited: once(child, 'exit') };
}

function messageOf(child, type) {
  return new Promise(resolve => {
    const listener = message => {
      if (message.type !== type) return;
      child.removeListener('message', listener);
      resolve(message);
    };
    child.on('message', listener);
  });
}

for (const mode of ['drain', 'request-hang', 'cleanup-hang']) {
  test(`shutdown: ${mode}`, { timeout: 5000 }, async t => {
    const { child, messages, exited } = startChild(t, mode);
    const { port } = await messageOf(child, 'ready');
    const requestStarted = messageOf(child, 'request');
    const result = new Promise(resolve => {
      const request = http.get({ host: '127.0.0.1', port, agent: false }, response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, body }));
        response.on('error', error => resolve({ error: error.code }));
      });
      request.on('error', error => resolve({ error: error.code }));
    });
    await requestStarted;
    const draining = messageOf(child, 'log');
    child.kill('SIGTERM');
    assert.match((await draining).message, /draining active HTTP requests/);
    child.kill('SIGINT'); // A second signal must not abort the active request.
    if (mode !== 'request-hang') child.send('finish');
    const response = await result;
    const [code, signal] = await exited;
    assert.equal(signal, null);
    assert.equal(code, mode === 'drain' ? 0 : 1);
    if (mode !== 'request-hang') assert.deepEqual(response, { status: 200, body: 'saved' });
    assert.equal(messages.filter(message => message.type === 'unready').length, 1);
    assert.equal(messages.filter(message => message.type === 'cleanup').length,
      mode === 'request-hang' ? 0 : 1);
    if (mode !== 'drain') assert.ok(messages.some(message => /deadline exceeded/.test(message.message)));
  });
}
