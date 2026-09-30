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

test('Postgres attempt updates use optimistic row versions and retry conflicts safely', async () => {
  const id = '12345678-1234-4123-8123-123456789abc';

  function harness(respond) {
    const queries = [];
    const client = {
      async query(sql, params) {
        const normalized = String(sql).replace(/\s+/g, ' ').trim();
        queries.push(normalized);
        return respond(normalized, params, queries.length);
      },
      release() {}
    };
    const pool = {
      async query(sql) { queries.push(String(sql).replace(/\s+/g, ' ').trim()); return { rows: [] }; },
      async connect() { return client; }
    };
    return { store:createStore(pool, '/unused'), queries };
  }

  const existing = harness((sql) => {
    if (/^SELECT username, data, xmin::text AS version/.test(sql)) {
      return { rows:[{ username:'student', data:{ id, answer:'old' }, version:'10' }] };
    }
    if (/^UPDATE writing_lab_attempts/.test(sql)) return { rows:[{ version:'11' }] };
    return { rows:[] };
  });
  await existing.store.update('student', id, value => ({ ...value, answer:'new' }));
  assert.equal(existing.queries.filter(q => /^SELECT username, data, xmin::text AS version/.test(q)).length, 1);
  assert.equal(existing.queries.filter(q => /^UPDATE writing_lab_attempts/.test(q)).length, 1);
  assert.equal(existing.queries.some(q => /BEGIN|COMMIT|FOR UPDATE|pg_advisory_xact_lock/.test(q)), false);

  const creating = harness((sql) => {
    if (/^SELECT username, data, xmin::text AS version/.test(sql)) return { rows:[] };
    if (/^INSERT INTO writing_lab_attempts/.test(sql)) return { rows:[{ version:'1' }] };
    return { rows:[] };
  });
  await creating.store.update('student', id, () => ({ id, answer:'first' }));
  assert.equal(creating.queries.filter(q => /^SELECT username, data, xmin::text AS version/.test(q)).length, 1);
  assert.equal(creating.queries.filter(q => /^INSERT INTO writing_lab_attempts/.test(q)).length, 1);

  let reads = 0, writes = 0;
  const conflict = harness((sql) => {
    if (/^SELECT username, data, xmin::text AS version/.test(sql)) {
      reads++;
      return { rows:[{ username:'student', data:{ id, answer:reads === 1 ? 'old' : 'newer' }, version:String(reads) }] };
    }
    if (/^UPDATE writing_lab_attempts/.test(sql)) {
      writes++;
      return { rows:writes === 1 ? [] : [{ version:'3' }] };
    }
    return { rows:[] };
  });
  const saved = await conflict.store.update('student', id, value => ({ ...value, note:'mine' }));
  assert.equal(reads, 2);
  assert.equal(writes, 2);
  assert.equal(saved.answer, 'newer');
  assert.equal(saved.note, 'mine');
});

test('slow Postgres attempt updates expose optimistic retry timing without logging attempt data', () => {
  const source = require('node:fs').readFileSync(require.resolve('../writing-lab-store'), 'utf8');
  assert.match(source, /\[attempt-store-perf\]/);
  assert.match(source, /connectMs/);
  assert.match(source, /readMs/);
  assert.match(source, /writeMs/);
  assert.match(source, /conflicts/);
  assert.doesNotMatch(source, /JSON\.stringify\(\{ namespace, uid/);
});
