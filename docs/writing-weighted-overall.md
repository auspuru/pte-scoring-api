# Writing mock overall calculation

Version: `writing-task-weighted-2026-10-26.1`.

Completed Writing mocks now calculate their overall practice estimate from four
task groups: SWT 28, Essay 31, SST 18 and Write from Dictation 23. These are the
average question-type contributions in Pearson's *PTE Academic Scoring Information
for Teachers and Partners*, Table 1, page 5. They are indicative weights, not
Pearson's proprietary scaling or item difficulty parameters.

Reference: [Pearson-authored partner report, mirrored PDF](https://www.tcyonline.com/india/pdf/ptescoringinfoforpartnersreport.pdf).
The original Pearson-hosted report URL currently redirects to the July 2025
institution score guide, which does not contain the weighting table.

For each task group, divide total validated native marks by total available
native marks. Multiply each group ratio by its weight, sum, then divide by the
sum of the weights of the task types included in that saved paper. Keep native
precision until the final rounding step. Question counts and dictation sentence
lengths influence the ratio within a group, not the group's overall weight.

The displayed score is `round(10 + 80 * weightedRatio)`. This remains an
**uncalibrated institute practice estimate**, not a Pearson score prediction.
Weighted accuracy is also reported. A future calibrated mapping must be supported
by matched response sets and separate validation before replacing this mapping.

Every saved question remains in its group's denominator. Confirmed zero marks,
including unanswered or gated answers, remain zero. Missing, invalid or provisional
assessments block the overall estimate. Provisional or invalid Writing assessments
can be retried through the existing score route, including SST. Successful saved
assessments are reused; reading a complete report performs no regrading.

Legacy three-question Writing papers retain their original question snapshots.
Their included weights are renormalised and the report identifies partial task
coverage. Unsupported Writing task types block the calculation instead of being
silently omitted. Listening mocks and individual practice retain their existing
aggregation and scales.

The shared browser/server module is `public/writing-lab-report.js`. Call
`summarize(questions, results, attempt)` with the attempt's `kind` and `module` to
select Writing weighting. Report detail, attempt history and My Progress use the
same calculation. Existing stored responses and marks are preserved; saved
reports update on read, with no database migration or bulk paid reassessment.
Whole-mock narrative feedback continues as a separate assessment.

Regression example: SWT 15/18, Essay 16/26, SST 9/12 and WFD 27/34 give
74.1749622926% weighted accuracy and a provisional 69/90. The native marks still
total 67/90; the previous pooled-mark conversion was 70/90.
