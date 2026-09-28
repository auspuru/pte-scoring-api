'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createStore } = require('../writing-lab-store');

test('filesystem list reads only the newest bounded attempt set', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'writing-lab-store-'));
  const uid = 'history-limit-user';
  const userDir = path.join(directory, createHash('sha256').update(uid).digest('hex'));
  await fs.mkdir(userDir, { recursive: true });
  try {
    const base = Date.now() - 1000000;
    for (let i = 0; i < 250; i++) {
      const file = path.join(userDir, String(i).padStart(3, '0') + '.json');
      await fs.writeFile(file, JSON.stringify({ id: i, startedAt: i }));
      const time = new Date(base + 1000 + i);
      await fs.utimes(file, time, time);
    }
    const stale = path.join(userDir, 'stale.json');
    await fs.writeFile(stale, '{not valid json');
    const oldTime = new Date(base);
    await fs.utimes(stale, oldTime, oldTime);

    const store = createStore(null, directory);
    const result = await store.list(uid);
    assert.equal(result.length, 250);
    assert.equal(result.some(item => item && item.id === undefined), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
