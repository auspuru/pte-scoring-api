# Full Mock 1 — Phase 4 assessment and aggregation

Phase 4 connects the frozen paper to existing native assessment services, saves
versioned assessment stages and calculates five independent provisional practice
profiles. The paper remains an authorised preview; editorial clearance and real
device validation are still pending. Phase 5 owns the detailed feedback/report UI.

## Native assessment contracts

| Tasks | Reused assessment |
| --- | --- |
| Reading blanks, choices, reorder | Portal Reading scorer; native blank points, zero-floor penalties and adjacent pairs |
| Listening objective tasks | `listening-scoring.js`; task-specific key matching and penalties |
| WFD | Existing sequence/spelling dictation scorer |
| ASQ | Existing accepted-answer adapter; recording-only transcription, Listening contribution only |
| RA / RS | Existing word/alignment content scoring and independent Azure delivery traits |
| DI | Visual Academy content policy and evidence validators; independent Azure delivery |
| RL / SGD / RTS | Existing meaning/communication content policies and independent Azure delivery |
| SWT | Shared reviewed SWT judgment and native scoring policy |
| Essay | Shared configured essay grader, including its provider choice, review and evidence checks |
| SST | Existing summary/form/language assessor |

The introduction is excluded from assessment and every denominator. Confirmed
Content/Form gates produce zero across the native task. Blank written responses
and explicitly skipped/early-finished unanswered speaking items are accounted for
as zero. A missing, incomplete, undecodable or unverified recording is pending,
not an invented zero. Local semantic fallbacks and incomplete native traits do
not become confirmed marks. An empty transcription does not establish silence.

Existing server-side provider configuration is reused. No credential is included
in an attempt, report or log. The snapshot records concrete configured models,
review models, native maxima per question, source fingerprints, profile versions
and the immutable paper digest. Azure's acoustic model is explicitly recorded as
provider-managed rather than falsely presented as a pinned model snapshot.

## Five weighting profiles

Pearson's **Scoring Information for Teachers and Partners**, Table 1, page 5, was
retrieved from its download CDN and visually checked. The `pearsonpte.com` route
still resolves to an institution guide, so it is not used as the downloaded source.

- [Verified public document](https://downloads.ctfassets.net/yqwtwibiobs4/UK8K7chHjNJhW9paYHxBd/8e89376c8a2a1d2efee4e3c0ec8200ee/pte-scoring-info-for-partners-report.pdf)
- Downloaded PDF SHA-256: `0863ec05a098f7390a01206750a1220a3c3ecd6344fa211f66220007deda7f6e`.
- Checked: 29 October 2026. `full-mock/profiles.js` records the transcribed data,
  source metadata and distinct Overall/Listening/Reading/Speaking/Writing versions.

The published values are average task contributions. The implementation leaves
them intact, including skill columns whose displayed values sum to 101. It does
not edit a cell to force a displayed total of 100. Within a task type, all earned
native points are divided by all available native points across the frozen
questions; the task fraction is then weighted relative to that profile's listed
contributions. This is an explicit practice aggregation policy. Difficulty labels
never change marks, and sectional or holistic Speaking estimates are not imported.

Integrated task points route to both named skills, following the guide's
integrated-skills explanation. Overall takes one contribution per task type,
directly from its question marks; it is never an average of the four skill indices.
Any required incomplete assessment blocks its task fraction and affected profiles.
Unanswered questions retain their available points in the denominator.

Overall's Reading MCSA, HCS and Listening MCSA cells are published as `<1%`.
They remain inequalities, not zero or fabricated 0.5 values. The aggregator checks
all eight vertices of their bounded weight region to enclose every admissible
relative weighted fraction. Overall therefore returns a range and a null point
estimate even when all questions have been assessed.

## Meaning of the practice index

The independent IPT practice-index policy maps weighted native performance using
`10 + 80 × fraction`. This is a transparent **uncalibrated practice index**, not
Pearson's GSE conversion, an official score, or a predicted exam result. The
published contribution table does not establish Pearson's raw-to-scaled-score
algorithm. Difficulty parameters and calibration are unavailable.

Every aggregate includes `official: false`, `calibrated: false`, the weighting and
index-policy versions, readiness and missing-item coverage. The Overall range
describes only the three contribution inequalities; it is **not a confidence
interval for a student's real exam score**. The report UI must preserve these
labels and limitations. Independent reference calibration remains Phase 6 work.

## Durable worker and recovery

Submission queues assessment for new snapshot-bearing attempts. A previous
Phase 3 preview can explicitly request adoption of the current assessment
contract through the assessment endpoint. Already completed results are not
regraded by reads, retries or process restarts.

Workers use atomic leases and bounded concurrency: two active attempts per
process, two item workers per attempt. Transcription, content, delivery and
writing stages checkpoint independently. A dispatch is recorded before a paid
request; a crash leaving its outcome uncertain requires explicit retry. Known
provider failures are also not silently repeated by polling/recovery scans.
Successful stages survive retries, including one verified delivery trait when
its companion failed. The original response fingerprint binds every stage/result.

A ten-second sweep resumes persisted processing attempts after restart or lease
expiry. Shutdown stops taking new items, finishes current checkpoints, then
leaves remaining items recoverable. New durable media can wake a pending item
without repeating known failed provider requests. Changed inputs, profiles,
provider configuration or scorer versions cannot reuse incompatible results.
Historical completed reports use their saved profiles and native maxima.

## Recording integrity

The worker reads account-owned chunks, checks all lengths/hashes/MIME metadata,
decodes each codec container separately and constructs bounded mono 16 kHz WAV
audio. It does not concatenate raw MP4/WebM containers. Missing chunks remain
pending; corrupt bytes or excessive duration require review. Ogg input is decoded
to the same supported WAV format before transcription.
The decoder accepts only the listed audio/container formats and local file/pipe
protocols; uploaded playlists cannot make network requests.

Late recording evidence remains review-only. Multiple interrupted containers are
also review-only because Phase 3 manifests do not establish the exact pause
between recordings; reconstructing their bytes cannot justify inventing a fluency
assessment. All saved evidence is retained for a later review workflow.

## Protected API

- `POST /api/full-mocks/attempts/:id/assessment` starts/adopts assessment after
  submission. `{ "retry": true }` explicitly retries incomplete work.
- `GET /api/full-mocks/attempts/:id/results` returns submitted-only native totals,
  profile readiness and provisional aggregates, scoped to the owner.
- Attempt reads expose status/counts only. The receipt polls those counts and
  distinguishes queued, processing, complete, review and version-mismatch states.

Draft preview permissions are enforced for these routes too. A different user
cannot inspect or trigger an attempt. Submitted results redact the paper, keys,
transcripts, recordings, provider stages and rubric references. Incoming score or
assessment objects cannot set server marks. Responses are `no-store`.

## Validation and release state

```sh
node --test tests/full-mock-scoring.test.js tests/full-mock-assessment.test.js
node scripts/verify-release.js
```

Focused tests cover all 22 native contracts, the five profiles, penalties/partial
credit, native gates, missing/failed AI work, explicit retries, uncertain dispatch,
partial-trait retention, worker races/restart/shutdown, real codec decoding,
ownership, snapshot/source integrity and submitted-only result access. Provider
calls are injected; no student recording or paid live assessment is used in tests.

The current source lock includes the Phase 4 engine and the reused Visual Academy
dependencies. The frozen v1 paper and historical source fingerprints are unchanged.
Human editorial/listening review, live provider/device validation, PostgreSQL
deployment smoke checks and independent calibration still precede student release.
