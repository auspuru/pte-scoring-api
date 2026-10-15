# Essay feedback implementation

Policy version: `essay-feedback-2026-10-15.1`. Scoring rubric and maxima remain unchanged. Baseline production commit: `3af884e05c1d2949d532530f0cd3927200c8ec45`.

The complete essay route remains `/api/essay/grade`. Writing Lab and full mocks use the same `createEssayGrader`; plan and generated-draft review is unchanged.

## Implemented behaviour

`public/essay-feedback.js` defines the shared teaching policy, canonical prompt requirements with exact character spans and grouped OR choices, validated issues, final reconciliation, revision comparisons and safe rendering. Each assessment stage uses the same requirements. Existing primary, independent and conditional resolver calls are retained. A feedback disagreement can also require adjudication. The final subjective decision replaces earlier subjective issues, priorities, strengths and verdict. Genuine primary spelling, grammar and vocabulary diagnostics remain available. Minor grammar corrections remain accessible without changing the existing Grammar scoring rule.

Issues identify their code, category, priority, requirement, trait, holistic scoring rationale, current-draft evidence and policy version. Missing coverage references the exact prompt requirement. Other issues require exact current essay evidence. The server materialises numbered-word citations and verifies locations. Evidence existence is a structural safeguard; semantic correctness is a model judgement that must also be evaluated by teaching review.

Results present overall assessment, strengths, up to three main corrections, expandable additional corrections, language corrections and optional polish. Passages are highlighted using verified character offsets and escaped text. Exercises reference issue IDs and the actual issue passage/action. Learning samples are requested separately in the new flow, reusing cached assessment scores; legacy callers retain their existing sample contract.

Revision links are additive fields inside the existing per-user JSON attempt history, including PostgreSQL JSON storage. No database migration is needed. The server loads a parent only from the authenticated account and rejects a changed question. Previous scores are never passed to scoring stages. Resolved claims require current evidence, current requirement coverage and final consistency; uncertain changes are labelled needs clarification. The original text remains immutable. Students can mark a final draft; original, latest and final drafts stay prominent, with intermediate drafts recoverable. History limits retain the original alongside retained revision groups. Existing history limits and explicit deletions still apply.

## Release controls

The feature is disabled by default. `ESSAY_FEEDBACK_V3=true` enables the control, `ESSAY_FEEDBACK_V3_USERS` permits a comma-separated list of verified account usernames, and `ESSAY_FEEDBACK_V3_PERCENT` selects a stable account cohort from 0 to 100. Anonymous requests retain the legacy path. New and legacy assessments have separate versioned caches. Revision context is included in deduplication keys. Attempt IDs are scoped after caching so another account never receives someone else's revision IDs.

Set `ESSAY_FEEDBACK_V3=false` and redeploy to restore the legacy contract for new submissions. Saved new results remain readable through the compatible legacy fields and additive renderer. Reverting the release commit restores the previous renderer while keeping historical JSON data. Disable cohort access before a code rollback. There are no destructive migrations to reverse.

`[essay-assessment-metric]` logs policy version, elapsed time, provider call count, completion/failure and error code, without prompts, essays, identities or credentials. Metrics cover assessment/review/resolver and bounded repair operations; explicit sample requests are separate. Use the same interval and workload to compare p50/p95 latency, failures and provider calls. Do not infer live performance from offline unit timings.

## Verification

The baseline passed 679 tests. The initial implementation passes 707 tests plus existing offline calibration controls. New tests cover exact requirements, OR alternatives, final-authority replacement, structured evidence, optional advice, zero-correction answers, revision ownership, failure behaviour, caching, call counts, issue-linked exercises and historical retention. Existing essay, mock, navigation and client recovery tests remain in the release gate.

`tests/essay-feedback-cases.js` provides synthetic teaching cases and weaker variants. `scripts/evaluate-essay-feedback.js` submits them only to an explicitly configured isolated review service, records complete results and timings, and repeats selected cases with semantically identical paragraph spacing to avoid returning only cached results. Contract tests alone do not prove model teaching accuracy.

Local build validators passed through the media and content checks, but this environment could not download the Puppeteer browser because the outbound proxy timed out. The hosted release gate must complete the browser installation and full build before promotion. One pre-existing 25 ms SWT timeout test failed during concurrent browser/dependency downloads; its isolated rerun and the subsequent complete suite passed, without modifying SWT code.

The review service is `pte-essay-feedback-review` in `airy-embrace`, service `5bae0f28-26de-407a-9ae8-29a8538ba362`. It has its own ephemeral filesystem, no volume mount, blank database URLs, no shared environment variables and no mail credentials. It references only the existing Claude credential server-side. It does not reuse production student data. Test registrations and attempts are disposable. App sleeping is enabled.

Production-wide activation requires the plan's human teaching review, satisfactory hosted/model/browser evaluation and a gradual cohort release. Do not report human acceptance, production p50/p95 equivalence or full release as completed without that evidence.
