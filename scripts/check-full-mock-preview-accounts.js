'use strict';
// Read-only pre-deployment check. Never creates users or changes credentials.
async function main() {
  const { previewUsers, checkPreviewAccounts } = require('../full-mock/access');
  const users = previewUsers(process.env.FULL_MOCK_PREVIEW_USERS);
  if (!users.length) { console.log('[full-mock-preview-access] No named preview accounts configured.'); return; }
  const connectionString = process.env.PGURL || process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;
  if (!connectionString) throw Error('Preview account verification requires the configured database.');
  const { Pool } = require('pg');
  const local = /(\blocalhost\b|127\.0\.0\.1|@\/|host=\/)/.test(connectionString);
  const pool = new Pool({connectionString,max:1,connectionTimeoutMillis:10000,
    ssl:local ? false : {rejectUnauthorized:false},statement_timeout:10000});
  try {
    const result = await checkPreviewAccounts(users,(...args) => pool.query(...args));
    console.log('[full-mock-preview-access]',JSON.stringify(result));
  } finally { await pool.end(); }
}
if(require.main === module) main().catch(() => { console.error('[full-mock-preview-access] Account verification failed; deployment must not replace the running app.'); process.exitCode=1; });
module.exports = { main };
