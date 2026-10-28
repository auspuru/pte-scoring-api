# Full Mock 1 — Phase 2 frozen draft

Full Mock 1 now has a frozen server-side paper containing **65 scored questions
across all 22 types**, plus an unscored introduction. It follows the Phase 1
35/15/15 blueprint and question order. No student-facing full exam is enabled by
this phase; its continuous player is Phase 3.

The snapshot is `content/full-mock/papers/full-mock-1.v1.json`, created on
29 October 2026. Its digest is recorded in the adjacent catalogue. The paper
contains complete references and answer keys, and must remain outside `public/`.
The current draft has 49 newly authored items and 16 repository-declared original
speaking items. User prediction content is not selected for this paper.

## What is implemented

- Five original ASQ questions with explicit accepted variants, fixed question
  recordings, a 10-second response limit, and no recording-start tone.
- An ASQ assessment adapter that accepts the existing transcriber as an injected
  dependency, passes only the student's recording to it, and marks complete short
  answers for Listening. It does not assess pronunciation or oral fluency.
- New Reading, Writing and Listening content with reference answers and task
  instructions. Cloze options and choice positions are frozen in varied orders;
  reorder boxes use opaque IDs rather than alphabetic answer-position labels.
- Thirty locally generated neural recordings plus six reused fixed recordings
  for RL, SGD and RTS. All 36 match their transcript hashes and published task
  duration bounds, decode successfully, and have independently probed durations.
- Two SGD recordings with three distinct recorded voices and matching speaker
  turns. These are copied into the paper's own asset set.
- Five original vector visuals: a bar chart, pie chart, line chart, table and
  process. They were rendered at 730×500 and visually inspected against the
  reference facts; labels and quantities are legible.
- Forty-one assets stored by content hash under `content/full-mock/assets/`.
  The snapshot does not depend on mutable legacy audio paths or runtime narration.
- Immutable file writes, digest validation, safe player projections, and explicit
  draft guards that prevent creating a student attempt from the draft.

## Readiness and review status

The version is **`frozen-draft`**, not a student release. Structural, answer-key
coordinate, media-integrity, source-provenance and assistant visual checks pass.
Semantic references and explanations were reviewed during AI-assisted authoring.
No independent human review or listening pass is claimed. Both remain recorded as
pending in the snapshot, and `studentReleaseApproved` is false.

Difficulty labels are editorial, not empirically calibrated. The draft includes
easy, medium and hard labels overall; Listening items currently carry medium
labels. The later content review and calibration should evaluate whether the
Listening difficulty distribution needs revision. Labels never change marks.

The speaking/writing clock is per item, with limits recorded in the snapshot.
Reading has a shared 25-minute clock. SST has its own 10 minutes including audio;
the remaining Listening tasks share 25 minutes. There is no invented global
two-hour cutoff. Actual completion time depends on item and transition behaviour;
Pearson's published section ranges remain reference information in the blueprint.

Overall/skill weighting and score reporting are Phase 4/5. A pending or failed ASQ
transcription returns `status: unassessed` and `total: null`, retaining its maximum
mark. Only an explicit unanswered submission is immediately scored zero; an empty
or failed transcription is preserved for retry or review.

## Local narration provenance

An external narration request was blocked by automatic approval review because
it would transmit unpublished prompts to a third-party service. The final new
recordings were generated entirely locally with **Piper 1.3.0** and the
`en_US-ljspeech-high` voice. The generation script contains no network client;
ONNX Runtime telemetry is disabled. It never sends prompts to a speech service.

The model was downloaded as public weights, without sending any question text.
Its revision, model/config digests and primary model-card link are recorded in
`content/full-mock/voice-model-source.json`. The publisher's model card identifies
the LJ Speech dataset as public domain. The model weights and Python environment
are authoring tools and are not committed or deployed with the portal.

