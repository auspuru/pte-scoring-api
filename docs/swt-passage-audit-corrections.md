# SWT audit corrections — 21 October 2026

The public bank audit covered 133 entries, 90 distinct sources and 99 distinct
source/reference pairs under policy 20.3.12. All 57 live references received
9/9; 12 other variants raised review questions. A lower score was not treated
as proof that the answer was wrong.

Policy 20.3.13 addresses evidenced grader failures without sample-score overrides:

- Remove the topic-specific forecasting accusation that primed feedback to
  criticise a GNP/inflation grouping absent from the student's response.
  Compare only the examples actually selected in the response.
- Read local participial reasons before alleging a missing mechanism or treating
  a loose contrast marker as a negation of an otherwise affirmative clause.
- Validate each missing-dependency effect as an actual student quotation;
  malformed evidence needs reassessment, not a confirmed deduction.
- Treat free-text connector/cohesion/discourse labels as Content coaching,
  preventing a second Grammar deduction for the same connection issue.
- Route material-meaning disputes to the existing stronger reassessment model
  during independent review. Ordinary judgments retain the base reviewer and
  the request budget remains unchanged; no score is forced by this routing.
- Keep independent review, real meaning deductions and one-sentence Form.
  Relevant connected ideas and useful phrase changes remain the priority;
  complete paraphrasing is not required.

Content and guidance:

- Align 11 older bundled answers with their current source versions. In
  particular, Farm Cottage's different perspectives, London's cost condition,
  self-defence safeguards and fake-news verification now appear in the
  corresponding extended-source references.
- Add a concise shared-responsibility conclusion to Natural Resources.
- Remove the false military-spending comparison from the authored Climate
  Change Economics source, its diagnostic ideas and rationale. No replacement
  expenditure statistic is invented. The other unattributed quotations and
  figures have not received a blanket external fact-verification sign-off.
- Complete New Woman's missing word as “wasn't fully realised at the time”.
  These authored corrections do not alter user screenshot predictions.
- Replace compulsory-detail rationales for Climate, Tourism and the Web with
  coaching that allows implied conclusions and optional examples.
- Replace the study page's connector quota, synonym quota, semicolon-capital
  rule, four-box scoring formula and guaranteed weekly score progression.
  Preserve tracker data and navigation.
- Remove the prediction authoring gates for copied runs, source openings and
  25–65 words. Keep the actual 5–75-word Form gate and semantic review status.
- Include 24 preserved legacy sources and 20 advanced versions in build
  validation: 114 published records across the banks are now checked.
  Preserve authentic source lengths rather than padding or trimming them.

Live content corrections match the audited ID, title and complete source.
Each field is updated only if its old value still matches; updates are
idempotent and PostgreSQL rows are locked during the transaction. Teacher
source edits, replacement explanations, authored samples and student attempts
are preserved. Missing legacy samples can be restored only for an exact known
source/title match. The migration applies to four canonical live rows.

Validation includes the full automated test suite, frontend/content validators,
provider-free calibration, and opt-in paid model regressions in
`tests/check-swt-live.js --audit=1`. The latter exercises the exact audited
Forecasting and Off-Grid answers, revised Natural Resources and Farm Cottage
references, and a deliberately reversed Web cause. Requests contain no account
identifier and must not save progress. Native portal marks are not verified
Pearson item scores.
