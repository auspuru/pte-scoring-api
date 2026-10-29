# Full Mock 1 — Phase 6 validation and calibration evidence

Phase 6 adds executable validation of PostgreSQL persistence and the real browser
player, a consented benchmark comparison tool and a release-readiness report.
These tools do not enable student access or fit a new score conversion.

## Automated system verification

`scripts/verify-full-mock-systems.js` first runs the full existing release suite:
unit/regression tests, existing portal calibration checks and the production
build. It then runs four PostgreSQL system tests and two Chromium journeys.
A failure stops the run and cannot leave a previously passed evidence file at
the requested output path. Passing evidence includes the exact frozen paper and
runtime hashes. CI uploads this redacted evidence as `full-mock-validation`.

The CI PostgreSQL 16 service is disposable. Tests accept only the explicitly
named `full_mock_test` database/user on a loopback address. They never fall back
to `DATABASE_URL`, `PGURL`, Railway or a student database. Each case gets its own
random schema and cleans up only that schema. The release environment removes
provider/mail credentials and production storage configuration.

PostgreSQL cases exercise:

- Concurrent schema initialisation, competing attempt creation, one active
  attempt per user and cross-account isolation.
- Racing revisions, newest-draft persistence, immutable sealed answers, separate
  late recovered text, shared Reading deadlines and fresh connection pools.
- Exact BYTEA audio persistence, idempotent chunk retries, replacement rejection
  and owned retrieval across connections.
- Two independent assessment workers, one durable lease, explicit failed-provider
  retry and restart recovery without rescoring successful items.

Startup schema creation now takes a transaction-scoped advisory lock on its
dedicated connection. Concurrent processes cannot race their initial table/index
creation. A failed initialisation rolls back and releases the connection before
retry; ordinary attempt updates retain the existing revision checks.
The PostgreSQL store also works without a filesystem directory; UUID validation
does not construct a disk path when the selected backend is PostgreSQL.

The real browser run also exposed recording preparation restarting while a
Next/Skip request was in flight. Preparation and recording now stay stopped until
navigation finishes. A regression test holds the server acknowledgement while
ticks continue and rejects any new declaration for the sealed question. This
prevents stale recording retries from exhausting the existing request limit.

Both browser cases use the actual Full Mock client, report, styles, exam-mode
controller, authenticated HTTP API, IndexedDB, MediaRecorder and PostgreSQL store.
One uses a desktop viewport and one a 390×844 touch/mobile viewport. Chrome's
sandbox stays enabled. No autoplay override is used. Permission automation and
a bundled original voice recording provide a synthetic microphone input; these
are not physical-device tests. Requests outside the local fixture are blocked.

Each browser journey checks the equipment sample and playback, introduction,
all 65 questions / 22 task forms, native recording/chunk upload, prompt playback,
start cues, forward navigation, Reading/Listening shared deadlines, submitted
indices, all 65 reviews, protected image/prompt/recording loading and saved-report
reopening. The desktop journey also types offline, verifies IndexedDB storage,
refreshes/reconnects and checks the exact answer and original deadline. It checks
for page errors and page-level horizontal overflow in both viewports.

Objective marks use the existing native scorers. Paid speaking/writing services
are injected in system tests; these tests cannot establish provider quality or
real-world scoring accuracy. The original suite continues to cover provider
failures, uncertain dispatches, rubric gates and real codec decoding.

```sh
FULL_MOCK_TEST_DATABASE_URL=postgresql://full_mock_test:full_mock_test@127.0.0.1:5432/full_mock_test \
FULL_MOCK_TEST_CHROME_PATH=/usr/bin/google-chrome \
node scripts/verify-full-mock-systems.js --evidence-out .cache/full-mock-validation.json
```

The Chrome path can be omitted on a non-root development machine with Puppeteer's
configured browser and a working sandbox. The managed local environment has not
been used to bypass browser sandbox restrictions. CI runs the actual browser
and PostgreSQL cases; DOM-only tests are not substituted for these checks.

## Benchmarks and interpretation

`content/full-mock/benchmark-template.json` contains an empty cohort. There is no
consented paired Full Mock 1 / official-practice dataset in this implementation.
An empty cohort produces `no-data` and null error metrics, not zero error.

