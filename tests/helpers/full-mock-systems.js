'use strict';
const { Pool } = require('pg');
const { randomUUID } = require('node:crypto');
function testDatabaseUrl(value) {
  let url; try { url = new URL(value); } catch { throw Error('Set FULL_MOCK_TEST_DATABASE_URL to a disposable local test database.'); }
  if (!['postgres:','postgresql:'].includes(url.protocol) || !['localhost','127.0.0.1','[::1]'].includes(url.hostname)
    || !/^\/full_mock_test(?:_[a-z0-9_]+)?$/.test(url.pathname) || !/^full_mock_test(?:_[a-z0-9_]+)?$/.test(url.username)
    || url.search || url.hash) throw Error('Full Mock system tests only accept a disposable loopback full_mock_test database and user.');
  return value;
}
async function database(t) {
  const connectionString = testDatabaseUrl(process.env.FULL_MOCK_TEST_DATABASE_URL), schema = 'full_mock_test_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString, max:2, connectionTimeoutMillis:5000 });
  await admin.query('CREATE SCHEMA ' + schema);
  const pools = [], closers = [];
  const pool = () => { const value = new Pool({ connectionString, options:'-c search_path=' + schema, max:12, connectionTimeoutMillis:5000 }); pools.push(value); return value; };
  const first = pool();
  await first.query('CREATE TABLE accounts (username TEXT PRIMARY KEY)');
  await first.query('INSERT INTO accounts(username) VALUES ($1),($2),($3)', ['alice','bob','student']);
  t.after(async () => { for (const close of closers) await close(); await Promise.all(pools.map(value => value.end())); await admin.query('DROP SCHEMA ' + schema + ' CASCADE'); await admin.end(); });
  return { first, pool, schema, onClose:close => closers.push(close) };
}
async function until(check, message = 'Timed out waiting for Full Mock state.', milliseconds = 12000) {
  const ends = Date.now() + milliseconds;
  while (Date.now() < ends) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw Error(message);
}
module.exports = { testDatabaseUrl, database, until };
