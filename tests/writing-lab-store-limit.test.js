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

test('Postgres updates use the row lock directly and reserve the advisory lock for first creation', async () => {
  const id = '12345678-1234-4123-8123-123456789abc';
  function harness(selectRows) {
    const queries = [];
    const client = {
      async query(sql, params) {
        queries.push(String(sql).replace(/\s+/g, ' ').trim());
        if (/SELECT username, data FROM/.test(sql)) return { rows: selectRows.shift() || [] };
        return { rows: [] };
      },
      release() {}
    };
    const pool = {
      async query(sql) { queries.push(String(sql).replace(/\s+/g, ' ').trim()); return { rows: [] }; },
      async connect() { return client; }
    };
    return { store:createStore(pool, '/unused'), queries };
  }

  const existing = harness([[{ username:'student', data:{ id, answer:'old' } }]]);
  await existing.store.update('student', id, value => ({ ...value, answer:'new' }));
  assert.equal(existing.queries.filter(q => /pg_advisory_xact_lock/.test(q)).length, 0);
  assert.equal(existing.queries.filter(q => /FOR UPDATE/.test(q)).length, 1);

  const creating = harness([[], []]);
  await creating.store.update('student', id, () => ({ id, answer:'first' }));
  assert.equal(creating.queries.filter(q => /pg_advisory_xact_lock/.test(q)).length, 1);
  assert.equal(creating.queries.filter(q => /FOR UPDATE/.test(q)).length, 2);
});
