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

This is **content-only practice feedback**, not Pearson's official scoring engine.
No overall /90 score, pronunciation score or fluency score is inferred from text.
The recording can be replayed or downloaded for teacher review. Existing admin
impersonation can access a student's saved speaking attempts with its normal scope.

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

Microphone use begins only after a user action and permission. The app records after
the prompt/preparation stage and stops at the response limit. Leaving or hiding the
page releases capture. Captured audio is saved under an authenticated attempt.
Files are limited to 3 MB; response recordings have no public URL. Reattempting
creates a fresh UUID, preserving prior audio, words and feedback.

Automatic transcription uses the existing `OPENAI_API_KEY` if configured, with
`OPENAI_TRANSCRIPTION_MODEL` optionally overriding `gpt-4o-mini-transcribe`.
The student explicitly chooses transcription after a disclosure that audio is sent
to OpenAI. No reference answer is supplied to transcription. Without configuration
or during an outage, students can enter the exact words they spoke and still receive
content feedback. They must review recognition errors before submitting. Transcribed
or edited text is never treated as a reliable measurement of vocal delivery.

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
This is individual practice, not an exact reproduction of every exam behaviour:
it permits microphone/upload/manual-transcript fallbacks, an optional preparation
skip, and does not enforce a three-second silence cutoff.

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
responses returned valid content feedback; delivery scoring remains manual.

Recording, private replay, revision conflicts, account isolation, reattempts and
failed-assessment retries were verified through isolated API and client tests.
The cloud browser could not reach the local preview, so no local visual or physical
microphone verification is claimed.
