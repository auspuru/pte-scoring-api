> Current policy (27 October 2026): Microsoft Azure is the sole pronunciation and fluency scorer. Current mock totals and publication use content plus Azure only. GPT delivery comparisons and pilot recovery sections below describe archived implementations. See [background scoring](speaking-background-scoring.md#azure-only-delivery-policy) for the active integration and migration.

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
0–100 diagnostic detail. Those delivery scores come from the audio, never from the
confirmed transcript alone, and are labelled as practice estimates. Pronunciation
uses Azure's pronunciation accuracy; oral fluency uses Azure's separate fluency
signal. Prosody and weak-word flags remain diagnostic and do not create extra
trait deductions. The portal uses a conservative mapping
from Azure's 0–100 signals to the six Pearson-style descriptor levels rather than
treating Azure percentages as Pearson marks. Without Azure
configuration, delivery remains available for teacher review. If the semantic
content reviewer is unavailable, content marks are withheld: keyword similarity
cannot verify negation, numerical relationships or speaker attribution. The
transcript, recording and separate audio feedback remain available, and content
review can be retried without another recording. RA and RS still use deterministic
transcript matching. Saved local fallback marks are also displayed as pending. Existing admin impersonation can
access a student's saved speaking attempts with its normal scope.

RA uses word edit distance: omissions, replacements and insertions each reduce
content credit; the maximum equals the reference word count. RS provides a /3
practice estimate for ordered word recovery. Filler pauses and leading/trailing
material are ignored; "almost nothing" is operationalised as 0–1 matched words.
These matching details are disclosed as approximations, not Pearson's algorithm.

DI receives AI content feedback /6 using Pearson-style content descriptors.
RL and SGD use the institute's connected-meaning practice policy /6, described below.
RTS uses the functional communication practice policy /6, also described below.

RL, SGD and RTS content reviews use a forced structured assessment, following the
same output approach as SWT. Required semantic judgments remain independently
validated. Evidence uses numbered student word spans which the server converts
back to exact transcript quotations. The one permitted retry receives the failed
assessment and a specific validation repair instruction. Persistent failures
withhold the content mark and log a diagnostic code without student text. The
saved response can be retried without recording again or replacing its existing
GPT and Azure audio assessments.

DI/RL/SGD content feedback includes an explanation, strengths, actionable improvements and a
covered/partial/missing/inaccurate breakdown with literal student evidence. Poor
provider output fails visibly rather than displaying fabricated feedback.

### Retell Lecture and Group Discussion content calibration

RL and SGD prioritise relevant connected meaning over exhaustive coverage. The
quality order is template-only filler (0), isolated relevant keywords (1), fragmented
phrases (2), connected ideas with substantive inaccuracies or gaps (3–5), and a
sufficiently developed, connected, mostly accurate summary (6). A template can still
be useful scaffolding when the actual ideas are meaningfully connected.

Connected responses with minor inaccuracies and equivalent connected responses
without inaccuracies belong in the same top category. Roughly 80–90% accuracy of
meaningful content can be enough for 6/6 when the main message, essential
relationships and useful support remain intact. This is an institute practice
calibration, not a verified Pearson threshold, a coverage/keyword percentage or a
guarantee of an overall 90. Optional details need not be included. A sparse response
does not earn full marks merely because its few assertions are accurate.

The same model request returns a holistic summary assessment and literal student
evidence. Minor secondary imprecision is distinguished from material changes to a
main claim, causal relationship, negation, conclusion or important speaker position.
Only material inaccuracies prevent an otherwise eligible summary from receiving
full marks. Source wording, simple connectors, optional omissions and harmless
grammar slips do not impose deductions. SGD requires clear main positions and
important relationships between them, not speaker names, every turn or a fixed
number of points per speaker. A minor attribution slip about an incidental detail
can be tolerated; inventing agreement or swapping an important position cannot.

The validator checks score/assessment consistency, exact quotations and error impact
without converting fact counts into marks. The existing maximum of two content
attempts remains. A valid minor-error full-score response needs only one content
request. Contradictory or unsupported feedback is retried and then withheld if it
still cannot be validated. Other task policies, Azure delivery scores and existing
saved assessments are unchanged; new RL/SGD assessments record their policy version.
Regression fixtures simulate provider output and verify these contracts; they do
not claim live model calibration or Pearson score equivalence.

### Respond to a Situation: functional communication

RTS rewards relevant, understandable communication rather than matching sample ideas.
A basic response that communicates the intended purpose effectively can earn 6/6;
a mostly effective response with a small actual communication gap earns 5/6.
Simple language, concise requests, suitable informal wording, minor slips and valid
alternative solutions are accepted. Persuasive development, every contextual detail,
an apology, a particular greeting or a fixed number of supporting ideas are not
required. Clear conventional indirect requests can work as well as direct requests.

The reviewer receives only the original situation and the student's transcript.
Teaching samples and the bank's fact list are excluded from the RTS scoring request.
The same content request returns an evidence-backed communication judgment instead
of an idea-coverage checklist. Its communicative level must agree with the /6 mark;
a material problem blocking the basic purpose prevents 5–6. Relevant fragments,
generic requests without a situational message, mere scenario retelling and off-topic
responses remain below the good-score range. Minor inaccuracies and optional
refinements must not be presented as barriers to full marks.

RTS results show communication strengths and useful next steps without a missing
sample-ideas checklist. The policy version and judgment are saved with each new
assessment. This is the institute's practice calibration, not a verified Pearson
score conversion. Existing saved marks and the independent audio-delivery policy
are retained. Regression checks use simulated providers, including all five original
situations, alternative solutions, evidence validation and saved-score reuse.

## Recording, privacy and transcription

### RL/SGD/RTS audio provider comparison

With the existing OpenAI key configured, new Retell Lecture, Summarise Group
Discussion and Respond to a Situation audio assessments use `gpt-audio-1.5` as the displayed pronunciation and
fluency practice scorer. `OPENAI_SPEAKING_AUDIO_MODEL` can override that model.
The complete saved recording is converted to WAV and sent in one bounded audio
request; delivery is judged from audio, not inferred from transcript text. Minor
intelligible pronunciation slips and natural pauses are accepted. No acoustic
percentages or Pearson /90 conversion are fabricated.

Azure remains available and assesses the same recording in the background. Its
result cannot delay or overwrite GPT's displayed scores. Provider/model, version,
assessment time, recording hash and separate scores are stored in each private
attempt's `deliveryComparisons`. Both providers are visible in an open score table.
A bounded read-only poll updates pending Azure scores without restarting playback,
uploading audio or regrading. Polling stops on completion, leaving the result, an
account change, an error or after three minutes. Reopening shows the latest result;
pending comparisons interrupted by a restart can resume when the attempt is opened.
Unavailable comparisons remain visibly unavailable. Existing successful Azure
assessments are preserved when updating a saved attempt to GPT. Successful current
provider results are reused on repeat submissions, including content retries.
Explicit updates under a new policy retain earlier provider snapshots in a bounded
history before refreshing the pair. Respond to a Situation keeps its flexible
functional-communication content policy; the provider comparison concerns only
pronunciation and fluency. Previously scored Azure-only RTS attempts offer an
explicit audio update to add GPT, preserving the existing Azure assessment.

The base Academy `intelligibility-delivery-v3` instructions, timestamp bounds and
score-impact checks were ported from `auspuru/Describe/backend/audio-scoring.js`
(source blob `48abed5def063388005e4a650fe044163244b710`). Clear accents, harmless
isolated slips, natural boundary pauses and smooth recovery are allowed at the
top band. GPT deductions require timestamped audible evidence and a real effect
on clarity or connected flow. Optional polish cannot justify a deduction; an
unsupported trait is withheld while a valid companion score survives. There are
no paid repair calls or automatic score bonuses. Azure applies the independent
trait policy by removing its extra prosody weighting; native accuracy and fluency
signals still use the disclosed acoustic mapping. Its numbers remain acoustic
practice estimates, not independently verified listener-impact judgments. The
providers are never forced to agree and GPT does not adjust Azure's marks.

The portal's current `intelligibility-delivery-v5` policy distinguishes generally
clear delivery with minor slips from recurring or sustained difficulty across the
whole recording. Clear speech, isolated intelligible slips, natural pauses and
smooth recovery can receive 5/5. GPT records a separate pattern and overall impact
for each trait before its mark. Lower marks require a recurring/sustained difficulty
and actual listener impact. A recurring pattern needs at least two distinct,
non-overlapping timestamped problem occurrences; a single genuine extended breakdown
can support a sustained-difficulty assessment. A lone weak word or brief hesitation
does not establish a recurring weakness. Unsupported deductions are withheld per
trait, preserving a valid companion score, without extra paid repair calls.
Each recording earns its own marks; prior attempts and assumed student ability
cannot lower the current response's score. The UI explains the overall pattern and
keeps one targeted action per trait instead of adding generic mandatory drills.
Azure retains its independent whole-response acoustic aggregation and band mapping;
individual word flags never add deductions, and coaching distinguishes an isolated
flag from a recurring problem. Its acoustic estimate does not establish a human
listener-impact judgment. Earlier GPT methods are labelled in the comparison table;
an explicit update assesses the saved audio under the new method and retains the
earlier snapshot, while an unchanged current Azure result is reused.

The GPT-4o audio preview is retired; the user selected its supported replacement,
GPT Audio 1.5. Reference: https://developers.openai.com/api/docs/deprecations and
https://developers.openai.com/api/docs/guides/audio-chat-completions . Regression
providers are simulated; a successful deployment does not establish provider
agreement or which score better matches Pearson. That comparison requires reviewing
real saved attempts with a teacher or an independent benchmark.

Selecting a question is the user action that starts the exam-style flow. The browser
requests microphone permission, audio prompts play automatically where required,
the preparation countdown runs automatically, and the microphone opens when the
countdown finishes. During preparation the only normal learner control is
**Skip preparation**. During recording, **Submit response** is available so a learner
who has finished can end the recording early; otherwise recording stops at the
response limit. There is no upload, transcript editing or question navigation during
the timed attempt. The saved recording proceeds automatically to assessment. Technical
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
with Comprehensive HundredMark pronunciation assessment and prosody enabled for diagnostics. The
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
skipped; the response is recorded once and can be submitted early when the learner
has finished, otherwise it is submitted automatically at the response limit. It remains a
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

## Original situation practice expansion

The subsequent portal-wide RTS prompt update is documented in [rts-question-prompts.md](rts-question-prompts.md). All 36 authored RTS prompts now end with a direct question naming the listener; existing attempts retain their original prompt and audio.

Added 30 original Respond to a Situation questions from the revised teaching
booklet, each ending in a direct question such as "What would you say to your
manager?" Existing questions and IDs are retained. Each addition has a sample
response. The additions use a displayed-text prompt with the existing
10-second preparation and 40-second response flow; they do not request a missing
audio asset. Existing audio prompts are retained. These are original practice
scenarios, not claimed exam predictions or copied question-bank content.

The same GPT delivery rubric applies to all six speaking tasks and the independent
whole-test review. Harmless sound/stress inaccuracies, clear accent variations,
minor hesitations and smooth recoveries must not deduct pronunciation or fluency
marks, even if similar harmless variations recur. Only an audible recurring or
sustained effect on clarity or connected delivery supports a deduction. Content
accuracy is judged separately. Azure retains its native acoustic comparison; it
is not relabelled as a GPT holistic judgment.