The comparison input contains only hashed participant/consent/evidence references,
official score numbers and the minimal saved practice-profile data. It requires:

- Explicit consent scope `full-mock-validation` and a consent reference hash.
- An independently obtained Pearson Scored Practice source declaration and its
  evidence hash. A hash alone does not verify the source or grant consent.
- One comparison per participant, unique practice attempt and unique official
  evidence. Repeated attempts cannot inflate the independent sample count.
- Complete practice profiles, matching paper/profile/index-policy versions and
  the same saved assessment snapshot across the cohort. Set the cohort's
  `assessmentSnapshotHash` from those saved reports before adding records.
- The saved Overall range with a null point index. For each of the four skills,
  copy its point index and version and set the comparison's `practiceIndexRange`
  to null. No transcripts, names, recordings or feedback belong in this input.

The output contains aggregate bias, MAE and RMSE for each skill. Overall retains
bias/absolute-error/RMSE bounds; it never invents a midpoint. Each profile is also
grouped by its official score into analysis bands 10–29, 30–49, 50–64, 65–78 and
79–90. Empty bands retain null metrics. These are analysis bins, not proficiency
claims, visa thresholds or new scoring rules.

```sh
node scripts/compare-full-mock-benchmarks.js
node scripts/compare-full-mock-benchmarks.js /private/consented-anonymous-cohort.json
```

Output remains `descriptive-only`, `calibrated:false` and
`conversionEnabled:false` for any cohort size. Separate practice forms differ
in items and performance; source verification, score-band coverage, independent
review and held-out validation are still needed before any calibrated conversion
could be proposed. No regression fit, difficulty adjustment or Pearson-score
claim is enabled by this script. Participant identifiers are omitted from output.

## Real-device, provider and editorial review

Generate a fresh evidence template for the exact tested runtime:

```sh
node scripts/check-full-mock-release.js --template > .cache/full-mock-manual.json
```

The four manual checks remain **pending**. For a passed row, retain the runtime
hash, fill `checkedAt` with the actual ISO timestamp, `reviewedBy` with the actual
reviewer and `evidenceRef` with the review record. Future dates, missing reviewers,
missing evidence references and stale runtime/paper hashes cannot pass.

| Check | Evidence required |
| --- | --- |
| Desktop real microphone | A real desktop browser, physical microphone/headphones, audible local sample, automatic prompt/cue playback, full response recording, permission-denied/reconnect, refresh and offline recovery, submitted playback and account isolation |
| Mobile real microphone | Physical supported mobile browser/device; repeat audio, touch input, interruptions/backgrounding, recovery and submitted review. Chromium touch emulation does not prove Android/iOS hardware or Safari support |
| Live provider contracts | The exact preview branch, existing server-side configured providers, recorded speech plus difficult DI/RL/SGD/RTS and SWT/Essay/SST cases, independent content/delivery traits, failure/retry handling and teacher review of the saved native feedback |
| Independent editorial/listening | A human independently checks all 65 instructions/keys/references, five visuals, all 36 recordings, three-speaker SGD identities, SMW cue and acoustic clarity against the immutable paper |

As of 29 October 2026, read-only Railway metadata identifies production
`swt.up.railway.app` as `auspuru/pte-scoring-api` from `main`. It is not evidence
that this draft branch's Full Mock contracts have been tested live. Provider
variable names being present is not proof of successful provider requests. No
production deployment, account, stored attempt, setting or credential is changed
by this validation work. A suitably isolated preview is needed for that step.

## Release gate

```sh
node scripts/check-full-mock-release.js --automated .cache/full-mock-validation.json
node scripts/check-full-mock-release.js --automated .cache/full-mock-validation.json \
  --manual .cache/full-mock-manual.json --release
```

The first command reports status. `--release` exits nonzero unless all required
evidence is current and the paper is an explicitly released, editorially approved
snapshot. Even a complete checklist cannot turn the frozen v1 draft into a student
release. It remains immutable; any future release requires a separately authorised
paper/version and the corresponding verified evidence. The checker never writes
release flags or deploys anything. Calibration stays disabled independently.

The current automated implementation is reviewable in the draft PR. Physical
device tests, live-provider/teacher review, independent listening/editorial
clearance and consented empirical calibration must not be represented as done
by synthetic tests or this evidence framework.
