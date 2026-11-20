# SWT passage audit and scoring implementation plan

Date: 19 November 2026. Review branch: `review/swt-passage-audit-and-scoring`.
Status: passage review complete and policy 20.3.17 implemented for review.

## Objective and sequence

Review all exact student-visible SWT texts and every scoring-reference variant before changing grading instructions or reference content. Then implement, validate and present candidate changes for review. Do not release to production or rewrite saved attempts.

The previously reported baseline is 95 distinct texts, 119 reference variants and 60 live standalone passages. The three earlier audit files are absent from this workspace. Reconstruct the inventory and reconcile counts rather than assuming the baseline is current. The user-supplied Notion observations page (416c8618-676c-8147-b31a-c8864c136bfb) supplies provenance and additional Pearson comparisons, not individual SWT marks.

## Phase 1: freeze and reconcile coverage

1. Record repository commit, collection time, source location and active/retained status.
2. Inventory the read-only live standalone API as well as bundled standalone originals, legacy and advanced revisions, user predictions, Writing Lab banks and generated mocks, and all active and retained Full Mock paper versions. Read loaders and migrations to distinguish shipped candidates from student-visible content. Preserve teacher edits.
3. Store exact text and exact-text SHA-256; group byte-identical texts for a single semantic review. Use a second whitespace-normalised fingerprint only to identify possible duplicates for inspection. Do not silently merge punctuation or substantive differences.
4. Hash reference payloads separately. Map each reviewed text and reference to every bank, question ID, paper ID/version and source path. Track expanded versions explicitly.
5. Explain every difference from 95/119/60. Unavailable live data is a coverage gap, never a completed review. No student records are needed for this inventory.

Outputs: `/workspace/work/swt-passage-audit/inventory.json` and coverage table.

## Phase 2: review every passage and reference

Read the complete exact passage before its sample. For each unique text record:

- Writer's central message in plain English.
- Actual structure: explanation, process, comparison, contrast, argument or additive ideas; no compulsory main-idea/turn/conclusion template.
- Essential propositions and relationships, with exact source quotations.
- Optional examples, biography, statistics and support that can be omitted.
- Conditional dependencies: context required only if the student selects a particular conclusion or effect.
- Acceptable simple paraphrases and at least one accurate concise summary.
- Every key/sample verdict: supported, incomplete, misleading, contradicted or version-mismatched; explain the precise evidence.
- Proposed correction, affected question mappings, priority and remaining uncertainty.

Prioritise reversed relationships, overstatements and short-source references reused for expanded texts. Explicitly review Web motivation/invention/impact; Forecasting's volatile-measure scope and government-spending example; IPCC's heat/cold mortality comparison; and both Tourism versions and their conditions for benefits. Continue through every remaining text; priority cases do not substitute for full coverage.

Outputs: `passage-audit.md`, machine-readable review records, reference-correction register and coverage reconciliation. A generated entry or valid sample Form does not count as semantic review.

Exit gate: every inventoried text reviewed, every reference variant checked, every usage mapped, and source/meaning uncertainties resolved or explicitly excluded with a documented reason. No grader changes before this gate passes.

## Phase 3: capture current behaviour

Before editing the scorer, retain current policy/model identifiers, exact inputs, native traits, feedback and displayed item scores for paired answers. Run provider-free routing checks separately from semantic model evaluation. Any paid provider checks must be bounded and must not save student progress.

Pairs use the same passage, selected ideas and comparable language quality: source-clause assembly; synonym-only edits; useful clause rewrite; concise paraphrase; optional omission; essential omission; unsupported claim; grammatical one-sentence weak Content; and Form failure. Include supported connector integration as a separate boundary case. Evaluate authentic supplied answers separately where controls differ.

Use December, March, October and November Pearson records as section-level evidence. Record changed Essay/SST/WFD, participant and completion confounds, and pending/unconfirmed submissions. Never derive exact item marks from section differences.

## Phase 4: candidate grading and feedback

Retain native C4/F1/G2/V2 and existing lower Content bands, language rules and gates. Full Content requires accurate central meaning, essential relationships and meaningful synthesis. A single useful clause change can suffice; source terminology and much original wording may stay. Optional support is not compulsory. Correct unchanged clause assembly, synonym substitutions or reordering alone cannot establish full synthesis and are capped at Content 3. Supported connectors can earn integration credit when they genuinely express a relationship. No overlap percentage, synonym quota, compulsory connector or academic-vocabulary requirement.

For every deduction require exact response evidence, passage support, the meaning or construction weakness, and a small actionable repair. Provide remove/replace/add instructions and a simple replacement only when useful. Explain why it helps; do not promise a Pearson score or recommend optional information as mandatory. Harmless language corrections remain optional. Do not automatically double-penalise a Content issue under Grammar or Vocabulary. Incomplete or invalid judge evidence requires review rather than a confirmed deduction.

Passage-specific meaning guides inform the shared rubric; no topic-specific forced marks or sample matching. Keep teacher audit detail out of student feedback.

## Phase 5: score routing and versioning

Trace each caller, response field, UI consumer, saved payload and cache across standalone, Writing Lab and Full Mock before editing. Reproduce the reported 79/81 discrepancy and separate Writing estimate that can reach 90. Align actual SWT item fields: Content 3 permits at most 8/9 native and item score 79. Inspect the meaning and consumers of independent contribution estimates before changing them.

Full Mock uses the same native SWT marks for Reading and Writing with existing section weights and all other contributing tasks preserved. Do not insert the /90 item display as native points. Version grading and display policy as appropriate; retain source/reference identity, scorer/model and policy identity for new results. Historical results retain original marks and known provenance; do not invent missing historical versions or silently regrade on reopen.

## Phase 6: verification and review delivery

Run appropriate existing SWT policy, synthesis, reference, Form, evidence/dispute, feedback, saved-attempt and UI checks; Writing Lab integration checks; and Full Mock adapter/aggregation/report checks in a provider-isolated environment using the scoring-audit skill's safe-check procedure. Add meaningful regressions for new boundaries, evidence validity, consistent item ceilings and historical compatibility.

Evaluate semantic results separately: flag genuine synthesis capped at 3, unchanged assembly given 4, optional omissions penalised, incorrect claims accepted, invalid evidence and repair text that introduces new errors. Fix unsupported behaviour and repeat affected checks. Report model variability rather than hiding failed cases. Tests with canned provider output verify contracts, not semantic accuracy.

Deliver complete coverage and count reconciliation, priority corrections with source evidence, revised instructions and code, before/after paired examples and actual native/displayed results from all three routes, saved-attempt treatment, check results and unresolved decisions. Present the candidate branch for review. Production release is outside this implementation stage.
