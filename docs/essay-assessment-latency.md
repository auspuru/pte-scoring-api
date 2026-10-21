# Essay assessment latency

Essay grading in production took 112,533–115,770 ms across recent successful assessments (three to five provider calls). The primary reader and independent subjective reader were sequential, even though the latter receives no primary decision. A separate paid formatting repair could also be triggered solely by the independent reader omitting an unused overall verdict.

## Changes

- Start the primary assessment and blind subjective review concurrently. Both must validate before publishing; existing disagreement and zero/full Content boundaries still require the resolver.
- Generate student-facing strengths and the overall verdict in the primary/final decision. The independent reader still supplies mandatory trait rationales, requirement coverage, exact evidence, issues and revision comparisons. Its unused duplicate verdict is no longer a repair trigger. Final resolver feedback retains the full contract.
- Request concise explanations and send only the relevant judgements/evidence to the resolver, excluding duplicate client metadata. Bind independent issue traits to Content, Linguistic Range and Coherence, matching the existing validator.
- Share a 120-second deadline and eight-call allowance across both readers, the resolver and citation/formatting repairs. Forward cancellation and the remaining timeout to the provider; cancel unfinished work when a required reader fails. Deadline/budget errors suppress automatic full-assessment retries and never return a score.
- Log stage start offsets, durations and outcomes without essay text, evidence or prompts. Assessment/sample caches and concurrent duplicate suppression remain in place; optional samples stay outside ordinary V3 scoring.

## Validation

The original hometown calibration essay was assessed through the existing production Claude proxy, without saving an attempt or modifying an account:

| Pipeline | Time | Provider calls | Final score |
| --- | ---: | ---: | ---: |
| Existing sequential pipeline | 112.8 s | 5 | 23/26 |
| Parallel readers and concise output | 59.3 s | 4 | 23/26 |
| Duplicate verdict removed from independent review | 44.7 s | 3 | 23/26 |

The final measurement retained the resolver and used no formatting repairs. This is a measured example, not a response-time or scoring guarantee. Rubric maxima, evidence validation, disagreement triggers and score gates are unchanged.

An unrelated-essay control completed in 24.9 seconds with two readers, Content 0 and a zero total. Local verification passed all 833 automated tests, 137 frontend checks, offline calibration, content validators and Edge TTS validation. The local Chrome download was blocked by the network proxy; the production release workflow must also pass its browser validation before merge.

Automated regression coverage checks concurrent starts, waiting for both readers, mandatory resolution, deadline/call-budget cancellation, peer failure, no partial-result cache, zero-Form short-circuiting, timing privacy, and final-verdict validation. Existing essay, cache, feedback and revision tests now reflect parallel call order.
