# Writing sectional mocks and spoken-text practice

The student sidebar links to `/writing-mocks` and `/spoken-text`. Both use the existing signed-in account. The two mocks each contain two written summaries and one essay, with independent 10-, 10- and 20-minute clocks. Five original narrated lectures provide separate spoken-text practice.

## Assessment

`writing-lab-scoring.js` implements an independent AI practice assessment. It intentionally does not replace the portal's existing teaching-oriented essay or SWT feedback. Task maxima are SWT 9, SST 12 and essay 26; a mock has 44 available marks. No conversion to Pearson's 10–90 scale is claimed. Form and Content gates can make an entire response zero. Invalid or unavailable AI output produces a retry state, never a fabricated score.

References verified on 14 September 2026:

- [Pearson score guide](https://www.pearsonpte.com/content/dam/ELL/pte/pearsonpte/pdfs/pte-academic-pdfs/PTE-Academic-Test-Taker-Score-Guide.pdf)
- [Writing format and timings](https://www.pearsonpte.com/pte-academic/test-format/speaking-writing/)
- [Spoken-text format](https://www.pearsonpte.com/pte-academic/test-format/listening/)

## Saved attempts

The `/api/writing-lab` router verifies the existing session and checks that the account still exists and is not blocked. PostgreSQL attempts use their own table with an account foreign key and cascading deletion. Per-attempt transactions serialize changes. Local development uses atomic JSON files under the configured data directory.

The server owns deadlines and submitted answers. Refreshing never resets time. Each attempt stores its original question snapshots and validated results. Completed results can be retried individually without reassessing successful items. The client also keeps an account-scoped recovery draft and reports conflicting updates from another tab. Future questions and reference answers are withheld until their appropriate stage.

## Audio

`writing-lab-audio.js` generates only the five fixed bank transcripts using the existing server-side `OPENAI_API_KEY`. First playback prepares an MP3, then saves it on the configured Railway volume. Concurrent requests share generation; subsequent requests and deployments reuse the cache. Text, voice and generation settings are included in the cache key. Narration is disclosed as AI-generated. The timer starts only after the audio loads and the learner presses Start.

Audio API: [OpenAI Create speech](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create).

## Verification

Run `node --test tests/writing-lab.test.js` for timing, form boundaries, authenticated ownership, submission locking, persistence and narration-cache checks. `npm test` also covers existing portal behaviour. Real-model checks should verify a valid single-sentence SWT, an accurate SST, an essay without a requested opinion and an unrelated response before changing the assessment prompt.
