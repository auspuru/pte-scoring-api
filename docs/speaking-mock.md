# Speaking mocks

Each of the three papers contains an unscored personal introduction and 27 speaking-scored items:
6 Read Aloud, 10 Repeat Sentence, 5 Describe Image, 2 Retell Lecture,
2 Summarise Group Discussion and 2 Respond to a Situation. It is a speaking-only
practice paper, not a complete Speaking & Writing section. Answer Short Question
is not included: the saved bank has no ASQ prompts, and the current score guide
assigns ASQ to Listening. No new prompt audio is generated. Five additional RS
items use existing verified dictation recordings. The sixth RA uses an existing
archive passage; RA needs no prompt recording. Discussion recordings retain their
existing lengths, which are shorter than some current Pearson discussion prompts.

Mock 1 retains its original questions. Mocks 2 and 3 use different existing SST
passage excerpts for Read Aloud, saved dictation audio for Repeat Sentence, and
saved prediction images for Describe Image. These three item sets do not overlap
across the papers. The saved bank has five original lectures, discussions and
situations, so one recording of each type is shared across the three papers.

Reattempt is available on submitted results and in saved history. It copies the
exact stored question snapshot into a new owned attempt with an independent timer,
empty recordings and new scoring. It never resets or overwrites the previous
attempt. Fullscreen and microphone preflight still happen before creating the
reattempt, and duplicate creation retries with the same ID are idempotent. Speaking
practice, all three mocks, and reattempts remain limited to pppp, mehakbir1, mahabir1 and mahdis by
the existing server access gate.

## Test experience

The published Pearson examples informed the plain white question area, instruction
line, separate audio and lavender Recorded Answer panels, progress bars, volume
control and fixed Next footer. The shared protected-screen controller hides portal
navigation and records interruptions, without interpreting them as cheating or
changing marks. Browser fullscreen and microphone permissions are acquired before
an attempt is created. Each prompt plays once. There is a short instruction lead-in,
the task-specific preparation period, a recording tone except for RS, and the saved
response limit. Three seconds of silence after speech begins ends recording when
Web Audio voice detection is available. Next ends a response early, saves it, then
advances. The screen asks before proceeding without a saved answer. There is no Back
or replay control in the timed test. Server timestamps retain the clocks on refresh.
After interruption the remaining audio can resume at its current position, without
replaying the elapsed portion. Captured pending audio is kept in IndexedDB when
available and can be uploaded again without recording again.

## Two independent levels of scoring

Individual content uses the existing speaking content engine and policies. GPT
Audio and Azure assess pronunciation and fluency separately for all six types,
including RA, RS and DI. Successful stages are persisted and reused. The introduction
is never scored or included in the overall audio review.

The overall /90 is a separate, blind GPT Audio assessment of every saved scored
response. Its boundary accepts recording objects only. The model receives compressed
audio clips in order and their measured durations, with no question text, type,
reference, transcript, content marks, delivery marks, earlier feedback, student
identity or integrity metadata. It judges the complete set directly; it never sums
or averages question marks or maps their totals to /90. A lower whole-test trait
requires evidence across distinct recordings. An isolated poor response does not
establish a whole-test weakness. The same v4 minor-slip and smooth-recovery rules
apply. Too little evidence withholds an overall estimate. This is a holistic
speaking-delivery practice estimate, not a calibrated Pearson score prediction;
content accuracy is reported per question. Azure remains an independent acoustic
comparison per question: no fabricated Azure /90 is made by averaging its marks.

Background assessment is bounded to two mocks, with two item workers per mock.
The independent overall review can finish before item feedback. Database leases
and per-stage saves permit interrupted work to resume without repeating confirmed
assessments. Completed failures require an explicit retry; reads do not continually
consume paid calls. Recording and account data stay private, using the existing
session or authorized admin impersonation. The new `speaking_mock_attempts` store
is separate from individual speaking attempts; history queries omit recording data.

