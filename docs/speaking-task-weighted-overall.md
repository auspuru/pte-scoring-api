# Speaking mock overall calculation

Version: `speaking-task-weighted-2026-10-27.1`.

The active Speaking mock overall is now derived from the individual saved
question assessments. It replaces the report's previous whole-content 6:5:5
blend and arbitrary content ceilings. OpenAI and Azure have separate totals;
both use the same validated question content marks and their own delivery marks.

## Published rules and practice assumptions

Pearson's *PTE Academic Test Taker Score Guide*, pages 15–31 and 45–46,
defines the question traits. Read Aloud content has one available point per
reference word; Repeat Sentence content is /3; DI, RL, SGD and RTS content is
/6. Pronunciation and oral fluency are each /5. A confirmed content zero
gates the entire answer to zero, even when delivery feedback is available.
The personal introduction is unscored.

Pearson's *Scoring Information for Teachers and Partners*, Table 1, page 5,
publishes these average Speaking contributions:

| Task | Published average contribution |
| --- | ---: |
| Read Aloud | 9% |
| Repeat Sentence | 16% |
| Describe Image | 31% |
| Retell Lecture | 13% |
| Summarise Group Discussion | 19% |
| Respond to a Situation | 13% |

These rounded figures total **101%**. Their relative weights are normalised
by their actual sum. RTS is not silently changed to 12%. Question counts do not
multiply the task's weight a second time.

For this practice model, combine the validated native C/P/F points within each
question and pool earned/available points within each task type. Weight those
task ratios by the included published contributions. The displayed /90 practice
scale is `round(10 + 80 * weightedTaskRatio)`, with no intermediate rounding.
Raw weighted task accuracy is reported separately.

**The native-point pooling and linear /90 conversion are institute practice
assumptions, not Pearson's scaling formula.** Pearson explicitly states that
its weighting table cannot predict exact scores. Its real model uses pretested
item difficulty and proprietary statistical scaling unavailable to third
parties. Do not label this as the real Pearson engine, claim exam parity, infer
item difficulty, award an IELTS band, or present a perfect practice result as
requiring error-free performance in the real exam. The provider delivery bands
and existing content judgments remain independent practice estimates.

Sources:

- [Current Pearson test-taker guide](https://www.pearsonpte.com/content/dam/ELL/pte/pearsonpte/pdfs/pte-academic-pdfs/PTE-Academic-Test-Taker-Score-Guide.pdf)
- [Pearson-authored partner report, mirrored PDF](https://www.tcyonline.com/india/pdf/ptescoringinfoforpartnersreport.pdf)

The Pearson-hosted partner-report URL currently returns the institution score
guide. The mirrored Pearson-authored report supplies the weighting table and
the explicit limitations (pages 4–6 and 15).

## Coverage, saved results and provider independence

All scored questions remain in the denominator. Explicit skipped answers and
unvisited questions on a timer-submitted mock are zero; unexplained missing
recordings or holes among visited items remain pending. A missing, provisional,
invalid or stale content assessment withholds both totals. Missing delivery
withholds only that provider's total. Content-gated answers do not require
delivery scores. Unsupported question types and a question-count mismatch
cannot silently disappear. Partial legacy papers disclose missing task types
and renormalise their included weights.

Existing recording-matched instructor delivery overrides are honoured and
explicitly counted in the report. They are never represented as automated
provider evidence. An override for another recording is ignored.

`speaking-mock-report.js` is the server-side source of truth. Detail and history
expose `speakingReport`, including separate `openai` and `azure` results, native
task breakdowns, coverage and missing-assessment information. The client uses
only this field for overall scores; it must never fall back to a stored legacy
whole-audio or combined score when the current calculation is pending.

Results recalculate on read without rewriting saved answers or marks, running a
database migration or paying for a new overall model call. History projects
recording metadata in PostgreSQL without transferring base64 audio. Normal mock
grading assesses individual questions only. Explicit legacy recovery operations
can still recover diagnostic whole-audio feedback, but those judgments do not
determine the active total. Stored `overall`, `overallAzure`, `combinedOverall`
and legacy comparison fields are retained for compatibility and audit, not
used as the active scoring calculation.

Verified legacy whole-content narrative feedback is exposed separately as
`overallFeedback` only while its source fingerprint still matches the saved
question, response and delivery evidence. Its former numeric score is not used.
