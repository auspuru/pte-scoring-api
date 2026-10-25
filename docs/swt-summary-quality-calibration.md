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

The strict provider schema uses a compact list of captured diagnostic labels, materialised back to the existing public per-idea map. Diagnostic labels do not determine Content. The source transformation span and operation fields have been removed from the provider contract.

## Interpretation disputes (policy 20.3.14)

The second independent reading no longer silently replaces a conflicting valid
first reading. Compare policy-adjusted Content, Grammar and Vocabulary decisions,
main-idea/relationship/meaning flags, conclusion adequacy and synthesis quality.
Optional language suggestions and differently worded explanations do not count
as scoring disagreements. An incomplete assessment is not a competing valid vote.

- The blind second pass remains independent of the first result. Any proposed
  deduction, including synthesis or meaning-changing language, selects the
  existing stronger reviewer rather than only escalating selected meaning flags.
- When two valid readings disagree, a stronger adjudicator rereads the source
  and response and checks the contested propositions. Exact student quotations
  establish what was written; they do not establish that a deduction is correct.
  The adjudicator must distinguish optional detail or style from a genuinely
  missing central idea, changed qualifier, comparison or causal relationship.
- The adjudicator returns a fresh evidence-validated assessment. Neither the
  maximum nor the average of the previous scores is used; a justified lower score
  can be upheld. Prior readings are supplied as untrusted opinions, not as labels
  or expected marks. No section scores enter the judging prompt.
- Unresolved disputes remain provisional through `review_unavailable` and are
  not cached as confirmed assessments. Valid resolved results carry an internal
  `interpretation_review` status and the disputed decision fields.
- Agreement still uses two calls. Disagreement normally uses three, with at
  most one validation retry if budget remains. The total remains capped at four
  provider calls and the existing 90-second shared deadline; earlier retries can
  exhaust that budget. No student-history scores are rewritten.

Service regression tests exercise disagreement in both score directions,
synthesis and language deductions, optional advice, invalid evidence, concurrent
requests, cache isolation, exhausted retries and an aborted adjudicator. These
tests verify safeguards against inconsistent judgments, not general semantic
accuracy or Pearson score parity. Live checks must separately test valid and
meaning-reversing responses without progress writes.

## Verification

### Contextual tense interpretation (policy 20.3.15)

A user-supplied geothermal response says water "is converted into steam, which
used to drive turbines and produce electricity". Earlier feedback treated the
missing auxiliary as a definite past-habit reversal. Judging instructions now
require reading the entire present-tense process explanation before making that
claim. The recoverable "which is used to" correction remains optional when the
intended mechanism is clear. This does not waive explicit past-only claims such
as "formerly drove turbines but no longer does"; those can contradict the source
under Content even when their grammar is correct.

`tests/fixtures/swt-grammar-regressions.js` preserves the exact 74-word response,
its 75-word auxiliary correction, and an explicit discontinued-operation
negative control. Route/presentation tests retain partial Content independently
of optional grammar advice. Opt-in audit checks require Grammar 2 on the
recoverable response and low Content on the genuine contradiction; the checks
do not infer official Pearson item marks or guarantee full Content.

Real proxy checks returned Content 3 / Grammar 2 / Vocabulary 2 for both the
original and auxiliary-corrected response. After explicitly separating a
well-formed false statement from a grammar error, the discontinued-operation
control returned Content 0 / Grammar 2 / Vocabulary 2. These are selected
calibration cases, not a measured accuracy rate on unseen responses.

Contract tests cover effective/partial/limited judgments, full Content without transformation proof, exact student citations, retained technical terms, five synonyms without an automatic upgrade, invented optional quotations, invalid assessments not being cached, Writing Lab consistency, and the unchanged attempt-6 result. These tests verify policy behavior, not semantic model accuracy.

Opt-in paid checks use the exact passage/response fixtures without account progress writes:

```
node tests/check-swt-live.js --url=https://swt.up.railway.app --mode=proxy --comparison=true --curl=true
```

Live response observations are recorded in the release description. Section totals never enter the judging prompt and no exact Pearson mark is inferred from them.

On 25 October 2026, opt-in proxy checks of policy 20.3.14 against the configured
provider completed for three existing audit cases: forecasting without the
invented GNP grouping received Content 4, the locally stated off-grid mechanism
received Content 3, and the reversed-causality Web control received Content 1.
All three passed their existing case assertions with complete independent
reviews and no progress writes. These selected-case observations do not measure
Pearson agreement or guarantee full marks for every accurate summary.
