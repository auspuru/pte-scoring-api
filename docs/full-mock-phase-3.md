# Full Mock 1 — Phase 3 continuous player

Phase 3 connects the frozen paper to a continuous exam player and durable,
account-owned attempts. It remains an **authorised development preview**. The
v1 paper and its 41 media assets are unchanged. Assessment, score estimates and
feedback reports are not enabled in this phase.

## Opening a preview

An administrator, or an existing authenticated admin impersonation session, can
open **Mock Tests → Full Mock · Preview** or `#/full-mock`. Ordinary students
receive an unavailable catalogue and cannot create, read or resume draft previews.
Permission and ownership are checked on every request, including media and recovery.

The equipment check requests microphone permission from a button, records a
three-second local sample, displays input level and requires playback confirmation.
The sample is never uploaded. Device storage must work before starting. Begin and
Continue also unlock prompt playback from a user gesture.

All 22 task forms are supported: typed/selected blanks, word-bank drag/drop with
select fallback, paragraph drag/drop with arrow buttons, radio/checkbox choices
and word highlighting. Images retain their 730×500 ratio. Narrow layouts use the
same tasks without requiring desktop fullscreen.

## Time and progression

`full-mock/session.js` owns the state machine. The browser receives absolute
server timestamps and displays remaining time using a monotonic clock.

| Stage | Clock |
| --- | --- |
| Introduction | 25-second preparation, cue, 30-second unscored response |
| Speaking | Frozen prompt, task preparation/cue and response window |
| ASQ | No tone; ten seconds immediately after the prompt |
| SWT / Essay | Per-item duration from the paper |
| Reading | Shared 25 minutes across 15 items |
| SST | Ten minutes including playback |
| Remaining Listening | Shared 25 minutes across the remaining items |

There is no invented overall countdown. Prompt playback seeks to its elapsed
position after loading or refresh; expired audio cannot restart. Blocked playback
exposes a resume button and records an interruption without pausing the clock.
Microphone reconnect uses a separate codec container. Silence termination applies
only where the frozen task specifies a timeout; ASQ has no start tone.

Next seals a response once. Repeating a lost-reply Next cannot advance twice.
Later draft saves cannot replace a submitted answer. Preparation-time skips do
not discard recorded audio. Reads/mutations reconcile expired deadlines, and a
ten-second server sweep advances overdue attempts without an open browser.
Subsequent windows start at the preceding deadline, so absence cannot reset a
section or grant more time. A long disconnect can submit the entire paper.

One page controls an attempt. Hashed control/recovery secrets allow refresh
handoff and reject stale-tab mutations. The recovery secret is stored before the
claim request, so a lost acknowledgement can reconnect immediately. A replaced
player stops capture/playback on its next pulse. Buffered packets retain their
original account and question ownership.

## Saving and recovery

`full-mock/store.js` uses dedicated PostgreSQL tables or private atomic revision
files. Both enforce ownership and optimistic updates. Concurrent starts resume
one active attempt per account. Each attempt retains the complete paper, digest
and session version. Existing sectional attempts are not migrated.

Draft revisions are monotonic; conflicting same-revision writes are rejected.
IndexedDB stores account-prefixed drafts and audio packets before upload/retry.
Next explicitly acknowledges the newest written revision even when an older save
is in flight. If device storage fills during the attempt, the player retains
pending data in memory and tells the user to keep the tab open. Closing it before
server acknowledgement cannot preserve memory-only data.

Recording blobs split into chunks of at most 256 KiB. Segments have stable IDs,
secrets, immutable hashes and an explicit final chunk count. Quota is reserved
before writing bytes; finalisation requires every chunk to be stored. Limits are
512 KiB per HTTP chunk, 12 MiB per segment, 96 MiB per attempt, 256 chunks per
segment and five segments per item. Empty preparation segments can finish without
inventing a response. Completed packets are removed only after acknowledgement.

Each speaking item supplies its first recording permit in advance, allowing
offline declarations to recover. Upload recovery closes 24 hours after the
original deadline. Late activation/chunks are marked **needs-review**, with no
clock extension. Late text is separate recovered evidence and never replaces a
sealed answer. Failed packets remain retained while unrelated saves continue.

The submitted screen is a receipt with pending upload counts/retry controls. It
does not display keys, transcripts, feedback or fabricated scores. Pending saves
continue to retry while the receipt stays open.

## API and integration

All routes live under `/api/full-mocks`, use existing account authentication and
return `no-store`. Catalogue/history contain metadata only. The current-question
projection omits keys, rubric references, samples, audio transcripts, future
questions, paths and control secrets. Only the owner can load current media, and
audio becomes unavailable after its playback window.

Routes cover create/resume/claim/pulse/draft/next/recover, segment declaration,
chunk upload/finalisation, protected media, interruption events and explicit early
submission. Events have no automatic grading penalty. Client score/role fields
cannot set results or authorise previews.

The portal lazily loads the player and releases media on navigation/account
change. Changed assets have content-hash cache keys. Startup initialises the
store/sweep and shutdown stops the sweep. The current scoring-source lock records
the server integration; the paper retains its historical freeze-time fingerprints.
Validate v1 instead of refreezing it against changed sources. Content edits need
a new explicit paper version.

The branch also integrates main's essay-provider update from
`fbbbd390cb69b9f2b06c725d6dffb4001ec1a808`. The current audit pins its two new
provider/format modules as well as the changed server and essay schema. This
prevents the PR merge checks from testing stale source fingerprints. The frozen
paper's historical fingerprints are not rewritten.

## Verification and remaining phases

```sh
node --test tests/full-mock-session.test.js tests/full-mock-api.test.js tests/full-mock-client.test.js
node scripts/verify-release.js
npm run validate:full-mock-1
```

Focused regressions use real HTTP routes, DOM controls and IndexedDB transactions.
They cover all 66 items/22 task forms, isolation, concurrent starts/updates,
deadline expiry, restart, claim handoff/lost replies, ordered drafts, sealed
answers, offline recovery, bounded immutable uploads, storage quota failures,
slow playback, microphone reconnect and skipped preparation. Capture hardware,
audio devices and browser scheduling are substituted in these tests.

Human listening and independent editorial clearance remain pending. Phase 4 must
attach concrete assessment/model versions, assess eligible saved responses and
implement the five independently verified weighting profiles with completeness
rules. Phase 5 adds reports/feedback. Phase 6 covers real desktop/mobile hardware,
autoplay, long sessions and independent calibration before student release. This
phase does not authorise release or claim hardware QA.

Phase 4's assessment adapters, durable worker, protected aggregates and explicit
practice-index limitations are documented in `docs/full-mock-phase-4.md`.
