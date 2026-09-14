# Writing sectional mocks and spoken-text practice

The student sidebar links to `/writing-mocks` and `/spoken-text`. Both use the existing signed-in account. New attempts in both mocks contain two written summaries (10 minutes each), one essay (20 minutes), one spoken summary (10 minutes) and three dictation sentences sharing four minutes: seven questions and 54 minutes in total. The dictation allowance is a practice allocation; the full exam uses the remaining Listening section time. Five original narrated lectures also remain available for separate spoken-text practice. Each mock has its own additional spoken summary and three distinct dictation recordings.

## Assessment

`writing-lab-scoring.js` implements an independent AI practice assessment. It intentionally does not replace the portal's existing teaching-oriented essay or SWT feedback. Task maxima are SWT 9, SST 12 and essay 26. Dictation earns one point per correctly spelled word matched in sequence, with one-to-one token matching, no extra-word credit, and no capitalisation or sentence-punctuation penalty. The answer and reference are aligned so one omission does not shift every later word. These are independent practice rules, not Pearson's proprietary scoring engine.

`public/writing-lab-report.js` provides the shared server/client calculation: round(10 + 80 × earned raw marks / available raw marks). It is labelled an independent Writing practice estimate out of 90, with the formula disclosed in the results. It is not an official score or a calibrated exam prediction. The overall estimate and per-task estimates are shown only when the relevant assessments are complete and valid; raw marks remain visible. Blank responses earn zero raw marks and an estimate of 10. History uses the same calculation, including old three-question attempts; those attempts retain their original question snapshots and 44 raw marks. Form and Content gates can make an entire response zero. Invalid or unavailable AI output produces a retry state, never a fabricated score.

References verified on 14 September 2026:

- [Pearson score guide](https://www.pearsonpte.com/content/dam/ELL/pte/pearsonpte/pdfs/pte-academic-pdfs/PTE-Academic-Test-Taker-Score-Guide.pdf)
- [Writing format and timings](https://www.pearsonpte.com/pte-academic/test-format/speaking-writing/)
- [Spoken-text format](https://www.pearsonpte.com/pte-academic/test-format/listening/)

## Saved attempts

The `/api/writing-lab` router verifies the existing session and checks that the account still exists and is not blocked. PostgreSQL attempts use their own table with an account foreign key and cascading deletion. Per-attempt transactions serialize changes. Local development uses atomic JSON files under the configured data directory.

The server owns deadlines and submitted answers. Dictation questions share one deadline which does not reset on Next or refresh; expiry locks all remaining sentences together. Audio progress and completion are stored separately for each question, merged monotonically, and restored on another device. Refreshing never resets time. Each attempt stores its original question snapshots and validated results. Completed results can be retried individually without reassessing successful items. The client also keeps an account-scoped recovery draft and reports conflicting updates from another tab. Future questions and reference answers are withheld until their appropriate stage.

## Audio

`writing-lab-audio.js` generates only fixed SST and dictation transcripts from the practice and mock banks using the existing server-side `OPENAI_API_KEY`. First playback prepares an MP3, then saves it on the configured Railway volume. Concurrent requests share generation; subsequent requests and deployments reuse the cache. Text, voice and generation settings are included in the cache key. Narration is disclosed as AI-generated. Standalone SST starts its timer when the learner presses Start. Within mocks, audio questions use the running task deadline and automatically play after a brief countdown when allowed by the browser. A blocked or interrupted playback can continue from its saved position; a completed recording cannot replay until review. Expiry and leaving the question cancel pending playback. Audio is keyed by attempt and question, so no recording state leaks into the next task.

Audio API: [OpenAI Create speech](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create).

## Verification

Run `node --test tests/writing-lab.test.js` for timing, form boundaries, authenticated ownership, submission locking, persistence and narration-cache checks. `node --test tests/writing-lab-client.test.js` checks separate question audio, late callbacks, resume, background/expiry cancellation and the score display. `npm test` also covers existing portal behaviour. Real-model checks should verify a valid single-sentence SWT, an accurate SST, an essay without a requested opinion and an unrelated response before changing the assessment prompt.
