# Portal responsiveness

Production investigation on 21 October 2026 found low resource utilisation (peak CPU about 0.05 against an eight-CPU limit and peak memory below 0.5 GB), while background profile saves uploaded up to 403 KB and some requests took about 2.7 seconds. The app runs in `us-west2`; network distance remains relevant to Brisbane users. This change does not move the service, database or persistent volume.

## Verified causes and changes

1. Account equality compared `JSON.stringify` output. PostgreSQL JSONB and browser objects can contain identical fields in different orders, so normalized local records repeatedly appeared changed. Equality now compares JSON object contents without depending on key order, while preserving array order, deleted fields and changed values. In the reproduction, an unchanged 88,311-byte profile generated an 87,833-byte delta before the fix and `{}` (two bytes, no POST) afterwards. One genuine paragraph edit still sends its single essay.
2. Cloud pulls and save acknowledgements rebuilt editors, histories and dashboard widgets even when nothing changed. Reconciliation now renders only affected progress fields, skips unchanged history redraws and leaves hidden dashboard/resume widgets idle. Actual account updates, reading answers, current drafts and deletion clocks still merge.
3. Dashboard resume and catalogue progress could request the same attempt list concurrently. They now share an authenticated, session-scoped in-flight request and a ten-second metadata cache. Account/token changes reject late private results, failures remain retryable and completed-attempt events invalidate caches.
4. Catalogue metadata reads were serial. Independent catalogue, speaking-history and writing-history reads now overlap. Reading dependency downloads overlap while retaining ordered script execution; the practice client starts only after all dependencies succeed. Optional public display configuration no longer blocks login.

## Verification

Regression tests cover JSONB key order, one-record deltas, answer order/deletions, unchanged refreshes, remote draft merges, concurrent request coalescing, failed reads, session switches, cache expiry, hidden widgets, dependency loading and slow optional configuration. Fifty simultaneous catalogue/resume calls issue three shared API requests in the controlled regression test. These are controlled checks, not a measured guarantee for every student's browser.

All 844 automated tests pass locally. The full production release workflow, including media/browser checks, is required before merge. No production accounts or student progress were modified during investigation.

## 27 October 2026 follow-up

The live service still had ample spare capacity (four-hour peak CPU 0.067 against an eight-CPU limit; memory below 0.83 GB). Recent sync logs showed 1.5–5.2-second saves and one 15-second request. Three no-op draft saves on the authorised `pppp` test account had a median round-trip time of 8,979 ms; its full profile response was 1,694,200 bytes. No draft text was replaced during that measurement.

The compact Postgres save path now projects only the domains required for the incoming merge. A draft-only save reads `essayDraft`, `attempted` and `stats`, keeping unrelated Reading, SWT and essay histories in the database. Merge dependencies remain grouped, and the existing whole-row `xmin` compare-and-swap still retries concurrent edits before applying a top-level JSONB patch. Legacy full-profile callers retain their original response contract.

Progress reads expose a private account revision. Conditional background reads return 304 without transferring the stored JSON when that revision is unchanged. The client scopes the revision to both username and session token, skips history parsing and rendering after a 304, and defers automatic pulls while an input is focused. Explicit history refreshes still run. Authentication occurs before every conditional read; no shared response cache is introduced.

SWT, scratch-pad, essay-draft and Reading editors mark recovery records they have already saved locally. Queuing their cloud save no longer scans and rewrites every other practice area. Library edits checkpoint just the library and vocabulary fields; the debounced cloud flush still captures and merges all progress. Local checkpoints, offline retries, exit saves and cross-device field clocks remain in place.

A controlled Node reproduction with the actual SWT input handler, a synthetic 276,765-byte account and 100 input events reduced total handler work from 15,129 ms to 4 ms and local-storage writes from 29,886,000 to 32,250 bytes. This isolates synchronous JavaScript/storage work; it is not a browser input-latency or student-network guarantee. Regression checks cover projected/full merge parity, untouched history preservation, concurrent updates, no-op saves, conditional revisions, session isolation and local draft recovery.
