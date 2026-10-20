# SWT selection, reformulation and synthesis

The SWT policy previously promoted an assessment to Content 4 whenever meaning, support and relationships passed. That could override a lower model score for inefficient synthesis. The revised policy requires a separate synthesis assessment before certifying full Content.

## Observations

The user compared two passages in Pearson Scored Practice Test 3. These are section results, not individual SWT raw scores:

| Attempt | Response approach | Writing | Reading |
| --- | --- | ---: | ---: |
| 1 | Original responses | 79 | 23 |
| 2 | Concise paraphrased responses | 88 | 31 |
| 3 | Selected source wording with connectors | 83 | 27 |
| 4 | Five synonym substitutions per summary | Pending | Pending |

The user reports keeping the other responses unchanged. Those controls and perfect SST/WFD performance have not been independently verified. Attempt 2 also differs in selection, length and sentence construction; the comparison does not isolate a paraphrasing-only effect. No individual trait scores, section-score offsets, universal strategy ranking or synonym threshold are inferred. Attempt 1 is a visual transcription, with punctuation/spelling requiring confirmation before language comparisons.

The exact screenshot passages and response versions are retained in `tests/fixtures/swt-attempt-comparison.json`. They deliberately exclude extra paragraphs present in the portal's longer Web passage. Section results stay in that evidence file and do not enter the model prompt.

## Scoring change

Pearson's current [Test Taker Score Guide](https://www.pearsonpte.com/content/dam/ELL/pte/pearsonpte/resources/PTE-Academic-Test-Taker-Score-Guide.pdf), printed page 32, distinguishes concise, effectively reformulated synthesis from responses with inefficient synthesis or poorly selected excerpts. The guide was checked on 20 October 2026.

The institute's practice policy adds `summary_assessment.synthesis` with `quality`, an exact student `evidence` quote, and an explanation. The provider uses compact `synthesis_quality` and numbered `synthesis_span` fields, with the rationale in `relationship_explanation`; the server constructs the public object and exact quote. Unused register metadata and duplicate suggestion text were removed to stay within the provider grammar limit. Partial or limited judgments without genuine evidence require reassessment.

- Effective synthesis can satisfy the full-Content gate when meaning, support and necessary relationships also pass.
- Partial synthesis limits Content to 3; limited synthesis limits Content to 2. A faithful but poorly condensed response does not need an invented factual error to explain this deduction.
- Neither source overlap nor five isolated synonym changes determines a score. Small useful phrase changes, clause combination and good selection can be sufficient. Names, technical terms and appropriate source phrases may remain.
- Feedback recommends one small achievable revision. Form, Grammar and Vocabulary remain independent; there is no second language penalty for the synthesis finding.
- A missing assessment cannot be cached as confirmed. Both independent passes use the same contract, and the policy version changes the cache key.

The standalone grader and reference verifier share the same policy. Writing Lab's assessment instructions and the admin reference-authoring prompt use the same synthesis principle. Historical attempts are not rewritten. The feedback script URL changes with its content hash so returning browsers receive the new guidance.

## Validation

Deterministic tests use labelled semantic judgments to check the policy and evidence gates; they are not claims about live model accuracy. The optional live comparison uses:

```
node tests/check-swt-live.js --url=https://your-app --mode=proxy --comparison=true --curl=true
```

This sends the fixture passages and responses to the configured Claude proxy, uses the current structured contract and independent review, and writes no account progress. It reports observed assessments without forcing the section-score ranking. Attempt 4 remains excluded until its Pearson result is reported.


## Current calibration limit

The revised local suite passes 765 tests, and the first hosted release check passed. Live Claude assessments completed after retrying gateway failures: the concise paraphrases earned Content 4, and the original responses earned Content 3 in the observed assessments. Some source-based attempt-3 responses also earned Content 4. The model therefore does not yet reproduce the reported attempt-2 versus attempt-3 section difference; those totals cannot be treated as individual-item ground truth. The implementation is retained in a draft PR, with production unchanged, pending attempt 4 and further calibration.
