# Reassess saved Full Mock delivery

Open **Admin → student → Full mock recording review**. Click **Find submitted Full Mocks**, choose the exact saved submission, then **Inspect full mock**. Verify the account, attempt ID and paper/version. The reassessment controls appear above the original result diagnostics.

For a complete, settled report, click **Load saved recordings for reassessment**. Select individual recording checkboxes or **Select all available**, then **Send selected recordings**. Alternatively click **Send whole mock for reassessment** to queue every available saved speaking recording. **Send this recording** queues just one item. Each recording requests a paid Azure assessment.

The request returns a saved background batch immediately. The panel polls per-recording progress. Reloading or reopening the attempt shows saved receipts and resumes unsent work; it does not resend completed recordings. Requests use the original stored audio and verified chunks. No replacement uploads, edited audio or substituted transcripts are accepted.

Azure continuous Speech supports the portal’s existing endpoint/resource configuration as well as a region. Missing configuration is reported before any job is queued. Errors, queued work, confirmed results and unconfirmed requests are visible in the panel.

Review all previous/proposed pronunciation and fluency marks and report indices. Check the replacement confirmation and click **Publish replacement scores**. The complete batch is applied atomically; original jobs/delivery evidence, provider results, audio hashes and before/after profiles remain in history. If the original report was published with instructor-approved exclusions, those exclusions remain valid. The original and revised confirmation hashes are archived in the delivery operation as an audited amendment. **Discard proposed replacement** retains the old marks and receipts. If some recordings are unavailable, publication requires explicit confirmation that only confirmed recordings are replaced; unavailable recordings retain their old marks.

Only confirmed, ungated speaking answers with one original recording have replaceable delivery marks. ASQ has no pronunciation/fluency marks. Writing, objective Reading/Listening answers, content marks, original question snapshots and recordings are retained. Incomplete reports use the existing missing-assessment workflow. Multiple segments for a single answer require a separately audited assembly path; selecting multiple question recordings is supported.

Each item is claimed atomically before provider work. Competing controllers and repeated operation IDs do not repeat requests. An interrupted item is held for confirmation; after its worker lease expires, unsent items can resume without repeating it. A late receipt after publication is archived and cannot alter already published marks. Earlier unconfirmed single-recording operations hold only their affected recording, with a visible status; other available recordings can be selected. No uncertain paid request is repeated automatically.

The API uses existing admin authentication and exact owner/attempt storage. The browser supplies selections and confirmation, never scores. Publication compares the original frozen inputs and native jobs atomically. No student results are changed by deployment or tests.

If a proposed profile is still pending, the panel prevents publication and lists any unverified questions. Keep the saved batch; do not resend its completed recordings. The original report remains published until a verified replacement is explicitly published.
# Speaking and Full Mock publication

The recording reassessment controls are available for both engines in **Users → View**. Find the saved attempt, inspect its account and attempt ID, then load its recordings. Send one recording, a selected set, or all available recordings. New sends publish their confirmed changes automatically. Older saved Full Mock proposals retain their explicit **Publish replacement scores** action.

The student report shows the updated question numbers and before/after marks, including newly assessed content when a previously missing result is recovered. Confirmed selected questions must be included in the published report. Original scores, recordings, exclusions and instructor-review confirmation ledgers remain in the saved history.

New Speaking and Full Mock attempts publish confirmed content and any confirmed Azure delivery traits after their first assessment pass. Missing traits are labelled unavailable and omitted from the score calculation; missing, effectively silent or unavailable responses receive an explicit exclusion note. An entirely unavailable result has no invented numeric score. Existing saved attempts retain their original completion rules until an administrator explicitly reassesses selected recordings.

Speaking routes use `/api/admin/speaking-mocks/:username/:id/scoring/delivery` with the same protected `send`, `publish` and `discard` actions as Full Mock. Paid-call receipts, operation IDs and worker leases prevent automatic duplicate sends; uncertain requests remain visible for investigation. Completed operations resume publication after restart without resending confirmed recordings.
