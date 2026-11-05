# Reassess saved Full Mock delivery

Open **Admin → student → Full mock recording review**. Click **Find submitted Full Mocks**, choose the exact saved submission, then **Inspect full mock**. Verify the account, attempt ID and paper/version. The reassessment controls appear above the original result diagnostics.

For a complete, settled report, click **Load saved recordings for reassessment**. Select individual recording checkboxes or **Select all available**, then **Send selected recordings**. Alternatively click **Send whole mock for reassessment** to queue every available saved speaking recording. **Send this recording** queues just one item. Each recording requests a paid Azure assessment.

The request returns a saved background batch immediately. The panel polls per-recording progress. Reloading or reopening the attempt shows saved receipts and resumes unsent work; it does not resend completed recordings. Requests use the original stored audio and verified chunks. No replacement uploads, edited audio or substituted transcripts are accepted.

Azure continuous Speech supports the portal’s existing endpoint/resource configuration as well as a region. Missing configuration is reported before any job is queued. Errors, queued work, confirmed results and unconfirmed requests are visible in the panel.

Review all previous/proposed pronunciation and fluency marks and report indices. Check the replacement confirmation and click **Publish replacement scores**. The complete batch is applied atomically; original jobs/delivery evidence, provider results, audio hashes and before/after profiles remain in history. **Discard proposed replacement** retains the old marks and receipts. If some recordings are unavailable, publication requires explicit confirmation that only confirmed recordings are replaced; unavailable recordings retain their old marks.

Only confirmed, ungated speaking answers with one original recording have replaceable delivery marks. ASQ has no pronunciation/fluency marks. Writing, objective Reading/Listening answers, content marks, original question snapshots and recordings are retained. Incomplete reports use the existing missing-assessment workflow. Multiple segments for a single answer require a separately audited assembly path; selecting multiple question recordings is supported.

Each item is claimed atomically before provider work. Competing controllers and repeated operation IDs do not repeat requests. An interrupted item is held for confirmation; after its worker lease expires, unsent items can resume without repeating it. A late receipt after publication is archived and cannot alter already published marks. Earlier unconfirmed single-recording operations hold only their affected recording, with a visible status; other available recordings can be selected. No uncertain paid request is repeated automatically.

The API uses existing admin authentication and exact owner/attempt storage. The browser supplies selections and confirmation, never scores. Publication compares the original frozen inputs and native jobs atomically. No student results are changed by deployment or tests.