Result-detail polling also omits base64 audio inside the database query while
preserving recording metadata and all saved marks. It uses a read-only path except
when an expired active attempt must be submitted. Interrupted or temporarily failed
result requests retain the current scores and retry with a bounded backoff; expired
authentication stops polling. Retry actions are single-flight, and a failed retry
request resumes read-only checks without automatically resubmitting assessment.

The Academy content adapter uses a compact Claude-compatible strict tool schema.
It retains the Academy rubric, exact transcript quotes, image-fact references and
all server validation of score-impacting evidence. OpenAI-only array bounds and
score-branch expansion are kept out of Claude requests; the original validator
still enforces the bounds and score/evidence relationships. Provider failures log
only status and bounded error codes, never transcripts or credentials. A pinned
content-repair operation can fill missing DI marks once without repeating any
completed content, audio-provider or whole-test assessment.

An operator can also pin a one-time overall-only recovery to a saved submitted
mock. It reuses the normal job/lease guards, sends only original recordings to
the blind whole-test scorer, and leaves all individual content and provider
results intact. Confirmed overall results are reused. Recovery reports the saved
overall and trait scores or a specific safe failure; a failed operation does not
buy repeated reviews on restart. Complete audio function calls labeled `stop`
and valid JSON replies are accepted only after the same full evidence validation.
Each audio clip is labeled with its recording number and duration so evidence
timestamps are local to the correct file. One failed evidence validation may buy
one independent repair across the same complete audio set, with only the exact
validation diagnostic added; no prior mark or individual-question result is sent.
Provider failures are never automatically retried. A second invalid review still
withholds the overall mark.

An instructor-authorized, pinned manual operation can award 5/5 only to missing
Repeat Sentence pronunciation/fluency fields in one saved mock. These values live
in a separate, recording-bound override map with an operation ID, timestamp,
instructor attribution and the prior trait state. Original GPT/Azure results are
retained, existing marks are preserved, and non-RS questions, content and the
independent overall remain unchanged. Results and review label each overridden
trait as a manual override. Reattempts do not inherit the overrides.

## Sources and validation

- Pearson speaking format: https://www.pearsonpte.com/pte-academic/test-format/speaking-writing/
- Current score guide: https://www.pearsonpte.com/content/dam/ELL/pte/pearsonpte/pdfs/pte-academic-pdfs/PTE-Academic-Test-Taker-Score-Guide.pdf
- Published screen: https://www.pearsonpte.com/content/dam/ELL/pte/pearsonpte/images/Make-good-use-of-the-40-seconds-speaking-time-min.png
- Reviewed 24 October 2026. Matching the published layout is an approximation of
  the exam interface; this portal is independent of Pearson.

Tests use simulated providers and isolated storage. They cover the complete paper,
verified reused audio, hidden future prompts, private account ownership, locked and
idempotent recordings, server clocks, protected-screen cancellation, recording upload
recovery, both providers, and the blind overall scoring boundary. These tests do
not establish empirical agreement with Pearson's scoring.

A pinned instructor request can set `scope: "overall", reassess: true` with a new
operation ID to reassess an already scored mock from all original recordings.
The normal missing-result recovery and student retry do not force reassessment.
A successful reassessment archives the prior overall, while failures retain it
and are reported as needing review. Repeated startup requests for the same
operation never buy another assessment. Individual marks, content and manual
overrides are preserved. The new overall shares delivery rubric v5 with every
GPT question assessment: harmless slips and inaccuracies do not deduct marks.
A whole-test review with both traits at 5 and no impact must remain in its own
85–90 top band; inconsistent output is rejected, never automatically raised.

## Azure whole-mock comparison

