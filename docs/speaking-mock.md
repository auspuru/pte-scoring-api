# Speaking mocks

Each of the three papers contains an unscored personal introduction and 27 speaking-scored items:
6 Read Aloud, 10 Repeat Sentence, 5 Describe Image, 2 Retell Lecture,
2 Summarise Group Discussion and 2 Respond to a Situation. It is a speaking-only
practice paper, not a complete Speaking & Writing section. Answer Short Question
is not included: the saved bank has no ASQ prompts, and the current score guide
assigns ASQ to Listening. No new prompt audio is generated. Five additional RS
items use existing verified dictation recordings. The sixth RA uses an existing
archive passage; RA needs no prompt recording. Discussion recordings retain their
existing lengths, which are shorter than some current Pearson discussion prompts.

Mock 1 retains its original questions. Mocks 2 and 3 use different existing SST
passage excerpts for Read Aloud, saved dictation audio for Repeat Sentence, and
saved prediction images for Describe Image. These three item sets do not overlap
across the papers. The saved bank has five original lectures, discussions and
situations, so one recording of each type is shared across the three papers.

Reattempt is available on submitted results and in saved history. It copies the
exact stored question snapshot into a new owned attempt with an independent timer,
empty recordings and new scoring. It never resets or overwrites the previous
attempt. Fullscreen and microphone preflight still happen before creating the
reattempt, and duplicate creation retries with the same ID are idempotent. Speaking
practice, all three mocks, and reattempts remain limited to pppp, mehakbir1 and mahabir1 by
the existing server access gate.

## Test experience

The published Pearson examples informed the plain white question area, instruction
line, separate audio and lavender Recorded Answer panels, progress bars, volume
control and fixed Next footer. The shared protected-screen controller hides portal
navigation and records interruptions, without interpreting them as cheating or
changing marks. Browser fullscreen and microphone permissions are acquired before
an attempt is created. Each prompt plays once. There is a short instruction lead-in,
the task-specific preparation period, a recording tone except for RS, and the saved
response limit. Three seconds of silence after speech begins ends recording when
Web Audio voice detection is available. Next ends a response early, saves it, then
advances. The screen asks before proceeding without a saved answer. There is no Back
or replay control in the timed test. Server timestamps retain the clocks on refresh.
After interruption the remaining audio can resume at its current position, without
replaying the elapsed portion. Captured pending audio is kept in IndexedDB when
available and can be uploaded again without recording again.

## Two independent levels of scoring

Individual content uses the existing speaking content engine and policies. GPT
Audio and Azure assess pronunciation and fluency separately for all six types,
including RA, RS and DI. Successful stages are persisted and reused. The introduction
is never scored or included in the overall audio review.

The overall /90 is a separate, blind GPT Audio assessment of every saved scored
response. Its boundary accepts recording objects only. The model receives compressed
audio clips in order and their measured durations, with no question text, type,
reference, transcript, content marks, delivery marks, earlier feedback, student
identity or integrity metadata. It judges the complete set directly; it never sums
or averages question marks or maps their totals to /90. A lower whole-test trait
requires evidence across distinct recordings. An isolated poor response does not
establish a whole-test weakness. The same v4 minor-slip and smooth-recovery rules
apply. Too little evidence withholds an overall estimate. This is a holistic
speaking-delivery practice estimate, not a calibrated Pearson score prediction;
content accuracy is reported per question. Azure remains an independent acoustic
comparison per question: no fabricated Azure /90 is made by averaging its marks.

Background assessment is bounded to two mocks, with two item workers per mock.
The independent overall review can finish before item feedback. Database leases
and per-stage saves permit interrupted work to resume without repeating confirmed
assessments. Completed failures require an explicit retry; reads do not continually
consume paid calls. Recording and account data stay private, using the existing
session or authorized admin impersonation. The new `speaking_mock_attempts` store
is separate from individual speaking attempts; history queries omit recording data.

## Sources and validation

- Pearson speaking format: https://www.pearsonpte.com/pte-academic/test-format/speaking-writing/
- Current score guide: https://www.pearsonpte.com/content/dam/ELL/pte/pearsonpte/pdfs/pte-academic-pdfs/PTE-Academic-Test-Taker-Score-Guide.pdf
- Published screen: https://www.pearsonpte.com/content/dam/ELL/pte/pearsonpte/images/Make-good-use-of-the-40-seconds-speaking-time-min.png
- Reviewed 24 October 2026. Matching the published layout is an approximation of
  the exam interface; this portal is independent of Pearson.

Tests use simulated providers and isolated storage. They cover the complete paper,
verified reused audio, hidden future prompts, private account ownership, locked and
idempotent recordings, server clocks, protected-screen cancellation, recording upload
recovery, both providers, and the blind overall scoring boundary. These tests do
not establish empirical agreement with Pearson's scoring.
