# Speaking practice

Thirty original questions: five each of Read Aloud, Repeat Sentence, Describe Image,
Retell Lecture, Summarise Group Discussion and Respond to a Situation. Answer Short
Question is intentionally excluded. Everything opens within Practice → Speaking.

## Content and samples

Each attempt shows an individual sample after submission. RA and RS require the
original wording; the four extended-response tasks accept accurate alternatives.
DI uses exact SVG charts built from illustrative data, not generated bitmap charts.
All five samples start with the institute's preferred opening and the pie-chart
sample names every category and percentage.

Twenty checked-in MP3 prompt recordings avoid runtime synthesis dependencies:
RS is 3–9 seconds; RL is under 90 seconds; SGD is under 3 minutes with three distinct
synthetic voices; RTS reads the displayed situation. Prompt transcripts stay hidden
until submission for RS, RL and SGD.

## Assessment boundary

This is **independent practice feedback**, not Pearson's official scoring engine.
Content remains scored separately from delivery. No overall /90 score is generated.
When Azure Speech pronunciation assessment is configured, the saved recording can
also receive pronunciation and oral-fluency practice estimates on a 0–5 scale plus
0–100 acoustic detail. Those delivery scores come from the audio, never from the
confirmed transcript alone, and are labelled as practice estimates. Without Azure
configuration or during a provider outage, content feedback still completes and
delivery remains available for teacher review. Existing admin impersonation can
access a student's saved speaking attempts with its normal scope.

RA uses word edit distance: omissions, replacements and insertions each reduce
content credit; the maximum equals the reference word count. RS provides a /3
practice estimate for ordered word recovery. Filler pauses and leading/trailing
material are ignored; "almost nothing" is operationalised as 0–1 matched words.
These matching details are disclosed as approximations, not Pearson's algorithm.

DI, RL, SGD and RTS receive AI content feedback /6, using Pearson's current content
descriptors. It includes an explanation, strengths, actionable improvements and a
covered/partial/missing/inaccurate breakdown with literal student evidence. Poor
provider output fails visibly rather than displaying fabricated feedback.

## Recording, privacy and transcription

Selecting a question is the user action that starts the exam-style flow. The browser
requests microphone permission, audio prompts play automatically where required,
the preparation countdown runs automatically, and the microphone opens when the
countdown finishes. During preparation the only normal learner control is
**Skip preparation**. There is no manual Stop, upload, transcript editing or question
navigation during the timed attempt. Recording stops at the response limit, saves
under the authenticated attempt and proceeds automatically to assessment. Technical
failures expose only the recovery action needed for that failure. Leaving or hiding
the page releases capture. Response recordings have no public URL. Reattempting
creates a fresh UUID, preserving prior audio, words and feedback.

Automatic transcription uses the existing `OPENAI_API_KEY` if configured, with
`OPENAI_TRANSCRIPTION_MODEL` optionally overriding `gpt-4o-mini-transcribe`.
Before the learner selects a question, the catalogue discloses that the saved
recording is automatically processed for transcription and practice scoring when
those services are enabled. No reference answer is supplied to OpenAI transcription.
The exam-style attempt does not expose an editable transcript before scoring; the
transcript becomes available in the post-attempt review. Provider failures preserve
the saved recording and offer a technical assessment retry.

Optional delivery assessment uses Microsoft Azure Speech when both
`AZURE_SPEECH_KEY` and either `AZURE_SPEECH_ENDPOINT` or `AZURE_SPEECH_RESOURCE`
are configured. The UI discloses before submission that the saved recording will be
sent to Azure for pronunciation and oral-fluency practice feedback. Audio is converted
with ffmpeg to 16 kHz mono PCM WAV and split into segments of at most 28 seconds to
stay within the short-audio pronunciation-assessment limit. Each segment is assessed
with Comprehensive HundredMark pronunciation assessment and prosody enabled. The
confirmed transcript is used directly for a single segment; longer recordings use
segment transcription when available and fall back to sequential slices of the
confirmed transcript. Provider failures never remove a successfully generated
content result.

