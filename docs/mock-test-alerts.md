# Administrator alerts for all mock tests

Speaking, Writing, Listening, Reading and Full Mock use the configured administrator email transport and recipient. `MOCK_ALERTS_ENABLED`, `MOCK_ALERT_EMAIL`, `MOCK_ALERT_FROM` and `MOCK_ALERT_TRANSPORT` take precedence over the existing `SPEAKING_MOCK_ALERT*` settings. Existing Speaking configuration therefore enables the wider service without copying secrets or changing recipients. Resend/SMTP delivery and the existing detailed Speaking incident workflow are retained.

## Events

- **Submitted:** one notification when a mock's submitted state is saved. Reading uses the accepted cloud-saved session, not an unsaved browser result. Individual practice questions do not generate submission alerts.
- **Error:** one error notification per attempt for captured server/save/upload/result failures, Writing/Listening background assessment exceptions, and persisted Full Mock/Reading media failures. Routine 4xx validation, access and conflict responses do not send mail.
- **Needs attention:** one notification for a held report or an assessment still incomplete ten minutes after submission. Writing includes its overall feedback readiness. Speaking retains its Azure/Visual Academy diagnostics and established incident receipts.

The timer checks once a minute, so a newly held report is detected on the next check. HTTP event capture persists notifications after the response and never waits for an email provider. Alerts do not trigger assessments, change marks or retry paid requests.

Fully offline browser failures cannot notify the server while disconnected. Reading submissions are detected after successful cloud synchronization. This service covers persisted media errors and server-observed failures, not arbitrary browser JavaScript exceptions.

## Persistence and duplicate protection

`mock_admin_event_jobs` stores distinct submitted/error/attention events keyed by engine, account, attempt and event kind. `mock_test_watch_jobs` stores report checks and the initial activation timestamp. Existing Speaking incident and test outboxes remain separate. SMTP uncertain outcomes remain held; HTTPS retries reuse the frozen request and provider idempotency key within its replay window.

Only submissions on or after the persisted activation timestamp receive new submission notices. Startup/restart scans of Postgres recover events missed during a process interruption, without emailing old submission history. Scans page through every account/attempt rather than allowing a single held report to block later work. File-backed deployments retain registered watches/events across restart and register new activity through HTTP capture; whole-history recovery scans are Postgres-backed.

The service sends to the fixed configured administrator address. Notification bodies contain the username, mock title/type, attempt ID, Brisbane timestamp, report status or safe failure category, and an admin diagnostics link. They contain no answers, transcripts, recordings, provider keys, raw exceptions, request bodies or arbitrary recipients.

## Administration

- `GET /api/admin/mock-alerts`: enabled/configured state, transport verification, supported mock engines, activation time and watchdog threshold.
- `GET /api/admin/mock-alerts/:engine/:username/:id`: normalized report status and delivery receipts for that owned attempt. Existing administrator authentication is required; raw student content is omitted.
- Existing `/api/admin/speaking-mock-alerts` diagnostics and the explicitly requested sample workflow remain available.

Release verification forcibly disables both generic and legacy alert switches and clears provider credentials. Tests use a fake mail transport and local disposable stores. No sample email is sent by the tests.

## Full Mock compatibility

The pre-alert scoring-source snapshot is retained in `alerts-compatible-sources.json`. Compatibility accepts the exact reviewed server source change and the existing compatible transport/navigation baselines, with provider configuration, native scoring sources, paper and weighting still checked. Successful saved assessments keep their original snapshot and are not reassessed because notifications were added.