Azure now supplies a separate whole-test acoustic summary from fresh processing
of every original scored recording. Only audio enters this assessment: no
reference prompts, transcripts, saved provider marks or instructor overrides.
Each recording is converted to PCM and processed in sections below 30 seconds,
without joining separate answers or counting inter-question gaps. The summary
weights new Azure AccuracyScore and FluencyScore measurements by assessed audio
duration. Digital-silence-only sections are excluded; every recorded response
must contribute usable measurements, and a failed request withholds the summary.
There are at most two simultaneous requests and no automatic provider retries.

The UI discloses native /100 values and the existing portal /5 acoustic bands.
This is an acoustic aggregation, not the independent holistic GPT judgment,
not an average of saved question marks and not a Pearson /90 score. The GPT
overall and all individual results remain unchanged. New submissions generate
the comparison; a pinned `scope: "overall", provider: "azure"` operation can
fill an existing mock once. The same operation is idempotent even after failure.

Microsoft reference: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment

Short final audio sections are joined to their preceding section when the result
remains below 30 seconds; otherwise the final two sections are balanced. Every
PCM sample is preserved. This avoids orphaned sub-second sections triggering an
Azure initial-silence timeout while retaining the complete recorded response.

## Results review and Describe Image samples

The score report shows the GPT delivery estimate and Azure acoustic scores in
separate overview cards. Task filters and a question navigator open one answer
at a time, with Previous/Next within the selected task. The full provider score
table remains available under Detailed score breakdown.

Describe Image reviews show the question image, a full-size image link and the
original saved sample response beside the student's recording, transcript and
feedback. Samples are examples, not the only valid wording or guaranteed marks.
All three papers use their own matching saved images and samples. Existing
submitted attempts have these fields already, so no reassessment, new sample
generation or provider calls are needed. Active tests still hide samples.

Polling updates the selected answer's feedback without replacing its audio
player. A late recording response cannot overwrite another selected question.

## Authorized combined-score pilot

An instructor-triggered `scope: "combined"` operation is restricted to `mahdis`
and `mahabir1`, the two explicitly authorized students.
It names an exact attempt or selects the latest submitted mock before a fixed
`startedBefore` timestamp. Its operation marker prevents a restart from assessing
a newer attempt or buying repeated reviews. No automatic rollout to other users
or new mocks occurs.

Before publication every scored question must be accounted for: a recorded answer
needs its original recording, a nonempty transcript and confirmed content. An
explicitly saved skipped answer with no recording/transcript receives zero content
and is passed to the whole review as unanswered. An unexplained missing recording
still blocks publication. No missing audio is fabricated. The unscored introduction
is excluded.
Missing content is recovered with Claude Sonnet 4.6 using the existing task policy
and evidence validators. All questions are counted; transcription/provider errors
on one question do not prevent attempts to recover subsequent questions. Existing
content, GPT/Azure delivery marks, recordings and instructor overrides remain
intact. Regular semantic-validation repairs also use the stronger reviewer.

A separate whole-content review receives only the complete raw question/source
and response set, without stored question scores or feedback. It gives one
holistic content judgment /6 and an indexed, literal-evidence observation for every
question. RA/RS retain reproduction requirements; DI uses the Academy meaning-first
policy; summaries and situations retain the institute's harmless-slip tolerance.
The existing blind whole-audio pronunciation and fluency /5 are reused only when
their recording coverage equals all saved recordings and the existing evidence
minimum is met. Otherwise a pinned audio recovery uses every original recording.
Unanswered questions remain visible to content review and cannot disappear from
the combined assessment. A fingerprint and lease prevent stale publication.

The combined practice estimate is `round(10 + 80 × (C + P + F) / 16)`, using three
whole-mock judgments, never averaged question marks. Content levels 0, 1, 2, 3 and
4 have ceilings of 10, 39, 59, 74 and 84 respectively; levels 5–6 permit 90. These
pilot safeguards prevent clear but irrelevant/fragmented content earning a high
estimate. They are institute choices, not Pearson's conversion or calibrated
predictions. The report exposes the formula and all three components, with the
existing independent GPT and Azure delivery cards retained. All-question coverage
must pass before a combined score can appear.
