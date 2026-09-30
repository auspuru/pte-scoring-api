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

test('Postgres existing attempts save with two round trips and optimistic row-version protection', async () => {
  const id = '12345678-1234-4123-8123-123456789abc';
  const queries = [];
  const pool = {
    async query(sql, params) {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      queries.push({ text, params });
      if (/CREATE TABLE/.test(text)) return { rows: [] };
      if (/SELECT username, data, xmin::text AS version/.test(text))
        return { rows:[{ username:'student', data:{ id, answer:'old' }, version:'11' }], rowCount:1 };
      if (/UPDATE writing_lab_attempts/.test(text)) {
        assert.equal(params[3], '11');
        return { rows:[{ version:'12' }], rowCount:1 };
      }
      return { rows: [], rowCount:0 };
    }
  };
  const store = createStore(pool, '/unused');
  const value = await store.update('student', id, current => ({ ...current, answer:'new' }));
  assert.equal(value.answer, 'new');
  const work = queries.filter(q => !/CREATE TABLE|CREATE INDEX/.test(q.text));
  assert.equal(work.length, 2);
  assert.match(work[0].text, /^SELECT username, data, xmin::text AS version/);
  assert.match(work[1].text, /^UPDATE writing_lab_attempts/);
  assert.equal(work.some(q => /BEGIN|COMMIT|FOR UPDATE|pg_advisory/.test(q.text)), false);
});

test('Postgres optimistic attempt save retries after a concurrent update', async () => {
  const id = '12345678-1234-4123-8123-123456789abc';
  let reads = 0, writes = 0, transforms = 0;
  const pool = {
    async query(sql, params) {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      if (/CREATE TABLE/.test(text)) return { rows: [] };
      if (/SELECT username, data, xmin::text AS version/.test(text)) {
        reads++;
        return { rows:[{ username:'student', data:{ id, count:reads-1 }, version:String(20+reads) }], rowCount:1 };
      }
      if (/UPDATE writing_lab_attempts/.test(text)) {
        writes++;
        if (writes === 1) return { rows:[], rowCount:0 };
        assert.equal(params[3], '22');
        return { rows:[{ version:'23' }], rowCount:1 };
      }
      return { rows:[], rowCount:0 };
    }
  };
  const store = createStore(pool, '/unused');
  const value = await store.update('student', id, current => {
    transforms++;
    return { ...current, count:current.count+1 };
  });
  assert.equal(reads, 2);
  assert.equal(writes, 2);
  assert.equal(transforms, 2);
  assert.equal(value.count, 2);
});

test('Postgres attempt creation uses insert-on-conflict and retries a creation race safely', async () => {
  const id = '12345678-1234-4123-8123-123456789abc';
  let reads = 0, inserts = 0, updates = 0;
  const pool = {
    async query(sql, params) {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      if (/CREATE TABLE/.test(text)) return { rows: [] };
      if (/SELECT username, data, xmin::text AS version/.test(text)) {
        reads++;
        if (reads === 1) return { rows:[], rowCount:0 };
        return { rows:[{ username:'student', data:{ id, answer:'winner' }, version:'31' }], rowCount:1 };
      }
      if (/INSERT INTO writing_lab_attempts/.test(text)) {
        inserts++;
        return { rows:[], rowCount:0 };
      }
      if (/UPDATE writing_lab_attempts/.test(text)) {
        updates++;
        return { rows:[{version:'32'}], rowCount:1 };
      }
      return { rows:[], rowCount:0 };
    }
  };
  const store = createStore(pool, '/unused');
  const value = await store.update('student', id, current => current ? ({ ...current, answer:'merged' }) : ({ id, answer:'first' }));
  assert.equal(inserts, 1);
  assert.equal(reads, 2);
  assert.equal(updates, 1);
  assert.equal(value.answer, 'merged');
});

test('Postgres duplicate attempt revisions can return without a write', async () => {
  const id = '12345678-1234-4123-8123-123456789abc';
  let writes = 0;
  const pool = {
    async query(sql) {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      if (/CREATE TABLE/.test(text)) return { rows: [] };
      if (/SELECT username, data, xmin::text AS version/.test(text))
        return { rows:[{ username:'student', data:{ id, answer:'same' }, version:'40' }], rowCount:1 };
      if (/UPDATE writing_lab_attempts/.test(text)) writes++;
      return { rows:[], rowCount:0 };
    }
  };
  const store = createStore(pool, '/unused');
  const value = await store.update('student', id, current => current);
  assert.equal(value.answer, 'same');
  assert.equal(writes, 0);
});

test('slow Postgres attempt updates expose phase timing without logging attempt data', () => {
  const source = require('node:fs').readFileSync(require.resolve('../writing-lab-store'), 'utf8');
  assert.match(source, /\[attempt-store-perf\]/);
  assert.match(source, /readMs/);
  assert.match(source, /writeMs/);
  assert.match(source, /retries/);
  assert.match(source, /noWrite:true/);
  assert.doesNotMatch(source, /JSON\.stringify\(\{ namespace, uid/);
});
