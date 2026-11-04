# Analyse and publish incomplete mock results

In **Admin → Users → View**, open the Speaking or Full mock recovery panel. Enter the exact saved attempt ID from its alert and inspect it. Active student attempts and active assessment work cannot be released through this flow.

1. Choose **Analyse and retry up to twice**. Only missing, safely retryable assessments are retried. Confirmed results, answers, original recordings and the saved paper remain intact.
2. Review the assessed/unresolved counts, question numbers, reasons and retry-round count. If all missing work recovers in the first round, the second round is unnecessary. A missing recording, an uncertain provider request or an account/billing hold is labelled as unavailable for a safe retry; no substitute answer or mark is invented.
3. Choose **Publish results**, add a visible report note and confirm publication with the listed exclusions. This separate authenticated action publishes the available report. Unresolved questions leave their task's scoring denominator and remain visible with their explanation; their original evidence is retained.

Starting this review holds automatic publication for that attempt, including when the retry recovers every assessment. The student report and completion alerts wait for the instructor's publication. Ordinary mock recovery is unchanged until an instructor starts the review.

The analysis page polls while a retry is running and starts the second round when needed. The retry ledger is stored with the attempt. Closing the panel stops the page from starting another round; the current saved job can finish. Reopen the exact attempt and use **Continue analysis** to resume. Refreshing, restarting or replaying an interrupted operation cannot reset the two-round limit. Concurrent administrators share that limit.

A whole task without any verified assessment still requires recovery before publishing an overall score. Paper/input integrity failures, active work and changed confirmed marks also remain held. These conditions are shown in the analysis; the system does not fabricate an overall score.

Speaking mocks use the existing **40-minute overall clock** for new starts and reattempts. Saved attempt deadlines, individual question windows and frozen Full Mock section clocks retain their original values.

## Runtime

- `mock-result-review.js`: owner-bound evidence, retry ledger, immutable-input and confirmed-mark verification, publication proof and explicit exclusions.
- Speaking: existing authenticated `/api/admin/speaking-mocks/:username/:id/scoring/retry`, `{mode:'instructor-review',action:'analyse'|'publish',operation,evidenceHash}`. Publication also requires `{note,confirmPublish:true}`.
- Full: authenticated `/api/admin/full-mocks/:username/:id/scoring/review`, with the same action/operation/evidence and publication fields. Diagnostics remain on the existing protected `/scoring` route.
- Each Speaking stage gets one call budget per instructor retry round; successful stages and Azure chunks are reused. Remote DI retries reuse their saved receipt and operation. Full Mock retries reuse its existing stage checkpoints and worker leases.
- Existing historical snapshot compatibility is exact and source-pinned. Native graders, models, task weights and frozen papers do not change.

Use `tests/mock-result-review.test.js`, `tests/admin-result-review.test.js`, the protected-route tests, the competing PostgreSQL case and the desktop/mobile staff analysis case. Production credentials and live student records are outside these tests.
