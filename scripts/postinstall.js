'use strict';
const { spawnSync } = require('node:child_process');

// Railway prepares runtime dependencies through the build command in railway.toml.
if (!process.env.RAILWAY_PROJECT_ID) {
  const result = spawnSync(process.execPath, [process.env.npm_execpath, 'run', 'verify:install'], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
