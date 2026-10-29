'use strict';
// Read-only pre-deployment check. Never creates users or changes credentials.
async function main() {
  const { previewUsers, checkPreviewAccounts, everyoneEnabled } = require('../full-mock/access');
  const all = everyoneEnabled(process.env.FULL_MOCK_PREVIEW_ALL);
  const users = previewUsers(process.env.FULL_MOCK_PREVIEW_USERS);
  if (!all && !users.length) { console.log('[full-mock-preview-access] No named preview accounts configured.'); return; }
  const connectionString = process.env.PGURL || process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;
  if (!connectionString) throw Error('Preview account verification requires the configured database.');
  const { Pool } = require('pg');
  const local = /(\blocalhost\b|127\.0\.0\.1|@\/|host=\/)/.test(connectionString);
  const pool = new Pool({connectionString,max:1,connectionTimeoutMillis:10000,
    ssl:local ? false : {rejectUnauthorized:false},statement_timeout:10000});
  try {
    const result = await checkPreviewAccounts(users,(...args) => pool.query(...args),{all});
    console.log('[full-mock-preview-access]',JSON.stringify(result));
    const inspect = process.argv.find(value => value.startsWith('--inspect-user='))?.slice('--inspect-user='.length);
    if (inspect && /^[a-z0-9_-]{1,80}$/i.test(inspect)) {
      // Operational metadata only: never log answers, recordings or credentials.
      const rows = await pool.query("SELECT state FROM full_mock_attempts WHERE username=$1 ORDER BY updated_at DESC LIMIT 3", [inspect]);
      console.log('[full-mock-attempt-diagnostic]', JSON.stringify({ uid:inspect, attempts:rows.rows.length }));
      for (const { state } of rows.rows) {
        const jobs = Object.values(state.assessment?.items || {});
        console.log('[full-mock-attempt-diagnostic]', JSON.stringify({ uid:inspect, id:state.id, status:state.status, index:state.index,
          assessment:state.assessment?.status || 'not-requested', assessed:jobs.filter(job => job.status === 'assessed').length,
          pending:jobs.filter(job => job.status !== 'assessed').map(job => ({ status:job.status, reason:job.result?.reason || job.reason || null })),
          unfinishedSegments:state.responses.reduce((count,response) => count + response.segments.filter(segment => !segment.cancelled && !segment.finished).length, 0),
          lateUploads:state.responses.reduce((count,response) => count + response.segments.filter(segment => Object.values(segment.chunks).some(chunk => chunk.late)).length, 0) }));
      }
    }
  } finally { await pool.end(); }
}
if(require.main === module) main().catch(() => { console.error('[full-mock-preview-access] Account verification failed; deployment must not replace the running app.'); process.exitCode=1; });
module.exports = { main };
