# GPT essay assessment

The owner requested the existing OpenAI key be reused for a GPT comparison after Sonnet still misclassified understandable introductory wording as Content and overstated missing causal reasoning. No new OpenAI key was created, and the existing key was never downloaded or printed.

## Provider and contract

`essay-provider.js` selects `ESSAY_SCORING_PROVIDER=anthropic|openai` for the shared Essay Practice/Writing Mock grader, including its optional learning sample. `openai` uses the Responses API with `ESSAY_OPENAI_MODEL=gpt-6.1-sol` and `ESSAY_OPENAI_REASONING_EFFORT=medium`. The repository default remains `anthropic` for explicit rollback; production selects OpenAI by environment configuration. SWT, speaking and other task providers retain their existing settings.

`essay-openai-format.js` reuses the teaching prompts, canonical requirements and numbered-word evidence schemas. It uses forced strict function output, disables parallel tool calls and sends `store:false`. Reference definitions with sibling descriptions are inlined for OpenAI's strict schema requirements, without changing their meaning or the shared scoring definition. An Organisation-only review does not acquire unrelated prompt-coverage fields. Deletion corrections must quote enough context to supply a nonempty corrected phrase.

All server scoring checks remain mandatory: deterministic Form, the 26-point rubric, strict spelling, the existing meaning-based Grammar policy, current-essay quotations, blind review, support audit when indicated, final reconciliation, shared 120-second deadline and eight-call budget. Incomplete, refused, malformed or duplicate output cannot become a grade. Authentication/request errors are sanitised without exposing provider error bodies, and failures do not silently invoke another paid provider. Results retain `scoringProvider` and `scoringModel`. The rubric and browser transport contract stay at `essay-unified-2.6`; changing the service configuration restarts its process and clears in-memory caches. Historical attempts are not regraded.

Production is configured for the structured feedback on authenticated essay submissions (`ESSAY_FEEDBACK_V3=true`, `ESSAY_FEEDBACK_V3_PERCENT=100`) so students see the detailed feedback the owner requested. Anonymous compatibility requests retain the existing legacy contract. Account ownership, revision history and sample-contract negotiation remain unchanged. Set `ESSAY_SCORING_PROVIDER=anthropic` and redeploy for a provider rollback; the structured-feedback kill switch remains separate.

## Comparison and limits

Nine completed GPT assessments covered the two recent student essays with repeats, the earlier longer television essay, a strong one-sided control, unsupported automation claims and a directly contradictory conclusion. Full numerical results and concise judgements are recorded in `essay-gpt-evaluation.json`, without complete student essays.

- Late submission: 22/26 twice, Content 5. It credited the fairness/knowledge explanation and treated the higher-score restriction as ambiguous, rather than deducting Content for the awkward opening or declaring a definite contradiction.
- Television, 206 words: 23, 24 and 23/26, Content 6 in each. It credited the stated benefits, own experiences and late-night-viewing point, while supplying concrete article, agreement, fragment and phrasing corrections.
- Television, 293 words: 22/26, Content 6. Existing interpersonal-support reasoning was credited; the main advice concerned sentence control.
- Strong supported control: 26/26 without an invented counterargument requirement. Unsupported automation claims retained Content deductions (4/6). The contradictory conclusion retained Content 4 and Organisation 4 with separate evidenced effects.
- An optional Band 9-style learning sample passed the existing checks at 258 words with verified original source ideas; it did not change the original grade.

The completed local-service checks took about 19–115 seconds. One television repeat needed a primary validation retry for an invalid correction. After adding explicit nonempty-replacement guidance, its final run completed in about 59 seconds without that retry. The initial support-resolver strict-schema failures were fixed before the completed comparisons; no failed or partial result was published. These results support choosing GPT for the observed interpretation problems, not a claim of universal accuracy, a production percentile/SLA, or agreement with official Pearson scoring. Numerical judgements still vary, and there is no target mark or score floor.

## Isolated evaluation bridge

`scripts/essay-provider-review-relay.ts` is the complete source for a separate Railway Function in the existing project. It authenticates evaluation calls, limits model choice, input size, output allowance and call count, and forwards only Responses requests. It has no student history or database, accepts no arbitrary upstream URL or hosted tools, and logs only model/status/duration. Its key is a Railway reference to the existing production variable, not a copied value. The generated evaluation token exists only in temporary local files and the service configuration, not in git. After comparison and release verification, clear the bridge's key reference and token and verify it can no longer make provider requests.

All 1,166 local tests passed both with the default provider configuration and with the selected production OpenAI/structured-feedback settings. Offline calibration checks also passed. Provider tests cover strict output and API compatibility, cancellation/deadlines, refusal/truncation, secret-safe errors, explicit rollback, independent validation and cache reuse. Hosted release checks and live production metadata are verified before reporting the switch as deployed.

Official API sources used for the adapter: https://developers.openai.com/api/docs/models/gpt-6.1-sol and https://developers.openai.com/api/docs/guides/function-calling .
