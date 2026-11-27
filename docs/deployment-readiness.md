# Deployment readiness

`GET /api/ready` returns 200 only after the account schema, existing-data migration
and both practice stores have initialized, and a bounded storage probe succeeds.
It returns 503 during startup, failed initialization, storage loss or shutdown.
Responses expose only a readiness flag and status, with `Cache-Control: no-store`.
Database errors, account counts and student data are not included.

The storage probe checks Postgres connectivity when configured and access to the
data directory. Concurrent requests share one probe, including when a connection
is stuck. External grading providers are not readiness dependencies: recordings,
saved writing and diagnostic feedback can remain available during a provider outage.

Railway uses `/api/ready` with a 120-second deployment healthcheck timeout. The
60-second draining window exceeds the application's 55-second shutdown deadline.
Readiness becomes unavailable before existing requests drain and resources close.

`node scripts/verify-release.js` runs the test suite, offline calibration and
complete build in sequence. Any failure stops the release. It clears database,
grading, speech and mail credentials from the test environment, preventing build
checks from accessing production student storage or paid providers. Portal CI runs this
release check before merge. Railway's build prepares the WebP logo, Edge TTS
environment, and Chromium for the application. The deployment uses the committed
frontend bundle, utility CSS, vendor assets and speaking recordings. The Railway
build environment skips the repository's npm install-time verification, which
remains available in CI and local installs.

Railway's deployment healthcheck runs when promoting a deployment; it is not a
continuous uptime monitor. The attached volume permits only one active deployment,
so a short interruption during redeployment remains possible. Moving persistent
files off that volume is a separate architecture change.
