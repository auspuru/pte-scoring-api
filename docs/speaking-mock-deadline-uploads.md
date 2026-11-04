# Speaking mock deadline and upload finalisation

The first safety patch keeps the existing paper budget and question timings. The overall, server-synchronised countdown is visible above the question with five-minute and one-minute warnings.

At deadline, request handlers and the progressive worker use the same durable transition in `speaking-mock-submission.js`. No new question or prompt may begin. An already authorised, unsaved current response is reserved only if its server recording window began before the deadline and its existing upload window has not expired. The upload closes at the earlier of deadline + 90 seconds and recording-window end + 90 seconds. Repeated reads and worker restarts cannot extend this window.

A matching recording hash is idempotent; changed audio, another question, another owner, or an upload outside the window is rejected. The existing recording is not replaced. Accepted recordings are scored through the existing durable jobs. Existing confirmed marks and previously submitted attempts are not rewritten.

A finalising upload has no published report. If the upload expires, or questions were never reached before expiry, the new submission is explicitly incomplete. Missing work is not manufactured into a zero. Deliberate skips still use the native unanswered gate. New incomplete submissions do not emit completion notifications; existing administrator-attention monitoring remains available. Local pending recordings are retained until acknowledged by the server. The player can retry a reserved device-cache recording without microphone capture.

## Next clock-policy phase

This patch deliberately does not award extra time from browser-reported stalls or change the 36-minute paper contract. A future, versioned policy must distinguish server-measured processing waits from student navigation, backgrounding and playback pauses, persist bounded credits atomically, and exercise competing workers and old snapshots. Merely increasing the fixed duration or trusting client timestamps would not safely establish those credits. Until then, a timeout can still leave unreached questions, but it is shown as incomplete rather than a completed test with fabricated unanswered results.

## Incident recovery is separate

Do not reopen Harpreet's or any other historical submitted attempt automatically. Recovery requires the exact owner/attempt and retained original device/server recording evidence. Never regenerate student answers or change confirmed marks as part of this rollout.
