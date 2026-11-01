# Full Mock unusable audio review

Users → View → Full mock recording review uses the signed-in administrator's existing authentication. Inspect the exact attempt ID, listen to its saved recordings through the authorised student support view, select the affected pending Answer Short Questions, record the reason and confirm the audio review. The action never infers silence from a failed provider request.

Only submitted attempts with verified snapshot/source compatibility qualify. A selected response must have complete durable audio and a known failed, non-uncertain transcription stage. At least one genuinely assessed ASQ must remain. Active assessment work, stale evidence, confirmed marks, other task types and uncertain requests are rejected. No provider call is made by exclusion.

Exclusions are separate input/snapshot/job-bound records. Original sealed responses, chunks, failed-stage evidence and all confirmed marks stay untouched. Native points for excluded questions leave both the earned and possible totals within ASQ; the existing task contribution weights and index calculations remain unchanged. A whole task cannot be excluded. Excluded questions are accounted for, visibly noted, and never displayed as zero or still awaiting assessment. Background workers retain valid exclusions.

The admin GET `/api/admin/full-mocks/:username/:id/scoring` returns bounded statuses and evidence hashes. POST to its `/exclude-audio` suffix requires an exact operation ID, the inspected evidence hash, selected question IDs, a note and `confirmUnusableAudio:true`. Reuse the exact operation/body after an interrupted response. Inspect again after a stale-evidence conflict. The durable operation ledger keeps before/after hashes; compare the returned responsesHash and confirmedHash to the inspected values.

This operation adds review metadata; rollback requires a deliberate, separately reviewed removal of the exact exclusion and operation record, followed by the existing missing-stage workflow. Retained original data enables that review. It does not authorise overwriting completed assessments or resetting an uncertain provider receipt.
