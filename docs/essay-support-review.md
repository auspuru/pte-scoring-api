# Evidence checks for essay development feedback

Two readers could agree that an explanation was absent even when a later sentence supplied it. The television example contrasted programmes filling time with speaking, meeting and receiving support from real relationships. A valid quotation of the criticised claim did not establish that the criticism was true. Organisation could also receive 4/6 while its rationale described clear progression and only minor repetition.

## Assessment flow

- Keep the parallel primary and independent readers, the 26-point practice rubric and the existing language policy.
- Before publishing substantive Content/Organisation criticisms or low Content/Organisation judgements, reuse the resolver with the stronger review model. Full results and optional language advice do not add this check. Internally inconsistent relevance candidates go to relevance adjudication first.
- For structured feedback, first run a separate, concise factual support audit. It reads the complete essay without previous marks, checks each criticism, and quotes existing support. Every finding id and quotation must validate. The audit supplies no marks.
- Withhold prior marks and overall rationales from the support resolver. Give it the original essay, candidate criticisms and verified audit findings, distinguishing absent support, limited development and optional elaboration. A finding that a reason exists does not automatically establish full Content.
- A final Coherence mark of 4 or below requires a material Organisation issue, exact evidence and a distinct Organisation effect. An unsupported decision receives one focused Organisation reassessment, rather than another full essay review. That reassessment can replace only Organisation evidence, rationale, issues and relevant revision decisions; other traits retain the final resolver's decisions.
- Replace final subjective rationales and advice together. Keep a diagnostic audit trail under `subjectiveReview.supportAudit`. Provider timing logs still omit essay text and quotations.

The shared 120-second deadline and eight-call allowance cover the audit and any focused reassessment. Neither failed checks nor expired budgets release or cache an unchecked result. The new check adds provider work for affected essays; full-score/optional-only paths retain their existing call count. Essay policy version `essay-unified-2.5` invalidates assessment caches, and the browser asset hash is refreshed.

## Validation

Regression coverage includes the television essay, agreeing but unsupported criticisms, genuine retained deductions on a disordered essay, quoted support, invented/omitted/duplicate audit findings, failed-review cache isolation, legacy results, separate Organisation validation, model routing and preservation of non-Organisation marks.

Live checks used the existing production provider proxy without saving or overwriting student progress. Scored review alone continued to overstate the absence of reasoning. The separate factual audit identified the exact comparison and correctly distinguished an existing explanation from limited depth. The latest final-stage live reassessment, using those verified findings and the unchanged essay, returned 21/26: Content 5, Form 2, Spelling 2, Grammar 1, Vocabulary 2, Language Range 4 and Organisation 5. That final review completed in 38.1 seconds without a retry. This was a final-stage reassessment of previously assessed candidates, not a claim of a newly timed end-to-end production submission. Earlier live judgements retained lower Content marks; the checks improve evidence handling but do not eliminate model variation or guarantee 21/26. Primary language marks were preserved, not adjusted to match a manual estimate or the supplied screenshot.

No score floor, essay-specific override, automatic historical rescore or higher-score guarantee is introduced.
