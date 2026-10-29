# Full Mock 1 — Phase 5 reports, feedback and history

Phase 5 adds the submitted test report and saved-attempt history to the existing
Full Mock preview. All 65 scored responses have a question review, covering the
22 task types. The introduction remains unscored. Student release remains disabled.

## Report and interpretation

The report shows independently calculated Overall, Listening, Reading, Speaking
and Writing practice indices out of 90. It consumes the Phase 4 aggregator and
each attempt's saved profile versions and native maxima; it does not replace the
assessment engines or recalculate marks from client data. Overall remains a range
with no point estimate, preserving the three published `<1%` contributions.

The report prominently says **Provisional** and **Not yet calibrated**. These are
uncalibrated IPT practice indices, not official Pearson scores or predicted exam
results. The Overall range describes contribution-weight uncertainty, not an
exam-score confidence interval. Method details include the saved weighting,
practice-index and individual profile versions.

The whole report remains pending until every scored response has a verified
assessment. A skill index can appear when its own required assessments are
complete, while an affected index stays pending. Task rows retain native marks
and their actual denominators; they are never converted to individual `/90`
scores. Integrated-skill routes are shown without adding the task twice to Overall.

## Detailed review

Every submitted question shows its task, section, skill routes, instructions,
stimulus, sealed answer or recording, native criterion marks and available saved
feedback. Read Aloud / Repeat Sentence expose saved transcript differences;
speaking content exposes available coverage and exact evidence; writing exposes
criterion feedback, corrections and saved essay feedback issues. Generic practice
guidance is identified through its instructional wording rather than presented
as a newly generated diagnosis. Content/Form gates explain why all native marks
are zero instead of implying that delivery traits were separately assessed.
The adapter now retains the existing delivery assessor's descriptor, coaching
and diagnostic practice words. This feedback preservation does not change marks
or make another provider call. Earlier completed assessments remain readable.

The reference panel provides the applicable answer key, accepted ASQ responses,
listening reference/discussion transcript, explanatory notes, reference ideas and
teaching sample. These data never enter an active attempt's projection. An
automatic transcript is labelled as speech recognition and must be checked
against the recording; it is not described as student-confirmed wording.

Question selection, previous/next controls and task-row buttons make all 65
reviews directly accessible. Prompt audio, visuals and individual recording
containers load through authenticated fetches and local object URLs. Tokens are
never placed in media URLs. Playback uses browser controls and user gestures.
URLs are revoked and playback stopped when changing questions or leaving the
report. Leaving also clears the report DOM. Delayed replies cannot attach to
another item, report or account.

Late recovered text is explicitly separated from the scored timed response.
It does not replace the canonical answer or change its marks. Late/interrupted
audio is labelled for teacher review. Recordings still uploading, provider-stage
failure and assessment-version mismatch have distinct states. The retry button
requests incomplete assessment explicitly and preserves successful stages through
the existing worker. Polling never repeats a failed provider call automatically.

Improvement priorities rank only fully assessed task types by their native
fraction, taking up to three types that lost marks. They include a concrete
practice instruction and a route into the existing task practice. Pending tasks
are excluded from this ranking. ASQ links to the practice hub with a teacher-led
short-answer exercise because there is no standalone ASQ practice route yet.

## Saved attempts

The Full Mock hub lists real owned attempts in creation order, including the
section and scored progress of active exams, submission time/duration, assessment
coverage and provisional Overall range when available. Continue returns to the
authoritative running attempt. View report opens a submitted report without
requiring microphone or audio hardware. Finishing an exam opens its report in
place and releases the microphone. Pending device saves continue to upload;
successful recovery refreshes the report even after a previously complete result.

## API and data boundaries

- `GET /api/full-mocks/attempts`: bounded owned history with summary metadata,
  readiness and profile summaries. No answers, keys, transcripts or snapshots.
- `GET /api/full-mocks/attempts/:id/report`: submitted-only report and explicit
  allowlisted feedback/review fields, including immutable canonical answers.
- `GET /api/full-mocks/attempts/:id/review/:questionId/media/:asset`: only the
  selected submitted question's frozen audio/visual, verified against its hash.
- `GET /api/full-mocks/attempts/:id/review/:questionId/recordings/:segment`: only
  that question's finished recording segment; every byte, MIME, sequence, length
  and hash is checked against its saved manifest. Segments are served separately.
- The existing `/results` endpoint retains its limited projection. Active-player
  media access still expires at the question deadline and closes on submission.

All endpoints retain account ownership, preview permissions, `no-store`, `nosniff`
and rate limiting. No provider payload, dispatch state, credential, internal asset
path or arbitrary nested metadata is returned. Text and feedback are escaped in
the renderer. Submitted media can be reviewed even if assessment is unavailable;
it does not become a grading input supplied by the browser.

Reports use verified saved marks without issuing new feedback/model calls.
The existing submission flow may queue not-yet-requested assessment, and newly
saved media may wake the existing worker; report reads do not regrade completed
compatible work. Old completed reports remain readable using their saved profiles.
New grading still requires the exact saved source/provider contract.

The current source lock includes the report projection. The immutable v1 paper,
all content assets and the historical freeze-time fingerprints are unchanged.

## Validation

```sh
node --test tests/full-mock-report.test.js tests/full-mock-client.test.js
node scripts/verify-release.js
```

Eleven new tests cover all task review projections, native feedback/gates, pending
indices, priorities, recovery evidence, historical profiles, integrity, ownership,
preview/submission gates, authenticated media association, byte corruption,
escaping, report navigation, offline recovery, explicit retry and stale responses.
They use real DOM parsing, HTTP and storage with injected assessment services.
No student data or paid provider calls are used.

Phase 6 still owns real desktop/mobile microphone/autoplay checks, live provider
validation, a PostgreSQL deployment smoke test, independent calibration and the
human editorial/listening clearance required before student release.

Phase 6 adds PostgreSQL/Chromium system verification, consented benchmark
comparison and evidence-bound readiness checks. See `docs/full-mock-phase-6.md`;
synthetic browser tests do not replace physical-device or live-provider review.
