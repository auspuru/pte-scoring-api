# Approved practice workspace rollout

Scope: individual practice only. Keep native controllers, question identities, saved recordings, scoring, feedback and original IPT reports. Protected mock counts, clocks, navigation and grading remain independent.

1. Speaking: common top dock with Return to questions, Reattempt, Back and Next; earlier attempts beneath the question; select a saved question without creating another attempt; preserve paused lead-in/listening/preparation when returning; five-second lead-in for every timed audio prompt.
2. Writing: apply the same question-list round trip and per-question history to SWT and Essay, preserving the desktop passage/editor workspace and exact saved-result entries.
3. Reading: common dock and previous attempts for each native practice task, with no persistent left question navigator or changes to protected Reading mocks.
4. Listening: apply the common dock/list/history and a five-second lead-in to individual timed audio questions; preserve each task's playback, response and grading rules and all sectional/full mocks.

Each phase requires its focused native browser checks, regression/build checks and final-head Portal CI before publication. Deployment is verified against the merged commit and served assets. No sample prototype questions or simulated scores are imported.

Phase 2 uses a standalone presentation adapter around the existing SWT/Essay handlers. It does not replace submitters, graders, saved feedback or report renderers. SWT selection is a separate menu; per-question drafts and clocks return to their original question, and saved-result actions carry the exact timestamp/attempt ID.

Phase 3 retains every Reading practice session on explicit Reattempt, reuses the selected saved session from its menu, and exposes exact historical answers beneath the native question. Five current Reading task types share the dock; native graders and protected mock players remain unchanged.

Phase 4 removes the second Listening question chooser, applies the common dock to active and completed individual attempts, and links exact historical response IDs. Timed audio has an owner/attempt-scoped five-second lead-in that pauses on departure. Native server deadlines, single playback, saved answers, graders and report renderers are preserved.
