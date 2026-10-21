# Writing calibration: selection, reformulation and useful feedback

The practice grader now evaluates how well SWT ideas are selected and reformulated as well as whether their meaning is accurate. This is calibrated against the user's repeated Pearson practice comparisons and the current [Pearson Test Taker Score Guide](https://www.pearsonpte.com/content/dam/ELL/pte/pearsonpte/resources/PTE-Academic-Test-Taker-Score-Guide.pdf), printed pages 32–33, checked on 20 October 2026.

## Reported comparisons

| Attempt | Prepared SWT approach | Essay | Writing | Reading |
| --- | --- | --- | ---: | ---: |
| 1 | Original responses | Original | 79 | 23 |
| 2 | Concise paraphrasing | Original | 88 | 31 |
| 3 | Source clauses with connectors | Original | 83 | 27 |
| 4 | Five synonym substitutions | Original | 83 | 27 |
| 5 | Small clause changes | Original | 86 | 29 |
| 6 | Same SWT as attempt 5 | Revised | 86 | 29 |

Attempts 5 and 6 both show Listening 35 and Speaking 10. The user reports keeping SST and WFD consistent. The latest IMG_2205.jpeg report confirms no observable section-score improvement after the essay revision. The original essay remains a successful whole-test example; the extra connections are not established as necessary for this writer's high section score.

The exact prepared responses, passages, controls and reports are retained in `tests/fixtures/swt-attempt-comparison.json`. Attempt 1 was visually transcribed and its precise punctuation needs confirmation for controlled language comparisons. These observations support testing useful paraphrasing and reducing unnecessary essay criticism. They do not supply individual item marks or justify fixing a mark by strategy name. Selection, length and construction also differ between versions.

## Scoring behavior

- As requested on 21 October 2026, policy 20.3.12 prioritises relevant ideas and clear connections. Useful phrase or clause changes can strengthen a response and are sufficient when the other full-Content conditions are met. The engine does not assess whether the summary is completely paraphrased.
- There is no mandatory transformation operation, paired source quotation, clause-by-clause rewrite audit or overlap percentage. Accurate source wording may remain in a full-Content response. No operation label automatically increases or caps the score.
- A genuinely partial assessment remains capped at 3/4, and limited synthesis at 2/4, but the explanation must identify an actual omission, vague connection, repetition, unnecessary detail or poorly selected excerpt. Retaining source wording alone is not a deduction.
- Technical terminology can stay. Isolated synonym substitutions do not earn an automatic bonus or repair missing meaning.
- The grader shows its reasoning using exact student spans. Invalid student evidence requires reassessment, not a confirmed deduction. Legacy optional source quotations remain checked for accuracy when supplied, but are not required to prove paraphrasing.
- Standalone SWT, reference verification and Writing Lab share the guidance and caps. Historical assessments remain unchanged; the new policy version invalidates assessment caches.
- Feedback gives one manageable next action. Synthesis concerns affect Content; they do not automatically reduce Grammar or Vocabulary. Existing meaning-error, off-topic and Form checks remain in force.

The strict provider schema uses a compact list of captured diagnostic labels, materialised back to the existing public per-idea map. Diagnostic labels do not determine Content. The source transformation span and operation fields have been removed from the provider contract. The normal assessment still uses two independent model calls. An invalid review uses its existing bounded retry; no new retry or longer shared deadline is introduced.

## Verification

Contract tests cover effective/partial/limited judgments, full Content without transformation proof, exact student citations, retained technical terms, five synonyms without an automatic upgrade, invented optional quotations, invalid assessments not being cached, Writing Lab consistency, and the unchanged attempt-6 result. These tests verify policy behavior, not semantic model accuracy.

Opt-in paid checks use the exact passage/response fixtures without account progress writes:

```
node tests/check-swt-live.js --url=https://swt.up.railway.app --mode=proxy --comparison=true --curl=true
```

Live response observations are recorded in the release description. Section totals never enter the judging prompt and no exact Pearson mark is inferred from them.
