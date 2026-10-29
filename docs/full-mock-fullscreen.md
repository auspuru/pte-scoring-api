# Full Mock access and fullscreen navigation

On 29 October 2026 the user authorised access for everyone and requested the
product name **Full Mock**, direct Next navigation, and fullscreen testing.

The main portal uses `FULL_MOCK_PREVIEW_ALL=true` with an empty
`FULL_MOCK_PREVIEW_USERS` list. Every signed-in, existing, unblocked account may
start the full test. Sign-in, blocked-account checks and ownership protections
remain mandatory. The all-user flag is explicit and defaults off on services
where it has not been configured. The read-only deployment check verifies the
accounts table without retrieving the account list or credentials.

The catalogue, test header and report say **Full Mock**. The obsolete Coming
later placeholder and visible Preview badges are removed. Internal saved-paper
and attempt metadata retains its existing version and flags; no immutable paper
or historical report is rewritten to manufacture editorial or calibration
clearance. Scores remain uncalibrated practice estimates.

Begin and Continue request native browser fullscreen directly from the click,
using the existing protected-exam controller. New attempts start their server
clock only after fullscreen succeeds. A cancelled or rejected request does not
start a new attempt; a browser that requires another fullscreen click shows the
existing entry control. An active test keeps fullscreen across all questions.
Leaving fullscreen locks question input and stops prompt playback/recording
until the user returns. The server clock continues and never resets on return
or refresh. Submitted reports release fullscreen and need no microphone access.

Next, Skip and the last question's Submit test advance without a JavaScript
confirmation. The current response still saves before the server seals it;
double clicks cannot advance twice. The button shows Saving while awaiting the
acknowledgement and the next question opens at the top. Explicitly ending the
entire test early remains a separate action.

## Existing attempts

The access and fullscreen changes do not alter native grading. The assessor
accepts the exact audited scoring-source baseline from the previous main
deployment `c4a6ea782d3dd0a7713ecd35dd531c7368c4b201` for existing attempts.
Only the access module, API event allowlist and assessment compatibility logic
may differ. Every native grader source, model, rubric, weighting and paper must
still match. The pinned baseline is hash-verified. Existing attempts retain
their original snapshot and successful item grades; explicit retries process
only incomplete work. Corrupted baselines or changed native sources/models
still fail validation. This exception does not permit future rubric changes
under an old assessment version.

Unit/API tests cover all-user access, blocked/anonymous rejection, ownership,
popup-free Next/final submission, duplicate clicks, fullscreen cancellation,
and compatible recovery without rescoring successful items. Actual Chromium
desktop/mobile journeys verify fullscreen, all 65 questions / 22 task forms,
zero native dialogs during navigation, labels, saved reports and fullscreen
exit. The desktop journey also checks an explicit fullscreen exit/return and
offline refresh recovery without changing the deadline. Browser CI uses the
Chrome sandbox, a synthetic microphone and disposable PostgreSQL; provider
contracts and physical-device review remain distinct evidence.
