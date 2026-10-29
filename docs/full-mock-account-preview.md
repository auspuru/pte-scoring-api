# Account-specific Full Mock preview

On 29 October 2026 the user requested Full Mock access for the existing
`mahabir1` account. This permits a named test account on the normal portal;
it does not clear the frozen paper for general student release.

`FULL_MOCK_PREVIEW_USERS=mahabir1` is configured only on the main
`pte-scoring-api` service. The server reads a comma-separated list of exact,
case-normalised usernames. An empty list keeps the previous admin/impersonation
access. Wildcards and whitespace-separated patterns are rejected. Other student
accounts, including the separate native-speaking test identities, gain no Full
Mock access from their speaking permissions.

The account keeps its existing password and `user` role. It receives Full Mock
preview access through an authenticated, server-side check, not admin privileges.
Blocked or missing accounts cannot enter. The existing ownership, recording,
control-token and private-review checks still apply. Preview attempts retain
`preview: true`; the immutable paper, task rubrics, weighting and uncalibrated
practice indices are unchanged.

Before deployment, `node scripts/check-full-mock-preview-accounts.js` performs
one read-only query of the configured database and requires each named account
to exist and be unblocked. It does not create an account, reset a password,
change a role or print connection credentials. A failed check stops the new
deployment before replacing the running app.

After deployment, sign in as `mahabir1` at
<https://swt.up.railway.app/full-mock>, or choose **Mock Tests → Full Mock · Preview**.
Use the normal account credentials. No admin key or admin impersonation is needed.

Unit/API tests cover exact identity matching, role preservation, blocked users,
default restrictions, ownership and rejection of other students. Both real
Chromium desktop/mobile-emulation system journeys now complete all 65 questions
as an ordinary account explicitly enabled for preview, rather than an admin.
The normal CI system suite still uses disposable PostgreSQL and injected paid
providers, never student data or paid provider credentials.

The isolated review app remains pinned to its earlier tested commit and keeps
its separate database. The recorded live smoke evidence in
`full-mock-preview-validation.json` describes that earlier runtime; it is not
silently re-labelled as evidence for a changed source snapshot. Fresh CI evidence
binds this account-access change to its new runtime hash. Physical microphones,
independent editorial/listening and teacher review remain pending. Empirical
calibration and general student release remain disabled.

To revoke this test access, remove `mahabir1` from `FULL_MOCK_PREVIEW_USERS` and
redeploy the main app. Existing stored attempts and reports are retained.
