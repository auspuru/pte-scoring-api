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
