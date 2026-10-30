'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { releaseEnvironment, verifyRelease } = require('./verify-release');
const { testDatabaseUrl } = require('../tests/helpers/full-mock-systems');
const { runtimeContext, AUTOMATED, readiness } = require('../full-mock/validation');
function verify({ env = process.env, run = spawnSync, evidencePath } = {}) {
  const before = runtimeContext();
  if (evidencePath) { fs.mkdirSync(path.dirname(evidencePath), { recursive:true }); fs.writeFileSync(evidencePath, JSON.stringify({ schemaVersion:1, context:before, status:'incomplete', checks:[] }, null, 2) + '\n'); }
  testDatabaseUrl(env.FULL_MOCK_TEST_DATABASE_URL);
  const safe = releaseEnvironment(env);
  const regression = verifyRelease({ env:safe, run }); if (regression) return regression;
  const result = run(process.execPath, ['--test','--test-concurrency=1','tests/full-mock-postgres.system.js','tests/full-mock-browser.system.js','tests/speaking-mock-browser.system.js'], { cwd:path.resolve(__dirname, '..'), env:safe, stdio:'inherit' });
  if (result.error) throw Error('The Full Mock system test process could not start.');
  if (result.status !== 0) return Number.isInteger(result.status) && result.status > 0 ? result.status : 1;
  if (JSON.stringify(before) !== JSON.stringify(runtimeContext())) throw Error('Runtime sources changed during verification.');
  if (evidencePath) {
    const checkedAt = new Date().toISOString(), evidenceRef = env.GITHUB_RUN_ID && env.GITHUB_REPOSITORY ? 'https://github.com/' + env.GITHUB_REPOSITORY + '/actions/runs/' + env.GITHUB_RUN_ID : 'Local isolated Full Mock system verification';
    const evidence = { schemaVersion:1, context:before, status:'passed', checks:AUTOMATED.map(id => ({ id, status:'passed', checkedAt, evidenceRef })), scope:'Full and Speaking mocks: PostgreSQL and sandboxed Chromium with synthetic microphone; paid providers injected. Physical devices and deployment are not verified.' };
    fs.mkdirSync(path.dirname(evidencePath), { recursive:true }); fs.writeFileSync(evidencePath, JSON.stringify({ ...evidence, readiness:readiness({ automated:evidence }) }, null, 2) + '\n');
  }
  return 0;
}
if (require.main === module) {
  try { const args = process.argv.slice(2); if (args.length && (args.length !== 2 || args[0] !== '--evidence-out')) throw Error('Usage: verify-full-mock-systems.js [--evidence-out file]'); process.exitCode = verify({ evidencePath:args[1] }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { verify };
