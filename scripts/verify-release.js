'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function releaseEnvironment(source) {
  const env = { ...source, NODE_ENV: 'test' };
  // Railway exposes service variables during builds. Release tests must never
  // connect to student storage, send mail, or consume paid provider credits.
  for (const key of ['PGURL', 'DATABASE_URL', 'DATABASE_PUBLIC_URL', 'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY', 'AZURE_SPEECH_KEY', 'GMAIL_USER', 'GMAIL_APP_PASSWORD', 'GMAIL_USER_PASSWORD']) env[key] = '';
  delete env.RAILWAY_VOLUME_MOUNT_PATH;
  return env;
}

function verifyRelease({ env = process.env, run = spawnSync } = {}) {
  for (const args of [['test'], ['run', 'test:calibration'], ['run', 'build']]) {
    const result = run('npm', args, { cwd: path.resolve(__dirname, '..'), env: releaseEnvironment(env), stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) return Number.isInteger(result.status) && result.status > 0 ? result.status : 1;
  }
  return 0;
}

if (require.main === module) {
  try { process.exitCode = verifyRelease(); }
  catch (error) { console.error('Release verification could not run.'); process.exitCode = 1; }
}
module.exports = { releaseEnvironment, verifyRelease };
