# Unattended mock recovery

Routine submission/assessment recovery and report publication do not require administrator approval. Confirmed marks, sealed answers, clocks, stored question snapshots and original audio remain authoritative. Deliberate reassessment/exclusion is a separate authorised operation.

## Runtime

- Full Mock: `full-mock/assessment.js` discovers saved submissions whose initial assessment request was interrupted. Its leased workers retain completed stages and schedule only confirmed recoverable failures. Retry delays are 30 seconds, 2 minutes, 10 minutes, 30 minutes, 2 hours, 6 hours, 12 hours and 24 hours, persisted in the assessment record. The finite budget survives restart. Version/integrity mismatches, uncertain calls and auth failures remain held.
- Speaking: progressive answer jobs are enabled by default; the existing explicit `SPEAKING_PROGRESSIVE_SCORING=false` operational override is retained. The scanner recovers saved recordings and publishes complete results. After the short stage retry budget, known failures can enter four delayed repair cycles (10 minutes, 30 minutes, 2 hours, 6 hours). Stable repair operation IDs and compare-and-set prevent duplicate retries. Exclusions, uncertain requests and permanent errors are not automatically reset. Academy repairs poll the saved remote receipt before retry and require confirmed retryable remote failures.
- Writing/Listening: a 15-second background scanner walks recent mocks (14 days) with a stable cursor and 20-record page. Answer assessment leases and retry budgets live in `assessmentRecovery`, scoped by owner, attempt, answer index and immutable input fingerprint. Independent workers cannot buy the same assessment concurrently. Expired in-flight calls are held as uncertain rather than repeated. Confirmed zero scores are complete results. Provisional results remain pending; feedback is generated after the required marks are confirmed. Results continue after the browser closes.
- Reading: objective grading stays in its existing saved-session engine; it needs no external content worker. Protected navigation, saving and clock rules are unchanged.

Writing/Listening reports poll saved results at 5-second intervals initially, then 30-second intervals. Polling never requires a new browser assessment request. History and report reads observe the same saved results. Internal leases/fingerprints are omitted from student responses.

## Operational exceptions

Invalid credentials/billing, permanent missing or damaged recordings, integrity/version mismatches, exhausted retry budgets and uncertain paid outcomes are not converted to scores. Keep evidence intact and expose an accurate delayed/recovery state. Check authoritative provider receipts before any deliberate uncertain retry. Do not silently re-record a sealed answer, exclude a question or invent a mark to publish a report. Existing incident notifications are informational, not a publication approval gate.

File storage records a verified owner marker on Writing attempt updates. Legacy hashed folders without this marker are skipped until an authorised normal update establishes ownership. PostgreSQL scans use the stored account owner directly. Never infer an owner from a folder name.

## Regression gates

`tests/unattended-mock-recovery.test.js` covers durable leases, cooldown/restart, uncertainty/auth/billing holds, unchanged confirmed marks and the exact reviewed transport-only source differences. Full Mock tests cover interrupted initial requests, finite retries and old snapshot compatibility. Speaking tests cover deferred automatic repairs and reuse of confirmed work. PostgreSQL systems test competing claims across independent pools. Browser systems verify a pending sectional report updates without a retry click or browser scoring POST. Final-head Portal CI and its current evidence artifact are required for release.