The existing six RL/SGD/RTS recordings retain their verified source metadata.
The new SMW recording contains a real 1 kHz end cue; its missing answer is never
spoken. The new recordings are normalised to -18 LUFS / -1.5 dBTP and encoded as
mono MP3. A human listening review is still needed before release.

## Commands

```sh
# Validate the already frozen paper and probe/decode every recording:
npm run validate:full-mock-1

# Authoring at the pinned Phase 2 source revision (identical inputs are a no-op):
npm run freeze:full-mock-1

# Focused regressions:
node --test tests/full-mock-audit.test.js tests/full-mock-asq.test.js tests/full-mock-paper.test.js

# Existing legacy sectional-pool audit, a different scope:
npm run audit:full-mock
```

`validate:full-mock` still checks reviewed coverage in the original sectional
inventory. That pool has no ASQ items and pending editorial records; it is not the
validator for this separately authored paper. Use `validate:full-mock-1` for the
frozen draft. Its validation is included in the production build.

To reproduce local narration, create a separate authoring environment from
`scripts/requirements-full-mock-tts.txt`. Download the exact public voice
model/config revision in `voice-model-source.json` to
`.cache/full-mock-piper-voices/` with its `provenance.json`, then run
`scripts/generate-full-mock-audio.py` with that environment's Python. The script
refuses to replace an existing verified recording with different text. Similarly,
`scripts/generate-full-mock-visuals.js` creates the pinned vectors. Neither runs
during a student's test or as part of a production installation.

## Snapshot and API contracts for Phase 3

`full-mock/paper.js` loads JSON and pinned media, independently of the current
authoring bank. A later authoring edit cannot change a saved paper. File content
or media drift causes an error; existing frozen files cannot be overwritten.
Create an explicitly new version when changing paper content.

`questionForPlayer` is an allowlist: it omits keys, rubric references, audio
transcripts, sample answers, provenance and filesystem paths. DI and audio use
opaque asset handles for the Phase 3 authenticated asset route to resolve. Reading
passages and the RA/RTS/SWT/Essay prompt text remain visible as required by the task.
The safe catalogue contains metadata only and declares the draft unavailable.

`snapshotForAttempt` refuses this unreleased draft unless the caller explicitly
requests a development preview. A preview is labelled accordingly and captures
concrete model/provider names plus the current scoring-source fingerprints. An
attempt must never store credentials. Phase 3 must enforce user ownership,
question progression and authoritative timing before serving media or projections.
Phase 4 must enforce the saved assessment version and completeness contract.

The scoring source lock was deliberately extended for the new ASQ adapter and
the existing transcription entry point. The snapshot retains its own freeze-time
source fingerprints; no saved sectional answer or legacy task rubric was altered.

Phase 3's player and durable-session contract is documented in
`docs/full-mock-phase-3.md`. Its preview has assessment disabled, so it does not
select model providers or make grading calls. The current server integration
changes the current source lock; the historical v1 paper remains immutable. Use
the paper validator on this branch rather than attempting to refreeze v1 against
changed source fingerprints.

## Validation

Focused regressions cover the 65-question order/counts, duplicate prevention,
ASQ variants and pending failures, hidden keys/transcripts, immutable snapshots,
tampering and missing assets, source-independent saved papers, draft release
guards, and a measured 1 kHz SMW cue. Media validation probes and decodes all 36
recordings. The ordinary test suite, calibration checks and build remain required.

Primary technical references:

- [Piper Python API](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/API_PYTHON.md).
- [Voice model card](https://huggingface.co/rhasspy/piper-voices/blob/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/en/en_US/ljspeech/high/MODEL_CARD).
- [LJ Speech dataset](https://keithito.com/LJ-Speech-Dataset/).
- [Pearson Speaking & Writing format](https://www.pearsonpte.com/pte-academic/test-format/speaking-writing/).
- [Pearson Listening format](https://www.pearsonpte.com/pte-academic/test-format/listening/).