Transcripts use optimistic revisions; submitted transcripts are locked. Failed
assessments can retry without losing the recording or reference sample. Speaking
attempts use a separate `speaking_lab_attempts` table (or isolated local directory)
through the existing store adapter. User ownership and account blocking are checked
on every private API route. The latest 50 speaking attempts appear in the catalogue.

## Reference and maintenance

Verified 15 September 2026 against:

- https://www.pearsonpte.com/pte-academic/test-format/speaking-writing/
- https://www.pearsonpte.com/content/dam/ELL/pte/pearsonpte/pdfs/pte-academic-pdfs/PTE-Academic-Test-Taker-Score-Guide.pdf
- https://developers.openai.com/api/docs/guides/speech-to-text

RA preparation uses 35 seconds and its response has a clearly labelled 40-second
practice allocation; official RA response time varies. Other preparation/response
limits: RS 0/15 seconds; DI 25/40; RL 10/40; SGD 10/120; RTS 10/40.
The standalone Speaking practice now follows an exam-style interaction: prompt/audio
progression, preparation and recording advance automatically; preparation can be
skipped; the response is recorded once and submitted automatically. It remains a
practice simulation rather than Pearson software: scoring is independent, RA uses a
fixed 40-second practice response allocation, and a three-second silence cutoff is
not currently enforced.

Run `npm test` and `npm run validate:speaking`. To regenerate prompts, use the
existing edge-tts workflow in `scripts/generate-speaking-audio.py` with
edge-tts 7.2.8 and ffmpeg/ffprobe. Generation verifies duration and decodability;
postinstall verifies all checked-in content/audio hashes before deployment.

## Release verification

Recovered the unfinished Speaking implementation onto production commit
`3afebc56294ca0d89b45a96fbd234841f20ee50f`, retaining the essay preference,
plan approval and generated-draft validation fixes.

The existing 309-test suite passed. A further regression verifies that AI quotation
formatting (curly/straight quotation marks and whitespace) resolves to the exact
original student text, while changed or invented words remain rejected.
All 30 questions, 20 prompt recordings, 17 public assets and the 13 existing writing
recordings passed validation. Real model checks on DI, RL, SGD and RTS sample
responses returned valid content feedback. Automated delivery scoring is optional
and remains clearly separated from Pearson scoring.

Recording, private replay, revision conflicts, account isolation, reattempts and
failed-assessment retries were verified through isolated API and client tests.
The cloud browser could not reach the local preview, so no local visual or physical
microphone verification is claimed.

## Additional practice release

Added ten original SST lectures (15 standalone SST questions total), each with
a verified 60–90-second MP3, three content points and an individual 50–70-word
sample. Existing lectures, mocks and their recordings remain intact.

Back/Next navigation traverses each task's practice catalogue. Speaking and
listening resume saved attempts; reading restores saved question sessions; essay
practice keeps per-question device drafts scoped to the account. Active speaking
capture must finish and save before navigation. Listening timers continue while
away, as before. Mock submission rules are unchanged.

## Recorder recovery

Recorder startup tries supported WebM/MP4 encoders and the browser default,
including recovery when construction or start fails. Permission requests time out
without allowing a late response to replace a newer capture. Blocked prompt
playback can be retried from a fresh user gesture without requesting the microphone
again. A live input meter and explicit recording state show when to speak. Captured
audio has local replay/download before upload completes, including upload failures.

Regression tests cover format fallback, startup exceptions, permission timeout,
late grants, mobile autoplay rejection and replay during failed uploads. These
verify browser failure paths; they do not establish the specific cause on the
reporting user's physical microphone or browser.

## Minimal practice interface and dictation expansion

Added 50 original standalone dictation questions and bundled MP3s (56 total).
Mock question sets remain unchanged. Student catalogues use question numbers,
short instructions and primary controls; scoring-method explanations and mock
composition previews are removed. Dictation/SST catalogues show 12 items per page.
Individual submissions proceed directly; saved answers and Back/Next remain.
Writing history retains up to 250 attempts and only reconciles expired timers,
avoiding writes for each saved result when navigating.
