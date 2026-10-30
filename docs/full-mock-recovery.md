# Full Mock assessment recovery

Submitted responses and verified assessment stages remain the source of truth. New assessments and resumed processing jobs persist a recovery policy in their existing assessment state.

- Known failed transcription, content, delivery or writing stages get at most two automatic recovery passes, after 30 seconds and 2 minutes. The scheduler checks due work every 10 seconds.
- Recovery metadata, retry counters, provider stages and the submitted scoring snapshot survive process restarts. Database leases prevent two workers from grading the same attempt at the same time.
- Completed questions and completed provider stages are reused, including an already verified pronunciation/fluency companion trait.
- Uncertain provider requests and unsupported/integrity failures are held for administrator review. Missing or invalid audio still needs the recording recovery flow; no missing assessment becomes zero or fabricated marks.
- Exhausted recovery stays `needs-attention`. The existing mock-alert watchdog sends a deduplicated administrator notice for held reports, and also checks reports still pending after ten minutes. Notifications recheck readiness before their first send. Full Mock watches use the real submittedAt timestamp, with a fallback for earlier stored finishedAt records.
- Scheduled recovery appears as ordinary pending feedback to students. They do not need to press Retry or take another test. Explicit retry remains available when administrator attention is required; it does not reset the automatic retry allowance.
- Older held attempts are not bulk reassessed by deployment. An explicit retry arms the policy for that attempt. Completed reports are never reopened by recovery.

Validation covers file and PostgreSQL persistence, worker races, restarts, backoff, preserved grades and snapshots, bounded retries, uncertain requests and report/alert behavior. This cannot prevent provider outages; it prevents supported transient failures from being left waiting for a manual retry.
