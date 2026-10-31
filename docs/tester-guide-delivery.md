# Tester guide implementation and acceptance

Guide: PTE_Scoring_API_Tester_Guide.pdf, 30 October 2026, 261 checks.
Implementation baseline: b92c5ba935fa41755d2211991dd2d3755c274b01.

The guide is the acceptance scope. It is not a list of 261 missing features. Existing functionality must be exercised against its individual requirements. `tester-guide-acceptance.json` retains every acceptance ID and requirement, with related suites to help execute it. Suite coverage does not silently turn a complete acceptance scenario into a Pass.

## Implemented gaps

- NAV-05: Reading and Listening capture the selected ordered question queue. Next and Previous stay in that queue, including one-item boundaries, and preserve drafts.
- NAV-06: Reading retains query, page, selected row and scroll; Listening retains search, status, page, mode and selected question; Essay keeps picker search, selection and scroll while moving and returning.
- NAV-07: Listening status badges and filters use the matching question and mode. Legacy attempts without a mode belong to exam-style, rather than supported Practice.
- NAV-08: Speaking and Listening use a session-scoped latest-attempt index during adjacent moves, update it from successful saves, and reject responses after a session change. Opening history explicitly refreshes the index.
- NAV-09: Question links contain stable question/attempt IDs and mode. Browser history restores changes within the same task. Copied links without an available attempt show a question choice without starting a recording, attempt or assessment. Saved context belongs to that browser-history entry.
- NAV-10: Earlier HCS/HIW keep their original identities, use Listening headings and task navigation, and offer a return to the current source. Current-source choices link to the earlier source explicitly. Existing saved work is not migrated between engines.
- NAV-11/12: Question changes focus a meaningful heading. Practice navigation moves above long passages and feedback into a compact sticky dock, with 44px controls, wrapping and separate mock restrictions.
- DI-06: New standalone DI assessments use the same pinned Visual Academy content adapter and validation contract as mocks. Confirmed historical content remains reusable. An unverified Academy result is unavailable/provisional and can be retried without replacing independent delivery evidence.

- MOCK-06: Writing and Listening sectional Next and final submission no longer show routine confirmation dialogs. Double-clicks share one save.
- NAV-16: Queued Writing saves retain their original session identity and cannot dispatch under a replacement session or overwrite its save status.

## Verification

New regressions cover filtered Reading queues, the Listening queue 8/18/28, draft restoration, mode-specific badges, cached adjacent history, copied links, same-task Back/Forward and standalone/mock DI parity. The browser system suite adds the real Listening client at 1363px, 390px and 320px, using disposable accounts and injected services.

Full Mock compatibility permits only the exact reviewed source revisions. Tests verify the unchanged native Reading scorer and transcription function, retained saved provider configuration and previous assessment snapshots. No existing student attempt is bulk reassessed.

Release evidence must include the full regression suite, offline calibration, production build, content/media validation and the GitHub CI database/browser system run. Browser and PostgreSQL system checks cannot run in this executor because the required browser download and database installation are unavailable; they remain required in CI. The local managed preview also failed to become healthy. These limits are not passed device or browser tests.

## Remaining acceptance work

Every complete guide scenario still needs its own environment, steps, actual result and evidence in the register. Physical desktop/iPhone/Android microphones and headset playback, screen readers, mobile keyboards, independent listening/editorial review, live provider behaviour, realistic classroom latency/load require separate execution where the appropriate equipment and isolated services are available. Automated synthetic audio and width checks do not establish physical-device support or Pearson calibration.

Do not describe the entire guide as complete until its acceptance evidence has been recorded. Keep unavailable, failed, skipped and excluded answers distinct throughout testing.

## Account access and recovery batch

Base: 762c6c1ba1949320c118b5530b3567ace8e927ac, 31 October 2026.

Confirmed failures were reproduced before changing the code: reusable reset links, malformed signatures producing server errors, blocked accounts still accessing profile sync, and duplicate boot sign-in requests. Registration now validates bounded fields and uses an atomic PostgreSQL creation transaction. Blocking/deleting invalidates account caches; private API handlers and direct media requests check active account state. A token issued before a username was recreated is denied.

Reset links expire after 15 minutes and are bound to the current salted credential hash. Completion uses an atomic comparison in PostgreSQL and serialized file-backed writes, so concurrent completions have one winner. Password changes and admin resets invalidate earlier recovery links. Reset URLs use the configured public origin, and request notices do not claim successful delivery. SMTP is replaced by a local outbox in acceptance tests; production mail delivery has not been tested.

Session policy: changing or resetting a password preserves existing signed sessions until their original 30-day expiry. Signing out clears this browser's credentials and invalidates pending sign-in callbacks. Blocking/deletion denies existing sessions immediately in this service process. Session revocation across multiple independently cached service processes is bounded by the five-second account cache; deployment topology was not changed.

The register records scoped automated Pass results for AUTH-01/02/05/06, conditional on the required Portal CI run passing before release. AUTH-03/04/07/08 retain Not run for their complete scenarios and include the subcases already verified plus their remaining coverage. API tests run the real server against disposable storage and a local mail sink. The PostgreSQL version uses an isolated schema; browser tests exercise the built production client. No student data, live mail, or paid scoring providers are used. Exact Full Mock source compatibility tests retain the previous snapshot and all successful marks without reassessment.
